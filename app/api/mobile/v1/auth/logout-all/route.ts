import {
  bearerToken,
  enforceRateLimit,
  jsonOk,
  logServerError,
  mobileFailureResponse,
  newRequestId,
  requireMobileSession,
  methodNotAllowed,
} from '@/lib/mobile';
import { gotrueFetch } from '@/lib/mobile/clients';

export const dynamic = 'force-dynamic';

/** Revoke all GoTrue refresh-token sessions for the authenticated caller. */
export async function POST(request: Request): Promise<Response> {
  const requestId = newRequestId();
  const limited = enforceRateLimit('auth.login', request, { requestId });
  if (limited) return limited;
  let resolved;
  try {
    resolved = await requireMobileSession(request);
  } catch (cause) {
    logServerError('auth.logout-all', requestId, cause);
    return mobileFailureResponse(
      { code: 'internal_error', status: 500, message: 'Something went wrong. Please try again.' },
      requestId,
    );
  }
  if (!resolved.ok) return mobileFailureResponse(resolved.failure, requestId);

  const token = bearerToken(request);
  if (!token) {
    return mobileFailureResponse(
      { code: 'missing_token', status: 401, message: 'Sign in to continue.' },
      requestId,
    );
  }
  try {
    const result = await gotrueFetch('/logout?scope=global', { method: 'POST', accessToken: token });
    if (!result.ok && result.status !== 401) logServerError('auth.logout-all', requestId, `gotrue logout returned ${result.status}`);
  } catch (cause) {
    // Local sign-out is still safe if the provider is unavailable; the next
    // protected request on another device will be rejected when tokens expire.
    logServerError('auth.logout-all', requestId, cause);
  }
  return jsonOk({ ok: true }, { requestId });
}

export async function GET(): Promise<Response> {
  return methodNotAllowed(['POST']);
}
