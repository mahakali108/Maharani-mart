'use server';

import { z } from 'zod';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { homeForRole, type UserRole } from '@/lib/auth/roles';
import { normalizePhone } from '@/lib/utils/phone';
import { assertSignInAllowed } from '@/lib/auth/sign-in-gate';
import {
  OTP_COOKIE_ATTEMPTS,
  OTP_COOKIE_EMAIL,
  OTP_COOKIE_SENT_AT,
  OTP_MAX_VERIFY_ATTEMPTS,
  OTP_RESEND_COOLDOWN_SECONDS,
  classifyOtpVerifyError,
  isOtpRateLimitError,
  maskEmail,
  normalizeOtpCode,
  otpCooldownRemaining,
  otpErrorMessage,
  otpSentMessage,
  resolveOtpCodeLength,
} from '@/lib/auth/otp-rules';

export type { AuthErrorCode, FormState, OtpFormState } from '@/lib/auth/helpers';
import { isDuplicateSignup, mapSignInError, safeRedirectPath } from '@/lib/auth/helpers';
import type { FormState, OtpFormState } from '@/lib/auth/helpers';

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

  const supabase = (await createClient());
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error || !data.user) {
    return mapSignInError(error, 'email');
  }

  // Role AND approval status are read server-side from `profiles` / `retailers`
  // and gated identically to the OTP path (lib/auth/sign-in-gate.ts). The role
  // is never taken from the form, a cookie, or any browser-supplied value.
  const decision = await assertSignInAllowed(
    supabase as never,
    data.user.id,
    safeRedirectPath(parsed.data.redirect),
    homeForRole
  );
  if (!decision.allowed) {
    // Reachable ONLY after Supabase accepted the password, so naming the real
    // reason is not an enumeration oracle: an attacker would already need
    // valid credentials. (Refusal on a failed password stays generic above.)
    return { code: decision.code, error: decision.error };
  }

  redirect(decision.destination);
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

    const supabase = (await createClient());
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

    const decision = await assertSignInAllowed(
      supabase as never,
      data.user.id,
      safeRedirectPath(parsed.data.redirect),
      homeForRole
    );
    if (!decision.allowed) {
      return { code: 'invalid_credentials', error: decision.error };
    }
    destination = decision.destination;
  } catch {
    return genericError;
  }
  redirect(destination);
}

/* ------------------------------------------------------------------------ *
 * Email OTP (one-time code) sign-in — SECOND credential, same session model.
 *
 * Security invariants (tested in tests/auth-otp.test.ts):
 *   - `shouldCreateUser: false` → an unknown address never becomes an account.
 *   - Every outcome of the send step returns the SAME generic message, so the
 *     endpoint cannot be used to discover which emails have accounts.
 *   - The code is issued, stored (hashed) and compared by Supabase Auth. This
 *     app never persists it; there is no OTP table and no plaintext fallback.
 *   - The pending email lives in an httpOnly cookie, never in the URL,
 *     localStorage or sessionStorage, so it cannot be read or tampered with by
 *     client JavaScript.
 *   - Resend is limited by a server-set cooldown AND by GoTrue's own
 *     rate limits; the client countdown is cosmetic only.
 *   - The role is read server-side after verification — never from the form.
 * ------------------------------------------------------------------------ */

const emailOtpRequestSchema = z.object({
  // Optional: a RESEND leaves the field blank and the address is taken from
  // the httpOnly cookie instead, so the browser never re-supplies it.
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').optional(),
  redirect: z.string().optional(),
});

const emailOtpVerifySchema = z.object({
  token: z.string().min(1, 'Enter the code from your email.'),
  redirect: z.string().optional(),
});

const OTP_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
};

/** Reads the pending-OTP cookies. Never throws: a missing cookie is normal. */
async function readOtpCookies(): Promise<{ email: string | null; sentAt: number | null; attempts: number }> {
  const store = await cookies();
  const email = store.get(OTP_COOKIE_EMAIL)?.value ?? null;
  const sentAtRaw = store.get(OTP_COOKIE_SENT_AT)?.value ?? '';
  const attemptsRaw = store.get(OTP_COOKIE_ATTEMPTS)?.value ?? '0';
  const sentAt = Number.parseInt(sentAtRaw, 10);
  const attempts = Number.parseInt(attemptsRaw, 10);
  return {
    email: email && email.includes('@') ? email : null,
    sentAt: Number.isFinite(sentAt) ? sentAt : null,
    attempts: Number.isFinite(attempts) && attempts >= 0 ? attempts : 0,
  };
}

/**
 * Explains a GoTrue token-length rejection in terms the user can act on.
 *
 * The code length is a PROJECT setting (`mailer_otp_length`), and apps cannot
 * read it with the anon key. GoTrue validates the submitted token against that
 * setting, so if the owner configures 8 while the UI renders 6, every code
 * fails with "Token has invalid length" and — worse — spends an attempt.
 * Rather than guess, we detect that specific error and say so.
 */
