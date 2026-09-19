import 'server-only';

import type { createClient } from '@/lib/supabase/server';
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
 * All rows come from the real `brands` → `products` relationship and only
 * active rows are returned. Product counts are counts of ACTIVE products —
 * never invented. When a category filter is requested the brand list is
 * restricted to brands carrying active products inside that category's scope
 * (the category plus its active children, matching the catalog's
 * `?category=` convention), and the shown count is scoped to that same set.
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
  products: { id: string; category_id: string | null }[] | null;
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
  supabase: ReturnType<typeof createClient>,
  categoryId?: string
): Promise<BrandDirectoryData> {
  const [brandResult, categoryResult] = await Promise.all([
    supabase
      .from('brands')
      .select('id, name, logo_url, products ( id, category_id )')
      .eq('is_active', true)
      .eq('products.is_active', true)
      .order('name')
      .returns<BrandDirectoryRow[]>(),
    supabase
      .from('categories')
      .select('id, name, parent_id, is_active')
      .eq('is_active', true)
      .order('sort_order')
      .returns<CategoryRow[]>(),
  ]);

  const categories = (categoryResult.data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    parent_id: row.parent_id,
  }));
  const error = !!brandResult.error;
  if (error) return { brands: [], categories, error: true };

  // No filter: every active brand with its active product count.
  if (!categoryId) {
    const brands = (brandResult.data ?? []).map((brand) => ({
      id: brand.id,
      name: brand.name,
      logo_url: brand.logo_url,
      productCount: brand.products ? brand.products.length : undefined,
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

  const scopeResult = await supabase
    .from('products')
    .select('id, brand_id, category_id')
    .eq('is_active', true)
    .in('category_id', [...scopeIds])
    .returns<{ id: string; brand_id: string | null; category_id: string | null }[]>();
  if (scopeResult.error) return { brands: [], categories, error: true };

  const scopedByBrand = new Map<string, number>();
  for (const row of scopeResult.data ?? []) {
    if (!row.brand_id || !row.category_id || !scopeIds.has(row.category_id)) continue;
    scopedByBrand.set(row.brand_id, (scopedByBrand.get(row.brand_id) ?? 0) + 1);
  }

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
  page: number;
  totalPages: number;
  resultCapped: boolean;
  errors: { brand: boolean; catalog: boolean; pricing: boolean };
}

/**
 * Loads one brand's active products with the retailer's own resolved pricing
 * (the same canonical engine the catalog uses). Paginates over a bounded
 * working set — no unbounded fetches.
 */
export async function loadBrandProducts(
  supabase: ReturnType<typeof createClient>,
  retailerId: string,
  areaId: string | null,
  brandId: string,
  page: number,
  canResolvePrices = true
): Promise<BrandDetailData> {
  const safePage = Math.max(1, Math.floor(page) || 1);
  const errors = { brand: false, catalog: false, pricing: false };
  const base = {
    brand: null as BrandDetailData['brand'],
    productCount: null as number | null,
    products: [] as PricedCatalogCard[],
    pricingUnavailable: false,
    page: safePage,
    totalPages: 1,
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
  const totalPages = Math.max(1, Math.ceil(rows.length / BRAND_PAGE_SIZE));
  const paged = rows.slice((safePage - 1) * BRAND_PAGE_SIZE, safePage * BRAND_PAGE_SIZE);

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
    page: safePage,
    totalPages,
    resultCapped,
    errors,
  };
}
