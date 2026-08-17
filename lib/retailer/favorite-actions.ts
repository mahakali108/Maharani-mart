'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import type { Database } from '@/types/database.types';

type FavoriteInsert = Database['public']['Tables']['retailer_favorites']['Insert'];

export type FavoriteActionResult = { error?: string } | { success: true; isFavorite: boolean };

/**
 * Toggles a product in the authenticated retailer's wishlist.
 *
 * retailer_id is ALWAYS resolved from the server-side session
 * (requireUser inside requirePermission) — the client supplies only a
 * productId, never an identity. RLS (retailer_favorites_owner_*,
 * migration 0015) independently enforces the same ownership boundary,
 * so a forged productId alone gains nothing.
 */
export async function toggleFavoriteAction(productId: string): Promise<FavoriteActionResult> {
  const user = await requirePermission('products.view');
  if (user.role !== 'retailer') return { error: 'Only retailers can manage favourites.' };
  if (!productId) return { error: 'Product not found.' };

  const supabase = createClient();

  const { data: existing } = await supabase
    .from('retailer_favorites')
    .select('id')
    .eq('retailer_id', user.id)
    .eq('product_id', productId)
    .maybeSingle<{ id: string }>();

  if (existing) {
    const { error } = await supabase
      .from('retailer_favorites')
      .delete()
      .eq('id', existing.id)
      .eq('retailer_id', user.id);
    if (error) return { error: error.message };

    revalidatePath('/retailer/home');
    revalidatePath('/retailer/catalog');
    revalidatePath('/retailer/favorites');
    revalidatePath(`/retailer/catalog/${productId}`);
    return { success: true, isFavorite: false };
  }

  const payload: FavoriteInsert = { retailer_id: user.id, product_id: productId };
  const { error } = await supabase.from('retailer_favorites').insert(payload as unknown as never);
  if (error) return { error: error.message };

  revalidatePath('/retailer/home');
  revalidatePath('/retailer/catalog');
  revalidatePath('/retailer/favorites');
  revalidatePath(`/retailer/catalog/${productId}`);
  return { success: true, isFavorite: true };
}
