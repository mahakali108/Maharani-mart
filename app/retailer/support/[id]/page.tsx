import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CheckCircle2, ChevronLeft, ChevronRight, Clock3, Lock, PackageSearch, UserRound } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { formatIndiaRelativeDateTime } from '@/lib/datetime/india';
import { formatInr } from '@/lib/retailer/format';
import { SupportReplyForm } from '@/components/retailer/support-reply-form';
import {
  SUPPORT_STATUS_LABELS,
  SUPPORT_TOPIC_LABELS,
  isTicketOpen,
  type SupportStatus,
  type SupportTopic,
} from '@/lib/retailer/support';

const STATUS_STYLES: Record<SupportStatus, string> = {
  open: 'bg-amber-50 text-amber-700 ring-amber-200',
  in_progress: 'bg-blue-50 text-blue-700 ring-blue-200',
  resolved: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  closed: 'bg-slate-100 text-slate-600 ring-slate-200',
};

const ORDER_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending confirmation',
  confirmed: 'Confirmed',
  processing: 'Processing',
  packed: 'Packed',
  dispatched: 'On the way',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  returned: 'Returned',
};

interface TicketRow {
  id: string;
  ticket_number: string;
  subject: string;
  topic: SupportTopic;
  status: SupportStatus;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  author_id: string;
  author_role: string;
  body: string;
  created_at: string;
}

interface LinkedOrderRow {
  id: string;
  order_number: string;
  status: string;
  grand_total: number;
  placed_at: string;
}

export default async function SupportTicketDetailPage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  const supabase = createClient();

  // Ownership is enforced twice: the query itself (retailer_id = caller) and
  // RLS (0048) — a ticket id from another retailer resolves to notFound().
  const { data: ticket } = await supabase
    .from('support_tickets')
    .select('id, ticket_number, subject, topic, status, created_at, updated_at')
    .eq('id', params.id)
    .eq('retailer_id', user.id)
    .maybeSingle<TicketRow>();

  if (!ticket) notFound();

  const [{ data: messageData }, { data: ticketWithOrder }] = await Promise.all([
    supabase
      .from('support_ticket_messages')
      .select('id, author_id, author_role, body, created_at')
      .eq('ticket_id', ticket.id)
      .order('created_at', { ascending: true })
      .limit(200),
    supabase
      .from('support_tickets')
      .select('orders ( id, order_number, status, grand_total, placed_at )')
      .eq('id', ticket.id)
      .maybeSingle<{ orders: LinkedOrderRow | null }>(),
  ]);

  const messages = ((messageData ?? []) as unknown as MessageRow[]);
  const linkedOrder: LinkedOrderRow | null = ticketWithOrder?.orders ?? null;

  const authorIds = [...new Set(messages.map((message) => message.author_id).filter((id) => id !== user.id))];
  const { data: authors } = authorIds.length > 0
    ? await supabase.from('profiles').select('id, full_name').in('id', authorIds)
    : { data: [] };
  const authorNames = new Map<string, string>((authors ?? []).map((row: { id: string; full_name: string }) => [row.id, row.full_name]));

  const open = isTicketOpen(ticket.status);

  return (
    <div className="mx-auto max-w-3xl space-y-5 sm:space-y-6">
      <nav className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 sm:text-xs" aria-label="Breadcrumb">
        <Link href="/retailer/support" className="flex items-center gap-1 hover:text-primary-600">
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" /> Support
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="font-mono text-slate-800">{ticket.ticket_number}</span>
      </nav>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-[9px] font-bold ring-1 ring-inset ${STATUS_STYLES[ticket.status]}`}>
              {SUPPORT_STATUS_LABELS[ticket.status]}
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[9px] font-bold text-slate-500">
              {SUPPORT_TOPIC_LABELS[ticket.topic] ?? ticket.topic}
            </span>
            <span className="font-mono text-[10px] font-bold text-slate-400">{ticket.ticket_number}</span>
          </div>
          <h1 className="mt-3 break-words text-lg font-bold tracking-tight text-slate-950 sm:text-xl">{ticket.subject}</h1>
          <p className="mt-1.5 text-[10px] text-slate-500">
            Opened {formatIndiaRelativeDateTime(ticket.created_at)} · Updated {formatIndiaRelativeDateTime(ticket.updated_at)}
          </p>
        </div>

        {linkedOrder ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/60 px-4 py-3 sm:px-5">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
                <PackageSearch className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <Link
                  href={`/retailer/orders/${linkedOrder.id}`}
                  className="truncate font-mono text-xs font-bold text-slate-900 hover:text-primary-600"
                >
                  {linkedOrder.order_number}
                </Link>
                <p className="text-[10px] text-slate-500">
                  {ORDER_STATUS_LABELS[linkedOrder.status] ?? linkedOrder.status} · {formatInr(linkedOrder.grand_total)} ·
                  placed {formatIndiaRelativeDateTime(linkedOrder.placed_at)}
                </p>
              </div>
            </div>
            <Link
              href={`/retailer/orders/${linkedOrder.id}`}
              className="flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-[10px] font-bold text-slate-700 hover:border-primary-200 hover:text-primary-600"
            >
              View order
            </Link>
          </div>
        ) : null}
      </section>

      <section className="space-y-3">
        {messages.map((message) => {
          const isMine = message.author_id === user.id;
          const name = isMine ? 'You' : (authorNames.get(message.author_id) ?? 'Support');
          const isDistributor = !isMine;
          return (
            <article
              key={message.id}
              className={`rounded-2xl border p-4 shadow-sm ${
                isDistributor ? 'border-primary-100 bg-primary-50/40' : 'border-slate-200 bg-white'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                    isDistributor ? 'bg-primary-600 text-white' : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  <UserRound className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-bold text-slate-900">
                    {name}
                    {isDistributor ? <span className="ml-1.5 rounded-full bg-primary-100 px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider text-primary-700">Distributor</span> : null}
                  </p>
                  <p className="text-[9px] text-slate-400">{formatIndiaRelativeDateTime(message.created_at)}</p>
                </div>
              </div>
              <p className="mt-2.5 whitespace-pre-wrap break-words text-xs leading-5 text-slate-700">{message.body}</p>
            </article>
          );
        })}
      </section>

      {open ? (
        <SupportReplyForm ticketId={ticket.id} />
      ) : (
        <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
          {ticket.status === 'resolved' ? (
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
          ) : (
            <Lock className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
          )}
          <div>
            <p className="text-xs font-bold text-slate-800">
              {ticket.status === 'resolved' ? 'This ticket is resolved' : 'This ticket is closed'}
            </p>
            <p className="mt-1 text-[11px] leading-4 text-slate-500">
              {ticket.status === 'resolved'
                ? 'If something is still not right, raise a new ticket and reference this number — the distributor keeps the full history.'
                : 'No further replies can be added. Raise a new ticket for any fresh issue.'}
            </p>
            <Link
              href="/retailer/support/new"
              className="mt-2.5 inline-flex h-8 items-center gap-1 rounded-lg bg-primary-600 px-3 text-[10px] font-bold text-white hover:bg-primary-700"
            >
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /> Raise a new ticket
            </Link>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 text-[10px] text-slate-400">
        <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
        Ticket numbers are unique — quote {ticket.ticket_number} if you contact us by phone.
      </div>
    </div>
  );
}
