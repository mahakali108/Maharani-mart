'use server';

/**
 * Admin collection verification actions (Phase 4).
 *
 * The payment_collections approval queue is the real meaning of
 * "verification": a pending collection is field cash that has NOT yet been
 * confirmed by finance. Verification:
 *   1. writes the PAYMENT_CREDIT row into retailer_wallet_ledger with the
 *      deterministic idempotency key `collection:<collectionId>` (retry-safe),
 *   2. links that ledger entry back via payment_collections.ledger_entry_id,
 *   3. flips the status to `verified`.
 * Rejection records the reason in notes and credits nothing.
 *
 * Admins recording payments directly still use recordPaymentAction
 * (lib/admin/wallet-actions.ts) — that path credits the wallet immediately
 * and is unaffected.
 */

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/permissions/permissions';
import { createClient } from '@/lib/supabase/server';

export type CollectionVerifyResult = { error: string } | { success: true; message?: string };

interface CollectionRow {
  id: string;
  retailer_id: string;
  amount_paise: number;
  method: string;
  status: string;
  ledger_entry_id: string | null;
}

async function fetchCollection(
  supabase: ReturnType<typeof createClient>,
  collectionId: string
): Promise<CollectionRow | { error: string }> {
  const { data } = await supabase
    .from('payment_collections')
    .select('id, retailer_id, amount_paise, method, status, ledger_entry_id')
    .eq('id', collectionId)
    .maybeSingle<CollectionRow>();
  if (!data) return { error: 'Collection not found.' };
  return data;
}

function revalidateCollectionPaths(retailerId: string) {
  revalidatePath('/admin/collections');
  revalidatePath(`/admin/retailers/${retailerId}`);
  revalidatePath('/retailer/account/ledger');
  revalidatePath('/retailer/ledger');
  revalidatePath('/salesman/collections');
}

/** Verify a pending collection and credit the retailer's wallet. */
export async function verifyCollectionAction(collectionId: string): Promise<CollectionVerifyResult> {
  const user = await requireUser();
  if (!can(user.role, 'collections.verify')) {
    return { error: 'Only finance/admin can verify collections.' };
  }

  const supabase = createClient();
  const found = await fetchCollection(supabase, collectionId);
  if ('error' in found) return { error: found.error };
  const collection = found;

  if (collection.status === 'verified') return { success: true, message: 'Already verified.' };
  if (collection.status !== 'pending') {
    return { error: `This collection was already ${collection.status}.` };
  }

  // 1. Credit the wallet — idempotent on `collection:<id>`.
  const { data: account } = await supabase
    .from('retailer_credit_accounts')
    .select('id')
    .eq('retailer_id', collection.retailer_id)
    .maybeSingle<{ id: string }>();

  const { data: ledgerEntry, error: ledgerError } = await supabase
    .from('retailer_wallet_ledger')
    .insert({
      retailer_id: collection.retailer_id,
      account_id: account?.id ?? null,
      transaction_type: 'PAYMENT_CREDIT',
      amount_paise: collection.amount_paise,
      direction: 'credit',
      reference_type: 'collection',
      reference_id: collection.id,
      description: `Collection verified: ₹${(collection.amount_paise / 100).toFixed(2)} via ${collection.method}`,
      reason: `Field collection (${collection.method}) verified by finance`,
      created_by: user.id,
      idempotency_key: `collection:${collection.id}`,
      metadata: { collection_id: collection.id },
    } as never)
    .select('id')
    .maybeSingle<{ id: string }>();

  if (ledgerError) {
    if (ledgerError.code === '23505') {
      // A retried verification with the same key — the credit already
      // exists; link it instead of failing.
      const { data: existing } = await supabase
        .from('retailer_wallet_ledger')
        .select('id')
        .eq('idempotency_key', `collection:${collection.id}`)
        .maybeSingle<{ id: string }>();
      if (existing) {
        const { data: relinked } = await supabase
          .from('payment_collections')
          .update({
            status: 'verified',
            verified_by: user.id,
            verified_at: new Date().toISOString(),
            ledger_entry_id: existing.id,
          } as never)
          .eq('id', collection.id)
          .eq('status', 'pending')
          .select('id')
          .maybeSingle<{ id: string }>();
        if (relinked) {
          revalidateCollectionPaths(collection.retailer_id);
          return { success: true, message: 'Collection verified (existing credit linked).' };
        }
        return { error: 'This collection changed while verifying — refresh and try again.' };
      }
    }
    return { error: ledgerError.message };
  }

  // 2. Flip the collection to verified and link the ledger entry. The
  // .eq('status','pending') guard makes a double-click verify impossible;
  // the returned row proves the claim landed.
  const { data: claimed, error: updateError } = await supabase
    .from('payment_collections')
    .update({
      status: 'verified',
      verified_by: user.id,
      verified_at: new Date().toISOString(),
      ledger_entry_id: ledgerEntry?.id ?? null,
    } as never)
    .eq('id', collection.id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle<{ id: string }>();
  if (updateError) return { error: updateError.message };
  if (!claimed) return { error: 'This collection was verified or rejected concurrently — refresh the queue.' };

  revalidateCollectionPaths(collection.retailer_id);
  return {
    success: true,
    message: `Collection verified — ₹${(collection.amount_paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })} credited to the retailer's wallet.`,
  };
}

/** Reject a pending collection (nothing is credited). */
export async function rejectCollectionAction(collectionId: string, reason: string): Promise<CollectionVerifyResult> {
  const user = await requireUser();
  if (!can(user.role, 'collections.verify')) {
    return { error: 'Only finance/admin can reject collections.' };
  }

  const trimmed = (reason ?? '').trim();
  if (trimmed.length < 3 || trimmed.length > 500) {
    return { error: 'Provide a rejection reason of 3–500 characters.' };
  }

  const supabase = createClient();
  const found = await fetchCollection(supabase, collectionId);
  if ('error' in found) return { error: found.error };
  const collection = found;

  if (collection.status !== 'pending') {
    return { error: `This collection was already ${collection.status}.` };
  }

  const { data: claimed, error } = await supabase
    .from('payment_collections')
    .update({
      status: 'rejected',
      verified_by: user.id,
      verified_at: new Date().toISOString(),
      notes: `REJECTED: ${trimmed}`,
    } as never)
    .eq('id', collection.id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle<{ id: string }>();
  if (error) return { error: error.message };
  if (!claimed) return { error: 'This collection was already handled — refresh the queue.' };

  revalidateCollectionPaths(collection.retailer_id);
  return { success: true, message: 'Collection rejected — nothing was credited.' };
}
