import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({ updateSession: vi.fn() }));
vi.mock('@/lib/supabase/middleware', () => ({ updateSession: mocks.updateSession }));
import { middleware } from '@/middleware';

describe('middleware redirects preserve session cookie updates', () => {
  beforeEach(() => vi.clearAllMocks());

  it('preserves every refreshed chunk when redirecting an unauthenticated request', async () => {
    const response = NextResponse.next();
    response.cookies.set('sb-token.0', 'first', { path: '/', httpOnly: true });
    response.cookies.set('sb-token.1', 'second', { path: '/', httpOnly: true });
    mocks.updateSession.mockResolvedValue({ response, supabase: {}, user: null });
    const result = await middleware(new NextRequest('https://example.test/retailer/home'));
    expect(result.status).toBe(307);
    expect(result.cookies.get('sb-token.0')?.value).toBe('first');
    expect(result.cookies.get('sb-token.1')?.value).toBe('second');
    expect(result.cookies.get('sb-token.0')?.httpOnly).toBe(true);
  });

  it('forwards sign-out cookie changes when an inactive account is redirected', async () => {
    const response = NextResponse.next();
    const signOut = vi.fn(async () => { response.cookies.set('sb-token', '', { path: '/', maxAge: 0 }); });
    const single = vi.fn(async () => ({ data: { role: 'retailer', is_active: false } }));
    const supabase = { auth: { signOut }, from: () => ({ select: () => ({ eq: () => ({ single }) }) }) };
    mocks.updateSession.mockResolvedValue({ response, supabase, user: { id: 'test-user' } });
    const result = await middleware(new NextRequest('https://example.test/retailer/home'));
    expect(signOut).toHaveBeenCalledOnce();
    expect(result.status).toBe(307);
    expect(result.cookies.get('sb-token')?.value).toBe('');
    expect(result.cookies.get('sb-token')?.maxAge).toBe(0);
  });
});
