import Link from 'next/link';
import { BellRing } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { indiaTodayDateKey } from '@/lib/datetime/india';

interface FollowUpRow {
  id: string;
  retailer_id: string;
  owner_id: string;
  due_date: string;
  note: string;
  status: string;
  completed_at: string | null;
  created_at: string;
  retailers: { shop_name: string } | null;
  profiles: { full_name: string } | null;
}

const STATUS_STYLES: Record<string, string> = {
  open: 'bg-amber-50 text-amber-700',
  done: 'bg-emerald-50 text-emerald-700',
  cancelled: 'bg-ink-100 text-ink-500',
};

export default async function AdminFollowUpsPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const supabase = createClient();
  const status = searchParams.status ?? 'open';

  let query = supabase
    .from('follow_ups')
    .select('id, retailer_id, owner_id, due_date, note, status, completed_at, created_at, retailers ( shop_name ), profiles!follow_ups_owner_id_fkey ( full_name )')
    .order('due_date', { ascending: true });
  if (status && status !== 'all') query = query.eq('status', status);

  const { data } = await query;
  const followUps = (data ?? []) as unknown as FollowUpRow[];
  const today = indiaTodayDateKey();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Follow-up reminders</h1>
        <p className="mt-1 text-sm text-ink-500">Oversight of every sales executive&apos;s retailer reminders. Read-only — reminders are managed by their owner.</p>
      </div>

      <Card>
        <div className="flex flex-wrap gap-2">
          {[
            { value: 'open', label: 'Open' },
            { value: 'done', label: 'Done' },
            { value: 'cancelled', label: 'Cancelled' },
            { value: 'all', label: 'All' },
          ].map((tab) => (
            <Link
              key={tab.value}
              href={`/admin/follow-ups?status=${tab.value}`}
              className={`rounded-xl px-3 py-1.5 text-sm font-medium ${
                status === tab.value ? 'bg-primary-600 text-white' : 'bg-ink-50 text-ink-600 hover:bg-ink-100'
              }`}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </Card>

      {followUps.length === 0 ? (
        <AdminEmptyState
          icon={BellRing}
          title="No reminders in this view"
          body="Sales executives create follow-up reminders from their console; everything they set appears here."
        />
      ) : (
        <Card className="table-scroll p-0">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-5 py-3 font-medium">Owner</th>
                <th className="px-5 py-3 font-medium">Retailer</th>
                <th className="px-5 py-3 font-medium">Due</th>
                <th className="px-5 py-3 font-medium">Note</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {followUps.map((f) => (
                <tr key={f.id}>
                  <td className="px-5 py-3 font-medium text-ink-900">{f.profiles?.full_name ?? '—'}</td>
                  <td className="px-5 py-3 text-ink-600">{f.retailers?.shop_name ?? '—'}</td>
                  <td className="px-5 py-3 text-ink-600">
                    {f.due_date}
                    {f.status === 'open' && f.due_date < today ? (
                      <span className="ml-2 rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700">Overdue</span>
                    ) : null}
                  </td>
                  <td className="max-w-xs px-5 py-3 break-words text-ink-600">{f.note}</td>
                  <td className="px-5 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[f.status] ?? 'bg-ink-100 text-ink-500'}`}>
                      {f.status}
                    </span>
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
