'use server';

/**
 * Sales executive collection actions (Phase 4).
 *
 * A salesman records money collected in the field (`recordCollectionAction`).
 * The row starts `pending` and NEVER touches the wallet by itself — the
 * retailer's outstanding falls only when finance (admin) verifies it
 * (`verifyCollectionAction` in lib/admin/collections-actions.ts). This
 * verification queue is the real control: field cash is unconfirmed until a
 * back-office check matches it against bank/cash counts.
 *
 * Photo proof (cheque/UPI screenshot/receipt) is uploaded through the media
 * module as a PRIVATE `payment-proof` object (bucket payment-proofs, 0045)
 * and referenced by object path.
 */

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/permissions/permissions';
import { createClient } from '@/lib/supabase/server';
import { rupeesToPaise } from '@/lib/retailer/wallet';

export type CollectionActionResult = { error: string } | { success: true; message?: string };

export interface CollectionInput {
  retailerId: string;
  amountRupees: number;
  method: 'cash' | 'bank_transfer' | 'upi' | 'cheque' | 'other';
  referenceNumber?: string;
  notes?: string;
  proofUrl?: string | null;
  orderId?: string | null;
}

const METHODS = ['cash', 'bank_transfer', 'upi', 'cheque', 'other'] as const;
type CollectionMethod = (typeof METHODS)[number];

function isMethod(value: unknown): value is CollectionMethod {
  return typeof value === 'string' && (METHODS as readonly string[]).includes(value);
}

/**
 * A proof ref is valid only when it points INSIDE this retailer's folder in
 * the payment-proofs bucket (`payments/{retailerId}/…`) — a tampered client
 * must not be able to link another retailer's (or a foreign) object.
 */
function isValidPaymentProofRef(ref: string | null | undefined, retailerId: string): boolean {
  if (!ref || ref.trim() === '') return true;
  const value = ref.trim();
  return (
    value.startsWith(`payments/${retailerId}/`) &&
    value.length <= 300 &&
    !value.includes('..') &&
    !value.includes('://')
  );
}

/**
 * Record a field collection for a retailer ASSIGNED TO THE CALLING SALESMAN
 * (or any retailer, for admin/staff with `collections.record` — though the
 * normal admin path remains recordPaymentAction which credits immediately).
 */
export async function recordCollectionAction(input: CollectionInput): Promise<CollectionActionResult> {
  const user = await requireUser();
  if (!can(user.role, 'collections.record')) {
    return { error: 'You do not have permission to record collections.' };
  }

  const amountPaise = rupeesToPaise(input.amountRupees);
  if (!Number.isFinite(amountPaise) || amountPaise <= 0) {
    return { error: 'Enter a collection amount greater than zero.' };
  }
  if (!isMethod(input.method)) return { error: 'Choose a valid payment method.' };

  const reference = (input.referenceNumber ?? '').trim();
  if (reference.length > 100) return { error: 'Reference number must be 100 characters or fewer.' };
  const notes = (input.notes ?? '').trim();
  if (notes.length > 500) return { error: 'Notes must be 500 characters or fewer.' };
  if (!isValidPaymentProofRef(input.proofUrl, input.retailerId)) {
    return { error: 'Proof files must belong to this retailer — re-attach and try again.' };
  }

  const supabase = createClient();

  // Scope: a salesman may only collect for retailers assigned to them.
  // (RLS enforces this too — payment_collections_salesman_insert — this
  // check gives a friendly error instead of a raw policy denial.)
  const { data: retailer } = await supabase
    .from('retailers')
    .select('id, shop_name, assigned_salesman_id')
    .eq('id', input.retailerId)
    .maybeSingle<{ id: string; shop_name: string; assigned_salesman_id: string | null }>();
  if (!retailer) return { error: 'Retailer not found.' };
  if (user.role === 'salesman' && retailer.assigned_salesman_id !== user.id) {
    return { error: 'You can only record collections for retailers assigned to you.' };
  }

  // Optional order link must belong to the same retailer.
  if (input.orderId) {
    const { data: order } = await supabase
      .from('orders')
      .select('id')
      .eq('id', input.orderId)
      .eq('retailer_id', input.retailerId)
      .maybeSingle<{ id: string }>();
    if (!order) return { error: 'That order does not belong to this retailer.' };
  }

  const { error } = await supabase
    .from('payment_collections')
    .insert({
      retailer_id: input.retailerId,
      order_id: input.orderId ?? null,
      collected_by: user.id,
      amount_paise: amountPaise,
      method: input.method,
      reference_number: reference || null,
      proof_url: input.proofUrl?.trim() || null,
      notes: notes || null,
      status: 'pending',
    } as never);

  if (error) return { error: error.message };

  revalidatePath('/salesman/collections');
  revalidatePath(`/salesman/retailers/${input.retailerId}`);
  revalidatePath('/admin/collections');
  revalidatePath(`/admin/retailers/${input.retailerId}`);
  return {
    success: true,
    message: `Collection of ₹${(amountPaise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })} recorded for ${retailer.shop_name}. It will be credited once finance verifies it.`,
  };
}
