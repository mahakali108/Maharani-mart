/**
 * Types for the Super Admin Master Control Center.
 * Maps to tables: platform_features, user_feature_overrides,
 * user_access_periods, platform_settings, super_admin_audit_logs
 */

// ── Enums ──────────────────────────────────────────────────────────────────

export type AccessStatus = 'active' | 'expiring_soon' | 'expired' | 'suspended' | 'unlimited';
export type FeatureTargetType = 'global' | 'role' | 'user';
export type MaintenanceScope = 'entire_platform' | 'retailer' | 'salesman' | 'admin' | 'staff' | 'warehouse';

// ── Platform Feature ───────────────────────────────────────────────────────

export interface PlatformFeature {
  id: string;
  key: string;
  name: string;
  description: string | null;
  icon: string | null;
  route: string | null;
  is_enabled: boolean;
  is_implemented: boolean;
  target_type: FeatureTargetType;
  target_roles: string[] | null;
  target_user_id: string | null;
  expires_at: string | null;
  sort_order: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

// ── User Feature Override ──────────────────────────────────────────────────

export interface UserFeatureOverride {
  id: string;
  user_id: string;
  feature_key: string;
  is_enabled: boolean;
  expires_at: string | null;
  reason: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

// ── User Access Period ─────────────────────────────────────────────────────

export interface UserAccessPeriod {
  id: string;
  user_id: string;
  role: string;
  status: AccessStatus;
  started_at: string;
  expires_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  reason: string | null;
  created_at: string;
  updated_at: string;
}

// ── Platform Settings ──────────────────────────────────────────────────────

export interface PlatformSetting {
  id: string;
  key: string;
  value: unknown;
  description: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface MaintenanceModeConfig {
  enabled: boolean;
  scope: MaintenanceScope;
  message: string;
  scheduled_start?: string;
  scheduled_end?: string;
}

// ── Super Admin Audit Log ──────────────────────────────────────────────────

export type SuperAdminAction =
  | 'USER_ACCESS_GRANTED'
  | 'USER_ACCESS_EXTENDED'
  | 'USER_ACCESS_EXPIRED'
  | 'USER_SUSPENDED'
  | 'USER_REACTIVATED'
  | 'ROLE_CHANGED'
  | 'PERMISSION_GRANTED'
  | 'PERMISSION_REMOVED'
  | 'FEATURE_ENABLED'
  | 'FEATURE_DISABLED'
  | 'FEATURE_EXPIRED'
  | 'FEATURE_OVERRIDE_CHANGED'
  | 'FEATURE_CREATED'
  | 'FEATURE_REMOVED'
  | 'MAINTENANCE_ENABLED'
  | 'MAINTENANCE_DISABLED'
  | 'SETTING_CHANGED'
  | 'ACCOUNT_DISABLED'
  | 'ACCOUNT_ENABLED';

export interface SuperAdminAuditLog {
  id: string;
  actor_id: string;
  target_id: string | null;
  action: SuperAdminAction;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  reason: string | null;
  ip_address: string | null;
  created_at: string;
  // Joined fields
  actor_name?: string;
  target_name?: string;
}

// ── Dashboard / Overview ───────────────────────────────────────────────────

export interface ControlCenterOverview {
  totalUsers: number;
  activeUsers: number;
  expiredUsers: number;
  suspendedUsers: number;
  expiringToday: number;
  expiringIn3Days: number;
  expiringIn7Days: number;
  totalFeatures: number;
  enabledFeatures: number;
  disabledFeatures: number;
  featuresExpiringSoon: number;
  recentAuditLogs: SuperAdminAuditLog[];
  securityAlerts: SecurityAlert[];
}

export interface SecurityAlert {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  timestamp: string;
}

// ── User Management View ───────────────────────────────────────────────────

export interface UserManagementView {
  id: string;
  email: string | null;
  fullName: string;
  phone: string;
  role: string;
  isActive: boolean;
  accessStatus: AccessStatus;
  accessExpiresAt: string | null;
  accessStartedAt: string | null;
  enabledFeatures: string[];
  disabledFeatures: string[];
  recentActivity: SuperAdminAuditLog[];
  createdAt: string;
}

// ── Access Period Presets ───────────────────────────────────────────────────

export const ACCESS_PRESETS = [
  { label: '1 Day', days: 1 },
  { label: '3 Days', days: 3 },
  { label: '7 Days', days: 7 },
  { label: '15 Days', days: 15 },
  { label: '30 Days', days: 30 },
  { label: 'Unlimited', days: null },
] as const;

export function computeAccessStatus(expiresAt: string | null): AccessStatus {
  if (!expiresAt) return 'unlimited';
  const now = new Date();
  const expires = new Date(expiresAt);
  if (expires <= now) return 'expired';
  const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
  if (expires.getTime() - now.getTime() <= threeDaysMs) return 'expiring_soon';
  return 'active';
}

export function statusBadgeColor(status: AccessStatus): string {
  switch (status) {
    case 'active': return 'bg-emerald-100 text-emerald-800';
    case 'expiring_soon': return 'bg-amber-100 text-amber-800';
    case 'expired': return 'bg-red-100 text-red-800';
    case 'suspended': return 'bg-gray-100 text-gray-800';
    case 'unlimited': return 'bg-blue-100 text-blue-800';
  }
}
