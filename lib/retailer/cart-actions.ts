'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import type { Database } from '@/types/database.types';

type CartItemInsert = Database['public']['Tables']['cart_items']['Insert'];

interface PackValidationRow {
  id: string;
  moq: number;
  is_active: boolean;
  products: { is_active: boolean } | null;
}

export type CartActionResult = { error?: string } | { success: true };

async function validatePack(packId: string, quantity: number): Promise<string | null> {
  if (quantity < 1 || !Number.isInteger(quantity)) {
    return 'Enter a valid whole number quantity.';
  }

  const supabase = createClient();
  const { data: pack } = await supabase
    .from('product_packs')
    .select('id, moq, is_active, products ( is_active )')
    .eq('id', packId)
    .maybeSingle<PackValidationRow>();

  if (!pack) return 'This pack no longer exists.';
  if (!pack.is_active) return 'This pack is currently unavailable.';
  if (!pack.products?.is_active) return 'This product is currently unavailable.';
  if (quantity < pack.moq) return `Minimum order quantity for this pack is ${pack.moq}.`;

  return null;
}

export async function addToCartAction(packId: string, quantity: number): Promise<CartActionResult> {
  const user = await requirePermission('orders.create');

  const validationError = await validatePack(packId, quantity);
  if (validationError) return { error: validationError };

  const supabase = createClient();

  const { data: existing } = await supabase
    .from('cart_items')
    .select('id, quantity')
    .eq('retailer_id', user.id)
    .eq('pack_id', packId)
    .maybeSingle<{ id: string; quantity: number }>();

  if (existing) {
    const { error } = await supabase
      .from('cart_items')
      .update({ quantity: existing.quantity + quantity } as unknown as never)
      .eq('id', existing.id);
    if (error) return { error: error.message };
  } else {
    const payload: CartItemInsert = { retailer_id: user.id, pack_id: packId, quantity };
    const { error } = await supabase.from('cart_items').insert(payload as unknown as never);
    if (error) return { error: error.message };
  }

  revalidatePath('/retailer/cart');
  return { success: true };
}

export async function updateCartQuantityAction(cartItemId: string, quantity: number): Promise<CartActionResult> {
  const user = await requirePermission('orders.create');
  const supabase = createClient();

  const { data: item } = await supabase
    .from('cart_items')
    .select('pack_id')
    .eq('id', cartItemId)
    .eq('retailer_id', user.id)
    .maybeSingle<{ pack_id: string }>();

  if (!item) return { error: 'Cart item not found.' };

  const validationError = await validatePack(item.pack_id, quantity);
  if (validationError) return { error: validationError };

  const { error } = await supabase
    .from('cart_items')
    .update({ quantity } as unknown as never)
    .eq('id', cartItemId)
    .eq('retailer_id', user.id);

  if (error) return { error: error.message };
  revalidatePath('/retailer/cart');
  return { success: true };
}

export async function removeCartItemAction(cartItemId: string): Promise<CartActionResult> {
  const user = await requirePermission('orders.create');
  const supabase = createClient();

  const { error } = await supabase.from('cart_items').delete().eq('id', cartItemId).eq('retailer_id', user.id);
  if (error) return { error: error.message };

  revalidatePath('/retailer/cart');
  return { success: true };
}
