import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { isRoleAllowedForPath } from '@/lib/auth/roles';
import { SalesmanShell } from '@/components/layout/salesman-shell';

export default async function SalesmanLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (!isRoleAllowedForPath(user.role, '/salesman')) redirect('/unauthorized');
  return (
    <SalesmanShell fullName={user.fullName} role={user.role}>
      {children}
    </SalesmanShell>
  );
}
