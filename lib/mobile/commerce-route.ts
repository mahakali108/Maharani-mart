import 'server-only';

import {
  mobileFailureResponse,
  requireMobilePermission,
  requireMobileRole,
  requireMobileSession,
  type MobileSession,
} from '@/lib/mobile';
import { type Permission } from '@/lib/permissions/permissions';
import { jsonError, type MobileErrorCode } from '@/lib/mobile/http';
import { MobileCommerceError } from '@/lib/mobile/commerce-service';

export async function requireRetailerCommerceSession(
  request: Request,
  requestId: string,
  permission: Permission | readonly Permission[] = 'orders.create'
): Promise<{ session: MobileSession } | { response: Response }> {
  let resolved;
  try {
    resolved = await requireMobileSession(request);
  } catch {
    return {
      response: mobileFailureResponse(
        { code: 'internal_error', status: 500, message: 'Something went wrong. Please try again.' },
        requestId
      ),
    };
  }
  if (!resolved.ok) return { response: mobileFailureResponse(resolved.failure, requestId) };

  const roleFailure = requireMobileRole(resolved.session, ['retailer']);
  if (roleFailure) return { response: mobileFailureResponse(roleFailure, requestId) };
  const requiredPermissions = typeof permission === 'string' ? [permission] : permission;
  for (const requiredPermission of requiredPermissions) {
    const permissionFailure = requireMobilePermission(resolved.session, requiredPermission);
    if (permissionFailure) return { response: mobileFailureResponse(permissionFailure, requestId) };
  }
  return { session: resolved.session };
}

export function mobileCommerceErrorResponse(cause: unknown, requestId: string): Response {
  if (cause instanceof MobileCommerceError) {
    return jsonError(cause.code as MobileErrorCode, cause.message, {
      status: cause.status,
      details: cause.details,
      requestId,
    });
  }
  return jsonError('database_unavailable', 'The commerce service could not be loaded. Please try again.', {
    status: 503,
    requestId,
  });
}
