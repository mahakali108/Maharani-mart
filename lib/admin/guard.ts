import 'server-only';
import { redirect } from 'next/navigation';
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

/**
 * PAGE-render guard: same check as `requirePermission`, but a denial sends
 * the user to /unauthorized instead of throwing.
 *
 * Use this in `page.tsx` server components. Middleware admits whole role
 * groups per URL prefix (e.g. admin may browse /salesman/*), so a page can
 * legitimately be reached by a role that doesn't hold its permission — an
 * admin opening the super-admin-only team editor, for example. Throwing
 * there renders the generic "Something went wrong" error boundary, which
 * reads like a malfunction; the correct page-navigation outcome is the same
 * clean /unauthorized redirect middleware itself uses.
 *
 * Server Actions must keep using the throwing `requirePermission`, so the
 * caller gets a readable error message back instead of a redirect.
 */
export async function requirePagePermission(permission: Permission): Promise<CurrentUser> {
  const user = await requireUser();
  if (!can(user.role, permission)) {
    redirect('/unauthorized');
  }
  return user;
}
