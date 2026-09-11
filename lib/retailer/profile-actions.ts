'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { requirePermission } from '@/lib/admin/guard';
import { logoutAction } from '@/lib/auth/actions';

export type ProfileActionResult = { error?: string; successMessage?: string };

const shopProfileSchema = z.object({
  shopName: z.string().trim().min(2, 'Shop name must be at least 2 characters.').max(120),
  address: z.string().trim().max(500, 'Address must be at most 500 characters.').optional(),
});

const contactSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name.').max(120),
  phone: z
    .string()
    .trim()
    .min(10, 'Enter a valid 10-digit mobile number.')
    .max(15, 'Enter a valid phone number.')
    .regex(/^[0-9+\-\s]+$/, 'Phone can contain digits, spaces, + and - only.'),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters.'),
  confirmPassword: z.string().min(1, 'Confirm the new password.'),
});

const prefsSchema = z.object({
  orderUpdates: z.boolean(),
  paymentUpdates: z.boolean(),
  walletUpdates: z.boolean(),
  offerUpdates: z.boolean(),
});

/**
 * Shop profile self-service (shop name + shop address). Delegates to the
 * 0035 SECURITY DEFINER RPC, which is the ONLY retailer-writable path into
 * `retailers` — credit limit, outstanding, status, area and approval fields
 * are structurally unreachable.
 */
export async function updateShopProfileAction(_prev: ProfileActionResult, formData: FormData): Promise<ProfileActionResult> {
  const user = await requirePermission('orders.create');
  if (user.role !== 'retailer') return { error: 'Only a retailer can edit the shop profile.' };

  const parsed = shopProfileSchema.safeParse({
    shopName: formData.get('shopName'),
    address: formData.get('address') ?? '',
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Please check the details.' };
  }

  const supabase = createClient();
  // Same raw-rpc pattern as the wallet accessors (client is created without
  // the Database generic, so typed .rpc() overloads resolve to never).
  const { error } = await (
    supabase as unknown as { rpc: (name: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }> }
  ).rpc('update_my_shop_profile', {
    p_shop_name: parsed.data.shopName,
    p_address: parsed.data.address ?? '',
  });
  if (error) return { error: error.message };

  revalidatePath('/retailer/account');
  revalidatePath('/retailer/account/edit');
  revalidatePath('/retailer/checkout');
  return { successMessage: 'Shop profile updated.' };
}

/**
 * Owner contact details (full name + phone). `profiles_self_update` RLS
 * already lets a user update their own row; this action validates shape and
 * keeps the change auditable through the profile page revalidation.
 */
export async function updateContactDetailsAction(_prev: ProfileActionResult, formData: FormData): Promise<ProfileActionResult> {
  const user = await requirePermission('orders.create');
  if (user.role !== 'retailer') return { error: 'Only a retailer can edit contact details.' };

  const parsed = contactSchema.safeParse({ fullName: formData.get('fullName'), phone: formData.get('phone') });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Please check the details.' };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from('profiles')
    .update({ full_name: parsed.data.fullName, phone: parsed.data.phone } as unknown as never)
    .eq('id', user.id);
  if (error) return { error: error.message };

  revalidatePath('/retailer/account');
  revalidatePath('/retailer/account/edit');
  return { successMessage: 'Contact details updated.' };
}

/**
 * Change password with re-authentication: the current password is verified
 * by signing in with it before the update, so a stolen session alone cannot
 * rotate the password. Mirrors updatePasswordAction's zod rules.
 */
export async function changePasswordAction(_prev: ProfileActionResult, formData: FormData): Promise<ProfileActionResult> {
  const user = await requireUser();

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get('currentPassword'),
    newPassword: formData.get('newPassword'),
    confirmPassword: formData.get('confirmPassword'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Please check the details.' };
  }
  if (parsed.data.newPassword !== parsed.data.confirmPassword) {
    return { error: 'New passwords do not match.' };
  }

  const supabase = createClient();
  const email = user.email;
  if (!email) return { error: 'Your account has no sign-in email; contact support to change the password.' };

  // Re-verify the current credential.
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password: parsed.data.currentPassword,
  });
  if (signInError) return { error: 'Your current password is not correct.' };

  const { error: updateError } = await supabase.auth.updateUser({ password: parsed.data.newPassword });
  if (updateError) return { error: updateError.message };

  revalidatePath('/retailer/account/security');
  return { successMessage: 'Password changed. Use the new password at your next sign-in.' };
}

