'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { mergeLinesIntoCart } from '@/lib/retailer/cart-merge';

export type SavedCartActionResult = { error?: string } | { success: true; savedCartId?: string };

const SAVE_FOR_LATER_CART_NAME = 'Saved for later';
const MAX_SAVED_CARTS = 20;
const MAX_LINES_PER_SAVED_CART = 100;

function sanitizeName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, 60);
}

/**
 * Creates a named saved cart from the CURRENT cart contents (or merges into
 * an existing saved cart with the same name). Only pack references and
 * quantities are copied — never prices — so a restore always re-prices at
 * the CURRENT effective rate through the same validation used everywhere
 * else in the app.
 */
export async function saveCurrentCartAction(rawName: string): Promise<SavedCartActionResult> {
  const user = await requirePermission('orders.create');
  if (user.role !== 'retailer') return { error: 'Only a retailer can save carts.' };

  const name = sanitizeName(rawName);
  if (name.length < 1) return { error: 'Give the saved cart a name.' };

  const supabase = createClient();

  const { count } = await supabase
    .from('retailer_saved_carts')
    .select('id', { count: 'exact', head: true })
    .eq('retailer_id', user.id);
  if ((count ?? 0) >= MAX_SAVED_CARTS) {
    return { error: `You can keep up to ${MAX_SAVED_CARTS} saved carts. Delete an older one first.` };
  }

  const { data: cartItems } = await supabase
    .from('cart_items')
    .select('pack_id, quantity, product_id')
    .eq('retailer_id', user.id);
  const items = (cartItems ?? []) as unknown as { pack_id: string; quantity: number; product_id: string }[];
  if (items.length === 0) return { error: 'Your cart is empty — there is nothing to save yet.' };

  // Reuse an existing saved cart with the same name instead of duplicating.
  const { data: existing } = await supabase
    .from('retailer_saved_carts')
    .select('id')
    .eq('retailer_id', user.id)
    .eq('name', name)
    .maybeSingle<{ id: string }>();

  let savedCartId = existing?.id;
  if (savedCartId) {
    await supabase
      .from('retailer_saved_carts')
      .update({ updated_at: new Date().toISOString() } as unknown as never)
      .eq('id', savedCartId)
      .eq('retailer_id', user.id);
  } else {
    const { data: created, error } = await supabase
      .from('retailer_saved_carts')
      .insert({ retailer_id: user.id, name } as unknown as never)
      .select('id')
      .maybeSingle<{ id: string }>();
    if (error || !created) return { error: 'The cart could not be saved.' };
    savedCartId = created.id;
  }

  // Merge by pack: an already-saved line for the same pack takes the larger
  // quantity (re-saving a growing cart should not double it), a new pack is
  // appended. Item counts stay bounded.
  const { data: existingItems } = await supabase
    .from('retailer_saved_cart_items')
    .select('id, pack_id, quantity')
    .eq('saved_cart_id', savedCartId)
    .eq('retailer_id', user.id);
  const typedExistingItems = (existingItems ?? []) as unknown as { id: string; pack_id: string; quantity: number }[];
  const existingByPack = new Map(typedExistingItems.map((item) => [item.pack_id, item]));

  const rowsToInsert: { saved_cart_id: string; retailer_id: string; product_id: string; pack_id: string; quantity: number }[] = [];
  for (const item of items) {
    const existingItem = existingByPack.get(item.pack_id);
    if (existingItem) {
      if (item.quantity > existingItem.quantity) {
        await supabase
          .from('retailer_saved_cart_items')
          .delete()
          .eq('id', existingItem.id)
          .eq('retailer_id', user.id);
        rowsToInsert.push({ saved_cart_id: savedCartId, retailer_id: user.id, product_id: item.product_id, pack_id: item.pack_id, quantity: item.quantity });
      }
    } else if (typedExistingItems.length + rowsToInsert.length < MAX_LINES_PER_SAVED_CART) {
      rowsToInsert.push({ saved_cart_id: savedCartId, retailer_id: user.id, product_id: item.product_id, pack_id: item.pack_id, quantity: item.quantity });
    }
  }
  if (rowsToInsert.length > 0) {
    const { error } = await supabase.from('retailer_saved_cart_items').insert(rowsToInsert as unknown as never);
    if (error) return { error: 'The cart could not be saved.' };
  }

  revalidatePath('/retailer/cart');
  revalidatePath('/retailer/cart/saved');
  return { success: true, savedCartId };
}

