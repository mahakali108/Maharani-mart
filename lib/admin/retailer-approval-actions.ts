'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requirePermission } from '@/lib/admin/guard';
import { createClient } from '@/lib/supabase/server';

/**
 * Retailer approval + pricing-category server actions (migration 0081).
 *
 * Every action here is a thin, validated wrapper around a SECURITY DEFINER
 * RPC that re-checks the caller's role inside Postgres and writes the audit
 * trail. The browser never sends an actor id, a previous value or a target
 * status; the database derives those. A retailer cannot call any of these
 * successfully even if they reach the endpoint directly.
 */

type ActionResult = { error?: string; success?: string };

const categorySchema = z.enum(['general', 'silver', 'gold']);
const reasonSchema = z.string().trim().min(3, 'Enter a reason of at least 3 characters.').max(500);

function revalidateRetailerSurfaces(retailerId?: string) {
  revalidatePath('/admin/retailer-applications');
  revalidatePath('/admin/retailers');
  revalidatePath('/admin/control-center');
  revalidatePath('/admin/pricing/tiers');
  if (retailerId) revalidatePath(`/admin/retailers/${retailerId}`);
}

export async function adminReviewApplicationAction(formData: FormData): Promise<ActionResult> {
  await requirePermission('retailers.approve');

  const parsed = z
    .object({
      retailerId: z.string().uuid(),
      decision: z.enum(['approved', 'rejected']),
      reason: reasonSchema,
      category: categorySchema.optional().or(z.literal('')),
    })
    .safeParse({
      retailerId: formData.get('retailerId'),
      decision: formData.get('decision'),
      reason: formData.get('reason'),
      category: formData.get('category') ?? '',
    });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the review details.' };
  }

  const supabase = (await createClient());
  const { error } = await supabase.rpc('admin_review_retailer_application' as never, {
    p_retailer_id: parsed.data.retailerId,
    p_decision: parsed.data.decision,
    p_reason: parsed.data.reason,
    p_category: parsed.data.category || null,
  } as never);

  if (error) return { error: error.message };

  revalidateRetailerSurfaces(parsed.data.retailerId);
  return {
    success:
      parsed.data.decision === 'approved'
        ? 'Application approved. The retailer can now sign in with their approved pricing category.'
        : 'Application rejected. The reason was recorded in the audit trail.',
  };
}

export async function adminSetRetailerCategoryAction(formData: FormData): Promise<ActionResult> {
  await requirePermission('pricing.manage');

  const parsed = z
    .object({ retailerId: z.string().uuid(), category: categorySchema, reason: reasonSchema })
    .safeParse({
      retailerId: formData.get('retailerId'),
      category: formData.get('category'),
      reason: formData.get('reason'),
    });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the category details.' };
  }

  const supabase = (await createClient());
  const { error } = await supabase.rpc('admin_set_retailer_category' as never, {
    p_retailer_id: parsed.data.retailerId,
    p_category: parsed.data.category,
    p_reason: parsed.data.reason,
  } as never);
  if (error) return { error: error.message };

  revalidateRetailerSurfaces(parsed.data.retailerId);
  return { success: 'Retailer pricing category updated and audit-logged.' };
}

export async function adminSetRetailerAccessAction(formData: FormData): Promise<ActionResult> {
  await requirePermission('retailers.suspend');

  const parsed = z
    .object({
      retailerId: z.string().uuid(),
      action: z.enum(['suspend', 'restore']),
      reason: reasonSchema,
    })
    .safeParse({
      retailerId: formData.get('retailerId'),
      action: formData.get('action'),
      reason: formData.get('reason'),
    });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the access details.' };
  }

  const supabase = (await createClient());
  const { error } = await supabase.rpc('admin_set_retailer_access' as never, {
    p_retailer_id: parsed.data.retailerId,
    p_action: parsed.data.action,
    p_reason: parsed.data.reason,
  } as never);
  if (error) return { error: error.message };

  revalidateRetailerSurfaces(parsed.data.retailerId);
  return { success: parsed.data.action === 'suspend' ? 'Retailer access suspended.' : 'Retailer access restored.' };
}

export async function adminUpdateApprovalSettingsAction(formData: FormData): Promise<ActionResult> {
  // Review-target configuration is a Super Admin capability.
  await requirePermission('command_center.view');

  const parsed = z
    .object({
      reviewTargetHours: z.coerce.number().int().min(1).max(720),
      reminderHours: z.coerce.number().int().min(1).max(720),
    })
    .safeParse({
      reviewTargetHours: formData.get('reviewTargetHours'),
      reminderHours: formData.get('reminderHours'),
    });
  if (!parsed.success) return { error: 'Enter whole hours between 1 and 720.' };

  const supabase = (await createClient());
  const { error } = await supabase.rpc('admin_update_approval_settings' as never, {
    p_review_target_hours: parsed.data.reviewTargetHours,
    p_reminder_hours: parsed.data.reminderHours,
  } as never);
  if (error) return { error: error.message };

  revalidatePath('/admin/retailer-applications');
  return { success: 'Review target and reminder interval updated.' };
}
