import 'server-only';

import { NextResponse } from 'next/server';
import type { UserRole } from '@/lib/auth/roles';
import { can, type Permission } from '@/lib/permissions/permissions';
import { jsonError, type MobileErrorCode } from '@/lib/mobile/http';
import { createMobileSupabaseClient, type MobileSupabaseClient } from '@/lib/mobile/supabase';

/**
 * Bearer-token session resolution for `/api/mobile/v1`.
 *
 * This is the mobile equivalent of `middleware.ts` + `requireUser()`: the
 * SAME gates, applied to an API call instead of a page navigation, and
 * expressed as typed failures instead of redirects.
 *
 * Order (contract §1.8):
 *   1. bearer token present
 *   2. GoTrue verifies the token (never a client-decoded JWT)
 *   3. profiles row exists and is_active
 *   4. retailer status: suspended → account_suspended, otherwise non-active → pending approval
 *   5. access period (user_access_periods), super_admin exempt
 *   6. route-level role/permission/ownership checks via requireMobileRole /
 *      requireMobilePermission
 *
 * Identity is ALWAYS derived from the verified token. No request-supplied
 * role, user id, retailer id or approval flag is read anywhere in this module.
 */

export type MobileAuthFailureCode = Extract<
  MobileErrorCode,
  | 'missing_token'
  | 'invalid_token'
  | 'expired_token'
  | 'account_inactive'
  | 'account_suspended'
  | 'retailer_pending_approval'
  | 'access_expired'
  | 'forbidden'
  | 'internal_error'
  | 'database_unavailable'
>;

export interface MobileAuthFailure {
  code: MobileAuthFailureCode;
  status: number;
  message: string;
}

export interface MobileRetailerContext {
  status: string;
  shopName: string | null;
}

export interface MobileAccessContext {
  status: string;
  expiresAt: string | null;
}

export interface MobileSession {
  userId: string;
  email: string | null;
  role: UserRole;
  fullName: string | null;
  phone: string | null;
  retailer: MobileRetailerContext | null;
  access: MobileAccessContext | null;
  accessToken: string;
  supabase: MobileSupabaseClient;
}

export type MobileSessionResult =
  | { ok: true; session: MobileSession }
  | { ok: false; failure: MobileAuthFailure };

interface ProfileRow {
  role: UserRole;
  full_name: string | null;
  is_active: boolean;
  phone: string | null;
}

interface RetailerRow {
  status: string;
  shop_name: string | null;
}

interface AccessPeriodRow {
  status: string;
  expires_at: string | null;
}

/**
 * Roles this API knows how to route. A value outside this list can only come
 * from a bad migration or a hand-edited row, and it must NEVER be treated as a
 * privileged account: an unknown role is rejected as `forbidden` instead of
 * flowing into `ROLE_HOME`/permission lookups (where it would resolve to
 * `undefined` and could leak `undefined` into a response).
 */
export const MOBILE_ROLES: readonly UserRole[] = [
  'super_admin',
  'admin',
  'staff',
  'salesman',
  'retailer',
];

export function isKnownRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (MOBILE_ROLES as readonly string[]).includes(value);
}

/** Tokens are read from the Authorization header only — never a query param. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  return token ? token : null;
}

/**
 * Read `exp` from an (unverified) JWT payload.
 *
 * Used ONLY to choose between the `expired_token` and `invalid_token` error
 * codes so the app can refresh instead of forcing a full sign-in. The token is
 * still verified by Supabase — this function grants nothing.
 */
export function tokenExpirySeconds(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8')
    ) as { exp?: unknown };
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

export function classifyTokenFailure(token: string | null, nowSeconds = Math.floor(Date.now() / 1000)): MobileAuthFailure {
  if (token) {
    const exp = tokenExpirySeconds(token);
    if (exp !== null && exp <= nowSeconds) {
      return failure('expired_token');
    }
  }
  return failure('invalid_token');
}

/**
 * Access-period rule, identical to `middleware.ts`:
 *   - super_admin is never blocked
 *   - no record at all → allowed (backward compatibility)
 *   - status `unlimited` → allowed
 *   - otherwise the newest record must have a future `expires_at`
 */
export function isAccessPeriodValid(
  row: { status: string; expires_at: string | null } | null | undefined,
  role: UserRole,
  now: Date = new Date()
): boolean {
  if (role === 'super_admin') return true;
  if (!row) return true;
  if (row.status === 'unlimited') return true;
  if (!row.expires_at) return true;
  return new Date(row.expires_at) > now;
}

