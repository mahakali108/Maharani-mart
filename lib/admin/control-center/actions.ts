'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireSuperAdmin } from '@/lib/admin/control-center/guard';
import type {
  PlatformFeature,
  UserAccessPeriod,
  UserFeatureOverride,
  SuperAdminAuditLog,
  SuperAdminAction,
  ControlCenterOverview,
  UserManagementView,
  AccessStatus,
  MaintenanceModeConfig,
  SecurityAlert,
} from '@/lib/admin/control-center/types';
import { computeAccessStatus } from '@/lib/admin/control-center/types';
import type { UserRole } from '@/lib/auth/roles';

// ── Audit Helper ───────────────────────────────────────────────────────────

async function logSuperAdminAction(
  actorId: string,
  targetId: string | null,
  action: SuperAdminAction,
  beforeData: Record<string, unknown> | null = null,
  afterData: Record<string, unknown> | null = null,
  reason: string | null = null,
) {
  const supabase = createClient();
  await supabase.from('super_admin_audit_logs').insert({
    actor_id: actorId,
    target_id: targetId,
    action,
    before_data: beforeData,
    after_data: afterData,
    reason,
  } as never);
}

// ── FEATURE MANAGEMENT ─────────────────────────────────────────────────────

export async function getFeatures(): Promise<PlatformFeature[]> {
  await requireSuperAdmin();
  const supabase = createClient();
  const { data, error } = await supabase
    .from('platform_features')
    .select('*')
    .order('sort_order', { ascending: true });
  if (error) throw new Error(`Failed to fetch features: ${error.message}`);
  return (data ?? []) as unknown as PlatformFeature[];
}

export async function toggleFeature(featureId: string, enabled: boolean): Promise<void> {
  const user = await requireSuperAdmin();
  const supabase = createClient();

  const { data: feature } = await supabase
    .from('platform_features')
    .select('*')
    .eq('id', featureId)
    .single();
  if (!feature) throw new Error('Feature not found.');

  const before = { is_enabled: (feature as unknown as PlatformFeature).is_enabled };
  await supabase
    .from('platform_features')
    .update({ is_enabled: enabled, updated_by: user.id, updated_at: new Date().toISOString() } as never)
    .eq('id', featureId);

  await logSuperAdminAction(
    user.id,
    null,
    enabled ? 'FEATURE_ENABLED' : 'FEATURE_DISABLED',
    before,
    { is_enabled: enabled },
    `Feature "${(feature as unknown as PlatformFeature).name}" ${enabled ? 'enabled' : 'disabled'}`,
  );

  revalidatePath('/admin/control-center');
}

export async function updateFeature(
  featureId: string,
  updates: Partial<Pick<PlatformFeature, 'name' | 'description' | 'icon' | 'route' | 'is_implemented' | 'target_type' | 'target_roles' | 'target_user_id' | 'expires_at' | 'sort_order'>>,
): Promise<void> {
  const user = await requireSuperAdmin();
  const supabase = createClient();

  const { data: before } = await supabase
    .from('platform_features')
    .select('*')
    .eq('id', featureId)
    .single();
  if (!before) throw new Error('Feature not found.');

  await supabase
    .from('platform_features')
    .update({ ...updates, updated_by: user.id, updated_at: new Date().toISOString() } as never)
    .eq('id', featureId);

  await logSuperAdminAction(user.id, null, 'FEATURE_ENABLED', before as never, { ...updates } as never);

  revalidatePath('/admin/control-center');
}

export async function createFeature(input: {
  key: string;
  name: string;
  description?: string;
  icon?: string;
  route?: string;
  is_implemented?: boolean;
}): Promise<void> {
  const user = await requireSuperAdmin();
  const supabase = createClient();

  const { error } = await supabase.from('platform_features').insert({
    key: input.key,
    name: input.name,
    description: input.description ?? null,
    icon: input.icon ?? null,
    route: input.route ?? null,
    is_implemented: input.is_implemented ?? false,
    is_enabled: true,
    target_type: 'global',
    created_by: user.id,
    updated_by: user.id,
  } as never);

  if (error) throw new Error(`Failed to create feature: ${error.message}`);

  await logSuperAdminAction(user.id, null, 'FEATURE_CREATED', null, { key: input.key, name: input.name });

  revalidatePath('/admin/control-center');
}

