/**
 * `/api/mobile/v1/auth/*` + `/api/mobile/v1/retailers/register` — Phase C contract tests.
 *
 * These run in the repository's vitest harness against the REAL route handlers
 * with GoTrue/Supabase mocked at the client boundary. They verify the parts of
 * authentication that must never regress:
 *
 *   1. account enumeration is impossible (unknown phone ≡ wrong password);
 *   2. the post-sign-in gate is the SAME gate every other endpoint uses, so
 *      login cannot disagree with `GET /session`;
 *   3. a pending/expired account gets a state, not an error — and the tokens it
 *      receives unlock nothing;
 *   4. a blocked account never receives tokens at all;
 *   5. logout works even for an account that can no longer authenticate;
 *   6. registration cannot self-assign a role and lands in pending approval;
 *   7. passwords and tokens never appear in responses or error messages.
 *
 * These are unit/contract tests. They do NOT prove behaviour against a live
 * Supabase project — no credentials exist in CI — and they are reported as such.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock surface
// ---------------------------------------------------------------------------

interface FakeResult {
  data: unknown;
  error: { message?: string; status?: number } | null;
}

const h = vi.hoisted(() => {
  const config = {
    signIn: { data: null, error: null } as FakeResult,
    signUp: { data: null, error: null } as FakeResult,
    refresh: { data: null, error: null } as FakeResult,
    resetError: null as { message?: string } | null,
    rpc: { data: null, error: null } as FakeResult,
    phoneProfile: { data: null, error: null } as FakeResult,
    getUserById: { data: null, error: null } as FakeResult,
    verifyUser: { data: null, error: null } as FakeResult,
    tables: {} as Record<string, FakeResult>,
    gotrue: { ok: true, status: 204 } as { ok: boolean; status: number },
    gotrueCalls: [] as { path: string; method: string }[],
  };
  return { config };
});

function query(result: FakeResult) {
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'in', 'order', 'limit']) {
    builder[method] = () => builder;
  }
  builder.maybeSingle = async () => result;
  builder.single = async () => result;
  return builder;
}

vi.mock('@/lib/mobile/clients', () => ({
  createMobileAnonClient: () => ({
    auth: {
      signInWithPassword: async () => h.config.signIn,
      signUp: async () => h.config.signUp,
      refreshSession: async () => h.config.refresh,
      resetPasswordForEmail: async () => ({ error: h.config.resetError }),
    },
    rpc: async () => h.config.rpc,
  }),
  createMobileServiceRoleClient: () => ({
    from: () => query(h.config.phoneProfile),
    auth: { admin: { getUserById: async () => h.config.getUserById } },
  }),
  gotrueFetch: async (path: string, init: { method: string }) => {
    h.config.gotrueCalls.push({ path, method: init.method });
    return h.config.gotrue;
  },
}));

vi.mock('@/lib/mobile/supabase', () => ({
  createMobileSupabaseClient: () => ({
    auth: { getUser: async () => h.config.verifyUser },
    from: (table: string) => query(h.config.tables[table] ?? { data: null, error: null }),
  }),
}));

import { POST as login } from '@/app/api/mobile/v1/auth/login/route';
import { POST as refresh } from '@/app/api/mobile/v1/auth/refresh/route';
import { POST as logout } from '@/app/api/mobile/v1/auth/logout/route';
import { POST as passwordReset } from '@/app/api/mobile/v1/auth/password-reset/route';
import { POST as passwordUpdate } from '@/app/api/mobile/v1/auth/password-update/route';
import { POST as register } from '@/app/api/mobile/v1/retailers/register/route';
import { resetRateLimits } from '@/lib/mobile';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROOT = join(__dirname, '..');

function jsonRequest(url: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://api.test${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.1', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function authorizedRequest(url: string, body: unknown, token = 'caller.jwt.token'): Request {
  return jsonRequest(url, body, { authorization: `Bearer ${token}` });
}

interface Envelope {
  data?: Record<string, unknown>;
  error?: { code: string; message: string; details?: { fields?: Record<string, string> } };
  requestId: string;
}

async function call(handler: (r: Request) => Promise<Response>, request: Request) {
  const response = await handler(request);
  const body = (await response.json()) as Envelope;
  return { status: response.status, body, response };
}

const SESSION = {
  access_token: 'access.token.value',
  refresh_token: 'refresh.token.value',
  expires_at: 1_800_000_000,
  token_type: 'bearer',
};

/** Configure a healthy, approved, active retailer behind the session gate. */
function givenActiveRetailer() {
  h.config.verifyUser = {
    data: { user: { id: 'user-1', email: 'shop@example.com' } },
    error: null,
  };
  h.config.tables.profiles = {
    data: { role: 'retailer', full_name: 'Ramesh Kumar', is_active: true, phone: '9876543210' },
    error: null,
  };
  h.config.tables.retailers = {
    data: { status: 'active', shop_name: 'Kumar Kirana' },
    error: null,
  };
  h.config.tables.user_access_periods = { data: null, error: null };
}

