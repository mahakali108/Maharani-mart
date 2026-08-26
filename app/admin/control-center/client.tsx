'use client';

import { useState, useTransition } from 'react';
import {
  Settings, Users, Package, Bell, AlertTriangle, Activity, Server,
  BarChart3, UserCog, Clock, EyeOff, Plus, Trash2,
  Edit3, ChevronRight, Search,
  Zap, TrendingUp, Gauge,
  ArrowLeftRight, Boxes, UserX,
  UserCheck, Calendar, Timer, Pause, Play,
} from 'lucide-react';
import Link from 'next/link';
import type {
  PlatformFeature,
  SuperAdminAuditLog,
  ControlCenterOverview,
  AccessStatus,
  MaintenanceModeConfig,
  MaintenanceScope,
} from '@/lib/admin/control-center/types';
import { ACCESS_PRESETS, statusBadgeColor } from '@/lib/admin/control-center/types';
import {
  toggleFeature,
  grantAccess,
  suspendUser,
  reactivateUser,
  setMaintenanceMode,
  createFeature,
  removeFeature,
} from '@/lib/admin/control-center/actions';

// ── Icon Map ───────────────────────────────────────────────────────────────

const ICON_MAP: Record<string, React.ElementType> = {
  Package, Zap, Bell, Users, Boxes, Clock, ArrowLeftRight,
  BarChart3, TrendingUp, Gauge, UserCog, Settings, Activity,
};

function FeatureIcon({ name, className }: { name: string | null; className?: string }) {
  if (!name) return <Package className={className} />;
  const Icon = ICON_MAP[name];
  return Icon ? <Icon className={className} /> : <Package className={className} />;
}

// ── Status Badge ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: AccessStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeColor(status)}`}>
      {status.replace('_', ' ').toUpperCase()}
    </span>
  );
}

// ── Tab Navigation ─────────────────────────────────────────────────────────

type Tab =
  | 'overview'
  | 'users'
  | 'features'
  | 'access'
  | 'maintenance'
  | 'audit'
  | 'settings';

const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: 'overview', label: 'Overview', icon: Gauge },
  { key: 'users', label: 'Users & Roles', icon: Users },
  { key: 'features', label: 'Features', icon: Package },
  { key: 'access', label: 'Access Management', icon: Clock },
  { key: 'maintenance', label: 'Maintenance', icon: Server },
  { key: 'audit', label: 'Audit Log', icon: Activity },
  { key: 'settings', label: 'Settings', icon: Settings },
];

// ── Main Client Component ──────────────────────────────────────────────────

interface ControlCenterClientProps {
  overview: ControlCenterOverview;
  features: PlatformFeature[];
  users: Array<{
    id: string;
    full_name: string;
    phone: string;
    role: string;
    is_active: boolean;
    access_status: AccessStatus;
    access_expires_at: string | null;
  }>;
  auditLogs: SuperAdminAuditLog[];
  settings: Record<string, unknown>;
  currentUserId: string; // eslint-disable-line @typescript-eslint/no-unused-vars -- reserved for future use
}

