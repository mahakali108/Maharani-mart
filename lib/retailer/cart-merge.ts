import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { validatePackForCart } from '@/lib/retailer/cart-validation';
import { mutateRetailerCartLine } from '@/lib/retailer/cart-rpc';

/**
 * Atomic merge for the shared persistent retailer cart.
 *
 * The caller-scoped `mutate_retailer_cart_line` RPC takes the per-retailer
 * advisory lock, checks the expected current quantity, enforces pack activity
 * and MOQ, and applies the new full piece count. The SQL function never prices
 * a line; before it runs, this service revalidates the target quantity through
 * the existing retailer pricing engine. A concurrent merge returns a conflict
 * instead of losing an increment or overwriting a newer quantity.
 */
export async function mergeLinesIntoCart(
  supabase: ReturnType<typeof createClient>,
  retailerId: string,
  lines: { packId: string; quantity: number }[]
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
      if (/PACK_UNAVAILABLE/i.test(error.message)) throw new Error('This pack is no longer available.');
      throw new Error('The cart could not be updated. Review your cart and try again.');
    }
  }
}
