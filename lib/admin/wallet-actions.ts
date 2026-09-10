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
  await requirePermission('retailers.edit');
  const parsed = setLimitSchema.safeParse({
    retailerId,
    creditLimitRupees,
    reason,
    allowOverdue: options?.allowOverdue,
    overdueLimitRupees: options?.overdueLimitRupees,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };

  const supabase = createClient();
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
      error: `New limit ₹${creditLimitRupees.toFixed(2)} is below the current outstanding ₹${(outstandingPaise / 100).toFixed(
        2
      )}. Confirm the over-limit consequence to continue.`,
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
  return { success: true, message: `Credit limit set to ₹${creditLimitRupees.toFixed(2)}` };
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
  await requirePermission('retailers.edit');
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

  const supabase = createClient();
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
  await requirePermission('retailers.edit');
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

  const supabase = createClient();
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
  await requirePermission('retailers.edit');
  if (!reason || reason.trim().length < 5) return { error: 'Reason must be at least 5 characters.' };

  const supabase = createClient();
  const user = await supabase.auth.getUser();
  const userId = user.data.user?.id;
  if (!userId) return { error: 'Not authenticated.' };

  const { data: original, error: fetchError } = await supabase
    .from('retailer_wallet_ledger')
    .select('id, retailer_id, amount_paise, direction, transaction_type, is_reversed')
    .eq('id', transactionId)
    .eq('retailer_id', retailerId)
    .maybeSingle<{
      id: string;
      retailer_id: string;
      amount_paise: number;
      direction: string;
      transaction_type: string;
      is_reversed: boolean;
    }>();

  if (fetchError || !original) return { error: 'Transaction not found.' };
  if (original.is_reversed) return { error: 'Transaction already reversed.' };
  if (original.transaction_type === 'CREDIT_LIMIT_CHANGE') return { error: 'Credit limit changes cannot be reversed; set a new limit instead.' };

  // Create reversal entry with opposite direction
  const reversalDirection = original.direction === 'debit' ? 'credit' : 'debit';
  const reversalType = original.transaction_type === 'ORDER_DEBIT' ? 'ORDER_REVERSAL' : 'ADJUSTMENT';
  // Deterministic key: a retried reversal maps to the same key and the ledger's
  // unique idempotency_key constraint blocks a duplicate reversal entry.
  const key = `reversal:${transactionId}`;

  const { data: account } = await supabase
    .from('retailer_credit_accounts')
    .select('id')
    .eq('retailer_id', retailerId)
    .maybeSingle<{ id: string }>();

  const { error: insertError } = await supabase.from('retailer_wallet_ledger').insert({
    retailer_id: retailerId,
    account_id: account?.id ?? null,
    transaction_type: reversalType,
    amount_paise: original.amount_paise,
    direction: reversalDirection,
    reference_type: 'reversal',
    reference_id: original.id,
    description: `Reversal of ${original.transaction_type} ${original.id}`,
    reason,
    created_by: userId,
    notes: `Reverses transaction ${original.id}`,
    idempotency_key: key,
    metadata: {
      reversal_of: original.id,
      original_type: original.transaction_type,
    },
    reversal_of: original.id,
  } as never);

  if (insertError) {
    // A concurrent/retried reversal already created the entry with the same
    // deterministic key — treat as success rather than double-reversing.
    if (insertError.code === '23505') return { success: true, message: 'Transaction already reversed.' };
    return { error: insertError.message };
  }

  // Mark original as reversed
  await supabase
    .from('retailer_wallet_ledger')
    .update({ is_reversed: true, reversed_by: userId, reversed_at: new Date().toISOString() } as never)
    .eq('id', original.id);

  revalidatePath(`/admin/wallets/${retailerId}`);
  return { success: true, message: 'Transaction reversed.' };
}
