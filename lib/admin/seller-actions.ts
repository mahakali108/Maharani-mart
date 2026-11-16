'use server';

import { revalidatePath } from 'next/cache';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { recordSuperAdminAudit } from '@/lib/admin/super-admin-audit';
import {
  normalizeSellerInput,
  validateSellerInput,
  validateSellerReason,
} from '@/lib/admin/seller-validation';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SellerActionResult = { ok: true; message?: string; sellerId?: string } | { ok: false; error: string; sellerId?: string };

function revalidateSellerPages(sellerId?: string) {
  revalidatePath('/admin/sellers');
  if (sellerId) revalidatePath(`/admin/sellers/${sellerId}`);
}

/**
 * Super Admin reserves a pending business + one-use email invitation in a
 * single DB RPC, then calls Supabase Auth Admin from trusted server code.
 * The JWT role comes only from the Auth DB trigger consuming that invitation;
 * neither a browser role/tenant id nor client metadata is authoritative.
 */
export async function createSellerAction(formData: FormData): Promise<SellerActionResult> {
  const actor = await requirePermission('sellers.manage');
  if (actor.role !== 'super_admin') return { ok: false, error: 'Only Super Admin can invite sellers.' };
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
  if (!input.email || !input.contactName || !input.phone) {
    return { ok: false, error: 'Seller email, contact name and mobile number are required for an invitation.' };
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, error: 'Seller invitations are not configured on this server.' };
  }
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '');
  if (!siteUrl || !/^https:\/\/[^\s/]+$/.test(siteUrl) &&
      !(process.env.NODE_ENV !== 'production' && /^http:\/\/localhost:\d+$/.test(siteUrl))) {
    return { ok: false, error: 'Configure NEXT_PUBLIC_SITE_URL before inviting a seller.' };
  }

  const supabase = (await createClient());
  const { data, error } = await supabase.rpc('reserve_seller_invite' as never, {
    p_email: input.email,
    p_business_name: input.businessName,
    p_contact_name: input.contactName,
    p_phone: input.phone,
    p_gstin: input.gstin || null,
    p_pan: input.pan || null,
    p_address_line: input.addressLine || null,
  } as never);
  if (error) {
    if (error.code === '23505' || /already|duplicate/i.test(error.message)) {
      return { ok: false, error: 'This email or business is already registered or reserved. Check the seller directory before retrying.' };
    }
    return { ok: false, error: 'Seller invitation could not be reserved. No invitation was sent.' };
  }
  if (typeof data !== 'string' || !UUID_RE.test(data)) {
    return { ok: false, error: 'Seller reservation could not be verified. No invitation was sent.' };
  }

  revalidateSellerPages(data);
  const invited = await sendSellerInvite(data, siteUrl, supabase);
  return { ...invited, sellerId: data };
}

/** No returned secret, password, or auth token. Retrying is rate-limited by
 * claim_seller_invite_attempt (row lock + 2-minute cooldown + 3/day). */
async function sendSellerInvite(
  sellerId: string,
  siteUrl: string,
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<SellerActionResult> {
  const { data: claim, error: claimError } = await supabase.rpc(
    'claim_seller_invite_attempt' as never, { p_seller_id: sellerId } as never
  );
  const invitation = claim as unknown as { email?: string; nonce?: string } | null;
  if (claimError || !invitation || typeof invitation.email !== 'string'
      || typeof invitation.nonce !== 'string' || !/^[0-9a-f]{64}$/.test(invitation.nonce)) {
    return { ok: false, error: claimError?.message ?? 'This invitation is no longer available.' };
  }

  try {
    // Auth creates its own user and sends the *password-setup* invitation. The
    // trigger consumes the reserved email and assigns seller role/pending tenant.
    const { data: invited, error } = await createServiceRoleClient().auth.admin.inviteUserByEmail(invitation.email, {
      data: { seller_invite_nonce: invitation.nonce },
      redirectTo: `${siteUrl}/auth/callback?next=/reset-password`,
    });
    if (error || !invited?.user?.id) {
      if (/already registered|already exists/i.test(error?.message ?? '')) {
        return { ok: false, error: 'That email already has a login. The pending seller record was kept; verify the account before linking it.' };
      }
      return { ok: false, error: 'The pending seller was saved, but email invitation could not be confirmed. Check Auth email delivery before retrying.' };
    }
    // Confirm the Auth user was actually linked to THIS reservation by the
    // trusted insert trigger. A zero-row update is NOT an error in PostgREST:
    // it can signal a conflicting staff invite or an unverified Auth outcome.
    // The stamp is only feedback, never the authorization predicate.
    const { data: stamped, error: stampError } = await supabase
      .from('seller_account_invites' as never)
      .update({ invitation_sent_at: new Date().toISOString() } as never)
      .eq('seller_id', sellerId)
      .eq('auth_user_id', invited.user.id)
      .select('id')
      .maybeSingle();
    revalidateSellerPages(sellerId);
    if (stampError || !stamped) {
      return { ok: false, error: 'Auth accepted the email request, but the seller login could not be linked and verified. Check the Auth user and invitation record before approval; do not retry blindly.' };
    }
    return {
      ok: true,
      message: 'Invitation requested. The seller must set a password and Super Admin must verify and approve the pending account.',
    };
  } catch {
    return { ok: false, error: 'The pending seller was saved, but invitation delivery is unverified. Check Supabase Auth before retrying.' };
  }
}

export async function retrySellerInviteAction(sellerId: string): Promise<SellerActionResult> {
  const actor = await requirePermission('sellers.manage');
  if (actor.role !== 'super_admin' || !UUID_RE.test(sellerId)) {
    return { ok: false, error: 'Only Super Admin can retry an invitation.' };
  }
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '');
  if (!siteUrl || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, error: 'Auth invitation settings are not configured.' };
  }
  return sendSellerInvite(sellerId, siteUrl, (await createClient()));
}

