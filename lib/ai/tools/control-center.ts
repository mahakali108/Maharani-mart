import 'server-only';

import { z } from 'zod';
import type { AICard, AIToolContext, AIToolDefinition } from '@/lib/ai/types';
import { dbFailure, verified, unavailable } from '@/lib/ai/tools/helpers';

/**
 * Super Admin Control Center AI tools.
 *
 * SECURITY MODEL (same as super-admin.ts):
 * - READ-only: cannot mutate access, features, users, or settings.
 * - roles ['super_admin'] + surfaces ['admin'].
 * - Every query runs through the caller's RLS-scoped client.
 * - Database text is returned as inert data, never interpreted as instructions.
 *
 * For mutations (extend access, change role, etc.), the AI must present
 * the information and direct the user to the Control Center UI.
 * No silent privileged mutations.
 */

const noArgs = z.object({});
const noArgsJson = { type: 'object', additionalProperties: false };
const roles = ['super_admin'] as const;
const surfaces = ['admin'] as const;

// ── Tools ──────────────────────────────────────────────────────────────────

async function usersExpiringSoon(context: AIToolContext) {
  const now = new Date();
  const sevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const { data: accessPeriods, error } = await context.supabase
    .from('user_access_periods')
    .select('user_id, status, expires_at, role')
    .in('status', ['active', 'expiring_soon'])
    .not('expires_at', 'is', null)
    .lte('expires_at', sevenDays.toISOString())
    .order('expires_at', { ascending: true })
    .limit(100);

  if (error) return dbFailure();

  const periods = (accessPeriods ?? []) as Array<{ user_id: string; status: string; expires_at: string; role: string }>;
  if (periods.length === 0) {
    return unavailable('No users with access expiring in the next 7 days.');
  }

  // Fetch profile names
  const userIds = periods.map((p) => p.user_id);
  const { data: profiles } = await context.supabase
    .from('profiles')
    .select('id, full_name, role')
    .in('id', userIds)
    .limit(100);

  const profileMap = new Map(
    ((profiles ?? []) as Array<{ id: string; full_name: string; role: string }>).map((p) => [p.id, p])
  );

  const items = periods.map((p) => {
    const profile = profileMap.get(p.user_id);
    const daysLeft = Math.ceil((new Date(p.expires_at).getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
    return {
      userId: p.user_id,
      name: profile?.full_name ?? 'Unknown',
      role: profile?.role ?? p.role,
      expiresAt: p.expires_at,
      daysLeft: Math.max(0, daysLeft),
      status: daysLeft <= 0 ? 'expired' : daysLeft <= 3 ? 'critical' : 'warning',
    };
  });

  const cards: AICard[] = [
    {
      type: 'insight',
      title: `Users expiring within 7 days (${items.length})`,
      subtitle: 'Sorted by expiry date — earliest first',
      quality: 'verified',
      source: 'user_access_periods + profiles',
      metrics: [
        { label: 'Expired', value: String(items.filter((i) => i.status === 'expired').length), quality: 'verified' },
        { label: 'Critical (≤3d)', value: String(items.filter((i) => i.status === 'critical').length), quality: 'verified' },
        { label: 'Warning (≤7d)', value: String(items.filter((i) => i.status === 'warning').length), quality: 'verified' },
      ],
      lines: items.slice(0, 10).map((i) => ({
        label: `${i.name} (${i.role.replace('_', ' ')})`,
        value: `${i.daysLeft <= 0 ? 'EXPIRED' : `${i.daysLeft} day(s) left`} · expires ${new Date(i.expiresAt).toLocaleDateString('en-IN')}`,
      })),
      actions: [{ type: 'link', label: 'Open Access Management', href: '/admin/control-center?tab=access' }],
    },
  ];

  return verified({ items }, cards, 'user_access_periods + profiles');
}

async function disabledFeatures(context: AIToolContext) {
  const { data: features, error } = await context.supabase
    .from('platform_features')
    .select('key, name, is_enabled, is_implemented, expires_at')
    .eq('is_enabled', false)
    .order('sort_order')
    .limit(100);

  if (error) return dbFailure();

  const disabled = (features ?? []) as Array<{ key: string; name: string; is_enabled: boolean; is_implemented: boolean; expires_at: string | null }>;

  const cards: AICard[] = [
    {
      type: 'insight',
      title: `Disabled Features (${disabled.length})`,
      subtitle: 'Features currently turned off platform-wide',
      quality: 'verified',
      source: 'platform_features',
      lines: disabled.length === 0
        ? [{ label: 'All features enabled', value: 'No features are currently disabled.' }]
        : disabled.map((f) => ({
            label: f.name,
            value: `${f.key}${!f.is_implemented ? ' (Not Implemented)' : ''}`,
          })),
      actions: [{ type: 'link', label: 'Open Feature Management', href: '/admin/control-center?tab=features' }],
    },
  ];

  return verified({ disabled: disabled.map((f) => ({ key: f.key, name: f.name, implemented: f.is_implemented })) }, cards, 'platform_features');
}

async function expiredRetailers(context: AIToolContext) {
  const { data: accessPeriods, error } = await context.supabase
    .from('user_access_periods')
    .select('user_id, status, expires_at')
    .eq('role', 'retailer')
    .in('status', ['expired'])
    .order('expires_at', { ascending: false })
    .limit(100);

  if (error) return dbFailure();

  const periods = (accessPeriods ?? []) as Array<{ user_id: string; status: string; expires_at: string | null }>;
  if (periods.length === 0) {
    return unavailable('No retailers with expired access records.');
  }

  const userIds = periods.map((p) => p.user_id);
  const { data: profiles } = await context.supabase
    .from('profiles')
    .select('id, full_name')
    .in('id', userIds)
    .limit(100);
  const { data: retailers } = await context.supabase
    .from('retailers')
    .select('id, shop_name')
    .in('id', userIds)
    .limit(100);

  const profileMap = new Map(((profiles ?? []) as Array<{ id: string; full_name: string }>).map((p) => [p.id, p]));
  const retailerMap = new Map(((retailers ?? []) as Array<{ id: string; shop_name: string }>).map((r) => [r.id, r]));

  const items = periods.map((p) => ({
    userId: p.user_id,
    name: profileMap.get(p.user_id)?.full_name ?? 'Unknown',
    shop: retailerMap.get(p.user_id)?.shop_name ?? 'Unknown',
    expiredAt: p.expires_at,
  }));

  const cards: AICard[] = [
    {
      type: 'insight',
      title: `Retailers with Expired Access (${items.length})`,
      subtitle: 'These retailers have expired access periods',
      quality: 'verified',
      source: 'user_access_periods + profiles + retailers',
      lines: items.slice(0, 10).map((i) => ({
        label: `${i.shop} (${i.name})`,
        value: `Expired ${i.expiredAt ? new Date(i.expiredAt).toLocaleDateString('en-IN') : 'N/A'}`,
      })),
      actions: [{ type: 'link', label: 'Open Access Management', href: '/admin/control-center?tab=access' }],
    },
  ];

  return verified({ items }, cards, 'user_access_periods + profiles + retailers');
}

async function suspendedUsers(context: AIToolContext) {
  const { data: profiles, error } = await context.supabase
    .from('profiles')
    .select('id, full_name, role, is_active')
    .eq('is_active', false)
    .limit(100);

  if (error) return dbFailure();

  const suspended = (profiles ?? []) as Array<{ id: string; full_name: string; role: string; is_active: boolean }>;

  const cards: AICard[] = [
    {
      type: 'insight',
      title: `Suspended Users (${suspended.length})`,
      subtitle: 'Users with deactivated accounts',
      quality: 'verified',
      source: 'profiles',
      lines: suspended.length === 0
        ? [{ label: 'No suspended users', value: 'All accounts are active.' }]
        : suspended.slice(0, 10).map((u) => ({
            label: `${u.full_name} (${u.role.replace('_', ' ')})`,
            value: 'Account inactive',
          })),
      actions: [{ type: 'link', label: 'Open User Management', href: '/admin/control-center?tab=users' }],
    },
  ];

  return verified({ suspended: suspended.map((u) => ({ id: u.id, name: u.full_name, role: u.role })) }, cards, 'profiles');
}

async function recentPermissionChanges(context: AIToolContext) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: logs, error } = await context.supabase
    .from('super_admin_audit_logs')
    .select('id, action, target_id, reason, created_at, actor:profiles!super_admin_audit_logs_actor_id_fkey(full_name), target:profiles!super_admin_audit_logs_target_id_fkey(full_name)')
    .in('action', ['ROLE_CHANGED', 'PERMISSION_GRANTED', 'PERMISSION_REMOVED', 'FEATURE_OVERRIDE_CHANGED'])
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) return dbFailure();

  const entries = ((logs ?? []) as unknown as Array<Record<string, unknown>>).map((row) => ({
    action: row.action as string,
    actor: ((row.actor as Record<string, unknown>)?.full_name as string) ?? 'Unknown',
    target: ((row.target as Record<string, unknown>)?.full_name as string) ?? null,
    reason: row.reason as string | null,
    at: row.created_at as string,
  }));

  if (entries.length === 0) {
    return unavailable('No permission or role changes in the last 7 days.');
  }

  const cards: AICard[] = [
    {
      type: 'insight',
      title: `Recent Permission Changes (${entries.length})`,
      subtitle: 'Role and permission changes in the last 7 days',
      quality: 'verified',
      source: 'super_admin_audit_logs',
      lines: entries.slice(0, 10).map((e) => ({
        label: `${e.action.replace(/_/g, ' ')}${e.target ? ` → ${e.target}` : ''}`,
        value: `by ${e.at ? new Date(e.at).toLocaleString('en-IN') : 'N/A'}${e.reason ? ` · ${e.reason}` : ''}`,
      })),
      actions: [{ type: 'link', label: 'Open Audit Log', href: '/admin/control-center?tab=audit' }],
    },
  ];

  return verified({ entries }, cards, 'super_admin_audit_logs');
}

