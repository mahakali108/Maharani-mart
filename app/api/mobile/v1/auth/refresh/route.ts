import {
  enforceRateLimit,
  jsonError,
  jsonOk,
  logServerError,
  mobileFailureResponse,
  newRequestId,
  parseJsonBody,
  methodNotAllowed,
} from '@/lib/mobile';
import { createMobileAnonClient } from '@/lib/mobile/clients';
import { refreshSchema, toSessionTokens } from '@/lib/mobile/auth-api';

/**
 * POST /api/mobile/v1/auth/refresh
 *
 * Body: `{ refreshToken }`
 *
 * Returns fresh tokens only — deliberately NOT the user profile or navigation.
 * Account state can change while a token is being refreshed (a shop can be
 * suspended mid-session), so entitlement is re-read from `GET /session` and
 * re-checked on every business call rather than being cached in a refresh
 * response.
 *
 * A refresh failure is terminal: `401 invalid_token`, and the app wipes the
 * local session and returns to sign-in. The refresh token is never echoed back
 * in a response or an error body.
 *
 * Contract: docs/NATIVE_ANDROID_API_CONTRACT.md §2.2.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const requestId = newRequestId();

  const limited = enforceRateLimit('auth.refresh', request, { requestId });
  if (limited) return limited;

  const body = await parseJsonBody(request, refreshSchema, requestId);
  if (!body.ok) return body.response;

  try {
    const anon = createMobileAnonClient();
    const { data, error } = await anon.auth.refreshSession({
      refresh_token: body.data.refreshToken,
    });

    if (error || !data?.session) {
      return jsonError('invalid_token', 'Your session has expired. Please sign in again.', {
        status: 401,
        requestId,
      });
    }

    return jsonOk(toSessionTokens(data.session), { requestId });
  } catch (cause) {
    logServerError('auth.refresh', requestId, cause);
    return mobileFailureResponse(
      { code: 'database_unavailable', status: 503, message: 'The service is temporarily unavailable. Please try again.' },
      requestId
    );
  }
}

export async function GET(): Promise<Response> {
  return methodNotAllowed(['POST']);
}
