import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { mergeLinesIntoCart } from '@/lib/retailer/cart-merge';

interface PackValidationRow {
  id: string;
  moq: number;
  is_active: boolean;
  products: { is_active: boolean } | null;
}

export type CartServiceResult = { error: string } | { success: true };

export async function validatePackForCart(
  supabase: ReturnType<typeof createClient>,
  packId: string,
  quantity: number
): Promise<string | null> {
  if (!packId || quantity < 1 || quantity > 100000 || !Number.isInteger(quantity)) {
    return 'Enter a valid whole number quantity.';
  }
  const { data: pack, error } = await supabase
    .from('product_packs')
    .select('id, moq, is_active, products ( is_active )')
    .eq('id', packId)
    .maybeSingle<PackValidationRow>();
  if (error || !pack) return 'This pack no longer exists.';
  if (!pack.is_active) return 'This pack is currently unavailable.';
  if (!pack.products?.is_active) return 'This product is currently unavailable.';
  if (quantity < pack.moq) return `Minimum order quantity for this pack is ${pack.moq}.`;
  return null;
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
