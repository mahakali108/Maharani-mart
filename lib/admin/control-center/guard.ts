import 'server-only';
import { requireUser, type CurrentUser } from '@/lib/auth/session';

/**
 * Control Center guard: confirms the caller is authenticated AND is
 * a super_admin. Defense-in-depth alongside middleware and RLS.
 */
export async function requireSuperAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== 'super_admin') {
    throw new Error('Access denied. Super Admin authorization required.');
  }
  return user;
}
