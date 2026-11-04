import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  createServerClient: vi.fn((_url: string, _key: string, options: unknown) => ({ options })),
}));

vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
vi.mock('@supabase/ssr', () => ({ createServerClient: mocks.createServerClient }));

import { createClient, createServiceRoleClient } from '@/lib/supabase/server';

describe('Supabase server client with async Next request cookies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.invalid');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'fake-anon');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fake-service');
  });

  it('awaits the cookie store and forwards reads, writes and removals', async () => {
    const store = { get: vi.fn(() => ({ value: 'session' })), set: vi.fn() };
    mocks.cookies.mockResolvedValue(store);
    await createClient();
    expect(mocks.cookies).toHaveBeenCalledOnce();
    const options = mocks.createServerClient.mock.calls[0]![2] as {
      cookies: { get: (name: string) => string | undefined; set: (name: string, value: string, options: object) => void; remove: (name: string, options: object) => void };
    };
    expect(options.cookies.get('token')).toBe('session');
    options.cookies.set('token', 'new', { path: '/' });
    options.cookies.remove('token', { path: '/' });
    expect(store.set).toHaveBeenNthCalledWith(1, { name: 'token', value: 'new', path: '/' });
    expect(store.set).toHaveBeenNthCalledWith(2, { name: 'token', value: '', path: '/' });
  });

  it('keeps the privileged factory synchronous and independent of request cookies', () => {
    const client = createServiceRoleClient();
    expect(client).not.toBeInstanceOf(Promise);
    expect(mocks.cookies).not.toHaveBeenCalled();
  });
});
