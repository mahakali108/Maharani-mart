import { requireUser } from '@/lib/auth/session';
import { SalesmanShell } from '@/components/layout/salesman-shell';

export default async function SalesmanLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <SalesmanShell fullName={user.fullName} role={user.role}>
      {children}
    </SalesmanShell>
  );
}
