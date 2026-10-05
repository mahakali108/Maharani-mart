import {
  enforceRateLimit,
  jsonError,
  jsonOk,
  logServerError,
  newRequestId,
  parseJsonBody,
} from '@/lib/mobile';
import { requireRetailerCommerceSession, mobileCommerceErrorResponse } from '@/lib/mobile/commerce-route';
import { createMobileAddress, loadMobileAddresses } from '@/lib/mobile/commerce-service';
import { addressPayloadSchema } from '@/lib/retailer/address-shared';

export const dynamic = 'force-dynamic';

/**
 * GET /api/mobile/v1/addresses — saved addresses and the account's registered shop address.
 *
 * POST /api/mobile/v1/addresses — save a new delivery address.
 *
 * The rules are the web form's own schema (`addressPayloadSchema`), so a
 * validation change can never apply to one surface and miss the other.
 * Ownership comes from the verified session; the request body can never carry
 * a retailer id.
 */
export async function GET(request: Request): Promise<Response> {
  const requestId = newRequestId();
  const auth = await requireRetailerCommerceSession(request, requestId, ['orders.create', 'orders.view.own']);
  if ('response' in auth) return auth.response;
  const limited = enforceRateLimit('read.orders', request, { requestId, keySuffix: auth.session.userId });
  if (limited) return limited;

  try {
    return jsonOk({ addresses: await loadMobileAddresses(auth.session) }, { requestId });
  } catch (cause) {
    logServerError('addresses.list', requestId, cause);
    return jsonError('database_unavailable', 'Delivery addresses could not be loaded. Please try again.', {
      status: 503,
      requestId,
    });
  }
}

export async function POST(request: Request): Promise<Response> {
  const requestId = newRequestId();
  const auth = await requireRetailerCommerceSession(request, requestId, 'orders.create');
  if ('response' in auth) return auth.response;
  const limited = enforceRateLimit('write.orders', request, { requestId, keySuffix: auth.session.userId });
  if (limited) return limited;

  const body = await parseJsonBody(request, addressPayloadSchema, requestId);
  if (!body.ok) return body.response;

  try {
    const address = await createMobileAddress(auth.session, body.data);
    // The refreshed list is returned with the write so a client never has to
    // guess how the exclusivity rule reordered the other addresses.
    return jsonOk({ address, addresses: await loadMobileAddresses(auth.session) }, { requestId });
  } catch (cause) {
    logServerError('addresses.create', requestId, cause);
    return mobileCommerceErrorResponse(cause, requestId);
  }
}
