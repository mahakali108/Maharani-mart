import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ASSIGNABLE_ROLES,
  MAX_ACCESS_DAYS,
  MIN_REASON_LENGTH,
  assertAccessDays,
  assertNotSelf,
  assertReactivationAllowed,
  assertReason,
  assertRoleChangeAllowed,
  assertSuspensionAllowed,
  isAssignableRole,
} from '@/lib/admin/control-center/user-admin-rules';

const read = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8');

/**
 * Super Admin user-management authorization rules.
 *
 * These are the checks that stood between the UI and the database. Two bugs
 * motivated extracting them:
 *
 *   1. `changeUserRole` offered `super_admin` in a dropdown and forwarded it to
 *      an UPDATE — a role escalation path with no separate confirmation.
 *   2. the action ignored the UPDATE's `error`, then wrote a ROLE_CHANGED audit
 *      row. A refused promotion was recorded as a successful one.
 */
describe('user management authorization rules', () => {
  describe('assignable roles', () => {
    it('never lets the generic role editor mint a Super Admin', () => {
      expect(ASSIGNABLE_ROLES).not.toContain('super_admin');
      expect(isAssignableRole('super_admin')).toBe(false);
    });

    it('allows the ordinary operational roles', () => {
      for (const role of ['admin', 'staff', 'salesman', 'retailer', 'seller']) {
        expect(isAssignableRole(role), role).toBe(true);
      }
    });

    it('rejects anything that is not a known role string', () => {
      for (const value of ['', 'root', 'SUPER_ADMIN', null, undefined, 42, {}]) {
        expect(isAssignableRole(value)).toBe(false);
      }
    });
  });

  describe('self-service', () => {
    it('refuses every privileged change to your own account', () => {
      const me = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      expect(() => assertNotSelf(me, me, 'role')).toThrow(/cannot change your own role/i);
      expect(() => assertNotSelf(me, me, 'suspend')).toThrow(/cannot suspend your own account/i);
      expect(() => assertNotSelf(me, me, 'access')).toThrow(/cannot change your own access period/i);
    });

    it('allows acting on a different account', () => {
      expect(() =>
        assertNotSelf('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'role'),
      ).not.toThrow();
    });
  });

  describe('role changes', () => {
    it('refuses to edit an existing Super Admin', () => {
      expect(() => assertRoleChangeAllowed('super_admin', 'admin')).toThrow(/cannot be changed/i);
    });

    it('refuses a no-op and an unassignable target', () => {
      expect(() => assertRoleChangeAllowed('retailer', 'retailer')).toThrow(/already the account role/i);
      expect(() => assertRoleChangeAllowed('staff', 'super_admin')).toThrow(/cannot be assigned/i);
    });

    it('allows a normal demotion or promotion between operational roles', () => {
      expect(() => assertRoleChangeAllowed('retailer', 'staff')).not.toThrow();
      expect(() => assertRoleChangeAllowed('admin', 'staff')).not.toThrow();
    });
  });

  describe('account status', () => {
    it('will not "reactivate" an account that is already active', () => {
      expect(() => assertReactivationAllowed(true)).toThrow(/already active/i);
      expect(() => assertReactivationAllowed(false)).not.toThrow();
    });

    it('will not "suspend" an account that is already suspended', () => {
      expect(() => assertSuspensionAllowed(false)).toThrow(/already suspended/i);
      expect(() => assertSuspensionAllowed(true)).not.toThrow();
    });
  });

  describe('access periods', () => {
    it('bounds the number of days so a typo cannot grant a decade', () => {
      expect(() => assertAccessDays(7)).not.toThrow();
      expect(() => assertAccessDays(null)).not.toThrow();
      expect(() => assertAccessDays(MAX_ACCESS_DAYS)).not.toThrow();
      expect(() => assertAccessDays(MAX_ACCESS_DAYS + 1)).toThrow(/between 1 and/i);
      expect(() => assertAccessDays(3650)).toThrow(/between 1 and/i);
      expect(() => assertAccessDays(0)).toThrow(/between 1 and/i);
      expect(() => assertAccessDays(-3)).toThrow(/between 1 and/i);
      expect(() => assertAccessDays(1.5)).toThrow(/whole number/i);
    });
  });

  describe('audit reasons', () => {
    it('requires a usable reason for a privileged change', () => {
      expect(() => assertReason(undefined, 'suspending this account')).toThrow(/Record why/i);
      expect(() => assertReason('  ', 'suspending this account')).toThrow(/Record why/i);
      expect(() => assertReason('ab', 'suspending this account')).toThrow(/Record why/i);
      expect(assertReason('Customer complaint about stock', 'suspending this account')).toBe(
        'Customer complaint about stock',
      );
    });

    it('keeps a runaway reason inside the audit column', () => {
      const long = 'x'.repeat(2000);
      expect(assertReason(long, 'suspending this account').length).toBe(500);
      expect(MIN_REASON_LENGTH).toBeGreaterThan(1);
    });
  });
});

describe('the actions actually use the rules', () => {
  const actions = read('lib/admin/control-center/actions.ts');

  const bodyOf = (name: string): string => {
    const start = actions.indexOf(`export async function ${name}`);
    expect(start, `${name} must exist`).toBeGreaterThan(-1);
    const end = actions.indexOf('\nexport async function', start + 10);
    return end === -1 ? actions.slice(start) : actions.slice(start, end);
  };

  it('guards every actor-mutating action with the self check', () => {
    for (const name of ['changeUserRole', 'suspendUser', 'reactivateUser', 'grantAccess', 'extendAccess']) {
      expect(bodyOf(name), name).toMatch(/assertNotSelf\(/);
    }
  });

  it('never forwards a caller-supplied super_admin role', () => {
    expect(bodyOf('changeUserRole')).toMatch(/isAssignableRole\(newRole\)/);
    expect(bodyOf('changeUserRole')).toMatch(/assertRoleChangeAllowed\(/);
    // The empty "already super_admin — this is the only caller" block is gone.
    expect(bodyOf('changeUserRole')).not.toMatch(/newRole === 'super_admin'\s*\{\s*\}/);
  });

  it('checks the write result before recording it as a success', () => {
    // `assertWrite(...)` must appear after every profile UPDATE in these actions.
    for (const name of ['changeUserRole', 'suspendUser', 'reactivateUser']) {
      const body = bodyOf(name);
      expect(body, name).toMatch(/const \{ error: profileError \} = await supabase|const \{ error: roleError \} = await supabase/);
      expect(body, name).toMatch(/assertWrite\(/);
      const writeIndex = body.indexOf('assertWrite(');
      const auditIndex = body.indexOf('await logSuperAdminAction(');
      expect(writeIndex, `${name} must check the write before auditing`).toBeLessThan(auditIndex);
    }
  });

  it('requires a reason on the actions an auditor will ask about', () => {
    for (const name of ['changeUserRole', 'suspendUser', 'reactivateUser']) {
      expect(bodyOf(name), name).toMatch(/assertReason\(/);
    }
  });

  it('bounds access days before writing', () => {
    expect(bodyOf('grantAccess')).toMatch(/assertAccessDays\(input\.days\)/);
    expect(bodyOf('extendAccess')).toMatch(/assertAccessDays\(days\)/);
  });

  it('fails the grant when the previous period cannot be closed', () => {
    // Two simultaneously "active" access rows make the effective state
    // ambiguous, so this one is fatal rather than logged.
    expect(bodyOf('grantAccess')).toMatch(/assertWrite\(expireError/);
  });
});

describe('the user-management screen cannot offer Super Admin', () => {
  const client = read('app/admin/control-center/users/[id]/client.tsx');

  it('has no super_admin option in the role dropdown', () => {
    expect(client).not.toMatch(/<option value="super_admin"/);
  });

  it('has no super-admin grant confirmation flow', () => {
    expect(client).not.toContain("changeUserRole(userView.id, 'super_admin'");
    expect(client).not.toContain("confirmAction === 'role_super_admin'");
  });

  it('surfaces the refusal instead of swallowing it', () => {
    // Every action goes through run(); a bare `await action()` would drop the
    // thrown message and leave a button that looks broken.
    expect(client).toMatch(/const run = /);
    expect(client).toMatch(/setError\(message\)/);
    expect(client).toMatch(/role="alert"/);
    expect(client).not.toMatch(/startTransition\(async \(\) => \{\s*await (suspendUser|reactivateUser|changeUserRole|extendAccess|expireAccess)\(/);
  });
});