// ── Export ──────────────────────────────────────────────────────────────────

export const controlCenterTools: AIToolDefinition[] = [
  {
    name: 'get_users_expiring_soon',
    description: 'Get users whose access expires within 7 days, sorted by expiry date. Shows name, role, days left, and expiry date.',
    actionClass: 'READ',
    roles: [...roles],
    surfaces: [...surfaces],
    inputSchema: noArgs,
    inputJsonSchema: noArgsJson,
    execute: async (_input, context) => usersExpiringSoon(context),
  },
  {
    name: 'get_disabled_features',
    description: 'Get all currently disabled platform features. Shows feature name, key, and implementation status.',
    actionClass: 'READ',
    roles: [...roles],
    surfaces: [...surfaces],
    inputSchema: noArgs,
    inputJsonSchema: noArgsJson,
    execute: async (_input, context) => disabledFeatures(context),
  },
  {
    name: 'get_expired_retailers',
    description: 'Get retailers with expired access periods. Shows shop name, owner name, and expiry date.',
    actionClass: 'READ',
    roles: [...roles],
    surfaces: [...surfaces],
    inputSchema: noArgs,
    inputJsonSchema: noArgsJson,
    execute: async (_input, context) => expiredRetailers(context),
  },
  {
    name: 'get_suspended_users',
    description: 'Get all suspended (deactivated) users. Shows name and role.',
    actionClass: 'READ',
    roles: [...roles],
    surfaces: [...surfaces],
    inputSchema: noArgs,
    inputJsonSchema: noArgsJson,
    execute: async (_input, context) => suspendedUsers(context),
  },
  {
    name: 'get_recent_permission_changes',
    description: 'Get recent role and permission changes in the last 7 days. Shows what changed, who did it, and when.',
    actionClass: 'READ',
    roles: [...roles],
    surfaces: [...surfaces],
    inputSchema: noArgs,
    inputJsonSchema: noArgsJson,
    execute: async (_input, context) => recentPermissionChanges(context),
  },
];
