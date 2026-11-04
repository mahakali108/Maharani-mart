import { z } from 'zod';
import {
  enforceRateLimit,
  jsonError,
  jsonOk,
  logServerError,
  newRequestId,
} from '@/lib/mobile';
import { requireRetailerCommerceSession } from '@/lib/mobile/commerce-route';

export const dynamic = 'force-dynamic';

const uuidSchema = z.string().uuid();

/** Remove one item from the caller's saved carts. */
export async function DELETE(request: Request, context: { params: Promise<{ itemId: string }> }): Promise<Response> {
  const requestId = newRequestId();
  const auth = await requireRetailerCommerceSession(request, requestId, 'orders.create');
  if ('response' in auth) return auth.response;
  const limited = enforceRateLimit('write.cart', request, { requestId, keySuffix: auth.session.userId });
  if (limited) return limited;
  if (!uuidSchema.safeParse((await context.params).itemId).success) {
    return jsonError('invalid_request', 'Saved item id is invalid.', { status: 400, requestId });
  }

  try {
    const { data, error } = await auth.session.supabase.from('retailer_saved_cart_items').delete()
      .eq('id', (await context.params).itemId)
      .eq('retailer_id', auth.session.userId)
      .select('id')
      .maybeSingle<{ id: string }>();
    if (error) throw error;
    if (!data) return jsonError('not_found', 'Saved item not found.', { status: 404, requestId });
    return jsonOk({ ok: true }, { requestId });
  } catch (cause) {
    logServerError('saved-carts.item-delete', requestId, cause);
    return jsonError('database_unavailable', 'The saved item could not be removed. Please try again.', { status: 503, requestId });
  }
}
