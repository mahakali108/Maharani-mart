import 'server-only';

import { requireUser, type CurrentUser } from '@/lib/auth/session';

/** Defense-in-depth for salesman-only Server Actions. */
export async function requireSalesman(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== 'salesman') {
    throw new Error('Only a salesman can perform this action.');
  }
  return user;
}
