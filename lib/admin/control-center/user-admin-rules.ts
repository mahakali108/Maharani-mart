import 'server-only';

/**
 * Authorization + integrity rules for Super Admin user management.
 *
 * These live in their own module (not inline in the Server Actions) for one
 * reason: a rule that only exists as a few `if` statements inside an 800-line
 * action file cannot be unit-tested, and the failures that matter here are
 * silent ones — an update that returned an error nobody checked still wrote a
 * "role changed" audit row, which is worse than no record at all because it
 * asserts something false.
 *
 * Everything below is pure: no Supabase client, no cookies, no `next/*` import.
 * The actions call it, and tests exercise it directly.
 */

export type ManagedRole = 'super_admin' | 'admin' | 'staff' | 'salesman' | 'retailer' | 'seller';

/**
 * The role set a Super Admin may assign from this screen.
 *
 * `super_admin` is deliberately absent: the first Super Admin is created by the
 * database-owner bootstrap (0106) and later ones only by another Super Admin
 * through a separate, explicitly confirmed flow. A generic "change role"
 * dropdown must never be the path that mints a new superuser, because the role
 * grant is un-auditable at the point of selection (the operator picks a value
 * from a list) whereas the bootstrap is a deliberate, one-time SQL action with
 * its own allowlist and append-only evidence.
 */
export const ASSIGNABLE_ROLES: readonly ManagedRole[] = [
  'admin',
  'staff',
  'salesman',
  'retailer',
  'seller',
] as const;

export function isAssignableRole(value: unknown): value is ManagedRole {
  return typeof value === 'string' && (ASSIGNABLE_ROLES as readonly string[]).includes(value);
}

/**
 * Every privileged user mutation rejects these. The database's
 * `guard_profile_privileged_columns()` (0052) is the real enforcement — a
 * Super Admin cannot change their own role or active flag either, because the
 * trigger only exempts *non-API* callers. This function exists so the operator
 * sees a sentence instead of a raw RLS/trigger denial, and so the refusal is
 * provable in a unit test.
 */
export type SelfAction = 'role' | 'suspend' | 'deactivate' | 'access';

export function assertNotSelf(actorId: string, targetId: string, action: SelfAction): void {
  if (actorId === targetId) {
    const what =
      action === 'role'
        ? 'change your own role'
        : action === 'suspend'
          ? 'suspend your own account'
          : action === 'deactivate'
            ? 'deactivate your own account'
            : 'change your own access period';
    throw new Error(`You cannot ${what}. Ask another Super Admin to make this change.`);
  }
}

/**
 * A role change on a protected account must not be possible from the UI.
 *
 * Two invariants, both enforced by the database and both checked here:
 *   - an existing Super Admin's role is not editable from this screen (the
 *     guard trigger already refuses an API caller, so an attempt here would be
 *     reported as a success by a careless action);
 *   - the last Super Admin can never be removed.
 */
export function assertRoleChangeAllowed(targetRole: string, newRole: string): void {
  if (targetRole === 'super_admin') {
    throw new Error(
      'A Super Admin role cannot be changed from user management. Use the bootstrap or team process instead.',
    );
  }
  if (targetRole === newRole) {
    throw new Error('That is already the account role.');
  }
  if (!isAssignableRole(newRole)) {
    throw new Error('That role cannot be assigned from user management.');
  }
}

/**
 * Reactivation must restore exactly what suspension took away, so it is only
 * meaningful for an inactive account. Running it on an active account used to
 * write a "USER_REACTIVATED" audit row describing a change that did not happen.
 */
export function assertReactivationAllowed(isActive: boolean): void {
  if (isActive) {
    throw new Error('This account is already active. Nothing was changed.');
  }
}

export function assertSuspensionAllowed(isActive: boolean): void {
  if (!isActive) {
    throw new Error('This account is already suspended. Nothing was changed.');
  }
}

/** Access periods are bounded: a typo of `3650` must not grant a decade. */
export const MAX_ACCESS_DAYS = 365;

export function assertAccessDays(days: number | null): void {
  if (days === null) return;
  if (!Number.isInteger(days) || days < 1 || days > MAX_ACCESS_DAYS) {
    throw new Error(`Choose a whole number of days between 1 and ${MAX_ACCESS_DAYS}.`);
  }
}

/**
 * A required, human-readable reason for destructive or privilege-changing
 * actions. Kept short on purpose: it is stored in the audit row's `reason`
 * column, which an auditor reads later without further context.
 */
export const MIN_REASON_LENGTH = 4;

export function assertReason(reason: string | undefined, action: string): string {
  const trimmed = (reason ?? '').trim();
  if (trimmed.length < MIN_REASON_LENGTH) {
    throw new Error(`Record why you are ${action} (at least ${MIN_REASON_LENGTH} characters).`);
  }
  return trimmed.slice(0, 500);
}
