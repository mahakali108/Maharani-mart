import 'server-only';
import { paiseToRupees } from '@/lib/retailer/format';

import {
  applyCursor,
  applyKeysetOrder,
  keysetCursorFor,
  toListBatch,
  type KeysetColumn,
} from '@/lib/infinite-scroll/keyset';
import { iterateKeysetPages } from '@/lib/infinite-scroll/collect-keyset-pages';
import type { ListCursor } from '@/lib/infinite-scroll/cursor';
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

export type WalletStatementTransaction = Pick<
  WalletTransaction,
  'id' | 'created_at' | 'transaction_type' | 'amount_paise' | 'direction' | 'description'
>;

export interface CreditAccount {
  id: string;
  retailer_id: string;
  credit_limit_paise: number;
  /** Frozen pre-wallet outstanding baseline in paise (migration 0031). */
  opening_outstanding_paise: number;
  allow_overdue: boolean;
  overdue_limit_paise: number;
  /** Net-N payment terms in days; null when the distributor has not set them (0049). */
  payment_terms_days: number | null;
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

// Re-exported from the client-safe display helpers: a client component that
// renders an amount must not have to import this server-only module.
export { paiseToRupees } from '@/lib/retailer/format';

export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

export function formatPaise(paise: number): string {
  const rupees = paiseToRupees(paise);
  return `₹${rupees.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export async function getRetailerCreditAccount(
  supabase: Awaited<ReturnType<typeof createClient>>,
  retailerId: string
): Promise<CreditAccount | null> {
  const { data } = await supabase
    .from('retailer_credit_accounts')
    .select('id, retailer_id, credit_limit_paise, opening_outstanding_paise, allow_overdue, overdue_limit_paise, payment_terms_days, created_at, updated_at')
    .eq('retailer_id', retailerId)
    .maybeSingle<CreditAccount>();
  return data ?? null;
}

export async function getRetailerOutstandingPaise(
  supabase: Awaited<ReturnType<typeof createClient>>,
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
  supabase: Awaited<ReturnType<typeof createClient>>,
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
  supabase: Awaited<ReturnType<typeof createClient>>,
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
  supabase: Awaited<ReturnType<typeof createClient>>,
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
  supabase: Awaited<ReturnType<typeof createClient>>,
  retailerId: string,
  limit = 100
): Promise<WalletTransaction[]> {
  const { data, error } = await supabase
    .from('retailer_wallet_ledger')
    .select('*')
    .eq('retailer_id', retailerId)
    .order('created_at', { ascending: false })
    .limit(limit)
    .returns<WalletTransaction[]>();
  if (error) throw error;
  return data ?? [];
}

/**
 * One batch of a retailer's wallet ledger.
 *
 * Newest first, `id` breaking ties: two ledger rows can share a `created_at`,
 * so the tiebreaker is what makes "everything after this row" exact. That turns
 * the old `?page=` walk into a keyset seek — scrolling stays cheap however far
 * back the retailer goes, and a payment recorded while they scroll cannot
 * repeat or skip a row.
 *
 * The exact total is counted for the FIRST batch only: it feeds the
 * "N transactions" heading, and re-counting it on every scroll would be the
 * most expensive query on the page.
 */
export const WALLET_LEDGER_BATCH_SIZE = 25;

/** ORDER BY for the ledger list — also the shape of its keyset cursor. */
export const WALLET_LEDGER_ORDER: { column: string; ascending: boolean }[] = [
  { column: 'created_at', ascending: false },
  { column: 'id', ascending: false },
];

/** Rendered rows per page; the extra continuation probe stays under the usual PostgREST cap. */
export const WALLET_LEDGER_STATEMENT_PAGE_SIZE = 500;

async function fetchRetailerLedgerStatementPage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  retailerId: string,
  fromIso: string,
  toIso: string,
  cursor: ListCursor | null,
  order: KeysetColumn[]
): Promise<WalletStatementTransaction[]> {
  const query = supabase
    .from('retailer_wallet_ledger')
    .select('id, created_at, transaction_type, amount_paise, direction, description')
    .eq('retailer_id', retailerId)
    .gte('created_at', fromIso)
    .lte('created_at', toIso);
  const { data, error } = await applyCursor(
    applyKeysetOrder(query, order),
    cursor,
    order,
    WALLET_LEDGER_STATEMENT_PAGE_SIZE
  ).returns<WalletStatementTransaction[]>();
  if (error) throw error;
  return data ?? [];
}

/**
 * Stream every matching wallet row in stable newest-first order. SQL applies
 * owner/date predicates on each bounded request; the authenticated RLS session
 * is reused, and `(created_at, id)` is a unique cursor even for tied times.
 */
export function iterateRetailerLedgerStatement(
  supabase: Awaited<ReturnType<typeof createClient>>,
  retailerId: string,
  fromIso: string,
  toIso: string
): AsyncGenerator<WalletStatementTransaction> {
  const order: KeysetColumn[] = WALLET_LEDGER_ORDER.map((column) => ({
    column: column.column,
    ascending: column.ascending,
  }));
  return iterateKeysetPages(
    (cursor) => fetchRetailerLedgerStatementPage(supabase, retailerId, fromIso, toIso, cursor, order),
    order,
    WALLET_LEDGER_STATEMENT_PAGE_SIZE
  );
}

export async function getRetailerLedgerBatch(
  supabase: Awaited<ReturnType<typeof createClient>>,
  retailerId: string,
  cursor: ListCursor | null,
  pageSize: number = WALLET_LEDGER_BATCH_SIZE
): Promise<{ entries: WalletTransaction[]; nextCursor: string | null; total: number }> {
  const order: KeysetColumn[] = WALLET_LEDGER_ORDER.map((column) => ({
    column: column.column,
    ascending: column.ascending,
  }));
  const { data, count } = await applyCursor(
    applyKeysetOrder(
      supabase
        .from('retailer_wallet_ledger')
        .select('*', cursor === null ? { count: 'exact' } : {})
        .eq('retailer_id', retailerId),
      order
    ),
    cursor,
    order,
    pageSize
  ).returns<WalletTransaction[]>();
  const rows = data ?? [];
  const batch = toListBatch(rows, pageSize, (row) => keysetCursorFor(row, order));
  return { entries: batch.items, nextCursor: batch.nextCursor, total: count ?? rows.length };
}