export async function removeFeature(featureId: string): Promise<void> {
  const user = await requireSuperAdmin();
  const supabase = createClient();

  const { data: feature } = await supabase
    .from('platform_features')
    .select('*')
    .eq('id', featureId)
    .single();
  if (!feature) throw new Error('Feature not found.');

  await supabase.from('platform_features').delete().eq('id', featureId);

  await logSuperAdminAction(user.id, null, 'FEATURE_REMOVED', feature as never, null);

  revalidatePath('/admin/control-center');
}

// ── USER ACCESS MANAGEMENT ─────────────────────────────────────────────────

export async function getUserAccessPeriods(userId: string): Promise<UserAccessPeriod[]> {
  await requireSuperAdmin();
  const supabase = createClient();
  const { data, error } = await supabase
    .from('user_access_periods')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Failed to fetch access periods: ${error.message}`);
  return (data ?? []) as unknown as UserAccessPeriod[];
}

export async function grantAccess(input: {
  userId: string;
  days: number | null; // null = unlimited
  reason?: string;
}): Promise<void> {
  const user = await requireSuperAdmin();
  const supabase = createClient();

  // Fetch target user's role
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', input.userId)
    .single();
  if (!profile) throw new Error('User not found.');

  const role = (profile as unknown as { role: string }).role;
  if (role === 'super_admin') throw new Error('Cannot modify Super Admin access — it is always unlimited.');

  const now = new Date();
  const expiresAt = input.days
    ? new Date(now.getTime() + input.days * 24 * 60 * 60 * 1000).toISOString()
    : null;
  const status: AccessStatus = input.days === null ? 'unlimited' : 'active';

  // Expire any existing active periods
  await supabase
    .from('user_access_periods')
    .update({ status: 'expired', updated_by: user.id, updated_at: now.toISOString() } as never)
    .eq('user_id', input.userId)
    .in('status', ['active', 'expiring_soon']);

  // Create new period
  const { error } = await supabase.from('user_access_periods').insert({
    user_id: input.userId,
    role,
    status,
    started_at: now.toISOString(),
    expires_at: expiresAt,
    created_by: user.id,
    updated_by: user.id,
    reason: input.reason ?? null,
  } as never);

  if (error) throw new Error(`Failed to grant access: ${error.message}`);

  await logSuperAdminAction(
    user.id,
    input.userId,
    'USER_ACCESS_GRANTED',
    null,
    { status, expires_at: expiresAt, days: input.days },
    input.reason,
  );

  revalidatePath('/admin/control-center');
  revalidatePath(`/admin/control-center/users/${input.userId}`);
}

export async function extendAccess(userId: string, days: number, reason?: string): Promise<void> {
  const user = await requireSuperAdmin();
  const supabase = createClient();

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single();
  if (!profile) throw new Error('User not found.');
  if ((profile as unknown as { role: string }).role === 'super_admin') {
    throw new Error('Super Admin access is always unlimited.');
  }

  // Get current active period
  const { data: current } = await supabase
    .from('user_access_periods')
    .select('*')
    .eq('user_id', userId)
    .in('status', ['active', 'expiring_soon', 'expired'])
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  const currentPeriod = current as unknown as UserAccessPeriod | null;
  const now = new Date();
  const baseDate = currentPeriod?.expires_at && new Date(currentPeriod.expires_at) > now
    ? new Date(currentPeriod.expires_at)
    : now;
  const newExpiry = new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000).toISOString();

  if (currentPeriod) {
    await supabase
      .from('user_access_periods')
      .update({
        expires_at: newExpiry,
        status: 'active',
        updated_by: user.id,
        updated_at: now.toISOString(),
      } as never)
      .eq('id', currentPeriod.id);
  } else {
    await supabase.from('user_access_periods').insert({
      user_id: userId,
      role: (profile as unknown as { role: string }).role,
      status: 'active',
      started_at: now.toISOString(),
      expires_at: newExpiry,
      created_by: user.id,
      updated_by: user.id,
      reason: reason ?? null,
    } as never);
  }

  await logSuperAdminAction(
    user.id,
    userId,
    'USER_ACCESS_EXTENDED',
    currentPeriod ? { expires_at: currentPeriod.expires_at } : null,
    { expires_at: newExpiry, extended_days: days },
    reason,
  );

  revalidatePath('/admin/control-center');
  revalidatePath(`/admin/control-center/users/${userId}`);
}

export async function expireAccess(userId: string, reason?: string): Promise<void> {
  const user = await requireSuperAdmin();
  const supabase = createClient();

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single();
  if (!profile) throw new Error('User not found.');
  if ((profile as unknown as { role: string }).role === 'super_admin') {
    throw new Error('Cannot expire Super Admin access.');
  }

  const now = new Date();
  const { data: current } = await supabase
    .from('user_access_periods')
    .select('*')
    .eq('user_id', userId)
    .in('status', ['active', 'expiring_soon'])
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (current) {
    await supabase
      .from('user_access_periods')
      .update({
        status: 'expired',
        expires_at: now.toISOString(),
        updated_by: user.id,
        updated_at: now.toISOString(),
      } as never)
      .eq('id', (current as unknown as UserAccessPeriod).id);
  }

  await logSuperAdminAction(
    user.id,
    userId,
    'USER_ACCESS_EXPIRED',
    current ? { status: (current as unknown as UserAccessPeriod).status } : null,
    { status: 'expired', expires_at: now.toISOString() },
    reason,
  );

  revalidatePath('/admin/control-center');
  revalidatePath(`/admin/control-center/users/${userId}`);
}

export async function suspendUser(userId: string, reason?: string): Promise<void> {
  const user = await requireSuperAdmin();
  const supabase = createClient();

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_active')
    .eq('id', userId)
    .single();
  if (!profile) throw new Error('User not found.');
  if ((profile as unknown as { role: string }).role === 'super_admin') {
    throw new Error('Cannot suspend a Super Admin.');
  }

  const before = profile as unknown as { role: string; is_active: boolean };

  // Deactivate profile
  await supabase
    .from('profiles')
    .update({ is_active: false, updated_at: new Date().toISOString() } as never)
    .eq('id', userId);

  // Mark access as suspended
  await supabase
    .from('user_access_periods')
    .update({ status: 'suspended', updated_by: user.id, updated_at: new Date().toISOString() } as never)
    .eq('user_id', userId)
    .in('status', ['active', 'expiring_soon']);

  await logSuperAdminAction(
    user.id,
    userId,
    'USER_SUSPENDED',
    { is_active: before.is_active },
    { is_active: false },
    reason,
  );

  revalidatePath('/admin/control-center');
  revalidatePath(`/admin/control-center/users/${userId}`);
}

export async function reactivateUser(userId: string, reason?: string): Promise<void> {
  const user = await requireSuperAdmin();
  const supabase = createClient();

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_active')
    .eq('id', userId)
    .single();
  if (!profile) throw new Error('User not found.');

  const before = profile as unknown as { role: string; is_active: boolean };

  await supabase
    .from('profiles')
    .update({ is_active: true, updated_at: new Date().toISOString() } as never)
    .eq('id', userId);

  // Restore access to active if it was suspended
  await supabase
    .from('user_access_periods')
    .update({ status: 'active', updated_by: user.id, updated_at: new Date().toISOString() } as never)
    .eq('user_id', userId)
    .eq('status', 'suspended');

  await logSuperAdminAction(
    user.id,
    userId,
    'USER_REACTIVATED',
    { is_active: before.is_active },
    { is_active: true },
    reason,
  );

  revalidatePath('/admin/control-center');
  revalidatePath(`/admin/control-center/users/${userId}`);
}

export async function changeUserRole(userId: string, newRole: UserRole, reason?: string): Promise<void> {
  const user = await requireSuperAdmin();
  const supabase = createClient();

  // Prevent self-demotion from super_admin (safety)
  if (userId === user.id) {
    throw new Error('Cannot change your own role.');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single();
  if (!profile) throw new Error('User not found.');

  const oldRole = (profile as unknown as { role: string }).role;

  // Only super_admin can grant super_admin
  if (newRole === 'super_admin') {
    // Already super_admin — this is the only caller that can do this
  }

  await supabase
    .from('profiles')
    .update({ role: newRole, updated_at: new Date().toISOString() } as never)
    .eq('id', userId);

  // Update access period role
  await supabase
    .from('user_access_periods')
    .update({ role: newRole, updated_by: user.id, updated_at: new Date().toISOString() } as never)
    .eq('user_id', userId)
    .in('status', ['active', 'expiring_soon', 'unlimited']);

  await logSuperAdminAction(
    user.id,
    userId,
    'ROLE_CHANGED',
    { role: oldRole },
    { role: newRole },
    reason,
  );

  revalidatePath('/admin/control-center');
  revalidatePath(`/admin/control-center/users/${userId}`);
}

// ── USER FEATURE OVERRIDES ─────────────────────────────────────────────────

export async function getUserFeatureOverrides(userId: string): Promise<UserFeatureOverride[]> {
  await requireSuperAdmin();
  const supabase = createClient();
  const { data, error } = await supabase
    .from('user_feature_overrides')
    .select('*')
    .eq('user_id', userId);
  if (error) throw new Error(`Failed to fetch overrides: ${error.message}`);
  return (data ?? []) as unknown as UserFeatureOverride[];
}

export async function setUserFeatureOverride(input: {
  userId: string;
  featureKey: string;
  enabled: boolean;
  expiresAt?: string;
  reason?: string;
}): Promise<void> {
  const user = await requireSuperAdmin();
  const supabase = createClient();

  const { data: existing } = await supabase
    .from('user_feature_overrides')
    .select('*')
    .eq('user_id', input.userId)
    .eq('feature_key', input.featureKey)
    .maybeSingle();

  if (existing) {
    const before = existing as unknown as UserFeatureOverride;
    await supabase
      .from('user_feature_overrides')
      .update({
        is_enabled: input.enabled,
        expires_at: input.expiresAt ?? null,
        reason: input.reason ?? null,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      } as never)
      .eq('id', before.id);

    await logSuperAdminAction(
      user.id,
      input.userId,
      'FEATURE_OVERRIDE_CHANGED',
      { is_enabled: before.is_enabled },
      { is_enabled: input.enabled, feature_key: input.featureKey },
      input.reason,
    );
  } else {
    await supabase.from('user_feature_overrides').insert({
      user_id: input.userId,
      feature_key: input.featureKey,
      is_enabled: input.enabled,
      expires_at: input.expiresAt ?? null,
      reason: input.reason ?? null,
      created_by: user.id,
      updated_by: user.id,
    } as never);

    await logSuperAdminAction(
      user.id,
      input.userId,
      input.enabled ? 'FEATURE_ENABLED' : 'FEATURE_DISABLED',
      null,
      { is_enabled: input.enabled, feature_key: input.featureKey },
      input.reason,
    );
  }

  revalidatePath('/admin/control-center');
  revalidatePath(`/admin/control-center/users/${input.userId}`);
}

export async function removeUserFeatureOverride(userId: string, featureKey: string): Promise<void> {
  const user = await requireSuperAdmin();
  const supabase = createClient();

  await supabase
    .from('user_feature_overrides')
    .delete()
    .eq('user_id', userId)
    .eq('feature_key', featureKey);

  await logSuperAdminAction(
    user.id,
    userId,
    'FEATURE_OVERRIDE_CHANGED',
    { feature_key: featureKey, removed: true },
    null,
  );

  revalidatePath('/admin/control-center');
  revalidatePath(`/admin/control-center/users/${userId}`);
}

// ── PLATFORM SETTINGS ──────────────────────────────────────────────────────

export async function getPlatformSettings(): Promise<Record<string, unknown>> {
  await requireSuperAdmin();
  const supabase = createClient();
  const { data, error } = await supabase.from('platform_settings').select('key, value');
  if (error) throw new Error(`Failed to fetch settings: ${error.message}`);
  const settings: Record<string, unknown> = {};
  for (const row of (data ?? []) as Array<{ key: string; value: unknown }>) {
    settings[row.key] = row.value;
  }
  return settings;
}

export async function updatePlatformSetting(key: string, value: unknown, reason?: string): Promise<void> {
  const user = await requireSuperAdmin();
  const supabase = createClient();

  const { data: before } = await supabase
    .from('platform_settings')
    .select('value')
    .eq('key', key)
    .single();

  await supabase
    .from('platform_settings')
    .update({ value: value as never, updated_by: user.id, updated_at: new Date().toISOString() } as never)
    .eq('key', key);

  await logSuperAdminAction(
    user.id,
    null,
    'SETTING_CHANGED',
    { key, value: (before as unknown as { value: unknown })?.value },
    { key, value },
    reason,
  );

  revalidatePath('/admin/control-center');
}

export async function setMaintenanceMode(config: MaintenanceModeConfig): Promise<void> {
  const user = await requireSuperAdmin();
  const supabase = createClient();

  const { data: before } = await supabase
    .from('platform_settings')
    .select('value')
    .eq('key', 'maintenance_mode')
    .single();

  await supabase
    .from('platform_settings')
    .update({
      value: config as never,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    } as never)
    .eq('key', 'maintenance_mode');

  await logSuperAdminAction(
    user.id,
    null,
    config.enabled ? 'MAINTENANCE_ENABLED' : 'MAINTENANCE_DISABLED',
    (before as unknown as { value: unknown })?.value as never,
    config as never,
  );

  revalidatePath('/admin/control-center');
}

// ── AUDIT LOGS ─────────────────────────────────────────────────────────────

export async function getSuperAdminAuditLogs(limit = 50): Promise<SuperAdminAuditLog[]> {
  await requireSuperAdmin();
  const supabase = createClient();
  const { data, error } = await supabase
    .from('super_admin_audit_logs')
    .select('*, actor:profiles!super_admin_audit_logs_actor_id_fkey(full_name), target:profiles!super_admin_audit_logs_target_id_fkey(full_name)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Failed to fetch audit logs: ${error.message}`);
  return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    actor_id: row.actor_id as string,
    target_id: row.target_id as string | null,
    action: row.action as SuperAdminAction,
    before_data: row.before_data as Record<string, unknown> | null,
    after_data: row.after_data as Record<string, unknown> | null,
    reason: row.reason as string | null,
    ip_address: row.ip_address as string | null,
    created_at: row.created_at as string,
    actor_name: ((row.actor as Record<string, unknown>)?.full_name as string) ?? 'Unknown',
    target_name: ((row.target as Record<string, unknown>)?.full_name as string) ?? null,
  }));
}

