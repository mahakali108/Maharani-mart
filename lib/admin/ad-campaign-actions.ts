'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireSuperAdmin } from '@/lib/admin/control-center/guard';
import { requireActiveSeller } from '@/lib/seller/guard';
import { recordSuperAdminAudit } from '@/lib/admin/super-admin-audit';
import {
  AD_PAYMENT_STATUSES,
  mapAdCampaignDbError,
  validateAdCampaignProposalInput,
  validateAdProgramRulesInput,
  type AdPaymentStatus,
} from '@/lib/admin/ad-campaign-rules';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AdCampaignActionResult = { ok: true; message: string } | { ok: false; error: string };

function revalidateAdPages() {
  revalidatePath('/admin/banners/campaigns');
  revalidatePath('/admin/banners');
  revalidatePath('/seller/campaigns');
  revalidatePath('/admin/dashboard');
}

/**
 * Super Admin updates placement rules & slot caps.
 * Never enables paid seller ads or live payment collection without formal owner approval.
 */
export async function updateAdProgramRulesAction(
  formData: FormData
): Promise<AdCampaignActionResult> {
  const actor = await requireSuperAdmin();

  const allowedPlacements = formData
    .getAll('allowedPlacements')
    .map((v) => String(v))
    .filter(Boolean);

  const parsed = validateAdProgramRulesInput({
    maxActivePerPlacement: Number(formData.get('maxActivePerPlacement') ?? 3),
    allowedPlacements,
    notes: String(formData.get('notes') ?? ''),
  });
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from('ad_program_settings' as never)
    .update({
      max_active_campaigns_per_placement: parsed.value.max_active_campaigns_per_placement,
      allowed_placements: parsed.value.allowed_placements,
      notes: parsed.value.notes,
      updated_by: actor.id,
      updated_at: new Date().toISOString(),
    } as never)
    .eq('id', 1);

  if (error) return { ok: false, error: mapAdCampaignDbError(error.message) ?? error.message };

  await recordSuperAdminAudit(supabase, {
    actorId: actor.id,
    actorRole: actor.role,
    action: 'AD_PROGRAM_RULES_UPDATED',
    afterData: { ...parsed.value, seller_ads_enabled: false, live_payment_collection_enabled: false },
    reason: parsed.value.notes ?? 'Updated ad placement rules',
  });

  revalidateAdPages();
  return { ok: true, message: 'Ad program placement rules saved.' };
}

/**
 * Super Admin approves, rejects, pauses, or ends a seller advertisement campaign.
 * Approval/activation is blocked at the database boundary while `seller_ads_enabled = false`.
 */
