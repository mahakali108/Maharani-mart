import { Clock } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { Card } from '@/components/ui/card';
import { AttendanceCheckButton } from '@/components/salesman/attendance-check-button';
import { formatIndiaDate, formatIndiaTime, indiaTodayDateKey } from '@/lib/datetime/india';

interface AttendanceRow {
  id: string;
  work_date: string;
  punch_in_at: string;
  punch_out_at: string | null;
}

export default async function AttendancePage() {
  const user = await requireUser();
  const supabase = createClient();

  // work_date is the Asia/Kolkata calendar date.
  const today = indiaTodayDateKey();

  const [{ data: todayRow }, { data: historyData }] = await Promise.all([
    supabase.from('attendance').select('id, work_date, punch_in_at, punch_out_at').eq('user_id', user.id).eq('work_date', today).maybeSingle<AttendanceRow>(),
    supabase
      .from('attendance')
      .select('id, work_date, punch_in_at, punch_out_at')
      .eq('user_id', user.id)
      .order('work_date', { ascending: false })
      .limit(30)
      .returns<AttendanceRow[]>(),
  ]);

  const history = (historyData ?? []).filter((h) => h.work_date !== today);

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold text-ink-950">Attendance</h1>

      <AttendanceCheckButton
        checkedIn={!!todayRow}
        checkedOut={!!todayRow?.punch_out_at}
        punchInAt={todayRow?.punch_in_at ?? null}
        punchOutAt={todayRow?.punch_out_at ?? null}
      />

      <div>
        <div className="mb-3 flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary-600" />
          <h2 className="text-sm font-semibold text-ink-800">History</h2>
        </div>
        {history.length === 0 ? (
          <Card>
            <p className="text-sm text-ink-500">Past attendance records will appear here.</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {history.map((h) => (
              <Card key={h.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 p-3">
                <p className="text-sm font-medium text-ink-900">
                  {formatIndiaDate(h.work_date)}
                </p>
                <p className="text-xs text-ink-500">
                  {formatIndiaTime(h.punch_in_at)}
                  {' – '}
                  {h.punch_out_at
                    ? formatIndiaTime(h.punch_out_at)
                    : 'not checked out'}
                </p>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
                                                                            }
