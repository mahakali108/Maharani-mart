import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  BoundedWindowLimiter,
  FALLBACK_MAX_ENTRIES,
  SupplierSubmissionLimiter,
  clientIdentityFromHeaders,
  deriveLimiterKey,
  hashLimiterKey,
  hmacLimiterKey,
  EXPIRY_SWEEP_BUDGET,
  limiterKeySource,
  parseRpcResult,
  shouldWarn,
} from '@/lib/admin/supplier-rate-limit';

const KEY = deriveLimiterKey('test-secret-material-for-unit-tests-only');

// The limiter derives HMAC keys from server configuration; give the whole
// file a deterministic test-only secret so the durable path is exercised.
beforeAll(() => {
  vi.stubEnv('SUPPLIER_RATE_LIMIT_SECRET', 'test-only-secret-value-that-is-long-enough-1234567890');
});
afterAll(() => {
  vi.unstubAllEnvs();
});

/** Fake durable backend with the same fixed-window semantics as 0060. */
function fakeDb(nowRef: { now: number }, counters?: Map<string, number>) {
  const rows = new Map<string, { count: number; resetAt: number }>();
  return async (bucket: string, keyHash: string, limit: number, windowSeconds: number) => {
    const key = `${bucket}:${keyHash}`;
    const existing = rows.get(key);
    const row =
      !existing || existing.resetAt <= nowRef.now
        ? { count: 1, resetAt: nowRef.now + windowSeconds * 1000 }
        : { count: Math.min(existing.count + 1, limit + 1), resetAt: existing.resetAt };
    rows.set(key, row);
    counters?.set(key, row.count);
    return {
      allowed: row.count <= limit,
      remaining: Math.max(0, limit - row.count),
      retry_after_seconds: row.count <= limit ? 0 : Math.ceil((row.resetAt - nowRef.now) / 1000),
    };
  };
}

describe('F1 — keyed hashes', () => {
  it('HMAC keys are deterministic per secret and domain-separated', () => {
    const h = hmacLimiterKey('phone', '9876543210', KEY);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain('9876543210');
    expect(hmacLimiterKey('phone', '9876543210', KEY)).toBe(h);
    expect(hmacLimiterKey('client', '9876543210', KEY)).not.toBe(h);
    // a different secret (e.g. after rotation) yields a different bucket
    expect(hmacLimiterKey('phone', '9876543210', deriveLimiterKey('another-secret'))).not.toBe(h);
    // and it is NOT the predictable unsalted SHA-256 of the phone
    const { createHash } = require('node:crypto') as typeof import('node:crypto');
    expect(h).not.toBe(createHash('sha256').update('supplier-app:v1:phone:9876543210').digest('hex'));
  });
  it('missing secret yields null — never a predictable hash', () => {
    expect(hashLimiterKey('phone', '9876543210', null)).toBeNull();
  });
});

describe('client identity from headers (proxy trust)', () => {
  const get = (v: string | null) => () => v;
  it('takes the first XFF hop', () => {
    expect(clientIdentityFromHeaders(get('203.0.113.7, 10.0.0.1'))).toBe('203.0.113.7');
    expect(clientIdentityFromHeaders(get('2001:db8::1'))).toBe('2001:db8::1');
  });
  it('ignores missing and malformed identities', () => {
    expect(clientIdentityFromHeaders(get(null))).toBeNull();
    expect(clientIdentityFromHeaders(get('not-an-ip-address'))).toBeNull();
    expect(clientIdentityFromHeaders(get('a'.repeat(100)))).toBeNull();
  });
});

