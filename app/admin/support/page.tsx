import Link from 'next/link';
import { Headset } from 'lucide-react';
import {
  InfiniteScrollProvider,
  InfiniteScrollRows,
  InfiniteScrollStatus,
  InfiniteScrollTableSkeleton,
  type InfiniteScrollBatch,
} from '@/components/ui/infinite-scroll';
import {
  applyCursor,
  applyKeysetOrder,
  keysetCursorFor,
  readCursor,
  toListBatch,
  type KeysetColumn,
} from '@/lib/infinite-scroll/keyset';
import type { ListCursor } from '@/lib/infinite-scroll/cursor';
import { createClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { SupportFilters } from '@/components/admin/support-filters';
import { formatIndiaRelativeDateTime } from '@/lib/datetime/india';
import {
  SUPPORT_PRIORITIES,
  SUPPORT_PRIORITY_LABELS,
  SUPPORT_STATUSES,
  SUPPORT_STATUS_LABELS,
  SUPPORT_TOPICS,
  SUPPORT_TOPIC_LABELS,
  type SupportPriority,
  type SupportStatus,
  type SupportTopic,
} from '@/lib/retailer/support';

const STATUS_STYLES: Record<SupportStatus, string> = {
  open: 'bg-amber-50 text-amber-700',
  in_progress: 'bg-blue-50 text-blue-700',
  resolved: 'bg-emerald-50 text-emerald-700',
  closed: 'bg-ink-100 text-ink-500',
};

const PRIORITY_STYLES: Record<SupportPriority, string> = {
  low: 'bg-ink-50 text-ink-500',
  normal: 'bg-sky-50 text-sky-700',
  high: 'bg-orange-50 text-orange-700',
  urgent: 'bg-primary-50 text-primary-700',
};

/** Rows per batch. */
const BATCH_SIZE = 25;

/**
 * Most recently updated first, `id` breaking ties. `updated_at` is NOT NULL
 * (0048_support_tickets.sql), so the keyset comparison is always defined.
 */
const ORDER: KeysetColumn[] = [
  { column: 'updated_at', ascending: false },
  { column: 'id', ascending: false },
];

type SupabaseClient = ReturnType<typeof createClient>;

interface TicketRow {
  id: string;
  ticket_number: string;
  subject: string;
  topic: SupportTopic;
  priority: SupportPriority;
  status: SupportStatus;
  created_at: string;
  updated_at: string;
  retailers: { shop_name: string } | null;
  orders: { order_number: string } | null;
}

/**
 * One batch of support tickets.
 *
 * The `count: 'exact'` that used to accompany the query is gone: a batch
 * over-fetches BATCH_SIZE + 1 rows as the "is there more?" probe, which is
 * cheaper than counting the whole filtered table and is all a scrolling list
 * actually needs.
 */
async function loadTicketBatch(
  supabase: SupabaseClient,
  filters: { status: SupportStatus | 'all'; topic: SupportTopic | ''; priority: SupportPriority | '' },
  cursor: ListCursor | null
): Promise<{ items: TicketRow[]; nextCursor: string | null }> {
  let query = supabase
    .from('support_tickets')
    .select('id, ticket_number, subject, topic, priority, status, created_at, updated_at, retailers ( shop_name ), orders ( order_number )');

  if (filters.status !== 'all') query = query.eq('status', filters.status);
  if (filters.topic) query = query.eq('topic', filters.topic);
  if (filters.priority) query = query.eq('priority', filters.priority);

  const { data } = await applyCursor(applyKeysetOrder(query, ORDER), cursor, ORDER, BATCH_SIZE);
  const rows = (data ?? []) as unknown as TicketRow[];
  const batch = toListBatch(rows, BATCH_SIZE, (row) => keysetCursorFor(row, ORDER));
  return { items: batch.items, nextCursor: batch.nextCursor };
}

function renderTicketRows(tickets: TicketRow[]) {
  return tickets.map((ticket) => (
    <tr key={ticket.id} className="hover:bg-ink-50/60">
      <td className="whitespace-nowrap px-3 py-3 font-mono text-xs font-semibold text-ink-900">
        <Link href={`/admin/support/${ticket.id}`} className="hover:text-primary-600">
          {ticket.ticket_number}
        </Link>
      </td>
      <td className="max-w-[180px] truncate px-3 py-3 text-ink-600">{ticket.retailers?.shop_name ?? '—'}</td>
      <td className="max-w-[240px] px-3 py-3">
        <p className="truncate font-medium text-ink-900">{ticket.subject}</p>
        <p className="text-[10px] text-ink-400">{SUPPORT_TOPIC_LABELS[ticket.topic] ?? ticket.topic}</p>
      </td>
      <td className="whitespace-nowrap px-3 py-3">
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${PRIORITY_STYLES[ticket.priority] ?? PRIORITY_STYLES.normal}`}>
          {SUPPORT_PRIORITY_LABELS[ticket.priority] ?? ticket.priority}
        </span>
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
  ));
}

export default async function AdminSupportPage({
  searchParams,
}: {
  searchParams: { status?: string; topic?: string; priority?: string };
}) {
  const supabase = createClient();
  const status: SupportStatus | 'all' =
    SUPPORT_STATUSES.includes(searchParams.status as SupportStatus) || searchParams.status === 'all'
      ? (searchParams.status as SupportStatus | 'all')
      : 'open';
  const topic: SupportTopic | '' =
    SUPPORT_TOPICS.includes(searchParams.topic as SupportTopic) ? (searchParams.topic as SupportTopic) : '';
  const priority: SupportPriority | '' =
    SUPPORT_PRIORITIES.includes(searchParams.priority as SupportPriority)
      ? (searchParams.priority as SupportPriority)
      : '';

  const filters = { status, topic, priority };
  const [firstBatch, { count: openCount }] = await Promise.all([
    loadTicketBatch(supabase, filters, null),
    supabase.from('support_tickets').select('id', { count: 'exact', head: true }).eq('status', 'open'),
  ]);
  const tickets = firstBatch.items;

  /** Server Action for the batches after the first; the filters are captured. */
  async function loadMoreTickets(cursor: string | null): Promise<InfiniteScrollBatch> {
    'use server';
    const batch = await loadTicketBatch(createClient(), filters, readCursor(cursor));
    return { rows: renderTicketRows(batch.items), nextCursor: batch.nextCursor };
  }

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
        <SupportFilters status={status} topic={topic} priority={priority} />

        {tickets.length === 0 ? (
          <AdminEmptyState
            icon={Headset}
            title="No tickets here"
            body={
              status === 'all' && !topic && !priority
                ? 'Retailer support tickets will appear as soon as they are raised.'
                : 'No tickets match these filters right now.'
            }
          />
        ) : (
          <InfiniteScrollProvider
            loader={loadMoreTickets}
            initialCursor={firstBatch.nextCursor}
            initialHasMore={Boolean(firstBatch.nextCursor)}
            resetKey={`${status}|${topic}|${priority}`}
          >
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead>
                  <tr className="border-b border-ink-100 text-[10px] font-bold uppercase tracking-wider text-ink-400">
                    <th className="px-3 py-2.5">Ticket</th>
                    <th className="px-3 py-2.5">Retailer</th>
                    <th className="px-3 py-2.5">Subject</th>
                    <th className="px-3 py-2.5">Priority</th>
                    <th className="px-3 py-2.5">Order</th>
                    <th className="px-3 py-2.5">Status</th>
                    <th className="px-3 py-2.5">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-50">
                  <InfiniteScrollRows skeleton={<InfiniteScrollTableSkeleton columns={7} />}>
                    {renderTicketRows(tickets)}
                  </InfiniteScrollRows>
                </tbody>
              </table>
            </div>

            <InfiniteScrollStatus endLabel="No more tickets" loadingLabel="Loading more…" />
          </InfiniteScrollProvider>
        )}
      </Card>
    </div>
  );
}
