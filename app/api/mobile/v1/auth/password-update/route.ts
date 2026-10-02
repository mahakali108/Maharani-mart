import {
  enforceRateLimit,
  jsonError,
  jsonOk,
  logServerError,
  mobileFailureResponse,
  newRequestId,
  parseJsonBody,
  requireMobileSession,
  methodNotAllowed,
} from '@/lib/mobile';
import { gotrueFetch } from '@/lib/mobile/clients';
import { passwordUpdateSchema } from '@/lib/mobile/auth-api';

/**
 * POST /api/mobile/v1/auth/password-update
 *
 * Body: `{ password, confirmPassword }` — authenticated (bearer required).
 *
 * The change is performed with the CALLER'S OWN token against GoTrue, so:
 *   - only the caller can change their password (identity comes from the
 *     verified token, never from the body);
 *   - GoTrue's own policy and rate limits apply, instead of an admin override;
 *   - the app's other sessions are not silently revoked by a privileged call.
 *
 * `requireMobileSession` runs first, so a suspended, pending or expired account
 * cannot change its password — the same gate as every other protected endpoint.
 *
 * Contract: docs/NATIVE_ANDROID_API_CONTRACT.md §2.2.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const requestId = newRequestId();

  const limited = enforceRateLimit('auth.login', request, { requestId });
  if (limited) return limited;

  let resolved;
  try {
    resolved = await requireMobileSession(request);
  } catch (cause) {
    logServerError('auth.password-update', requestId, cause);
    return mobileFailureResponse(
      { code: 'internal_error', status: 500, message: 'Something went wrong. Please try again.' },
      requestId
    );
  }
  if (!resolved.ok) return mobileFailureResponse(resolved.failure, requestId);

  const body = await parseJsonBody(request, passwordUpdateSchema, requestId);
  if (!body.ok) return body.response;

  try {
    const result = await gotrueFetch('/user', {
      method: 'PUT',
      accessToken: resolved.session.accessToken,
      // Only the password is sent; no metadata, no email, no role.
      body: { password: body.data.password },
    });

    if (!result.ok) {
      if (result.status === 401) {
        return mobileFailureResponse(
          { code: 'invalid_token', status: 401, message: 'Your session is no longer valid. Please sign in again.' },
          requestId
        );
      }
      if (result.status === 422 || result.status === 400) {
        // GoTrue's password policy — surfaced as a field error, never as a
        // raw provider message.
        return jsonError('validation_failed', 'Please check the highlighted fields.', {
          status: 400,
          details: {
            fields: { password: 'Choose a stronger password (at least 8 characters).' },
          },
          requestId,
        });
      }
      return mobileFailureResponse(
        { code: 'internal_error', status: 500, message: 'Something went wrong. Please try again.' },
        requestId
      );
    }

    return jsonOk({ ok: true }, { requestId });
  } catch (cause) {
    logServerError('auth.password-update', requestId, cause);
    return mobileFailureResponse(
      { code: 'database_unavailable', status: 503, message: 'The service is temporarily unavailable. Please try again.' },
      requestId
    );
  }
}

export async function GET(): Promise<Response> {
  return methodNotAllowed(['POST']);
}
