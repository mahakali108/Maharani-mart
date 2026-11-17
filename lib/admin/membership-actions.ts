'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireSuperAdmin } from '@/lib/admin/control-center/guard';
import { recordSuperAdminAudit } from '@/lib/admin/super-admin-audit';
import { validateMembershipPlanConfigInput } from '@/lib/membership/rules';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type MembershipAdminActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

function revalidateMembershipPages() {
  revalidatePath('/admin/memberships');
  revalidatePath('/retailer/membership');
  revalidatePath('/admin/dashboard');
}

/**
 * Super Admin saves configuration for Free, Silver, or Gold plans.
 * Never activates plans while `membership_program_settings.program_enabled` is false
 * and never enables live payment collection.
 */
export async function updateMembershipPlanConfigAction(
  formData: FormData
): Promise<MembershipAdminActionResult> {
  const actor = await requireSuperAdmin();

  const allowedCategories = formData
    .getAll('allowedCategories')
    .map((v) => String(v))
    .filter(Boolean);

  const parsed = validateMembershipPlanConfigInput({
    id: String(formData.get('planId') ?? ''),
    name: String(formData.get('name') ?? ''),
    description: String(formData.get('description') ?? ''),
    priceRupees: Number(formData.get('priceRupees') ?? 0),
    durationDays: Number(formData.get('durationDays') ?? 365),
    productDiscountPercent: Number(formData.get('productDiscountPercent') ?? 0),
    orderValueDiscountPercent: Number(formData.get('orderValueDiscountPercent') ?? 0),
    minOrderValueRupees: Number(formData.get('minOrderValueRupees') ?? 0),
    maxDiscountRupees: Number(formData.get('maxDiscountRupees') ?? 5000),
    featuresText: String(formData.get('featuresText') ?? ''),
    requireApprovedRetailer: formData.get('requireApprovedRetailer') === 'on',
    allowedCategories: allowedCategories.length > 0 ? allowedCategories : ['general', 'silver', 'gold'],
    renewalMode: String(formData.get('renewalMode') ?? 'manual_owner_approval'),
  });
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from('membership_plans' as never)
    .update({
      name: parsed.value.name,
      description: parsed.value.description,
      price_paise: parsed.value.price_paise,
      duration_days: parsed.value.duration_days,
      discount_percent: parsed.value.discount_percent,
      product_discount_percent: parsed.value.product_discount_percent,
      order_value_discount_percent: parsed.value.order_value_discount_percent,
      min_order_value_paise: parsed.value.min_order_value_paise,
      max_discount_paise: parsed.value.max_discount_paise,
      features: parsed.value.features,
      eligibility_rules: parsed.value.eligibility_rules,
      expiry_behavior: 'immediate_stop',
      grace_period_days: 0,
      renewal_mode: parsed.value.renewal_mode,
      updated_at: new Date().toISOString(),
    } as never)
    .eq('id', parsed.value.id);

  if (error) return { ok: false, error: error.message };

  await recordSuperAdminAudit(supabase, {
    actorId: actor.id,
    actorRole: actor.role,
    action: 'MEMBERSHIP_PLAN_CONFIG_UPDATED',
    afterData: {
      plan_id: parsed.value.id,
      price_paise: parsed.value.price_paise,
      duration_days: parsed.value.duration_days,
      product_discount_percent: parsed.value.product_discount_percent,
      order_value_discount_percent: parsed.value.order_value_discount_percent,
      renewal_mode: parsed.value.renewal_mode,
      expiry_behavior: 'immediate_stop',
    },
    reason: `Updated ${parsed.value.name} configuration (inactive until owner approval)`,
  });

  revalidateMembershipPages();
  return {
    ok: true,
    message: `${parsed.value.name} configuration saved. Plan activation remains gated pending owner approval.`,
  };
}

/**
 * Updates program governance notes and owner approval metadata.
 * Live payment collection is permanently blocked at `false`.
 */
export async function updateMembershipProgramNotesAction(
  formData: FormData
): Promise<MembershipAdminActionResult> {
  const actor = await requireSuperAdmin();

  const notes = String(formData.get('notes') ?? '').trim().slice(0, 1000) || null;
  const supabase = await createClient();
  const { error } = await supabase
    .from('membership_program_settings' as never)
    .update({
      notes,
      updated_by: actor.id,
      updated_at: new Date().toISOString(),
    } as never)
    .eq('id', 1);

  if (error) return { ok: false, error: error.message };

  await recordSuperAdminAudit(supabase, {
    actorId: actor.id,
    actorRole: actor.role,
    action: 'MEMBERSHIP_PROGRAM_NOTES_UPDATED',
    afterData: { notes, program_enabled: false, live_payment_collection_enabled: false },
    reason: notes ?? 'Updated membership program governance notes',
  });

  revalidateMembershipPages();
  return { ok: true, message: 'Membership governance notes updated.' };
}

/**
 * Super Admin review of a retailer membership upgrade request (non-payment queue).
 */
export async function reviewMembershipUpgradeRequestAction(
  requestId: string,
  decision: 'approved_pending_launch' | 'rejected',
  reviewNote?: string
): Promise<MembershipAdminActionResult> {
  const actor = await requireSuperAdmin();
  if (!UUID_RE.test(requestId)) return { ok: false, error: 'Invalid upgrade request.' };

  const note = (reviewNote ?? '').trim().slice(0, 500) || null;
  if (decision === 'rejected' && (!note || note.length < 3)) {
    return { ok: false, error: 'Provide a rejection reason (at least 3 characters).' };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('membership_upgrade_requests' as never)
    .update({
      status: decision,
      review_note: note,
    } as never)
    .eq('id', requestId);
  if (error) return { ok: false, error: error.message };

  await recordSuperAdminAudit(supabase, {
    actorId: actor.id,
    actorRole: actor.role,
    action: decision === 'rejected' ? 'MEMBERSHIP_REQUEST_REJECTED' : 'MEMBERSHIP_REQUEST_APPROVED_PENDING_LAUNCH',
    afterData: { request_id: requestId, status: decision },
    reason: note ?? `Marked upgrade request ${decision}`,
  });

  revalidateMembershipPages();
  return { ok: true, message: 'Membership upgrade request updated.' };
}
