import { requireUser } from '@/lib/auth/session';
import { RetailerShell } from '@/components/layout/retailer-shell';

export default async function RetailerLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <RetailerShell fullName={user.fullName} role={user.role}>
      {children}
    </RetailerShell>
  );
}
