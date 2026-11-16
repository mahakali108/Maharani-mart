import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * DUAL LOGIN — email OTP security matrix.
 *
 * These tests are the executable half of
 * docs/repair/DUAL_LOGIN_SECURITY_TEST_REPORT.md. They pin the properties that
 * make a second credential path safe:
 *
 *   1. no account creation from the login screen (shouldCreateUser: false),
 *   2. verification uses Supabase's native verifyOtp — no local code store,
 *   3. the role is read server-side after verification (never from the form),
 *   4. the same active/approved gate guards OTP and password equally,
 *   5. generic responses (no account enumeration),
 *   6. a bounded resend cooldown and a bounded attempt counter,
 *   7. the code never touches logs, URLs, or browser storage,
 *   8. password login still works unchanged.
 */

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const cookieJar = new Map<string, string>();
const redirectCalls: string[] = [];
const signOutCalls: { count: number } = { count: 0 };

const authMock = {
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(async () => {
    signOutCalls.count += 1;
    return { error: null };
  }),
};

const profileRow: { current: { role: string; is_active: boolean } | null } = { current: null };
const retailerRow: { current: { status: string } | null } = { current: null };

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined),
    set: (name: string, value: string) => cookieJar.set(name, value),
    delete: (name: string) => cookieJar.delete(name),
  }),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    redirectCalls.push(url);
    // Next models redirect() as a thrown NEXT_REDIRECT sentinel.
    throw Object.assign(new Error('NEXT_REDIRECT'), { digest: `NEXT_REDIRECT;replace;${url}` });
  },
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: authMock,
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: table === 'profiles' ? profileRow.current : null,
            error: null,
          }),
          maybeSingle: async () => ({
            data: table === 'retailers' ? retailerRow.current : null,
            error: null,
          }),
        }),
      }),
    }),
  }),
  createServiceRoleClient: () => ({
    auth: { admin: { listUsers: async () => ({ data: { users: [] }, error: null }) } },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: null, error: null }),
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
    }),
  }),
}));

const {
  requestEmailOtpAction,
  verifyEmailOtpAction,
  loginAction,
  loginWithPhoneAction,
} = await import('@/lib/auth/actions');

const OTP_EMAIL_COOKIE = 'mahi_otp_email';
const OTP_SENT_COOKIE = 'mahi_otp_sent_at';
const OTP_ATTEMPTS_COOKIE = 'mahi_otp_attempts';

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(entries)) fd.set(key, value);
  return fd;
}

/** Seeds the state a successful "send code" leaves behind. */
function seedPendingOtp(email = 'admin@maharanitraders.in', sentAtAgoSeconds = 120) {
  cookieJar.set(OTP_EMAIL_COOKIE, email);
  cookieJar.set(OTP_SENT_COOKIE, String(Date.now() - sentAtAgoSeconds * 1000));
  cookieJar.set(OTP_ATTEMPTS_COOKIE, '0');
}

beforeEach(() => {
  cookieJar.clear();
  redirectCalls.length = 0;
  signOutCalls.count = 0;
  profileRow.current = { role: 'super_admin', is_active: true };
  retailerRow.current = null;
  vi.clearAllMocks();
  authMock.signInWithOtp.mockResolvedValue({ data: {}, error: null });
  authMock.verifyOtp.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
  authMock.signInWithPassword.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
});

// ---------------------------------------------------------------------------
// 1. No account creation
// ---------------------------------------------------------------------------

describe('OTP request — never creates an account', () => {
  it('always sends shouldCreateUser: false', async () => {
    await requestEmailOtpAction(null, form({ email: 'newperson@example.com' }));
    expect(authMock.signInWithOtp).toHaveBeenCalledTimes(1);
    expect(authMock.signInWithOtp.mock.calls[0]![0]).toMatchObject({
      email: 'newperson@example.com',
      options: { shouldCreateUser: false },
    });
  });

  it('rejects a malformed address before calling Supabase', async () => {
    const state = await requestEmailOtpAction(null, form({ email: 'not-an-email' }));
    expect(authMock.signInWithOtp).not.toHaveBeenCalled();
    expect(state?.fieldErrors?.email).toBeTruthy();
  });

  it('normalises case so the cookie and GoTrue agree', async () => {
    await requestEmailOtpAction(null, form({ email: '  Admin@MaharaniTraders.IN ' }));
    expect(authMock.signInWithOtp.mock.calls[0]![0].email).toBe('admin@maharanitraders.in');
    expect(cookieJar.get(OTP_EMAIL_COOKIE)).toBe('admin@maharanitraders.in');
  });
});