// ── OVERVIEW / DASHBOARD ───────────────────────────────────────────────────

export async function getControlCenterOverview(): Promise<ControlCenterOverview> {
  await requireSuperAdmin();
  const supabase = createClient();
  const now = new Date();
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const threeDaysEnd = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const sevenDaysEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [profilesRes, accessRes, featuresRes, auditRes] = await Promise.all([
    supabase.from('profiles').select('id, role, is_active').limit(10000),
    supabase.from('user_access_periods').select('user_id, status, expires_at').in('status', ['active', 'expiring_soon']).limit(10000),
    supabase.from('platform_features').select('id, is_enabled, is_implemented, expires_at').limit(100),
    supabase.from('super_admin_audit_logs').select('*, actor:profiles!super_admin_audit_logs_actor_id_fkey(full_name), target:profiles!super_admin_audit_logs_target_id_fkey(full_name)').order('created_at', { ascending: false }).limit(20),
  ]);

  const profiles = (profilesRes.data ?? []) as Array<{ id: string; role: string; is_active: boolean }>;
  const access = (accessRes.data ?? []) as Array<{ user_id: string; status: string; expires_at: string | null }>;
  const features = (featuresRes.data ?? []) as Array<{ id: string; is_enabled: boolean; is_implemented: boolean; expires_at: string | null }>;

  const nonSuperAdminProfiles = profiles.filter((p) => p.role !== 'super_admin');

  let expiringToday = 0;
  let expiringIn3Days = 0;
  let expiringIn7Days = 0;
  let expiredUsers = 0;

  for (const a of access) {
    if (!a.expires_at) continue;
    const exp = new Date(a.expires_at);
    if (exp <= now) expiredUsers++;
    else if (exp <= todayEnd) expiringToday++;
    else if (exp <= threeDaysEnd) expiringIn3Days++;
    else if (exp <= sevenDaysEnd) expiringIn7Days++;
  }

  const securityAlerts: SecurityAlert[] = [];
  if (expiringToday > 0) {
    securityAlerts.push({
      id: 'expiring-today',
      severity: 'critical',
      message: `${expiringToday} user(s) access expiring today`,
      timestamp: now.toISOString(),
    });
  }
  if (expiringIn3Days > 0) {
    securityAlerts.push({
      id: 'expiring-3d',
      severity: 'warning',
      message: `${expiringIn3Days} user(s) access expiring within 3 days`,
      timestamp: now.toISOString(),
    });
  }

  const featuresExpiringSoon = features.filter((f) => {
    if (!f.expires_at) return false;
    return new Date(f.expires_at) <= sevenDaysEnd && new Date(f.expires_at) > now;
  }).length;

  const recentAuditLogs: SuperAdminAuditLog[] = ((auditRes.data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    actor_id: row.actor_id as string,
    target_id: row.target_id as string | null,
    action: row.action as SuperAdminAction,
    before_data: row.before_data as Record<string, unknown> | null,
    after_data: row.after_data as Record<string, unknown> | null,
    reason: row.reason as string | null,
    ip_address: row.ip_address as string | null,
    created_at: row.created_at as string,
    actor_name: ((row.actor as Record<string, unknown>)?.full_name as string) ?? 'Unknown',
    target_name: ((row.target as Record<string, unknown>)?.full_name as string) ?? null,
  }));

  return {
    totalUsers: nonSuperAdminProfiles.length,
    activeUsers: nonSuperAdminProfiles.filter((p) => p.is_active).length,
    expiredUsers,
    suspendedUsers: nonSuperAdminProfiles.filter((p) => !p.is_active).length,
    expiringToday,
    expiringIn3Days,
    expiringIn7Days,
    totalFeatures: features.length,
    enabledFeatures: features.filter((f) => f.is_enabled).length,
    disabledFeatures: features.filter((f) => !f.is_enabled).length,
    featuresExpiringSoon,
    recentAuditLogs,
    securityAlerts,
  };
}

