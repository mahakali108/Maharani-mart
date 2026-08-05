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

const PUBLIC_PATHS = ['/login', '/register-retailer', '/auth/callback', '/unauthorized'];
const PROTECTED_PREFIXES = ['/admin', '/staff', '/salesman', '/retailer', '/pending-approval'];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

function isProtectedPath(pathname: string) {
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const { response, supabase, user } = await updateSession(request);

  // Not logged in and hitting a protected route -> send to login.
  if (!user && isProtectedPath(pathname)) {
    const redirectUrl = new URL('/login', request.url);
    redirectUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(redirectUrl);
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
      return NextResponse.redirect(redirectUrl);
    }

    const role = profile.role;

    if (role === 'retailer' && pathname !== '/pending-approval') {
      const { data: retailer } = await supabase
        .from('retailers')
        .select('status')
        .eq('id', user.id)
        .single<RetailerStatusRow>();

      if (retailer?.status === 'pending_approval' && isProtectedPath(pathname)) {
        return NextResponse.redirect(new URL('/pending-approval', request.url));
      }
      if (retailer?.status === 'suspended') {
        await supabase.auth.signOut();
        const redirectUrl = new URL('/login', request.url);
        redirectUrl.searchParams.set('error', 'account_suspended');
        return NextResponse.redirect(redirectUrl);
      }
    }

    // Already logged in, don't let them sit on login/register screens.
    if (pathname === '/login' || pathname === '/register-retailer') {
      return NextResponse.redirect(new URL(homeForRole(role), request.url));
    }

    if (isProtectedPath(pathname) && pathname !== '/pending-approval' && !isRoleAllowedForPath(role, pathname)) {
      return NextResponse.redirect(new URL('/unauthorized', request.url));
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
