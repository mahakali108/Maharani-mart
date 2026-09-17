/**
 * Admin product-list query parameters — parsing, bounds and link building.
 *
 * The admin list used to read `searchParams` inline in the page: an unbounded
 * `?page=`, a name-only search, four hard-coded filters and a fixed sort. This
 * module owns that surface so the page only ever sees validated values, and so
 * the rules can be unit-tested without rendering anything
 * (tests/admin-catalog-query.test.ts).
 *
 * PURE — no Supabase, no `next/*`, no env, no secrets.
 */

/**
 * Sorts the admin product list offers.
 *
 * `stock`, `sales` and `margin` are NOT plain columns: stock comes from
 * `inventory_product_totals` (0017), sales from `catalog_product_sales` (0050)
 * and margin needs `admin_product_costs()` (0050) because 0025 revokes direct
 * `SELECT (cost_price)`. Those three are resolved into an ordered id list
 * before the page query runs — see `resolveDerivedOrder` in the page.
 */
export const ADMIN_PRODUCT_SORTS = [
  'newest',
  'oldest',
  'name',
  'name-desc',
  'price-high',
  'price-low',
  'updated',
  'stock-low',
  'sales',
  'margin-high',
] as const;

export type AdminProductSort = (typeof ADMIN_PRODUCT_SORTS)[number];

export const ADMIN_SORT_LABELS: Record<AdminProductSort, string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  name: 'Name A–Z',
  'name-desc': 'Name Z–A',
  'price-high': 'MRP high → low',
  'price-low': 'MRP low → high',
  updated: 'Recently updated',
  'stock-low': 'Lowest stock first',
  sales: 'Best selling (30 days)',
  'margin-high': 'Highest margin',
};

/** Sorts answerable by a single SQL `ORDER BY` on the `products` table. */
export const DB_SORTABLE_ADMIN_SORTS: AdminProductSort[] = [
  'newest',
  'oldest',
  'name',
  'name-desc',
  'price-high',
  'price-low',
  'updated',
];

export function isDbSortableAdminSort(sort: AdminProductSort): boolean {
  return DB_SORTABLE_ADMIN_SORTS.includes(sort);
}

/** Product lifecycle filter. The schema has only `is_active` — see migration 0050. */
export const ADMIN_STATUS_FILTERS = ['all', 'active', 'inactive'] as const;
export type AdminStatusFilter = (typeof ADMIN_STATUS_FILTERS)[number];

/** Stock states as computed by `inventory_product_totals.stock_status` (0017). */
export const ADMIN_STOCK_FILTERS = ['all', 'healthy', 'low_stock', 'out_of_stock'] as const;
export type AdminStockFilter = (typeof ADMIN_STOCK_FILTERS)[number];

export const ADMIN_STOCK_LABELS: Record<AdminStockFilter, string> = {
  all: 'Any stock',
  healthy: 'In stock',
  low_stock: 'Low stock',
  out_of_stock: 'Out of stock',
};

/** GST slab filter options, sourced from the same list the form validates against. */
export const ADMIN_GST_FILTERS = ['all', '0', '5', '12', '18', '28'] as const;
export type AdminGstFilter = (typeof ADMIN_GST_FILTERS)[number];

export const ADMIN_PAGE_SIZE = 25;

/** Bound on `?page=` so a crafted deep range cannot ask for rows 1,000,000+. */
export const ADMIN_MAX_PAGE = 500;

/**
 * Upper bound on rows pulled into memory when a derived sort or filter is
 * active (stock, sales, margin, MOQ). Those values do not live on `products`,
 * so the working set has to be resolved before it can be ordered or filtered —
 * exactly the "bounded working set" mode the retailer catalog already uses
 * (`CATALOG_MAX_ROWS`). The UI says so when the cap binds instead of silently
 * truncating.
 *
 * A distributor catalog is orders of magnitude below this; the cap exists so a
 * runaway table cannot be pulled into memory along with its packs.
 */