// ── USER MANAGEMENT VIEW ───────────────────────────────────────────────────

export async function getUserManagementView(userId: string): Promise<UserManagementView> {
  await requireSuperAdmin();
  const supabase = createClient();

  const [profileRes, accessRes, overridesRes, auditRes] = await Promise.all([
    supabase.from('profiles').select('id, full_name, phone, role, is_active, created_at').eq('id', userId).single(),
    supabase.from('user_access_periods').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(5),
    supabase.from('user_feature_overrides').select('*').eq('user_id', userId),
    supabase.from('super_admin_audit_logs').select('*, actor:profiles!super_admin_audit_logs_actor_id_fkey(full_name)').eq('target_id', userId).order('created_at', { ascending: false }).limit(20),
  ]);

  const profile = profileRes.data as unknown as { id: string; full_name: string; phone: string; role: string; is_active: boolean; created_at: string } | null;
  if (!profile) throw new Error('User not found.');

  const accessPeriods = (accessRes.data ?? []) as unknown as UserAccessPeriod[];
  const overrides = (overridesRes.data ?? []) as unknown as UserFeatureOverride[];

  const activeAccess = accessPeriods.find((a) => ['active', 'expiring_soon', 'unlimited'].includes(a.status));
  const accessStatus = activeAccess ? computeAccessStatus(activeAccess.expires_at) : (profile.is_active ? 'active' : 'suspended');

  // Get all features to determine enabled/disabled
  const { data: allFeatures } = await supabase
    .from('platform_features')
    .select('key, is_enabled')
    .eq('is_enabled', true);

  const overrideMap = new Map(overrides.map((o) => [o.feature_key, o.is_enabled]));
  const enabledFeatures: string[] = [];
  const disabledFeatures: string[] = [];

  for (const f of (allFeatures ?? []) as Array<{ key: string; is_enabled: boolean }>) {
    const override = overrideMap.get(f.key);
    if (override === true) enabledFeatures.push(f.key);
    else if (override === false) disabledFeatures.push(f.key);
    else enabledFeatures.push(f.key); // default enabled
  }

  // Also include overrides for features that are globally disabled
  for (const [key, enabled] of overrideMap) {
    if (enabled && !enabledFeatures.includes(key)) enabledFeatures.push(key);
    if (!enabled && !disabledFeatures.includes(key)) disabledFeatures.push(key);
  }

  const recentActivity: SuperAdminAuditLog[] = ((auditRes.data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    actor_id: row.actor_id as string,
    target_id: row.target_id as string | null,
    action: row.action as SuperAdminAction,
    before_data: row.before_data as Record<string, unknown> | null,
    after_data: row.after_data as Record<string, unknown> | null,
    reason: row.reason as string | null,
    ip_address: row.ip_address as string | null,
    created_at: row.created_at as string,
    actor_name: ((row.actor as Record<string, unknown>)?.full_name as string) ?? 'Unknown',
  }));

  return {
    id: profile.id,
    email: null, // fetched separately if needed
    fullName: profile.full_name,
    phone: profile.phone,
    role: profile.role,
    isActive: profile.is_active,
    accessStatus,
    accessExpiresAt: activeAccess?.expires_at ?? null,
    accessStartedAt: activeAccess?.started_at ?? null,
    enabledFeatures,
    disabledFeatures,
    recentActivity,
    createdAt: profile.created_at,
  };
}

