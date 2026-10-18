import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { validatePackForCart } from '@/lib/retailer/cart-validation';
import { mutateRetailerCartLine, mutateRetailerCartLineEx } from '@/lib/retailer/cart-rpc';

export interface CartMergeLine {
  packId: string;
  quantity: number;
  /** Null/omitted is Maharani stock; a UUID preserves a marketplace offer. */
  sellerOfferId?: string | null;
}

/**
 * Atomic, source-aware merge for the shared persistent retailer cart.
 *
 * 0065 identifies a line by (pack, seller offer), so the same central-catalogue
 * pack can coexist as Maharani stock and as one or more seller offers. The RPC
 * owns activity, MOQ, stock, moderation, floor and compare-and-set checks.
 * Legacy Maharani adds retain their existing price-engine validation before the
 * write; marketplace prices are never inferred from the pack price.
 */
export async function mergeLinesIntoCart(
  supabase: ReturnType<typeof createClient>,
  retailerId: string,
  lines: CartMergeLine[]
): Promise<void> {
  for (const line of lines) {
    const sellerOfferId = line.sellerOfferId ?? null;
    let query = supabase
      .from('cart_items')
      .select('id, quantity, seller_offer_id')
      .eq('retailer_id', retailerId)
      .eq('pack_id', line.packId);
    if (sellerOfferId) {
      query = query.eq('seller_offer_id' as never, sellerOfferId);
    } else if (typeof (query as { is?: unknown }).is === 'function') {
      query = query.is('seller_offer_id' as never, null);
    }
    const { data: existing, error: readError } = await query
      .maybeSingle<{ id: string; quantity: number; seller_offer_id: string | null }>();

    if (readError) throw new Error('The cart could not be read. Please try again.');
    const expectedQuantity = existing?.quantity ?? 0;
    const targetQuantity = expectedQuantity + line.quantity;
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || targetQuantity > 100000) {
      throw new Error('The combined quantity is too large. Review your cart.');
    }

    if (!sellerOfferId) {
      const validationError = await validatePackForCart(supabase, retailerId, line.packId, targetQuantity);
      if (validationError) throw new Error(validationError);
    }

    const { error } = sellerOfferId
      ? await mutateRetailerCartLineEx(supabase, {
          p_pack_id: line.packId,
          p_seller_offer_id: sellerOfferId,
          p_cart_item_id: null,
          p_expected_quantity: expectedQuantity,
          p_quantity: targetQuantity,
        })
      : await mutateRetailerCartLine(supabase, {
          p_pack_id: line.packId,
          p_cart_item_id: null,
          p_expected_quantity: expectedQuantity,
          p_quantity: targetQuantity,
        });
    if (error) {
      if (/CART_CHANGED/i.test(error.message)) {
        throw new Error('Your cart changed in another request. Refresh it and try again.');
      }
      if (/minimum[ _]order[ _]quantity/i.test(error.message)) throw new Error(error.message);
      if (/INSUFFICIENT_STOCK/i.test(error.message)) {
        const available = error.message.match(/only\s+(\d+)\s+available/i)?.[1];
        throw new Error(available ? `Only ${available} pieces are available from this seller.` : 'This seller does not have enough stock.');
      }
      if (/OFFER_UNAVAILABLE|PRICE_BELOW_FLOOR/i.test(error.message)) {
        throw new Error('This seller offer is no longer available. Choose another offer.');
      }
      if (/PACK_UNAVAILABLE/i.test(error.message)) throw new Error('This pack is no longer available.');
      throw new Error('The cart could not be updated. Review your cart and try again.');
    }
  }
}
