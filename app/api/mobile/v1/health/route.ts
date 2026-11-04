import { createClient } from '@/lib/supabase/server';
import {
  MOBILE_API_VERSION,
  jsonError,
  jsonOk,
  logServerError,
  methodNotAllowed,
  newRequestId,
} from '@/lib/mobile';

/**
 * GET /api/mobile/v1/health
 *
 * Unauthenticated reachability probe for the Android app. Deliberately SHAPED
 * differently from the operational `/api/health`: this one is part of the
 * versioned mobile contract and answers "can the app reach the API and the
 * database" with the mobile envelope.
 *
 * It exposes no version numbers, hostnames, driver text or configuration —
 * only whether the database answered and the server's clock (which the client
 * uses to detect clock skew before relying on token expiry).
 *
 * Contract: docs/NATIVE_ANDROID_API_CONTRACT.md §2.1.
 */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const requestId = newRequestId();
  const startedAt = Date.now();

  try {
    const supabase = (await createClient());
    const { error } = await supabase.from('areas').select('id', { count: 'exact', head: true });

    if (error) {
      // Real cause stays server-side; the client gets a retryable code.
      logServerError('health', requestId, error.message);
      return jsonError('database_unavailable', 'The service is temporarily unavailable.', {
        status: 503,
        requestId,
      });
    }

    return jsonOk(
      {
        status: 'ok',
        database: 'reachable',
        apiVersion: MOBILE_API_VERSION,
        serverTime: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
      },
      { requestId }
    );
  } catch (cause) {
    logServerError('health', requestId, cause);
    return jsonError('internal_error', 'Something went wrong. Please try again.', {
      status: 500,
      requestId,
    });
  }
}

export async function POST(): Promise<Response> {
  return methodNotAllowed(['GET']);
}
