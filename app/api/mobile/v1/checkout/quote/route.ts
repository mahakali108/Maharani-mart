import { z } from 'zod';
import {
  enforceRateLimit,
  jsonError,
  jsonOk,
  logServerError,
  newRequestId,
  parseJsonBody,
} from '@/lib/mobile';
import { requireRetailerCommerceSession, mobileCommerceErrorResponse } from '@/lib/mobile/commerce-route';
import { isValidCartRequest, quoteMobileCheckout } from '@/lib/mobile/commerce-service';

export const dynamic = 'force-dynamic';

const quoteSchema = z.object({
  lines: z.array(z.object({ packId: z.string().uuid(), quantity: z.number().int().min(1).max(100000) }).strict()).min(1).max(200),
  // Older clients may omit this field; they receive a clear saved-address
  // requirement rather than guessing coverage from shop profile text.
  addressId: z.string().uuid().nullable().default(null),
}).strict();

/** POST /api/mobile/v1/checkout/quote — authoritative review snapshot, no write. */
export async function POST(request: Request): Promise<Response> {
  const requestId = newRequestId();
  const auth = await requireRetailerCommerceSession(request, requestId, ['orders.create', 'orders.view.own']);
  if ('response' in auth) return auth.response;
  const limited = enforceRateLimit('read.orders', request, { requestId, keySuffix: auth.session.userId });
  if (limited) return limited;

  const parsed = await parseJsonBody(request, quoteSchema, requestId);
  if (!parsed.ok) return parsed.response;
  if (!isValidCartRequest(parsed.data.lines)) {
    return jsonError('invalid_request', 'The cart contains repeated items or invalid quantities.', {
      status: 400,
      requestId,
    });
  }

  try {
    return jsonOk(await quoteMobileCheckout(auth.session, parsed.data.lines, parsed.data.addressId ?? null), { requestId });
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'MobileCommerceError') {
      return mobileCommerceErrorResponse(cause, requestId);
    }
    logServerError('checkout.quote', requestId, cause);
    return jsonError('database_unavailable', 'The current order quote could not be loaded. Please try again.', {
      status: 503,
      requestId,
    });
  }
}
