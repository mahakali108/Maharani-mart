/**
 * F-1 regression: service-role client CONSTRUCTION failure must reach
 * the limiter's documented fail-open fallback instead of aborting the
 * public submission. Uses the repo's module-mock convention
 * (vi.mock of @/lib/supabase/server, next/headers, next/cache).
 * No real client, network, or database is involved.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  anonClient: vi.fn(),
  serviceFactory: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.anonClient,
  createServiceRoleClient: mocks.serviceFactory,
}));
vi.mock('next/headers', () => ({
  headers: () => ({ get: (_name: string) => null }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/admin/guard', () => ({ requirePermission: vi.fn() }));

import { submitSupplierApplicationAction } from '@/lib/admin/supplier-actions';
import { createSupplierSubmissionLimiterFromFactory } from '@/lib/admin/supplier-rate-limit';

function form(phone = '9876543210'): FormData {
  const fd = new FormData();
  fd.set('businessName', 'Sharma Wholesale');
  fd.set('contactName', 'A Sharma');
  fd.set('phone', phone);
  fd.set('productCategories', 'FMCG');
  return fd;
}

function anonOk() {
  return { rpc: vi.fn(async () => ({ data: null, error: null })) };
}
function serviceOk() {
  return {
    rpc: vi.fn(async () => ({
      data: { allowed: true, remaining: 9, retry_after_seconds: 0 },
      error: null,
    })),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('SUPPLIER_RATE_LIMIT_SECRET', 'test-only-secret-value-that-is-long-enough-1234567890');
});
afterAll(() => vi.unstubAllEnvs());

describe('F-1: privileged-client construction failure', () => {
  it('factory throw reaches the fail-open fallback; submission proceeds via the anon client', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const anon = anonOk();
    mocks.anonClient.mockReturnValue(anon);
    mocks.serviceFactory.mockImplementation(() => {
      throw new Error('supabaseUrl is required'); // config-style construction failure
    });
    const result = await submitSupplierApplicationAction(form());
    expect(result).toEqual({ ok: true });
    // public submission still happened, on the anon-context client only
    expect(anon.rpc).toHaveBeenCalledTimes(1);
    expect((anon.rpc.mock.calls as unknown[][])[0]![0]).toBe('submit_supplier_application');
    // no warning/error output leaks identifiers
    const logged = [...warn.mock.calls].map((c) => String(c[0])).join(' ');
    expect(logged).not.toContain('9876543210');
    warn.mockRestore();
  });

  it('limiter RPC through the service client uses server-controlled args; submission stays on anon client', async () => {
    const anon = anonOk();
    const service = serviceOk();
    mocks.anonClient.mockReturnValue(anon);
    mocks.serviceFactory.mockReturnValue(service);
    const result = await submitSupplierApplicationAction(form());
    expect(result).toEqual({ ok: true });
    expect(service.rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = (service.rpc.mock.calls as unknown[][])[0]! as unknown as [string, Record<string, unknown>];
    expect(fn).toBe('consume_supplier_application_rate_limit');
    expect(args.p_bucket).toBe('supplier-app-phone');
    expect(args.p_limit).toBe(3);
    expect(args.p_window_seconds).toBe(600);
    expect(String(args.p_key_hash)).toMatch(/^[0-9a-f]{64}$/);
    expect(String(args.p_key_hash)).not.toContain('9876543210');
    expect((anon.rpc.mock.calls as unknown[][])[0]![0]).toBe('submit_supplier_application');
  });

  it('limiter RPC error also falls back without exposing internals', async () => {
    mocks.anonClient.mockReturnValue(anonOk());
    mocks.serviceFactory.mockReturnValue({
      rpc: vi.fn(async () => ({ data: null, error: { message: 'function missing' } })),
    });
    const result = await submitSupplierApplicationAction(form());
    expect(result).toEqual({ ok: true });
    expect(JSON.stringify(result)).not.toContain('function missing');
  });

  it('submission failure is NOT swallowed as a limiter failure (no false success)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const anon = { rpc: vi.fn(async () => ({ data: null, error: { code: 'XX000', message: 'db down' } })) };
    mocks.anonClient.mockReturnValue(anon);
    mocks.serviceFactory.mockReturnValue(serviceOk());
    const result = await submitSupplierApplicationAction(form());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('Your application could not be submitted right now. Please try again later.');
    expect(JSON.stringify(result)).not.toContain('db down');
    errSpy.mockRestore();
  });

  it('validation still stops before any RPC or client construction', async () => {
    mocks.anonClient.mockReturnValue(anonOk());
    mocks.serviceFactory.mockReturnValue(serviceOk());
    const fd = new FormData();
    fd.set('phone', '123'); // invalid everything
    const result = await submitSupplierApplicationAction(fd);
    expect(result.ok).toBe(false);
    expect(mocks.serviceFactory).not.toHaveBeenCalled();
    expect(mocks.anonClient).not.toHaveBeenCalled();
  });

  it('factory wrapper alone: throwing factory yields a working fallback limiter', async () => {
    const limiter = createSupplierSubmissionLimiterFromFactory(() => {
      throw new Error('no config');
    });
    const r = await limiter.consume('9876543211', null, 500_000_000);
    expect(r).toEqual({ allowed: true, source: 'memory-fallback', retryAfterSeconds: 0 });
  });
});
