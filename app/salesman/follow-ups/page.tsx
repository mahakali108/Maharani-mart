import { BellRing } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { FollowUpForm } from '@/components/salesman/follow-up-form';
import { FollowUpButtons } from '@/components/salesman/follow-up-buttons';
import { indiaTodayDateKey } from '@/lib/datetime/india';

interface FollowUpRow {
  id: string;
  retailer_id: string;
  due_date: string;
  note: string;
  status: string;
  retailers: { shop_name: string } | null;
}

interface RetailerOption {
  id: string;
  shop_name: string;
}

export default async function SalesmanFollowUpsPage() {
  const user = await requireUser();
  const supabase = createClient();
  const today = indiaTodayDateKey();

  const [{ data: retailerData }, { data: followUpData }] = await Promise.all([
    supabase
      .from('retailers')
      .select('id, shop_name')
      .eq('assigned_salesman_id', user.id)
      .eq('status', 'active')
      .order('shop_name')
      .returns<RetailerOption[]>(),
    supabase
      .from('follow_ups')
      .select('id, retailer_id, due_date, note, status, retailers ( shop_name )')
      .eq('owner_id', user.id)
      .order('due_date', { ascending: true })
      .returns<FollowUpRow[]>(),
  ]);

  const retailers = retailerData ?? [];
  const followUps = followUpData ?? [];
  const open = followUps.filter((f) => f.status === 'open');
  const overdue = open.filter((f) => f.due_date < today);
  const dueToday = open.filter((f) => f.due_date === today);
  const upcoming = open.filter((f) => f.due_date > today);
  const closed = followUps.filter((f) => f.status !== 'open');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Follow-up reminders</h1>
        <p className="mt-1 text-sm text-ink-500">Plan callbacks for your retailers — overdue and today&apos;s reminders first.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New reminder</CardTitle>
        </CardHeader>
        {retailers.length === 0 ? (
          <AdminEmptyState
            icon={BellRing}
            title="No assigned retailers"
            body="Reminders are created per assigned retailer; you have none assigned yet."
          />
        ) : (
          <FollowUpForm retailers={retailers} />
        )}
      </Card>

      {open.length === 0 && closed.length === 0 ? (
        <AdminEmptyState
          icon={BellRing}
          title="No reminders yet"
          body="Add your first reminder above — overdue and today&apos;s items stay at the top of your day."
        />
      ) : (
        <>
          {overdue.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-primary-700">Overdue ({overdue.length})</h2>
              {overdue.map((f) => (
                <Card key={f.id} className="flex flex-wrap items-center justify-between gap-3 border-primary-200">
                  <div>
                    <p className="font-medium text-ink-900">{f.retailers?.shop_name ?? '—'}</p>
                    <p className="text-xs text-primary-600">Was due {f.due_date}</p>
                    <p className="mt-1 max-w-md break-words text-sm text-ink-600">{f.note}</p>
                  </div>
                  <FollowUpButtons followUpId={f.id} />
                </Card>
              ))}
            </section>
          ) : null}

          {dueToday.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Today ({dueToday.length})</h2>
              {dueToday.map((f) => (
                <Card key={f.id} className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-ink-900">{f.retailers?.shop_name ?? '—'}</p>
                    <p className="mt-1 max-w-md break-words text-sm text-ink-600">{f.note}</p>
                  </div>
                  <FollowUpButtons followUpId={f.id} />
                </Card>
              ))}
            </section>
          ) : null}

          {upcoming.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Upcoming ({upcoming.length})</h2>
              {upcoming.map((f) => (
                <Card key={f.id} className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-ink-900">
                      {f.retailers?.shop_name ?? '—'} <span className="text-xs font-normal text-ink-400">· {f.due_date}</span>
                    </p>
                    <p className="mt-1 max-w-md break-words text-sm text-ink-600">{f.note}</p>
                  </div>
                  <FollowUpButtons followUpId={f.id} />
                </Card>
              ))}
            </section>
          ) : null}

          {closed.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-400">Closed ({closed.length})</h2>
              <ul className="space-y-1.5 text-sm text-ink-500">
                {closed.map((f) => (
                  <li key={f.id}>
                    {f.retailers?.shop_name ?? '—'} · {f.due_date} — {f.note}{' '}
                    <span className="text-xs capitalize text-ink-400">({f.status})</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
