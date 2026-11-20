'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';

/**
 * EXPLICIT RETAILER ACTIVATION — the step that makes an approval real.
 *
 * `admin_review_retailer_application` (0081, rewired by 0110 block 10) grants the
 * retailer ROLE and `retailers.status = 'active'`, but it deliberately does not
 * touch `profiles.is_active`. An account that migration 0110 deactivated
 * therefore stays unable to sign in after approval — an approval that silently
 * does nothing.
 *
 * This action performs the missing step, and only that step:
 *   * Super Admin only, checked here AND inside `admin_activate_retailer`, which
 *     is service-role-only and refuses anon/authenticated;
 *   * a written reason is required;
 *   * the operator must confirm, and the confirmation text is a literal so a
 *     stray call cannot activate an account;
 *   * seller-only accounts are refused by the database and never converted;
 *   * a later Owner/Admin suspension is preserved — the database refuses;
 *   * the whole thing is audited with before/after state.
 *
 * The browser never sends an actor, a role, or a target `is_active` value.
 */

type ActionResult = { error?: string; success?: string; activationRequired?: boolean };

const schema = z.object({
  retailerId: z.string().uuid(),
  reason: z.string().trim().min(8, 'Enter a reason of at least 8 characters.').max(500),
  confirmation: z.literal('ACTIVATE', {
    errorMap: () => ({ message: 'Type ACTIVATE to confirm.' }),
  }),
});

function revalidate(id: string) {
  revalidatePath('/admin/retailers');
  revalidatePath(`/admin/retailers/${id}`);
  revalidatePath('/admin/retailer-applications');
  revalidatePath('/admin/control-center');
}

export async function adminActivateRetailerAction(formData: FormData): Promise<ActionResult> {
  // Activation is an access grant, so it is restricted to the highest role. An
  // `admin` may approve an application; only a Super Admin may hand back a login.
  const user = await requireUser();
  if (user.role !== 'super_admin') {
    return { error: 'Only a Super Admin can activate an account.' };
  }

  const parsed = schema.safeParse({
    retailerId: formData.get('retailerId'),
    reason: formData.get('reason'),
    confirmation: formData.get('confirmation'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the activation details.' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    'admin_activate_retailer' as never,
    {
      p_profile_id: parsed.data.retailerId,
      p_reason: parsed.data.reason,
      p_confirmation: parsed.data.confirmation,
    } as never
  );

  if (error) return { error: error.message };

  const result = (data ?? {}) as { changed?: boolean; is_active?: boolean; reason?: string };
  revalidate(parsed.data.retailerId);

  if (result.changed === false) {
    // Idempotent, and honest about it rather than reporting a fresh grant.
    return { success: 'No change: the account was already active or already activated.' };
  }
  return { success: 'Account activated. The retailer can now sign in and place orders.' };
}

/**
 * Reads the activation state for one account. Used by the Super Admin screen to
 * TELL the operator that approval alone is not enough. Returns null for a
 * non-Super-Admin caller instead of throwing, so a page cannot leak the state.
 */
export async function getRetailerActivationStatus(retailerId: string): Promise<{
  is_active: boolean;
  role: string | null;
  retailer_status: string | null;
  can_sign_in: boolean;
  deactivated_by_migration: boolean;
  suspended_after_migration: boolean;
  can_activate: boolean;
  reason: string;
} | null> {
  const user = await requireUser();
  if (user.role !== 'super_admin') return null;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    'admin_retailer_activation_status' as never,
    { p_profile_id: retailerId } as never
  );
  if (error) return null;
  return data as never;
}
