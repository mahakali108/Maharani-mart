import 'server-only';

import { z } from 'zod';
import type { Session } from '@supabase/supabase-js';
import { normalizePhone } from '@/lib/utils/phone';
import type { UserRole } from '@/lib/auth/roles';
import { createMobileSupabaseClient, type MobileSupabaseClient } from '@/lib/mobile/supabase';
import { requireMobileSession } from '@/lib/mobile/auth';
import type { MobileAuthFailure } from '@/lib/mobile/auth';

/**
 * Shared building blocks for `/api/mobile/v1/auth/*`.
 *
 * THE ONE RULE THIS MODULE ENFORCES
 * ---------------------------------
 * After a successful password sign-in, the account's state (active? approved?
 * within its access period?) is decided by calling the **same**
 * `requireMobileSession()` that every other mobile endpoint uses — on a
 * synthetic request carrying the freshly issued token. Login therefore cannot
 * drift from the rest of the API: if `GET /session` would refuse this account,
 * login says so too, and the only difference is that login is allowed to hand
 * back a session with `nextStep: 'pending_approval' | 'access_expired'` so the
 * app can render the right screen instead of a useless error.
 *
 * Such a session is intentionally *not* a bypass: every business endpoint still
 * runs `requireMobileSession` and still returns 403 until an admin approves the
 * shop. The tokens prove identity, not entitlement.
 */

// ---------------------------------------------------------------------------
// Request schemas (mirrors of the web forms in lib/auth/actions.ts)
// ---------------------------------------------------------------------------

export const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'Enter your mobile number or email.'),
  // Deliberately only min(1): legacy accounts may predate the 8-character rule,
  // and rejecting them here would turn a wrong-password into a misleading
  // field error. Length policy belongs on registration/change, not sign-in.
  password: z.string().min(1, 'Enter your password.'),
});

export const refreshSchema = z.object({
  refreshToken: z.string().trim().min(1, 'A refresh token is required.'),
});

export const passwordResetSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.'),
});

export const passwordUpdateSchema = z
  .object({
    password: z.string().min(8, 'Password must be at least 8 characters.'),
    confirmPassword: z.string().min(1, 'Please confirm your password.'),
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match.',
  });

/** Mirrors `registerRetailerSchema` in lib/auth/actions.ts. */
export const registerRetailerSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name.'),
  shopName: z.string().trim().min(2, 'Enter your shop / firm name.'),
  phone: z
    .string()
    .transform((value) => normalizePhone(value) ?? value)
    .pipe(z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number.')),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  areaId: z.string().uuid('Select your area.'),
  address: z.string().trim().min(5, 'Enter your shop address.'),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
});

// ---------------------------------------------------------------------------
// Session shaping
// ---------------------------------------------------------------------------

export type MobileNextStep = 'app' | 'pending_approval' | 'access_expired';

export interface MobileSessionTokens {
  accessToken: string;
  refreshToken: string;
  /** Unix seconds, from GoTrue. `null` if the provider omitted it. */
  expiresAt: number | null;
  tokenType: string;
}

export interface MobileAccountUser {
  id: string;
  email: string | null;
  role: UserRole;
  fullName: string | null;
  phone: string | null;
  isActive: boolean;
}

export interface MobileRetailerSummary {
  status: string;
  shopName: string | null;
}

export interface MobileLoginPayload extends MobileSessionTokens {
  nextStep: MobileNextStep;
  /**
   * `null` only when the account is not yet approved / its access lapsed —
   * the app shows the state screen and re-fetches `GET /session` after
   * approval. It is never `null` for a usable session.
   */
  user: MobileAccountUser | null;
  retailer: MobileRetailerSummary | null;
}

/** Map a GoTrue session to the wire shape. Never includes provider internals. */
export function toSessionTokens(session: Session): MobileSessionTokens {
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: typeof session.expires_at === 'number' ? session.expires_at : null,
    tokenType: session.token_type ?? 'bearer',
  };
}

/**
 * Does this identifier look like an email? Anything else is treated as a phone
 * number and normalized; a value that is neither is a validation error, which
 * reveals nothing about which accounts exist.
 */
export function isEmailIdentifier(identifier: string): boolean {
  return identifier.includes('@');
}

export interface ResolvedIdentifier {
  email: string;
  /** The normalized phone, when the caller signed in with one. */
  phone: string | null;
}