export const ADMIN_DERIVED_LOOKUP_LIMIT = 1000;

export interface AdminCatalogParams {
  /** Free-text search across the fields `field` selects. */
  q: string;
  /** Which fields `q` searches. `all` covers every retailer-visible field. */
  field: AdminSearchField;
  brand: string;
  category: string;
  status: AdminStatusFilter;
  stock: AdminStockFilter;
  /** GST slab as a string so `0` is distinguishable from "not set". */
  gst: AdminGstFilter;
  /** Inclusive MRP bounds, in rupees. null = unbounded. */
  minPrice: number | null;
  maxPrice: number | null;
  /** Inclusive available-stock upper bound (units). null = unbounded. */
  maxStock: number | null;
  /** Pack MOQ bounds, in pieces. null = unbounded. */
  minMoq: number | null;
  maxMoq: number | null;
  sort: AdminProductSort;
  page: number;
}

export const ADMIN_SEARCH_FIELDS = ['all', 'name', 'barcode', 'hsn'] as const;
export type AdminSearchField = (typeof ADMIN_SEARCH_FIELDS)[number];

export const ADMIN_SEARCH_FIELD_LABELS: Record<AdminSearchField, string> = {
  all: 'Everything',
  name: 'Product name',
  barcode: 'Barcode / EAN',
  hsn: 'HSN code',
};

/**
 * Strip LIKE wildcards and collapse whitespace.
 *
 * The same defence `sanitizeSearchTerm` applies on the retailer catalog: an
 * unescaped `%` or `_` in `ilike` turns a search term into a wildcard that
 * matches the entire table, and an escaped-quote attempt is neutralised by
 * removing the characters rather than by trusting the client.
 */
