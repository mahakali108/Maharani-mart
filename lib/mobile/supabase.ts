import 'server-only';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.types';

/**
 * Supabase client for a mobile request, scoped to the CALLER'S bearer token.
 *
 * The token is attached as the PostgREST `Authorization` header, so every
 * query this client runs is subject to the same RLS policies as a browser
 * session with that user's JWT. This is deliberate: the mobile API never
 * bypasses RLS to "make Android work".
 *
 * No session is persisted or auto-refreshed here — the client is per-request
 * and the Android app owns its own token lifecycle through
 * `/api/mobile/v1/auth/*`.
 *
 * The service-role client (`createServiceRoleClient`) is intentionally NOT
 * referenced by this module or by any user-scoped mobile read/write.
 */
export function createMobileSupabaseClient(accessToken: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    // Fail loudly server-side; the route turns this into a sanitized 500.
    throw new Error('Supabase environment is not configured for the mobile API.');
  }

  return createSupabaseClient<Database>(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  });
}

export type MobileSupabaseClient = ReturnType<typeof createMobileSupabaseClient>;
