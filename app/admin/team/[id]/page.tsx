import { notFound } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { StaffEditForm } from '@/components/admin/staff-edit-form';
import { computeTargetActual, formatMetricValue, metricLabel, type TargetRow } from '@/lib/admin/target-actuals';
import { targetAttainmentPercent } from '@/lib/admin/targets-shared';
import { indiaTodayDateKey } from '@/lib/datetime/india';

interface StaffDetail {
  id: string;
  full_name: string;
  phone: string;
  role: 'staff' | 'salesman';
}

interface AssignmentRow {
  area_id: string | null;
  warehouse_id: string | null;
}

export default async function EditStaffPage({ params }: { params: { id: string } }) {
  await requirePermission('team.manage');

  const supabase = createClient();
  const { data: staffMember } = await supabase
    .from('profiles')
    .select('id, full_name, phone, role')
    .eq('id', params.id)
    .in('role', ['staff', 'salesman'])
    .maybeSingle<StaffDetail>();

  if (!staffMember) notFound();

  const month = indiaTodayDateKey().slice(0, 7);
  const year = Number(month.slice(0, 4));
  const mon = Number(month.slice(5, 7));
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const monthFrom = `${month}-01`;
  const monthTo = `${month}-${String(lastDay).padStart(2, '0')}`;

  const [
    { data: assignment },
    { data: areas },
    { data: warehouses },
    { data: targetData },
    { count: attendanceDays },
    { count: ordersCollected },
    { count: ordersDispatched },
  ] = await Promise.all([
    supabase
      .from('staff_assignments')
      .select('area_id, warehouse_id')
      .eq('staff_id', params.id)
      .maybeSingle<AssignmentRow>(),
    supabase.from('areas').select('id, name').eq('is_active', true).order('name'),
    supabase.from('warehouses').select('id, name').eq('is_active', true).order('name'),
    supabase
      .from('staff_targets')
      .select('id, user_id, period_start, period_end, metric, target_value, is_active')
      .eq('user_id', params.id)
      .eq('is_active', true)
      .order('period_start', { ascending: false })
      .returns<TargetRow[]>(),
    supabase
      .from('attendance')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', params.id)
      .gte('work_date', monthFrom)
      .lte('work_date', monthTo),
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('collected_by', params.id)
      .gte('placed_at', `${monthFrom}T00:00:00+05:30`)
      .lte('placed_at', `${monthTo}T23:59:59+05:30`),
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('dispatched_by', params.id)
      .gte('dispatched_at', `${monthFrom}T00:00:00+05:30`)
      .lte('dispatched_at', `${monthTo}T23:59:59+05:30`),
  ]);

  const targets = targetData ?? [];
  const actuals = await Promise.all(
    targets.map(async (t) => ({ targetId: t.id, actual: await computeTargetActual(t) }))
  );
  const actualByTarget = new Map(actuals.map((a) => [a.targetId, a.actual]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Edit team member</h1>
        <p className="mt-1 text-sm text-ink-500">{staffMember.full_name}</p>
      </div>

      {staffMember.role === 'staff' && !assignment?.area_id && !assignment?.warehouse_id ? (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            This staff member has <strong>no area or warehouse assignment</strong>. Since assignment
            scoping is active, they cannot see any orders, retailers or stock until an assignment is
            set below.
          </p>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Account details</CardTitle>
        </CardHeader>
        <StaffEditForm
          staffId={staffMember.id}
          fullName={staffMember.full_name}
          phone={staffMember.phone}
          role={staffMember.role}
          areaId={assignment?.area_id ?? null}
          warehouseId={assignment?.warehouse_id ?? null}
          areas={areas ?? []}
          warehouses={warehouses ?? []}
        />
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Performance — {month}</CardTitle>
        </CardHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-ink-50 p-4">
            <p className="text-2xl font-semibold text-ink-950">{attendanceDays ?? 0}</p>
            <p className="text-xs text-ink-500">Days present this month</p>
          </div>
          <div className="rounded-xl bg-ink-50 p-4">
            <p className="text-2xl font-semibold text-ink-950">{ordersCollected ?? 0}</p>
            <p className="text-xs text-ink-500">Orders collected this month</p>
          </div>
          <div className="rounded-xl bg-ink-50 p-4">
            <p className="text-2xl font-semibold text-ink-950">{ordersDispatched ?? 0}</p>
            <p className="text-xs text-ink-500">Orders dispatched this month</p>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Active targets</CardTitle>
        </CardHeader>
        {targets.length === 0 ? (
          <p className="text-sm text-ink-500">
            No active targets. Set them on the{' '}
            <a href="/admin/targets" className="font-medium text-primary-600 hover:text-primary-700">
              Targets
            </a>{' '}
            page.
          </p>
        ) : (
          <ul className="space-y-3 text-sm">
            {targets.map((t) => {
              const actual = actualByTarget.get(t.id);
              const percent = actual?.actual != null ? targetAttainmentPercent(actual.actual, t.target_value) : null;
              return (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-ink-700">
                    {metricLabel(t.metric)} · {t.period_start} → {t.period_end}
                  </span>
                  <span className="flex items-center gap-2 text-ink-500">
                    {actual?.actual != null ? (
                      <>
                        <span>
                          {formatMetricValue(t.metric, actual.actual)} / {formatMetricValue(t.metric, t.target_value)}
                        </span>
                        <span className="font-medium text-ink-900">{percent}%</span>
                      </>
                    ) : (
                      <span>{actual?.pending ?? '—'}</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
