import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { homeForRole, isRetiredPath, isRetiredRole, isRoleAllowedForPath, isSupportedRole, type UserRole } from '@/lib/auth/roles';
import type { RetailerStatusEnum } from '@/types/database.types';

interface ProfileRoleActiveRow {
  // Read as a plain string: the stored value may still be the retired
  // `seller` role, which is no longer part of `UserRole`.
  role: string;
  is_active: boolean;
}

interface RetailerStatusRow {
  status: RetailerStatusEnum;
}

interface AccessPeriodRow {
  status: string;
  expires_at: string | null;
}

// `/seller` and the seller/supplier registration routes are intentionally NOT
// listed: those paths no longer exist, so an unauthenticated visit must 404
// rather than be bounced to a login page that implies the module still exists.
const PROTECTED_PREFIXES = ['/admin', '/staff', '/salesman', '/retailer', '/pending-approval'];

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

  // Retired seller/supplier paths no longer exist. Let them fall through to
  // Next's 404 instead of redirecting (a redirect would either loop through
  // /login or imply the module is still available).
  if (isRetiredPath(pathname)) {
    return response;
  }

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

    const role = profile.role as UserRole;

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

    // RETIRED ROLE REFUSAL. `seller` is no longer a supported role, but the
    // value still exists in the PostgreSQL enum and may remain on historical
    // profiles rows. Such an account must never reach any workspace: its
    // session is destroyed here and it is returned to /login. This is a hard
    // refusal, not a redirect into a page, so a stale JWT cannot land anywhere.
    // The same rule is enforced independently in requireUser() and in
    // assertSignInAllowed(); migration 0110 revokes the database capabilities.
    if (isRetiredRole(profile.role)) {
      await supabase.auth.signOut();
      const redirectUrl = new URL('/login', request.url);
      redirectUrl.searchParams.set('error', 'role_retired');
      return redirectWithCookies(redirectUrl, response);
    }

    // Any other unknown role value is a data-integrity fault: fail closed.
    if (!isSupportedRole(profile.role)) {
      await supabase.auth.signOut();
      const redirectUrl = new URL('/login', request.url);
      redirectUrl.searchParams.set('error', 'account_inactive');
      return redirectWithCookies(redirectUrl, response);
    }

    // Already logged in, don't let them sit on login/register screens.
    if (pathname === '/login' || pathname === '/register-retailer') {
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
