import 'server-only';

import type { createClient } from '@/lib/supabase/server';
import {
  ADMIN_DERIVED_LOOKUP_LIMIT,
  type AdminCatalogParams,
} from '@/lib/admin/catalog-query';

/**
 * Server-side data loading for the admin product list.
 *
 * The list has two honest modes, mirroring the retailer catalog
 * (lib/retailer/catalog-params.ts):
 *
 *   MODE 1 — DB PAGINATED. Every active filter and the sort are expressible in
 *   SQL, so `.range()` + `count: 'exact'` return the real page and the real
 *   total. This is the default path.
 *
 *   MODE 2 — BOUNDED WORKING SET. Stock status, sales, margin and MOQ are not
 *   columns on `products`: per-pack stock comes from the Admin-only accessor,
 *   sales from `catalog_product_sales` (0050) and cost from `admin_product_costs()`
 *   (0050 — 0025 revokes direct `SELECT (cost_price)`). Pushing those into the
 *   product query is not possible through PostgREST, so the working set is
 *   fetched up to `ADMIN_DERIVED_LOOKUP_LIMIT`, resolved and ordered in memory,
 *   and the UI says so when the cap binds rather than truncating quietly.
 *
 * Nothing here invents a number. A helper that fails to load leaves its map
 * empty, and the UI renders "—" for that cell instead of a plausible guess.
 */

type SupabaseClient = ReturnType<typeof createClient>;

/** Columns the admin list reads directly from `products` plus its relations. */
export const ADMIN_PRODUCT_SELECT =
  'id, name, unit, lead_time_days, base_price, gst_percent, hsn_code, barcode, is_active, is_new_launch, updated_at, created_at, brand_id, category_id, ' +
  'brands ( id, name ), categories ( id, name ), product_images ( image_url ), ' +
  'product_packs ( id, pack_name, pack_sku_code, sort_order, moq, case_price, units_per_case, is_active )';

export interface AdminProductRow {
  id: string;
  name: string;
  unit: string;
  lead_time_days: number;
  base_price: number;
  gst_percent: number;
  hsn_code: string | null;
  barcode: string | null;
  is_active: boolean;
  is_new_launch: boolean;
  created_at: string;
  updated_at: string;
  brand_id: string | null;
  category_id: string | null;
  brands: { id: string; name: string } | null;
  categories: { id: string; name: string } | null;
  product_images: { image_url: string }[];
  product_packs: {
    id: string;
    pack_name: string;
    pack_sku_code: string;
    sort_order: number;
    moq: number;
    case_price: number;
    units_per_case: number;
    is_active: boolean;
  }[];
}

export interface StockInfo {
  status: 'in_stock' | 'out_of_stock';
  available: number;
  packId: string;
  packName: string;
  skuCode: string;
}

export interface AdminPackStockInfo {
  packId: string;
  packName: string;
  skuCode: string;
  price: number;
  quantity: number | null;
  status: 'in_stock' | 'out_of_stock' | 'unknown';
  active: boolean;
}

export interface SalesInfo {
  units30d: number;
  orders30d: number;
  revenue30d: number;
}

/** Lowest active pack MOQ for a product; null when it has no active pack. */
export function productMoq(row: Pick<AdminProductRow, 'product_packs'>): number | null {
  const active = row.product_packs.filter((pack) => pack.is_active);
  if (active.length === 0) return null;
  return Math.min(...active.map((pack) => pack.moq));
}

/** Cheapest active pack case price; null when a product has no active pack. */
export function productCasePrice(row: Pick<AdminProductRow, 'product_packs'>): number | null {
  const active = row.product_packs.filter((pack) => pack.is_active);
  if (active.length === 0) return null;
  return Math.min(...active.map((pack) => pack.case_price));
}

/**
 * Margin percentage on the GST-INCLUSIVE derived piece price.
 *
 * `cost_price` is per piece (the product form labels it "Cost / purchase price"
 * beside "MRP (₹) per piece"), so it is compared with
 * `case_price / units_per_case`. A non-positive cost yields null: a margin
 * against a zero cost is infinite, not 100%, and showing either would be a lie.
 */
