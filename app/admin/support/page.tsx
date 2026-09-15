import Link from 'next/link';
import { Headset } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { formatIndiaRelativeDateTime } from '@/lib/datetime/india';
import {
  SUPPORT_STATUSES,
  SUPPORT_STATUS_LABELS,
  SUPPORT_TOPIC_LABELS,
  type SupportStatus,
  type SupportTopic,
} from '@/lib/retailer/support';

const STATUS_STYLES: Record<SupportStatus, string> = {
  open: 'bg-amber-50 text-amber-700',
  in_progress: 'bg-blue-50 text-blue-700',
  resolved: 'bg-emerald-50 text-emerald-700',
  closed: 'bg-ink-100 text-ink-500',
};

interface TicketRow {
  id: string;
  ticket_number: string;
  subject: string;
  topic: SupportTopic;
  status: SupportStatus;
  created_at: string;
  updated_at: string;
  retailers: { shop_name: string } | null;
  orders: { order_number: string } | null;
}

export default async function AdminSupportPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const supabase = createClient();
  const status: SupportStatus | 'all' =
    SUPPORT_STATUSES.includes(searchParams.status as SupportStatus) || searchParams.status === 'all'
      ? (searchParams.status as SupportStatus | 'all')
      : 'open';

  const [{ data }, { count: openCount }] = await Promise.all([
    (async () => {
      let query = supabase
        .from('support_tickets')
        .select('id, ticket_number, subject, topic, status, created_at, updated_at, retailers ( shop_name ), orders ( order_number )', {
          count: 'exact',
        })
        .order('updated_at', { ascending: false })
        .limit(100);
      if (status !== 'all') query = query.eq('status', status);
      return query;
    })(),
    supabase.from('support_tickets').select('id', { count: 'exact', head: true }).eq('status', 'open'),
  ]);

  const tickets = (data ?? []) as unknown as TicketRow[];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink-950">Support tickets</h1>
          <p className="mt-1 text-sm text-ink-500">
            Retailer-raised tickets. Answer in the conversation; the retailer is notified in-app on every reply
            and status change.
          </p>
        </div>
        <Link
          href="/admin/support?status=open"
          className={`rounded-full px-3 py-1.5 text-xs font-bold ${
            (openCount ?? 0) > 0 ? 'bg-amber-50 text-amber-700' : 'bg-ink-100 text-ink-500'
          }`}
        >
          {openCount ?? 0} open
        </Link>
      </div>

      <Card>
        <div className="flex flex-wrap gap-2">
          {[{ value: 'all', label: 'All' }, { value: 'open', label: 'Open' }, ...SUPPORT_STATUSES.slice(1).map((s) => ({ value: s, label: SUPPORT_STATUS_LABELS[s] }))].map(
            (tab) => (
              <Link
                key={tab.value}
                href={tab.value === 'open' ? '/admin/support' : `/admin/support?status=${tab.value}`}
                aria-current={status === tab.value ? 'page' : undefined}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                  status === tab.value
                    ? 'bg-ink-950 text-white'
                    : 'bg-ink-50 text-ink-600 hover:bg-ink-100'
                }`}
              >
                {tab.label}
              </Link>
            )
          )}
        </div>

        {tickets.length === 0 ? (
          <AdminEmptyState
            icon={Headset}
            title="No tickets here"
            body={status === 'all' ? 'Retailer support tickets will appear as soon as they are raised.' : 'No tickets in this state right now.'}
          />
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-ink-100 text-[10px] font-bold uppercase tracking-wider text-ink-400">
                  <th className="px-3 py-2.5">Ticket</th>
                  <th className="px-3 py-2.5">Retailer</th>
                  <th className="px-3 py-2.5">Subject</th>
                  <th className="px-3 py-2.5">Order</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-50">
                {tickets.map((ticket) => (
                  <tr key={ticket.id} className="hover:bg-ink-50/60">
                    <td className="whitespace-nowrap px-3 py-3 font-mono text-xs font-semibold text-ink-900">
                      <Link href={`/admin/support/${ticket.id}`} className="hover:text-primary-600">
                        {ticket.ticket_number}
                      </Link>
                    </td>
                    <td className="max-w-[180px] truncate px-3 py-3 text-ink-600">
                      {ticket.retailers?.shop_name ?? '—'}
                    </td>
                    <td className="max-w-[260px] px-3 py-3">
                      <p className="truncate font-medium text-ink-900">{ticket.subject}</p>
                      <p className="text-[10px] text-ink-400">{SUPPORT_TOPIC_LABELS[ticket.topic] ?? ticket.topic}</p>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-ink-600">
                      {ticket.orders?.order_number ?? '—'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${STATUS_STYLES[ticket.status]}`}>
                        {SUPPORT_STATUS_LABELS[ticket.status]}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-xs text-ink-500">
                      {formatIndiaRelativeDateTime(ticket.updated_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
