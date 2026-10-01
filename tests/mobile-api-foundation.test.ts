/**
 * `/api/mobile/v1` foundation — Phase B contract tests.
 *
 * Covers the shared helpers (envelope, body parsing, pagination, rate limiting,
 * bearer-session resolution) plus the two endpoints that exist today, and the
 * static security assertions the migration plan requires for the Android
 * sources (no secrets, no WebView, cleartext disabled, minimal exports).
 *
 * These tests run in the repository's existing vitest harness — the Android UI
 * is deliberately not needed to verify the API contract.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createMobileSupabaseClient: vi.fn(),
  createServerClient: vi.fn(),
}));

vi.mock('@/lib/mobile/supabase', () => ({
  createMobileSupabaseClient: mocks.createMobileSupabaseClient,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createServerClient,
}));

import {
  classifyTokenFailure,
  consumeRateLimit,
  decodeCursor,
  encodeCursor,
  isAccessPeriodValid,
  pageEnvelope,
  parseJsonBody,
  parsePageParams,
  rateLimitResponse,
  requireMobileSession,
  resetRateLimits,
  RATE_LIMITS,
  bearerToken,
  jsonError,
  jsonOk,
  tokenExpirySeconds,
} from '@/lib/mobile';
import { GET as getHealth, POST as postHealth } from '@/app/api/mobile/v1/health/route';
import { GET as getSession } from '@/app/api/mobile/v1/session/route';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface FakeResult {
  data: unknown;
  error: { message: string } | null;
}

function fakeQuery(result: FakeResult) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: async () => result,
    single: async () => result,
  };
  return builder;
}

function fakeClient(config: {
  user?: { id: string; email?: string | null } | null;
  authError?: { message: string } | null;
  tables?: Record<string, FakeResult>;
}) {
  return {
    auth: {
      getUser: async () =>
        config.authError
          ? { data: { user: null }, error: config.authError }
          : { data: { user: config.user ?? null }, error: null },
    },
    from: (table: string) => fakeQuery(config.tables?.[table] ?? { data: null, error: null }),
  };
}

const ACTIVE_RETAILER_TABLES: Record<string, FakeResult> = {
  profiles: { data: { role: 'retailer', full_name: 'Gupta Kirana', is_active: true, phone: '9876543210' }, error: null },
  retailers: { data: { status: 'active', shop_name: 'Gupta Kirana Store' }, error: null },
  user_access_periods: { data: null, error: null },
};

/** Build an unsigned JWT-shaped string; only the payload is inspected locally. */
function fakeJwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`;
}

function authorizedRequest(token = 'token-abc', url = 'https://api.example.com/api/mobile/v1/session') {
  return new Request(url, { headers: { authorization: `Bearer ${token}` } });
}

beforeEach(() => {
  vi.restoreAllMocks();
  resetRateLimits();
  mocks.createMobileSupabaseClient.mockReset();
  mocks.createServerClient.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

// ---------------------------------------------------------------------------
// 1. Response envelope
// ---------------------------------------------------------------------------

describe('mobile response envelope', () => {
  it('wraps success data and stamps a request id', async () => {
    const response = jsonOk({ ok: true });
    expect(response.status).toBe(200);
    expect(response.headers.get('X-Request-Id')).toBeTruthy();
    const body = await response.json();
    expect(body.data).toEqual({ ok: true });
    expect(body.requestId).toBe(response.headers.get('X-Request-Id'));
  });

  it('returns the standard error shape with code, message and request id', async () => {
    const response = jsonError('forbidden', 'You do not have permission to do that.', { status: 403 });
    const body = await response.json();
    expect(response.status).toBe(403);
    expect(body.error.code).toBe('forbidden');
    expect(body.error.message).toContain('permission');
    expect(body.error.details).toBeUndefined(); // omitted unless supplied
    expect(body.requestId).toBe(response.headers.get('X-Request-Id'));
  });
});

// ---------------------------------------------------------------------------
// 2. Body parsing / validation
// ---------------------------------------------------------------------------

describe('parseJsonBody', () => {
  const schema = z.object({ quantity: z.number().int().positive() });

  it('accepts a valid body', async () => {
    const request = new Request('https://api.example.com/x', {
      method: 'POST',
      body: JSON.stringify({ quantity: 3 }),
    });
    const parsed = await parseJsonBody(request, schema);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.data).toEqual({ quantity: 3 });
  });

  it('rejects invalid JSON with invalid_json', async () => {
    const request = new Request('https://api.example.com/x', { method: 'POST', body: '{oops' });
    const parsed = await parseJsonBody(request, schema);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.response.status).toBe(400);
      const body = await parsed.response.json();
      expect(body.error.code).toBe('invalid_json');
    }
  });

  it('reports field-level validation errors without echoing the payload', async () => {
    const request = new Request('https://api.example.com/x', {
      method: 'POST',
      body: JSON.stringify({ quantity: -2, secret: 'should-not-be-echoed' }),
    });
    const parsed = await parseJsonBody(request, schema);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      const text = JSON.stringify(await parsed.response.json());
      expect(JSON.parse(text).error.details.fields.quantity).toBeTruthy();
      expect(text).not.toContain('should-not-be-echoed');
    }
  });

  it('rejects oversized bodies before parsing them', async () => {
    const big = 'x'.repeat(40 * 1024);
    const request = new Request('https://api.example.com/x', {
      method: 'POST',
      body: JSON.stringify({ quantity: 1, padding: big }),
    });
    const parsed = await parseJsonBody(request, schema);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.response.status).toBe(413);
      expect((await parsed.response.json()).error.code).toBe('payload_too_large');
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Pagination
// ---------------------------------------------------------------------------

describe('pagination', () => {
  it('applies the default limit and clamps hostile values', () => {
    expect(parsePageParams('https://x/?').limit).toBe(20);
    expect(parsePageParams('https://x/?limit=9999').limit).toBe(50);
    expect(parsePageParams('https://x/?limit=9999', { maxLimit: 240 }).limit).toBe(240);
    expect(parsePageParams('https://x/?limit=0').limit).toBe(1);
    expect(parsePageParams('https://x/?limit=-5').limit).toBe(1);
    expect(parsePageParams('https://x/?limit=abc', { defaultLimit: 24 }).limit).toBe(24);
  });

  it('round-trips opaque cursors and rejects malformed ones', () => {
    const cursor = encodeCursor({ created_at: '2026-10-01T00:00:00.000Z', id: 'abc' });
    expect(decodeCursor(cursor)).toEqual({ created_at: '2026-10-01T00:00:00.000Z', id: 'abc' });
    expect(decodeCursor('not-a-cursor')).toBeNull();
    expect(decodeCursor(Buffer.from('[1,2,3]').toString('base64url'))).toBeNull();
    expect(decodeCursor(null)).toBeNull();
  });

  it('derives hasMore and the next cursor from the extra row only', () => {
    const rows = [
      { id: 'a', n: 3 },
      { id: 'b', n: 2 },
      { id: 'c', n: 1 },
    ];
    const page = pageEnvelope(rows, 2, (row) => ({ id: row.id, n: row.n }));
    expect(page.items.map((row) => row.id)).toEqual(['a', 'b']);
    expect(page.page.hasMore).toBe(true);
    expect(decodeCursor(page.page.nextCursor)).toEqual({ id: 'b', n: 2 });

    const lastPage = pageEnvelope(rows.slice(0, 2), 2, (row) => ({ id: row.id }));
    expect(lastPage.page.hasMore).toBe(false);
    expect(lastPage.page.nextCursor).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. Rate limiting
// ---------------------------------------------------------------------------

describe('rate limiting', () => {
  it('allows up to the limit in the window, then returns Retry-After', () => {
    const now = 1_000_000;
    const limit = RATE_LIMITS['auth.login'].limit;
    for (let i = 0; i < limit; i += 1) {
      expect(consumeRateLimit('auth.login', 'ip-1', now).allowed).toBe(true);
    }
    const blocked = consumeRateLimit('auth.login', 'ip-1', now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    // A different caller is unaffected.
    expect(consumeRateLimit('auth.login', 'ip-2', now).allowed).toBe(true);

    const response = rateLimitResponse(blocked);
    expect(response.status).toBe(429);
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0);
  });

  it('refills over the window instead of locking a caller out forever', () => {
    const now = 5_000_000;
    const { limit, windowMs } = RATE_LIMITS['auth.password_reset'];
    for (let i = 0; i < limit; i += 1) consumeRateLimit('auth.password_reset', 'ip-3', now);
    expect(consumeRateLimit('auth.password_reset', 'ip-3', now).allowed).toBe(false);
    expect(consumeRateLimit('auth.password_reset', 'ip-3', now + windowMs).allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Token / bearer helpers
// ---------------------------------------------------------------------------

describe('bearer token handling', () => {
  it('reads the header only, case-insensitively, and rejects junk', () => {
    expect(bearerToken(new Request('https://x/', { headers: { authorization: 'Bearer abc.def.ghi' } }))).toBe('abc.def.ghi');
    expect(bearerToken(new Request('https://x/', { headers: { authorization: 'bearer  spaced-token ' } }))).toBe('spaced-token');
    expect(bearerToken(new Request('https://x/', { headers: { authorization: 'Basic abc' } }))).toBeNull();
    expect(bearerToken(new Request('https://x/'))).toBeNull();
    // A query-string token is never accepted (tokens must not travel in URLs).
    expect(bearerToken(new Request('https://x/?access_token=abc'))).toBeNull();
  });

  it('reads exp for error classification but grants nothing', () => {
    const expires = Math.floor(Date.now() / 1000) + 3600;
    expect(tokenExpirySeconds(fakeJwt({ exp: expires }))).toBe(expires);
    expect(tokenExpirySeconds('not-a-jwt')).toBeNull();
    expect(tokenExpirySeconds('a.b')).toBeNull();
  });

  it('distinguishes an expired token from an invalid one', () => {
    const past = Math.floor(Date.now() / 1000) - 10;
    const expired = classifyTokenFailure(fakeJwt({ exp: past }));
    expect(expired.code).toBe('expired_token');
    expect(expired.status).toBe(401);

    expect(classifyTokenFailure(fakeJwt({ exp: Math.floor(Date.now() / 1000) + 60 })).code).toBe('invalid_token');
    expect(classifyTokenFailure(null).code).toBe('invalid_token');
  });
});

// ---------------------------------------------------------------------------
// 6. Access-period rule (mirrors middleware.ts)
// ---------------------------------------------------------------------------

describe('access period gate', () => {
  const now = new Date('2026-10-01T00:00:00.000Z');

  it('never blocks super admin', () => {
    expect(isAccessPeriodValid({ status: 'expired', expires_at: '2020-01-01T00:00:00.000Z' }, 'super_admin', now)).toBe(true);
  });

  it('allows when there is no record, unlimited status, or no expiry', () => {
    expect(isAccessPeriodValid(null, 'retailer', now)).toBe(true);
    expect(isAccessPeriodValid({ status: 'unlimited', expires_at: null }, 'retailer', now)).toBe(true);
    expect(isAccessPeriodValid({ status: 'active', expires_at: null }, 'retailer', now)).toBe(true);
  });

  it('blocks a lapsed period and allows a live one', () => {
    expect(isAccessPeriodValid({ status: 'active', expires_at: '2026-09-30T00:00:00.000Z' }, 'retailer', now)).toBe(false);
    expect(isAccessPeriodValid({ status: 'expiring_soon', expires_at: '2026-10-08T00:00:00.000Z' }, 'retailer', now)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. Session resolution
// ---------------------------------------------------------------------------

describe('requireMobileSession', () => {
  it('rejects a missing token with 401 missing_token', async () => {
    const result = await requireMobileSession(new Request('https://x/'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('missing_token');
      expect(result.failure.status).toBe(401);
    }
  });

  it('rejects a token GoTrue refuses', async () => {
    mocks.createMobileSupabaseClient.mockReturnValue(
      fakeClient({ authError: { message: 'invalid JWT' } })
    );
    const result = await requireMobileSession(authorizedRequest());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe('invalid_token');
  });

  it('reports an expired token distinctly so the app can refresh', async () => {
    mocks.createMobileSupabaseClient.mockReturnValue(
      fakeClient({ authError: { message: 'JWT expired' } })
    );
    const past = Math.floor(Date.now() / 1000) - 30;
    const result = await requireMobileSession(authorizedRequest(fakeJwt({ exp: past })));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe('expired_token');
  });

  it('blocks an inactive profile', async () => {
    mocks.createMobileSupabaseClient.mockReturnValue(
      fakeClient({
        user: { id: 'user-1', email: 'a@b.c' },
        tables: {
          profiles: { data: { role: 'retailer', full_name: null, is_active: false, phone: null }, error: null },
        },
      })
    );
    const result = await requireMobileSession(authorizedRequest());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe('account_inactive');
  });

  it('gates a retailer awaiting approval', async () => {
    mocks.createMobileSupabaseClient.mockReturnValue(
      fakeClient({
        user: { id: 'user-1', email: 'a@b.c' },
        tables: {
          profiles: { data: { role: 'retailer', full_name: null, is_active: true, phone: null }, error: null },
          retailers: { data: { status: 'pending_approval', shop_name: 'New Shop' }, error: null },
        },
      })
    );
    const result = await requireMobileSession(authorizedRequest());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe('retailer_pending_approval');
  });

  it('gates a suspended retailer', async () => {
    mocks.createMobileSupabaseClient.mockReturnValue(
      fakeClient({
        user: { id: 'user-1', email: 'a@b.c' },
        tables: {
          profiles: { data: { role: 'retailer', full_name: null, is_active: true, phone: null }, error: null },
          retailers: { data: { status: 'suspended', shop_name: 'Shop' }, error: null },
        },
      })
    );
    const result = await requireMobileSession(authorizedRequest());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe('account_suspended');
  });

  it('gates a lapsed access period', async () => {
    mocks.createMobileSupabaseClient.mockReturnValue(
      fakeClient({
        user: { id: 'user-1', email: 'a@b.c' },
        tables: {
          profiles: { data: { role: 'retailer', full_name: null, is_active: true, phone: null }, error: null },
          retailers: { data: { status: 'active', shop_name: 'Shop' }, error: null },
          user_access_periods: { data: { status: 'active', expires_at: '2020-01-01T00:00:00.000Z' }, error: null },
        },
      })
    );
    const result = await requireMobileSession(authorizedRequest());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe('access_expired');
  });

  it('returns a verified session with role and retailer context', async () => {
    mocks.createMobileSupabaseClient.mockReturnValue(
      fakeClient({ user: { id: 'user-1', email: 'gupta@example.com' }, tables: ACTIVE_RETAILER_TABLES })
    );
    const result = await requireMobileSession(authorizedRequest());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.userId).toBe('user-1');
      expect(result.session.role).toBe('retailer');
      expect(result.session.retailer).toEqual({ status: 'active', shopName: 'Gupta Kirana Store' });
      expect(result.session.access).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// 8. GET /api/mobile/v1/health
// ---------------------------------------------------------------------------

describe('GET /api/mobile/v1/health', () => {
  it('answers 200 with the mobile envelope when the database responds', async () => {
    mocks.createServerClient.mockReturnValue({
      from: () => ({ select: () => Promise.resolve({ error: null }) }),
    });
    const response = await getHealth();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.status).toBe('ok');
    expect(body.data.apiVersion).toBe('v1');
    expect(typeof body.data.serverTime).toBe('string');
    expect(response.headers.get('X-Request-Id')).toBe(body.requestId);
  });

  it('answers 503 without leaking the driver error', async () => {
    mocks.createServerClient.mockReturnValue({
      from: () => ({ select: () => Promise.resolve({ error: { message: 'fetch failed to https://secret.supabase.co' } }) }),
    });
    const response = await getHealth();
    expect(response.status).toBe(503);
    const text = JSON.stringify(await response.json());
    expect(text).toContain('database_unavailable');
    expect(text).not.toContain('supabase.co');
    expect(text).not.toContain('fetch failed');
    expect(console.error).toHaveBeenCalled();
  });

  it('answers 500 without leaking an exception message', async () => {
    mocks.createServerClient.mockImplementation(() => {
      throw new Error('connection string postgres://user:pass@host');
    });
    const response = await getHealth();
    expect(response.status).toBe(500);
    const text = JSON.stringify(await response.json());
    expect(text).toContain('internal_error');
    expect(text).not.toContain('postgres://');
  });

  it('rejects unsupported methods with 405 and an Allow header', async () => {
    const response = await postHealth();
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET');
  });
});

// ---------------------------------------------------------------------------
// 9. GET /api/mobile/v1/session
// ---------------------------------------------------------------------------

describe('GET /api/mobile/v1/session', () => {
  it('returns the caller’s own identity and role-aware navigation', async () => {
    mocks.createMobileSupabaseClient.mockReturnValue(
      fakeClient({ user: { id: 'retailer-1', email: 'gupta@example.com' }, tables: ACTIVE_RETAILER_TABLES })
    );
    const response = await getSession(authorizedRequest());
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.data.user).toMatchObject({
      id: 'retailer-1',
      role: 'retailer',
      fullName: 'Gupta Kirana',
      phone: '9876543210',
      isActive: true,
    });
    expect(body.data.retailer).toEqual({ status: 'active', shopName: 'Gupta Kirana Store' });
    expect(body.data.navigation.homeRoute).toBe('/retailer/home');
    expect(body.data.navigation.workspaces).toEqual(['retailer']);
    // Permissions come from the server's own table, not a client copy.
    expect(body.data.navigation.permissions).toContain('orders.create');
    expect(body.data.navigation.permissions).not.toContain('coins.manage');
    expect(body.data.navigation.permissions).not.toContain('cleanup.view');
  });

  it('never lets a client claim a different identity or role', async () => {
    mocks.createMobileSupabaseClient.mockReturnValue(
      fakeClient({ user: { id: 'retailer-1', email: 'gupta@example.com' }, tables: ACTIVE_RETAILER_TABLES })
    );
    const response = await getSession(
      authorizedRequest(
        'token-abc',
        'https://x/api/mobile/v1/session?userId=super-admin&role=super_admin'
      )
    );
    const body = await response.json();
    expect(body.data.user.id).toBe('retailer-1');
    expect(body.data.user.role).toBe('retailer');
    expect(body.data.navigation.homeRoute).toBe('/retailer/home');
  });

  it('answers 401 for an unauthenticated call and 403 for a gated account', async () => {
    const unauth = await getSession(new Request('https://x/api/mobile/v1/session'));
    expect(unauth.status).toBe(401);
    expect((await unauth.json()).error.code).toBe('missing_token');

    mocks.createMobileSupabaseClient.mockReturnValue(
      fakeClient({
        user: { id: 'retailer-2', email: null },
        tables: {
          profiles: { data: { role: 'retailer', full_name: null, is_active: true, phone: null }, error: null },
          retailers: { data: { status: 'pending_approval', shop_name: null }, error: null },
        },
      })
    );
    const pending = await getSession(authorizedRequest());
    expect(pending.status).toBe(403);
    expect((await pending.json()).error.code).toBe('retailer_pending_approval');
  });

  it('reports a database failure as a sanitized 503', async () => {
    mocks.createMobileSupabaseClient.mockReturnValue(
      fakeClient({
        user: { id: 'user-1', email: null },
        tables: { profiles: { data: null, error: { message: 'relation "profiles" does not exist' } } },
      })
    );
    const response = await getSession(authorizedRequest());
    expect(response.status).toBe(503);
    const text = JSON.stringify(await response.json());
    expect(text).toContain('database_unavailable');
    expect(text).not.toContain('relation');
  });

  it('fails closed on a role the API does not recognise', async () => {
    mocks.createMobileSupabaseClient.mockReturnValue(
      fakeClient({
        user: { id: 'user-9', email: null },
        tables: {
          profiles: {
            data: { role: 'regional_manager', full_name: null, is_active: true, phone: null },
            error: null,
          },
        },
      })
    );

    const response = await getSession(authorizedRequest());

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.code).toBe('forbidden');
    // No navigation block is leaked for an unrecognised role.
    expect(body.data).toBeUndefined();
  });

  it('an inactive account is rejected before any role or navigation data is built', async () => {
    mocks.createMobileSupabaseClient.mockReturnValue(
      fakeClient({
        user: { id: 'user-10', email: null },
        tables: {
          profiles: {
            data: { role: 'admin', full_name: null, is_active: false, phone: null },
            error: null,
          },
        },
      })
    );

    const response = await getSession(authorizedRequest());

    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe('account_inactive');
  });
});

// ---------------------------------------------------------------------------
// 10. Static security assertions on the Android sources (plan §7)
// ---------------------------------------------------------------------------

const ROOT = join(__dirname, '..');
const ANDROID_ROOT = join(ROOT, 'android');

function androidFiles(): string[] {
  const skip = new Set(['build', '.gradle', '.kotlin', 'wrapper']);
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (skip.has(entry)) continue;
        walk(full);
      } else {
        files.push(full);
      }
    }
  };
  walk(ANDROID_ROOT);
  return files;
}

function readAndroidSources(): { path: string; source: string }[] {
  return androidFiles()
    .filter((file) => /\.(kt|kts|xml|toml|properties|pro)$/.test(file))
    .map((file) => ({ path: file.slice(ROOT.length + 1), source: readFileSync(file, 'utf8') }));
}

describe('Android source security assertions', () => {
  it('ships a native Android project (no Capacitor wrapper as the app)', () => {
    expect(existsSync(join(ANDROID_ROOT, 'settings.gradle.kts'))).toBe(true);
    expect(existsSync(join(ANDROID_ROOT, 'app', 'build.gradle.kts'))).toBe(true);
    expect(existsSync(join(ANDROID_ROOT, 'app', 'src', 'main', 'AndroidManifest.xml'))).toBe(true);
    expect(existsSync(join(ANDROID_ROOT, 'gradle', 'libs.versions.toml'))).toBe(true);
    expect(existsSync(join(ANDROID_ROOT, 'gradlew'))).toBe(true);
    expect(existsSync(join(ANDROID_ROOT, 'gradle', 'wrapper', 'gradle-wrapper.jar'))).toBe(true);
  });

  it('never renders the app through a WebView', () => {
    const offenders = readAndroidSources().filter(({ source }) =>
      /android\.webkit|WebView|loadUrl\(/.test(source)
    );
    expect(offenders.map((file) => file.path)).toEqual([]);
  });

  it('embeds no Supabase key, service-role credential or private key', () => {
    const offenders = readAndroidSources().filter(({ source }) =>
      /SUPABASE|supabase\.co|service_role|SERVICE_ROLE|BEGIN (RSA |EC )?PRIVATE KEY|sk_live|AI_API_KEY/.test(source)
    );
    expect(offenders.map((file) => file.path)).toEqual([]);
  });

  it('keeps cleartext traffic disabled and exposes only the launcher activity', () => {
    const manifest = readFileSync(join(ANDROID_ROOT, 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
    expect(manifest).toContain('android:usesCleartextTraffic="false"');
    expect(manifest).toContain('android:networkSecurityConfig="@xml/network_security_config"');
    expect(manifest).toContain('android:allowBackup="false"');
    // Exactly one exported component: the launcher activity.
    const exported = manifest.match(/android:exported="true"/g) ?? [];
    expect(exported).toHaveLength(1);
    expect(manifest).toContain('android.intent.action.MAIN');

    const networkConfig = readFileSync(
      join(ANDROID_ROOT, 'app', 'src', 'main', 'res', 'xml', 'network_security_config.xml'),
      'utf8'
    );
    expect(networkConfig).toContain('cleartextTrafficPermitted="false"');
  });

  it('never disables TLS verification', () => {
    const offenders = readAndroidSources().filter(({ source }) =>
      /TrustAllCerts|X509TrustManager|checkServerTrusted|hostnameVerifier|ALLOW_ALL_HOSTNAME/.test(source)
    );
    expect(offenders.map((file) => file.path)).toEqual([]);
  });

  it('keeps tokens out of plaintext preferences and logs', () => {
    const offenders = readAndroidSources().filter(({ source }) =>
      /getSharedPreferences\(\s*"[^"]*token/i.test(source) || /Log\.[dview]\([^)]*[Tt]oken/.test(source)
    );
    expect(offenders.map((file) => file.path)).toEqual([]);
  });
});
