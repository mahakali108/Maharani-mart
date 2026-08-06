/**
 * Central definition of user roles and where each role is routed.
 * This is the single source of truth for role-based routing — both
 * middleware.ts and any server component that needs to redirect a
 * user should import from here rather than hardcoding strings.
 */

export type UserRole = 'super_admin' | 'admin' | 'staff' | 'salesman' | 'retailer';

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
