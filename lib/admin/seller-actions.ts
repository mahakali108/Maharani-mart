'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import {
  normalizeSellerInput,
  validateSellerInput,
  validateSellerReason,
} from '@/lib/admin/seller-validation';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SellerActionResult = { ok: true } | { ok: false; error: string };

function revalidateSellerPages(sellerId?: string) {
  revalidatePath('/admin/sellers');
  if (sellerId) revalidatePath(`/admin/sellers/${sellerId}`);
}

/**
 * Admin-created marketplace seller (V1: no seller self-registration — an owner
 * decision). Status always starts 'pending' and the review trigger (0062)
 * stamps every later transition with the actual reviewer.
 */
export async function createSellerAction(formData: FormData): Promise<SellerActionResult> {
  await requirePermission('sellers.manage');
  const input = normalizeSellerInput({
    businessName: formData.get('businessName'),
    gstin: formData.get('gstin'),
    pan: formData.get('pan'),
    contactName: formData.get('contactName'),
    phone: formData.get('phone'),
    email: formData.get('email'),
    addressLine: formData.get('addressLine'),
  });
  const errors = validateSellerInput(input);
  const first = Object.values(errors)[0];
  if (first) return { ok: false, error: first };

  const supabase = createClient();
  const { data, error } = await supabase
    .from('sellers' as never)
    .insert({
      business_name: input.businessName,
      gstin: input.gstin || null,
      pan: input.pan || null,
      contact_name: input.contactName || null,
      phone: input.phone || null,
      email: input.email || null,
      address_line: input.addressLine || null,
      status: 'pending',
    } as never)
    .select('id')
    .maybeSingle<{ id: string }>();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'The seller could not be created.' };

  revalidateSellerPages(data.id);
  return { ok: true };
}

/**
 * Review a pending seller: approve (→ 'active') or reject with reason.
 * Database boundary: `enforce_seller_status_transitions` (0062) allows
 * pending→active/rejected only and re-stamps reviewed_by = auth.uid().
 */
export async function reviewSellerAction(
  sellerId: string,
  decision: 'active' | 'rejected',
  reason?: string
): Promise<SellerActionResult> {
  const user = await requirePermission('sellers.review');
  if (!UUID_RE.test(sellerId)) return { ok: false, error: 'Invalid seller record.' };
  if (decision !== 'active' && decision !== 'rejected') {
    return { ok: false, error: 'Invalid review decision.' };
  }
  const trimmed = (reason ?? '').trim().slice(0, 500);
  if (decision === 'rejected' && trimmed.length < 3) {
    return { ok: false, error: 'Give a short reason for rejection (the seller may ask why).' };
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from('sellers' as never)
    .update({
      status: decision,
      rejection_reason: decision === 'rejected' ? trimmed : null,
    } as never)
    .eq('id', sellerId)
    .eq('status', 'pending')
    .select('id');
  if (error) return { ok: false, error: error.message };
  if (!data || (data as unknown[]).length === 0) {
    return { ok: false, error: 'Only a pending seller can be reviewed.' };
  }

  revalidateSellerPages(sellerId);
  return { ok: true };
}

/**
 * Suspend an ACTIVE seller (drain mode: 0068 deactivates their offers in the
 * same transaction; nothing is deleted and placed sub-orders continue).
 */
export async function suspendSellerAction(
  sellerId: string,
  reason: string
): Promise<SellerActionResult> {
  await requirePermission('sellers.review');
  if (!UUID_RE.test(sellerId)) return { ok: false, error: 'Invalid seller record.' };
  const reasonError = validateSellerReason(reason, 'suspension');
  if (reasonError) return { ok: false, error: reasonError };

  const supabase = createClient();
  const { data, error } = await supabase
    .from('sellers' as never)
    .update({
      status: 'suspended',
      suspension_reason: reason.trim().slice(0, 500),
    } as never)
    .eq('id', sellerId)
    .eq('status', 'active')
    .select('id');
  if (error) return { ok: false, error: error.message };
  if (!data || (data as unknown[]).length === 0) {
    return { ok: false, error: 'Only an active seller can be suspended.' };
  }

  revalidateSellerPages(sellerId);
  return { ok: true };
}

/**
 * Reinstate a suspended seller. Offers STAY deactivated after reinstatement —
 * each offer is reactivated as an explicit, separately reviewed decision.
 */
export async function reinstateSellerAction(sellerId: string): Promise<SellerActionResult> {
  await requirePermission('sellers.review');
  if (!UUID_RE.test(sellerId)) return { ok: false, error: 'Invalid seller record.' };

  const supabase = createClient();
  const { data, error } = await supabase
    .from('sellers' as never)
    .update({ status: 'active' } as never)
    .eq('id', sellerId)
    .eq('status', 'suspended')
    .select('id');
  if (error) return { ok: false, error: error.message };
  if (!data || (data as unknown[]).length === 0) {
    return { ok: false, error: 'Only a suspended seller can be reinstated.' };
  }

  revalidateSellerPages(sellerId);
  return { ok: true };
}

/**
 * Grant a profile access to a seller tenant (V1: one seller per profile —
 * `uq_seller_members_profile`). The profile must already have the `seller`
 * role; this action never creates accounts or logs anyone in.
 */
export async function addSellerMemberAction(
  sellerId: string,
  profileId: string,
  memberRole: 'owner' | 'member'
): Promise<SellerActionResult> {
  await requirePermission('sellers.manage');
  if (!UUID_RE.test(sellerId) || !UUID_RE.test(profileId)) {
    return { ok: false, error: 'Invalid seller or profile.' };
  }
  const role = memberRole === 'owner' ? 'owner' : 'member';

  const supabase = createClient();
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', profileId)
    .eq('role', 'seller')
    .maybeSingle<{ id: string; role: string }>();
  if (profileError) return { ok: false, error: profileError.message };
  if (!profile) return { ok: false, error: 'Only a profile with the seller role can be added.' };

  const { data, error } = await supabase
    .from('seller_members' as never)
    .insert({
      seller_id: sellerId,
      profile_id: profileId,
      member_role: role,
    } as never)
    .select('id')
    .maybeSingle<{ id: string }>();
  if (error) {
    if (error.code === '23505') {
      return { ok: false, error: 'This profile is already linked to a seller.' };
    }
    return { ok: false, error: error.message };
  }
  if (!data) return { ok: false, error: 'The membership could not be created.' };

  revalidateSellerPages(sellerId);
  return { ok: true };
}

export async function removeSellerMemberAction(
  sellerId: string,
  memberId: string
): Promise<SellerActionResult> {
  await requirePermission('sellers.manage');
  if (!UUID_RE.test(sellerId) || !UUID_RE.test(memberId)) {
    return { ok: false, error: 'Invalid seller or membership.' };
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from('seller_members' as never)
    .delete()
    .eq('id', memberId)
    .eq('seller_id', sellerId)
    .select('id');
  if (error) return { ok: false, error: error.message };
  if (!data || (data as unknown[]).length === 0) {
    return { ok: false, error: 'That membership no longer exists.' };
  }

  revalidateSellerPages(sellerId);
  return { ok: true };
}
