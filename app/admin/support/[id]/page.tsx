import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft, Headset, PackageSearch, UserRound } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { TicketActionsForm } from '@/components/admin/ticket-actions-form';
import { formatIndiaDateTime, formatIndiaRelativeDateTime } from '@/lib/datetime/india';
import { formatInr } from '@/lib/retailer/format';
import {
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
  resolved_at: string | null;
  closed_at: string | null;
  retailers: { shop_name: string; gstin: string | null; address: string | null; profiles: { phone: string } | null } | null;
  orders: { id: string; order_number: string; status: string; grand_total: number; placed_at: string } | null;
}

interface MessageRow {
  id: string;
  author_id: string;
  author_role: string;
  body: string;
  created_at: string;
}

export default async function AdminSupportTicketPage({ params }: { params: { id: string } }) {
  const supabase = createClient();

  const { data: ticket } = await supabase
    .from('support_tickets')
    .select(
      'id, ticket_number, subject, topic, status, created_at, updated_at, resolved_at, closed_at, ' +
        'retailers ( shop_name, gstin, address, profiles ( phone ) ), ' +
        'orders ( id, order_number, status, grand_total, placed_at )'
    )
    .eq('id', params.id)
    .maybeSingle<TicketRow>();

  if (!ticket) notFound();

  const [{ data: messageData }, { data: authorData }] = await (async () => {
    const messageQuery = supabase
      .from('support_ticket_messages')
      .select('id, author_id, author_role, body, created_at')
      .eq('ticket_id', ticket.id)
      .order('created_at', { ascending: true })
      .limit(300);
    const messages = await messageQuery;
    const authorIds = [...new Set((messages.data ?? []).map((row) => (row as { author_id: string }).author_id))];
    const authors = authorIds.length > 0
      ? await supabase.from('profiles').select('id, full_name').in('id', authorIds)
      : { data: [] };
    return [messages, authors] as const;
  })();

  const messages = (messageData ?? []) as unknown as MessageRow[];
  const authorNames = new Map<string, string>(
    ((authorData ?? []) as { id: string; full_name: string }[]).map((row) => [row.id, row.full_name])
  );

  const isRetailerMessage = (message: MessageRow) => message.author_role === 'retailer';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href="/admin/support"
          className="inline-flex items-center gap-1 rounded-lg bg-ink-50 px-3 py-1.5 text-xs font-semibold text-ink-600 hover:bg-ink-100"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> All tickets
        </Link>
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${STATUS_STYLES[ticket.status]}`}>
          {SUPPORT_STATUS_LABELS[ticket.status]}
        </span>
        <span className="rounded-full bg-ink-100 px-2.5 py-1 text-[10px] font-bold text-ink-500">
          {SUPPORT_TOPIC_LABELS[ticket.topic] ?? ticket.topic}
        </span>
        <span className="font-mono text-xs font-semibold text-ink-400">{ticket.ticket_number}</span>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <Card className="p-4">
            <h1 className="break-words text-lg font-semibold text-ink-950">{ticket.subject}</h1>
            <p className="mt-1 text-xs text-ink-500">
              Opened {formatIndiaDateTime(ticket.created_at)} · Updated {formatIndiaRelativeDateTime(ticket.updated_at)}
              {ticket.resolved_at ? ` · Resolved ${formatIndiaDateTime(ticket.resolved_at)}` : ''}
              {ticket.closed_at ? ` · Closed ${formatIndiaDateTime(ticket.closed_at)}` : ''}
            </p>
          </Card>

          {messages.length === 0 ? (
            <AdminEmptyState
              icon={Headset}
              title="No messages yet"
              body="The first message the retailer sent should appear here. If it is missing, the ticket creation partially failed — check the audit log."
            />
          ) : (
            <div className="space-y-3">
              {messages.map((message) => (
                <Card
                  key={message.id}
                  className={`p-4 ${isRetailerMessage(message) ? '' : 'border-primary-100 bg-primary-50/30'}`}
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`flex h-8 w-8 items-center justify-center rounded-full ${
                        isRetailerMessage(message) ? 'bg-ink-100 text-ink-500' : 'bg-primary-600 text-white'
                      }`}
                    >
                      <UserRound className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink-900">
                        {authorNames.get(message.author_id) ?? 'Unknown user'}
                        <span className="ml-2 rounded-full bg-ink-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-ink-500">
                          {message.author_role}
                        </span>
                      </p>
                      <p className="text-[10px] text-ink-400">{formatIndiaDateTime(message.created_at)}</p>
                    </div>
                  </div>
                  <p className="mt-2.5 whitespace-pre-wrap break-words text-sm leading-6 text-ink-700">{message.body}</p>
                </Card>
              ))}
            </div>
          )}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24">
          {ticket.retailers ? (
            <Card className="p-4">
              <h2 className="text-sm font-semibold text-ink-900">Retailer</h2>
              <p className="mt-2 break-words text-sm font-medium text-ink-900">{ticket.retailers.shop_name}</p>
              <dl className="mt-2 space-y-1.5 text-xs text-ink-600">
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-400">Phone</dt>
                  <dd className="truncate">{ticket.retailers.profiles?.phone ?? '—'}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-400">GSTIN</dt>
                  <dd className="truncate font-mono">{ticket.retailers.gstin ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-ink-400">Address</dt>
                  <dd className="mt-0.5 break-words">{ticket.retailers.address ?? '—'}</dd>
                </div>
              </dl>
            </Card>
          ) : null}

          {ticket.orders ? (
            <Card className="p-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-900">
                <PackageSearch className="h-4 w-4 text-ink-400" /> Linked order
              </h2>
              <p className="mt-2 break-all font-mono text-sm font-semibold text-ink-900">
                <Link href={`/admin/orders/${ticket.orders.id}`} className="hover:text-primary-600">
                  {ticket.orders.order_number}
                </Link>
              </p>
              <p className="mt-1 text-xs text-ink-500">
                {ticket.orders.status} · {formatInr(ticket.orders.grand_total)} · placed {formatIndiaDateTime(ticket.orders.placed_at)}
              </p>
            </Card>
          ) : null}

          <TicketActionsForm
            ticketId={ticket.id}
            status={ticket.status}
            allowReopen={ticket.status === 'resolved'}
          />
        </aside>
      </div>
    </div>
  );
}