const FAILURES: Record<MobileAuthFailureCode, MobileAuthFailure> = {
  missing_token: {
    code: 'missing_token',
    status: 401,
    message: 'Sign in to continue.',
  },
  invalid_token: {
    code: 'invalid_token',
    status: 401,
    message: 'Your session is no longer valid. Please sign in again.',
  },
  expired_token: {
    code: 'expired_token',
    status: 401,
    message: 'Your session has expired. Please sign in again.',
  },
  account_inactive: {
    code: 'account_inactive',
    status: 403,
    message: 'This account is not active. Please contact Maharani Traders.',
  },
  account_suspended: {
    code: 'account_suspended',
    status: 403,
    message: 'This account is suspended. Please contact Maharani Traders.',
  },
  retailer_pending_approval: {
    code: 'retailer_pending_approval',
    status: 403,
    message: 'Your shop is still awaiting approval.',
  },
  access_expired: {
    code: 'access_expired',
    status: 403,
    message: 'Your access period has ended. Please contact Maharani Traders.',
  },
  forbidden: {
    code: 'forbidden',
    status: 403,
    message: 'You do not have permission to do that.',
  },
  internal_error: {
    code: 'internal_error',
    status: 500,
    message: 'Something went wrong. Please try again.',
  },
  database_unavailable: {
    code: 'database_unavailable',
    status: 503,
    message: 'The service is temporarily unavailable. Please try again.',
  },
};

export function failure(code: MobileAuthFailureCode): MobileAuthFailure {
  return FAILURES[code];
}

/** Turn a typed failure into the standard mobile error envelope. */
export function mobileFailureResponse(
  authFailure: MobileAuthFailure,
  requestId?: string
): NextResponse {
  return jsonError(authFailure.code, authFailure.message, {
    status: authFailure.status,
    requestId,
  });
}

/** Role gate for a route: `null` means allowed. */
export function requireMobileRole(
  session: MobileSession,
  roles: readonly UserRole[]
): MobileAuthFailure | null {
  return roles.includes(session.role) ? null : failure('forbidden');
}

/**
 * Permission gate for a route. Wraps the same `can()` table the web uses, so
 * the two surfaces can never disagree about what a role may do.
 */
export function requireMobilePermission(
  session: MobileSession,
  permission: Permission
): MobileAuthFailure | null {
  return can(session.role, permission) ? null : failure('forbidden');
}

/** Resolve the caller's verified session, or a typed failure to return as-is. */
export async function requireMobileSession(request: Request): Promise<MobileSessionResult> {
  const token = bearerToken(request);
  if (!token) return { ok: false, failure: failure('missing_token') };

  let supabase: MobileSupabaseClient;
  try {
    supabase = createMobileSupabaseClient(token);
  } catch {
    return { ok: false, failure: failure('database_unavailable') };
  }

  // 2. GoTrue verification — the only trusted source of identity.
  let userId: string;
  let email: string | null;
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
      return { ok: false, failure: classifyTokenFailure(token) };
    }
    userId = data.user.id;
    email = data.user.email ?? null;
  } catch {
    return { ok: false, failure: failure('database_unavailable') };
  }

  // 3. Profile + active gate.
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, full_name, is_active, phone')
    .eq('id', userId)
    .maybeSingle<ProfileRow>();

  if (profileError) return { ok: false, failure: failure('database_unavailable') };
  if (!profile || profile.is_active !== true) {
    return { ok: false, failure: failure('account_inactive') };
  }
  if (!isKnownRole(profile.role)) {
    // Fail closed: an unrecognised role is not a role.
    return { ok: false, failure: failure('forbidden') };
  }

  const role = profile.role;

  // 4. Retailer approval / suspension gate (mirrors middleware.ts ordering).
  let retailer: MobileRetailerContext | null = null;
  if (role === 'retailer') {
    const { data: retailerRow, error: retailerError } = await supabase
      .from('retailers')
      .select('status, shop_name')
      .eq('id', userId)
      .maybeSingle<RetailerRow>();

    if (retailerError) return { ok: false, failure: failure('database_unavailable') };
    if (retailerRow?.status === 'suspended') {
      return { ok: false, failure: failure('account_suspended') };
    }
    if (!retailerRow || retailerRow.status !== 'active') {
      // No retailers row yet and every non-active status (pending_approval,
      // rejected, …) land on the same gate, exactly like requireUser().
      return { ok: false, failure: failure('retailer_pending_approval') };
    }
    retailer = { status: retailerRow.status, shopName: retailerRow.shop_name ?? null };
  }

  // 5. Access period.
  let access: MobileAccessContext | null = null;
  if (role !== 'super_admin') {
    const { data: accessPeriod, error: accessError } = await supabase
      .from('user_access_periods')
      .select('status, expires_at')
      .eq('user_id', userId)
      .in('status', ['active', 'expiring_soon', 'unlimited'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<AccessPeriodRow>();

    if (accessError) return { ok: false, failure: failure('database_unavailable') };
    if (!isAccessPeriodValid(accessPeriod, role)) {
      return { ok: false, failure: failure('access_expired') };
    }
    access = accessPeriod
      ? { status: accessPeriod.status, expiresAt: accessPeriod.expires_at }
      : null;
  }

  return {
    ok: true,
    session: {
      userId,
      email,
      role,
      fullName: profile.full_name ?? null,
      phone: profile.phone ?? null,
      retailer,
      access,
      accessToken: token,
      supabase,
    },
  };
}
