import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface AttendanceRow {
  punch_in_at: string;
  punch_out_at: string | null;
}

interface VisitRow {
  id: string;
  status: string;
  check_in_at: string | null;
  check_out_at: string | null;
  notes: string | null;
  retailers: { shop_name: string } | null;
}

interface OrderRow {
  id: string;
  order_number: string;
  grand_total: number;
  retailers: { shop_name: string } | null;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function DailyCallReportPage({
  searchParams,
}: {
  searchParams: { date?: string };
}) {
  const user = await requireUser();
  const supabase = createClient();

  const date = searchParams.date && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date) ? searchParams.date : todayIso();
  const dayStart = `${date}T00:00:00.000Z`;
  const dayEnd = `${date}T23:59:59.999Z`;

  const [{ data: attendance }, { data: visitData }, { data: orderData }] = await Promise.all([
    supabase
      .from('attendance')
      .select('punch_in_at, punch_out_at')
      .eq('user_id', user.id)
      .eq('work_date', date)
      .maybeSingle<AttendanceRow>(),
    supabase
      .from('visits')
      .select('id, status, check_in_at, check_out_at, notes, retailers ( shop_name )')
      .eq('salesman_id', user.id)
      .gte('created_at', dayStart)
      .lte('created_at', dayEnd)
      .order('created_at'),
    supabase
      .from('orders')
      .select('id, order_number, grand_total, retailers ( shop_name )')
      .eq('collected_by', user.id)
      .gte('placed_at', dayStart)
      .lte('placed_at', dayEnd)
      .order('placed_at'),
  ]);

  const visits = (visitData ?? []) as unknown as VisitRow[];
  const orders = (orderData ?? []) as unknown as OrderRow[];
  const completedVisits = visits.filter((v) => v.status === 'checked_out').length;
  const skippedVisits = visits.filter((v) => v.status === 'skipped').length;
  const totalCollected = orders.reduce((sum, o) => sum + o.grand_total, 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-ink-950">Daily Call Report</h1>
        <p className="mt-1 text-sm text-ink-500">Your attendance, visits, and orders for the selected day.</p>
      </div>

      <form method="get" className="flex gap-2">
        <Input type="date" name="date" defaultValue={date} max={todayIso()} className="max-w-[180px]" />
        <Button type="submit" size="sm" variant="outline">
          View
        </Button>
      </form>

      <div className="grid grid-cols-3 gap-3">
        <Card className="p-3.5 text-center">
          <p className="text-lg font-semibold text-ink-950">{completedVisits}</p>
          <p className="text-xs text-ink-400">Visits Completed</p>
        </Card>
        <Card className="p-3.5 text-center">
          <p className="text-lg font-semibold text-ink-950">{orders.length}</p>
          <p className="text-xs text-ink-400">Orders Collected</p>
        </Card>
        <Card className="p-3.5 text-center">
          <p className="text-lg font-semibold text-ink-950">₹{totalCollected.toFixed(0)}</p>
          <p className="text-xs text-ink-400">Value Collected</p>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Attendance</CardTitle>
        </CardHeader>
        {attendance ? (
          <div className="flex gap-4 text-sm text-ink-600">
            <span>In: {new Date(attendance.punch_in_at).toLocaleTimeString('en-IN')}</span>
            <span>
              Out: {attendance.punch_out_at ? new Date(attendance.punch_out_at).toLocaleTimeString('en-IN') : 'Not punched out yet'}
            </span>
          </div>
        ) : (
          <p className="text-sm text-ink-500">No attendance recorded for this date.</p>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Visits ({visits.length}{skippedVisits > 0 ? `, ${skippedVisits} skipped` : ''})</CardTitle>
        </CardHeader>
        {visits.length === 0 ? (
          <p className="text-sm text-ink-500">No visits logged for this date.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {visits.map((v) => (
              <li key={v.id} className="flex items-center justify-between">
                <span className="text-ink-700">{v.retailers?.shop_name ?? 'Unknown retailer'}</span>
                <span className="text-xs text-ink-400">{v.status.replace('_', ' ')}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Orders Collected</CardTitle>
        </CardHeader>
        {orders.length === 0 ? (
          <p className="text-sm text-ink-500">No orders collected for this date.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {orders.map((o) => (
              <li key={o.id} className="flex items-center justify-between">
                <span className="text-ink-700">
                  {o.retailers?.shop_name} · <span className="font-mono text-xs">{o.order_number}</span>
                </span>
                <span className="font-medium text-ink-900">₹{o.grand_total.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
