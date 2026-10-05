import { z } from 'zod';
import {
  enforceRateLimit,
  jsonError,
  jsonOk,
  logServerError,
  newRequestId,
} from '@/lib/mobile';
import { requireRetailerCommerceSession, mobileCommerceErrorResponse } from '@/lib/mobile/commerce-route';
import { loadMobileAddresses, setDefaultMobileAddress } from '@/lib/mobile/commerce-service';

export const dynamic = 'force-dynamic';

const addressIdSchema = z.string().uuid();

/**
 * POST /api/mobile/v1/addresses/{addressId}/default — make one saved address
 * the exclusive default.
 *
 * A separate endpoint because it changes an invariant across the retailer's
 * whole address book (exactly one default), not just one row's fields. The
 * address must belong to the caller; another retailer's id answers `404`.
 */
export async function POST(
  request: Request,
  context: { params: { addressId: string } },
): Promise<Response> {
  const requestId = newRequestId();
  const auth = await requireRetailerCommerceSession(request, requestId, 'orders.create');
  if ('response' in auth) return auth.response;

  const parsedId = addressIdSchema.safeParse(context.params.addressId);
  if (!parsedId.success) {
    return jsonError('invalid_request', 'That address id is not valid.', { status: 400, requestId });
  }

  const limited = enforceRateLimit('write.orders', request, { requestId, keySuffix: auth.session.userId });
  if (limited) return limited;

  try {
    const address = await setDefaultMobileAddress(auth.session, parsedId.data);
    return jsonOk({ address, addresses: await loadMobileAddresses(auth.session) }, { requestId });
  } catch (cause) {
    logServerError('addresses.default', requestId, cause);
    return mobileCommerceErrorResponse(cause, requestId);
  }
}