export type IdentifierResolution =
  | { ok: true; value: ResolvedIdentifier }
  | { ok: false; reason: 'invalid_identifier' | 'unknown_account' };

/**
 * Resolve a login identifier to the GoTrue email address.
 *
 * Phone → email resolution goes through the service-role client because
 * `profiles.phone` is not readable by anonymous callers (and must not be: a
 * readable phone column with a filter is an enumeration oracle). An unknown
 * phone and a wrong password are reported identically by the caller, so this
 * function's `unknown_account` result never reaches the client verbatim.
 */
export async function resolveIdentifier(
  identifier: string,
  resolvePhone: (phone: string) => Promise<string | null>
): Promise<IdentifierResolution> {
  if (isEmailIdentifier(identifier)) {
    const parsed = z.string().email().safeParse(identifier.trim().toLowerCase());
    if (!parsed.success) return { ok: false, reason: 'invalid_identifier' };
    return { ok: true, value: { email: parsed.data, phone: null } };
  }

  const phone = normalizePhone(identifier);
  if (!phone) return { ok: false, reason: 'invalid_identifier' };

  const email = await resolvePhone(phone);
  if (!email) return { ok: false, reason: 'unknown_account' };
  return { ok: true, value: { email, phone } };
}

// ---------------------------------------------------------------------------
// Post-sign-in account state
// ---------------------------------------------------------------------------

export type AccountStateResult =
  | { kind: 'ready'; payload: MobileLoginPayload }
  | { kind: 'blocked'; failure: MobileAuthFailure };

interface ProfileSummaryRow {
  role: UserRole;
  full_name: string | null;
  phone: string | null;
}

/**
 * Decide what the freshly signed-in account may do, using the SAME gate as
 * every other mobile endpoint.
 *
 * Tokens are only returned alongside a `pending_approval` / `access_expired`
 * outcome so the app can show the correct state screen; those tokens unlock
 * nothing (see the module doc comment).
 */
export async function evaluateAccountState(
  tokens: MobileSessionTokens,
  account: { id: string; email: string | null }
): Promise<AccountStateResult> {
  const probe = new Request('https://mobile.internal/api/mobile/v1/session', {
    headers: { authorization: `Bearer ${tokens.accessToken}` },
  });

  const resolved = await requireMobileSession(probe);

  if (resolved.ok) {
    const { session } = resolved;
    return {
      kind: 'ready',
      payload: {
        ...tokens,
        nextStep: 'app',
        user: {
          id: session.userId,
          email: session.email ?? account.email,
          role: session.role,
          fullName: session.fullName,
          phone: session.phone,
          isActive: true,
        },
        retailer: session.retailer,
      },
    };
  }

  const { failure } = resolved;

  // Two gates are recoverable states, not errors: the credentials were valid,
  // so the app gets a session plus instructions.
  if (failure.code === 'retailer_pending_approval' || failure.code === 'access_expired') {
    const summary = await readOwnProfileSummary(tokens.accessToken, account);
    return {
      kind: 'ready',
      payload: {
        ...tokens,
        nextStep: failure.code === 'retailer_pending_approval' ? 'pending_approval' : 'access_expired',
        user: summary,
        retailer: null,
      },
    };
  }

  return { kind: 'blocked', failure };
}

/**
 * Minimal own-profile read for the state screens. RLS restricts this to the
 * caller's own row, and only non-sensitive display fields are selected.
 *
 * `id` and `email` come from the VERIFIED GoTrue session, never from the row —
 * so they stay correct even if this read is refused.
 *
 * Returns a summary built from the verified identity when the row cannot be
 * read: the state screen then shows generic copy instead of the sign-in failing
 * outright. `role` is deliberately omitted in that case rather than guessed.
 */
async function readOwnProfileSummary(
  accessToken: string,
  account: { id: string; email: string | null }
): Promise<MobileAccountUser | null> {
  const base: MobileAccountUser = {
    id: account.id,
    email: account.email,
    role: 'retailer',
    fullName: null,
    phone: null,
    isActive: false,
  };

  let supabase: MobileSupabaseClient;
  try {
    supabase = createMobileSupabaseClient(accessToken);
  } catch {
    return base;
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('role, full_name, phone')
    .single<ProfileSummaryRow>();

  if (error || !data) return base;

  return {
    ...base,
    role: (data.role ?? 'retailer') as UserRole,
    fullName: data.full_name ?? null,
    phone: data.phone ?? null,
  };
}
