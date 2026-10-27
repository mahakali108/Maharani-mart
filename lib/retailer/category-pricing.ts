import 'server-only';

import type { createClient } from '@/lib/supabase/server';
import {
  normalizeRetailerCategory,
  resolveCategoryPiecePrice,
  type RetailerCategory,
} from '@/lib/pricing/category-pricing';

/**
 * Server-side loader for retailer category prices (migration 0082).
 *
 * The authoritative price for a checkout line is resolved by the database
 * (`pack_category_price_per_piece`) and re-validated inside
 * create_order_atomic / create_order_atomic_v2. This module reads the SAME
 * table with the caller's RLS-scoped client so the catalogue, cart and
 * checkout preview compute exactly the number the server will charge.
 *
 * RLS only exposes the general price plus the viewer's own category price, so
 * a general retailer can never read (or be shown) a Silver/Gold price even
 * through this loader.
 */

const PRICE_CHUNK = 80;

export async function loadRetailerCategory(
  supabase: ReturnType<typeof createClient>,
  retailerId: string | null | undefined
): Promise<RetailerCategory> {
  if (!retailerId) return 'general';
  const { data, error } = await supabase
    .from('retailers' as never)
    .select('retailer_category')
    .eq('id', retailerId)
    .maybeSingle<{ retailer_category: string | null }>();
  if (error) throw new Error('Retailer pricing category could not be loaded. Please try again.');
  return normalizeRetailerCategory(data?.retailer_category);
}

interface CategoryPriceRow {
  product_pack_id: string;
  retailer_category: RetailerCategory;
  price_per_piece: number;
}

/**
 * Effective per-piece category price for each pack that has one.
 * Own category wins; general is the fallback; absent means "no category
 * pricing configured" (the legacy slab / case-price rules still apply).
 */
export async function loadCategoryPriceMap(
  supabase: ReturnType<typeof createClient>,
  packIds: string[],
  category: RetailerCategory
): Promise<Map<string, number>> {
  const unique = [...new Set(packIds.filter(Boolean))];
  const result = new Map<string, number>();
  if (unique.length === 0) return result;

  const rows: CategoryPriceRow[] = [];
  for (let index = 0; index < unique.length; index += PRICE_CHUNK) {
    const chunk = unique.slice(index, index + PRICE_CHUNK);
    const { data, error } = await supabase
      .from('product_tier_prices' as never)
      .select('product_pack_id, retailer_category, price_per_piece')
      .in('product_pack_id', chunk)
      .in('retailer_category', category === 'general' ? ['general'] : [category, 'general'])
      .eq('is_active', true)
      .returns<CategoryPriceRow[]>();
    if (error) {
      // A pricing read failure must never silently fall back to a cheaper or
      // more expensive price: the caller surfaces it as a read failure.
      throw new Error('Retailer category prices could not be loaded. Please try again.');
    }
    rows.push(...(data ?? []));
  }

  const byPack = new Map<string, { general?: number | null; silver?: number | null; gold?: number | null }>();
  for (const row of rows) {
    const entry = byPack.get(row.product_pack_id) ?? {};
    entry[row.retailer_category] = Number(row.price_per_piece);
    byPack.set(row.product_pack_id, entry);
  }
  for (const [packId, prices] of byPack) {
    const resolved = resolveCategoryPiecePrice(category, prices);
    if (resolved !== null) result.set(packId, resolved);
  }
  return result;
}

/** Convenience: retailer id -> effective category price map for the packs. */
export async function loadEffectiveCategoryPrices(
  supabase: ReturnType<typeof createClient>,
  packIds: string[],
  retailerId: string | null | undefined
): Promise<{ category: RetailerCategory; prices: Map<string, number> }> {
  if (!retailerId || packIds.length === 0) {
    return { category: 'general', prices: new Map() };
  }
  const category = await loadRetailerCategory(supabase, retailerId);
  const prices = await loadCategoryPriceMap(supabase, packIds, category);
  return { category, prices };
}
