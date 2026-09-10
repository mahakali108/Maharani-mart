import 'server-only';
import type { createClient } from '@/lib/supabase/server';

export interface WalletTransaction {
  id: string;
  retailer_id: string;
  account_id: string | null;
  transaction_type: 'ORDER_DEBIT' | 'PAYMENT_CREDIT' | 'REFUND_CREDIT' | 'MANUAL_CREDIT' | 'MANUAL_DEBIT' | 'CREDIT_LIMIT_CHANGE' | 'ORDER_REVERSAL' | 'ADJUSTMENT';
  amount_paise: number;
  direction: 'debit' | 'credit';
  reference_type: string | null;
  reference_id: string | null;
  description: string;
  reason: string | null;
  created_by: string | null;
  created_at: string;
  notes: string | null;
  idempotency_key: string | null;
  metadata: Record<string, unknown> | null;
  is_reversed: boolean;
}

export interface CreditAccount {
  id: string;
  retailer_id: string;
  credit_limit_paise: number;
  /** Frozen pre-wallet outstanding baseline in paise (migration 0031). */
  opening_outstanding_paise: number;
  allow_overdue: boolean;
  overdue_limit_paise: number;
  created_at: string;
  updated_at: string;
}

export interface WalletSummary {
  creditLimitPaise: number;
  creditLimitRupees: number;
  outstandingPaise: number;
  outstandingRupees: number;
  availablePaise: number;
  availableRupees: number;
  hasConfiguredLimit: boolean;
  isOverLimit: boolean;
  allowOverdue: boolean;
}

export function paiseToRupees(paise: number): number {
  return Math.round(paise) / 100;
}

export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

export function formatPaise(paise: number): string {
  const rupees = paiseToRupees(paise);
  return `₹${rupees.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export async function getRetailerCreditAccount(
  supabase: ReturnType<typeof createClient>,
  retailerId: string
): Promise<CreditAccount | null> {
  const { data } = await supabase
    .from('retailer_credit_accounts')
    .select('id, retailer_id, credit_limit_paise, opening_outstanding_paise, allow_overdue, overdue_limit_paise, created_at, updated_at')
    .eq('retailer_id', retailerId)
    .maybeSingle<CreditAccount>();
  return data ?? null;
}

export async function getRetailerOutstandingPaise(
  supabase: ReturnType<typeof createClient>,
  retailerId: string
): Promise<number> {
  // Authoritative DB function (integer paise), with a legacy-column fallback
  // when the function is unavailable (not-yet-migrated DB or a mocked client).
  try {
    const { data, error } = await (
      supabase as unknown as { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> }
    ).rpc('get_retailer_outstanding_paise', {
      p_retailer_id: retailerId,
    });
    if (!error && data !== null && data !== undefined) return Number(data);
  } catch {
    // fall through to legacy
  }
  const { data: retailer } = await supabase
    .from('retailers')
    .select('outstanding_balance')
    .eq('id', retailerId)
    .maybeSingle<{ outstanding_balance: number }>();
  return rupeesToPaise(retailer?.outstanding_balance ?? 0);
}

export async function getRetailerCreditLimitPaise(
  supabase: ReturnType<typeof createClient>,
  retailerId: string
): Promise<number> {
  // Authoritative DB function (integer paise), with a legacy-column fallback.
  try {
    const { data, error } = await (
      supabase as unknown as { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> }
    ).rpc('get_retailer_credit_limit_paise', {
      p_retailer_id: retailerId,
    });
    if (!error && data !== null && data !== undefined) return Number(data);
  } catch {
    // fall through to legacy
  }
  const { data: retailer } = await supabase
    .from('retailers')
    .select('credit_limit')
    .eq('id', retailerId)
    .maybeSingle<{ credit_limit: number }>();
  return rupeesToPaise(retailer?.credit_limit ?? 0);
}

export interface WalletPosition {
  creditLimitPaise: number;
  outstandingPaise: number;
  availablePaise: number;
}

/**
 * Authoritative wallet position from the database RPCs (integer paise), with a
 * legacy-column fallback when the wallet functions have not been deployed yet.
 * Used by the server-side order quote so the credit check reads the ledger, not
 * a client-supplied or stale balance.
 */
export async function getRetailerWalletPosition(
  supabase: ReturnType<typeof createClient>,
  retailerId: string
): Promise<WalletPosition> {
  const [creditLimitPaise, outstandingPaise] = await Promise.all([
    getRetailerCreditLimitPaise(supabase, retailerId),
    getRetailerOutstandingPaise(supabase, retailerId),
  ]);
  return {
    creditLimitPaise,
    outstandingPaise,
    availablePaise: creditLimitPaise - outstandingPaise,
  };
}

export async function getRetailerWalletSummary(
  supabase: ReturnType<typeof createClient>,
  retailerId: string
): Promise<WalletSummary> {
  const [limitPaise, outstandingPaise, account] = await Promise.all([
    getRetailerCreditLimitPaise(supabase, retailerId),
    getRetailerOutstandingPaise(supabase, retailerId),
    getRetailerCreditAccount(supabase, retailerId),
  ]);

  const availablePaise = limitPaise - outstandingPaise;
  const hasConfiguredLimit = limitPaise > 0;
  const isOverLimit = hasConfiguredLimit && outstandingPaise > limitPaise;

  return {
    creditLimitPaise: limitPaise,
    creditLimitRupees: paiseToRupees(limitPaise),
    outstandingPaise,
    outstandingRupees: paiseToRupees(outstandingPaise),
    availablePaise,
    availableRupees: paiseToRupees(availablePaise),
    hasConfiguredLimit,
    isOverLimit,
    allowOverdue: account?.allow_overdue ?? false,
  };
}

export async function getRetailerLedger(
  supabase: ReturnType<typeof createClient>,
  retailerId: string,
  limit = 100
): Promise<WalletTransaction[]> {
  const { data } = await supabase
    .from('retailer_wallet_ledger')
    .select('*')
    .eq('retailer_id', retailerId)
    .order('created_at', { ascending: false })
    .limit(limit)
    .returns<WalletTransaction[]>();
  return data ?? [];
}

export async function getRetailerLedgerPaginated(
  supabase: ReturnType<typeof createClient>,
  retailerId: string,
  page = 1,
  pageSize = 25
): Promise<{ entries: WalletTransaction[]; total: number }> {
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const { data, count } = await supabase
    .from('retailer_wallet_ledger')
    .select('*', { count: 'exact' })
    .eq('retailer_id', retailerId)
    .order('created_at', { ascending: false })
    .range(from, to)
    .returns<WalletTransaction[]>();
  return { entries: data ?? [], total: count ?? 0 };
}
