'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { rupeesToPaise } from '@/lib/retailer/wallet';

const setLimitSchema = z.object({
  retailerId: z.string().uuid(),
  creditLimitRupees: z.number().min(0).max(10000000),
  reason: z.string().min(5).max(500),
  allowOverdue: z.boolean().optional(),
  overdueLimitRupees: z.number().min(0).max(10000000).optional(),
});

const paymentSchema = z.object({
  retailerId: z.string().uuid(),
  amountRupees: z.number().min(0.01).max(10000000),
  paymentMethod: z.enum(['cash', 'bank_transfer', 'upi', 'cheque', 'other']),
  paymentDate: z.string().min(1),
  referenceNumber: z.string().max(100).optional(),
  notes: z.string().max(500).optional(),
  idempotencyKey: z.string().max(100).optional(),
});

const adjustmentSchema = z.object({
  retailerId: z.string().uuid(),
  amountRupees: z.number().min(0.01).max(10000000),
  direction: z.enum(['credit', 'debit']),
  transactionType: z.enum(['MANUAL_CREDIT', 'MANUAL_DEBIT', 'ADJUSTMENT', 'REFUND_CREDIT']),
  reason: z.string().min(5).max(500),
  notes: z.string().max(500).optional(),
  idempotencyKey: z.string().max(100).optional(),
});

export type WalletActionResult = { success: true; message?: string } | { error: string };