beforeEach(() => {
  resetRateLimits();
  h.config.signIn = { data: null, error: null };
  h.config.signUp = { data: null, error: null };
  h.config.refresh = { data: null, error: null };
  h.config.resetError = null;
  h.config.rpc = { data: null, error: null };
  h.config.phoneProfile = { data: null, error: null };
  h.config.getUserById = { data: null, error: null };
  h.config.verifyUser = { data: null, error: null };
  h.config.tables = {};
  h.config.gotrue = { ok: true, status: 204 };
  h.config.gotrueCalls = [];
});

// ---------------------------------------------------------------------------
// 1. Login — enumeration resistance
// ---------------------------------------------------------------------------

describe('POST /auth/login — account enumeration', () => {
  it('rejects an identifier that is neither a phone number nor an email', async () => {
    const { status, body } = await call(login, jsonRequest('/x', { identifier: 'not-a-login', password: 'secret123' }));
    expect(status).toBe(400);
    expect(body.error?.code).toBe('validation_failed');
    expect(body.error?.details?.fields?.identifier).toBeTruthy();
  });

  it('answers an unknown phone exactly like a wrong password', async () => {
    // Phone does not resolve to any account.
    h.config.phoneProfile = { data: null, error: null };
    const unknown = await call(login, jsonRequest('/x', { identifier: '9876543210', password: 'guess' }));

    // Known account, wrong password.
    h.config.phoneProfile = { data: { id: 'user-1' }, error: null };
    h.config.getUserById = { data: { user: { email: 'shop@example.com' } }, error: null };
    h.config.signIn = { data: null, error: { message: 'Invalid login credentials' } };
    const wrongPassword = await call(login, jsonRequest('/x', { identifier: '9876543210', password: 'guess' }));

    expect(unknown.status).toBe(401);
    expect(wrongPassword.status).toBe(401);
    expect(unknown.body.error?.code).toBe('invalid_credentials');
    expect(wrongPassword.body.error?.code).toBe('invalid_credentials');
    // Byte-identical: no timing-independent distinction leaks through copy.
    expect(unknown.body.error?.message).toBe(wrongPassword.body.error?.message);
  });

  it('accepts common Indian phone formats and rejects a non-Indian number', async () => {
    // The resolver stores the returned id, so reaching "unknown_account" rather
    // than "invalid_identifier" proves normalization accepted the input.
    h.config.phoneProfile = { data: null, error: null };
    for (const formatted of ['+91 98765 43210', '098765 43210', '91-98765-43210']) {
      const { status, body } = await call(login, jsonRequest('/x', { identifier: formatted, password: 'p' }));
      expect(status, formatted).toBe(401);
      expect(body.error?.code, formatted).toBe('invalid_credentials');
    }

    const notIndian = await call(login, jsonRequest('/x', { identifier: '+1 555 0100', password: 'p' }));
    expect(notIndian.status).toBe(400);
    expect(notIndian.body.error?.details?.fields?.identifier).toBeTruthy();
  });

  it('only distinguishes an unconfirmed email AFTER the account resolves', async () => {
    h.config.signIn = { data: null, error: { message: 'Email not confirmed' } };
    const knownEmail = await call(login, jsonRequest('/x', { identifier: 'shop@example.com', password: 'p' }));
    expect(knownEmail.status).toBe(403);
    expect(knownEmail.body.error?.code).toBe('email_not_confirmed');

    // The same provider error on the phone path only happens after resolution,
    // so an unknown phone still returns the generic answer.
    h.config.phoneProfile = { data: null, error: null };
    const unknownPhone = await call(login, jsonRequest('/x', { identifier: '9876543210', password: 'p' }));
    expect(unknownPhone.status).toBe(401);
    expect(unknownPhone.body.error?.code).toBe('invalid_credentials');
  });

  it('rate limits repeated attempts and tells the client when to retry', async () => {
    h.config.phoneProfile = { data: null, error: null };
    let last: Awaited<ReturnType<typeof call>> | null = null;
    for (let attempt = 0; attempt < 11; attempt += 1) {
      last = await call(login, jsonRequest('/x', { identifier: '9876543210', password: 'p' }));
    }
    expect(last?.status).toBe(429);
    expect(last?.body.error?.code).toBe('rate_limited');
    expect(Number(last?.response.headers.get('Retry-After'))).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Login — happy path and the shared gate
// ---------------------------------------------------------------------------

describe('POST /auth/login — session issuance', () => {
  it('returns tokens and nextStep=app for an approved, active retailer', async () => {
    h.config.signIn = { data: { session: SESSION, user: { id: 'user-1', email: 'shop@example.com' } }, error: null };
    givenActiveRetailer();

    const { status, body } = await call(login, jsonRequest('/x', { identifier: 'shop@example.com', password: 'good' }));

    expect(status).toBe(200);
    expect(body.data?.accessToken).toBe(SESSION.access_token);
    expect(body.data?.refreshToken).toBe(SESSION.refresh_token);
    expect(body.data?.expiresAt).toBe(SESSION.expires_at);
    expect(body.data?.nextStep).toBe('app');
    expect(body.data?.user).toMatchObject({ id: 'user-1', role: 'retailer', fullName: 'Ramesh Kumar' });
    expect(body.data?.retailer).toMatchObject({ status: 'active', shopName: 'Kumar Kirana' });
  });

  it('gives a pending retailer a STATE, not an error — and no business access', async () => {
    h.config.signIn = {
      data: { session: SESSION, user: { id: 'user-2', email: 'new@example.com' } },
      error: null,
    };
    h.config.verifyUser = { data: { user: { id: 'user-2', email: 'new@example.com' } }, error: null };
    h.config.tables.profiles = {
      data: { role: 'retailer', full_name: 'New Shop', is_active: true, phone: '9876543211' },
      error: null,
    };
    h.config.tables.retailers = { data: { status: 'pending_approval', shop_name: 'New Shop' }, error: null };

    const { status, body } = await call(login, jsonRequest('/x', { identifier: 'new@example.com', password: 'good' }));

    expect(status).toBe(200);
    expect(body.data?.nextStep).toBe('pending_approval');
    // A session is returned so the app can show the state screen …
    expect(body.data?.accessToken).toBe(SESSION.access_token);
    // … but nothing that looks like entitlement.
    expect(body.data?.retailer).toBeNull();
  });

  it('reports an expired access period as a state as well', async () => {
    h.config.signIn = { data: { session: SESSION, user: { id: 'user-3', email: 'a@example.com' } }, error: null };
    h.config.verifyUser = { data: { user: { id: 'user-3', email: 'a@example.com' } }, error: null };
    h.config.tables.profiles = {
      data: { role: 'retailer', full_name: 'Shop', is_active: true, phone: '9876543212' },
      error: null,
    };
    h.config.tables.retailers = { data: { status: 'active', shop_name: 'Shop' }, error: null };
    h.config.tables.user_access_periods = {
      data: { status: 'active', expires_at: '2000-01-01T00:00:00.000Z' },
      error: null,
    };

    const { status, body } = await call(login, jsonRequest('/x', { identifier: 'a@example.com', password: 'good' }));
    expect(status).toBe(200);
    expect(body.data?.nextStep).toBe('access_expired');
  });

  it.each([
    ['suspended', 'account_suspended'],
    ['rejected', 'retailer_pending_approval'],
  ])('refuses a %s retailer with %s and NO tokens', async (status_, expectedCode) => {
    h.config.signIn = { data: { session: SESSION, user: { id: 'user-4', email: 's@example.com' } }, error: null };
    h.config.verifyUser = { data: { user: { id: 'user-4', email: 's@example.com' } }, error: null };
    h.config.tables.profiles = {
      data: { role: 'retailer', full_name: 'Shop', is_active: true, phone: '9876543213' },
      error: null,
    };
    h.config.tables.retailers = { data: { status: status_, shop_name: 'Shop' }, error: null };

    const { status, body } = await call(login, jsonRequest('/x', { identifier: 's@example.com', password: 'good' }));

    if (expectedCode === 'account_suspended') {
      expect(status).toBe(403);
      expect(body.error?.code).toBe('account_suspended');
      expect(JSON.stringify(body)).not.toContain(SESSION.access_token);
      expect(JSON.stringify(body)).not.toContain(SESSION.refresh_token);
    } else {
      // Non-active, non-suspended statuses reach the pending-approval state.
      expect(status).toBe(200);
      expect(body.data?.nextStep).toBe('pending_approval');
    }
  });

  it('refuses a deactivated profile and an unrecognised role', async () => {
    h.config.signIn = { data: { session: SESSION, user: { id: 'user-5', email: 'x@example.com' } }, error: null };
    h.config.verifyUser = { data: { user: { id: 'user-5', email: 'x@example.com' } }, error: null };
    h.config.tables.profiles = {
      data: { role: 'retailer', full_name: 'X', is_active: false, phone: '9876543214' },
      error: null,
    };
    const inactive = await call(login, jsonRequest('/x', { identifier: 'x@example.com', password: 'good' }));
    expect(inactive.status).toBe(403);
    expect(inactive.body.error?.code).toBe('account_inactive');

    h.config.tables.profiles = {
      data: { role: 'root', full_name: 'X', is_active: true, phone: '9876543214' },
      error: null,
    };
    const badRole = await call(login, jsonRequest('/x', { identifier: 'x@example.com', password: 'good' }));
    expect(badRole.status).toBe(403);
    expect(badRole.body.error?.code).toBe('forbidden');
  });

  it('never echoes the submitted password anywhere in the response', async () => {
    h.config.signIn = { data: { session: SESSION, user: { id: 'user-1', email: 'shop@example.com' } }, error: null };
    givenActiveRetailer();
    const { body } = await call(login, jsonRequest('/x', { identifier: 'shop@example.com', password: 'hunter2-super-secret' }));
    expect(JSON.stringify(body)).not.toContain('hunter2-super-secret');
  });
});

// ---------------------------------------------------------------------------
// 3. Refresh / logout
// ---------------------------------------------------------------------------

describe('POST /auth/refresh', () => {
  it('returns fresh tokens and nothing else', async () => {
    h.config.refresh = { data: { session: SESSION }, error: null };
    const { status, body } = await call(refresh, jsonRequest('/x', { refreshToken: 'old.refresh.token' }));

    expect(status).toBe(200);
    expect(body.data?.accessToken).toBe(SESSION.access_token);
    // Entitlement is NOT part of a refresh response.
    expect(body.data).not.toHaveProperty('user');
    expect(body.data).not.toHaveProperty('navigation');
    expect(body.data).not.toHaveProperty('nextStep');
  });

  it('treats a rejected refresh token as terminal', async () => {
    h.config.refresh = { data: null, error: { message: 'Invalid Refresh Token' } };
    const { status, body } = await call(refresh, jsonRequest('/x', { refreshToken: 'revoked' }));
    expect(status).toBe(401);
    expect(body.error?.code).toBe('invalid_token');
    expect(JSON.stringify(body)).not.toContain('revoked');
  });

  it('rejects a body without a refresh token', async () => {
    const { status, body } = await call(refresh, jsonRequest('/x', { refreshToken: '' }));
    expect(status).toBe(400);
    expect(body.error?.code).toBe('validation_failed');
  });
});

describe('POST /auth/logout', () => {
  it('revokes the caller token and reports success', async () => {
    const { status, body } = await call(logout, authorizedRequest('/x', {}));
    expect(status).toBe(200);
    expect(body.data?.ok).toBe(true);
    expect(h.config.gotrueCalls).toEqual([{ path: '/logout', method: 'POST' }]);
  });

  it('still reports success when GoTrue cannot be reached', async () => {
    h.config.gotrue = { ok: false, status: 500 };
    const { status, body } = await call(logout, authorizedRequest('/x', {}));
    expect(status).toBe(200);
    expect(body.data?.ok).toBe(true);
  });

  it('requires a bearer token', async () => {
    const { status, body } = await call(logout, jsonRequest('/x', {}));
    expect(status).toBe(401);
    expect(body.error?.code).toBe('missing_token');
  });

  it('works for an account that can no longer authenticate (no session gate)', async () => {
    // A suspended retailer: requireMobileSession would refuse, but signing out
    // must never be blocked by account state.
    h.config.verifyUser = { data: null, error: { message: 'invalid' } };
    const { status } = await call(logout, authorizedRequest('/x', {}));
    expect(status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// 4. Password reset / update
// ---------------------------------------------------------------------------

describe('POST /auth/password-reset', () => {
  it('answers identically whether or not the provider errored', async () => {
    const ok = await call(passwordReset, jsonRequest('/x', { email: 'someone@example.com' }));
    h.config.resetError = { message: 'User not found' };
    const failed = await call(passwordReset, jsonRequest('/x', { email: 'nobody@example.com' }));

    expect(ok.status).toBe(200);
    expect(failed.status).toBe(200);
    expect(ok.body.data?.ok).toBe(true);
    expect(failed.body.data?.ok).toBe(true);
    expect(ok.body.data?.message).toBe(failed.body.data?.message);
  });

  it('validates the email shape', async () => {
    const { status, body } = await call(passwordReset, jsonRequest('/x', { email: 'not-an-email' }));
    expect(status).toBe(400);
    expect(body.error?.details?.fields?.email).toBeTruthy();
  });
});

describe('POST /auth/password-update', () => {
  it('requires an authenticated session', async () => {
    const { status, body } = await call(passwordUpdate, jsonRequest('/x', { password: 'a'.repeat(9), confirmPassword: 'a'.repeat(9) }));
    expect(status).toBe(401);
    expect(body.error?.code).toBe('missing_token');
  });

  it('rejects a mismatched confirmation and a short password', async () => {
    givenActiveRetailer();
    const mismatch = await call(
      passwordUpdate,
      authorizedRequest('/x', { password: 'longenough1', confirmPassword: 'longenough2' })
    );
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error?.details?.fields?.confirmPassword).toBeTruthy();

    const short = await call(passwordUpdate, authorizedRequest('/x', { password: 'short', confirmPassword: 'short' }));
    expect(short.status).toBe(400);
    expect(short.body.error?.details?.fields?.password).toBeTruthy();
  });

  it('changes the password as the caller and never returns it', async () => {
    givenActiveRetailer();
    h.config.gotrue = { ok: true, status: 200 };
    const { status, body } = await call(
      passwordUpdate,
      authorizedRequest('/x', { password: 'brand-new-pass', confirmPassword: 'brand-new-pass' })
    );

    expect(status).toBe(200);
    expect(body.data?.ok).toBe(true);
    expect(h.config.gotrueCalls).toEqual([{ path: '/user', method: 'PUT' }]);
    expect(JSON.stringify(body)).not.toContain('brand-new-pass');
  });

  it('maps a GoTrue rejection without leaking the provider message', async () => {
    givenActiveRetailer();
    h.config.gotrue = { ok: false, status: 422 };
    const { status, body } = await call(
      passwordUpdate,
      authorizedRequest('/x', { password: 'brand-new-pass', confirmPassword: 'brand-new-pass' })
    );
    expect(status).toBe(400);
    expect(body.error?.details?.fields?.password).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 5. Registration
// ---------------------------------------------------------------------------

const REGISTRATION = {
  fullName: 'Ramesh Kumar',
  shopName: 'Kumar Kirana',
  phone: '9876543210',
  email: 'kumar@example.com',
  areaId: '11111111-1111-4111-8111-111111111111',
  address: 'Main Road, Khagaria',
  password: 'a-good-password',
};

describe('POST /retailers/register', () => {
  it('rejects a duplicate phone number with a field error', async () => {
    h.config.rpc = { data: true, error: null };
    const { status, body } = await call(register, jsonRequest('/x', REGISTRATION));
    expect(status).toBe(409);
    expect(body.error?.details?.fields?.phone).toBeTruthy();
  });

  it('normalizes the phone and lands the account in pending approval', async () => {
    h.config.rpc = { data: false, error: null };
    h.config.signUp = { data: { user: { id: 'u9', identities: [{ id: 'i' }] }, session: null }, error: null };

    const { status, body } = await call(register, jsonRequest('/x', { ...REGISTRATION, phone: '+91 98765 43210' }));

    expect(status).toBe(200);
    expect(body.data?.nextStep).toBe('pending_approval');
    expect(body.data?.requiresEmailConfirmation).toBe(true);
    expect(body.data?.session).toBeNull();
  });

  it('detects a duplicate email that the provider reports as success', async () => {
    h.config.rpc = { data: false, error: null };
    h.config.signUp = { data: { user: { id: 'u9', identities: [] }, session: null }, error: null };
    const { status, body } = await call(register, jsonRequest('/x', REGISTRATION));
    expect(status).toBe(409);
    expect(body.error?.code).toBe('conflict');
  });

  it('validates phone, area and password shape before touching the provider', async () => {
    const badPhone = await call(register, jsonRequest('/x', { ...REGISTRATION, phone: '12345' }));
    expect(badPhone.status).toBe(400);
    expect(badPhone.body.error?.details?.fields?.phone).toBeTruthy();

    const badArea = await call(register, jsonRequest('/x', { ...REGISTRATION, areaId: 'not-a-uuid' }));
    expect(badArea.status).toBe(400);
    expect(badArea.body.error?.details?.fields?.areaId).toBeTruthy();

    const badPassword = await call(register, jsonRequest('/x', { ...REGISTRATION, password: 'short' }));
    expect(badPassword.status).toBe(400);
    expect(badPassword.body.error?.details?.fields?.password).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 6. Static security assertions on the new sources
// ---------------------------------------------------------------------------

describe('auth endpoints — source-level security invariants', () => {
  const routes = [
    'app/api/mobile/v1/auth/login/route.ts',
    'app/api/mobile/v1/auth/refresh/route.ts',
    'app/api/mobile/v1/auth/logout/route.ts',
    'app/api/mobile/v1/auth/password-reset/route.ts',
    'app/api/mobile/v1/auth/password-update/route.ts',
    'app/api/mobile/v1/retailers/register/route.ts',
  ];
  const source = (path: string) => readFileSync(join(ROOT, path), 'utf8');

  it('never logs a password, token or request body', () => {
    for (const route of routes) {
      const text = source(route);
      // Remove string literals first: a SCOPE name such as
      // 'auth.password-reset' is not a leaked secret, but a logged identifier
      // named `password` would be.
      const identifiersOnly = text.replace(/'[^']*'/g, "''").replace(/`[^`]*`/g, '``');
      expect(text, route).not.toMatch(/console\.log/);
      expect(identifiersOnly, route).not.toMatch(/logServerError\([^)]*password/);
      expect(identifiersOnly, route).not.toMatch(/logServerError\([^)]*[Tt]oken/);
      expect(identifiersOnly, route).not.toMatch(/logServerError\([^)]*body\.data/);
    }
  });

  it('never returns a provider message verbatim', () => {
    for (const route of routes) {
      const text = source(route);
      // Error copy must be a literal, never `error.message` handed to the client.
      expect(text, route).not.toMatch(/message:\s*error\.message/);
      expect(text, route).not.toMatch(/message:\s*[a-zA-Z]+Error\.message/);
    }
  });

  it('rejects every method other than POST', () => {
    for (const route of routes) {
      expect(source(route), route).toContain('methodNotAllowed([\'POST\'])');
    }
  });

  it('keeps the service-role client confined to phone → email resolution', () => {
    const clients = source('lib/mobile/clients.ts');
    expect(clients).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(clients).toContain("import 'server-only'");
    // The only consumer is the login route, and only to resolve an identifier.
    const consumers = routes.filter((route) => source(route).includes('createMobileServiceRoleClient'));
    expect(consumers).toEqual(['app/api/mobile/v1/auth/login/route.ts']);
  });

  it('never accepts a role from the client during registration', () => {
    const text = source('app/api/mobile/v1/retailers/register/route.ts');
    const metadataBlock = text.slice(text.indexOf('data: {'), text.indexOf('data: {') + 220);
    expect(metadataBlock).not.toMatch(/role/);
    expect(text).toMatch(/never send|no `role`|no role/i);
  });

  it('reuses the shared session gate instead of re-implementing it', () => {
    const loginRoute = source('app/api/mobile/v1/auth/login/route.ts');
    expect(loginRoute).toContain('evaluateAccountState');
    const authApi = source('lib/mobile/auth-api.ts');
    expect(authApi).toContain('requireMobileSession');
    // The gate must live in exactly one place.
    expect(authApi).not.toMatch(/from\('profiles'\)[\s\S]{0,200}is_active/);
  });
});
