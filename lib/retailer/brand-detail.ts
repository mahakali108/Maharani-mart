import 'server-only';

import { cursorOffset, offsetCursorFor } from '@/lib/infinite-scroll/keyset';
import type { ListCursor } from '@/lib/infinite-scroll/cursor';

import type { createClient } from '@/lib/supabase/server';
import { countFor, loadScopedProductCounts, loadTaxonomyProductCounts } from '@/lib/retailer/taxonomy-counts';
import {
  loadCatalogPricing,
  loadFavoriteIds,
  priceCatalogRows,
  PRODUCT_CARD_SELECT,
  toPricedCard,
  type CatalogProductRow,
  type PricedCatalogCard,
} from '@/lib/retailer/catalog';

/**
 * Brand browsing for the retailer app.
 *
 * All rows come from the real `brands` rows and the real `products` rows, and
 * every count is a count of ACTIVE products — never invented.
 *
 * The directory read is PLAIN COLUMNS. It used to embed
 * `products ( id, category_id )` and filter it with `products.is_active=true`,
 * which is not a safe way to count children: an embedded-resource filter also
 * narrows the parent rows, so a brand with no active product yet — the brand an
 * admin has just created — was missing from the catalog entirely. Counts now
 * come from `loadTaxonomyProductCounts` / `loadScopedProductCounts` over real
 * product rows, so every active brand is listed (with `0` when it genuinely has
 * no active product, and `undefined` when the count could not be read).
 *
 * When a category filter is requested the list is restricted to brands carrying
 * active products inside that category's scope (the category plus its active
 * children, matching the catalog's `?category=` convention), and the shown
 * count is scoped to that same set.
 */

const BRAND_PAGE_SIZE = 24;
/** Hard cap for the brand product working set (same convention as the catalog). */
const BRAND_MAX_ROWS = 240;

interface CategoryRow {
  id: string;
  name: string;
  parent_id: string | null;
  is_active: boolean;
}

interface BrandDirectoryRow {
  id: string;
  name: string;
  logo_url: string | null;
}

export interface BrandDirectoryData {
  brands: { id: string; name: string; logo_url: string | null; productCount: number | undefined }[];
  categories: { id: string; name: string; parent_id: string | null }[];
  error: boolean;
}

/**
 * Loads the brand directory. `categoryId` (optional) restricts the list to
 * brands present in that category's scope and scopes the product counts.
 */
export async function loadBrandDirectory(
  supabase: Awaited<ReturnType<typeof createClient>>,
  categoryId?: string
): Promise<BrandDirectoryData> {
  const [brandResult, categoryResult, globalCounts] = await Promise.all([
    // Plain columns. No embedded products and no embedded-resource filter: a
    // brand with no active product yet must still be listed.
    supabase
      .from('brands')
      .select('id, name, logo_url')
      .eq('is_active', true)
      .order('name')
      .returns<BrandDirectoryRow[]>(),
    supabase
      .from('categories')
      .select('id, name, parent_id, is_active')
      .eq('is_active', true)
      .order('sort_order')
      .returns<CategoryRow[]>(),
    loadTaxonomyProductCounts(supabase),
  ]);

  const categories = (categoryResult.data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    parent_id: row.parent_id,
  }));
  const error = !!brandResult.error;
  if (error) return { brands: [], categories, error: true };

  // No filter: EVERY active brand, with its active product count (0 when it has
  // none — a fresh brand is not an absent brand).
  if (!categoryId) {
    const brands = (brandResult.data ?? []).map((brand) => ({
      id: brand.id,
      name: brand.name,
      logo_url: brand.logo_url,
      productCount: countFor(globalCounts?.brands ?? null, brand.id) ?? undefined,
    }));
    return { brands, categories, error: false };
  }

  // Category filter: the scope is the category plus its active children.
  const category = (categoryResult.data ?? []).find((row) => row.id === categoryId);
  if (!category) return { brands: [], categories, error: false };
  const scopeIds = new Set<string>([categoryId]);
  for (const row of categoryResult.data ?? []) {
    if (row.parent_id === categoryId && row.is_active) scopeIds.add(row.id);
  }

  const scopedCounts = await loadScopedProductCounts(supabase, [...scopeIds]);
  if (!scopedCounts) return { brands: [], categories, error: true };
  const scopedByBrand = scopedCounts.brands;

  const brands = (brandResult.data ?? [])
    .map((brand) => {
      const count = scopedByBrand.get(brand.id);
      if (count === undefined || count === 0) return null;
      return { id: brand.id, name: brand.name, logo_url: brand.logo_url, productCount: count };
    })
    .filter((brand): brand is { id: string; name: string; logo_url: string | null; productCount: number } => brand !== null)
    .sort((a, b) => b.productCount - a.productCount || a.name.localeCompare(b.name));

  return { brands, categories, error: false };
}