/**
 * Save-for-later: moves ONE cart line into the dedicated "Saved for later"
 * cart (created on demand), removing it from the active cart.
 */
export async function saveCartItemForLaterAction(cartItemId: string): Promise<SavedCartActionResult> {
  const user = await requirePermission('orders.create');
  if (user.role !== 'retailer') return { error: 'Only a retailer can save items for later.' };

  const supabase = createClient();

  const { data: item } = await supabase
    .from('cart_items')
    .select('id, pack_id, product_id, quantity')
    .eq('id', cartItemId)
    .eq('retailer_id', user.id)
    .maybeSingle<{ id: string; pack_id: string; product_id: string; quantity: number } | never>();
  if (!item) return { error: 'Cart item not found.' };

  // Find or create the dedicated cart.
  const { data: existingCart } = await supabase
    .from('retailer_saved_carts')
    .select('id')
    .eq('retailer_id', user.id)
    .eq('name', SAVE_FOR_LATER_CART_NAME)
    .maybeSingle<{ id: string }>();

  let savedCartId = existingCart?.id;
  if (!savedCartId) {
    const { data: created, error } = await supabase
      .from('retailer_saved_carts')
      .insert({ retailer_id: user.id, name: SAVE_FOR_LATER_CART_NAME } as unknown as never)
      .select('id')
      .maybeSingle<{ id: string }>();
    if (error || !created) return { error: 'The item could not be saved for later.' };
    savedCartId = created.id;
  }

  const { data: existingItem } = await supabase
    .from('retailer_saved_cart_items')
    .select('id, quantity')
    .eq('saved_cart_id', savedCartId)
    .eq('pack_id', item.pack_id)
    .eq('retailer_id', user.id)
    .maybeSingle<{ id: string; quantity: number }>();

  if (existingItem) {
    await supabase
      .from('retailer_saved_cart_items')
      .update({ quantity: Math.max(existingItem.quantity, item.quantity) } as unknown as never)
      .eq('id', existingItem.id)
      .eq('retailer_id', user.id);
  } else {
    const { error } = await supabase.from('retailer_saved_cart_items').insert({
      saved_cart_id: savedCartId,
      retailer_id: user.id,
      product_id: item.product_id,
      pack_id: item.pack_id,
      quantity: item.quantity,
    } as unknown as never);
    if (error) return { error: 'The item could not be saved for later.' };
  }

  // Only remove the cart line after the saved copy exists.
  const { error: deleteError } = await supabase.from('cart_items').delete().eq('id', item.id).eq('retailer_id', user.id);
  if (deleteError) return { error: 'The item was saved but could not be removed from the cart.' };

  revalidatePath('/retailer/cart');
  revalidatePath('/retailer/cart/saved');
  revalidatePath('/retailer', 'layout');
  return { success: true, savedCartId };
}

/**
 * Restores a saved cart INTO the active cart by MERGING. Every line is
 * re-validated against the CURRENT pack state (active, MOQ, case/loose
 * rules) through the same validate-then-merge path as catalog adds, and
 * invalid lines are skipped and counted — never silently dropped.
 */
export async function restoreSavedCartAction(savedCartId: string): Promise<SavedCartActionResult & { restoredCount?: number; skippedCount?: number }> {
  const user = await requirePermission('orders.create');
  if (user.role !== 'retailer') return { error: 'Only a retailer can restore saved carts.' };

  const supabase = createClient();

  const { data: savedCart } = await supabase
    .from('retailer_saved_carts')
    .select('id')
    .eq('id', savedCartId)
    .eq('retailer_id', user.id)
    .maybeSingle<{ id: string }>();
  if (!savedCart) return { error: 'Saved cart not found.' };

  const { data: savedItems } = await supabase
    .from('retailer_saved_cart_items')
    .select('pack_id, quantity')
    .eq('saved_cart_id', savedCartId)
    .eq('retailer_id', user.id);
  const typedSavedItems = (savedItems ?? []) as unknown as { pack_id: string; quantity: number }[];
  if (typedSavedItems.length === 0) return { error: 'This saved cart is empty.' };

  interface PackForRestore {
    id: string;
    moq: number;
    is_active: boolean;
    products: { is_active: boolean } | null;
  }
  const { data: packRows } = await supabase
    .from('product_packs')
    .select('id, moq, is_active, products ( is_active )')
    .in('id', [...new Set(typedSavedItems.map((item) => item.pack_id))]);
  const packById = new Map(((packRows ?? []) as unknown as PackForRestore[]).map((pack) => [pack.id, pack]));

  const validLines: { packId: string; quantity: number }[] = [];
  let skippedCount = 0;
  for (const item of typedSavedItems) {
    const pack = packById.get(item.pack_id);
    if (!pack || !pack.is_active || !pack.products?.is_active || item.quantity < pack.moq) {
      skippedCount += 1;
      continue;
    }
    validLines.push({ packId: item.pack_id, quantity: item.quantity });
  }
  if (validLines.length === 0) {
    return { error: 'None of these items are currently orderable — availability and minimums may have changed.' };
  }

  await mergeLinesIntoCart(supabase, user.id, validLines);

  revalidatePath('/retailer/cart');
  revalidatePath('/retailer/cart/saved');
  revalidatePath('/retailer', 'layout');
  return { success: true, restoredCount: validLines.length, skippedCount };
}

