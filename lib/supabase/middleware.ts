import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { Database } from '@/types/database.types';

interface PendingCookie {
  name: string;
  value: string;
  options?: CookieOptions;
}

/**
 * Refreshes the Supabase auth session on every request and returns
 * both the (possibly rewritten) response and a Supabase client bound
 * to that response's cookies, so middleware.ts can query the DB
 * (e.g. to look up the caller's role) with a valid session.
 *
 * Cookie handling: @supabase/ssr calls `set`/`remove` once PER cookie during a
 * refresh, and a large session is split into chunks (`sb-<ref>-auth-token.0`,
 * `.1`, ...). The response is therefore created ONCE, after the refresh has
 * finished, and every pending cookie is written onto it. Creating a fresh
 * response inside `set` (the previous behaviour) discarded every cookie written
 * before the last one, so a chunked session was lost and the user was asked to
 * sign in again.
 */
export async function updateSession(request: NextRequest) {
  const pending: PendingCookie[] = [];
  let response: NextResponse | undefined;

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          // Visible to the rest of this middleware run (later queries read it).
          request.cookies.set({ name, value, ...options });
          pending.push({ name, value, options });
          response?.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: '', ...options });
          pending.push({ name, value: '', options });
          response?.cookies.set({ name, value: '', ...options });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  response = NextResponse.next({ request: { headers: request.headers } });
  for (const cookie of pending) {
    response.cookies.set({ name: cookie.name, value: cookie.value, ...cookie.options });
  }

  return { response, supabase, user };
}