describe('F5 — RPC result validation', () => {
  it('accepts a well-formed result', () => {
    expect(parseRpcResult({ allowed: true, remaining: 2, retry_after_seconds: 0 })).toEqual({
      allowed: true, remaining: 2, retry_after_seconds: 0,
    });
  });
  it.each([
    ['null', null],
    ['array', [{ allowed: true }]],
    ['string', 'allowed'],
    ['missing allowed', { remaining: 1, retry_after_seconds: 0 }],
    ['non-boolean allowed', { allowed: 'yes', remaining: 1, retry_after_seconds: 0 }],
    ['negative remaining', { allowed: true, remaining: -1, retry_after_seconds: 0 }],
    ['NaN retry', { allowed: false, remaining: 0, retry_after_seconds: NaN }],
    ['huge retry', { allowed: false, remaining: 0, retry_after_seconds: 10 ** 9 }],
    ['missing retry', { allowed: true, remaining: 1 }],
  ])('rejects malformed: %s', (_name, data) => {
    expect(parseRpcResult(data)).toBeNull();
  });
  it('malformed RPC data falls back instead of silently blocking', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const limiter = new SupplierSubmissionLimiter(async () => ({ bogus: true }));
    const r = await limiter.consume('9812345675', null, 9_000_000);
    expect(r.source).toBe('memory-fallback');
    warn.mockRestore();
  });
});

describe('durable limiter: ordering, rotation, concurrency, expiry', () => {
  it('allows under the limit and blocks repeats from one phone', async () => {
    const limiter = new SupplierSubmissionLimiter(fakeDb({ now: 0 }));
    for (let i = 0; i < 3; i++) expect((await limiter.consume('9812345670', null, 0)).allowed).toBe(true);
    expect((await limiter.consume('9812345670', null, 0)).allowed).toBe(false);
  });
  it('F7: client rejection does not consume phone quota', async () => {
    const counters = new Map<string, number>();
    const limiter = new SupplierSubmissionLimiter(fakeDb({ now: 0 }, counters));
    for (let i = 0; i < 10; i++) {
      await limiter.consume(`98123456${String(i).padStart(2, '0')}`, '203.0.113.9', 0);
    }
    const phoneKey = [...counters.keys()].find((k) => k.startsWith('supplier-app-client'));
    expect(phoneKey).toBeTruthy();
    const target = '9812345699';
    const blocked = await limiter.consume(target, '203.0.113.9', 0);
    expect(blocked.allowed).toBe(false);
    // the rejected request never touched the phone bucket
    const phoneConsumptions = [...counters.keys()].filter((k) => k.startsWith('supplier-app-phone'));
    expect(phoneConsumptions).toHaveLength(10); // only the 10 earlier distinct phones
  });
  it('concurrent bursts cannot bypass the modelled atomic limit', async () => {
    const limiter = new SupplierSubmissionLimiter(fakeDb({ now: 0 }));
    const results = await Promise.all(Array.from({ length: 10 }, () => limiter.consume('9812345671', null, 0)));
    expect(results.filter((r) => r.allowed)).toHaveLength(3);
  });
  it('recovers after the window expires (fake clock, no sleeps)', async () => {
    const nowRef = { now: 0 };
    const limiter = new SupplierSubmissionLimiter(fakeDb(nowRef));
    for (let i = 0; i < 3; i++) await limiter.consume('9812345672', null, 0);
    expect((await limiter.consume('9812345672', null, 0)).allowed).toBe(false);
    nowRef.now = 601_000;
    expect((await limiter.consume('9812345672', null, 601_000)).allowed).toBe(true);
  });
});

describe('F3/F6 — bounded fallback + throttled warnings', () => {
  it('BoundedWindowLimiter expires entries and caps map size under rotation', () => {
    const limiter = new BoundedWindowLimiter(3, 600_000, 100);
    for (let i = 0; i < 250; i++) limiter.consume(`k-${i}`, 0);
    expect(limiter.size).toBeLessThanOrEqual(100);
    // a fresh key still gets its window, and the earliest keys were evicted
    expect(limiter.consume('k-249', 0).allowed).toBe(true);
    const small = new BoundedWindowLimiter(1, 1_000, FALLBACK_MAX_ENTRIES);
    expect(small.consume('a', 0).allowed).toBe(true);
    expect(small.consume('a', 500).allowed).toBe(false);
    expect(small.consume('a', 1_001).allowed).toBe(true);
  });
  it('falls back on RPC null/throw, keeps enforcing, and throttles warnings', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const t = 20_000_000;
    const down = new SupplierSubmissionLimiter(async () => null);
    await down.consume('9812345673', null, t);
    await down.consume('9812345673', null, t + 1_000);
    expect(shouldWarn(t + 2_000)).toBe(false); // suppressed within the minute
    const throwing = new SupplierSubmissionLimiter(async () => { throw new Error('missing function'); });
    for (let i = 0; i < 3; i++) expect((await throwing.consume('9812345674', null, t)).allowed).toBe(true);
    expect((await throwing.consume('9812345674', null, t)).allowed).toBe(false);
    expect((await throwing.consume('9812345674', null, t + 601_000)).allowed).toBe(true);
    warn.mockRestore();
  });
});