export interface BrandDetailData {
  brand: { id: string; name: string; logo_url: string | null } | null;
  productCount: number | null;
  products: PricedCatalogCard[];
  /** True when the brand has products but pricing could not be resolved. */
  pricingUnavailable: boolean;
  /** Opaque cursor for the next batch; `null` when the brand is fully listed. */
  nextCursor: string | null;
  hasMore: boolean;
  resultCapped: boolean;
  errors: { brand: boolean; catalog: boolean; pricing: boolean };
}

/**
 * Loads one batch of a brand's active products with the retailer's own resolved
 * pricing (the same canonical engine the catalog uses).
 *
 * The brand page lists a bounded working set of at most BRAND_MAX_ROWS products
 * (new launches first, then name) and streams it to the browser in
 * BRAND_PAGE_SIZE batches, so a brand with hundreds of SKUs still costs one
 * bounded query plus one pricing resolution per batch — never the whole set at
 * once, and never a page number in the URL.
 */
export async function loadBrandProducts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  retailerId: string,
  areaId: string | null,
  brandId: string,
  cursor: ListCursor | null,
  canResolvePrices = true
): Promise<BrandDetailData> {
  const offset = cursorOffset(cursor);
  const errors = { brand: false, catalog: false, pricing: false };
  const base = {
    brand: null as BrandDetailData['brand'],
    productCount: null as number | null,
    products: [] as PricedCatalogCard[],
    pricingUnavailable: false,
    nextCursor: null as string | null,
    hasMore: false,
    resultCapped: false,
  };
  if (!brandId) return { ...base, errors: { ...errors, brand: true } };

  const brandResult = await supabase
    .from('brands')
    .select('id, name, logo_url')
    .eq('id', brandId)
    .eq('is_active', true)
    .maybeSingle<{ id: string; name: string; logo_url: string | null }>();
  if (brandResult.error) errors.brand = true;
  const brand = brandResult.data ?? null;
  if (!brand) return { ...base, errors };

  const { data: productRows, count } = await supabase
    .from('products')
    .select(PRODUCT_CARD_SELECT, { count: 'exact' })
    .eq('is_active', true)
    .eq('brand_id', brandId)
    .order('is_new_launch', { ascending: false })
    .order('name', { ascending: true })
    .limit(BRAND_MAX_ROWS)
    .returns<CatalogProductRow[]>();
  if (productRows === null) errors.catalog = true;

  const rows = productRows ?? [];
  const resultCapped = (count ?? 0) > BRAND_MAX_ROWS;
  // One extra row is the probe that says whether another batch exists.
  const paged = rows.slice(offset, offset + BRAND_PAGE_SIZE);
  const hasMore = rows.length > offset + BRAND_PAGE_SIZE;
  const nextCursor = hasMore ? offsetCursorFor(offset, BRAND_PAGE_SIZE) : null;

  let products: PricedCatalogCard[] = [];
  let pricingUnavailable = false;
  if (paged.length > 0) {
    const favoriteIds = await loadFavoriteIds(supabase, retailerId);
    let pricingData: Awaited<ReturnType<typeof loadCatalogPricing>> | null = null;
    if (canResolvePrices) {
      try {
        pricingData = await loadCatalogPricing(supabase, paged, retailerId, areaId);
      } catch {
        errors.pricing = true;
      }
    } else {
      errors.pricing = true;
    }
    pricingUnavailable = !pricingData;
    products = pricingData
      ? priceCatalogRows(paged, pricingData, favoriteIds)
      : paged.map((row) => toPricedCard(row, null, { pricingUnavailable: true, isFavorite: favoriteIds.has(row.id) }));
  }

  return {
    brand: { id: brand.id, name: brand.name, logo_url: brand.logo_url },
    productCount: count ?? (rows.length > 0 ? rows.length : 0),
    products,
    pricingUnavailable,
    nextCursor,
    hasMore,
    resultCapped,
    errors,
  };
}
