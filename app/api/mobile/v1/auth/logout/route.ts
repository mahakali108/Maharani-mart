import {
  bearerToken,
  jsonOk,
  logServerError,
  mobileFailureResponse,
  newRequestId,
  methodNotAllowed,
} from '@/lib/mobile';
import { gotrueFetch } from '@/lib/mobile/clients';

/**
 * POST /api/mobile/v1/auth/logout
 *
 * Revokes the caller's refresh token at GoTrue. The access token expires on its
 * own, so revoking the refresh token is what actually ends the session.
 *
 * TWO DELIBERATE CHOICES
 * ----------------------
 * 1. It uses the bearer token directly instead of `requireMobileSession`.
 *    A suspended, deactivated or expired account must ALWAYS be able to sign
 *    out — refusing to log someone out because their account state changed
 *    would trap them in the app. No session state is required to revoke a
 *    token the caller already holds.
 * 2. It returns `200 { ok: true }` even when GoTrue cannot be reached. The app
 *    wipes local session material unconditionally, so a failed revocation is
 *    not a failure to sign out; the alternative (a 5xx that makes the app
 *    "stay logged in") is strictly worse. The real cause is logged
 *    server-side against the request id.
 *
 * The token is never logged and never appears in a response body.
 *
 * Contract: docs/NATIVE_ANDROID_API_CONTRACT.md §2.2.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const requestId = newRequestId();

  const token = bearerToken(request);
  if (!token) {
    return mobileFailureResponse(
      { code: 'missing_token', status: 401, message: 'Sign in to continue.' },
      requestId
    );
  }

  try {
    const result = await gotrueFetch('/logout', { method: 'POST', accessToken: token });
    if (!result.ok && result.status !== 401) {
      // 401 means the token was already invalid — the goal state is reached.
      logServerError('auth.logout', requestId, `gotrue logout returned ${result.status}`);
    }
  } catch (cause) {
    logServerError('auth.logout', requestId, cause);
  }

  return jsonOk({ ok: true }, { requestId });
}

export async function GET(): Promise<Response> {
  return methodNotAllowed(['POST']);
}
