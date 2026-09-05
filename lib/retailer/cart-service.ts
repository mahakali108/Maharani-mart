import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { mergeLinesIntoCart } from '@/lib/retailer/cart-merge';
import { calculateRetailerPiecePrice } from '@/lib/retailer/retailer-pricing';
import { resolvePackCasePrice } from '@/lib/retailer/effective-price';
import { loadPackTiers } from '@/lib/retailer/pricing-data';

interface PackForCart {
  id: string;
  pack_name: string;
  moq: number;
  units_per_case: number;
  case_price: number;
  ptr: number | null;
  base_price: number;
  allow_loose_pieces: boolean;
  is_active: boolean;
  products: { is_active: boolean } | null;
}

export type CartServiceResult = { error: string } | { success: true };

/**
 * The single cart-side quantity rule. It runs the SAME pure retailer piece
 * pricing engine the server quote and the UI previews use, so a retailer can
 * never park a quantity in the cart that checkout would reject (below MOQ or
 * an unwhole quantity).
 *
 * A product-level `price_lists` override is deliberately not consulted here:
 * an override changes what a piece costs, never what may be ordered. Money is
 * still resolved authoritatively at quote/order time.
 */
async function quantityError(supabase: ReturnType<typeof createClient>, pack: PackForCart, quantity: number) {
  const tiers = await loadPackTiers(supabase, [pack.id]);
  const pricing = calculateRetailerPiecePrice({
    quantity,
    unitsPerCase: pack.units_per_case,
    casePrice: resolvePackCasePrice(pack, null),
    tiers: tiers.get(pack.id) ?? [],
    moq: pack.moq,
  });
  if (pricing.orderable) return null;
  return pricing.message ?? 'That quantity is not available for this pack.';
}

export async function validatePackForCart(
  supabase: ReturnType<typeof createClient>,
  packId: string,
  quantity: number
): Promise<string | null> {
  // `quantity` is a PIECE count (0026): 6 pcs, 46 pcs or 80 pcs are all valid.
  if (!packId || quantity < 1 || quantity > 100000 || !Number.isInteger(quantity)) {
    return 'Enter a valid whole number quantity in pieces.';
  }
  const { data: pack, error } = await supabase
    .from('product_packs')
    .select(
      'id, pack_name, moq, units_per_case, case_price, ptr, base_price, allow_loose_pieces, is_active, products ( is_active )'
    )
    .eq('id', packId)
    .maybeSingle<PackForCart>();
  if (error || !pack) return 'This pack no longer exists.';
  if (!pack.is_active) return 'This pack is currently unavailable.';
  if (!pack.products?.is_active) return 'This product is currently unavailable.';
  // MOQ is checked here with the wording the cart has always used, and again by
  // the engine below (single implementation of the rule) for the case/loose
  // rules: a whole-case-only pack and an unpriced loose remainder.
  if (quantity < pack.moq) return `Minimum order quantity for this pack is ${pack.moq}.`;
  return quantityError(supabase, pack, quantity);
}

export async function addCartLines(
  supabase: ReturnType<typeof createClient>,
  retailerId: string,
  lines: { packId: string; quantity: number }[]
): Promise<CartServiceResult> {
  if (lines.length < 1 || lines.length > 100) return { error: 'Add between 1 and 100 cart lines.' };
  for (const line of lines) {
    const error = await validatePackForCart(supabase, line.packId, line.quantity);
    if (error) return { error };
  }
  await mergeLinesIntoCart(supabase, retailerId, lines);
  return { success: true };
}

export async function updateCartLine(
  supabase: ReturnType<typeof createClient>,
  retailerId: string,
  cartItemId: string,
  quantity: number
): Promise<CartServiceResult> {
  const { data: item } = await supabase
    .from('cart_items')
    .select('pack_id')
    .eq('id', cartItemId)
    .eq('retailer_id', retailerId)
    .maybeSingle<{ pack_id: string }>();
  if (!item) return { error: 'Cart item not found.' };
  const validationError = await validatePackForCart(supabase, item.pack_id, quantity);
  if (validationError) return { error: validationError };
  const { error } = await supabase
    .from('cart_items')
    .update({ quantity } as unknown as never)
    .eq('id', cartItemId)
    .eq('retailer_id', retailerId);
  return error ? { error: 'The cart could not be updated.' } : { success: true };
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
