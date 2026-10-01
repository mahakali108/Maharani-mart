import 'server-only';
import { redirect } from 'next/navigation';
import { requireUser, type CurrentUser } from '@/lib/auth/session';

/**
 * Control Center guard: confirms the caller is authenticated AND is
 * a super_admin. Defense-in-depth alongside middleware and RLS.
 *
 * Use in Server Actions — a denial throws, so the caller receives a
 * readable error message.
 */
export async function requireSuperAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== 'super_admin') {
    throw new Error('Access denied. Super Admin authorization required.');
  }
  return user;
}

/**
 * PAGE-render variant: middleware admits every admin to /admin/*, so a
 * plain admin can navigate to the Control Center URL. Denying them must be
 * a clean /unauthorized redirect (like every other role gate), not a thrown
 * error that renders the "Something went wrong" crash boundary.
 */
export async function requireSuperAdminPage(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== 'super_admin') {
    redirect('/unauthorized');
  }
  return user;
}
