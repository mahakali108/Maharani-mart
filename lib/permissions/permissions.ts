import type { UserRole } from '@/lib/auth/roles';

/**
 * Central permissions engine — the single source of truth for "can
 * this role do this action" checks in Server Components, Server
 * Actions, and route handlers. This is a defense-in-depth layer:
 * Postgres RLS (supabase/migrations/0001_init.sql) is the real
 * enforcement boundary and can never be bypassed by a UI bug, but
 * checking here too lets the UI hide actions a role can't perform
 * and gives a clean, typed place to reason about the permission
 * matrix documented in docs/role_permission_matrix.md.
 */

export type Permission =
  | 'products.view'
  | 'products.create'
  | 'products.edit'
  | 'products.delete'
  | 'master_data.manage'
  | 'pricing.manage'
  | 'inventory.view'
  | 'inventory.manage'
  | 'orders.view.all'
  | 'orders.view.own'
  | 'orders.create'
  | 'orders.approve'
  | 'orders.assign'
  | 'orders.cancel'
  | 'orders.dispatch'
  | 'orders.deliver'
  | 'orders.return.request'
  | 'orders.return.manage'
  | 'returns.request'
  | 'returns.manage'
  | 'inventory.adjust'
  | 'retailers.view'
  | 'retailers.approve'
  | 'retailers.suspend'
  | 'retailers.assign_salesman'
  | 'team.manage'
  | 'reports.view.all'
  | 'reports.view.area'
  | 'reports.view.own'
  | 'banners.manage'
  | 'routes.manage.own'
  | 'routes.manage.all'
  | 'command_center.view';

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  super_admin: [
    'products.view', 'products.create', 'products.edit', 'products.delete', 'master_data.manage',
    'pricing.manage', 'inventory.view', 'inventory.manage', 'inventory.adjust',
    'orders.view.all', 'orders.create', 'orders.approve', 'orders.assign', 'orders.cancel', 'orders.dispatch',
    'orders.deliver', 'orders.return.manage', 'returns.manage',
    'retailers.view', 'retailers.approve', 'retailers.suspend', 'retailers.assign_salesman',
    'team.manage', 'reports.view.all', 'banners.manage', 'routes.manage.all',
    'command_center.view',
  ],
  admin: [
    'products.view', 'products.create', 'products.edit', 'products.delete', 'master_data.manage',
    'pricing.manage', 'inventory.view', 'inventory.manage', 'inventory.adjust',
    'orders.view.all', 'orders.create', 'orders.approve', 'orders.assign', 'orders.cancel', 'orders.dispatch',
    'orders.deliver', 'orders.return.manage', 'returns.manage',
    'retailers.view', 'retailers.approve', 'retailers.suspend', 'retailers.assign_salesman',
    'reports.view.all', 'banners.manage', 'routes.manage.all',
  ],
  staff: [
    'products.view', 'products.create', 'products.edit', 'master_data.manage',
    'inventory.view', 'inventory.manage', 'inventory.adjust',
    'orders.view.all', 'orders.create', 'orders.approve', 'orders.assign', 'orders.cancel', 'orders.dispatch',
    'orders.return.manage', 'returns.manage',
    'retailers.view', 'reports.view.area',
  ],
  salesman: [
    'products.view',
    'orders.view.own', 'orders.create', 'orders.deliver',
    'retailers.view', 'reports.view.own', 'routes.manage.own',
  ],
  retailer: [
    'products.view',
    'orders.view.own', 'orders.create', 'orders.cancel', 'orders.return.request', 'returns.request',
    'reports.view.own',
  ],
};

export function can(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function canAny(role: UserRole, permissions: Permission[]): boolean {
  return permissions.some((p) => can(role, p));
}

export function canAll(role: UserRole, permissions: Permission[]): boolean {
  return permissions.every((p) => can(role, p));
}

/**
 * Throws if the role lacks the permission — use in Server Actions as
 * a guard clause before mutating data, so an unauthorized attempt
 * fails loudly instead of silently no-op'ing.
 */
export function assertPermission(role: UserRole, permission: Permission): void {
  if (!can(role, permission)) {
    throw new Error(`Role "${role}" does not have permission "${permission}".`);
  }
}
