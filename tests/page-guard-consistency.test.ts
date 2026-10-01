/**
 * PAGE-GUARD CONSISTENCY (regression for the production stability audit).
 *
 * Middleware admits whole role groups per URL prefix (lib/auth/roles.ts):
 *   /admin    → admin, super_admin
 *   /staff    → staff, admin, super_admin
 *   /salesman → salesman, admin, super_admin
 *   /retailer → retailer
 *
 * A page may therefore be REACHED by a role that doesn't hold the page's
 * permission (e.g. a plain admin opening the super-admin-only team editor).
 * The audit found seven reproducible combos where the page then THREW from
 * `requirePermission` / `requireSuperAdmin`, rendering the generic
 * "Something went wrong" crash boundary instead of a clean denial:
 *
 *   admin       → /admin/command-center            (command_center.view)
 *   admin       → /admin/control-center            (super-admin only)
 *   admin       → /admin/control-center/users/[id] (super-admin only)
 *   admin       → /admin/team/[id]                 (team.manage)
 *   admin       → /admin/team/new                  (team.manage)
 *   admin       → /salesman/ai                     (reports.view.own)
 *   super_admin → /salesman/ai                     (reports.view.own)
 *
 * Fix: pages use the redirecting variants (`requirePagePermission`,
 * `requireSuperAdminPage`) which send a denied-but-authenticated user to
 * /unauthorized — the same destination middleware uses. Server Actions keep
 * the throwing variants so callers get readable error messages.
 *
 * This test statically enforces the rule for EVERY page: a page.tsx may only
 * call the throwing `requirePermission(p)` when every middleware-admitted
 * role for its URL prefix actually holds `p` (i.e. the throw is unreachable
 * through navigation). Otherwise it must use the redirecting page variant.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ROOT = process.cwd();
const read = (f: string) => readFileSync(path.join(ROOT, f), 'utf8');

// ---------------------------------------------------------------------------
// Static rule
// ---------------------------------------------------------------------------

function rolePermissions(): Record<string, string[]> {
  const src = read('lib/permissions/permissions.ts');
  const start = src.indexOf('const ROLE_PERMISSIONS');
  const block = src.slice(start, src.indexOf('};', start));
  const roles: Record<string, string[]> = {};
  for (const m of block.matchAll(/(super_admin|admin|staff|salesman|retailer):\s*\[([\s\S]*?)\]/g)) {
    roles[m[1] as string] = [...(m[2] as string).matchAll(/'([^']+)'/g)].map((x) => x[1] as string);
  }
  return roles;
}

const MIDDLEWARE_ADMITS: Record<string, string[]> = {
  '/admin': ['super_admin', 'admin'],
  '/staff': ['staff', 'admin', 'super_admin'],
  '/salesman': ['salesman', 'admin', 'super_admin'],
  '/retailer': ['retailer'],
};

describe('page guards never throw for a role middleware admits', () => {
  const roles = rolePermissions();

  it('parses the permission matrix (sanity)', () => {
    expect(Object.keys(roles).sort()).toEqual(['admin', 'retailer', 'salesman', 'staff', 'super_admin']);
    expect(roles.super_admin).toContain('team.manage');
    expect(roles.admin).not.toContain('team.manage');
  });

  it('every page uses a reachable-safe guard', () => {
    const files = execSync(
      `grep -rlE "requirePermission\\(|requireSuperAdmin\\(" app --include=page.tsx || true`,
      { cwd: ROOT, encoding: 'utf8' }
    )
      .trim()
      .split('\n')
      .filter(Boolean);

    const offenders: string[] = [];
    for (const file of files) {
      const src = read(file);
      const route = file.replace(/^app/, '').replace(/\/page\.tsx$/, '') || '/';
      const prefix = Object.keys(MIDDLEWARE_ADMITS).find((p) => route.startsWith(p));
      if (!prefix) continue;
      const admitted = MIDDLEWARE_ADMITS[prefix]!;

      // Throwing super-admin guard on a page any admin can navigate to:
      if (/\brequireSuperAdmin\(\)/.test(src) && admitted.some((r) => r !== 'super_admin')) {
        offenders.push(`${route} :: requireSuperAdmin() throws for ${admitted.filter((r) => r !== 'super_admin').join(', ')}`);
      }
      // Throwing permission guard with a permission some admitted role lacks:
      for (const m of src.matchAll(/\brequirePermission\('([^']+)'\)/g)) {
        const perm = m[1] as string;
        const lacking = admitted.filter((r) => !roles[r]!.includes(perm));
        if (lacking.length > 0) {
          offenders.push(`${route} :: requirePermission('${perm}') throws for ${lacking.join(', ')} — use requirePagePermission`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the seven audited combos use the redirecting page guards', () => {
    expect(read('app/admin/command-center/page.tsx')).toContain("requirePagePermission('command_center.view')");
    expect(read('app/admin/team/new/page.tsx')).toContain("requirePagePermission('team.manage')");
    expect(read('app/admin/team/[id]/page.tsx')).toContain("requirePagePermission('team.manage')");
    expect(read('app/salesman/ai/page.tsx')).toContain("requirePagePermission('reports.view.own')");
    expect(read('app/admin/control-center/page.tsx')).toContain('requireSuperAdminPage()');
    expect(read('app/admin/control-center/users/[id]/page.tsx')).toContain('requireSuperAdminPage()');
  });
});

// ---------------------------------------------------------------------------
// Behavioral rule: the page variants redirect, the action variants throw
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  redirect: vi.fn(),
  getUser: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect, notFound: vi.fn() }));

import { requirePermission, requirePagePermission } from '@/lib/admin/guard';
import { requireSuperAdmin, requireSuperAdminPage } from '@/lib/admin/control-center/guard';

const UID = '00000000-0000-4000-8000-0000000000aa';

function mockSession(role: string) {
  mocks.getUser.mockResolvedValue({ data: { user: { id: UID, email: 'a@test.local' } } });
  mocks.createClient.mockReturnValue({
    auth: { getUser: mocks.getUser },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: { role, full_name: 'T', is_active: true } }),
          maybeSingle: () => Promise.resolve({ data: null }),
        }),
      }),
    }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.redirect.mockImplementation((to: string) => {
    throw new Error(`redirect:${to}`);
  });
});

describe('guard behavior: page variants redirect, action variants throw', () => {
  it('requirePagePermission redirects a denied admin to /unauthorized', async () => {
    mockSession('admin');
    await expect(requirePagePermission('team.manage')).rejects.toThrow('redirect:/unauthorized');
  });

  it('requirePagePermission passes a permitted role through', async () => {
    mockSession('super_admin');
    await expect(requirePagePermission('team.manage')).resolves.toMatchObject({ id: UID, role: 'super_admin' });
  });

  it('requirePermission still throws a readable error for Server Actions', async () => {
    mockSession('admin');
    await expect(requirePermission('team.manage')).rejects.toThrow(/don't have permission/);
  });

  it('requireSuperAdminPage redirects a plain admin to /unauthorized', async () => {
    mockSession('admin');
    await expect(requireSuperAdminPage()).rejects.toThrow('redirect:/unauthorized');
  });

  it('requireSuperAdminPage passes a super admin through', async () => {
    mockSession('super_admin');
    await expect(requireSuperAdminPage()).resolves.toMatchObject({ role: 'super_admin' });
  });

  it('requireSuperAdmin still throws for Server Actions', async () => {
    mockSession('admin');
    await expect(requireSuperAdmin()).rejects.toThrow('Super Admin authorization required');
  });
});
