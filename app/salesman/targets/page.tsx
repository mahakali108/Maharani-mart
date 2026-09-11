import { Target } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { Card } from '@/components/ui/card';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { computeTargetActual, formatMetricValue, metricLabel, type TargetRow } from '@/lib/admin/target-actuals';
import { targetAttainmentPercent } from '@/lib/admin/targets-shared';

export default async function SalesmanTargetsPage() {
  const user = await requireUser();
  const supabase = createClient();

  const { data } = await supabase
    .from('staff_targets')
    .select('id, user_id, period_start, period_end, metric, target_value, is_active')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .order('period_start', { ascending: false })
    .returns<TargetRow[]>();

  const targets = data ?? [];
  const actuals = await Promise.all(
    targets.map(async (t) => ({ targetId: t.id, actual: await computeTargetActual(t) }))
  );
  const actualByTarget = new Map(actuals.map((a) => [a.targetId, a.actual]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">My targets</h1>
        <p className="mt-1 text-sm text-ink-500">Your active targets and real progress from your orders, visits and approvals.</p>
      </div>

      {targets.length === 0 ? (
        <AdminEmptyState
          icon={Target}
          title="No active targets"
          body="When your admin sets a target for you, it will appear here with live progress."
        />
      ) : (
        <div className="space-y-4">
          {targets.map((t) => {
            const actual = actualByTarget.get(t.id);
            const percent = actual?.actual != null ? targetAttainmentPercent(actual.actual, t.target_value) : null;
            return (
              <Card key={t.id} className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-ink-900">{metricLabel(t.metric)}</p>
                    <p className="text-xs text-ink-400">
                      {t.period_start} → {t.period_end}
                    </p>
                  </div>
                  <div className="text-right">
                    {actual?.actual != null ? (
                      <>
                        <p className="font-semibold text-ink-900">
                          {formatMetricValue(t.metric, actual.actual)}{' '}
                          <span className="text-sm font-normal text-ink-400">/ {formatMetricValue(t.metric, t.target_value)}</span>
                        </p>
                        <p className="text-xs text-ink-500">{percent}% achieved</p>
                      </>
                    ) : (
                      <p className="text-xs text-ink-400">{actual?.pending ?? '—'}</p>
                    )}
                  </div>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-ink-100">
                  <div
                    className={`h-full rounded-full ${percent != null && percent >= 100 ? 'bg-emerald-500' : 'bg-primary-600'}`}
                    style={{ width: `${Math.min(100, percent ?? 0)}%` }}
                  />
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
