import {
  enforceRateLimit,
  jsonOk,
  logServerError,
  newRequestId,
  parseJsonBody,
  methodNotAllowed,
} from '@/lib/mobile';
import { createMobileAnonClient } from '@/lib/mobile/clients';
import { passwordResetSchema } from '@/lib/mobile/auth-api';

/**
 * POST /api/mobile/v1/auth/password-reset
 *
 * Body: `{ email }` → always `200 { ok: true }`.
 *
 * The response is constant whether or not the address has an account, so this
 * endpoint cannot be used to enumerate users. Rate limited at
 * `auth.password_reset` (5/hour per caller) because it triggers an outbound
 * email.
 *
 * HONEST LIMITATION — the reset link lands on the WEB reset page, not in the
 * app: Supabase sends the recovery link to `/auth/callback?next=/reset-password`
 * on `NEXT_PUBLIC_SITE_URL`, where the session is exchanged server-side and the
 * user sets a new password. Delivering the recovery deep link into the Android
 * app needs an app-link/assetlinks setup that does not exist yet, so this
 * endpoint is documented as "reset via the website" rather than pretending to
 * be a native flow. `POST /auth/password-update` (below, authenticated) IS the
 * native path for a signed-in user.
 *
 * Contract: docs/NATIVE_ANDROID_API_CONTRACT.md §2.2.
 */
export const dynamic = 'force-dynamic';

const GENERIC_MESSAGE =
  'If an account exists for that email, you will receive a password reset link shortly.';

export async function POST(request: Request): Promise<Response> {
  const requestId = newRequestId();

  const limited = enforceRateLimit('auth.password_reset', request, { requestId });
  if (limited) return limited;

  const body = await parseJsonBody(request, passwordResetSchema, requestId);
  if (!body.ok) return body.response;

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/+$/, '');

  try {
    const anon = createMobileAnonClient();
    const { error } = await anon.auth.resetPasswordForEmail(body.data.email, {
      redirectTo: `${siteUrl}/auth/callback?next=/reset-password`,
    });
    // Supabase already avoids revealing whether the address exists; log the
    // real cause and answer generically regardless.
    if (error) logServerError('auth.password-reset', requestId, error);
  } catch (cause) {
    logServerError('auth.password-reset', requestId, cause);
  }

  return jsonOk({ ok: true, message: GENERIC_MESSAGE }, { requestId });
}

export async function GET(): Promise<Response> {
  return methodNotAllowed(['POST']);
}
