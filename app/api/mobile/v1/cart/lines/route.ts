import { z } from 'zod';
import { addCartLines } from '@/lib/retailer/cart-service';
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

const addLineSchema = z.object({
  packId: z.string().uuid(),
  quantity: z.number().int().min(1).max(100000),
}).strict();

function quantityFailure(message: string, requestId: string): Response {
  const minimum = /minimum[ _]order[ _]quantity.*?(\d+)/i.exec(message)?.[1];
  if (minimum) {
    return jsonError('minimum_order_quantity', message, {
      status: 422,
      details: { minQuantity: Number(minimum) },
      requestId,
    });
  }
  if (/no longer exists|currently unavailable/i.test(message)) {
    return jsonError('not_found', message, { status: 404, requestId });
  }
  if (/cart changed in another request/i.test(message)) {
    return jsonError('conflict', message, { status: 409, requestId });
  }
  return jsonError('invalid_request', message, { status: 422, requestId });
}

/** POST /api/mobile/v1/cart/lines — add a validated piece quantity. */
export async function POST(request: Request): Promise<Response> {
  const requestId = newRequestId();
  const auth = await requireRetailerCommerceSession(request, requestId, ['orders.create', 'orders.view.own']);
  if ('response' in auth) return auth.response;
  const limited = enforceRateLimit('write.cart', request, { requestId, keySuffix: auth.session.userId });
  if (limited) return limited;

  const parsed = await parseJsonBody(request, addLineSchema, requestId);
  if (!parsed.ok) return parsed.response;

  try {
    const client = auth.session.supabase as unknown as ReturnType<typeof createClient>;
    const result = await addCartLines(client, auth.session.userId, [
      { packId: parsed.data.packId, quantity: parsed.data.quantity },
    ]);
    if ('error' in result) return quantityFailure(result.error, requestId);
    return jsonOk(await loadMobileCart(auth.session), { requestId });
  } catch (cause) {
    logServerError('cart.add', requestId, cause);
    return jsonError('database_unavailable', 'The cart could not be updated. Please try again.', {
      status: 503,
      requestId,
    });
  }
}
