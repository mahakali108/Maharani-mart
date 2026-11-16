/**
 * Pure, side-effect-free rules for email one-time-password (OTP) sign-in.
 *
 * Lives outside `lib/auth/actions.ts` because a `'use server'` module may only
 * export async functions, and both the Server Actions and the client form need
 * these constants/helpers.
 *
 * SECURITY MODEL (see docs/repair/DUAL_LOGIN_SECURITY_TEST_REPORT.md):
 *   - The code itself is generated, stored (hashed) and compared by Supabase
 *     Auth. This app never sees, stores, logs or transports the code anywhere
 *     except the user's own input → `verifyOtp()`. There is deliberately NO
 *     custom one-time-code table in our schema; adding one would mean storing
 *     secrets in plaintext and reimplementing expiry and throttling.
 *   - Expiry is owned by the Supabase Auth project (`mailer_otp_exp`). The UI
 *     only *displays* it, and reads it from env so the label can never drift
 *     from a code change.
 *   - The resend cooldown here is a UX guard; the authoritative limiter is
 *     GoTrue's `rate_limit_email_sent` / `rate_limit_otp`. A cookie can be
 *     cleared by the client, so this must never be the only defence.
 */

/** How many digits the form renders by default and accepts as canonical. */
export const OTP_DEFAULT_CODE_LENGTH = 6;

/** GoTrue supports 6–10; the product spec fixes 6 and the guide asks the
 *  owner to set `mailer_otp_length = 6`. 8 is tolerated so the form still
 *  works on a project that has not been switched over yet. */
export const OTP_MIN_CODE_LENGTH = 6;
export const OTP_MAX_CODE_LENGTH = 8;

/** UX-only resend cooldown, in seconds. */
export const OTP_RESEND_COOLDOWN_SECONDS = 60;

/** Failed verify attempts before the form asks the user to start over.
 *  Defence-in-depth only: GoTrue's `rate_limit_verify` is authoritative. */
export const OTP_MAX_VERIFY_ATTEMPTS = 5;

/** Live Supabase default is 3600s (60 min); the guide recommends 600s. */
export const OTP_DEFAULT_EXPIRY_MINUTES = 60;

/**
 * Cookie names used to carry the pending sign-in between the two Server
 * Actions. All are httpOnly + sameSite=lax, so client JavaScript can never
 * read the pending email or forge a cooldown timestamp.
 */
export const OTP_COOKIE_EMAIL = 'mahi_otp_email';
export const OTP_COOKIE_SENT_AT = 'mahi_otp_sent_at';
export const OTP_COOKIE_ATTEMPTS = 'mahi_otp_attempts';

/**
 * Number of code boxes to render. Read from a NEXT_PUBLIC_* variable so the
 * owner can align the UI with the project's `mailer_otp_length` without a code
 * change (Next.js inlines literal `process.env.NEXT_PUBLIC_*` reads).
 */
export function resolveOtpCodeLength(raw: string | undefined = process.env.NEXT_PUBLIC_AUTH_OTP_LENGTH): number {
  const parsed = Number.parseInt(String(raw ?? '').trim(), 10);
  if (!Number.isFinite(parsed)) return OTP_DEFAULT_CODE_LENGTH;
  if (parsed < OTP_MIN_CODE_LENGTH || parsed > OTP_MAX_CODE_LENGTH) return OTP_DEFAULT_CODE_LENGTH;
  return parsed;
}

/** Expiry shown under the code input. Must mirror `mailer_otp_exp`. */
export function resolveOtpExpiryMinutes(
  raw: string | undefined = process.env.NEXT_PUBLIC_AUTH_OTP_EXPIRY_MINUTES
): number {
  const parsed = Number.parseInt(String(raw ?? '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 24 * 60) return OTP_DEFAULT_EXPIRY_MINUTES;
  return parsed;
}

/**
 * Normalises what the user typed/pasted into a bare digit string.
 * Tolerates spaces, dashes and non-breaking spaces (common when a code is
 * copied out of an HTML email) but nothing else. Returns `null` when the
 * result is not exactly `length` digits, so a partly-typed code is rejected
 * before it ever reaches Supabase — that also avoids burning a verify attempt.
 */
export function normalizeOtpCode(raw: unknown, length: number = resolveOtpCodeLength()): string | null {
  if (typeof raw !== 'string') return null;
  const digits = raw.replace(/[\s\u00a0\u2010-\u2015-]/g, '');
  if (!/^[0-9]+$/.test(digits)) return null;
  if (digits.length !== length) return null;
  return digits;
}

/** `rajesh.kumar@gmail.com` → `r***@gmail.com`. Used only for display. */
export function maskEmail(email: string): string {
  const trimmed = String(email ?? '').trim();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0) return trimmed ? `${trimmed.slice(0, 1)}***` : '';
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at);
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 1);
  return `${visible}***${domain}`;
}

/**
 * Seconds the user must still wait before another code may be sent.
 * Returns 0 when the cooldown has elapsed or the timestamp is unusable.
 */
export function otpCooldownRemaining(
  sentAtMs: number | null | undefined,
  nowMs: number = Date.now(),
  cooldownSeconds: number = OTP_RESEND_COOLDOWN_SECONDS
): number {
  if (!sentAtMs || !Number.isFinite(sentAtMs)) return 0;
  const elapsed = Math.floor((nowMs - sentAtMs) / 1000);
  const remaining = cooldownSeconds - elapsed;
  return remaining > 0 ? remaining : 0;
}

export type OtpErrorCode =
  | 'invalid_code'
  | 'expired_code'
  | 'rate_limited'
  | 'account_unavailable'
  | 'send_failed'
  | 'verify_failed';

/**
 * User-facing copy. Deliberately generic for anything that could reveal
 * whether an address has an account: the same message covers "wrong code",
 * "no such account" and "code was never issued".
 */
export function otpErrorMessage(code: OtpErrorCode): string {
  switch (code) {
    case 'invalid_code':
      return 'That code is not correct. Check the email and try again.';
    case 'expired_code':
      return 'That code has expired. Request a new one below.';
    case 'rate_limited':
      return 'Too many attempts. Please wait a few minutes before trying again.';
    case 'account_unavailable':
      return 'This account is not available for sign-in. Contact your distributor.';
    case 'send_failed':
      return 'We could not send a code just now. Please try again in a minute.';
    case 'verify_failed':
    default:
      return 'We could not verify that code. Please check it and try again.';
  }
}

/** Detects GoTrue throttling without depending on a specific message string. */
export function isOtpRateLimitError(error: { status?: number; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.status === 429) return true;
  const message = (error.message ?? '').toLowerCase();
  return message.includes('rate limit') || message.includes('too many') || message.includes('only request this after');
}

/** Maps a GoTrue verify error to a coarse code, using token-expiry signals. */
export function classifyOtpVerifyError(
  error: { status?: number; message?: string; code?: string } | null | undefined
): OtpErrorCode {
  if (!error) return 'verify_failed';
  if (isOtpRateLimitError(error)) return 'rate_limited';
  const haystack = `${error.code ?? ''} ${error.message ?? ''}`.toLowerCase();
  if (haystack.includes('expired')) return 'expired_code';
  if (haystack.includes('invalid') || haystack.includes('token has expired or is invalid')) return 'invalid_code';
  return 'verify_failed';
}

/**
 * The message shown for EVERY successful `signInWithOtp` call, and also for
 * the "this email has no account" response, so the two are indistinguishable.
 */
export function otpSentMessage(maskedEmail: string): string {
  return `If ${maskedEmail} belongs to an account, a sign-in code is on its way. It may take a minute — please also check spam.`;
}