export function marginPercent(
  casePrice: number | null,
  unitsPerCase: number | null,
  costPrice: number | null
): number | null {
  if (casePrice === null || !unitsPerCase || unitsPerCase <= 0) return null;
  if (costPrice === null || costPrice <= 0) return null;
  const piece = casePrice / unitsPerCase;
  return Math.round(((piece - costPrice) / piece) * 10000) / 100;
}

/** The first active pack is the product's default sellable row for list stock/SKU. */
export function defaultActivePack(row: Pick<AdminProductRow, 'product_packs'>) {
  return [...row.product_packs]
    .filter((pack) => pack.is_active)
    .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id))[0] ?? null;
}

/** Stock comes from the Admin-only pack-count RPC, never a warehouse aggregate. */
export function productStock(
  row: Pick<AdminProductRow, 'product_packs'>,
  stockByPackId: Map<string, number>
): StockInfo | null {
  const pack = defaultActivePack(row);
  if (!pack) return null;
  const available = stockByPackId.get(pack.id);
  if (available === undefined) return null;
  return {
    status: available > 0 ? 'in_stock' : 'out_of_stock',
    available,
    packId: pack.id,
    packName: pack.pack_name,
    skuCode: pack.pack_sku_code,
  };
}

/**
 * Real sales per product from `catalog_product_sales` (0050), which aggregates
 * `order_items` over non-cancelled orders. Empty until real orders exist.
 */
export async function loadSalesMap(
  supabase: SupabaseClient,
  limit: number = ADMIN_DERIVED_LOOKUP_LIMIT
): Promise<Map<string, SalesInfo>> {
  const map = new Map<string, SalesInfo>();
  const { data, error } = await supabase
    .from('catalog_product_sales' as never)
    .select('product_id, units_30d, orders_30d, revenue_30d')
    .order('units_30d', { ascending: false })
    .limit(limit)
    .returns<{ product_id: string; units_30d: number; orders_30d: number; revenue_30d: number }[]>();
  if (error) return map;
  for (const row of data ?? []) {
    map.set(row.product_id, {
      units30d: Number(row.units_30d ?? 0),
      orders30d: Number(row.orders_30d ?? 0),
      revenue30d: Number(row.revenue_30d ?? 0),
    });
  }
  return map;
}

/**
 * Purchase cost per product via the batched admin-only accessor added in 0050.
 * Returns an empty map for anyone below admin — the SQL function itself returns
 * zero rows for them, so this can never leak a margin to staff or salesman.
 */
export async function loadCostMap(supabase: SupabaseClient): Promise<Map<string, number | null>> {
  const map = new Map<string, number | null>();
  const { data, error } = await supabase.rpc('admin_product_costs' as never);
  if (error) return map;
  for (const row of (data ?? []) as { product_id: string; cost_price: number | null }[]) {
    map.set(row.product_id, row.cost_price);
  }
  return map;
}

/** Exact pack counts are available only to Admin/super_admin via the guarded RPC. */
export async function loadStockMap(
  supabase: SupabaseClient,
  productIds: string[],
  canViewStock: boolean
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!canViewStock) return map;
  const ids = [...new Set(productIds)];
  for (let i = 0; i < ids.length; i += 1000) {
    const { data, error } = await supabase.rpc('admin_product_pack_stock' as never, {
      p_product_ids: ids.slice(i, i + 1000),
    } as never);
    if (error) continue;
    for (const row of (data ?? []) as { product_id: string; pack_id: string; stock_quantity: number }[]) {
      map.set(row.pack_id, Number(row.stock_quantity));
    }
  }
  return map;
}

/**
 * Build the `.or()` clause for a search term.
 *
 * `q` has already been stripped of LIKE wildcards and quotes by
 * `sanitizeAdminSearch`, so interpolating it into a PostgREST disjunction is
 * safe. Which fields are searched depends on the `field` selector; `all` also
 * folds in the brand/category/pack matches the page resolved separately.
 */
