import 'server-only';

import type { createClient } from '@/lib/supabase/server';

/**
 * Products per category and per brand, derived from REAL product rows — the one
 * implementation of "how many products sit under this taxonomy row" for every
 * surface in the app.
 *
 * WHY THIS MODULE EXISTS (the outage it prevents)
 * ----------------------------------------------
 * The taxonomy reads used to count children with the PostgREST aggregate
 * embed:
 *
 *     categories?select=id,name,image_url,parent_id,products(count)
 *                &products.is_active=eq.true
 *     brands?select=id,name,logo_url,products(count)&products.is_active=eq.true
 *
 * Two things are wrong with that shape, and both are silent:
 *
 *   1. `products(count)` is an OPTIONAL PostgREST capability
 *      (`db-aggregates-enabled`, off by default; error `PGRST123` — "Aggregate
 *      functions are disabled", HTTP 400). Where it is not enabled the request
 *      fails AS A WHOLE, so the taxonomy disappears along with its counts: an
 *      admin cannot open the Categories/Brands screens at all, and a retailer's
 *      catalog shows no categories or brands even though the rows exist.
 *   2. A filter on an embedded resource (`products.is_active`) narrows the
 *      PARENT rows (or the embed) rather than cleanly counting children — a
 *      brand that has no active product yet is exactly the row an admin just
 *      created, and it was the one that disappeared.
 *
 * So counts are computed here from plain columns of the products table, with
 * the same query shape every other read in this codebase uses (plain columns,
 * optional `is_active`, keyset continuation on the unique `id`, an RLS-scoped
 * caller client). A scan that cannot complete returns `null`: an incomplete
 * count is UNKNOWN, never zero, and callers render "unknown" rather than
 * claiming a shelf is empty.
 *
 * `activeOnly` is the only difference between the surfaces that use it:
 *   - a RETAILER sees only active products (their catalog is the active
 *     catalog), so retailer/mobile counts pass `activeOnly: true`;
 *   - an ADMIN sees every product too (0005 `is_active or is_staff_or_above()`),
 *     and what an operator needs before deactivating a category is the real
 *     number of linked rows — active or not — so the admin lists pass
 *     `activeOnly: false`.
 */

type SupabaseClient = ReturnType<typeof createClient>;

/** How many product rows one count-scan page reads. */
export const TAXONOMY_COUNT_PAGE_SIZE = 500;

/**
 * How many pages the scan reads before counts become UNKNOWN.
 *
 * The scan reads two small uuid columns over products, so it is exact for any
 * catalogue up to `pageSize * maxPages` rows. Past that bound the counts are
 * reported as `null` — never a truncated sum.
 */
export const TAXONOMY_COUNT_MAX_PAGES = 10;

export interface TaxonomyProductCounts {
  categories: Map<string, number>;
  brands: Map<string, number>;
  /** Rows actually read — the honest denominator behind the counts. */
  scanned: number;
}

export interface TaxonomyCountOptions {
  /** Count only `is_active` products. Defaults to true (the retailer scope). */
  activeOnly?: boolean;
  pageSize?: number;
  maxPages?: number;
}

interface ProductScopeRow {
  id: string;
  category_id: string | null;
  brand_id: string | null;
}

/**
 * Bounded keyset scan over products, grouping the rows by category and brand.
 * `null` means the scan could not complete (a failed request, or a catalogue
 * larger than the bound).
 */
async function scanProductCounts(
  supabase: SupabaseClient,
  categoryIds: string[] | null,
  options: TaxonomyCountOptions
): Promise<TaxonomyProductCounts | null> {
  const activeOnly = options.activeOnly ?? true;
  const pageSize = Math.max(1, Math.trunc(options.pageSize ?? TAXONOMY_COUNT_PAGE_SIZE));
  const maxPages = Math.max(1, Math.trunc(options.maxPages ?? TAXONOMY_COUNT_MAX_PAGES));

  const categories = new Map<string, number>();
  const brands = new Map<string, number>();
  let cursor: string | null = null;
  let scanned = 0;

  for (let page = 0; page < maxPages; page += 1) {
    let query = supabase.from('products').select('id, category_id, brand_id');
    if (activeOnly) query = query.eq('is_active', true);
    if (categoryIds) {
      // An empty scope can never match a row; short-circuit instead of asking
      // PostgREST for `in.()`.
      if (categoryIds.length === 0) return { categories, brands, scanned };
      query = query.in('category_id', categoryIds);
    }
    query = query.order('id').limit(pageSize);
    if (cursor !== null) query = query.gt('id', cursor);

    const { data, error } = await query.returns<ProductScopeRow[]>();
    if (error) return null;

    const rows = data ?? [];
    scanned += rows.length;
    for (const row of rows) {
      if (row.category_id) categories.set(row.category_id, (categories.get(row.category_id) ?? 0) + 1);
      if (row.brand_id) brands.set(row.brand_id, (brands.get(row.brand_id) ?? 0) + 1);
    }

    if (rows.length < pageSize) return { categories, brands, scanned };
    cursor = rows[rows.length - 1]!.id;
  }

  // The bound was reached: the catalogue is bigger than this scan, so no count
  // can be claimed.
  return null;
}

/** Count products per category and per brand across the whole catalogue. */
export function loadTaxonomyProductCounts(
  supabase: SupabaseClient,
  options: TaxonomyCountOptions = {}
): Promise<TaxonomyProductCounts | null> {
  return scanProductCounts(supabase, null, options);
}

/**
 * The same counts, restricted to a category scope (a category plus its active
 * children) — what a category page needs for its subcategory tiles, its total
 * and its brand list.
 */
export function loadScopedProductCounts(
  supabase: SupabaseClient,
  categoryIds: string[],
  options: TaxonomyCountOptions = {}
): Promise<TaxonomyProductCounts | null> {
  return scanProductCounts(supabase, categoryIds, options);
}

/**
 * The count for one taxonomy row, from a possibly-unknown counts map.
 * A missing map (scan failed) and a missing key (nothing linked) are different
 * facts: the first is unknown, the second is a real zero.
 */
export function countFor(counts: Map<string, number> | null | undefined, id: string): number | null {
  if (!counts) return null;
  return counts.get(id) ?? 0;
}