// ── LIST ALL USERS ─────────────────────────────────────────────────────────

export async function getAllUsers(): Promise<Array<{
  id: string;
  full_name: string;
  phone: string;
  role: string;
  is_active: boolean;
  access_status: AccessStatus;
  access_expires_at: string | null;
}>> {
  await requireSuperAdmin();
  const supabase = createClient();

  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, full_name, phone, role, is_active')
    .order('created_at', { ascending: false })
    .limit(1000);
  if (error) throw new Error(`Failed to fetch users: ${error.message}`);

  const userIds = ((profiles ?? []) as Array<{ id: string }>).map((p) => p.id);
  if (userIds.length === 0) return [];

  const { data: accessPeriods } = await supabase
    .from('user_access_periods')
    .select('user_id, status, expires_at')
    .in('user_id', userIds)
    .in('status', ['active', 'expiring_soon', 'unlimited'])
    .order('created_at', { ascending: false });

  const accessMap = new Map<string, { status: string; expires_at: string | null }>();
  for (const ap of (accessPeriods ?? []) as Array<{ user_id: string; status: string; expires_at: string | null }>) {
    if (!accessMap.has(ap.user_id)) {
      accessMap.set(ap.user_id, { status: ap.status, expires_at: ap.expires_at });
    }
  }

  return ((profiles ?? []) as Array<{ id: string; full_name: string; phone: string; role: string; is_active: boolean }>).map((p) => {
    const access = accessMap.get(p.id);
    return {
      id: p.id,
      full_name: p.full_name,
      phone: p.phone,
      role: p.role,
      is_active: p.is_active,
      access_status: access ? computeAccessStatus(access.expires_at) : (p.is_active ? 'active' : 'suspended'),
      access_expires_at: access?.expires_at ?? null,
    };
  });
}