export function buildSearchClause(params: AdminCatalogParams, relatedIds: {
  brandIds: string[];
  categoryIds: string[];
  packProductIds: string[];
}): string | null {
  if (!params.q) return null;
  const like = `"%${params.q}%"`;

  if (params.field === 'barcode') return `barcode.ilike.${like}`;
  if (params.field === 'hsn') return `hsn_code.ilike.${like}`;
  if (params.field === 'name') return `name.ilike.${like}`;
  // `sku` lives on product_packs, so it can only be expressed as the id set the
  // caller resolved with loadSearchRelatedIds(supabase, q, 'sku').
  if (params.field === 'sku') {
    return relatedIds.packProductIds.length > 0 ? `id.in.(${relatedIds.packProductIds.join(',')})` : null;
  }

  const clauses = [`name.ilike.${like}`, `barcode.ilike.${like}`, `hsn_code.ilike.${like}`];
  if (relatedIds.brandIds.length > 0) clauses.push(`brand_id.in.(${relatedIds.brandIds.join(',')})`);
  if (relatedIds.categoryIds.length > 0) clauses.push(`category_id.in.(${relatedIds.categoryIds.join(',')})`);
  if (relatedIds.packProductIds.length > 0) clauses.push(`id.in.(${relatedIds.packProductIds.join(',')})`);
  return clauses.join(',');
}

/**
 * True when the active search provably matches nothing.
 *
 * This matters for `field='sku'`: the variant SKU lives on `product_packs`, so
 * it can only be applied as `id.in.(<resolved ids>)`. When that resolution comes
 * back empty, `buildSearchClause` returns null — which every caller reads as
 * "no filter". Without this predicate a SKU search for a code that does not
 * exist would return the ENTIRE catalog, which is the opposite of what was
 * asked. Same idea as the retailer catalog's `noPossibleResults` short-circuit.
 */
export function searchMatchesNothing(
  params: { q: string; field: string },
  relatedIds: { packProductIds: string[] }
): boolean {
  return Boolean(params.q) && params.field === 'sku' && relatedIds.packProductIds.length === 0;
}

/** Bound on how many variant/barcode matches are folded into the disjunction. */
export const ADMIN_RELATED_MATCH_LIMIT = 200;

/** Which product_packs columns a search term should be matched against. */
export type PackSearchScope = 'all' | 'sku';

/**
 * Resolve brand names, category names and variant labels that match the search
 * term, so "Tata" finds products whose BRAND is Tata and "500g" finds products
 * that have a 500g variant.
 *
 * `scope='sku'` narrows the pack lookup to `pack_sku_code` alone and skips the
 * brand/category lookups, which is what the "Variant SKU" search field needs.
 * The PRODUCT-level `products.sku_code` is never searched: migration 0023
 * removed it from the workflow and no surface displays it.
 */
export async function loadSearchRelatedIds(
  supabase: SupabaseClient,
  term: string,
  scope: PackSearchScope = 'all'
): Promise<{ brandIds: string[]; categoryIds: string[]; packProductIds: string[] }> {
  const empty = { brandIds: [], categoryIds: [], packProductIds: [] };
  if (!term) return empty;
  const like = `%${term}%`;
  const packClause =
    scope === 'sku'
      ? `pack_sku_code.ilike.${like}`
      : `pack_name.ilike.${like},barcode.ilike.${like},pack_sku_code.ilike.${like}`;
  const [{ data: brandMatches }, { data: categoryMatches }, { data: packMatches }] = await Promise.all([
    scope === 'sku'
      ? Promise.resolve({ data: [] as { id: string }[] })
      : supabase.from('brands').select('id').ilike('name', like).limit(ADMIN_RELATED_MATCH_LIMIT).returns<{ id: string }[]>(),
    scope === 'sku'
      ? Promise.resolve({ data: [] as { id: string }[] })
      : supabase.from('categories').select('id').ilike('name', like).limit(ADMIN_RELATED_MATCH_LIMIT).returns<{ id: string }[]>(),
    supabase
      .from('product_packs')
      .select('product_id')
      .or(packClause)
      .limit(ADMIN_RELATED_MATCH_LIMIT)
      .returns<{ product_id: string }[]>(),
  ]);
  return {
    brandIds: (brandMatches ?? []).map((row) => row.id),
    categoryIds: (categoryMatches ?? []).map((row) => row.id),
    packProductIds: [...new Set((packMatches ?? []).map((row) => row.product_id))].slice(
      0,
      ADMIN_RELATED_MATCH_LIMIT
    ),
  };
}

