import { Clock } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AdminEmptyState } from '@/components/admin/empty-state';

interface AttendanceRow {
  id: string;
  work_date: string;
  punch_in_at: string;
  punch_in_lat: number | null;
  punch_in_lng: number | null;
  punch_out_at: string | null;
  profiles: { full_name: string; role: string } | null;
}

export default async function AdminAttendancePage({
  searchParams,
}: {
  searchParams: { date?: string };
}) {
  const supabase = createClient();
  const date = searchParams.date || new Date().toISOString().slice(0, 10);

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
              max={new Date().toISOString().slice(0, 10)}
              className="h-11 rounded-xl border border-ink-200 bg-white px-3.5 text-sm text-ink-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary-600"
            />
          </div>
          <Button type="submit" size="sm" variant="secondary">
            View
          </Button>
        </form>
      </Card>

      {records.length === 0 ? (
        <AdminEmptyState
          icon={Clock}
          title="No attendance records for this date"
          body="Check-ins from staff and salesmen will appear here as they happen."
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <table className="w-full text-sm">
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
                  <td className="px-5 py-3 text-ink-600">{new Date(r.punch_in_at).toLocaleTimeString('en-IN')}</td>
                  <td className="px-5 py-3 text-ink-600">
                    {r.punch_out_at ? new Date(r.punch_out_at).toLocaleTimeString('en-IN') : (
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
