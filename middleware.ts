import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { homeForRole, isRoleAllowedForPath, type UserRole } from '@/lib/auth/roles';
import type { RetailerStatusEnum } from '@/types/database.types';

interface ProfileRoleActiveRow {
  role: UserRole;
  is_active: boolean;
}

interface RetailerStatusRow {
  status: RetailerStatusEnum;
}

interface AccessPeriodRow {
  status: string;
  expires_at: string | null;
}

const PROTECTED_PREFIXES = ['/admin', '/staff', '/salesman', '/retailer', '/seller', '/pending-approval'];

function isProtectedPath(pathname: string) {
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

/** Preserve refreshed and cleared auth cookies across every middleware redirect. */
function redirectWithCookies(url: URL, response: NextResponse) {
  const redirect = NextResponse.redirect(url);
  for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}

/**
 * Check if a user's access period is still valid.
 * Super Admin is NEVER blocked by the access period system.
 */
async function isAccessValid(supabase: ReturnType<typeof updateSession> extends Promise<infer R> ? (R extends { supabase: infer S } ? S : never) : never, userId: string, role: UserRole): Promise<boolean> {
  // Super Admin always has unlimited access
  if (role === 'super_admin') return true;

  const { data: accessPeriod } = await supabase
    .from('user_access_periods')
    .select('status, expires_at')
    .eq('user_id', userId)
    .in('status', ['active', 'expiring_soon', 'unlimited'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<AccessPeriodRow>();

  // No access record = allow (backward compatibility)
  if (!accessPeriod) return true;

  // Unlimited access
  if (accessPeriod.status === 'unlimited') return true;

  // Check expiry
  if (!accessPeriod.expires_at) return true;
  return new Date(accessPeriod.expires_at) > new Date();
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const { response, supabase, user } = await updateSession(request);

  // Not logged in and hitting a protected route -> send to login.
  if (!user && isProtectedPath(pathname)) {
    const redirectUrl = new URL('/login', request.url);
    redirectUrl.searchParams.set('redirect', pathname);
    return redirectWithCookies(redirectUrl, response);
  }

  // Logged in -> look up role + (if retailer) approval status, then
  // enforce role-based routing and the pending-approval gate.
  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, is_active')
      .eq('id', user.id)
      .single<ProfileRoleActiveRow>();

    if (!profile || !profile.is_active) {
      await supabase.auth.signOut();
      const redirectUrl = new URL('/login', request.url);
      redirectUrl.searchParams.set('error', 'account_inactive');
      return redirectWithCookies(redirectUrl, response);
    }

    const role = profile.role;

    // Check access period (7-day expiry system).
    // Super Admin is NEVER blocked.
    if (role !== 'super_admin' && isProtectedPath(pathname) && pathname !== '/access-expired') {
      const accessValid = await isAccessValid(supabase, user.id, role);
      if (!accessValid) {
        return redirectWithCookies(new URL('/access-expired', request.url), response);
      }
    }

    if (role === 'retailer' && pathname !== '/pending-approval') {
      const { data: retailer } = await supabase
        .from('retailers')
        .select('status')
        .eq('id', user.id)
        .single<RetailerStatusRow>();

      if (retailer?.status === 'pending_approval' && isProtectedPath(pathname)) {
        return redirectWithCookies(new URL('/pending-approval', request.url), response);
      }
      if (retailer?.status === 'suspended') {
        await supabase.auth.signOut();
        const redirectUrl = new URL('/login', request.url);
        redirectUrl.searchParams.set('error', 'account_suspended');
        return redirectWithCookies(redirectUrl, response);
      }
    }

    // Middleware is convenience only: every seller page/action/RLS policy
    // independently enforces active tenant membership, including stale JWTs.
    if (role === 'seller' && (pathname === '/seller' || pathname.startsWith('/seller/'))) {
      const { data: membership } = await supabase
        .from('seller_members' as never)
        .select('seller_id')
        .eq('profile_id', user.id)
        .maybeSingle<{ seller_id: string }>();
      if (!membership) return redirectWithCookies(new URL('/unauthorized', request.url), response);
      const { data: seller } = await supabase
        .from('sellers' as never)
        .select('status')
        .eq('id', membership.seller_id)
        .maybeSingle<{ status: string }>();
      if (!seller) return redirectWithCookies(new URL('/unauthorized', request.url), response);
      if (seller.status !== 'active' && pathname !== '/seller/status') {
        return redirectWithCookies(new URL('/seller/status', request.url), response);
      }
      if (seller.status === 'active' && pathname === '/seller/status') {
        return redirectWithCookies(new URL('/seller/dashboard', request.url), response);
      }
    }

    // Already logged in, don't let them sit on login/register screens.
    if (pathname === '/login' || pathname === '/register-retailer' || pathname === '/register-seller') {
      return redirectWithCookies(new URL(homeForRole(role), request.url), response);
    }

    if (isProtectedPath(pathname) && pathname !== '/pending-approval' && !isRoleAllowedForPath(role, pathname)) {
      return redirectWithCookies(new URL('/unauthorized', request.url), response);
    }
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all paths except static assets and Next internals.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
