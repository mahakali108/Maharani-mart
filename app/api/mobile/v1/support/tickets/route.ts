import { randomInt } from 'node:crypto';
import { z } from 'zod';
import {
  applyCursor,
  applyKeysetOrder,
  keysetCursorFor,
  readContinuation,
  toListBatch,
} from '@/lib/infinite-scroll/keyset';
import {
  enforceRateLimit,
  jsonError,
  jsonOk,
  jsonOkPage,
  logServerError,
  newRequestId,
  parseJsonBody,
} from '@/lib/mobile';
import { requireRetailerCommerceSession } from '@/lib/mobile/commerce-route';
import { indiaTodayDateKey } from '@/lib/datetime/india';
import { SUPPORT_PRIORITIES, SUPPORT_STATUSES, SUPPORT_TOPICS, generateTicketNumber } from '@/lib/retailer/support';
import type { SupportPriority, SupportStatus, SupportTopic } from '@/lib/retailer/support';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;
const ORDER = [
  { column: 'created_at', ascending: false },
  { column: 'id', ascending: false },
] as const;
const topicSchema = z.string().refine((value): value is SupportTopic => SUPPORT_TOPICS.includes(value as SupportTopic));
const prioritySchema = z.string().refine((value): value is SupportPriority => SUPPORT_PRIORITIES.includes(value as SupportPriority));
const statusSchema = z.string().refine((value): value is SupportStatus => SUPPORT_STATUSES.includes(value as SupportStatus));

const createTicketSchema = z.object({
  subject: z.string().trim().min(10).max(120).regex(/^[A-Za-z0-9 .,!?'&()/-]+$/),
  topic: topicSchema,
  priority: prioritySchema,
  orderId: z.string().uuid().nullable().default(null),
  description: z.string().trim().min(10).max(3000),
}).strict();

const querySchema = z.object({ cursor: z.string().nullable().default(null), status: statusSchema.nullable().default(null) }).strict();

type TicketListRow = {
  id: string;
  ticket_number: string;
  subject: string;
  topic: string;
  priority: string;
  status: string;
  created_at: string;
  updated_at: string;
  orders: { order_number: string; status: string } | null;
};

function ticketSuffix(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join('');
}

/** GET paginated caller-owned tickets; POST creates a ticket plus its first message. */
export async function GET(request: Request): Promise<Response> {
  const requestId = newRequestId();
  const auth = await requireRetailerCommerceSession(request, requestId, 'orders.view.own');
  if ('response' in auth) return auth.response;
  const limited = enforceRateLimit('read.orders', request, { requestId, keySuffix: auth.session.userId });
  if (limited) return limited;

  const url = new URL(request.url);
  const rawStatus = url.searchParams.get('status');
  const parsed = querySchema.safeParse({ cursor: url.searchParams.get('cursor'), status: rawStatus });
  if (!parsed.success) return jsonError('invalid_request', 'Invalid query parameters.', { status: 400, requestId });
  const continuation = readContinuation(parsed.data.cursor);
  if (!continuation.ok) return jsonError('invalid_request', 'The list cursor is invalid. Refresh the ticket list.', { status: 400, requestId });

  try {
    let query = auth.session.supabase.from('support_tickets')
      .select('id, ticket_number, subject, topic, priority, status, created_at, updated_at, orders ( order_number, status )')
      .eq('retailer_id', auth.session.userId);
    if (parsed.data.status) query = query.eq('status', parsed.data.status);
    const { data, error } = await applyCursor(applyKeysetOrder(query, [...ORDER]), continuation.cursor, [...ORDER], PAGE_SIZE);
    if (error) throw error;
    const page = toListBatch((data ?? []) as unknown as TicketListRow[], PAGE_SIZE, (row) => keysetCursorFor(row, [...ORDER]));
    return jsonOkPage(page.items.map((ticket) => ({
      id: ticket.id,
      ticketNumber: ticket.ticket_number,
      subject: ticket.subject,
      topic: ticket.topic,
      priority: ticket.priority,
      status: ticket.status,
      createdAt: ticket.created_at,
      updatedAt: ticket.updated_at,
      orderNumber: ticket.orders?.order_number ?? null,
      orderStatus: ticket.orders?.status ?? null,
    })), { nextCursor: page.nextCursor, hasMore: page.nextCursor !== null, limit: PAGE_SIZE }, { requestId });
  } catch (cause) {
    logServerError('support.tickets.list', requestId, cause);
    return jsonError('database_unavailable', 'Support tickets could not be loaded. Please try again.', { status: 503, requestId });
  }
}

export async function POST(request: Request): Promise<Response> {
  const requestId = newRequestId();
  const auth = await requireRetailerCommerceSession(request, requestId, 'orders.create');
  if ('response' in auth) return auth.response;
  const limited = enforceRateLimit('write.orders', request, { requestId, keySuffix: auth.session.userId });
  if (limited) return limited;
  const body = await parseJsonBody(request, createTicketSchema, requestId);
  if (!body.ok) return body.response;

  const supabase = auth.session.supabase;
  if (body.data.orderId) {
    const { data: order, error } = await supabase.from('orders')
      .select('id')
      .eq('id', body.data.orderId)
      .eq('retailer_id', auth.session.userId)
      .maybeSingle<{ id: string }>();
    if (error) {
      logServerError('support.ticket.order-check', requestId, error);
      return jsonError('database_unavailable', 'The linked order could not be checked. Please try again.', { status: 503, requestId });
    }
    if (!order) return jsonError('not_found', 'The selected order could not be found.', { status: 404, requestId });
  }

  try {
    let created: { id: string; ticket_number: string } | null = null;
    for (let attempt = 0; attempt < 3 && !created; attempt += 1) {
      const ticketNumber = generateTicketNumber(indiaTodayDateKey(), ticketSuffix());
      const result = await supabase.from('support_tickets').insert({
        ticket_number: ticketNumber,
        retailer_id: auth.session.userId,
        subject: body.data.subject,
        topic: body.data.topic,
        priority: body.data.priority,
        order_id: body.data.orderId,
        status: 'open',
      } as unknown as never).select('id, ticket_number').maybeSingle<{ id: string; ticket_number: string }>();
      if (result.error?.code === '23505') continue;
      if (result.error || !result.data) throw result.error ?? new Error('Missing ticket row.');
      created = result.data;
    }
    if (!created) return jsonError('conflict', 'A ticket number could not be assigned. Please try again.', { status: 409, requestId });

    const { error: messageError } = await supabase.from('support_ticket_messages').insert({
      ticket_id: created.id,
      author_id: auth.session.userId,
      author_role: 'retailer',
      body: body.data.description,
    } as unknown as never);
    if (messageError) throw messageError;

    return jsonOk({ id: created.id, ticketNumber: created.ticket_number }, { requestId });
  } catch (cause) {
    logServerError('support.tickets.create', requestId, cause);
    return jsonError('database_unavailable', 'The ticket could not be created. Please try again.', { status: 503, requestId });
  }
}