function generateIdempotencyKey(prefix: string, retailerId: string): string {
  return `${prefix}:${retailerId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

export async function setCreditLimitAction(
  retailerId: string,
  creditLimitRupees: number,
  reason: string,
  options?: { allowOverdue?: boolean; overdueLimitRupees?: number; confirmBelowOutstanding?: boolean }
): Promise<WalletActionResult> {
  await requirePermission('coins.manage');
  const parsed = setLimitSchema.safeParse({
    retailerId,
    creditLimitRupees,
    reason,
    allowOverdue: options?.allowOverdue,
    overdueLimitRupees: options?.overdueLimitRupees,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };

  const supabase = (await createClient());
  const user = await supabase.auth.getUser();
  const userId = user.data.user?.id;
  if (!userId) return { error: 'Not authenticated.' };

  const limitPaise = rupeesToPaise(creditLimitRupees);
  const overduePaise = rupeesToPaise(options?.overdueLimitRupees ?? 0);

  // Authoritative outstanding from the wallet RPC (falls back server-side).
  const { data: outstandingData } = await (
    supabase as unknown as { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown }> }
  ).rpc('get_retailer_outstanding_paise', {
    p_retailer_id: retailerId,
  });
  const outstandingPaise = Number(outstandingData ?? 0);

  // A limit reduction that pushes the account over-limit must never be applied
  // silently: it requires an explicit Admin confirmation of the consequence
  // (or an approved overdue policy).
  if (limitPaise < outstandingPaise && !options?.allowOverdue && !options?.confirmBelowOutstanding) {
    return {
      error: `Coin funding ₹${creditLimitRupees.toFixed(2)} is below the ₹${(outstandingPaise / 100).toFixed(
        2
      )} this shop has already spent. Confirm below the spent balance to continue.`,
    };
  }

  // Upsert credit account
  const { data: existing } = await supabase
    .from('retailer_credit_accounts')
    .select('id, credit_limit_paise')
    .eq('retailer_id', retailerId)
    .maybeSingle<{ id: string; credit_limit_paise: number }>();

  if (existing) {
    const { error } = await supabase
      .from('retailer_credit_accounts')
      .update({
        credit_limit_paise: limitPaise,
        allow_overdue: options?.allowOverdue ?? false,
        overdue_limit_paise: overduePaise,
        updated_by: userId,
        notes: reason,
      } as never)
      .eq('id', existing.id);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase.from('retailer_credit_accounts').insert({
      retailer_id: retailerId,
      credit_limit_paise: limitPaise,
      allow_overdue: options?.allowOverdue ?? false,
      overdue_limit_paise: overduePaise,
      created_by: userId,
      updated_by: userId,
      notes: reason,
    } as never);
    if (error) return { error: error.message };
  }

  revalidatePath(`/admin/retailers/${retailerId}`);
  revalidatePath(`/admin/wallets`);
  revalidatePath(`/admin/wallets/${retailerId}`);
  return { success: true, message: `Coin funding set to ₹${creditLimitRupees.toFixed(2)}` };
}

export async function recordPaymentAction(
  retailerId: string,
  amountRupees: number,
  paymentMethod: 'cash' | 'bank_transfer' | 'upi' | 'cheque' | 'other',
  paymentDate: string,
  referenceNumber?: string,
  notes?: string,
  idempotencyKey?: string
): Promise<WalletActionResult> {
  await requirePermission('coins.manage');
  const parsed = paymentSchema.safeParse({
    retailerId,
    amountRupees,
    paymentMethod,
    paymentDate,
    referenceNumber,
    notes,
    idempotencyKey,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid payment data.' };

  const supabase = (await createClient());
  const user = await supabase.auth.getUser();
  const userId = user.data.user?.id;
  if (!userId) return { error: 'Not authenticated.' };

  const amountPaise = rupeesToPaise(amountRupees);
  const key = idempotencyKey || generateIdempotencyKey('pay', retailerId);

  // Idempotency check
  const { data: existing } = await supabase
    .from('retailer_wallet_ledger')
    .select('id')
    .eq('idempotency_key', key)
    .maybeSingle<{ id: string }>();
  if (existing) return { error: 'Duplicate payment submission detected. This payment was already recorded.' };

  const { data: account } = await supabase
    .from('retailer_credit_accounts')
    .select('id')
    .eq('retailer_id', retailerId)
    .maybeSingle<{ id: string }>();

  const { error } = await supabase.from('retailer_wallet_ledger').insert({
    retailer_id: retailerId,
    account_id: account?.id ?? null,
    transaction_type: 'PAYMENT_CREDIT',
    amount_paise: amountPaise,
    direction: 'credit',
    reference_type: 'payment',
    description: `Payment received: ₹${amountRupees.toFixed(2)} via ${paymentMethod}`,
    reason: `Payment ${paymentMethod}${referenceNumber ? ` ref ${referenceNumber}` : ''}`,
    created_by: userId,
    notes: notes ?? null,
    idempotency_key: key,
    metadata: {
      payment_method: paymentMethod,
      payment_date: paymentDate,
      reference_number: referenceNumber ?? null,
    },
  } as never);

  if (error) {
    if (error.message.includes('duplicate') || error.code === '23505') {
      return { error: 'Duplicate payment — this transaction already exists.' };
    }
    return { error: error.message };
  }

  revalidatePath(`/admin/retailers/${retailerId}`);
  revalidatePath(`/admin/wallets`);
  revalidatePath(`/admin/wallets/${retailerId}`);
  revalidatePath(`/retailer/account/ledger`);
  return { success: true, message: `Payment of ₹${amountRupees.toFixed(2)} recorded.` };
}

export async function recordAdjustmentAction(
  retailerId: string,
  amountRupees: number,
  direction: 'credit' | 'debit',
  transactionType: 'MANUAL_CREDIT' | 'MANUAL_DEBIT' | 'ADJUSTMENT' | 'REFUND_CREDIT',
  reason: string,
  notes?: string,
  idempotencyKey?: string
): Promise<WalletActionResult> {
  await requirePermission('coins.manage');
  const parsed = adjustmentSchema.safeParse({
    retailerId,
    amountRupees,
    direction,
    transactionType,
    reason,
    notes,
    idempotencyKey,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid adjustment data.' };

  const supabase = (await createClient());
  const user = await supabase.auth.getUser();
  const userId = user.data.user?.id;
  if (!userId) return { error: 'Not authenticated.' };

  const amountPaise = rupeesToPaise(amountRupees);
  const key = idempotencyKey || generateIdempotencyKey('adj', retailerId);

  const { data: existing } = await supabase
    .from('retailer_wallet_ledger')
    .select('id')
    .eq('idempotency_key', key)
    .maybeSingle<{ id: string }>();
  if (existing) return { error: 'Duplicate adjustment detected.' };

  const { data: account } = await supabase
    .from('retailer_credit_accounts')
    .select('id')
    .eq('retailer_id', retailerId)
    .maybeSingle<{ id: string }>();

  const { error } = await supabase.from('retailer_wallet_ledger').insert({
    retailer_id: retailerId,
    account_id: account?.id ?? null,
    transaction_type: transactionType,
    amount_paise: amountPaise,
    direction,
    reference_type: 'adjustment',
    description: `${transactionType.replace(/_/g, ' ')}: ₹${amountRupees.toFixed(2)} — ${reason}`,
    reason,
    created_by: userId,
    notes: notes ?? null,
    idempotency_key: key,
    metadata: {
      adjustment_type: transactionType,
    },
  } as never);

  if (error) {
    if (error.code === '23505') return { error: 'Duplicate adjustment.' };
    return { error: error.message };
  }

  revalidatePath(`/admin/retailers/${retailerId}`);
  revalidatePath(`/admin/wallets`);
  revalidatePath(`/admin/wallets/${retailerId}`);
  return { success: true, message: `Adjustment of ₹${amountRupees.toFixed(2)} recorded.` };
}

export async function reverseTransactionAction(
  transactionId: string,
  retailerId: string,
  reason: string
): Promise<WalletActionResult> {
  await requirePermission('coins.manage');
  const normalizedReason = reason.trim();
  if (normalizedReason.length < 5 || normalizedReason.length > 500) {
    return { error: 'Reason must be 5 to 500 characters.' };
  }
  const supabase = await createClient();
  // One DB transaction locks the account and original, validates prior
  // history, and appends the compensating entry without flagging the original.
  // Order debits, payments, and refunds require their own reviewed workflows.
  const { error } = await supabase.rpc('reverse_manual_wallet_adjustment' as never, {
    p_retailer_id: retailerId,
    p_transaction_id: transactionId,
    p_reason: normalizedReason,
  } as never);
  if (error) return { error: 'Reversal could not be confirmed. Check the ledger and contact support before retrying.' };
  revalidatePath(`/admin/wallets/${retailerId}`);
  revalidatePath('/admin/wallets');
  revalidatePath('/retailer/account/ledger');
  return { success: true, message: 'Manual adjustment reversed.' };
}

const paymentTermsSchema = z.object({
  retailerId: z.string().uuid(),
  /** Net-N days; null clears the terms (returns to "not set"). */
  paymentTermsDays: z.number().int().min(0).max(365).nullable(),
  reason: z.string().min(5).max(500),
});

/**
 * Sets (or clears) a retailer's credit payment terms — Net-15 / Net-30 / …
 * Terms are metadata on the credit account (migration 0049); the due date is
 * derived in the app from the oldest still-outstanding ledger debit, so no
 * ledger row is ever rewritten. Admin-only (RLS 0029 + this guard).
 */
export async function setPaymentTermsAction(
  retailerId: string,
  paymentTermsDays: number | null,
  reason: string
): Promise<WalletActionResult> {
  // Same permission as setCreditLimitAction — the RLS write policy on the
  // credit account is is_admin_or_above(), so the app-level guard matches it
  // (staff cannot write credit terms, exactly like they cannot write limits).
  await requirePermission('coins.manage');
  const parsed = paymentTermsSchema.safeParse({ retailerId, paymentTermsDays, reason });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };

  const supabase = (await createClient());
  const { data: authData } = await supabase.auth.getUser();
  const userId = authData?.user?.id;
  if (!userId) return { error: 'Not authenticated.' };

  const { data: existing } = await supabase
    .from('retailer_credit_accounts')
    .select('id')
    .eq('retailer_id', retailerId)
    .maybeSingle<{ id: string }>();

  if (existing) {
    const { error } = await supabase
      .from('retailer_credit_accounts')
      .update({
        payment_terms_days: paymentTermsDays,
        updated_by: userId,
        notes: reason,
      } as never)
      .eq('id', existing.id);
    if (error) return { error: error.message };
  } else {
    // No credit account row yet (limit never set) — create a minimal one so
    // the terms still persist; the limit stays 0 until an admin sets it.
    const { error } = await supabase
      .from('retailer_credit_accounts')
      .insert({
        retailer_id: retailerId,
        credit_limit_paise: 0,
        payment_terms_days: paymentTermsDays,
        created_by: userId,
        updated_by: userId,
        notes: reason,
      } as never);
    if (error) return { error: error.message };
  }

  revalidatePath(`/admin/wallets/${retailerId}`);
  revalidatePath(`/admin/retailers/${retailerId}`);
  revalidatePath(`/retailer/account/ledger`);
  return {
    success: true,
    message:
      paymentTermsDays === null
        ? 'Payment terms cleared.'
        : `Payment terms set to Net ${paymentTermsDays} days.`,
  };
}