/** Adds a single saved line back into the cart (per-item quick add). */
export async function restoreSavedCartItemAction(itemId: string): Promise<SavedCartActionResult> {
  const user = await requirePermission('orders.create');
  if (user.role !== 'retailer') return { error: 'Only a retailer can restore saved items.' };

  const supabase = createClient();
  const { data: item } = await supabase
    .from('retailer_saved_cart_items')
    .select('pack_id, quantity')
    .eq('id', itemId)
    .eq('retailer_id', user.id)
    .maybeSingle<{ pack_id: string; quantity: number } | never>();
  if (!item) return { error: 'Saved item not found.' };

  const { data: pack } = await supabase
    .from('product_packs')
    .select('id, moq, is_active, products ( is_active )')
    .eq('id', item.pack_id)
    .maybeSingle<{ id: string; moq: number; is_active: boolean; products: { is_active: boolean } | null }>();
  if (!pack || !pack.is_active || !pack.products?.is_active || item.quantity < pack.moq) {
    return { error: 'This item is not currently orderable.' };
  }

  await mergeLinesIntoCart(supabase, user.id, [{ packId: item.pack_id, quantity: item.quantity }]);
  revalidatePath('/retailer/cart');
  revalidatePath('/retailer/cart/saved');
  revalidatePath('/retailer', 'layout');
  return { success: true };
}

/** Removes ONE line from a saved cart (used to correct or empty a list). */
export async function removeSavedCartItemAction(itemId: string): Promise<SavedCartActionResult> {
  const user = await requirePermission('orders.create');
  if (user.role !== 'retailer') return { error: 'Only a retailer can edit saved carts.' };
  const supabase = createClient();
  const { error } = await supabase
    .from('retailer_saved_cart_items')
    .delete()
    .eq('id', itemId)
    .eq('retailer_id', user.id);
  if (error) return { error: 'The item could not be removed.' };
  revalidatePath('/retailer/cart/saved');
  revalidatePath('/retailer/cart');
  return { success: true };
}

export async function renameSavedCartAction(savedCartId: string, rawName: string): Promise<SavedCartActionResult> {
  const user = await requirePermission('orders.create');
  if (user.role !== 'retailer') return { error: 'Only a retailer can rename saved carts.' };
  const name = sanitizeName(rawName);
  if (name.length < 1) return { error: 'Enter a name for the saved cart.' };
  const supabase = createClient();
  const { data, error } = await supabase
    .from('retailer_saved_carts')
    .update({ name, updated_at: new Date().toISOString() } as unknown as never)
    .eq('id', savedCartId)
    .eq('retailer_id', user.id)
    .select('id')
    .maybeSingle<{ id: string }>();
  if (error) return { error: 'The saved cart could not be renamed.' };
  if (!data) return { error: 'Saved cart not found.' };
  revalidatePath('/retailer/cart/saved');
  return { success: true };
}

export async function deleteSavedCartAction(savedCartId: string): Promise<SavedCartActionResult> {
  const user = await requirePermission('orders.create');
  if (user.role !== 'retailer') return { error: 'Only a retailer can delete saved carts.' };
  const supabase = createClient();
  const { error } = await supabase
    .from('retailer_saved_carts')
    .delete()
    .eq('id', savedCartId)
    .eq('retailer_id', user.id);
  if (error) return { error: 'The saved cart could not be deleted.' };
  revalidatePath('/retailer/cart/saved');
  revalidatePath('/retailer/cart');
  return { success: true };
}