function isOtpLengthMismatch(error: { message?: string; code?: string } | null | undefined): boolean {
  const haystack = `${error?.code ?? ''} ${error?.message ?? ''}`.toLowerCase();
  return haystack.includes('invalid length') || haystack.includes('length');
}

/** Shared shell for the "we sent something (or maybe nothing)" response. */
function otpSentState(email: string, sentAtMs: number, extra?: Partial<NonNullable<OtpFormState>>): NonNullable<OtpFormState> {
  return {
    stage: 'verify',
    success: otpSentMessage(maskEmail(email)),
    maskedEmail: maskEmail(email),
    codeLength: resolveOtpCodeLength(),
    cooldownSeconds: OTP_RESEND_COOLDOWN_SECONDS,
    sentAt: sentAtMs,
    attemptsRemaining: OTP_MAX_VERIFY_ATTEMPTS,
    ...extra,
  };
}

/**
 * Issues a code for an address that is already pending in the cookie.
 * Used by "Resend" and by an in-window repeat of step 1. Keeps every outcome
 * generic, and refuses (silently, with the same copy) while the cooldown runs
 * so the endpoint cannot be used to burn the project's email quota.
 */
async function resendEmailOtp(
  email: string,
  sentAt: number | null
): Promise<NonNullable<OtpFormState>> {
  const now = Date.now();
  const remaining = otpCooldownRemaining(sentAt, now);
  if (remaining > 0) {
    return otpSentState(email, sentAt as number, { cooldownSeconds: remaining });
  }

  const store = await cookies();
  const supabase = (await createClient());
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false },
  });

  if (error && isOtpRateLimitError(error)) {
    return { ...otpSentState(email, now), warning: otpErrorMessage('rate_limited') };
  }

  store.set(OTP_COOKIE_EMAIL, email, { ...OTP_COOKIE_OPTIONS, maxAge: 15 * 60 });
  store.set(OTP_COOKIE_SENT_AT, String(now), { ...OTP_COOKIE_OPTIONS, maxAge: 15 * 60 });
  store.set(OTP_COOKIE_ATTEMPTS, '0', { ...OTP_COOKIE_OPTIONS, maxAge: 15 * 60 });

  return otpSentState(email, now);
}

/**
 * Step 1 — email a sign-in code.
 *
 * Always reports success (generic copy) so the caller cannot learn whether the
 * address is registered, deactivated or suspended. A deactivated or suspended
 * account still receives the generic message but is refused at verify time,
 * where the session is destroyed again — refusing earlier would leak status.
 */
export async function requestEmailOtpAction(
  _prevState: OtpFormState,
  formData: FormData
): Promise<OtpFormState> {
  const redirectField = (formData.get('redirect') as string | null) || undefined;
  const parsed = emailOtpRequestSchema.safeParse({
    email: formData.get('email'),
    redirect: redirectField,
  });

  const store = await cookies();
  const existing = await readOtpCookies();

  if (!parsed.success) {
    // Blank field on a resend is expected; the cookie supplies the address.
    if (formData.get('email') === null || String(formData.get('email')).trim() === '') {
      if (existing.email) {
        return resendEmailOtp(existing.email, existing.sentAt);
      }
    }
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      if (issue.path[0]) fieldErrors[String(issue.path[0])] = issue.message;
    }
    return { fieldErrors };
  }

  const email = parsed.data.email as string;
  const now = Date.now();

  // Same address inside the cooldown window: do not spend a second email.
  // Report the SAME state as a fresh send so it is not an oracle either.
  const remaining = otpCooldownRemaining(existing.sentAt, now);
  if (existing.email === email && remaining > 0) {
    return otpSentState(email, existing.sentAt as number, { cooldownSeconds: remaining });
  }

  const supabase = (await createClient());
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      // NEVER create an account from the login screen. New retailers use
      // /register-retailer; sellers are created by Super Admin invitation.
      shouldCreateUser: false,
    },
  });

  if (error && isOtpRateLimitError(error)) {
    return {
      ...otpSentState(email, now, { cooldownSeconds: OTP_RESEND_COOLDOWN_SECONDS }),
      // Rate limiting is safe to surface: it depends on request volume, not on
      // whether the address exists, so it reveals nothing about the account.
      warning: otpErrorMessage('rate_limited'),
    };
  }

  // Record the attempt window in httpOnly cookies. `redirect` is carried in a
  // hidden form field, so nothing auth-related needs to travel in the URL.
  store.set(OTP_COOKIE_EMAIL, email, { ...OTP_COOKIE_OPTIONS, maxAge: 15 * 60 });
  store.set(OTP_COOKIE_SENT_AT, String(now), { ...OTP_COOKIE_OPTIONS, maxAge: 15 * 60 });
  store.set(OTP_COOKIE_ATTEMPTS, '0', { ...OTP_COOKIE_OPTIONS, maxAge: 15 * 60 });

  return otpSentState(email, now);
}

/**
 * Step 2 — verify the code and open a normal session.
 *
 * `redirect()` throws NEXT_REDIRECT, so it is called after every try/catch and
 * only once the server-side role gate has approved the session.
 */
