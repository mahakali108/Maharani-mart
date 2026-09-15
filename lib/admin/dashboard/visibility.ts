import type { UserRole } from '@/lib/auth/roles';
import { can } from '@/lib/permissions/permissions';
import type { DashboardSection, DashboardVisibility } from './types';

const SECTION_PERMISSION: Record<DashboardSection, Parameters<typeof can>[1] | null> = {
  sales: 'orders.view.all',
  orders: 'orders.view.all',
  gst: 'orders.view.all',
  topProducts: 'orders.view.all',
  recentOrders: 'orders.view.all',
  retailers: 'retailers.view',
  topRetailers: 'retailers.view',
  catalog: 'products.view',
  inventory: 'inventory.view',
  lowStock: 'inventory.view',
  expiringBatches: 'inventory.view',
  credit: 'retailers.manage_wallet',
  payments: 'retailers.manage_wallet',
  pendingApprovals: 'retailers.approve',
  support: 'support.manage',
  systemAlerts: 'dashboard.view',
  activity: 'dashboard.view',
  commandCenter: 'command_center.view',
};

/**
 * Which dashboard sections a role may see. `/admin` is already restricted to
 * admin/super_admin; this is defense-in-depth so a future staff surface and
 * the Command Center CTA stay honest.
 */
export function dashboardVisibility(role: UserRole): DashboardVisibility {
  const visibility = {} as DashboardVisibility;
  for (const section of Object.keys(SECTION_PERMISSION) as DashboardSection[]) {
    const permission = SECTION_PERMISSION[section];
    visibility[section] = permission ? can(role, permission) : false;
  }
  // Pending-approvals card mixes queues the role can actually act on.
  visibility.pendingApprovals =
    can(role, 'retailers.approve') ||
    can(role, 'orders.return.manage') ||
    can(role, 'collections.verify') ||
    can(role, 'support.manage');
  // Payments card also surfaces the field-collection queue when the role can verify.
  visibility.payments = can(role, 'retailers.manage_wallet') || can(role, 'collections.verify');
  return visibility;
}
