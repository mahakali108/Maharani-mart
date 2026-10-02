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
import { createMobileAnonClient, createMobileServiceRoleClient } from '@/lib/mobile/clients';
import {
  evaluateAccountState,
  isEmailIdentifier,
  loginSchema,
  resolveIdentifier,
  toSessionTokens,
} from '@/lib/mobile/auth-api';

/**
 * POST /api/mobile/v1/auth/login
 *
 * Body: `{ identifier, password }` where `identifier` is a 10-digit Indian
 * mobile number (any common format) or an email address.
 *
 * Responses:
 *   200 `{ data: { accessToken, refreshToken, expiresAt, tokenType,
 *                  nextStep, user, retailer } }`
 *   400 `validation_failed` — the identifier is neither a phone nor an email
 *   401 `invalid_credentials` — unknown account OR wrong password (identical)
 *   403 `email_not_confirmed` — account resolves but the email is unconfirmed
 *   403 `account_inactive` / `account_suspended` / `forbidden`
 *   429 `rate_limited`
 *
 * `nextStep` tells the app where to go: `app` (usable), `pending_approval`, or
 * `access_expired`. The latter two still return a session so the app can render
 * the correct state screen — they grant no access, because every business
 * endpoint re-runs `requireMobileSession` and still refuses.
 *
 * Contract: docs/NATIVE_ANDROID_API_CONTRACT.md §2.2.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const requestId = newRequestId();

  const limited = enforceRateLimit('auth.login', request, { requestId });
  if (limited) return limited;

  const body = await parseJsonBody(request, loginSchema, requestId);
  if (!body.ok) return body.response;

  const { identifier, password } = body.data;

  try {
    const anon = createMobileAnonClient();

    const resolution = await resolveIdentifier(identifier, async (phone) => {
      const admin = createMobileServiceRoleClient();
      const { data: profile, error } = await admin
        .from('profiles')
        .select('id')
        .eq('phone', phone)
        .maybeSingle<{ id: string }>();

      if (error) throw error;
      if (!profile?.id) return null;

      const { data: userData, error: userError } = await admin.auth.admin.getUserById(profile.id);
      if (userError) throw userError;
      return userData?.user?.email ?? null;
    });

    if (!resolution.ok) {
      if (resolution.reason === 'invalid_identifier') {
        return jsonError(
          'validation_failed',
          'Please check the highlighted fields.',
          {
            status: 400,
            details: {
              fields: {
                identifier: isEmailIdentifier(identifier)
                  ? 'Enter a valid email address.'
                  : 'Enter a valid 10-digit Indian mobile number or email address.',
              },
            },
            requestId,
          }
        );
      }
      // Unknown phone: identical to a wrong password, so nothing is enumerated.
      return jsonError('invalid_credentials', 'Invalid mobile number or password. Please try again.', {
        status: 401,
        requestId,
      });
    }

    const { email, phone } = resolution.value;

    const { data, error } = await anon.auth.signInWithPassword({ email, password });

    if (error || !data?.session || !data.user) {
      const message = (error?.message ?? '').toLowerCase();
      if (message.includes('email not confirmed') || message.includes('email_not_confirmed')) {
        // Distinct code only AFTER the account resolved, so it cannot be used
        // to discover whether an arbitrary email has an account.
        return jsonError(
          'email_not_confirmed',
          'Your email address has not been confirmed yet. Please check your inbox for the confirmation link, then sign in again.',
          { status: 403, requestId }
        );
      }
      return jsonError(
        'invalid_credentials',
        phone
          ? 'Invalid mobile number or password. Please try again.'
          : 'Invalid email or password. Please try again.',
        { status: 401, requestId }
      );
    }

    const tokens = toSessionTokens(data.session);

    const state = await evaluateAccountState(tokens, {
      id: data.user.id,
      email: data.user.email ?? email,
    });

    if (state.kind === 'blocked') {
      return mobileFailureResponse(state.failure, requestId);
    }

    return jsonOk(state.payload, { requestId });
  } catch (cause) {
    logServerError('auth.login', requestId, cause);
    return mobileFailureResponse(
      { code: 'database_unavailable', status: 503, message: 'The service is temporarily unavailable. Please try again.' },
      requestId
    );
  }
}

export async function GET(): Promise<Response> {
  return methodNotAllowed(['POST']);
}
