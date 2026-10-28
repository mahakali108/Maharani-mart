import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * /api/cron/ai-cleanup — the AI-only 14-day scheduler (migration 0084).
 *
 * Security properties under test:
 *   - fails CLOSED when CRON_SECRET is not configured (503, no DB call)
 *   - rejects a missing or wrong bearer token (401, no DB call)
 *   - accepts the exact token and calls ONLY run_ai_data_cleanup
 *   - never touches the general cleanup function
 *   - supports an explicit dry run and logs nothing about row contents
 */

const rpc = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: () => ({ rpc }),
}));

async function callRoute(url = 'https://example.test/api/cron/ai-cleanup', headers: Record<string, string> = {}) {
  const { GET } = await import('@/app/api/cron/ai-cleanup/route');
  return GET(new NextRequest(url, { headers }));
}

describe('/api/cron/ai-cleanup', () => {
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: { runId: 'ai-cleanup-2026-10-27-abcdef12', totalDeleted: 0 }, error: null });
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalSecret;
  });

  it('fails closed with 503 when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET;
    const response = await callRoute();
    expect(response.status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects a missing bearer token', async () => {
    process.env.CRON_SECRET = 'test-secret';
    const response = await callRoute();
    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects a wrong bearer token', async () => {
    process.env.CRON_SECRET = 'test-secret';
    const response = await callRoute(undefined, { authorization: 'Bearer wrong-secret' });
    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('runs the AI-only function when the secret matches', async () => {
    process.env.CRON_SECRET = 'test-secret';
    const response = await callRoute(undefined, { authorization: 'Bearer test-secret' });
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, params] = rpc.mock.calls[0]!;
    expect(fn).toBe('run_ai_data_cleanup');
    expect(fn).not.toBe('run_data_cleanup');
    expect(fn).not.toBe('cleanup_old_data');
    expect(params).toMatchObject({ p_dry_run: false, p_triggered_by: 'cron', p_batch_size: 500 });
  });

  it('honours ?dry_run=1 without deleting', async () => {
    process.env.CRON_SECRET = 'test-secret';
    const response = await callRoute('https://example.test/api/cron/ai-cleanup?dry_run=1', {
      authorization: 'Bearer test-secret',
    });
    expect(response.status).toBe(200);
    expect(rpc.mock.calls[0]![1]).toMatchObject({ p_dry_run: true });
  });

  it('reports a database failure without echoing any row content', async () => {
    process.env.CRON_SECRET = 'test-secret';
    rpc.mockResolvedValue({ data: null, error: { message: 'AI_RETENTION_REGISTRY_MISMATCH' } });
    const response = await callRoute(undefined, { authorization: 'Bearer test-secret' });
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('AI_RETENTION_REGISTRY_MISMATCH');
    expect(JSON.stringify(body)).not.toMatch(/@|prompt|response/i);
  });
});
