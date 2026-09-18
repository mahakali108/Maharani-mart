import 'server-only';

import type { createClient } from '@/lib/supabase/server';

/**
 * Category ↔ brand taxonomy helpers.
 *
 * There is no new schema: a product already carries BOTH `category_id` and
 * `brand_id` (migration 0001_init), so "which brands exist in this category" is
 * derived from the real active products in that category scope — never from an
 * invented relationship, and never from all brands.
 *
 * The scope rule is the one the catalog filter already uses: a parent category
 * includes its active immediate children (see `homeCategories` in
 * lib/retailer/home-data.ts and the `category_id.in(...)` filter in
 * lib/retailer/catalog-feed.ts).
 */

/** Bound on how many active products one category-scope scan reads. */
export const CATEGORY_BRAND_SCAN_LIMIT = 1000;

export interface TaxonomyCategory {
  id: string;
  parent_id: string | null;
}

/**
 * Ids whose products belong to a selected category: the category itself plus
 * its immediate children. An empty selection means "no scope" (all products).
 */
export function categoryScopeIds(categories: TaxonomyCategory[], selectedId: string | null | undefined): string[] {
  if (!selectedId) return [];
  if (!categories.some((category) => category.id === selectedId)) return [];
  return [
    selectedId,
    ...categories.filter((category) => category.parent_id === selectedId).map((category) => category.id),
  ];
}

/**
 * Brand rows that actually have products in the given counts, most-used first
 * (then name) so the retailer sees the relevant brands at the top.
 */
export function orderBrandsByCount<T extends { id: string; name: string }>(
  brands: T[],
  counts: Map<string, number>
): { brand: T; count: number }[] {
  return brands
    .filter((brand) => counts.has(brand.id))
    .map((brand) => ({ brand, count: counts.get(brand.id) ?? 0 }))
    .sort((a, b) => b.count - a.count || a.brand.name.localeCompare(b.brand.name));
}

export interface CategoryBrandCounts {
  counts: Map<string, number>;
  /** True when the scan hit its bound, so counts are a lower bound only. */
  capped: boolean;
}

/**
 * Real per-brand product counts for one category scope, read from active
 * products. Bounded: a huge category costs one bounded read, never a full scan.
 * Products with no brand are ignored (they cannot be browsed by brand).
 */
export async function loadCategoryBrandCounts(
  supabase: ReturnType<typeof createClient>,
  categoryIds: string[],
  limit: number = CATEGORY_BRAND_SCAN_LIMIT
): Promise<CategoryBrandCounts> {
  const counts = new Map<string, number>();
  if (categoryIds.length === 0) return { counts, capped: false };
  const { data } = await supabase
    .from('products')
    .select('brand_id')
    .eq('is_active', true)
    .in('category_id', categoryIds)
    .limit(limit)
    .returns<{ brand_id: string | null }[]>();
  const rows = data ?? [];
  for (const row of rows) {
    if (!row.brand_id) continue;
    counts.set(row.brand_id, (counts.get(row.brand_id) ?? 0) + 1);
  }
  return { counts, capped: rows.length >= limit };
}
