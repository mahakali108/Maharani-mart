import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { validatePackForCart } from '@/lib/retailer/cart-validation';
import { mutateRetailerCartLine } from '@/lib/retailer/cart-rpc';

export interface CartMergeLine {
  packId: string;
  quantity: number;
}

/**
 * Atomic merge for the shared persistent retailer cart.
 *
 * Maharani Traders runs a single, centrally-owned catalogue: a cart line is
 * identified by its pack alone. Third-party seller offers were removed from the
 * platform, so the source-aware variant (`mutate_retailer_cart_line_ex`, 0065)
 * is no longer called here — every line is Maharani stock and goes through the
 * original 4-argument RPC, which owns activity, MOQ, stock and compare-and-set
 * checks inside the transaction.
 */
export async function mergeLinesIntoCart(
  supabase: Awaited<ReturnType<typeof createClient>>,
  retailerId: string,
  lines: CartMergeLine[]
): Promise<void> {
  for (const line of lines) {
    const { data: existing, error: readError } = await supabase
      .from('cart_items')
      .select('id, quantity')
      .eq('retailer_id', retailerId)
      .eq('pack_id', line.packId)
      .maybeSingle<{ id: string; quantity: number }>();

    if (readError) throw new Error('The cart could not be read. Please try again.');
    const expectedQuantity = existing?.quantity ?? 0;
    const targetQuantity = expectedQuantity + line.quantity;
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || targetQuantity > 100000) {
      throw new Error('The combined quantity is too large. Review your cart.');
    }

    const validationError = await validatePackForCart(supabase, retailerId, line.packId, targetQuantity);
    if (validationError) throw new Error(validationError);

    const { error } = await mutateRetailerCartLine(supabase, {
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
        throw new Error(available ? `Only ${available} pieces are available.` : 'There is not enough stock for that quantity.');
      }
      if (/PACK_UNAVAILABLE/i.test(error.message)) throw new Error('This pack is no longer available.');
      throw new Error('The cart could not be updated. Review your cart and try again.');
    }
  }
}
