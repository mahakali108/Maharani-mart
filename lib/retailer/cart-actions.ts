'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { addCartLines, removeCartLine, updateCartLine } from '@/lib/retailer/cart-service';

export type CartActionResult = { error?: string } | { success: true };

export async function addToCartAction(packId: string, quantity: number): Promise<CartActionResult> {
  const user = await requirePermission('orders.create');
  const result = await addCartLines(createClient(), user.id, [{ packId, quantity }]);
  if ('error' in result) return result;
  revalidatePath('/retailer/cart');
  revalidatePath('/retailer', 'layout');
  return { success: true };
}

export async function buyNowAction(packId: string, quantity: number): Promise<CartActionResult> {
  const result = await addToCartAction(packId, quantity);
  if ('error' in result) return result;
  redirect('/retailer/checkout');
}

export async function updateCartQuantityAction(cartItemId: string, quantity: number): Promise<CartActionResult> {
  const user = await requirePermission('orders.create');
  const result = await updateCartLine(createClient(), user.id, cartItemId, quantity);
  if ('error' in result) return result;
  revalidatePath('/retailer/cart');
  revalidatePath('/retailer', 'layout');
  return { success: true };
}

export async function removeCartItemAction(cartItemId: string): Promise<CartActionResult> {
  const user = await requirePermission('orders.create');
  const result = await removeCartLine(createClient(), user.id, cartItemId);
  if ('error' in result) return result;
  revalidatePath('/retailer/cart');
  revalidatePath('/retailer', 'layout');
  return { success: true };
}
