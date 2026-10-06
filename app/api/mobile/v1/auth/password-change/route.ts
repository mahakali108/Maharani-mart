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
import { createMobileAnonClient, gotrueFetch } from '@/lib/mobile/clients';
import { passwordChangeSchema } from '@/lib/mobile/auth-api';

export const dynamic = 'force-dynamic';

/**
 * POST /api/mobile/v1/auth/password-change
 *
 * In-account password rotation. A verified bearer session is necessary but not
 * sufficient: the current password is re-authenticated with the public GoTrue
 * client, the returned user id must match the bearer caller, then GoTrue's own
 * password update endpoint is called with that re-authenticated user's token.
 * No service-role/admin password mutation is used.
 */
export async function POST(request: Request): Promise<Response> {
  const requestId = newRequestId();
  const limited = enforceRateLimit('auth.login', request, { requestId });
  if (limited) return limited;

  let resolved;
  try {
    resolved = await requireMobileSession(request);
  } catch (cause) {
    logServerError('auth.password-change', requestId, cause);
    return mobileFailureResponse(
      { code: 'internal_error', status: 500, message: 'Something went wrong. Please try again.' },
      requestId,
    );
  }
  if (!resolved.ok) return mobileFailureResponse(resolved.failure, requestId);

  const body = await parseJsonBody(request, passwordChangeSchema, requestId);
  if (!body.ok) return body.response;
  if (!resolved.session.email) {
    return jsonError('validation_failed', 'This account has no sign-in email. Contact support to change the password.', {
      status: 400,
      requestId,
    });
  }

  try {
    const anon = createMobileAnonClient();
    const { data, error } = await anon.auth.signInWithPassword({
      email: resolved.session.email,
      password: body.data.currentPassword,
    });
    if (error || !data.user || !data.session || data.user.id !== resolved.session.userId) {
      return jsonError('invalid_credentials', 'Your current password is not correct.', {
        status: 401,
        requestId,
      });
    }

    const result = await gotrueFetch('/user', {
      method: 'PUT',
      accessToken: data.session.access_token,
      body: { password: body.data.newPassword },
    });
    if (!result.ok) {
      if (result.status === 422 || result.status === 400) {
        return jsonError('validation_failed', 'Choose a stronger password (at least 8 characters).', {
          status: 400,
          details: { fields: { newPassword: 'Choose a stronger password (at least 8 characters).' } },
          requestId,
        });
      }
      return jsonError('internal_error', 'The password could not be changed. Please try again.', {
        status: result.status === 401 ? 401 : 500,
        requestId,
      });
    }
    return jsonOk({ ok: true }, { requestId });
  } catch (cause) {
    logServerError('auth.password-change', requestId, cause);
    return jsonError('database_unavailable', 'The password could not be changed. Please try again.', {
      status: 503,
      requestId,
    });
  }
}

export async function GET(): Promise<Response> {
  return methodNotAllowed(['POST']);
}