export async function moderateSellerAdCampaignAction(
  campaignId: string,
  decision: 'approved' | 'rejected' | 'paused' | 'ended',
  reason?: string
): Promise<AdCampaignActionResult> {
  const actor = await requireSuperAdmin();
  if (!UUID_RE.test(campaignId)) return { ok: false, error: 'Invalid campaign.' };

  const cleanReason = (reason ?? '').trim().slice(0, 500) || null;
  if (decision === 'rejected' && (!cleanReason || cleanReason.length < 3)) {
    return { ok: false, error: 'Provide a rejection reason (at least 3 characters).' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('seller_ad_campaigns' as never)
    .update({
      approval_status: decision,
      is_active: decision === 'approved',
      rejection_reason: decision === 'rejected' ? cleanReason : null,
      reviewed_by: actor.id,
      reviewed_at: new Date().toISOString(),
    } as never)
    .eq('id', campaignId)
    .select('id, seller_id');

  if (error) return { ok: false, error: mapAdCampaignDbError(error.message) ?? error.message };
  if (!data || (data as unknown[]).length === 0) return { ok: false, error: 'Campaign not found.' };

  await recordSuperAdminAudit(supabase, {
    actorId: actor.id,
    actorRole: actor.role,
    action: `SELLER_AD_CAMPAIGN_${decision.toUpperCase()}`,
    afterData: { campaign_id: campaignId, approval_status: decision, is_active: decision === 'approved' },
    reason: cleanReason ?? `Campaign marked ${decision}`,
  });

  revalidateAdPages();
  return { ok: true, message: `Campaign marked ${decision}.` };
}

/**
 * Super Admin updates offline payment verification status for a seller campaign.
 * Live online payment collection is disabled; this tracks offline settlement references only.
 */
export async function updateSellerAdPaymentStatusAction(
  campaignId: string,
  paymentStatus: AdPaymentStatus,
  paymentReference?: string
): Promise<AdCampaignActionResult> {
  const actor = await requireSuperAdmin();
  if (!UUID_RE.test(campaignId)) return { ok: false, error: 'Invalid campaign.' };
  if (!AD_PAYMENT_STATUSES.includes(paymentStatus)) {
    return { ok: false, error: 'Invalid payment status.' };
  }

  const cleanRef = (paymentReference ?? '').trim().slice(0, 160) || null;
  const supabase = await createClient();
  const { error } = await supabase
    .from('seller_ad_campaigns' as never)
    .update({
      payment_status: paymentStatus,
      payment_reference: cleanRef,
    } as never)
    .eq('id', campaignId);

  if (error) return { ok: false, error: mapAdCampaignDbError(error.message) ?? error.message };

  await recordSuperAdminAudit(supabase, {
    actorId: actor.id,
    actorRole: actor.role,
    action: 'SELLER_AD_PAYMENT_STATUS_UPDATED',
    afterData: { campaign_id: campaignId, payment_status: paymentStatus, payment_reference: cleanRef },
    reason: 'Updated offline campaign payment tracking status',
  });

  revalidateAdPages();
  return { ok: true, message: 'Offline payment tracking status updated.' };
}

/**
 * Active seller submits an unapproved campaign proposal for Super Admin review.
 * Cannot self-approve, activate, or modify payment status (also enforced by DB trigger).
 */
export async function submitSellerAdCampaignAction(
  formData: FormData
): Promise<AdCampaignActionResult> {
  const { user, seller } = await requireActiveSeller();

  const parsed = validateAdCampaignProposalInput({
    title: String(formData.get('title') ?? ''),
    headline: String(formData.get('headline') ?? ''),
    artworkUrl: String(formData.get('artworkUrl') ?? ''),
    destinationUrl: String(formData.get('destinationUrl') ?? ''),
    placement: String(formData.get('placement') ?? 'homepage_strip'),
    startsAt: String(formData.get('startsAt') ?? ''),
    endsAt: String(formData.get('endsAt') ?? ''),
    budgetRupees: Number(formData.get('budgetRupees') ?? 0),
  });
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const supabase = await createClient();
  const { error } = await supabase.from('seller_ad_campaigns' as never).insert({
    seller_id: seller.id,
    title: parsed.value.title,
    headline: parsed.value.headline,
    artwork_url: parsed.value.artwork_url,
    destination_url: parsed.value.destination_url,
    placement: parsed.value.placement,
    starts_at: parsed.value.starts_at,
    ends_at: parsed.value.ends_at,
    budget_paise: parsed.value.budget_paise,
    payment_status: 'unpaid',
    approval_status: 'pending_approval',
    is_active: false,
    created_by: user.id,
  } as never);

  if (error) return { ok: false, error: mapAdCampaignDbError(error.message) ?? error.message };

  revalidateAdPages();
  return {
    ok: true,
    message: 'Campaign proposal submitted for Super Admin review. Paid ads remain inactive pending owner launch approval.',
  };
}

export async function pauseOwnSellerAdCampaignAction(
  campaignId: string
): Promise<AdCampaignActionResult> {
  const { seller } = await requireActiveSeller();
  if (!UUID_RE.test(campaignId)) return { ok: false, error: 'Invalid campaign.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('seller_ad_campaigns' as never)
    .update({ approval_status: 'paused', is_active: false } as never)
    .eq('id', campaignId)
    .eq('seller_id', seller.id);

  if (error) return { ok: false, error: mapAdCampaignDbError(error.message) ?? error.message };

  revalidateAdPages();
  return { ok: true, message: 'Campaign paused.' };
}