/**
 * Signs out EVERY session for this account (all devices). Supabase global
 * scope also revokes the refresh tokens server-side.
 */
export async function logoutAllSessionsAction(): Promise<void> {
  const supabase = createClient();
  await supabase.auth.signOut({ scope: 'global' });
  revalidatePath('/', 'layout');
  const { redirect } = await import('next/navigation');
  redirect('/login');
}

export interface NotificationPrefs {
  orderUpdates: boolean;
  paymentUpdates: boolean;
  walletUpdates: boolean;
  offerUpdates: boolean;
}

export async function saveNotificationPrefsAction(_prev: ProfileActionResult, formData: FormData): Promise<ProfileActionResult> {
  const user = await requirePermission('orders.create');
  if (user.role !== 'retailer') return { error: 'Only a retailer can change notification settings.' };

  const parsed = prefsSchema.safeParse({
    orderUpdates: formData.get('orderUpdates') === 'on',
    paymentUpdates: formData.get('paymentUpdates') === 'on',
    walletUpdates: formData.get('walletUpdates') === 'on',
    offerUpdates: formData.get('offerUpdates') === 'on',
  });
  if (!parsed.success) return { error: 'Please check the settings.' };

  const supabase = createClient();
  const { error } = await supabase.from('retailer_notification_prefs').upsert({
    retailer_id: user.id,
    ...parsed.data,
    updated_at: new Date().toISOString(),
  } as unknown as never);
  if (error) return { error: error.message };

  revalidatePath('/retailer/account/notification-preferences');
  return { successMessage: 'Notification settings saved.' };
}

/**
 * Records an account-level request (deletion or data export) for staff
 * review and notifies staff. Requests are NEVER self-executed: account
 * deletion stays a human decision on the admin side, exactly like retailer
 * approval. A submitted request does not change access.
 */
export async function requestAccountActionAction(
  requestType: 'account_deletion' | 'data_export',
  note: string
): Promise<ProfileActionResult> {
  const user = await requirePermission('orders.create');
  if (user.role !== 'retailer') return { error: 'Only a retailer can submit this request.' };
  if (!['account_deletion', 'data_export'].includes(requestType)) return { error: 'Unknown request type.' };
  const trimmedNote = note.trim().slice(0, 500);

  const supabase = createClient();
  const { error } = await supabase.from('retailer_account_requests').insert({
    retailer_id: user.id,
    request_type: requestType,
    note: trimmedNote || null,
  } as unknown as never);
  if (error) return { error: error.message };

  // Notify staff for review (same broadcast pattern as return requests).
  const { createInAppNotification } = await import('@/lib/notifications/notify');
  const { data: staffProfiles } = await supabase
    .from('profiles')
    .select('id')
    .in('role', ['staff', 'admin', 'super_admin'])
    .eq('is_active', true)
    .returns<{ id: string }[]>();
  const label = requestType === 'account_deletion' ? 'account deletion' : 'account data export';
  for (const staff of staffProfiles ?? []) {
    try {
      await createInAppNotification({
        recipientId: staff.id,
        title: `Retailer ${label} request`,
        body: `${user.fullName} submitted a ${label} request.${trimmedNote ? ` Note: ${trimmedNote}` : ''}`,
        linkUrl: '/admin/retailers',
      });
    } catch (error) {
      console.error('Request recorded but staff notification failed.', error);
    }
  }

  revalidatePath('/retailer/account/security');
  return { successMessage: 'Your request was submitted. The team will contact you shortly.' };
}

/** Kept for parity with the header logout (single-device). */
export async function logoutThisDeviceAction(): Promise<void> {
  await logoutAction();
}
