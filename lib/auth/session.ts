import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { UserRole } from '@/lib/auth/roles';

export interface CurrentUser {
  id: string;
  email: string | null;
  fullName: string;
  role: UserRole;
}

interface ProfileRow {
  role: UserRole;
  full_name: string;
}

/**
 * Server-only helper for layouts/pages: fetches the authenticated user
 * plus their profile. Middleware already enforces role-based routing,
 * so this is a defense-in-depth check (also gives layouts the display
 * name/role they need without duplicating the query everywhere).
 */
export async function requireUser(): Promise<CurrentUser> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, full_name')
    .eq('id', user!.id)
    .single<ProfileRow>();

  if (!profile) {
    redirect('/login');
  }

  return {
    id: user!.id,
    email: user!.email ?? null,
    fullName: profile!.full_name,
    role: profile!.role,
  };
}
