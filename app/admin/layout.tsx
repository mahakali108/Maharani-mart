import { requireUser } from '@/lib/auth/session';
import { AdminShell } from '@/components/layout/admin-shell';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // middleware.ts already restricts /admin/* to super_admin/admin, this
  // is a defense-in-depth check for direct server-side rendering.
  return (
    <AdminShell fullName={user.fullName} role={user.role}>
      {children}
    </AdminShell>
  );
}
