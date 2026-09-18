export const CATALOG_SORTS = ['recommended', 'price-low', 'price-high', 'discount', 'newest', 'frequent', 'name'] as const;
export type CatalogSort = (typeof CATALOG_SORTS)[number];

/**
 * Catalog paging + result-set bounds.
 *
 * The catalog used to fetch EVERY active product (with its brand, image
 * gallery and all of its packs) on every request and then filter/sort/page in
 * memory, so the payload grew without limit with the catalog. These constants
 * and the helpers below bound it.
 *
 * Two honest modes exist because some filters cannot be pushed into SQL
 * without changing results:
 *
 *  1. DB-PAGINATED — the requested sort is expressible as a SQL ORDER BY and
 *     no filter depends on a per-retailer resolved price. `.range()` + an exact
 *     count give true pagination over the whole catalog.
 *
 *  2. BOUNDED WORKING SET — a price/discount/MOQ/offer filter or a
 *     price/frequency sort is active. Those compare against the price resolved
 *     for THIS retailer (pack case_price, then any retailer/area override from
 *     price_lists), which SQL cannot know. Pushing them into the query would
 *     filter on the raw pack price and silently change which products a
 *     retailer sees, so instead the working set is capped at
 *     CATALOG_MAX_ROWS, filtered/sorted in memory exactly as before, and the
 *     UI says so when the cap binds rather than truncating quietly.
 */
export const CATALOG_PAGE_SIZE = 24;

/** Hard cap on rows fetched when a derived-price filter/sort is active. */
export const CATALOG_MAX_ROWS = 240;

/** Upper bound on accepted `?page=` so a huge value cannot request a deep range. */
export const CATALOG_MAX_PAGE = 500;

/**
 * CONTINUOUS (infinite-scroll) FEED BOUNDS.
 *
 * The mobile catalog now appends batches instead of paging, so the browser
 * would otherwise keep pulling rows forever on a long scroll. `offset` is the
 * cursor: a server-clamped, non-negative row index. The server never hands out
 * more than `CATALOG_FEED_MAX_ROWS` rows for one feed session and says so
 * (`capped`) instead of silently truncating — the retailer can then narrow the
 * search or pick a category. This is still BOUNDED pagination, not keyset:
 * `products` has no client-visible ordering key suitable for a safe keyset
 * predicate on every supported sort, so the offset is clamped server-side and
 * every batch is de-duplicated by product id in the client.
 */
export const CATALOG_FEED_MAX_ROWS = 480;

/** Rows per feed batch (the server's fixed limit; a client cannot raise it). */
export const CATALOG_FEED_PAGE_SIZE = CATALOG_PAGE_SIZE;

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
  page?: string;
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

/** Whole-page number from `?page=`, clamped so deep ranges cannot be requested. */
export function parseCatalogPage(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(parsed, CATALOG_MAX_PAGE);
}

/** Inclusive PostgREST `.range()` bounds for a 1-based page. */
export function catalogPageRange(page: number, pageSize: number = CATALOG_PAGE_SIZE): { from: number; to: number } {
  const safePage = Math.max(1, Math.floor(page));
  const size = Math.max(1, Math.floor(pageSize));
  const from = (safePage - 1) * size;
  return { from, to: from + size - 1 };
}

/** Total pages for a result count; always at least 1 so page 1 exists. */
export function catalogTotalPages(count: number, pageSize: number = CATALOG_PAGE_SIZE): number {
  if (!Number.isFinite(count) || count <= 0) return 1;
  return Math.max(1, Math.ceil(count / Math.max(1, pageSize)));
}

/**
 * Filter/sort links. `page` is deliberately NEVER emitted here: changing a
 * filter or a sort must land on page 1 of the new result set, not on page 5 of
 * a set that may not have one. Pagination links use catalogPageHref instead.
 */
export function catalogQueryString(query: CatalogQuery): string {
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
  return params.toString();
}

export function catalogHref(query: CatalogQuery): string {
  const qs = catalogQueryString(query);
  return `/retailer/catalog${qs ? `?${qs}` : ''}`;
}

/**
 * One batch of the JSON feed: the same filters/sort as `catalogHref` plus the
 * cursor. Only `offset` is added — `page` is never part of a feed request.
 */
export function catalogFeedHref(query: CatalogQuery, offset: number): string {
  const params = new URLSearchParams(catalogQueryString(query));
  params.set('offset', String(Math.max(0, Math.floor(offset))));
  return `/api/retailer/catalog?${params.toString()}`;
}

/** Pagination link: the current filter/sort state plus an explicit page. */
export function catalogPageHref(query: CatalogQuery, page: number): string {
  const base = catalogHref(query);
  if (page <= 1) return base;
  return `${base}${base.includes('?') ? '&' : '?'}page=${page}`;
}

/**
 * Feed cursor from `?offset=`. Non-numeric or negative values mean "start at
 * the top" — a bad cursor must never skip or duplicate a batch.
 */
export function parseCatalogOffset(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(parsed, CATALOG_FEED_MAX_ROWS);
}

/**
 * Clamp a requested window into the feed's hard bounds. Returns the window the
 * server will actually read, so the caller can tell the truth about the cap.
 */
export function catalogFeedWindow(
  offset: number,
  limit: number = CATALOG_FEED_PAGE_SIZE,
  maxRows: number = CATALOG_FEED_MAX_ROWS
): { offset: number; limit: number; maxRows: number; from: number; to: number } {
  const safeLimit = Math.min(Math.max(1, Math.floor(limit)), CATALOG_FEED_PAGE_SIZE);
  const safeMax = Math.max(safeLimit, Math.floor(maxRows));
  const safeOffset = Math.min(Math.max(0, Math.floor(offset)), safeMax - safeLimit);
  return { offset: safeOffset, limit: safeLimit, maxRows: safeMax, from: safeOffset, to: safeOffset + safeLimit - 1 };
}

/** Legacy `?page=` deep links keep working: page N is the Nth batch. */
export function catalogOffsetFromPage(page: number, pageSize: number = CATALOG_PAGE_SIZE): number {
  return Math.max(0, (Math.max(1, Math.floor(page)) - 1) * Math.max(1, Math.floor(pageSize)));
}

/**
 * Stable identity of one feed: the same filters/sort always produce the same
 * batches. `page` is deliberately excluded (a page is just an offset into the
 * same result set), which is what lets the client resume a feed it already had.
 */
export function catalogFeedKey(query: CatalogQuery): string {
  return catalogHref(query);
}

export function parseOptionalNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
