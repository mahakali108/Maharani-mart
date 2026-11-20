import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { isRetiredRole, isSupportedRole, type UserRole } from '@/lib/auth/roles';

export interface CurrentUser {
  id: string;
  email: string | null;
  fullName: string;
  role: UserRole;
}

interface ProfileRow {
  /** Plain string: a historical row may still hold the retired `seller` role. */
  role: string;
  full_name: string;
  is_active: boolean;
}

interface RetailerStatusRow {
  status: string;
}

/**
 * Server-only helper for layouts, pages AND Server Actions: fetches the
 * authenticated user plus their profile, and refuses accounts that are not
 * allowed to act. Middleware performs the same gate for page navigation, but
 * a Server Action / route handler can be invoked directly (and a JWT stays
 * valid after suspension until it expires), so this check must not depend
 * on middleware having run:
 *
 *   - retired role (profiles.role = 'seller')       → /login?error=role_retired
 *   - deactivated profile (profiles.is_active = false) → /login?error=account_inactive
 *   - retailer without an approved retailers row:
 *       suspended            → /login?error=account_suspended
 *       pending / no row     → /pending-approval
 *
 * `redirect()` throws, so no protected code after this call runs for them.
 * The database enforces the same rule independently (migration 0052:
 * is_active_account() restrictive policies + current_user_role()).
 */
export async function requireUser(): Promise<CurrentUser> {
  const supabase = (await createClient());
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, full_name, is_active')
    .eq('id', user!.id)
    .single<ProfileRow>();

  if (!profile) {
    redirect('/login');
  }

  if (profile!.is_active !== true) {
    redirect('/login?error=account_inactive');
  }

  // Seller/Supplier removal: a retired role is refused here as well, because a
  // Server Action or route handler can be invoked without middleware running.
  // `redirect()` throws, so no protected code below executes for such a user.
  if (isRetiredRole(profile!.role)) {
    await supabase.auth.signOut();
    redirect('/login?error=role_retired');
  }
  if (!isSupportedRole(profile!.role)) {
    await supabase.auth.signOut();
    redirect('/login?error=account_inactive');
  }

  if (profile!.role === 'retailer') {
    const { data: retailer } = await supabase
      .from('retailers')
      .select('status')
      .eq('id', user!.id)
      .maybeSingle<RetailerStatusRow>();

    if (retailer?.status === 'suspended') {
      redirect('/login?error=account_suspended');
    }
    if (retailer?.status !== 'active') {
      redirect('/pending-approval');
    }
  }

  return {
    id: user!.id,
    email: user!.email ?? null,
    fullName: profile!.full_name,
    role: profile!.role as UserRole,
  };
}
