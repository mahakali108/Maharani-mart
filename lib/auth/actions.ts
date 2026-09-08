'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { homeForRole, type UserRole } from '@/lib/auth/roles';
import { normalizePhone } from '@/lib/utils/phone';

export type { AuthErrorCode, FormState } from '@/lib/auth/helpers';
import { isDuplicateSignup, mapSignInError, safeRedirectPath } from '@/lib/auth/helpers';
import type { FormState } from '@/lib/auth/helpers';

interface ProfileRoleRow {
  role: UserRole;
}

const loginSchema = z.object({
  email: z.string().email('Enter a valid email address.'),
  password: z.string().min(1, 'Password is required.'),
  redirect: z.string().optional(),
});

const loginWithPhoneSchema = z.object({
  phone: z.string().min(1, 'Enter your mobile number.'),
  password: z.string().min(1, 'Password is required.'),
  redirect: z.string().optional(),
});

const requestResetSchema = z.object({
  email: z.string().email('Enter a valid email address.'),
});

const resendConfirmationSchema = z.object({
  email: z.string().email('Enter a valid email address.'),
});

const updatePasswordSchema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters.'),
  confirmPassword: z.string().min(1, 'Please confirm your password.'),
});

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
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error || !data.user) {
    return mapSignInError(error, 'email');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', data.user.id)
    .single<ProfileRoleRow>();

  const role = profile?.role ?? 'retailer';
  redirect(safeRedirectPath(parsed.data.redirect) ?? homeForRole(role));
}

/**
 * Secure mobile-number + password login for retailers (and any role that
 * has a phone). Resolution is server-only via service-role client — no
 * auth data is exposed to the browser. Supports +91 / 0-prefix / spaced
 * formats via normalizePhone, canonical 10-digit storage.
 */
export async function loginWithPhoneAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginWithPhoneSchema.safeParse({
    phone: formData.get('phone'),
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

  const normalized = normalizePhone(parsed.data.phone);
  if (!normalized) {
    return { fieldErrors: { phone: 'Enter a valid 10-digit Indian mobile number.' } };
  }
  if (!parsed.data.password) {
    return { fieldErrors: { password: 'Password is required.' } };
  }

  // Generic error to avoid account enumeration — same for “phone not found”
  // and “wrong password”.
  const genericError: FormState = mapSignInError(null, 'mobile number');

  // NOTE: redirect() works by throwing a special NEXT_REDIRECT error, so
  // it must be called OUTSIDE the try/catch below — an earlier version
  // called it inside `try` and the `catch` swallowed the redirect and
  // returned `genericError` instead, which made EVERY phone login fail
  // with "Invalid mobile number or password" even with correct creds.
  let destination: string;
  try {
    const adminClient = createServiceRoleClient();

    // Server-only lookup: phone -> profile id -> auth email.
    // Service-role bypasses RLS, so anon cannot enumerate via PostgREST.
    const { data: profileByPhone, error: profileErr } = await adminClient
      .from('profiles')
      .select('id')
      .eq('phone', normalized)
      .maybeSingle<{ id: string }>();

    if (profileErr || !profileByPhone?.id) {
      return genericError;
    }

    const { data: userData, error: userErr } = await adminClient.auth.admin.getUserById(profileByPhone.id);
    const email = userData?.user?.email;
    if (userErr || !email) {
      return genericError;
    }

    const supabase = createClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password: parsed.data.password,
    });

    if (error || !data.user) {
      // A phone that resolves to a real account but whose email is
      // still unconfirmed gets the actionable recovery message; a
      // genuinely wrong password stays generic (no enumeration).
      return mapSignInError(error, 'mobile number');
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', data.user.id)
      .single<ProfileRoleRow>();

    const role = profile?.role ?? 'retailer';
    destination = safeRedirectPath(parsed.data.redirect) ?? homeForRole(role);
  } catch {
    return genericError;
  }
  redirect(destination);
}

