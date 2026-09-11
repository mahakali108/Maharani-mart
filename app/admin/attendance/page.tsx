import { CalendarDays, Clock } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { formatIndiaTime, indiaTodayDateKey } from '@/lib/datetime/india';

interface AttendanceRow {
  id: string;
  work_date: string;
  punch_in_at: string;
  punch_in_lat: number | null;
  punch_in_lng: number | null;
  punch_out_at: string | null;
  profiles: { full_name: string; role: string } | null;
}

interface MonthAttendanceRow {
  user_id: string;
  punch_in_at: string;
  punch_out_at: string | null;
  profiles: { full_name: string; role: string } | null;
}

function isMonthKey(value: string | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}$/.test(value));
}

/** Working hours between punch-in and punch-out, rounded down to the minute. */
function hoursBetween(punchIn: string, punchOut: string | null): number {
  if (!punchOut) return 0;
  const ms = new Date(punchOut).getTime() - new Date(punchIn).getTime();
  return ms > 0 ? Math.round((ms / 3_600_000) * 10) / 10 : 0;
}

export default async function AdminAttendancePage({
  searchParams,
}: {
  searchParams: { date?: string; month?: string };
}) {
  const supabase = createClient();
  const month = isMonthKey(searchParams.month) ? searchParams.month : null;

  // ------------------------------------------------------------------
  // Monthly summary mode: present days + total hours per member, from
  // real attendance rows in the month (Asia/Kolkata work_date).
  // ------------------------------------------------------------------
  if (month) {
    const year = Number(month.slice(0, 4));
    const mon = Number(month.slice(5, 7));
    const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
    const from = `${month}-01`;
    const to = `${month}-${String(lastDay).padStart(2, '0')}`;

    const { data } = await supabase
      .from('attendance')
      .select('user_id, punch_in_at, punch_out_at, profiles ( full_name, role )')
      .gte('work_date', from)
      .lte('work_date', to)
      .order('punch_in_at');
    const rows = (data ?? []) as unknown as MonthAttendanceRow[];

    const summary = new Map<string, { name: string; role: string; days: number; hours: number }>();
    for (const row of rows) {
      const entry = summary.get(row.user_id) ?? {
        name: row.profiles?.full_name ?? '—',
        role: row.profiles?.role ?? '—',
        days: 0,
        hours: 0,
      };
      entry.days += 1;
      entry.hours += hoursBetween(row.punch_in_at, row.punch_out_at);
      summary.set(row.user_id, entry);
    }
    const summaries = [...summary.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));

    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-ink-950">Attendance — {month}</h1>
          <p className="mt-1 text-sm text-ink-500">Monthly summary computed from real punch-in/punch-out records.</p>
        </div>

        <Card>
          <form method="get" className="flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-ink-800" htmlFor="month">
                Month
              </label>
              <input
                id="month"
                name="month"
                type="month"
                defaultValue={month}
                max={indiaTodayDateKey().slice(0, 7)}
                className="h-11 rounded-xl border border-ink-200 bg-white px-3.5 text-sm text-ink-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary-600"
              />
            </div>
            <Button type="submit" size="sm" variant="secondary">
              View summary
            </Button>
          </form>
        </Card>

        {summaries.length === 0 ? (
          <AdminEmptyState
            icon={CalendarDays}
            title="No attendance in this month"
            body="Check-ins from staff and salesmen will appear here as they happen."
          />
        ) : (
          <Card className="table-scroll p-0">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="px-5 py-3 font-medium">Role</th>
                  <th className="px-5 py-3 font-medium">Days present</th>
                  <th className="px-5 py-3 font-medium">Total hours</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {summaries.map(([userId, s]) => (
                  <tr key={userId}>
                    <td className="px-5 py-3 font-medium text-ink-900">{s.name}</td>
                    <td className="px-5 py-3 capitalize text-ink-600">{s.role}</td>
                    <td className="px-5 py-3 text-ink-600">{s.days}</td>
                    <td className="px-5 py-3 text-ink-600">{s.hours.toFixed(1)} h</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Daily view (existing behaviour)
  // ------------------------------------------------------------------
  const date = searchParams.date || indiaTodayDateKey();

  const { data } = await supabase
    .from('attendance')
    .select('id, work_date, punch_in_at, punch_in_lat, punch_in_lng, punch_out_at, profiles ( full_name, role )')
    .eq('work_date', date)
    .order('punch_in_at', { ascending: false });

  const records = (data ?? []) as unknown as AttendanceRow[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Attendance</h1>
        <p className="mt-1 text-sm text-ink-500">Staff and salesman check-in/check-out records.</p>
      </div>

      <Card>
        <div className="flex flex-wrap items-end gap-4">
          <form method="get" className="flex items-end gap-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-ink-800" htmlFor="date">
                Date
              </label>
              <input
                id="date"
                name="date"
                type="date"
                defaultValue={date}
                max={indiaTodayDateKey()}
                className="h-11 rounded-xl border border-ink-200 bg-white px-3.5 text-sm text-ink-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary-600"
              />
            </div>
            <Button type="submit" size="sm" variant="secondary">
              View
            </Button>
          </form>
          <form method="get" className="flex items-end gap-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-ink-800" htmlFor="summary-month">
                Monthly summary
              </label>
              <input
                id="summary-month"
                name="month"
                type="month"
                max={indiaTodayDateKey().slice(0, 7)}
                className="h-11 rounded-xl border border-ink-200 bg-white px-3.5 text-sm text-ink-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary-600"
              />
            </div>
            <Button type="submit" size="sm" variant="outline">
              Summary
            </Button>
          </form>
        </div>
      </Card>

      {records.length === 0 ? (
        <AdminEmptyState
          icon={Clock}
          title="No attendance records for this date"
          body="Check-ins from staff and salesmen will appear here as they happen."
        />
      ) : (
        <Card className="table-scroll p-0">
          <table className="w-full min-w-[680px] text-sm">
            <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Role</th>
                <th className="px-5 py-3 font-medium">Check-in</th>
                <th className="px-5 py-3 font-medium">Check-out</th>
                <th className="px-5 py-3 font-medium">Location</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {records.map((r) => (
                <tr key={r.id}>
                  <td className="px-5 py-3 font-medium text-ink-900">{r.profiles?.full_name ?? '—'}</td>
                  <td className="px-5 py-3 capitalize text-ink-600">{r.profiles?.role ?? '—'}</td>
                  <td className="px-5 py-3 text-ink-600">{formatIndiaTime(r.punch_in_at)}</td>
                  <td className="px-5 py-3 text-ink-600">
                    {r.punch_out_at ? formatIndiaTime(r.punch_out_at) : (
                      <span className="text-amber-600">Still checked in</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-xs text-ink-400">
                    {r.punch_in_lat && r.punch_in_lng ? (
                      <a
                        href={`https://maps.google.com/?q=${r.punch_in_lat},${r.punch_in_lng}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary-600 hover:underline"
                      >
                        View on map
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
