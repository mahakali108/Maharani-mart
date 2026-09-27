export const CATALOG_SORTS = ['recommended', 'price-low', 'price-high', 'discount', 'newest', 'frequent', 'name'] as const;
export type CatalogSort = (typeof CATALOG_SORTS)[number];

/**
 * Catalog batching + result-set bounds.
 *
 * The catalog used to fetch EVERY active product (with its brand, image
 * gallery and all of its packs) on every request and then filter/sort/page in
 * memory, so the payload grew without limit with the catalog. These constants
 * and the helpers below bound it: the list now streams in CATALOG_PAGE_SIZE
 * batches (see lib/retailer/catalog-batches.ts) instead of paging.
 *
 * Two honest modes exist because some filters cannot be pushed into SQL
 * without changing results:
 *
 *  1. DB-STREAMED — the requested sort is expressible as a SQL ORDER BY and no
 *     filter depends on a per-retailer resolved price, so the database serves
 *     each batch straight from the index with a keyset cursor.
 *
 *  2. BOUNDED WORKING SET — a price/discount/MOQ/offer filter or a
 *     price/frequency sort is active. Those compare against the price resolved
 *     for THIS retailer (pack case_price, then any retailer/area override from
 *     price_lists), which SQL cannot know. Pushing them into the query would
 *     filter on the raw pack price and silently change which products a
 *     retailer sees, so instead the working set is capped at
 *     CATALOG_MAX_ROWS, filtered/sorted in memory exactly as before, batched
 *     out with an offset cursor, and the UI says so when the cap binds rather
 *     than truncating quietly.
 */
/** Rows per batch — the catalog scrolls, so this is a batch size, not a page. */
export const CATALOG_PAGE_SIZE = 24;

/** Hard cap on rows fetched when a derived-price filter/sort is active. */
export const CATALOG_MAX_ROWS = 240;


export interface CatalogQuery {
  q?: string;
  category?: string;
  brand?: string;
  sort?: string;
  minPrice?: string;
  maxPrice?: string;
  discount?: string;
  maxMoq?: string;
  fav?: string;
  new?: string;
  offers?: string;
}

export function sanitizeSearchTerm(raw: string): string {
  return raw
    .replace(/[%_*,.()"'\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

export function parseCatalogSort(value: string | undefined): CatalogSort {
  return CATALOG_SORTS.includes(value as CatalogSort) ? (value as CatalogSort) : 'recommended';
}

/**
 * Sorts that can be reproduced by a SQL ORDER BY without changing the result
 * order. `recommended` is the existing deterministic catalog ordering
 * (new launches first, then name) and `frequent` is NOT here because it ranks
 * by the retailer's own order history, which lives outside the products table.
 */
const DB_SORTABLE: CatalogSort[] = ['recommended', 'newest', 'name'];

export function isDbSortable(sort: CatalogSort): boolean {
  return DB_SORTABLE.includes(sort);
}

/**
 * True when at least one active filter/sort depends on a price resolved for
 * this retailer, so the result set cannot be paged by the database alone.
 */
export function hasDerivedPriceConstraints(input: {
  sort: CatalogSort;
  minPrice: number | null;
  maxPrice: number | null;
  minDiscount: number | null;
  maxMoq: number | null;
  onlyOffers: boolean;
}): boolean {
  if (!isDbSortable(input.sort)) return true;
  return (
    input.minPrice !== null ||
    input.maxPrice !== null ||
    input.minDiscount !== null ||
    input.maxMoq !== null ||
    input.onlyOffers
  );
}

/**
 * Filter/sort links.
 *
 * There is no page to emit: the catalog scrolls, so a filter or sort change
 * re-runs the query from the top of the new result set.
 */
export function catalogHref(query: CatalogQuery): string {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.category) params.set('category', query.category);
  if (query.brand) params.set('brand', query.brand);
  if (query.sort && query.sort !== 'recommended') params.set('sort', query.sort);
  if (query.minPrice) params.set('minPrice', query.minPrice);
  if (query.maxPrice) params.set('maxPrice', query.maxPrice);
  if (query.discount) params.set('discount', query.discount);
  if (query.maxMoq) params.set('maxMoq', query.maxMoq);
  if (query.fav === '1') params.set('fav', '1');
  if (query.new === '1') params.set('new', '1');
  if (query.offers === '1') params.set('offers', '1');
  const qs = params.toString();
  return `/retailer/catalog${qs ? `?${qs}` : ''}`;
}

export function parseOptionalNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
