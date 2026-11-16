'use client';

import { useState, useTransition } from 'react';
import {
  Clock, Activity, AlertTriangle,
  X, UserCheck, UserX,
} from 'lucide-react';
import type {
  UserManagementView,
  UserFeatureOverride,
  UserAccessPeriod,
  PlatformFeature,
  AccessStatus,
} from '@/lib/admin/control-center/types';
import { ACCESS_PRESETS, statusBadgeColor } from '@/lib/admin/control-center/types';
import type { UserRole } from '@/lib/auth/roles';
import {
  extendAccess,
  expireAccess,
  suspendUser,
  reactivateUser,
  changeUserRole,
  setUserFeatureOverride,
  removeUserFeatureOverride,
} from '@/lib/admin/control-center/actions';
import { formatIndiaDateTime, formatIndiaDate } from '@/lib/datetime/india';

function StatusBadge({ status }: { status: AccessStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeColor(status)}`}>
      {status.replace('_', ' ').toUpperCase()}
    </span>
  );
}

interface Props {
  userView: UserManagementView;
  overrides: UserFeatureOverride[];
  accessPeriods: UserAccessPeriod[];
  features: PlatformFeature[];
}

export function UserManagementClient({ userView, overrides, accessPeriods, features }: Props) {
  const [isPending, startTransition] = useTransition();
  const [confirmAction, setConfirmAction] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState<UserRole>(userView.role as UserRole);
  const [accessDays, setAccessDays] = useState<number | null>(7);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * Runs a Server Action and reports its outcome.
   *
   * Server Actions reject with the thrown message over the RSC boundary, so a
   * bare `await action()` inside startTransition silently discarded every
   * refusal ("only a Super Admin may…", "record why you are…") and the operator
   * saw a button that appeared to do nothing. Every button routes through here.
   */
  const run = (label: string, action: () => Promise<void>) => {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        await action();
        setNotice(label);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        // Next.js encodes redirects/notFound as thrown sentinels; rethrow those
        // untouched so navigation still works.
        if (/NEXT_REDIRECT|NEXT_NOT_FOUND/.test(message)) throw cause;
        setError(message);
      }
    });
  };

  const overrideMap = new Map(overrides.map((o) => [o.feature_key, o]));

  return (
    <div className="space-y-6">
      {/* User Info Card */}
      <div className="rounded-xl border border-ink-100 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="break-words text-lg font-semibold text-ink-900">{userView.fullName}</h2>
            <p className="break-all text-sm text-ink-500">ID: {userView.id}</p>
            <p className="break-words text-sm text-ink-500">Phone: {userView.phone}</p>
            <p className="text-sm text-ink-500">
              Created: {formatIndiaDate(userView.createdAt)}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className="inline-flex items-center rounded-full bg-ink-100 px-3 py-1 text-xs font-medium text-ink-700">
              {userView.role.replace('_', ' ')}
            </span>
            <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${
              userView.isActive ? 'bg-mint-100 text-mint-800' : 'bg-slate-100 text-slate-800'
            }`}>
              {userView.isActive ? 'Active' : 'Inactive'}
            </span>
            <StatusBadge status={userView.accessStatus} />
            {userView.accessExpiresAt && (
              <span className="text-xs text-ink-500">
                Expires: {formatIndiaDateTime(userView.accessExpiresAt)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Outcome of the last action. Without this an authorization refusal or a
          database guard rejection looked like a button that did nothing. */}
      {error ? (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-error-200 bg-error-50 p-3 text-sm text-error-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span className="min-w-0 break-words">{error}</span>
        </div>
      ) : null}
      {notice && !error ? (
        <div role="status" className="rounded-xl border border-mint-200 bg-mint-50 p-3 text-sm text-mint-900">
          {notice}
        </div>
      ) : null}

      {/* Quick Actions */}
      <div className="rounded-xl border border-ink-100 bg-white p-5">
        <h3 className="mb-3 text-sm font-semibold text-ink-900">Quick Actions</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {/* Extend Access */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-ink-600">Extend Access</label>
            <div className="flex gap-2">
              <select
                value={accessDays ?? 'unlimited'}
                onChange={(e) => setAccessDays(e.target.value === 'unlimited' ? null : Number(e.target.value))}
                className="h-9 flex-1 rounded-lg border border-ink-200 px-2 text-sm"
              >
                {ACCESS_PRESETS.map((p) => (
                  <option key={p.label} value={p.days ?? 'unlimited'}>{p.label}</option>
                ))}
              </select>
              <button
                onClick={() => {
                  run('Access extended', () => extendAccess(userView.id, accessDays ?? 365, reason || undefined));
                }}
                disabled={isPending}
                className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50"
              >
                Extend
              </button>
            </div>
          </div>

          {/* Change Role */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-ink-600">Change Role</label>
            <div className="flex gap-2">
              <select
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value as UserRole)}
                className="h-9 flex-1 rounded-lg border border-ink-200 px-2 text-sm"
              >
                <option value="retailer">Retailer</option>
                <option value="salesman">Salesman</option>
                <option value="staff">Staff</option>
                <option value="admin">Admin</option>
              </select>
              <button
                onClick={() => {
                  run('Role changed', () => changeUserRole(userView.id, selectedRole, reason || undefined));
                }}
                disabled={isPending || selectedRole === userView.role}
                className="rounded-lg bg-ink-950 px-3 py-1.5 text-xs font-medium text-white hover:bg-ink-900 disabled:opacity-50"
              >
                Change
              </button>
            </div>
          </div>

          {/* Suspend / Reactivate */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-ink-600">Account Status</label>
            {userView.isActive ? (
              <button
                onClick={() => setConfirmAction('suspend')}
                disabled={isPending}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-200 disabled:opacity-50"
              >
                <UserX className="h-4 w-4" /> Suspend Account
              </button>
            ) : (
              <button
                onClick={() => {
                  run('Account reactivated', () => reactivateUser(userView.id, reason || undefined));
                }}
                disabled={isPending}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-mint-50 px-3 py-2 text-sm font-medium text-mint-700 hover:bg-mint-100 disabled:opacity-50"
              >
                <UserCheck className="h-4 w-4" /> Reactivate Account
              </button>
            )}
          </div>

          {/* Expire Access */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-ink-600">Expire Access Now</label>
            <button
              onClick={() => setConfirmAction('expire')}
              disabled={isPending}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
            >
              <Clock className="h-4 w-4" /> Expire Immediately
            </button>
          </div>

          {/* Reason */}
          <div className="space-y-2 sm:col-span-2">
            <label className="text-xs font-medium text-ink-600">Reason (for audit log)</label>
            <input
              type="text"
              placeholder="Optional reason..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="h-9 w-full rounded-lg border border-ink-200 px-3 text-sm"
            />
          </div>
        </div>
      </div>

      {/* Feature Overrides */}
      <div className="rounded-xl border border-ink-100 bg-white p-5">
        <h3 className="mb-3 text-sm font-semibold text-ink-900">Feature Overrides</h3>
        <p className="mb-3 text-xs text-ink-500">
          Override individual features for this user. Overrides take priority over global settings.
        </p>
        <div className="space-y-2">
          {features.map((feature) => {
            const override = overrideMap.get(feature.key);
            const isOverridden = !!override;
            const effectiveEnabled = override ? override.is_enabled : feature.is_enabled;

            return (
              <div
                key={feature.key}
                className="flex items-center gap-3 rounded-lg border border-ink-50 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-ink-900">{feature.name}</span>
                  <span className="ml-2 text-xs text-ink-400">{feature.key}</span>
                  {isOverridden && (
                    <span className="ml-2 rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-700">
                      Override
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      run('Feature override saved', () => setUserFeatureOverride({
                          userId: userView.id,
                          featureKey: feature.key,
                          enabled: true,
                          reason: reason || undefined,
                        }));
                    }}
                    disabled={isPending}
                    className={`rounded-lg px-2 py-1 text-xs font-medium ${
                      effectiveEnabled && isOverridden
                        ? 'bg-mint-100 text-mint-800'
                        : 'bg-ink-50 text-ink-500 hover:bg-mint-50'
                    }`}
                  >
                    Enable
                  </button>
                  <button
                    onClick={() => {
                      run('Feature override saved', () => setUserFeatureOverride({
                          userId: userView.id,
                          featureKey: feature.key,
                          enabled: false,
                          reason: reason || undefined,
                        }));
                    }}
                    disabled={isPending}
                    className={`rounded-lg px-2 py-1 text-xs font-medium ${
                      !effectiveEnabled && isOverridden
                        ? 'bg-slate-100 text-slate-800'
                        : 'bg-ink-50 text-ink-500 hover:bg-ink-100'
                    }`}
                  >
                    Disable
                  </button>
                  {isOverridden && (
                    <button
                      onClick={() => {
                        run('Feature override removed', () => removeUserFeatureOverride(userView.id, feature.key));
                      }}
                      disabled={isPending}
                      className="rounded-lg px-2 py-1 text-xs text-ink-400 hover:bg-ink-100 hover:text-ink-600"
                      title="Remove override (revert to global)"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Access History */}
      <div className="rounded-xl border border-ink-100 bg-white p-5">
        <h3 className="mb-3 text-sm font-semibold text-ink-900">Access History</h3>
        {accessPeriods.length === 0 ? (
          <p className="text-sm text-ink-500">No access periods recorded.</p>
        ) : (
          <div className="space-y-2">
            {accessPeriods.map((period) => (
              <div key={period.id} className="flex items-center justify-between rounded-lg bg-ink-50 px-3 py-2">
                <div>
                  <StatusBadge status={period.status} />
                  <span className="ml-2 text-xs text-ink-500">
                    {formatIndiaDateTime(period.started_at)}
                    {period.expires_at ? ` → ${formatIndiaDateTime(period.expires_at)}` : ' → Unlimited'}
                  </span>
                </div>
                {period.reason && (
                  <span className="text-xs text-ink-400">{period.reason}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent Activity */}
      <div className="rounded-xl border border-ink-100 bg-white p-5">
        <h3 className="mb-3 text-sm font-semibold text-ink-900">Recent Activity</h3>
        {userView.recentActivity.length === 0 ? (
          <p className="text-sm text-ink-500">No recent activity.</p>
        ) : (
          <div className="space-y-2">
            {userView.recentActivity.map((log) => (
              <div key={log.id} className="flex items-start gap-3 rounded-lg bg-ink-50 px-3 py-2">
                <Activity className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-400" />
                <div>
                  <p className="text-xs font-medium text-ink-800">
                    {log.action.replace(/_/g, ' ')}
                  </p>
                  <p className="text-xs text-ink-500">
                    by {log.actor_name} · {formatIndiaDateTime(log.created_at)}
                    {log.reason ? ` · ${log.reason}` : ''}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Confirmation Dialogs */}
      {confirmAction === 'suspend' && (
        <ConfirmDialog
          message={`Suspend ${userView.fullName}? They will be logged out and unable to access the platform.`}
          onConfirm={() => {
            run('Account suspended', () => suspendUser(userView.id, reason || undefined));
          }}
          onCancel={() => setConfirmAction(null)}
        />
      )}
      {confirmAction === 'expire' && (
        <ConfirmDialog
          message={`Expire access for ${userView.fullName} immediately? They will lose platform access.`}
          onConfirm={() => {
            run('Access expired', () => expireAccess(userView.id, reason || undefined));
          }}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </div>
  );
}

/** Module-level so React keeps one component identity across renders. */
function ConfirmDialog({ message, onConfirm, onCancel }: { message: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90dvh] w-full max-w-sm overflow-y-auto rounded-2xl bg-white p-5 shadow-xl sm:p-6">
        <div className="mb-4 flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" />
          <h3 className="break-words text-sm font-semibold text-ink-900">Confirm Action</h3>
        </div>
        <p className="mb-4 break-words text-sm text-ink-600">{message}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-xl px-4 py-2 text-sm font-medium text-ink-600 hover:bg-ink-100"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-200"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
