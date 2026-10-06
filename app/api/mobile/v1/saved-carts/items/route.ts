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
import { SAVE_FOR_LATER_CART_NAME } from '@/lib/retailer/saved-cart-constants';

export const dynamic = 'force-dynamic';

const schema = z.object({ cartItemId: z.string().uuid() }).strict();

/** Move one caller-owned live-cart line to the reserved Saved for later list. */
export async function POST(request: Request): Promise<Response> {
  const requestId = newRequestId();
  const auth = await requireRetailerCommerceSession(request, requestId, 'orders.create');
  if ('response' in auth) return auth.response;
  const limited = enforceRateLimit('write.cart', request, { requestId, keySuffix: auth.session.userId });
  if (limited) return limited;
  const body = await parseJsonBody(request, schema, requestId);
  if (!body.ok) return body.response;
  const supabase = auth.session.supabase;

  try {
    const { data: item, error: itemError } = await supabase.from('cart_items')
      .select('id, pack_id, product_id, quantity')
      .eq('id', body.data.cartItemId)
      .eq('retailer_id', auth.session.userId)
      .maybeSingle<{ id: string; pack_id: string; product_id: string; quantity: number }>();
    if (itemError) throw itemError;
    if (!item) return jsonError('not_found', 'Cart item not found.', { status: 404, requestId });

    const { data: existingCart, error: cartReadError } = await supabase.from('retailer_saved_carts')
      .select('id')
      .eq('retailer_id', auth.session.userId)
      .eq('name', SAVE_FOR_LATER_CART_NAME)
      .maybeSingle<{ id: string }>();
    if (cartReadError) throw cartReadError;
    let savedCartId = existingCart?.id;
    if (!savedCartId) {
      const { data: created, error } = await supabase.from('retailer_saved_carts').insert({
        retailer_id: auth.session.userId,
        name: SAVE_FOR_LATER_CART_NAME,
      } as unknown as never).select('id').maybeSingle<{ id: string }>();
      if (error || !created) throw error ?? new Error('Missing saved cart row.');
      savedCartId = created.id;
    }

    const { data: savedItem, error: savedReadError } = await supabase.from('retailer_saved_cart_items')
      .select('id, quantity')
      .eq('saved_cart_id', savedCartId)
      .eq('pack_id', item.pack_id)
      .eq('retailer_id', auth.session.userId)
      .maybeSingle<{ id: string; quantity: number }>();
    if (savedReadError) throw savedReadError;
    if (savedItem) {
      const { error } = await supabase.from('retailer_saved_cart_items')
        .update({ quantity: Math.max(savedItem.quantity, item.quantity) } as unknown as never)
        .eq('id', savedItem.id)
        .eq('retailer_id', auth.session.userId);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('retailer_saved_cart_items').insert({
        saved_cart_id: savedCartId,
        retailer_id: auth.session.userId,
        product_id: item.product_id,
        pack_id: item.pack_id,
        quantity: item.quantity,
      } as unknown as never);
      if (error) throw error;
    }

    const { data: removed, error: deleteError } = await supabase.from('cart_items').delete()
      .eq('id', item.id)
      .eq('retailer_id', auth.session.userId)
      .select('id')
      .maybeSingle<{ id: string }>();
    if (deleteError) throw deleteError;
    if (!removed) return jsonError('conflict', 'The item was saved but could not be removed from the cart.', { status: 409, requestId });
    return jsonOk({ savedCartId }, { requestId });
  } catch (cause) {
    logServerError('saved-carts.save-for-later', requestId, cause);
    return jsonError('database_unavailable', 'The item could not be saved for later. Please try again.', { status: 503, requestId });
  }
}
