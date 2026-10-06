import { z } from 'zod';
import {
  enforceRateLimit,
  jsonError,
  jsonOk,
  logServerError,
  newRequestId,
  parseJsonBody,
} from '@/lib/mobile';
import { requireRetailerCommerceSession } from '@/lib/mobile/commerce-route';
import { isTicketOpen, type SupportStatus } from '@/lib/retailer/support';

export const dynamic = 'force-dynamic';

const messageSchema = z.object({ body: z.string().trim().min(5).max(3000) }).strict();
const uuidSchema = z.string().uuid();

type TicketRow = {
  id: string;
  ticket_number: string;
  subject: string;
  topic: string;
  priority: string;
  status: SupportStatus;
  order_id: string | null;
  created_at: string;
  updated_at: string;
  orders: { order_number: string; status: string } | null;
};

type MessageRow = {
  id: string;
  author_id: string;
  author_role: string;
  body: string;
  created_at: string;
};

/** GET one caller-owned ticket and its append-only conversation. */
export async function GET(request: Request, context: { params: { id: string } }): Promise<Response> {
  const requestId = newRequestId();
  const auth = await requireRetailerCommerceSession(request, requestId, 'orders.view.own');
  if ('response' in auth) return auth.response;
  const limited = enforceRateLimit('read.orders', request, { requestId, keySuffix: auth.session.userId });
  if (limited) return limited;
  if (!uuidSchema.safeParse(context.params.id).success) {
    return jsonError('invalid_request', 'Ticket id is invalid.', { status: 400, requestId });
  }

  try {
    const { data: ticket, error } = await auth.session.supabase.from('support_tickets')
      .select('id, ticket_number, subject, topic, priority, status, order_id, created_at, updated_at, orders ( order_number, status )')
      .eq('id', context.params.id)
      .eq('retailer_id', auth.session.userId)
      .maybeSingle<TicketRow>();
    if (error) throw error;
    if (!ticket) return jsonError('not_found', 'Ticket not found.', { status: 404, requestId });

    // Ticket ownership is checked before reading child messages, avoiding a
    // foreign-id side channel even if a policy is accidentally broadened.
    const { data: messages, error: messageError } = await auth.session.supabase.from('support_ticket_messages')
      .select('id, author_id, author_role, body, created_at')
      .eq('ticket_id', ticket.id)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .returns<MessageRow[]>();
    if (messageError) throw messageError;

    return jsonOk({
      id: ticket.id,
      ticketNumber: ticket.ticket_number,
      subject: ticket.subject,
      topic: ticket.topic,
      priority: ticket.priority,
      status: ticket.status,
      orderId: ticket.order_id,
      orderNumber: ticket.orders?.order_number ?? null,
      orderStatus: ticket.orders?.status ?? null,
      createdAt: ticket.created_at,
      updatedAt: ticket.updated_at,
      canReply: isTicketOpen(ticket.status),
      messages: (messages ?? []).map((message) => ({
        id: message.id,
        authorRole: message.author_role,
        body: message.body,
        createdAt: message.created_at,
        isOwn: message.author_id === auth.session.userId,
      })),
    }, { requestId });
  } catch (cause) {
    logServerError('support.ticket.detail', requestId, cause);
    return jsonError('database_unavailable', 'The ticket could not be loaded. Please try again.', { status: 503, requestId });
  }
}

/** Append a message only while the caller's own ticket remains actionable. */
export async function POST(request: Request, context: { params: { id: string } }): Promise<Response> {
  const requestId = newRequestId();
  const auth = await requireRetailerCommerceSession(request, requestId, 'orders.create');
  if ('response' in auth) return auth.response;
  const limited = enforceRateLimit('write.orders', request, { requestId, keySuffix: auth.session.userId });
  if (limited) return limited;
  if (!uuidSchema.safeParse(context.params.id).success) {
    return jsonError('invalid_request', 'Ticket id is invalid.', { status: 400, requestId });
  }
  const body = await parseJsonBody(request, messageSchema, requestId);
  if (!body.ok) return body.response;

  try {
    const { data: ticket, error: ticketError } = await auth.session.supabase.from('support_tickets')
      .select('id, status')
      .eq('id', context.params.id)
      .eq('retailer_id', auth.session.userId)
      .maybeSingle<{ id: string; status: SupportStatus }>();
    if (ticketError) throw ticketError;
    if (!ticket) return jsonError('not_found', 'Ticket not found.', { status: 404, requestId });
    if (!isTicketOpen(ticket.status)) {
      return jsonError('conflict', 'This ticket is closed for replies. Raise a new ticket if you need more help.', {
        status: 409,
        requestId,
      });
    }

    const { data, error } = await auth.session.supabase.from('support_ticket_messages').insert({
      ticket_id: ticket.id,
      author_id: auth.session.userId,
      author_role: 'retailer',
      body: body.data.body,
    } as unknown as never).select('id, author_role, body, created_at').maybeSingle<MessageRow>();
    if (error || !data) throw error ?? new Error('Missing message row.');
    return jsonOk({
      id: data.id,
      authorRole: data.author_role,
      body: data.body,
      createdAt: data.created_at,
      isOwn: true,
    }, { requestId });
  } catch (cause) {
    logServerError('support.ticket.reply', requestId, cause);
    return jsonError('database_unavailable', 'Your reply could not be sent. Please try again.', { status: 503, requestId });
  }
}