export async function verifyEmailOtpAction(
  _prevState: OtpFormState,
  formData: FormData
): Promise<OtpFormState> {
  const parsed = emailOtpVerifySchema.safeParse({
    token: formData.get('token'),
    redirect: formData.get('redirect') || undefined,
  });

  const pending = await readOtpCookies();

  // The email comes from the httpOnly cookie, NOT from the form: a caller
  // cannot verify a code against an address they did not just request.
  if (!pending.email) {
    return {
      error: 'Your sign-in session expired. Please enter your email again.',
      fieldErrors: { email: 'Enter your email to receive a new code.' },
    };
  }

  if (pending.attempts >= OTP_MAX_VERIFY_ATTEMPTS) {
    return {
      maskedEmail: maskEmail(pending.email),
      error: otpErrorMessage('rate_limited'),
      attemptsRemaining: 0,
      expired: true,
    };
  }

  const codeLength = resolveOtpCodeLength();
  const token = normalizeOtpCode(parsed.success ? parsed.data.token : formData.get('token'), codeLength);

  if (!token) {
    return {
      maskedEmail: maskEmail(pending.email),
      fieldErrors: { token: `Enter the ${codeLength}-digit code from your email.` },
      attemptsRemaining: Math.max(OTP_MAX_VERIFY_ATTEMPTS - pending.attempts, 0),
    };
  }

  const store = await cookies();
  const supabase = (await createClient());

  const { data, error } = await supabase.auth.verifyOtp({
    email: pending.email,
    token,
    type: 'email',
  });

  if (error || !data.user) {
    const attempts = pending.attempts + 1;
    store.set(OTP_COOKIE_ATTEMPTS, String(attempts), { ...OTP_COOKIE_OPTIONS, maxAge: 15 * 60 });

    // A length rejection means configuration and UI disagree; tell the truth
    // instead of implying the user mistyped (and refund the attempt below,
    // because a rejected LENGTH is our bug, not their wrong guess).
    if (isOtpLengthMismatch(error) && !/expired/i.test(error?.message ?? '')) {
      store.set(OTP_COOKIE_ATTEMPTS, String(pending.attempts), { ...OTP_COOKIE_OPTIONS, maxAge: 15 * 60 });
      return {
        maskedEmail: maskEmail(pending.email),
        error:
          'Sign-in codes are not configured correctly for this site. Please contact your distributor so the code length can be fixed.',
        attemptsRemaining: Math.max(OTP_MAX_VERIFY_ATTEMPTS - pending.attempts, 0),
        configMismatch: true,
      };
    }

    const code = classifyOtpVerifyError(error);
    return {
      maskedEmail: maskEmail(pending.email),
      error: otpErrorMessage(code),
      attemptsRemaining: Math.max(OTP_MAX_VERIFY_ATTEMPTS - attempts, 0),
      expired: code === 'expired_code',
      // On an expired code the cookie pair is useless — clear the email so the
      // user restarts at step 1 rather than retrying a dead code.
      ...(code === 'expired_code' ? { stage: 'expired' as const } : {}),
    };
  }

  const decision = await assertSignInAllowed(
    supabase as never,
    data.user.id,
    safeRedirectPath(parsed.success ? parsed.data.redirect : undefined),
    homeForRole
  );

  // One-time use: clear the pending-OTP cookies whether or not access is
  // granted, so the same code/state cannot be replayed from this browser.
  store.delete(OTP_COOKIE_ATTEMPTS);
  store.delete(OTP_COOKIE_SENT_AT);
  store.delete(OTP_COOKIE_EMAIL);

  if (!decision.allowed) {
    return {
      error: decision.error,
      code: decision.code === 'account_suspended' ? 'account_suspended' : 'account_inactive',
      attemptsRemaining: 0,
    };
  }

  revalidatePath('/', 'layout');
  redirect(decision.destination);
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

  const supabase = (await createClient());
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

  const supabase = (await createClient());
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

  const supabase = (await createClient());
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
  const supabase = (await createClient());
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
  const supabase = (await createClient());

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
      // No `role` here: the handle_new_user() trigger always creates a
      // pending RETAILER for public signups and ignores any metadata role
      // (migration 0052) — signup metadata is fully client-controlled.
      data: {
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
    if (signUpError.message.toLowerCase().includes('invalid_area')) {
      // handle_new_user() rejects a missing / unknown / inactive area.
      return {
        fieldErrors: { areaId: 'Select a valid service area.' },
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

/** Compatibility endpoint for older clients/bookmarks. There is no public
 * seller signup: only a server-side Super Admin invitation can create a seller
 * Auth user. Never call auth.signUp with client-supplied seller metadata. */
export async function registerSellerAction(
  _prevState: FormState,
  _formData: FormData
): Promise<FormState> {
  // Retain the legacy Server Action signature without processing client input.
  void _prevState;
  void _formData;
  return { error: 'Seller registration is by Super Admin invitation only. Ask your marketplace administrator for an invite.' };
}