export function ControlCenterClient({
  overview,
  features,
  users,
  auditLogs,
  settings,
}: ControlCenterClientProps) {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [isPending, startTransition] = useTransition();
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');

  // ── Overview Tab ───────────────────────────────────────────────────────

  function OverviewTab() {
    const maintenanceConfig = settings.maintenance_mode as MaintenanceModeConfig | undefined;

    return (
      <div className="space-y-6">
        {/* Security Alerts */}
        {overview.securityAlerts.length > 0 && (
          <div className="space-y-2">
            {overview.securityAlerts.map((alert) => (
              <div
                key={alert.id}
                className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
                  alert.severity === 'critical'
                    ? 'border-red-200 bg-red-50'
                    : alert.severity === 'warning'
                    ? 'border-amber-200 bg-amber-50'
                    : 'border-blue-200 bg-blue-50'
                }`}
              >
                <AlertTriangle className={`h-4 w-4 shrink-0 ${
                  alert.severity === 'critical' ? 'text-red-600' : 'text-amber-600'
                }`} />
                <span className={`text-sm font-medium ${
                  alert.severity === 'critical' ? 'text-red-800' : 'text-amber-800'
                }`}>
                  {alert.message}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <StatCard label="Total Users" value={overview.totalUsers} icon={Users} />
          <StatCard label="Active Users" value={overview.activeUsers} icon={UserCheck} color="emerald" />
          <StatCard label="Expired Access" value={overview.expiredUsers} icon={Clock} color="red" />
          <StatCard label="Suspended" value={overview.suspendedUsers} icon={UserX} color="gray" />
          <StatCard label="Expiring Today" value={overview.expiringToday} icon={AlertTriangle} color="red" />
          <StatCard label="Expiring 3 Days" value={overview.expiringIn3Days} icon={Timer} color="amber" />
          <StatCard label="Expiring 7 Days" value={overview.expiringIn7Days} icon={Calendar} color="amber" />
          <StatCard label="Features" value={`${overview.enabledFeatures}/${overview.totalFeatures}`} icon={Package} color="blue" />
          <StatCard label="Disabled Features" value={overview.disabledFeatures} icon={EyeOff} color="gray" />
          <StatCard label="Features Expiring" value={overview.featuresExpiringSoon} icon={Clock} color="amber" />
        </div>

        {/* Maintenance Status */}
        {maintenanceConfig?.enabled && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 text-amber-600" />
              <span className="text-sm font-semibold text-amber-800">
                Maintenance Mode Active — {maintenanceConfig.scope.replace('_', ' ')}
              </span>
            </div>
            <p className="mt-1 text-sm text-amber-700">{maintenanceConfig.message}</p>
          </div>
        )}

        {/* Recent Audit Logs */}
        <div className="rounded-xl border border-ink-100 bg-white p-5">
          <h3 className="mb-3 text-sm font-semibold text-ink-900">Recent Super Admin Actions</h3>
          {overview.recentAuditLogs.length === 0 ? (
            <p className="text-sm text-ink-500">No recent actions.</p>
          ) : (
            <div className="space-y-2">
              {overview.recentAuditLogs.slice(0, 8).map((log) => (
                <div key={log.id} className="flex items-start gap-3 rounded-lg bg-ink-50 px-3 py-2">
                  <Activity className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-400" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-ink-800">
                      {log.action.replace(/_/g, ' ')}
                      {log.target_name ? ` → ${log.target_name}` : ''}
                    </p>
                    <p className="text-xs text-ink-500">
                      by {log.actor_name} · {new Date(log.created_at).toLocaleString('en-IN')}
                      {log.reason ? ` · ${log.reason}` : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Users Tab ─────────────────────────────────────────────────────────

  function UsersTab() {
    const filtered = users.filter((u) => {
      if (roleFilter !== 'all' && u.role !== roleFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return u.full_name.toLowerCase().includes(q) || u.phone.includes(q);
      }
      return true;
    });

    return (
      <div className="space-y-4">
        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <input
              type="text"
              placeholder="Search users..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-10 w-full rounded-xl border border-ink-200 bg-white pl-9 pr-4 text-sm outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
            />
          </div>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="h-10 rounded-xl border border-ink-200 bg-white px-3 text-sm outline-none focus:border-primary-500"
          >
            <option value="all">All Roles</option>
            <option value="admin">Admin</option>
            <option value="staff">Staff</option>
            <option value="salesman">Salesman</option>
            <option value="retailer">Retailer</option>
          </select>
        </div>

        {/* Users Table */}
        <div className="overflow-x-auto rounded-xl border border-ink-100 bg-white">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-ink-100 bg-ink-50">
                <th className="px-4 py-3 font-medium text-ink-600">Name</th>
                <th className="px-4 py-3 font-medium text-ink-600">Phone</th>
                <th className="px-4 py-3 font-medium text-ink-600">Role</th>
                <th className="px-4 py-3 font-medium text-ink-600">Status</th>
                <th className="px-4 py-3 font-medium text-ink-600">Access</th>
                <th className="px-4 py-3 font-medium text-ink-600">Expires</th>
                <th className="px-4 py-3 font-medium text-ink-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-ink-500">
                    No users found.
                  </td>
                </tr>
              ) : (
                filtered.map((u) => (
                  <tr key={u.id} className="border-b border-ink-50 hover:bg-ink-50/50">
                    <td className="px-4 py-3 font-medium text-ink-900">{u.full_name}</td>
                    <td className="px-4 py-3 text-ink-600">{u.phone}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center rounded-full bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-700">
                        {u.role.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        u.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                      }`}>
                        {u.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={u.access_status} />
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-500">
                      {u.access_expires_at
                        ? new Date(u.access_expires_at).toLocaleDateString('en-IN')
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/control-center/users/${u.id}`}
                        className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700"
                      >
                        Manage <ChevronRight className="h-3 w-3" />
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // ── Features Tab ──────────────────────────────────────────────────────

  function FeaturesTab() {
    const [showAddForm, setShowAddForm] = useState(false);
    const [newFeature, setNewFeature] = useState({ key: '', name: '', description: '', icon: '', route: '' });

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink-900">Platform Features ({features.length})</h3>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
          >
            <Plus className="h-4 w-4" /> Add Feature
          </button>
        </div>

        {showAddForm && (
          <div className="rounded-xl border border-ink-100 bg-white p-4">
            <h4 className="mb-3 text-sm font-semibold text-ink-900">New Feature</h4>
            <div className="grid grid-cols-2 gap-3">
              <input
                placeholder="Key (e.g. my_feature)"
                value={newFeature.key}
                onChange={(e) => setNewFeature({ ...newFeature, key: e.target.value })}
                className="h-9 rounded-lg border border-ink-200 px-3 text-sm"
              />
              <input
                placeholder="Name"
                value={newFeature.name}
                onChange={(e) => setNewFeature({ ...newFeature, name: e.target.value })}
                className="h-9 rounded-lg border border-ink-200 px-3 text-sm"
              />
              <input
                placeholder="Description"
                value={newFeature.description}
                onChange={(e) => setNewFeature({ ...newFeature, description: e.target.value })}
                className="h-9 rounded-lg border border-ink-200 px-3 text-sm"
              />
              <input
                placeholder="Icon (lucide name)"
                value={newFeature.icon}
                onChange={(e) => setNewFeature({ ...newFeature, icon: e.target.value })}
                className="h-9 rounded-lg border border-ink-200 px-3 text-sm"
              />
              <input
                placeholder="Route (e.g. /admin/my-page)"
                value={newFeature.route}
                onChange={(e) => setNewFeature({ ...newFeature, route: e.target.value })}
                className="col-span-2 h-9 rounded-lg border border-ink-200 px-3 text-sm"
              />
            </div>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => {
                  if (newFeature.key && newFeature.name) {
                    startTransition(async () => {
                      await createFeature(newFeature);
                      setShowAddForm(false);
                      setNewFeature({ key: '', name: '', description: '', icon: '', route: '' });
                    });
                  }
                }}
                disabled={isPending || !newFeature.key || !newFeature.name}
                className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50"
              >
                Create
              </button>
              <button
                onClick={() => setShowAddForm(false)}
                className="rounded-lg bg-ink-100 px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-200"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {features.map((feature) => (
            <div
              key={feature.id}
              className="flex items-center gap-4 rounded-xl border border-ink-100 bg-white px-4 py-3"
            >
              <FeatureIcon name={feature.icon} className="h-5 w-5 shrink-0 text-ink-500" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-ink-900">{feature.name}</span>
                  {!feature.is_implemented && (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                      Not Implemented
                    </span>
                  )}
                  {feature.expires_at && new Date(feature.expires_at) < new Date() && (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-600">
                      Expired
                    </span>
                  )}
                </div>
                <p className="text-xs text-ink-500">
                  {feature.description || feature.key}
                  {feature.route ? ` · ${feature.route}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    startTransition(async () => {
                      await toggleFeature(feature.id, !feature.is_enabled);
                    });
                  }}
                  disabled={isPending}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors ${
                    feature.is_enabled ? 'bg-emerald-500' : 'bg-ink-300'
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                      feature.is_enabled ? 'translate-x-5.5 mt-0.5 ml-0.5' : 'translate-x-0.5 mt-0.5'
                    }`}
                  />
                </button>
                <Link
                  href={`/admin/control-center?tab=features&edit=${feature.id}`}
                  className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-600"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                </Link>
                <button
                  onClick={() => {
                    if (confirm(`Remove feature "${feature.name}"? This cannot be undone.`)) {
                      startTransition(async () => {
                        await removeFeature(feature.id);
                      });
                    }
                  }}
                  disabled={isPending}
                  className="rounded-lg p-1.5 text-ink-400 hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Access Management Tab ─────────────────────────────────────────────

  function AccessTab() {
    const [selectedUser, setSelectedUser] = useState('');
    const [accessDays, setAccessDays] = useState<number | null>(7);
    const [accessReason, setAccessReason] = useState('');

    const expiringUsers = users.filter((u) =>
      ['expiring_soon', 'expired'].includes(u.access_status) && u.role !== 'super_admin'
    );

    return (
      <div className="space-y-6">
        {/* Quick Grant Access */}
        <div className="rounded-xl border border-ink-100 bg-white p-5">
          <h3 className="mb-3 text-sm font-semibold text-ink-900">Grant / Extend Access</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <select
              value={selectedUser}
              onChange={(e) => setSelectedUser(e.target.value)}
              className="h-10 rounded-xl border border-ink-200 bg-white px-3 text-sm"
            >
              <option value="">Select user...</option>
              {users.filter((u) => u.role !== 'super_admin').map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name} ({u.role.replace('_', ' ')})
                </option>
              ))}
            </select>
            <select
              value={accessDays ?? 'unlimited'}
              onChange={(e) => setAccessDays(e.target.value === 'unlimited' ? null : Number(e.target.value))}
              className="h-10 rounded-xl border border-ink-200 bg-white px-3 text-sm"
            >
              {ACCESS_PRESETS.map((p) => (
                <option key={p.label} value={p.days ?? 'unlimited'}>
                  {p.label}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Reason (optional)"
              value={accessReason}
              onChange={(e) => setAccessReason(e.target.value)}
              className="h-10 rounded-xl border border-ink-200 bg-white px-3 text-sm"
            />
            <button
              onClick={() => {
                if (selectedUser) {
                  startTransition(async () => {
                    await grantAccess({ userId: selectedUser, days: accessDays, reason: accessReason || undefined });
                    setSelectedUser('');
                    setAccessReason('');
                  });
                }
              }}
              disabled={!selectedUser || isPending}
              className="h-10 rounded-xl bg-primary-600 px-4 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
            >
              Grant Access
            </button>
          </div>
        </div>

        {/* Expiring Users */}
        {expiringUsers.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-800">
              <AlertTriangle className="h-4 w-4" />
              Users Needing Attention ({expiringUsers.length})
            </h3>
            <div className="space-y-2">
              {expiringUsers.map((u) => (
                <div key={u.id} className="flex items-center justify-between rounded-lg bg-white px-3 py-2">
                  <div>
                    <span className="text-sm font-medium text-ink-900">{u.full_name}</span>
                    <span className="ml-2 text-xs text-ink-500">{u.role.replace('_', ' ')}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={u.access_status} />
                    <Link
                      href={`/admin/control-center/users/${u.id}`}
                      className="text-xs font-medium text-primary-600 hover:text-primary-700"
                    >
                      Manage
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* All Users Access Table */}
        <div className="overflow-x-auto rounded-xl border border-ink-100 bg-white">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-ink-100 bg-ink-50">
                <th className="px-4 py-3 font-medium text-ink-600">User</th>
                <th className="px-4 py-3 font-medium text-ink-600">Role</th>
                <th className="px-4 py-3 font-medium text-ink-600">Access Status</th>
                <th className="px-4 py-3 font-medium text-ink-600">Expires</th>
                <th className="px-4 py-3 font-medium text-ink-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.filter((u) => u.role !== 'super_admin').map((u) => (
                <tr key={u.id} className="border-b border-ink-50 hover:bg-ink-50/50">
                  <td className="px-4 py-3 font-medium text-ink-900">{u.full_name}</td>
                  <td className="px-4 py-3 text-ink-600">{u.role.replace('_', ' ')}</td>
                  <td className="px-4 py-3"><StatusBadge status={u.access_status} /></td>
                  <td className="px-4 py-3 text-xs text-ink-500">
                    {u.access_expires_at ? new Date(u.access_expires_at).toLocaleString('en-IN') : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      {u.is_active ? (
                        <button
                          onClick={() => {
                            if (confirm(`Suspend ${u.full_name}?`)) {
                              startTransition(async () => { await suspendUser(u.id); });
                            }
                          }}
                          className="rounded-lg px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                        >
                          Suspend
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            startTransition(async () => { await reactivateUser(u.id); });
                          }}
                          className="rounded-lg px-2 py-1 text-xs text-emerald-600 hover:bg-emerald-50"
                        >
                          Reactivate
                        </button>
                      )}
                      <Link
                        href={`/admin/control-center/users/${u.id}`}
                        className="rounded-lg px-2 py-1 text-xs text-primary-600 hover:bg-primary-50"
                      >
                        Details
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // ── Maintenance Tab ───────────────────────────────────────────────────

  function MaintenanceTab() {
    const maintenanceConfig = settings.maintenance_mode as MaintenanceModeConfig | undefined;
    const [scope, setScope] = useState<MaintenanceScope>(maintenanceConfig?.scope ?? 'entire_platform');
    const [message, setMessage] = useState(maintenanceConfig?.message ?? 'Platform is under maintenance. Please try again later.');

    return (
      <div className="space-y-6">
        <div className="rounded-xl border border-ink-100 bg-white p-5">
          <h3 className="mb-4 text-sm font-semibold text-ink-900">Maintenance Mode</h3>

          <div className="mb-4 flex items-center gap-3">
            <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${
              maintenanceConfig?.enabled
                ? 'bg-amber-100 text-amber-800'
                : 'bg-emerald-100 text-emerald-800'
            }`}>
              {maintenanceConfig?.enabled ? 'ACTIVE' : 'INACTIVE'}
            </span>
          </div>

          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-600">Scope</label>
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value as MaintenanceScope)}
                className="h-10 w-full rounded-xl border border-ink-200 bg-white px-3 text-sm"
              >
                <option value="entire_platform">Entire Platform</option>
                <option value="retailer">Retailer Only</option>
                <option value="salesman">Salesman Only</option>
                <option value="admin">Admin Only</option>
                <option value="staff">Staff Only</option>
                <option value="warehouse">Warehouse Only</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-ink-600">Message</label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm"
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  startTransition(async () => {
                    await setMaintenanceMode({ enabled: true, scope, message });
                  });
                }}
                disabled={isPending}
                className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
              >
                <Pause className="h-4 w-4" /> Enable Maintenance
              </button>
              <button
                onClick={() => {
                  startTransition(async () => {
                    await setMaintenanceMode({ enabled: false, scope, message });
                  });
                }}
                disabled={isPending}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                <Play className="h-4 w-4" /> Disable Maintenance
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Audit Log Tab ─────────────────────────────────────────────────────

  function AuditTab() {
    return (
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-ink-900">Super Admin Audit Log ({auditLogs.length})</h3>
        <div className="space-y-2">
          {auditLogs.length === 0 ? (
            <p className="text-sm text-ink-500">No audit entries yet.</p>
          ) : (
            auditLogs.map((log) => (
              <div key={log.id} className="rounded-xl border border-ink-100 bg-white px-4 py-3">
                <div className="flex items-start justify-between">
                  <div>
                    <span className="inline-flex items-center rounded-full bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-700">
                      {log.action.replace(/_/g, ' ')}
                    </span>
                    {log.target_name && (
                      <span className="ml-2 text-xs text-ink-500">→ {log.target_name}</span>
                    )}
                  </div>
                  <span className="text-xs text-ink-400">
                    {new Date(log.created_at).toLocaleString('en-IN')}
                  </span>
                </div>
                <p className="mt-1 text-xs text-ink-500">
                  by {log.actor_name}
                  {log.reason ? ` · ${log.reason}` : ''}
                </p>
                {log.before_data && (
                  <p className="mt-1 text-xs text-ink-400">
                    Before: {JSON.stringify(log.before_data).slice(0, 120)}
                  </p>
                )}
                {log.after_data && (
                  <p className="mt-0.5 text-xs text-ink-400">
                    After: {JSON.stringify(log.after_data).slice(0, 120)}
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  // ── Settings Tab ──────────────────────────────────────────────────────

  function SettingsTab() {
    return (
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-ink-900">Platform Settings</h3>
        <div className="space-y-3">
          {Object.entries(settings).map(([key, value]) => (
            <div key={key} className="rounded-xl border border-ink-100 bg-white px-4 py-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-ink-900">{key.replace(/_/g, ' ')}</span>
                  <p className="mt-0.5 text-xs text-ink-500 font-mono">
                    {typeof value === 'object' ? JSON.stringify(value, null, 2).slice(0, 200) : String(value)}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* Tab Navigation */}
      <div className="flex gap-1 overflow-x-auto rounded-xl bg-ink-100 p-1">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? 'bg-white text-ink-900 shadow-sm'
                  : 'text-ink-600 hover:text-ink-900'
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && <OverviewTab />}
      {activeTab === 'users' && <UsersTab />}
      {activeTab === 'features' && <FeaturesTab />}
      {activeTab === 'access' && <AccessTab />}
      {activeTab === 'maintenance' && <MaintenanceTab />}
      {activeTab === 'audit' && <AuditTab />}
      {activeTab === 'settings' && <SettingsTab />}
    </div>
  );
}

// ── Stat Card ──────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon: Icon,
  color = 'blue',
}: {
  label: string;
  value: number | string;
  icon: React.ElementType;
  color?: string;
}) {
  const colorClasses: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    red: 'bg-red-50 text-red-600',
    amber: 'bg-amber-50 text-amber-600',
    gray: 'bg-gray-50 text-gray-600',
  };

  return (
    <div className="rounded-xl border border-ink-100 bg-white p-4">
      <div className="flex items-center gap-3">
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${colorClasses[color] ?? colorClasses.blue}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <p className="text-lg font-semibold text-ink-900">{value}</p>
          <p className="text-xs text-ink-500">{label}</p>
        </div>
      </div>
    </div>
  );
}
