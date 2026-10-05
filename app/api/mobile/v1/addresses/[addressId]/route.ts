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
import { deleteMobileAddress, loadMobileAddresses, updateMobileAddress } from '@/lib/mobile/commerce-service';
import { addressPayloadSchema } from '@/lib/retailer/address-shared';

export const dynamic = 'force-dynamic';

const addressIdSchema = z.string().uuid();

/**
 * PATCH /api/mobile/v1/addresses/{addressId} — edit one saved address.
 * DELETE /api/mobile/v1/addresses/{addressId} — remove one saved address.
 *
 * Both are scoped by BOTH `id` and the verified session's `retailer_id`, so
 * another retailer's address is a `404` — never a silent no-op and never an
 * edit. RLS remains the hard boundary underneath.
 */
export async function PATCH(
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

  const body = await parseJsonBody(request, addressPayloadSchema, requestId);
  if (!body.ok) return body.response;

  try {
    const address = await updateMobileAddress(auth.session, parsedId.data, body.data);
    return jsonOk({ address, addresses: await loadMobileAddresses(auth.session) }, { requestId });
  } catch (cause) {
    logServerError('addresses.update', requestId, cause);
    return mobileCommerceErrorResponse(cause, requestId);
  }
}

export async function DELETE(
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
    await deleteMobileAddress(auth.session, parsedId.data);
    return jsonOk({ addresses: await loadMobileAddresses(auth.session) }, { requestId });
  } catch (cause) {
    logServerError('addresses.delete', requestId, cause);
    return mobileCommerceErrorResponse(cause, requestId);
  }
}
