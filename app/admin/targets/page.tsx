import { Target } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { TargetForm } from '@/components/admin/target-form';
import { TargetRowActions } from '@/components/admin/target-row-actions';
import { computeTargetActual, formatMetricValue, metricLabel, type TargetRow } from '@/lib/admin/target-actuals';
import { targetAttainmentPercent } from '@/lib/admin/targets-shared';

interface MemberRow {
  id: string;
  full_name: string;
  role: string;
}

export default async function AdminTargetsPage() {
  await requirePermission('targets.manage');
  const supabase = createClient();

  const [{ data: memberData }, { data: targetData }] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, role')
      .in('role', ['staff', 'salesman'])
      .eq('is_active', true)
      .order('full_name')
      .returns<MemberRow[]>(),
    supabase
      .from('staff_targets')
      .select('id, user_id, period_start, period_end, metric, target_value, is_active')
      .order('period_start', { ascending: false })
      .returns<TargetRow[]>(),
  ]);

  const members = memberData ?? [];
  const memberById = new Map(members.map((m) => [m.id, m]));
  const targets = targetData ?? [];

  // Actuals are computed from real rows only (orders / visits / retailers);
  // each row shows "not yet computable" rather than a fake number.
  const actuals = await Promise.all(
    targets.map(async (t) => ({ targetId: t.id, actual: await computeTargetActual(t) }))
  );
  const actualByTarget = new Map(actuals.map((a) => [a.targetId, a.actual]));

  const activeTargets = targets.filter((t) => t.is_active);
  const inactiveTargets = targets.filter((t) => !t.is_active);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Targets</h1>
        <p className="mt-1 text-sm text-ink-500">
          Monthly and quarterly targets for staff and sales executives. Progress is computed from real orders, visits and approvals.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Set a target</CardTitle>
        </CardHeader>
        {members.length === 0 ? (
          <AdminEmptyState
            icon={Target}
            title="No team members yet"
            body="Create a staff or sales executive account first — targets are set per team member."
          />
        ) : (
          <TargetForm members={members} />
        )}
      </Card>

      {targets.length === 0 ? (
        <AdminEmptyState
          icon={Target}
          title="No targets set yet"
          body="Targets you set here will track real order, visit and approval activity for each member."
        />
      ) : (
        <>
          <Card className="table-scroll p-0">
            <div className="border-b border-ink-100 px-5 py-4">
              <h2 className="text-sm font-semibold text-ink-800">Active targets ({activeTargets.length})</h2>
            </div>
            {activeTargets.length === 0 ? (
              <p className="px-5 py-8 text-sm text-ink-500">No active targets. Reactivate by saving the same target again.</p>
            ) : (
              <table className="w-full min-w-[760px] text-sm">
                <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">Member</th>
                    <th className="px-5 py-3 font-medium">Metric</th>
                    <th className="px-5 py-3 font-medium">Period</th>
                    <th className="px-5 py-3 font-medium">Target</th>
                    <th className="px-5 py-3 font-medium">Actual</th>
                    <th className="px-5 py-3 font-medium">Progress</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {activeTargets.map((t) => {
                    const member = memberById.get(t.user_id);
                    const actual = actualByTarget.get(t.id);
                    const percent =
                      actual?.actual != null ? targetAttainmentPercent(actual.actual, t.target_value) : null;
                    return (
                      <tr key={t.id}>
                        <td className="px-5 py-3 font-medium text-ink-900">{member?.full_name ?? 'Unknown member'}</td>
                        <td className="px-5 py-3 text-ink-600">{metricLabel(t.metric)}</td>
                        <td className="px-5 py-3 text-ink-600">
                          {t.period_start} → {t.period_end}
                        </td>
                        <td className="px-5 py-3 text-ink-900">{formatMetricValue(t.metric, t.target_value)}</td>
                        <td className="px-5 py-3 text-ink-600">
                          {actual?.actual != null ? formatMetricValue(t.metric, actual.actual) : (actual?.pending ?? '—')}
                        </td>
                        <td className="px-5 py-3">
                          {percent == null ? (
                            <span className="text-xs text-ink-400">—</span>
                          ) : (
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-ink-100">
                                <div
                                  className="h-full rounded-full bg-primary-600"
                                  style={{ width: `${Math.min(100, percent)}%` }}
                                />
                              </div>
                              <span className="text-xs text-ink-500">{percent}%</span>
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <TargetRowActions targetId={t.id} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Card>

          {inactiveTargets.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Inactive targets ({inactiveTargets.length})</CardTitle>
              </CardHeader>
              <ul className="space-y-1.5 text-sm text-ink-500">
                {inactiveTargets.map((t) => (
                  <li key={t.id}>
                    {memberById.get(t.user_id)?.full_name ?? 'Unknown'} — {metricLabel(t.metric)} · {t.period_start} → {t.period_end}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