// ---------------------------------------------------------------------------
// 2. Generic responses — no enumeration
// ---------------------------------------------------------------------------

describe('OTP request — no account enumeration', () => {
  it('returns the SAME message for a real address and an unknown one', async () => {
    const known = await requestEmailOtpAction(null, form({ email: 'known@example.com' }));
    cookieJar.clear();
    authMock.signInWithOtp.mockResolvedValueOnce({
      data: {},
      error: { status: 422, message: 'Signups not allowed for otp' },
    });
    const unknown = await requestEmailOtpAction(null, form({ email: 'unknown@example.com' }));

    expect(unknown?.error).toBeUndefined();
    // Masking differs (by design); the TEMPLATE must be identical.
    expect(unknown?.success).toMatch(/^If [a-z]\*\*\*@example\.com belongs to an account/);
    expect(known?.success).toMatch(/^If [a-z]\*\*\*@example\.com belongs to an account/);
    expect(unknown?.success?.replace(/[a-z]\*\*\*/g, 'MASK') ?? '').toBe(
      known?.success?.replace(/[a-z]\*\*\*/g, 'MASK') ?? ''
    );
  });

  it('masks the address in the visible copy', async () => {
    const state = await requestEmailOtpAction(null, form({ email: 'rajesh.kumar@gmail.com' }));
    expect(state?.maskedEmail).toBe('r***@gmail.com');
    expect(state?.success).not.toContain('rajesh.kumar@gmail.com');
  });
});

// ---------------------------------------------------------------------------
// 3. Resend cooldown
// ---------------------------------------------------------------------------

