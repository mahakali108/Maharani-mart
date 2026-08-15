import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { isRoleAllowedForPath } from '@/lib/auth/roles';
import { StaffShell } from '@/components/layout/staff-shell';

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  // Middleware performs the same role-prefix check on every request.
  // Repeating it in the server layout keeps staff pages protected even
  // when rendered outside the normal browser navigation flow.
  if (!isRoleAllowedForPath(user.role, '/staff')) redirect('/unauthorized');

  return (
    <StaffShell fullName={user.fullName} role={user.role}>
      {children}
    </StaffShell>
  );
}
