/**
 * Sign-in applicability shared by every credential path.
 *
 * WHY THIS EXISTS: password login and email-OTP login must grant exactly the
 * same set of privileges. Before this module, the password path redirected by
 * role but performed ONLY the `is_active` check that `middleware.ts` also
 * performs; the retailer `pending_approval` gate lived only in middleware and
 * `requireUser()`. A Server Action can be invoked directly, so a second
 * credential path that skipped the gate would be a privilege gap. Both paths
 * now call `assertSignInAllowed()`, which encodes the same rules as
 * `middleware.ts` and `lib/auth/session.ts`:
 *
 *   profiles.is_active = false                    → session revoked, refused
 *   retailers.status = suspended                  → session revoked, refused
 *   retailers.status = pending_approval / missing → NOT refused; redirected
 *                                                   to /pending-approval
 *
 * Nothing here invents a role: the role is read from `profiles` server-side,
 * keyed by the auth user id returned by Supabase.
 */

import type { homeForRole, UserRole } from '@/lib/auth/roles';

/** Minimal structural view of the RLS-scoped Supabase client we need. */
export interface SessionSupabaseLike {
  auth: {
    signOut: () => Promise<unknown>;
  };
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string
      ) => {
        single: <T>() => PromiseLike<{ data: T | null; error: unknown }>;
        maybeSingle: <T>() => PromiseLike<{ data: T | null; error: unknown }>;
      };
    };
  };
}

interface ProfileGateRow {
  role: UserRole;
  is_active: boolean;
}

interface RetailerGateRow {
  status: string;
}

export type SignInDecision =
  | { allowed: true; role: UserRole; destination: string }
  | { allowed: false; error: string; code: 'account_inactive' | 'account_suspended' };

/**
 * Reads role + approval status and decides whether this session may proceed.
 * On refusal the freshly created session is destroyed, so a denied OTP/password
 * sign-in never leaves a usable cookie behind.
 */
export async function assertSignInAllowed(
  supabase: SessionSupabaseLike,
  userId: string,
  safeRedirect: string | null,
  buildHome: typeof homeForRole
): Promise<SignInDecision> {
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, is_active')
    .eq('id', userId)
    .single<ProfileGateRow>();

  if (profileError || !profile) {
    await supabase.auth.signOut();
    return {
      allowed: false,
      code: 'account_inactive',
      error: 'Your account is not set up for sign-in. Contact your distributor.',
    };
  }

  if (profile.is_active !== true) {
    await supabase.auth.signOut();
    return {
      allowed: false,
      code: 'account_inactive',
      error: 'Your account has been deactivated. Contact your distributor.',
    };
  }

  if (profile.role === 'retailer') {
    const { data: retailer } = await supabase
      .from('retailers')
      .select('status')
      .eq('id', userId)
      .maybeSingle<RetailerGateRow>();

    if (retailer?.status === 'suspended') {
      await supabase.auth.signOut();
      return {
        allowed: false,
        code: 'account_suspended',
        error: 'Your retailer account is suspended. Contact your distributor.',
      };
    }

    if (retailer?.status !== 'active') {
      // Pending (or pre-approval) retailers keep a valid session — the
      // pending-approval screen depends on it — but never reach a workspace.
      return { allowed: true, role: profile.role, destination: '/pending-approval' };
    }
  }

  return { allowed: true, role: profile.role, destination: safeRedirect ?? buildHome(profile.role) };
}
