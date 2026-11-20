import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  RETIRED_ROLES,
  RETIRED_ROUTE_PREFIXES,
  ROLE_HOME,
  ROLE_LABELS,
  ROLE_ROUTE_PREFIXES,
  homeForRole,
  isRetiredPath,
  isRetiredRole,
  isRoleAllowedForPath,
  isSupportedRole,
  type UserRole,
} from '@/lib/auth/roles';

/**
 * The seller/supplier removal has to be enforced in CODE, not by hiding links.
 * This suite pins the three code-level chokepoints that make a surviving
 * seller session harmless:
 *
 *   1. `seller` is not a routable role any more, and every branch that reads a
 *      role must recognise it as RETIRED rather than falling through to a
 *      default destination.
 *   2. The retired URLs neither exist on disk nor resolve to a live page.
 *   3. No shell or navigation advertises a removed destination.
 */
const LIVE_ROLES: UserRole[] = ['super_admin', 'admin', 'staff', 'salesman', 'retailer'];

describe('retired seller role is refused in code', () => {
  it('is not part of the live role union and has no home route', () => {
    expect(LIVE_ROLES).toHaveLength(5);
    for (const role of LIVE_ROLES) {
      expect(isSupportedRole(role), role).toBe(true);
      expect(ROLE_LABELS[role], role).toBeTruthy();
      expect(homeForRole(role), role).toMatch(/^\/(admin|staff|salesman|retailer)\//);
    }
    // `seller` is a string in the enum but never a routable role.
    expect(isSupportedRole('seller')).toBe(false);
    expect(isRetiredRole('seller')).toBe(true);
    expect(RETIRED_ROLES).toContain('seller');
    // A retired role has no entry in ROLE_HOME, so no code path can send it anywhere.
    expect(Object.keys(ROLE_HOME).sort()).toEqual([...LIVE_ROLES].sort());
    expect(ROLE_HOME).not.toHaveProperty('seller');
  });

  it('is never granted a route prefix', () => {
    for (const { prefix, roles } of ROLE_ROUTE_PREFIXES) {
      expect(roles as string[], prefix).not.toContain('seller');
    }
    // A seller cannot reach any role-restricted area.
    for (const { prefix } of ROLE_ROUTE_PREFIXES) {
      expect(isRoleAllowedForPath('seller' as UserRole, prefix), prefix).toBe(false);
    }
  });

  it('distinguishes a retired role from an unknown role', () => {
    // The distinction matters: a retired seller must be signed out, not
    // redirected to a default page that would 404-loop.
    expect(isRetiredRole('seller')).toBe(true);
    expect(isRetiredRole('supplier')).toBe(false); // never a profile role at all
    expect(isRetiredRole('nonsense')).toBe(false);
    expect(isRetiredRole(null)).toBe(false);
    expect(isRetiredRole(undefined)).toBe(false);
    expect(isSupportedRole('nonsense')).toBe(false);
  });
});

describe('retired routes cannot resolve', () => {
  const REMOVED = [
    'app/seller',
    'app/register-seller',
    'app/register-supplier',
    'app/admin/sellers',
    'app/admin/suppliers',
    'app/admin/offers',
    'app/admin/marketplace-launch',
    'app/admin/banners/campaigns',
  ];

  it('has no page or layout on disk for any retired prefix', () => {
    for (const path of REMOVED) {
      expect(existsSync(path), path).toBe(false);
    }
  });

  it('classifies every retired prefix, including the marketplace admin pages', () => {
    for (const path of REMOVED) {
      const url = '/' + path.replace(/^app\//, '');
      expect(isRetiredPath(url), url).toBe(true);
      expect(isRetiredPath(url + '/child'), url + '/child').toBe(true);
    }
    // Nested admin paths that still exist must NOT be caught by a broad prefix.
    for (const live of ['/admin/dashboard', '/admin/orders', '/admin/inventory/grn', '/admin/pricing/wholesale', '/retailer/home']) {
      expect(isRetiredPath(live), live).toBe(false);
    }
    // `/seller` must not swallow an unrelated path that merely starts with it.
    expect(isRetiredPath('/sellers-guide')).toBe(false);
    expect(RETIRED_ROUTE_PREFIXES).toContain('/seller');
  });

  it('sends no shell navigation to a removed destination', () => {
    const shells = [
      'components/layout/admin-shell.tsx',
      'components/layout/retailer-shell.tsx',
      'components/layout/staff-shell.tsx',
      'components/layout/salesman-shell.tsx',
    ];
    for (const file of shells) {
      const source = readFileSync(file, 'utf8');
      for (const href of ['/admin/sellers', '/admin/suppliers', '/admin/offers', '/admin/marketplace-launch', '/seller/']) {
        expect(source, `${file} → ${href}`).not.toContain(`href: '${href}`);
      }
    }
  });

  it('is refused before any role check, so a live session cannot render a retired page', () => {
    // middleware must consult isRetiredPath FIRST: if the role check ran first, an
    // admin would be allowed through to /admin/offers and hit a 500 instead of a
    // clean 404.
    const middleware = readFileSync('middleware.ts', 'utf8');
    const retiredAt = middleware.indexOf('isRetiredPath(pathname)');
    const protectedAt = middleware.indexOf('isProtectedPath(pathname)');
    expect(retiredAt).toBeGreaterThan(-1);
    expect(protectedAt).toBeGreaterThan(-1);
    expect(retiredAt).toBeLessThan(protectedAt);
  });
});

describe('retired role is refused in the session helpers', () => {
  it('requireUser refuses a retired role rather than returning it', () => {
    const source = readFileSync('lib/auth/session.ts', 'utf8');
    expect(source).toContain('isRetiredRole');
    expect(source).toMatch(/isRetiredRole\([^)]*\)/);
  });

  it('the sign-in gate refuses a retired role', () => {
    const source = readFileSync('lib/auth/sign-in-gate.ts', 'utf8');
    expect(source).toContain('role_retired');
    expect(source).toContain('isRetiredRole');
  });

  it('the database refuses a retired role too — enforcement is not only in the UI', () => {
    // Migration 0110 replaces handle_new_user(), so the code refusal is backed by
    // a database refusal.
    const migration = readFileSync('supabase/migrations/0110_retire_seller_supplier_marketplace.sql', 'utf8');
    expect(migration).toContain('create or replace function public.handle_new_user()');
    expect(migration).toContain("if v_staff_role = 'seller' then");
  });

  it('our legal copy makes no unverified seller-of-record claim', () => {
    // The correction sweep removed every "Maharani Traders is the seller of
    // record" style assertion; see tests/business-identity-claims.test.ts for the
    // full guard.
    const seed = readFileSync('content/site-pages.seed.json', 'utf8');
    expect(seed).not.toMatch(/\bis the seller of record\b/i);
    expect(seed).not.toMatch(/\bwe are the seller of record\b/i);
  });
});
