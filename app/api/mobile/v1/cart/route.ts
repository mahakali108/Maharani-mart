import {
  enforceRateLimit,
  jsonError,
  jsonOk,
  logServerError,
  newRequestId,
} from '@/lib/mobile';
import { requireRetailerCommerceSession } from '@/lib/mobile/commerce-route';
import { loadMobileCart } from '@/lib/mobile/commerce-service';

export const dynamic = 'force-dynamic';

/** GET /api/mobile/v1/cart — server-priced current basket. */
export async function GET(request: Request): Promise<Response> {
  const requestId = newRequestId();
  const auth = await requireRetailerCommerceSession(request, requestId, ['orders.create', 'orders.view.own']);
  if ('response' in auth) return auth.response;
  const limited = enforceRateLimit('read.orders', request, { requestId, keySuffix: auth.session.userId });
  if (limited) return limited;

  try {
    return jsonOk(await loadMobileCart(auth.session), { requestId });
  } catch (cause) {
    logServerError('cart.read', requestId, cause);
    return jsonError('database_unavailable', 'Your cart could not be loaded. Please try again.', {
      status: 503,
      requestId,
    });
  }
}