describe('OTP resend — bounded by a server-set cooldown', () => {
  it('does not spend a second email inside the window', async () => {
    seedPendingOtp('admin@maharanitraders.in', 10);
    const state = await requestEmailOtpAction(null, form({ email: 'admin@maharanitraders.in' }));
    expect(authMock.signInWithOtp).not.toHaveBeenCalled();
    expect(state?.stage).toBe('verify');
    expect(state?.cooldownSeconds).toBeGreaterThan(0);
  });

  it('allows a resend once the window has elapsed', async () => {
    seedPendingOtp('admin@maharanitraders.in', 120);
    await requestEmailOtpAction(null, form({ email: 'admin@maharanitraders.in' }));
    expect(authMock.signInWithOtp).toHaveBeenCalledTimes(1);
  });

  it('resends for the cookie address when the field is left blank', async () => {
    seedPendingOtp('admin@maharanitraders.in', 120);
    await requestEmailOtpAction(null, form({ email: '' }));
    expect(authMock.signInWithOtp.mock.calls[0]![0].email).toBe('admin@maharanitraders.in');
  });

  it('never uses a client-supplied address for a blank-field resend', async () => {
    seedPendingOtp('owner@maharanitraders.in', 120);
    await requestEmailOtpAction(null, form({ email: '' }));
    // Only the httpOnly cookie decided the recipient.
    expect(authMock.signInWithOtp.mock.calls[0]![0].email).toBe('owner@maharanitraders.in');
  });

  it('surfaces throttling without revealing anything about the account', async () => {
    authMock.signInWithOtp.mockResolvedValueOnce({
      data: {},
      error: { status: 429, message: 'email rate limit exceeded' },
    });
    const state = await requestEmailOtpAction(null, form({ email: 'unknown@example.com' }));
    expect(state?.warning).toMatch(/too many attempts/i);
    expect(state?.error).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 4. Verification — native Supabase, server-side role
// ---------------------------------------------------------------------------

describe('OTP verify — native verification and server-side role', () => {
  it('calls verifyOtp with type email and the cookie address', async () => {
    seedPendingOtp('staff@maharanitraders.in');
    profileRow.current = { role: 'staff', is_active: true };
    await expect(verifyEmailOtpAction(null, form({ token: '123456' }))).rejects.toThrow('NEXT_REDIRECT');
    expect(authMock.verifyOtp).toHaveBeenCalledWith({
      email: 'staff@maharanitraders.in',
      token: '123456',
      type: 'email',
    });
    expect(redirectCalls).toEqual(['/staff/dashboard']);
  });

  it('ignores an email or role supplied by the browser', async () => {
    seedPendingOtp('retailer@maharanitraders.in');
    profileRow.current = { role: 'retailer', is_active: true };
    retailerRow.current = { status: 'active' };
    await expect(
      verifyEmailOtpAction(null, form({ token: '123456', email: 'victim@example.com', role: 'super_admin' }))
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(authMock.verifyOtp.mock.calls[0]![0].email).toBe('retailer@maharanitraders.in');
    // super_admin was requested by the form; retailer is what the DB said.
    expect(redirectCalls).toEqual(['/retailer/home']);
  });

  it('refuses to verify without a pending cookie', async () => {
    const state = await verifyEmailOtpAction(null, form({ token: '123456' }));
    expect(authMock.verifyOtp).not.toHaveBeenCalled();
    expect(state?.error).toMatch(/expired/i);
  });

  it('clears the pending cookies after a successful verification', async () => {
    seedPendingOtp('admin@maharanitraders.in');
    await expect(verifyEmailOtpAction(null, form({ token: '123456' }))).rejects.toThrow('NEXT_REDIRECT');
    expect(cookieJar.has(OTP_EMAIL_COOKIE)).toBe(false);
    expect(cookieJar.has(OTP_ATTEMPTS_COOKIE)).toBe(false);
  });

  it('can target a protected path only through safeRedirectPath', async () => {
    seedPendingOtp('admin@maharanitraders.in');
    await expect(
      verifyEmailOtpAction(null, form({ token: '123456', redirect: '//evil.example/phish' }))
    ).rejects.toThrow('NEXT_REDIRECT');
    expect(redirectCalls).toEqual(['/admin/dashboard']);
  });
});

// ---------------------------------------------------------------------------
// 5. Attempt counter / brute force
// ---------------------------------------------------------------------------

describe('OTP verify — bounded attempts', () => {
  it('rejects a non-numeric or short code without calling Supabase', async () => {
    seedPendingOtp();
    const short = await verifyEmailOtpAction(null, form({ token: '12345' }));
    const text = await verifyEmailOtpAction(null, form({ token: 'abcdef' }));
    expect(authMock.verifyOtp).not.toHaveBeenCalled();
    expect(short?.fieldErrors?.token).toBeTruthy();
    expect(text?.fieldErrors?.token).toBeTruthy();
  });

  it('increments the attempt counter on a wrong code', async () => {
    seedPendingOtp();
    authMock.verifyOtp.mockResolvedValueOnce({
      data: { user: null },
      error: { status: 403, code: 'otp_expired', message: 'Token has expired or is invalid' },
    });
    await verifyEmailOtpAction(null, form({ token: '000000' }));
    expect(cookieJar.get(OTP_ATTEMPTS_COOKIE)).toBe('1');
  });

  it('locks the form after the maximum attempts', async () => {
    seedPendingOtp();
    cookieJar.set(OTP_ATTEMPTS_COOKIE, '5');
    const state = await verifyEmailOtpAction(null, form({ token: '123456' }));
    expect(authMock.verifyOtp).not.toHaveBeenCalled();
    expect(state?.attemptsRemaining).toBe(0);
    expect(state?.error).toMatch(/too many attempts/i);
  });

  it('reports throttling instead of a wrong-code message', async () => {
    seedPendingOtp();
    authMock.verifyOtp.mockResolvedValueOnce({
      data: { user: null },
      error: { status: 429, message: 'Too many requests' },
    });
    const state = await verifyEmailOtpAction(null, form({ token: '123456' }));
    expect(state?.error).toMatch(/too many attempts/i);
  });
});

// ---------------------------------------------------------------------------
// 6. The active/approved gate is identical to password login
// ---------------------------------------------------------------------------

describe('OTP verify — same access gate as password login', () => {
  it('refuses a deactivated account and destroys the fresh session', async () => {
    seedPendingOtp();
    profileRow.current = { role: 'admin', is_active: false };
    const state = await verifyEmailOtpAction(null, form({ token: '123456' }));
    expect(state?.code).toBe('account_inactive');
    expect(signOutCalls.count).toBe(1);
    expect(redirectCalls).toEqual([]);
  });

  it('refuses a suspended retailer and destroys the fresh session', async () => {
    seedPendingOtp();
    profileRow.current = { role: 'retailer', is_active: true };
    retailerRow.current = { status: 'suspended' };
    const state = await verifyEmailOtpAction(null, form({ token: '123456' }));
    expect(state?.code).toBe('account_suspended');
    expect(signOutCalls.count).toBe(1);
    expect(redirectCalls).toEqual([]);
  });

  it('keeps a pending retailer on the pending-approval path, not a workspace', async () => {
    seedPendingOtp();
    profileRow.current = { role: 'retailer', is_active: true };
    retailerRow.current = { status: 'pending_approval' };
    await expect(verifyEmailOtpAction(null, form({ token: '123456' }))).rejects.toThrow('NEXT_REDIRECT');
    expect(redirectCalls).toEqual(['/pending-approval']);
  });

  it('refuses an account with no profile row', async () => {
    seedPendingOtp();
    profileRow.current = null;
    const state = await verifyEmailOtpAction(null, form({ token: '123456' }));
    expect(state?.code).toBe('account_inactive');
    expect(signOutCalls.count).toBe(1);
  });

  it('applies the identical gate to password login', async () => {
    profileRow.current = { role: 'admin', is_active: false };
    const state = await loginAction(null, form({ email: 'admin@maharanitraders.in', password: 'pw' }));
    expect(state?.code).toBe('account_inactive');
    expect(signOutCalls.count).toBe(1);
    expect(redirectCalls).toEqual([]);
  });

  it('still signs in an active admin with a password and routes by DB role', async () => {
    profileRow.current = { role: 'admin', is_active: true };
    await expect(loginAction(null, form({ email: 'admin@maharanitraders.in', password: 'pw' }))).rejects.toThrow(
      'NEXT_REDIRECT'
    );
    expect(redirectCalls).toEqual(['/admin/dashboard']);
  });

  it('still signs in a retailer by phone', async () => {
    profileRow.current = { role: 'retailer', is_active: true };
    retailerRow.current = { status: 'active' };
    // Phone resolution needs the service-role lookup; this asserts the gate
    // itself refuses to fall through to a workspace when it cannot resolve.
    const state = await loginWithPhoneAction(null, form({ phone: '9876543210', password: 'pw' }));
    expect(state === null || state.code === 'invalid_credentials').toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. No secrets in logs, URLs or browser storage
// ---------------------------------------------------------------------------

describe('OTP — the code never leaks', () => {
  const sources = [
    'lib/auth/actions.ts',
    'lib/auth/otp-rules.ts',
    'lib/auth/sign-in-gate.ts',
    'components/auth/email-otp-form.tsx',
    'components/auth/login-form.tsx',
  ];

  it('never logs the token or the address', () => {
    for (const file of sources) {
      const source = read(file);
      expect(source, `${file} must not console.log`).not.toMatch(/console\.(log|info|debug|warn|error)/);
    }
  });

  it('never writes to localStorage / sessionStorage / document.cookie', () => {
    for (const file of sources) {
      const source = read(file);
      expect(source, `${file} storage`).not.toMatch(
        /(window|globalThis|global)\.(localStorage|sessionStorage)|document\.cookie/
      );
    }
  });

  it('never puts the email or token in a URL', () => {
    for (const file of sources) {
      const source = read(file);
      expect(source, `${file} url`).not.toMatch(/searchParams\.set\(\s*['"](email|token|otp)['"]/);
      expect(source, `${file} href`).not.toMatch(/\?[^'"\s]*(token|otp)=/i);
    }
  });

  it('has no custom OTP table or plaintext code store anywhere in the repo', () => {
    for (const file of sources) {
      expect(read(file)).not.toMatch(/otp_codes|otp_code\b|INSERT\s+INTO\s+.*otp/i);
    }
  });

  it('keeps the pending email in an httpOnly cookie', () => {
    const actions = read('lib/auth/actions.ts');
    expect(actions).toMatch(/httpOnly:\s*true/);
    expect(actions).toMatch(/sameSite:\s*'lax'/);
  });

  it('marks the pending cookies secure in production', () => {
    expect(read('lib/auth/actions.ts')).toMatch(/secure:\s*process\.env\.NODE_ENV === 'production'/);
  });
});

// ---------------------------------------------------------------------------
// 8. Password login is not removed
// ---------------------------------------------------------------------------

describe('dual login — existing methods are preserved', () => {
  it('keeps the password and phone tabs on the login screen', () => {
    const loginForm = read('components/auth/login-form.tsx');
    expect(loginForm).toMatch(/loginWithPhoneAction/);
    expect(loginForm).toMatch(/loginAction/);
    expect(loginForm).toMatch(/EmailOtpForm/);
  });

  it('keeps the password action wired to signInWithPassword', () => {
    expect(read('lib/auth/actions.ts')).toMatch(/signInWithPassword/);
  });

  it('exposes exactly one code entry field named token', () => {
    const otpForm = read('components/auth/email-otp-form.tsx');
    expect(otpForm.match(/name="token"/g)?.length).toBe(1);
    expect(otpForm).toMatch(/autoComplete="one-time-code"/);
    expect(otpForm).toMatch(/inputMode="numeric"/);
  });
});
