import Link from 'next/link';
import { ChevronRight, Headset, ListPlus, PackageSearch } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { formatIndiaRelativeDateTime } from '@/lib/datetime/india';
import {
  InfiniteScrollProvider,
  InfiniteScrollRows,
  InfiniteScrollStatus,
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
import {
  SUPPORT_PRIORITY_LABELS,
  SUPPORT_STATUSES,
  SUPPORT_STATUS_LABELS,
  SUPPORT_TOPIC_LABELS,
  type SupportPriority,
  type SupportStatus,
  type SupportTopic,
} from '@/lib/retailer/support';

/** Rows per batch. */
const PAGE_SIZE = 20;

/** Newest first, `id` breaking ties so batches never overlap. */
const ORDER: KeysetColumn[] = [
  { column: 'created_at', ascending: false },
  { column: 'id', ascending: false },
];

const STATUS_STYLES: Record<SupportStatus, string> = {
  open: 'bg-amber-50 text-amber-700 ring-amber-200',
  in_progress: 'bg-sky-50 text-sky-700 ring-sky-200',
  resolved: 'bg-mint-50 text-mint-700 ring-mint-200',
  closed: 'bg-slate-100 text-slate-600 ring-slate-200',
};

const PRIORITY_STYLES: Record<SupportPriority, string> = {
  low: 'bg-slate-100 text-slate-600 ring-slate-200',
  normal: 'bg-sky-50 text-sky-700 ring-sky-200',
  high: 'bg-amber-50 text-amber-700 ring-amber-200',
  urgent: 'bg-primary-50 text-primary-700 ring-primary-200',
};

interface TicketRow {
  id: string;
  ticket_number: string;
  subject: string;
  topic: SupportTopic;
  priority: SupportPriority;
  status: SupportStatus;
  created_at: string;
  updated_at: string;
  orders: { order_number: string; status: string } | null;
}

function supportHref(status: string): string {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  const query = params.toString();
  return `/retailer/support${query ? `?${query}` : ''}`;
}

type SupabaseClient = ReturnType<typeof createClient>;

/**
 * One batch of this retailer's tickets. `support_tickets` RLS already scopes
 * the rows to the caller; the explicit `retailer_id` filter is the same
 * belt-and-braces the old paged query used.
 */
async function loadTicketBatch(
  supabase: SupabaseClient,
  retailerId: string,
  status: string,
  cursor: ListCursor | null
) {
  let query = supabase
    .from('support_tickets')
    .select('id, ticket_number, subject, topic, priority, status, created_at, updated_at, orders ( order_number, status )')
    .eq('retailer_id', retailerId);
  if (status) query = query.eq('status', status);

  const { data } = await applyCursor(applyKeysetOrder(query, ORDER), cursor, ORDER, PAGE_SIZE);
  const rows = (data ?? []) as unknown as TicketRow[];
  return toListBatch(rows, PAGE_SIZE, (row) => keysetCursorFor(row, ORDER));
}

function renderTicketCards(rows: TicketRow[]) {
  return rows.map((ticket) => {
    const TopicLabel = SUPPORT_TOPIC_LABELS[ticket.topic] ?? ticket.topic;
    return (
      <article
        key={ticket.id}
        className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:border-slate-300 hover:shadow-md"
      >
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/retailer/support/${ticket.id}`}
                className="font-mono text-xs font-bold text-slate-900 hover:text-primary-600"
              >
                {ticket.ticket_number}
              </Link>
              <span className={`rounded-full px-2.5 py-0.5 text-[9px] font-bold ring-1 ring-inset ${STATUS_STYLES[ticket.status]}`}>
                {SUPPORT_STATUS_LABELS[ticket.status]}
              </span>
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[9px] font-bold text-slate-500">
                {TopicLabel}
              </span>
              <span
                className={`rounded-full px-2.5 py-0.5 text-[9px] font-bold ring-1 ring-inset ${PRIORITY_STYLES[ticket.priority] ?? PRIORITY_STYLES.normal}`}
              >
                {SUPPORT_PRIORITY_LABELS[ticket.priority] ?? ticket.priority}
              </span>
            </div>
            <Link
              href={`/retailer/support/${ticket.id}`}
              className="mt-1.5 block truncate text-sm font-bold text-slate-900 hover:text-primary-600"
            >
              {ticket.subject}
            </Link>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500">
              <span>Opened {formatIndiaRelativeDateTime(ticket.created_at)}</span>
              {ticket.orders ? (
                <span className="inline-flex items-center gap-1">
                  <PackageSearch className="h-3 w-3" aria-hidden="true" />
                  Order <span className="font-mono font-semibold text-slate-600">{ticket.orders.order_number}</span>
                </span>
              ) : null}
            </p>
          </div>
          <Link
            href={`/retailer/support/${ticket.id}`}
            className="flex h-9 shrink-0 items-center gap-1 self-start rounded-lg bg-slate-950 px-3 text-[10px] font-bold text-white transition hover:bg-primary-700 sm:self-center"
          >
            View conversation <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
      </article>
    );
  });
}

export default async function RetailerSupportPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const user = await requireUser();
  const supabase = createClient();

  const status = SUPPORT_STATUSES.includes(searchParams.status as SupportStatus) ? (searchParams.status as SupportStatus) : '';

  const firstBatch = await loadTicketBatch(supabase, user.id, status, null);
  const tickets = firstBatch.items;

  /** Server Action for batches 2..n; the retailer id is re-derived server-side. */
  async function loadMoreTickets(cursor: string | null): Promise<InfiniteScrollBatch> {
    'use server';
    const caller = await requireUser();
    const batch = await loadTicketBatch(createClient(), caller.id, status, readCursor(cursor));
    return { rows: renderTicketCards(batch.items), nextCursor: batch.nextCursor };
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 sm:text-xs">
        <Link href="/retailer/home" className="hover:text-primary-600">
          Home
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-slate-800">Support</span>
      </div>

      <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-sky-50 px-4 py-5 shadow-sm sm:px-7 sm:py-7">
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div className="shop-intro">
          <p className="shop-eyebrow">Help centre</p>
            <h1 className="shop-heading mt-2 font-semibold tracking-tight text-slate-950">Support tickets</h1>
            <p className="mt-2 text-xs text-slate-600 sm:text-sm">
              Raise an issue, link an order, and follow every update in one place.
            </p>
          </div>
          <Link
            href="/retailer/support/new"
            className="flex h-10 items-center gap-2 rounded-xl bg-primary-600 px-4 text-xs font-bold text-white transition hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
          >
            <ListPlus className="h-4 w-4" aria-hidden="true" /> New ticket
          </Link>
        </div>
      </section>

      <div className="scrollbar-none flex gap-2 overflow-x-auto">
        {[{ value: '', label: 'All tickets' }, ...SUPPORT_STATUSES.map((s) => ({ value: s, label: SUPPORT_STATUS_LABELS[s] }))].map(
          (tab) => {
            const active = status === tab.value;
            return (
              <Link
                key={tab.value}
                href={supportHref(tab.value)}
                aria-current={active ? 'page' : undefined}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-[10px] font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 sm:text-[11px] ${
                  active
                    ? 'border-primary-600 bg-primary-600 text-white shadow-sm'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-primary-200 hover:text-primary-600'
                }`}
              >
                {tab.label}
              </Link>
            );
          }
        )}
      </div>

      {tickets.length === 0 ? (
        <section className="flex min-h-[320px] flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 text-center shadow-sm">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-slate-400">
            <Headset className="h-7 w-7" aria-hidden="true" />
          </span>
          <h2 className="mt-4 text-lg font-bold text-slate-800">
            {status ? `No ${SUPPORT_STATUS_LABELS[status].toLowerCase()} tickets` : 'No support tickets yet'}
          </h2>
          <p className="mt-2 max-w-sm text-xs leading-5 text-slate-500">
            {status
              ? 'Change the filter or raise a new ticket.'
              : 'Something not working with an order, payment, product or delivery? Raise a ticket and your distributor will respond here.'}
          </p>
          <Link
            href="/retailer/support/new"
            className="mt-5 flex h-10 items-center gap-2 rounded-xl bg-primary-600 px-5 text-xs font-bold text-white hover:bg-primary-700"
          >
            Raise your first ticket <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </section>
      ) : (
        <InfiniteScrollProvider
          loader={loadMoreTickets}
          initialCursor={firstBatch.nextCursor}
          initialHasMore={Boolean(firstBatch.nextCursor)}
          resetKey={status}
        >
          <div className="grid gap-3">
            <InfiniteScrollRows
              skeleton={
                <>
                  {[0, 1, 2].map((index) => (
                    <div
                      key={index}
                      aria-hidden="true"
                      className="h-28 animate-pulse rounded-2xl border border-slate-200 bg-slate-50"
                    />
                  ))}
                </>
              }
            >
              {renderTicketCards(tickets)}
            </InfiniteScrollRows>
          </div>

          <InfiniteScrollStatus endLabel="No more tickets" loadingLabel="Loading more tickets…" />
        </InfiniteScrollProvider>
      )}
    </div>
  );
}