export async function inviteExistingSellerAction(sellerId: string): Promise<SellerActionResult> {
  const actor = await requirePermission('sellers.manage');
  if (actor.role !== 'super_admin' || !UUID_RE.test(sellerId)) {
    return { ok: false, error: 'Only Super Admin can invite an existing seller.' };
  }
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '');
  if (!siteUrl || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, error: 'Auth invitation settings are not configured.' };
  }
  const supabase = (await createClient());
  const { data, error } = await supabase.rpc(
    'attach_existing_seller_invite' as never, { p_seller_id: sellerId } as never
  );
  if (error || data !== sellerId) {
    return { ok: false, error: 'This pending business could not be reserved for invitation. Check its email and membership.' };
  }
  const invited = await sendSellerInvite(sellerId, siteUrl, supabase);
  return { ...invited, sellerId };
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
  const actor = await requirePermission('sellers.review');
  if (!UUID_RE.test(sellerId)) return { ok: false, error: 'Invalid seller record.' };
  if (decision !== 'active' && decision !== 'rejected') {
    return { ok: false, error: 'Invalid review decision.' };
  }
  const trimmed = (reason ?? '').trim().slice(0, 500);
  if (decision === 'rejected' && trimmed.length < 3) {
    return { ok: false, error: 'Give a short reason for rejection (the seller may ask why).' };
  }

  const supabase = (await createClient());
  if (decision === 'active') {
    const { data: member, error: memberError } = await supabase
      .from('seller_members' as never)
      .select('profile_id')
      .eq('seller_id', sellerId)
      .limit(1);
    if (memberError || !member || member.length === 0) {
      return { ok: false, error: 'Link and verify a seller login before activating this business.' };
    }
  }
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

  await recordSuperAdminAudit(supabase, {
    actorId: actor.id,
    actorRole: actor.role,
    action: decision === 'active' ? 'SELLER_APPROVED' : 'SELLER_REJECTED',
    beforeData: { seller_id: sellerId, status: 'pending' },
    afterData: { seller_id: sellerId, status: decision },
    reason: decision === 'rejected' ? trimmed : 'Seller application approved',
  });

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
  const actor = await requirePermission('sellers.review');
  if (!UUID_RE.test(sellerId)) return { ok: false, error: 'Invalid seller record.' };
  const reasonError = validateSellerReason(reason, 'suspension');
  if (reasonError) return { ok: false, error: reasonError };

  const supabase = (await createClient());
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

  await recordSuperAdminAudit(supabase, {
    actorId: actor.id,
    actorRole: actor.role,
    action: 'SELLER_SUSPENDED',
    beforeData: { seller_id: sellerId, status: 'active' },
    afterData: { seller_id: sellerId, status: 'suspended' },
    reason: reason.trim().slice(0, 500),
  });

  revalidateSellerPages(sellerId);
  return { ok: true };
}

/**
 * Reinstate a suspended seller. Offers STAY deactivated after reinstatement —
 * each offer is reactivated as an explicit, separately reviewed decision.
 */
export async function reinstateSellerAction(sellerId: string): Promise<SellerActionResult> {
  const actor = await requirePermission('sellers.review');
  if (!UUID_RE.test(sellerId)) return { ok: false, error: 'Invalid seller record.' };

  const supabase = (await createClient());
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

  await recordSuperAdminAudit(supabase, {
    actorId: actor.id,
    actorRole: actor.role,
    action: 'SELLER_REINSTATED',
    beforeData: { seller_id: sellerId, status: 'suspended' },
    afterData: { seller_id: sellerId, status: 'active' },
    reason: 'Suspended seller reinstated',
  });

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

  const supabase = (await createClient());
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

  const supabase = (await createClient());
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