export function sanitizeAdminSearch(raw: string | undefined): string {
  return (raw ?? '')
    .replace(/[%_*\\"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function oneOf<T extends string>(raw: string | undefined, allowed: readonly T[], fallback: T): T {
  return allowed.includes(raw as T) ? (raw as T) : fallback;
}

/** Whole, non-negative rupee bound. Negative or non-numeric input is ignored. */
function parseBound(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100) / 100;
}

export function parseAdminSort(raw: string | undefined): AdminProductSort {
  return oneOf(raw, ADMIN_PRODUCT_SORTS, 'newest');
}

export function parseAdminPage(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(parsed, ADMIN_MAX_PAGE);
}

/** Inclusive PostgREST `.range()` bounds for a 1-based page. */
export function adminPageRange(page: number, pageSize: number = ADMIN_PAGE_SIZE) {
  const safePage = Math.max(1, Math.floor(page));
  const size = Math.max(1, Math.floor(pageSize));
  const from = (safePage - 1) * size;
  return { from, to: from + size - 1 };
}

export function adminTotalPages(count: number, pageSize: number = ADMIN_PAGE_SIZE): number {
  if (!Number.isFinite(count) || count <= 0) return 1;
  return Math.max(1, Math.ceil(count / Math.max(1, pageSize)));
}

/** Turn raw `searchParams` into a fully defaulted, bounds-checked query. */
export function parseAdminCatalogParams(
  searchParams: Record<string, string | string[] | undefined>
): AdminCatalogParams {
  const first = (value: string | string[] | undefined): string | undefined =>
    Array.isArray(value) ? value[0] : value;

  const minPrice = parseBound(first(searchParams.minPrice));
  const maxPrice = parseBound(first(searchParams.maxPrice));

  return {
    q: sanitizeAdminSearch(first(searchParams.q)),
    field: oneOf(first(searchParams.field), ADMIN_SEARCH_FIELDS, 'all'),
    brand: (first(searchParams.brand) ?? '').trim(),
    category: (first(searchParams.category) ?? '').trim(),
    status: oneOf(first(searchParams.status), ADMIN_STATUS_FILTERS, 'all'),
    stock: oneOf(first(searchParams.stock), ADMIN_STOCK_FILTERS, 'all'),
    gst: oneOf(first(searchParams.gst), ADMIN_GST_FILTERS, 'all'),
    minPrice,
    // A min above the max is a nonsense range; drop the upper bound rather
    // than silently returning nothing.
    maxPrice: minPrice !== null && maxPrice !== null && maxPrice < minPrice ? null : maxPrice,
    maxStock: parseBound(first(searchParams.maxStock)),
    minMoq: parseBound(first(searchParams.minMoq)),
    maxMoq: parseBound(first(searchParams.maxMoq)),
    sort: parseAdminSort(first(searchParams.sort)),
    page: parseAdminPage(first(searchParams.page)),
  };
}

/** True when anything other than the defaults is active. Drives "Clear filters". */
export function hasAdminFilters(params: AdminCatalogParams): boolean {
  return Boolean(
    params.q ||
      params.brand ||
      params.category ||
      params.status !== 'all' ||
      params.stock !== 'all' ||
      params.gst !== 'all' ||
      params.minPrice !== null ||
      params.maxPrice !== null ||
      params.maxStock !== null ||
      params.minMoq !== null ||
      params.maxMoq !== null
  );
}

/** How many distinct filters are on, for the "3 filters applied" chip. */
export function countAdminFilters(params: AdminCatalogParams): number {
  return [
    params.q,
    params.brand,
    params.category,
    params.status !== 'all',
    params.stock !== 'all',
    params.gst !== 'all',
    params.minPrice !== null || params.maxPrice !== null,
    params.maxStock !== null,
    params.minMoq !== null || params.maxMoq !== null,
  ].filter(Boolean).length;
}

const PARAM_ORDER: (keyof AdminCatalogParams)[] = [
  'q',
  'field',
  'brand',
  'category',
  'status',
  'stock',
  'gst',
  'minPrice',
  'maxPrice',
  'maxStock',
  'minMoq',
  'maxMoq',
  'sort',
];

/**
 * Build a link that preserves the current filter/sort state.
 *
 * `page` is intentionally never emitted: changing a filter must land on page 1
 * of the NEW result set, not on page 7 of a set that may not have one.
 * `overrides` may set a key to `undefined` to drop it.
 */
export function adminCatalogHref(
  params: AdminCatalogParams,
  overrides: Partial<Record<keyof AdminCatalogParams, string | number | undefined>> = {}
): string {
  const merged: Record<string, string | number | null | undefined> = { ...params, ...overrides };
  const query = new URLSearchParams();
  for (const key of PARAM_ORDER) {
    const value = merged[key];
    if (value === undefined || value === null || value === '') continue;
    // Defaults are omitted so a filtered URL stays short and shareable.
    if (key === 'sort' && value === 'newest') continue;
    if (key === 'field' && value === 'all') continue;
    if (key === 'status' && value === 'all') continue;
    if (key === 'stock' && value === 'all') continue;
    if (key === 'gst' && value === 'all') continue;
    query.set(key, String(value));
  }
  const qs = query.toString();
  return `/admin/products${qs ? `?${qs}` : ''}`;
}

/** Pagination link: current state plus an explicit page. */
export function adminCatalogPageHref(params: AdminCatalogParams, page: number): string {
  const base = adminCatalogHref(params);
  if (page <= 1) return base;
  return `${base}${base.includes('?') ? '&' : '?'}page=${page}`;
}

/**
 * True when the requested query cannot be answered by the `products` table
 * alone — either the sort needs stock/sales/cost data, or a filter compares
 * against stock. Those paths read a bounded working set from the 0017/0050
 * helpers first and then restrict the product query to the resulting ids.
 */
export function needsDerivedLookup(params: AdminCatalogParams): boolean {
  return (
    !isDbSortableAdminSort(params.sort) ||
    params.stock !== 'all' ||
    params.maxStock !== null ||
    params.minMoq !== null ||
    params.maxMoq !== null
  );
}