/** One row of the resolved admin list, with every derived value attached. */
export interface ResolvedAdminProduct extends AdminProductRow {
  moq: number | null;
  casePrice: number | null;
  stock: StockInfo | null;
  /** Full, pack-scoped stock rows for Admin display and CSV export. */
  packStocks: AdminPackStockInfo[];
  sales: SalesInfo | null;
  costPrice: number | null;
  margin: number | null;
}

export function resolveAdminProducts(
  rows: AdminProductRow[],
  data: {
    sales: Map<string, SalesInfo>;
    costs: Map<string, number | null>;
    /** Pack quantities are supplied only to an Admin-authorized caller. */
    packStock: Map<string, number>;
    /** false hides cost and margin entirely — the map is not even loaded. */
    includeCost: boolean;
  }
): ResolvedAdminProduct[] {
  return rows.map((row) => {
    const packs = row.product_packs;
    const active = packs.filter((pack) => pack.is_active);
    const moq = productMoq(row);
    const casePrice = productCasePrice(row);
    const cheapest = active.length > 0
      ? active.reduce((best, pack) => (pack.case_price < best.case_price ? pack : best), active[0]!)
      : null;
    const costPrice = data.includeCost ? (data.costs.get(row.id) ?? null) : null;
    return {
      ...row,
      moq,
      casePrice,
      stock: productStock(row, data.packStock),
      packStocks: packs
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id))
        .map((pack) => {
          const quantity = data.packStock.get(pack.id) ?? null;
          return {
            packId: pack.id,
            packName: pack.pack_name,
            skuCode: pack.pack_sku_code,
            price: pack.case_price,
            quantity,
            status: quantity === null ? 'unknown' : quantity > 0 ? 'in_stock' : 'out_of_stock',
            active: pack.is_active,
          };
        }),
      sales: data.sales.get(row.id) ?? null,
      costPrice,
      margin: marginPercent(casePrice, cheapest?.units_per_case ?? null, costPrice),
    };
  });
}

/** Does this resolved row satisfy the derived (non-SQL) filters? */
export function matchesDerivedFilters(row: ResolvedAdminProduct, params: AdminCatalogParams): boolean {
  if (params.stock !== 'all') {
    if (!row.stock) return false;
    if (row.stock.status !== params.stock) return false;
  }
  if (params.maxStock !== null) {
    if (!row.stock) return false;
    if (row.stock.available > params.maxStock) return false;
  }
  if (params.minMoq !== null) {
    if (row.moq === null || row.moq < params.minMoq) return false;
  }
  if (params.maxMoq !== null) {
    if (row.moq === null || row.moq > params.maxMoq) return false;
  }
  return true;
}

/** Order resolved rows for the derived sorts. Stable: ties fall back to name. */
export function sortResolvedProducts(rows: ResolvedAdminProduct[], sort: AdminCatalogParams['sort']): ResolvedAdminProduct[] {
  const byName = (a: ResolvedAdminProduct, b: ResolvedAdminProduct) => a.name.localeCompare(b.name);
  const sorted = [...rows];
  switch (sort) {
    case 'stock-low':
      // Unknown stock sorts last: an unreadable number must not masquerade as 0.
      sorted.sort((a, b) => (a.stock?.available ?? Infinity) - (b.stock?.available ?? Infinity) || byName(a, b));
      break;
    case 'sales':
      sorted.sort((a, b) => (b.sales?.units30d ?? -1) - (a.sales?.units30d ?? -1) || byName(a, b));
      break;
    case 'margin-high':
      sorted.sort((a, b) => (b.margin ?? -Infinity) - (a.margin ?? -Infinity) || byName(a, b));
      break;
    default:
      sorted.sort(byName);
  }
  return sorted;
}
