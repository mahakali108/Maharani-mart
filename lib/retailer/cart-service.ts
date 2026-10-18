import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { mergeLinesIntoCart, type CartMergeLine } from '@/lib/retailer/cart-merge';
import { mutateRetailerCartLineEx } from '@/lib/retailer/cart-rpc';
import { validatePackForCart } from '@/lib/retailer/cart-validation';

export { validatePackForCart } from '@/lib/retailer/cart-validation';

export type CartServiceResult = { error: string } | { success: true };

/** Add to the shared piece cart after validating the final merged quantity. */
export async function addCartLines(
  supabase: ReturnType<typeof createClient>,
  retailerId: string,
  lines: CartMergeLine[]
): Promise<CartServiceResult> {
  if (lines.length < 1 || lines.length > 100) return { error: 'Add between 1 and 100 cart lines.' };
  const identities = lines.map((line) => `${line.packId.toLowerCase()}|${line.sellerOfferId?.toLowerCase() ?? 'maharani'}`);
  if (new Set(identities).size !== lines.length) {
    return { error: 'The same pack and seller offer cannot be added more than once.' };
  }
  try {
    await mergeLinesIntoCart(supabase, retailerId, lines);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'The cart could not be updated.' };
  }
  return { success: true };
}

export async function updateCartLine(
  supabase: ReturnType<typeof createClient>,
  retailerId: string,
  cartItemId: string,
  quantity: number
): Promise<CartServiceResult> {
  const { data: item, error: readError } = await supabase
    .from('cart_items')
    .select('pack_id, seller_offer_id, quantity')
    .eq('id', cartItemId)
    .eq('retailer_id', retailerId)
    .maybeSingle<{ pack_id: string; seller_offer_id: string | null; quantity: number }>();
  if (readError) return { error: 'The cart item could not be loaded. Please try again.' };
  if (!item) return { error: 'Cart item not found.' };
  if (!item.seller_offer_id) {
    const validationError = await validatePackForCart(supabase, retailerId, item.pack_id, quantity);
    if (validationError) return { error: validationError };
  }

  const { error } = await mutateRetailerCartLineEx(supabase, {
    p_pack_id: item.pack_id,
    p_seller_offer_id: item.seller_offer_id,
    p_cart_item_id: cartItemId,
    p_expected_quantity: item.quantity,
    p_quantity: quantity,
  });
  if (!error) return { success: true };
  if (/CART_CHANGED/i.test(error.message)) return { error: 'Your cart changed in another request. Refresh it and try again.' };
  if (/minimum[ _]order[ _]quantity/i.test(error.message)) return { error: error.message };
  if (/INSUFFICIENT_STOCK/i.test(error.message)) {
    const available = error.message.match(/only\s+(\d+)\s+available/i)?.[1];
    return { error: available ? `Only ${available} pieces are available from this seller.` : 'This seller does not have enough stock.' };
  }
  if (/OFFER_UNAVAILABLE|PRICE_BELOW_FLOOR/i.test(error.message)) {
    return { error: 'This seller offer is no longer available. Choose another offer.' };
  }
  if (/PACK_UNAVAILABLE/i.test(error.message)) return { error: 'This pack is no longer available.' };
  return { error: 'The cart could not be updated. Please try again.' };
}

export async function removeCartLine(
  supabase: ReturnType<typeof createClient>,
  retailerId: string,
  cartItemId: string
): Promise<CartServiceResult> {
  const { error } = await supabase.from('cart_items').delete().eq('id', cartItemId).eq('retailer_id', retailerId);
  return error ? { error: 'The cart item could not be removed.' } : { success: true };
}

export async function clearRetailerCart(
  supabase: ReturnType<typeof createClient>,
  retailerId: string
): Promise<CartServiceResult> {
  const { error } = await supabase.from('cart_items').delete().eq('retailer_id', retailerId);
  return error ? { error: 'The cart could not be cleared.' } : { success: true };
}
