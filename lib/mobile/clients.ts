import 'server-only';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.types';

/**
 * Supabase clients used by the `/api/mobile/v1/auth/*` endpoints.
 *
 * WHY THESE EXIST SEPARATELY FROM `lib/mobile/supabase.ts`
 * ------------------------------------------------------
 * `createMobileSupabaseClient(token)` is *user-scoped*: it carries the caller's
 * bearer token so PostgREST enforces RLS as that user. The auth endpoints run
 * BEFORE a session exists (sign-in) or need to act on a session itself
 * (refresh), so they need two different clients:
 *
 *   - anon          — the same public anon key the web app ships. Used only to
 *                     call GoTrue (`signInWithPassword`, `signUp`,
 *                     `refreshSession`, `resetPasswordForEmail`) and the
 *                     `is_phone_registered` RPC, which is granted to `anon`.
 *                     It cannot read a single business row: RLS still applies.
 *   - service_role  — used for exactly ONE thing: resolving a phone number to
 *                     the account's email address. PostgREST is not reachable
 *                     with this key by any client; it never leaves the server,
 *                     and no query built from caller-supplied input other than
 *                     the normalized phone number is issued with it.
 *
 * Neither client is ever returned to a caller, and neither key is logged.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    // Fail loudly server-side; the route turns this into a sanitized 503.
    throw new Error(`Supabase environment is not configured for the mobile API (${name} missing).`);
  }
  return value;
}

/** Public-key client for GoTrue auth calls. No session persistence. */
export function createMobileAnonClient() {
  return createSupabaseClient<Database>(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  );
}

/**
 * Privileged client. Server-only, single-purpose (phone → email resolution).
 *
 * `persistSession: false` matters: without it the client would try to write the
 * service-role session to storage in a serverless runtime.
 */
export function createMobileServiceRoleClient() {
  return createSupabaseClient<Database>(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  );
}

/**
 * Direct GoTrue call using the CALLER'S OWN access token.
 *
 * Used for logout and password change, where the operation must be performed
 * as the user (so only that one session is revoked, and the password policy is
 * GoTrue's, not ours). supabase-js cannot do this cleanly without a persisted
 * session, so the request is issued directly.
 *
 * The token is placed in the `Authorization` header only — never a query
 * string, never a body, never a log line.
 */
export async function gotrueFetch(
  path: string,
  init: { method: string; accessToken: string; body?: unknown }
): Promise<{ ok: boolean; status: number }> {
  const base = requireEnv('NEXT_PUBLIC_SUPABASE_URL').replace(/\/+$/, '');
  const anonKey = requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');

  const response = await fetch(`${base}/auth/v1${path}`, {
    method: init.method,
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${init.accessToken}`,
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: 'no-store',
  });

  return { ok: response.ok, status: response.status };
}