describe('N2/N3 — LRU cap, recency, incremental expiry', () => {
  it('cap holds after every consume, including hammering the oldest/current key at capacity', () => {
    const lim = new BoundedWindowLimiter(1000, 600_000, 3);
    lim.consume('a', 0); lim.consume('b', 0); lim.consume('c', 0);
    for (let i = 0; i < 50; i++) {
      lim.consume('a', i); // oldest key, repeatedly, at capacity
      expect(lim.size).toBeLessThanOrEqual(3);
    }
    for (let i = 0; i < 50; i++) {
      lim.consume(`u-${i}`, i);
      expect(lim.size).toBeLessThanOrEqual(3);
    }
    expect(lim.size).toBe(3);
  });
  it('refreshing an existing key makes it most-recently-used (LRU eviction order)', () => {
    const lim = new BoundedWindowLimiter(1, 600_000, 3);
    lim.consume('a', 0); lim.consume('b', 0); lim.consume('c', 0);
    lim.consume('a', 1); // refresh a -> LRU order b, c, a
    lim.consume('d', 2); // must evict b, not a
    // b was evicted: with limit 1 a fresh consume is allowed; a survived: blocked
    expect(lim.consume('b', 3).allowed).toBe(true);
    expect(lim.consume('a', 3).allowed).toBe(false);
  });
  it('evicting a still-active key forgets its count (documented bounded-memory trade-off)', () => {
    const lim = new BoundedWindowLimiter(1, 600_000, 2);
    expect(lim.consume('victim', 0).allowed).toBe(true);
    expect(lim.consume('victim', 1).allowed).toBe(false);
    lim.consume('x', 2); lim.consume('y', 3); // pressure evicts victim (LRU)
    // Accepted limitation under memory pressure, documented in the limiter:
    expect(lim.consume('victim', 4).allowed).toBe(true);
    expect(lim.size).toBeLessThanOrEqual(2);
  });
  it('expired vs unexpired boundary stays exact without waiting for the sweep', () => {
    const lim = new BoundedWindowLimiter(1, 1_000, 10);
    expect(lim.consume('k', 0).allowed).toBe(true);
    expect(lim.consume('k', 999).allowed).toBe(false);
    expect(lim.consume('k', 1_000).allowed).toBe(true);
  });
  it('incremental sweep: bounded work per consume, steady progress, bounded queue', () => {
    const lim = new BoundedWindowLimiter(5, 1_000, 500);
    for (let i = 0; i < 200; i++) lim.consume(`e-${i}`, 0);
    expect(lim.pendingExpiryRecords).toBe(200);
    // all 200 expire; ONE consume may process at most EXPIRY_SWEEP_BUDGET
    lim.consume('fresh', 2_000);
    expect(lim.size).toBeGreaterThan(200 - EXPIRY_SWEEP_BUDGET);
    expect(lim.size).toBeLessThanOrEqual(200 - 1); // but progress was made
    // further consumes finish the reclaim
    for (let i = 0; i < 5; i++) lim.consume(`fresh-${i}`, 2_000);
    expect(lim.size).toBeLessThanOrEqual(6);
  });
  it('repeated updates to one key create a single expiry record; rotation stays bounded', () => {
    const lim = new BoundedWindowLimiter(10_000, 600_000, 100);
    for (let i = 0; i < 500; i++) lim.consume('same', i);
    expect(lim.pendingExpiryRecords).toBe(1);
    for (let i = 0; i < 1_000; i++) lim.consume(`r-${i}`, 0);
    expect(lim.size).toBeLessThanOrEqual(100);
    expect(lim.pendingExpiryRecords).toBeLessThanOrEqual(201); // <= 2*maxEntries + 1
  });
});

