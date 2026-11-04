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
import { isReturnWindowOpen } from '@/lib/delivery/return-window';

export const dynamic = 'force-dynamic';

const uuidSchema = z.string().uuid();
const bodySchema = z.object({ reason: z.string().trim().min(1).max(1000) }).strict();

/** Request a return for the caller's delivered order, within its server-owned deadline. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const requestId = newRequestId();
  const auth = await requireRetailerCommerceSession(request, requestId, 'orders.return.request');
  if ('response' in auth) return auth.response;
  const limited = enforceRateLimit('write.orders', request, { requestId, keySuffix: auth.session.userId });
  if (limited) return limited;
  if (!uuidSchema.safeParse((await context.params).id).success) {
    return jsonError('invalid_request', 'Order id is invalid.', { status: 400, requestId });
  }
  const body = await parseJsonBody(request, bodySchema, requestId);
  if (!body.ok) return body.response;

  const supabase = auth.session.supabase;
  try {
    const { data: order, error: orderError } = await supabase.from('orders')
      .select('id, status')
      .eq('id', (await context.params).id)
      .eq('retailer_id', auth.session.userId)
      .maybeSingle<{ id: string; status: string }>();
    if (orderError) throw orderError;
    if (!order) return jsonError('not_found', 'Order not found.', { status: 404, requestId });
    if (order.status !== 'delivered') {
      return jsonError('conflict', 'A return can only be requested for a delivered order.', { status: 409, requestId });
    }

    const { data: delivery, error: deliveryError } = await supabase.from('order_deliveries')
      .select('return_deadline')
      .eq('order_id', order.id)
      .maybeSingle<{ return_deadline: string | null }>();
    if (deliveryError) throw deliveryError;
    if (delivery?.return_deadline && !isReturnWindowOpen(delivery.return_deadline)) {
      return jsonError('conflict', `The return window closed on ${delivery.return_deadline}. Contact support if something is wrong.`, {
        status: 409,
        requestId,
      });
    }

    const { data, error } = await supabase.from('return_requests').insert({
      order_id: order.id,
      order_item_id: null,
      retailer_id: auth.session.userId,
      reason: body.data.reason,
    } as unknown as never).select('id').maybeSingle<{ id: string }>();
    if (error) throw error;
    if (!data) throw new Error('Missing return request row.');
    // Retailer-side RLS deliberately cannot create notifications for arbitrary
    // staff recipients. The request itself is durable and staff-visible in the
    // existing return queue; no privileged notification write is attempted.
    return jsonOk({ id: data.id, status: 'requested' }, { requestId });
  } catch (cause) {
    logServerError('orders.return.request', requestId, cause);
    return jsonError('database_unavailable', 'The return request could not be submitted. Please try again.', { status: 503, requestId });
  }
}
