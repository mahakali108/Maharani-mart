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
import { registerRetailerSchema, toSessionTokens } from '@/lib/mobile/auth-api';

/**
 * POST /api/mobile/v1/retailers/register
 *
 * Public retailer sign-up. Mirrors `registerRetailerAction` in
 * `lib/auth/actions.ts` exactly, because the account rows are created by the
 * `handle_new_user()` database trigger from the sign-up metadata — so the
 * metadata keys and the validation are the contract, not an implementation
 * detail of this route.
 *
 * Security properties, all inherited rather than reinvented:
 *   - the body is typed (zod) and the phone is normalized to canonical 10 digits;
 *   - **no `role` is ever sent in the metadata** — the trigger always creates a
 *     pending RETAILER for a public sign-up and ignores any metadata role
 *     (migration 0052). A caller cannot self-assign a privileged role;
 *   - a duplicate phone is detected before `signUp()` via the
 *     `is_phone_registered` RPC (granted to `anon`), so the common case returns
 *     a clean field error instead of failing deep inside the trigger;
 *   - the account lands in `pending_approval` — it cannot read a single
 *     business row until an admin approves it, and the app says so.
 *
 * Responses:
 *   200 `{ ok: true, requiresEmailConfirmation, nextStep: 'pending_approval' }`
 *   400 `validation_failed` / `invalid_area`
 *   409 `conflict` — duplicate phone or email
 *   429 `rate_limited`
 *
 * Contract: docs/NATIVE_ANDROID_API_CONTRACT.md §2.2.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const requestId = newRequestId();

  const limited = enforceRateLimit('auth.login', request, { requestId });
  if (limited) return limited;

  const body = await parseJsonBody(request, registerRetailerSchema, requestId);
  if (!body.ok) return body.response;

  const { fullName, shopName, phone, email, areaId, address, password } = body.data;

  try {
    const anon = createMobileAnonClient();

    const { data: phoneTaken, error: phoneCheckError } = await anon.rpc(
      'is_phone_registered' as never,
      { p_phone: phone } as never
    );

    if (phoneCheckError) {
      logServerError('retailers.register.phone-check', requestId, phoneCheckError);
      return mobileFailureResponse(
        { code: 'database_unavailable', status: 503, message: 'The service is temporarily unavailable. Please try again.' },
        requestId
      );
    }

    if (phoneTaken) {
      return jsonError('conflict', 'Please check the highlighted fields.', {
        status: 409,
        details: { fields: { phone: 'This phone number is already registered.' } },
        requestId,
      });
    }

    const { data: signUpData, error: signUpError } = await anon.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          phone,
          shop_name: shopName,
          area_id: areaId,
          address,
        },
      },
    });

    if (signUpError) {
      const message = signUpError.message.toLowerCase();
      if (message.includes('already registered')) {
        return jsonError('conflict', 'An account with this email already exists. Please sign in instead.', {
          status: 409,
          requestId,
        });
      }
      if (message.includes('invalid_area')) {
        return jsonError('validation_failed', 'Please check the highlighted fields.', {
          status: 400,
          details: { fields: { areaId: 'Select a valid service area.' } },
          requestId,
        });
      }
      if (message.includes('phone_already_registered')) {
        return jsonError('conflict', 'Please check the highlighted fields.', {
          status: 409,
          details: { fields: { phone: 'This phone number is already registered.' } },
          requestId,
        });
      }
      // Never forward the provider's raw message.
      logServerError('retailers.register.signup', requestId, signUpError);
      return jsonError('internal_error', 'Something went wrong. Please try again.', {
        status: 500,
        requestId,
      });
    }

    // With "Confirm email" enabled Supabase returns SUCCESS for an existing
    // address, using an obfuscated user whose `identities` array is empty.
    // Detect that shape so the app does not claim a second account was created.
    const identities = signUpData.user?.identities;
    if (signUpData.user && Array.isArray(identities) && identities.length === 0) {
      return jsonError('conflict', 'An account with this email already exists. Please sign in instead.', {
        status: 409,
        requestId,
      });
    }

    // A session is only present when email confirmation is disabled. Either
    // way the retailer row already exists and is pending approval, so the app
    // is told exactly that — never that the shop is ready to order.
    return jsonOk(
      {
        ok: true,
        requiresEmailConfirmation: !signUpData.session,
        nextStep: 'pending_approval' as const,
        session: signUpData.session ? toSessionTokens(signUpData.session) : null,
      },
      { requestId }
    );
  } catch (cause) {
    logServerError('retailers.register', requestId, cause);
    return mobileFailureResponse(
      { code: 'database_unavailable', status: 503, message: 'The service is temporarily unavailable. Please try again.' },
      requestId
    );
  }
}

export async function GET(): Promise<Response> {
  return methodNotAllowed(['POST']);
}
