import 'server-only';
import { requireUser, type CurrentUser } from '@/lib/auth/session';
import { can, type Permission } from '@/lib/permissions/permissions';

/**
 * Server Action guard: confirms the caller is authenticated AND holds
 * the given permission before a mutation proceeds. This is
 * defense-in-depth alongside RLS (see docs/role_permission_matrix.md)
 * — a Server Action bug alone can't grant unauthorized writes because
 * RLS would still reject them, but failing loudly here gives a clean
 * error message instead of a raw Postgres RLS denial reaching the UI.
 */
export async function requirePermission(permission: Permission): Promise<CurrentUser> {
  const user = await requireUser();
  if (!can(user.role, permission)) {
    throw new Error(`You don't have permission to do that (requires "${permission}").`);
  }
  return user;
}
