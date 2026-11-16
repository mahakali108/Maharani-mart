import 'server-only';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '@/types/database.types';

/**
 * Server-side Supabase client for use in Server Components, Server
 * Actions, and Route Handlers. Reads/writes the auth cookie via
 * next/headers so the session survives across requests.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      /**
       * Pin the implicit flow for server-side auth.
       *
       * WHY: `signInWithOtp()` behaves differently per flow type. Under PKCE it
       * also mints a `code_verifier` cookie and sends `{{ .ConfirmationURL }}`
       * (a magic LINK) in the email; the numeric `{{ .Token }}` then only
       * exists to satisfy a later `verifyOtp()`. Two consequences:
       *   1. A code-based login would depend on a second cookie surviving
       *      round-trips, and a stale verifier makes `verifyOtp()` fail —
       *      burning one of only 30 verify attempts per hour. `verifyOtp()`
       *      does not need PKCE: it posts email+token and receives the session
       *      directly (auth-js 2.110.7, GoTrueClient.verifyOtp).
       *   2. Under PKCE the emailed template must differ from the Magic Link
       *      template, which doubles the owner's setup surface.
       *
       * With the implicit flow the SAME `Magic Link` template can carry the
       * code, and email-OTP needs no verifier cookie at all. The password and
       * phone flows are unaffected — they never use flowType.
       */
      auth: { flowType: 'implicit' },
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            // Called from a Server Component — safe to ignore because
            // middleware.ts refreshes the session on every request.
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: '', ...options });
          } catch {
            // Same as above — ignorable when called from a Server Component.
          }
        },
      },
    }
  );
}

/**
 * Privileged server-only client using the service role key.
 * NEVER import this into a Client Component or expose it to the browser.
 * Reserved for admin-side operations (Phase 2: creating staff/salesman
 * accounts, etc.) that must bypass RLS deliberately and safely.
 */
export function createServiceRoleClient() {
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: {
        get() { return undefined; },
        set() {},
        remove() {},
      },
    }
  );
}
