import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { isRoleAllowedForPath } from '@/lib/auth/roles';
import { AdminShell } from '@/components/layout/admin-shell';
import { loadFooterLinks } from '@/lib/site-content/nav';

/**
 * Admin/Super Admin shell.
 *
 * Three independent gates protect /admin/*, in this order:
 *   1. `middleware.ts` — authenticated + active profile + role prefix
 *      (`ROLE_ROUTE_PREFIXES['/admin']` = super_admin, admin).
 *   2. this layout — the SAME role-prefix rule, re-evaluated server-side so a
 *      direct server render (a streamed RSC request, a future rewrite, or
 *      middleware being misconfigured) cannot paint an admin page for a
 *      retailer, staff member, salesman or seller. Previously this layout only
 *      called `requireUser()`, which proves "somebody is signed in" but not
 *      "this somebody may see the admin area"; the 35 admin pages that do not
 *      call a page-level guard themselves relied on middleware alone.
 *   3. page-level `requirePermission(...)` / `requirePagePermission(...)` for
 *      narrower powers inside the admin area (e.g. super-admin-only screens).
 *
 * RLS remains the real data boundary; this is defence in depth, exactly like
 * app/staff/layout.tsx and app/salesman/layout.tsx.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (!isRoleAllowedForPath(user.role, '/admin')) {
    redirect('/unauthorized');
  }
  const footerLinks = await loadFooterLinks();
  return (
    <AdminShell fullName={user.fullName} role={user.role} footerLinks={footerLinks}>
      {children}
    </AdminShell>
  );
}
