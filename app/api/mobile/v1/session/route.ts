import { ROLE_HOME, ROLE_ROUTE_PREFIXES } from '@/lib/auth/roles';
import { permissionsForRole } from '@/lib/permissions/permissions';
import {
  enforceRateLimit,
  jsonOk,
  logServerError,
  mobileFailureResponse,
  newRequestId,
  requireMobileSession,
} from '@/lib/mobile';

/**
 * GET /api/mobile/v1/session
 *
 * Role-aware bootstrap for the Android app: who am I, what state is my account
 * in, and which workspaces may I enter. Called after sign-in and after a
 * session restore.
 *
 * Two things this endpoint deliberately does NOT do:
 *   - it never accepts a user id / role / retailer id from the caller (identity
 *     comes from the verified bearer token only);
 *   - its `navigation` block is UX information, not authorization. Every
 *     protected route re-checks the caller's role and permission server-side,
 *     so a client that ignores or forges this list gains nothing.
 *
 * Contract: docs/NATIVE_ANDROID_API_CONTRACT.md §2.1.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const requestId = newRequestId();

  const limited = enforceRateLimit('read.orders', request, { requestId });
  if (limited) return limited;

  let resolved;
  try {
    resolved = await requireMobileSession(request);
  } catch (cause) {
    logServerError('session', requestId, cause);
    return mobileFailureResponse(
      { code: 'internal_error', status: 500, message: 'Something went wrong. Please try again.' },
      requestId
    );
  }

  if (!resolved.ok) return mobileFailureResponse(resolved.failure, requestId);

  const { session } = resolved;

  try {
    const workspaces = ROLE_ROUTE_PREFIXES.filter((entry) =>
      entry.roles.includes(session.role)
    ).map((entry) => entry.prefix.replace(/^\//, ''));

    return jsonOk(
      {
        user: {
          id: session.userId,
          email: session.email,
          role: session.role,
          fullName: session.fullName,
          phone: session.phone,
          isActive: true,
        },
        retailer: session.retailer,
        access: session.access,
        navigation: {
          homeRoute: ROLE_HOME[session.role],
          workspaces,
          permissions: permissionsForRole(session.role),
        },
      },
      { requestId }
    );
  } catch (cause) {
    logServerError('session', requestId, cause);
    return mobileFailureResponse(
      { code: 'internal_error', status: 500, message: 'Something went wrong. Please try again.' },
      requestId
    );
  }
}
