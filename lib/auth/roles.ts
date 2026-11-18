/**
 * Central definition of user roles and where each role is routed.
 * This is the single source of truth for role-based routing — both
 * middleware.ts and any server component that needs to redirect a
 * user should import from here rather than hardcoding strings.
 *
 * PLATFORM MODEL (permanent): Maharani Traders is a centrally-run wholesale
 * business. The only customer-facing role is `retailer`; the platform is run
 * by `super_admin`/`admin`. The supporting operational roles `staff` and
 * `salesman` are untouched internal functions and are NOT marketplace roles.
 *
 * `seller` was RETIRED. It is deliberately absent from `UserRole` below, so no
 * code can route a user to a seller workspace. The role value still exists in
 * the PostgreSQL enum (`user_role`, added by migration 0062 and not removable
 * without rewriting applied DDL) and may still be present on historical
 * `profiles` rows, so every entry point must REFUSE it explicitly — see
 * `isRetiredRole()`. A refusal is intentionally different from "unknown role":
 * a retired seller must be signed out, not quietly redirected to a page that
 * would 404-loop.
 */

export type UserRole = 'super_admin' | 'admin' | 'staff' | 'salesman' | 'retailer';

/**
 * Role values that still exist in the database enum but are no longer part of
 * the platform. Kept as a separate, explicit list so a future reader cannot
 * mistake them for a typo or a live role.
 *
 *  - `seller`    — retired by the seller/supplier removal (see docs/repair).
 *
 * `supplier` was never a `profiles.role` value: supplier applications were
 * anonymous submissions into their own tables and never created an account, so
 * there is no supplier role to refuse here.
 */
export const RETIRED_ROLES = ['seller'] as const;
export type RetiredRole = (typeof RETIRED_ROLES)[number];

/** True when a database `profiles.role` is a retired, no-longer-supported value. */
export function isRetiredRole(role: string | null | undefined): role is RetiredRole {
  return typeof role === 'string' && (RETIRED_ROLES as readonly string[]).includes(role);
}

/** True when the value is one of the live platform roles. */
export function isSupportedRole(role: string | null | undefined): role is UserRole {
  return (
    role === 'super_admin' ||
    role === 'admin' ||
    role === 'staff' ||
    role === 'salesman' ||
    role === 'retailer'
  );
}

export const ROLE_HOME: Record<UserRole, string> = {
  super_admin: '/admin/dashboard',
  admin: '/admin/dashboard',
  staff: '/staff/dashboard',
  salesman: '/salesman/dashboard',
  retailer: '/retailer/home',
};

/**
 * Maps a URL path prefix to the roles allowed to access it.
 * Order matters: first matching prefix wins.
 */
export const ROLE_ROUTE_PREFIXES: { prefix: string; roles: UserRole[] }[] = [
  { prefix: '/admin', roles: ['super_admin', 'admin'] },
  { prefix: '/staff', roles: ['staff', 'admin', 'super_admin'] },
  { prefix: '/salesman', roles: ['salesman', 'admin', 'super_admin'] },
  { prefix: '/retailer', roles: ['retailer'] },
];

/**
 * Path prefixes that only ever belonged to the retired seller workspace.
 * They must never resolve to a live page. Kept explicit so tests can assert
 * that no `/seller/*` route exists and that a visit cannot render a workspace.
 */
export const RETIRED_ROUTE_PREFIXES = [
  // The seller workspace and both discontinued registration funnels.
  '/seller',
  '/register-seller',
  '/register-supplier',
  // Marketplace administration that no longer has a page. These are listed so a
  // stale bookmark, an old email link or a remembered URL answers with a clean
  // "not available" instead of a stack trace, and so a test can assert that the
  // routes stay gone.
  '/admin/sellers',
  '/admin/suppliers',
  '/admin/offers',
  '/admin/marketplace-launch',
  '/admin/banners/campaigns',
  '/admin/ad-campaigns',
] as const;

export function isRetiredPath(pathname: string): boolean {
  return RETIRED_ROUTE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix + '/'));
}

export function isRoleAllowedForPath(role: UserRole, pathname: string): boolean {
  const match = ROLE_ROUTE_PREFIXES.find((r) => pathname.startsWith(r.prefix));
  if (!match) return true; // path isn't role-restricted
  return match.roles.includes(role);
}

export function homeForRole(role: UserRole): string {
  return ROLE_HOME[role] ?? '/login';
}

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  staff: 'Staff',
  salesman: 'Salesman',
  retailer: 'Retailer',
};
