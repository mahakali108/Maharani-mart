import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

/**
 * Regression test: Supabase SSR refreshes the session through one `set` call
 * PER cookie. A session that is too large for one cookie is split into chunks
 * (`sb-<ref>-auth-token.0`, `.1`, ...). The middleware must return ALL of them
 * to the browser. Previously every `set` call replaced the response object, so
 * only the last chunk survived, the session became unreadable on the next
 * request, and the user was sent back to the login screen.
 */

type CookieCall = { name: string; value: string; options?: Record<string, unknown> };

const refreshCalls: Array<{ kind: 'set' | 'remove'; name: string; value?: string }> = [];

vi.mock('@supabase/ssr', () => ({
  createServerClient: (
    _url: string,
    _key: string,
    opts: {
      cookies: {
        get(name: string): string | undefined;
        set(name: string, value: string, options: Record<string, unknown>): void;
        remove(name: string, options: Record<string, unknown>): void;
      };
    },
  ) => ({
    auth: {
      getUser: async () => {
        // Simulate a token refresh that rewrites a chunked session cookie.
        for (const [name, value] of [
          ['sb-test-auth-token.0', 'chunk-zero-new'],
          ['sb-test-auth-token.1', 'chunk-one-new'],
        ] as const) {
          opts.cookies.set(name, value, { path: '/', maxAge: 3600 });
          refreshCalls.push({ kind: 'set', name, value });
        }
        opts.cookies.remove('sb-test-stale-cookie', { path: '/' });
        refreshCalls.push({ kind: 'remove', name: 'sb-test-stale-cookie' });
        return { data: { user: { id: 'user-1' } } };
      },
    },
  }),
}));

import { NextRequest as NR } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

function makeRequest(): NextRequest {
  return new NR('https://example.test/retailer/home', {
    headers: { cookie: 'sb-test-auth-token.0=old-zero; sb-test-stale-cookie=stale' },
  });
}

function setCookieNames(res: { cookies: { getAll(): CookieCall[] } }): string[] {
  return res.cookies.getAll().map((c) => c.name);
}

describe('updateSession (middleware Supabase cookie handling)', () => {
  beforeEach(() => {
    refreshCalls.length = 0;
  });

  it('returns every refreshed session chunk, not only the last one', async () => {
    const { response } = await updateSession(makeRequest());
    const names = setCookieNames(response as never);
    expect(names).toContain('sb-test-auth-token.0');
    expect(names).toContain('sb-test-auth-token.1');
  });

  it('keeps the refreshed values for each chunk', async () => {
    const { response } = await updateSession(makeRequest());
    const byName = new Map(
      (response as never as { cookies: { getAll(): CookieCall[] } }).cookies
        .getAll()
        .map((c) => [c.name, c.value] as const),
    );
    expect(byName.get('sb-test-auth-token.0')).toBe('chunk-zero-new');
    expect(byName.get('sb-test-auth-token.1')).toBe('chunk-one-new');
  });

  it('forwards the removal of stale cookies alongside the refreshed ones', async () => {
    const { response } = await updateSession(makeRequest());
    const removed = (response as never as { cookies: { getAll(): CookieCall[] } }).cookies
      .getAll()
      .find((c) => c.name === 'sb-test-stale-cookie');
    expect(removed).toBeDefined();
    expect(removed?.value).toBe('');
  });

  it('exposes the refreshed user to the caller', async () => {
    const { user } = await updateSession(makeRequest());
    expect(user).toEqual({ id: 'user-1' });
  });
});
