import { z } from 'zod';
import { removeCartLine, updateCartLine } from '@/lib/retailer/cart-service';
import { createClient } from '@/lib/supabase/server';
import {
  enforceRateLimit,
  jsonError,
  jsonOk,
  logServerError,
  newRequestId,
  parseJsonBody,
} from '@/lib/mobile';
import { requireRetailerCommerceSession } from '@/lib/mobile/commerce-route';
import { loadMobileCart } from '@/lib/mobile/commerce-service';

export const dynamic = 'force-dynamic';

const updateSchema = z.object({
  quantity: z.number().int().min(1).max(100000),
}).strict();

function mapQuantityError(message: string, requestId: string): Response {
  const minimum = /minimum[ _]order[ _]quantity.*?(\d+)/i.exec(message)?.[1];
  if (minimum) {
    return jsonError('minimum_order_quantity', message, {
      status: 422,
      details: { minQuantity: Number(minimum) },
      requestId,
    });
  }
  if (/not found/i.test(message)) return jsonError('not_found', message, { status: 404, requestId });
  if (/cart changed in another request/i.test(message)) {
    return jsonError('conflict', message, { status: 409, requestId });
  }
  return jsonError('invalid_request', message, { status: 422, requestId });
}

export async function PATCH(
  request: Request,
  { params: paramsPromise }: { params: Promise<{ lineId: string }> }
): Promise<Response> {
  const params = await paramsPromise;
  const requestId = newRequestId();
  const auth = await requireRetailerCommerceSession(request, requestId, ['orders.create', 'orders.view.own']);
  if ('response' in auth) return auth.response;
  const limited = enforceRateLimit('write.cart', request, { requestId, keySuffix: auth.session.userId });
  if (limited) return limited;
  if (!z.string().uuid().safeParse(params.lineId).success) {
    return jsonError('not_found', 'The cart item was not found.', { status: 404, requestId });
  }

  const parsed = await parseJsonBody(request, updateSchema, requestId);
  if (!parsed.ok) return parsed.response;
  try {
    const client = auth.session.supabase as unknown as Awaited<ReturnType<typeof createClient>>;
    const result = await updateCartLine(client, auth.session.userId, params.lineId, parsed.data.quantity);
    if ('error' in result) return mapQuantityError(result.error, requestId);
    return jsonOk(await loadMobileCart(auth.session), { requestId });
  } catch (cause) {
    logServerError('cart.update', requestId, cause);
    return jsonError('database_unavailable', 'The cart could not be updated. Please try again.', {
      status: 503,
      requestId,
    });
  }
}

export async function DELETE(
  request: Request,
  { params: paramsPromise }: { params: Promise<{ lineId: string }> }
): Promise<Response> {
  const params = await paramsPromise;
  const requestId = newRequestId();
  const auth = await requireRetailerCommerceSession(request, requestId, ['orders.create', 'orders.view.own']);
  if ('response' in auth) return auth.response;
  const limited = enforceRateLimit('write.cart', request, { requestId, keySuffix: auth.session.userId });
  if (limited) return limited;
  if (!z.string().uuid().safeParse(params.lineId).success) {
    return jsonError('not_found', 'The cart item was not found.', { status: 404, requestId });
  }

  try {
    const client = auth.session.supabase as unknown as Awaited<ReturnType<typeof createClient>>;
    const result = await removeCartLine(client, auth.session.userId, params.lineId);
    if ('error' in result) return mapQuantityError(result.error, requestId);
    return jsonOk(await loadMobileCart(auth.session), { requestId });
  } catch (cause) {
    logServerError('cart.remove', requestId, cause);
    return jsonError('database_unavailable', 'The cart item could not be removed. Please try again.', {
      status: 503,
      requestId,
    });
  }
}
