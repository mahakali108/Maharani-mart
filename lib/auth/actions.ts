'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { homeForRole, type UserRole } from '@/lib/auth/roles';

export type FormState = {
  error?: string;
  fieldErrors?: Record<string, string>;
} | null;

interface ProfileRoleRow {
  role: UserRole;
}

const loginSchema = z.object({
  email: z.string().email('Enter a valid email address.'),
  password: z.string().min(1, 'Password is required.'),
  redirect: z.string().optional(),
});

/**
 * Only allow redirecting back to a same-site path. The login form
 * renders whatever came in on the `?redirect=` query param (set by
 * middleware.ts when it bounces an unauthenticated visit) into a
 * hidden field, so this must be treated as untrusted input — reject
 * anything that isn't an internal, single-leading-slash path to avoid
 * an open redirect.
 */
function safeRedirectPath(path: string | undefined): string | null {
  if (!path) return null;
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('://')) return null;
  return path;
}

export async function loginAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    redirect: formData.get('redirect') || undefined,
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      if (issue.path[0]) fieldErrors[String(issue.path[0])] = issue.message;
    }
    return { fieldErrors };
  }

  const supabase = createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return { error: 'Invalid email or password. Please try again.' };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', data.user.id)
    .single<ProfileRoleRow>();

  const role = profile?.role ?? 'retailer';
  redirect(safeRedirectPath(parsed.data.redirect) ?? homeForRole(role));
}

export async function logoutAction() {
  const supabase = createClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/login');
}

const registerRetailerSchema = z.object({
  fullName: z.string().min(2, 'Enter your full name.'),
  shopName: z.string().min(2, 'Enter your shop / firm name.'),
  phone: z
    .string()
    .regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number.'),
  email: z.string().email('Enter a valid email address.'),
  areaId: z.string().uuid('Select your area.'),
  address: z.string().min(5, 'Enter your shop address.'),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
});

export async function registerRetailerAction(
  _prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const parsed = registerRetailerSchema.safeParse({
    fullName: formData.get('fullName'),
    shopName: formData.get('shopName'),
    phone: formData.get('phone'),
    email: formData.get('email'),
    areaId: formData.get('areaId'),
    address: formData.get('address'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      if (issue.path[0]) fieldErrors[String(issue.path[0])] = issue.message;
    }
    return { fieldErrors };
  }

  const { fullName, shopName, phone, email, areaId, address, password } = parsed.data;
  const supabase = createClient();

  // Proactive check so the common case (retrying registration, two
  // shops sharing a landline, testing the form twice) shows a normal
  // field error instead of reaching signUp() and failing inside the
  // handle_new_user() DB trigger — see
  // supabase/migrations/0012_fix_registration_phone_conflict.sql for
  // why that path used to silently prevent the account (and every
  // other field) from being created at all.
  const { data: phoneTaken } = await supabase.rpc('is_phone_registered' as never, { p_phone: phone } as never);
  if (phoneTaken) {
    return { fieldErrors: { phone: 'This phone number is already registered.' } };
  }

  // Create the auth user. A DB trigger (handle_new_user, see
  // supabase/migrations/0002_auth_trigger.sql, extended in
  // 0011_fix_retailer_row_creation.sql) creates BOTH the matching
  // `profiles` row AND the `retailers` row from this metadata,
  // atomically, inside the same trigger. This deliberately does NOT
  // depend on signUp() returning an active session — if "Confirm
  // email" is enabled on this Supabase project, session is null until
  // the user confirms, but the trigger still fires immediately on the
  // auth.users insert either way, so the retailer row is never lost.
  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        role: 'retailer',
        full_name: fullName,
        phone,
        shop_name: shopName,
        area_id: areaId,
        address,
      },
    },
  });

  if (signUpError) {
    if (signUpError.message.toLowerCase().includes('already registered')) {
      return { error: 'An account with this email already exists. Please log in instead.' };
    }
    if (signUpError.message.toLowerCase().includes('phone_already_registered')) {
      // Race condition: two submissions with the same phone number
      // landed on the DB trigger at almost the same instant, past the
      // rpc() check above.
      return { fieldErrors: { phone: 'This phone number is already registered.' } };
    }
    return { error: signUpError.message };
  }

  if (!signUpData.session) {
    // Email confirmation is enabled on this Supabase project. The
    // retailer row has already been created by the trigger above —
    // the user just needs to confirm their email before they can log
    // in and see the pending-approval screen.
    return {
      error: 'Account created. Please check your email to confirm your address, then log in.',
    };
  }

  redirect('/pending-approval');
}