describe('N4 — secret selection cases', () => {
  const VALID = 'd'.repeat(40);
  it('classifies every selection case explicitly', () => {
    expect(limiterKeySource({})).toBe('unavailable');
    expect(limiterKeySource({ SUPPLIER_RATE_LIMIT_SECRET: '   ' })).toBe('unavailable');
    expect(limiterKeySource({ SUPPLIER_RATE_LIMIT_SECRET: VALID })).toBe('dedicated');
    expect(limiterKeySource({ SUPPLIER_RATE_LIMIT_SECRET: `  ${VALID}  ` })).toBe('dedicated'); // trimmed
    expect(limiterKeySource({ SUPPLIER_RATE_LIMIT_SECRET: 'x'.repeat(31) })).toBe('invalid-config');
    expect(limiterKeySource({ SUPPLIER_RATE_LIMIT_SECRET: 'x'.repeat(32) })).toBe('dedicated');
    expect(limiterKeySource({ SUPABASE_SERVICE_ROLE_KEY: 'svc' })).toBe('service-derived');
    // invalid dedicated must NOT fall through to the service-derived key
    expect(limiterKeySource({ SUPPLIER_RATE_LIMIT_SECRET: 'short', SUPABASE_SERVICE_ROLE_KEY: 'svc' })).toBe('invalid-config');
  });
  it('invalid dedicated secret yields no durable key even with a service key present (no unsalted hash)', () => {
    vi.stubEnv('SUPPLIER_RATE_LIMIT_SECRET', 'short-secret');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-material-for-test');
    expect(hashLimiterKey('phone', '9812345678')).toBeNull();
    vi.stubEnv('SUPPLIER_RATE_LIMIT_SECRET', '');
    const derived = hashLimiterKey('phone', '9812345678');
    expect(derived).toMatch(/^[0-9a-f]{64}$/); // service-derived works when dedicated absent
    vi.stubEnv('SUPPLIER_RATE_LIMIT_SECRET', VALID);
    const dedicated = hashLimiterKey('phone', '9812345678');
    expect(dedicated).toMatch(/^[0-9a-f]{64}$/);
    expect(dedicated).not.toBe(derived); // distinct key sources, distinct buckets
    vi.stubEnv('SUPPLIER_RATE_LIMIT_SECRET', 'test-only-secret-value-that-is-long-enough-1234567890');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
  });
  it('invalid-config consume warns (identifier-free) and still uses the bounded fallback', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('SUPPLIER_RATE_LIMIT_SECRET', 'short-secret');
    const limiter = new SupplierSubmissionLimiter(async () => { throw new Error('must not be called with durable keys'); });
    const r = await limiter.consume('9812345680', null, 300_000_000);
    expect(r.source).toBe('memory-fallback');
    const messages = warn.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes('invalid'))).toBe(true);
    expect(messages.join(' ')).not.toContain('short-secret');
    vi.stubEnv('SUPPLIER_RATE_LIMIT_SECRET', 'test-only-secret-value-that-is-long-enough-1234567890');
    warn.mockRestore();
  });
});

describe('N6 — warning throttle through the real limiter path', () => {
  it('one warning per 60s across null/malformed/throwing RPC failures, resuming after', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const T = 400_000_000;
    const failures: Array<() => Promise<unknown>> = [
      async () => null,
      async () => ({ bogus: 1 }),
      async () => { throw new Error('down'); },
    ];
    for (let round = 0; round < 3; round++) {
      const limiter = new SupplierSubmissionLimiter(failures[round]!);
      await limiter.consume(`98123457${round}0`, null, T + round * 1_000);
    }
    expect(warn.mock.calls).toHaveLength(1);
    const after = new SupplierSubmissionLimiter(failures[0]!);
    await after.consume('9812345799', null, T + 61_000);
    expect(warn.mock.calls).toHaveLength(2);
    for (const call of warn.mock.calls) {
      expect(String(call[0])).not.toMatch(/98123|supplier-app:|SUPPLIER_RATE_LIMIT_SECRET=/);
    }
    warn.mockRestore();
  });
  it('non-finite clock never warns repeatedly and does not poison the throttle', () => {
    expect(shouldWarn(Number.NaN)).toBe(false);
    expect(shouldWarn(Number.NaN)).toBe(false);
    expect(shouldWarn(Number.POSITIVE_INFINITY)).toBe(false);
  });
});