export async function requestPasswordResetAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const parsed = requestResetSchema.safeParse({
    email: formData.get('email'),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      if (issue.path[0]) fieldErrors[String(issue.path[0])] = issue.message;
    }
    return { fieldErrors };
  }

  const supabase = createClient();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  // Use auth/callback?next=/reset-password so the recovery code is exchanged
  // server-side and the user lands on the reset form with an active session.
  const redirectTo = `${siteUrl.replace(/\/$/, '')}/auth/callback?next=/reset-password`;

  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo,
  });

  if (error) {
    // Avoid enumeration: Supabase already does not reveal if email exists,
    // but surface generic success anyway.
    return {
      success:
        "If an account exists for that email, you will receive a password reset link shortly. Please check your inbox and spam folder.",
    };
  }

  return {
    success:
      "If an account exists for that email, you will receive a password reset link shortly. Please check your inbox and spam folder.",
  };
}

/**
 * Re-sends the Supabase signup confirmation email. Used as the recovery
 * path when login fails with `email_not_confirmed` (the project has
 * "Confirm email" enabled and the user lost or never received the link).
 * Always returns a generic message so it can't be used to enumerate
 * which emails have accounts — except for rate limiting, which is
 * surfaced so the user knows to wait before retrying.
 */
export async function resendConfirmationAction(
  _prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const parsed = resendConfirmationSchema.safeParse({
    email: formData.get('email'),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      if (issue.path[0]) fieldErrors[String(issue.path[0])] = issue.message;
    }
    return { fieldErrors };
  }

  const supabase = createClient();
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '');

  const { error } = await supabase.auth.resend({
    type: 'signup',
    email: parsed.data.email,
    options: { emailRedirectTo: `${siteUrl}/auth/callback` },
  });

  if (error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('rate limit') || msg.includes('too many') || error.status === 429) {
      return {
        code: 'recovery_failed',
        error: 'Too many requests. Please wait a minute, then try again.',
      };
    }
    // Fall through to the generic success message (no enumeration).
  }

  return {
    success:
      'If an account exists for that email, a new confirmation link is on its way. Please check your inbox and spam folder.',
  };
}

export async function updatePasswordAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const parsed = updatePasswordSchema.safeParse({
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      if (issue.path[0]) fieldErrors[String(issue.path[0])] = issue.message;
    }
    return { fieldErrors };
  }
  if (parsed.data.password !== parsed.data.confirmPassword) {
    return { fieldErrors: { confirmPassword: 'Passwords do not match.' } };
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: 'Your reset link is invalid or has expired. Please request a new one.' };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    return { error: error.message };
  }

  // Send retailer to home, others to their home — re-use role lookup
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single<ProfileRoleRow>();
  const role = profile?.role ?? 'retailer';
  redirect(homeForRole(role));
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
    .transform((v) => normalizePhone(v) ?? v)
    .pipe(z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number.')),
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
    return {
      code: 'duplicate_phone',
      fieldErrors: { phone: 'This phone number is already registered.' },
    };
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
      return {
        code: 'duplicate_email',
        error: 'An account with this email already exists. Please log in instead.',
      };
    }
    if (signUpError.message.toLowerCase().includes('phone_already_registered')) {
      // Race condition: two submissions with the same phone number
      // landed on the DB trigger at almost the same instant, past the
      // rpc() check above.
      return {
        code: 'duplicate_phone',
        fieldErrors: { phone: 'This phone number is already registered.' },
      };
    }
    return { error: signUpError.message };
  }

  // When "Confirm email" is on, Supabase returns success (not an error)
  // for an already-registered email, with an obfuscated user whose
  // `identities` array is empty — catch it so we don't imply a second
  // account was created.
  if (isDuplicateSignup(signUpData.user)) {
    return {
      code: 'duplicate_email',
      error: 'An account with this email already exists. Please log in instead.',
    };
  }

  if (!signUpData.session) {
    // Email confirmation is enabled on this Supabase project. The
    // retailer row has already been created by the trigger above —
    // the user just needs to confirm their email before they can log
    // in and see the pending-approval screen. Rendered as success
    // (not an error) with a recovery path below the form.
    return {
      success: 'Account created. Please check your email to confirm your address, then log in.',
    };
  }

  redirect('/pending-approval');
}
