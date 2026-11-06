import { z } from 'zod';
import {
  enforceRateLimit,
  jsonError,
  jsonOk,
  logServerError,
  newRequestId,
} from '@/lib/mobile';
import { requireRetailerCommerceSession } from '@/lib/mobile/commerce-route';
import { mergeLinesIntoCart } from '@/lib/retailer/cart-merge';
import { validatePackForCart } from '@/lib/retailer/cart-service';

export const dynamic = 'force-dynamic';

const uuidSchema = z.string().uuid();
type PackRow = { id: string; moq: number; is_active: boolean; products: { is_active: boolean } | null };

/** Restore one saved line through the same current-pack validation and cart merge as every other add. */
export async function POST(request: Request, context: { params: Promise<{ itemId: string }> }): Promise<Response> {
  const requestId = newRequestId();
  const auth = await requireRetailerCommerceSession(request, requestId, 'orders.create');
  if ('response' in auth) return auth.response;
  const limited = enforceRateLimit('write.cart', request, { requestId, keySuffix: auth.session.userId });
  if (limited) return limited;
  if (!uuidSchema.safeParse((await context.params).itemId).success) {
    return jsonError('invalid_request', 'Saved item id is invalid.', { status: 400, requestId });
  }

  const supabase = auth.session.supabase;
  try {
    const { data: item, error: itemError } = await supabase.from('retailer_saved_cart_items')
      .select('pack_id, quantity')
      .eq('id', (await context.params).itemId)
      .eq('retailer_id', auth.session.userId)
      .maybeSingle<{ pack_id: string; quantity: number }>();
    if (itemError) throw itemError;
    if (!item) return jsonError('not_found', 'Saved item not found.', { status: 404, requestId });

    const { data: pack, error: packError } = await supabase.from('product_packs')
      .select('id, moq, is_active, products ( is_active )')
      .eq('id', item.pack_id)
      .maybeSingle<PackRow>();
    if (packError) throw packError;
    if (!pack || !pack.is_active || !pack.products?.is_active || item.quantity < pack.moq) {
      return jsonError('conflict', 'This item is not currently orderable. Its pack or minimum may have changed.', { status: 409, requestId });
    }
    const validationError = await validatePackForCart(supabase as never, auth.session.userId, item.pack_id, item.quantity);
    if (validationError) return jsonError('conflict', validationError, { status: 409, requestId });
    await mergeLinesIntoCart(supabase as never, auth.session.userId, [{ packId: item.pack_id, quantity: item.quantity }]);
    return jsonOk({ restoredCount: 1 }, { requestId });
  } catch (cause) {
    logServerError('saved-carts.item-restore', requestId, cause);
    return jsonError('database_unavailable', 'The saved item could not be restored. Refresh your cart and try again.', { status: 503, requestId });
  }
}
