/**
 * /api/health — public uptime probe.
 *
 * Regression for the production stability audit: the endpoint used to echo
 * the raw driver error (e.g. "TypeError: fetch failed", or whatever message
 * PostgREST produced) to unauthenticated callers. It must keep the useful
 * status semantics (200 ok / 503 degraded / 500 error) while exposing no
 * internal error details.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));

import { GET } from '@/app/api/health/route';

function clientWithResult(result: { error: { message: string } | null }) {
  return {
    from: () => ({
      select: () => Promise.resolve(result),
    }),
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('GET /api/health', () => {
  it('returns 200 ok when the database answers', async () => {
    mocks.createClient.mockReturnValue(clientWithResult({ error: null }));
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.database).toBe('reachable');
    expect(typeof body.latencyMs).toBe('number');
  });

  it('returns 503 degraded without leaking the driver error message', async () => {
    mocks.createClient.mockReturnValue(
      clientWithResult({ error: { message: 'TypeError: fetch failed at https://secret-ref.supabase.co' } })
    );
    const res = await GET();
    expect(res.status).toBe(503);
    const text = JSON.stringify(await res.json());
    expect(text).toContain('degraded');
    expect(text).not.toContain('fetch failed');
    expect(text).not.toContain('secret-ref');
    // the real reason still lands in the server log
    expect(console.error).toHaveBeenCalled();
  });

  it('returns 500 without leaking exception details when the client throws', async () => {
    mocks.createClient.mockImplementation(() => {
      throw new Error('connection string postgres://user:password@host');
    });
    const res = await GET();
    expect(res.status).toBe(500);
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain('password');
    expect(text).not.toContain('postgres://');
    expect(console.error).toHaveBeenCalled();
  });
});
