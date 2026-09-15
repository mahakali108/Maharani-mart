import Link from 'next/link';
import { ChevronLeft, ChevronRight, Headset, ListPlus, PackageSearch } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { formatIndiaRelativeDateTime } from '@/lib/datetime/india';
import {
  SUPPORT_STATUSES,
  SUPPORT_STATUS_LABELS,
  SUPPORT_TOPIC_LABELS,
  type SupportStatus,
  type SupportTopic,
} from '@/lib/retailer/support';

const PAGE_SIZE = 20;

const STATUS_STYLES: Record<SupportStatus, string> = {
  open: 'bg-amber-50 text-amber-700 ring-amber-200',
  in_progress: 'bg-blue-50 text-blue-700 ring-blue-200',
  resolved: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  closed: 'bg-slate-100 text-slate-600 ring-slate-200',
};

interface TicketRow {
  id: string;
  ticket_number: string;
  subject: string;
  topic: SupportTopic;
  status: SupportStatus;
  created_at: string;
  updated_at: string;
  orders: { order_number: string; status: string } | null;
}

function supportHref(status: string, page: number): string {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (page > 1) params.set('page', String(page));
  const query = params.toString();
  return `/retailer/support${query ? `?${query}` : ''}`;
}

export default async function RetailerSupportPage({
  searchParams,
}: {
  searchParams: { status?: string; page?: string };
}) {
  const user = await requireUser();
  const supabase = createClient();

  const status = SUPPORT_STATUSES.includes(searchParams.status as SupportStatus) ? (searchParams.status as SupportStatus) : '';
  const page = Math.max(1, Number(searchParams.page) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = supabase
    .from('support_tickets')
    .select('id, ticket_number, subject, topic, status, created_at, updated_at, orders ( order_number, status )', {
      count: 'exact',
    })
    .eq('retailer_id', user.id)
    .order('created_at', { ascending: false })
    .range(from, to);
  if (status) query = query.eq('status', status);

  const { data, count } = await query;
  const tickets = (data ?? []) as unknown as TicketRow[];
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 sm:text-xs">
        <Link href="/retailer/home" className="hover:text-primary-600">
          Home
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-slate-800">Support</span>
      </div>

      <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-primary-50 via-white to-rose-50/50 px-4 py-5 shadow-sm sm:px-7 sm:py-7">
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-600">Help centre</p>
            <h1 className="mt-2 text-xl font-bold tracking-tight text-slate-950 sm:text-2xl">Support tickets</h1>
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
                href={supportHref(tab.value, 1)}
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
        <div className="grid gap-3">
          {tickets.map((ticket) => {
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
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[9px] font-bold ring-1 ring-inset ${STATUS_STYLES[ticket.status]}`}
                      >
                        {SUPPORT_STATUS_LABELS[ticket.status]}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[9px] font-bold text-slate-500">
                        {TopicLabel}
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
          })}
        </div>
      )}

      {totalPages > 1 ? (
        <nav className="flex items-center justify-center gap-3 pt-2" aria-label="Support ticket pages">
          {page > 1 ? (
            <Link
              href={supportHref(status, page - 1)}
              className="flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-[10px] font-bold text-slate-700 hover:border-primary-200 hover:text-primary-600"
            >
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" /> Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-[10px] font-semibold text-slate-500">
            Page {page} of {totalPages}
          </span>
          {page < totalPages ? (
            <Link
              href={supportHref(status, page + 1)}
              className="flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-[10px] font-bold text-slate-700 hover:border-primary-200 hover:text-primary-600"
            >
              Next <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}
