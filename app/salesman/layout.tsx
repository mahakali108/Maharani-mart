import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { isRoleAllowedForPath } from '@/lib/auth/roles';
import { SalesmanShell } from '@/components/layout/salesman-shell';
import { loadFooterLinks } from '@/lib/site-content/nav';

export default async function SalesmanLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (!isRoleAllowedForPath(user.role, '/salesman')) redirect('/unauthorized');
  const footerLinks = await loadFooterLinks();
  return (
    <SalesmanShell fullName={user.fullName} role={user.role} footerLinks={footerLinks}>
      {children}
    </SalesmanShell>
  );
}
