/**
 * Pure auth helpers shared by Server Actions and unit tests.
 *
 * Lives in its own module (no 'use server') because 'use server' files
 * may only export async functions — these synchronous helpers would
 * break the production build if exported from lib/auth/actions.ts.
 */

export type AuthErrorCode =
  | 'invalid_credentials'
  | 'email_not_confirmed'
  | 'duplicate_email'
  | 'duplicate_phone'
  | 'recovery_failed'
  | 'account_inactive'
  | 'account_suspended';

export type FormState = {
  error?: string;
  success?: string;
  /** Machine-readable error category so the UI can render contextual help
   *  (e.g. a "resend confirmation email" box) without parsing messages. */
  code?: AuthErrorCode;
  fieldErrors?: Record<string, string>;
} | null;

/**
 * State machine for the email-OTP sign-in form.
 *
 *   enter   → ask for an email address
 *   verify  → a code was (requested and) is being entered
 *   expired → a code was sent but GoTrue rejected it as expired
 *
 * Note what is NOT in here: the email itself is masked for display only, and
 * because `maskEmail()` is lossy it can never be used to rebuild the address.
 * The authoritative pending email lives in an httpOnly cookie.
 */
export type OtpFormState = {
  stage?: 'enter' | 'verify' | 'expired';
  error?: string;
  warning?: string;
  success?: string;
  code?: AuthErrorCode;
  fieldErrors?: Record<string, string>;
  /** Display-only, e.g. `r***@gmail.com`. */
  maskedEmail?: string;
  /** How many boxes to render — must match the project's `mailer_otp_length`. */
  codeLength?: number;
  /** Server-computed resend cooldown, so a reload cannot reset the countdown. */
  cooldownSeconds?: number;
  /** Epoch ms of the last send; lets the client rebuild the countdown. */
  sentAt?: number;
  attemptsRemaining?: number;
  expired?: boolean;
  /** True when the submitted length was rejected by the project's
   *  `mailer_otp_length` — a setup problem, not a user mistake. */
  configMismatch?: boolean;
} | null;

/**
 * Only allow redirecting back to a same-site path. The login form
 * renders whatever came in on the `?redirect=` query param (set by
 * middleware.ts when it bounces an unauthenticated visit) into a
 * hidden field, so this must be treated as untrusted input — reject
 * anything that isn't an internal, single-leading-slash path to avoid
 * an open redirect.
 */
export function safeRedirectPath(path: string | undefined): string | null {
  if (!path) return null;
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('://')) return null;
  return path;
}

/**
 * Maps a Supabase signInWithPassword failure to a user-facing FormState.
 *
 * - "Email not confirmed" (returned when the project's "Confirm email"
 *   setting is on and the user hasn't clicked the link yet) becomes a
 *   distinct `email_not_confirmed` code so the login UI can offer a
 *   "resend confirmation email" recovery path instead of a dead end.
 * - Everything else stays a generic invalid-credentials message so a
 *   failed login never reveals whether an account exists.
 */
export function mapSignInError(
  error: { message: string } | null | undefined,
  subject: 'email' | 'mobile number'
): NonNullable<FormState> {
  const message = (error?.message ?? '').toLowerCase();
  if (message.includes('email not confirmed') || message.includes('email_not_confirmed')) {
    return {
      code: 'email_not_confirmed',
      error:
        'Your email address has not been confirmed yet. Please check your inbox for the confirmation link, then sign in again.',
    };
  }
  return {
    code: 'invalid_credentials',
    error: `Invalid ${subject} or password. Please try again.`,
  };
}

/**
 * Supabase Auth deliberately avoids email enumeration on signUp: when
 * "Confirm email" is enabled, signing up with an already-registered
 * email returns SUCCESS with an obfuscated user whose `identities`
 * array is empty — not an error. Detect that shape so we can tell the
 * retailer to log in instead of implying a second account was created.
 */
export function isDuplicateSignup(user: { identities?: unknown[] | null } | null | undefined): boolean {
  return !!user && Array.isArray(user.identities) && user.identities.length === 0;
}
