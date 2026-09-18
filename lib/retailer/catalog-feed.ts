import 'server-only';

import type { createClient } from '@/lib/supabase/server';
import {
  loadFavoriteIds,
  priceCatalogProducts,
  PRODUCT_CARD_SELECT,
  type CatalogProductRow,
  type PricedCatalogCard,
} from '@/lib/retailer/catalog';
import {
  CATALOG_FEED_MAX_ROWS,
  CATALOG_FEED_PAGE_SIZE,
  CATALOG_MAX_ROWS,
  catalogFeedWindow,
  hasDerivedPriceConstraints,
  parseCatalogOffset,
  parseCatalogSort,
  parseOptionalNumber,
  sanitizeSearchTerm,
  type CatalogQuery,
} from '@/lib/retailer/catalog-params';
import { calcDiscountPercent } from '@/lib/retailer/format';
import { getOrderFrequencyMap } from '@/lib/retailer/personalization';

/**
 * One authoritative catalog read, shared by the retailer catalog PAGE (first
 * batch) and the JSON feed route (every later batch).
 *
 * Why it lives here: page 1 and batch 2..N must be produced by identical
 * filtering, sorting and pricing, or "load more" would append rows that don't
 * belong to the retailer's current filters. Everything the browser sends —
 * search term, category, brand, sort, price/discount/MOQ/offer filters — is
 * re-parsed and re-validated here server-side; the client only controls the
 * cursor (`offset`), which is clamped into the feed's hard bounds.
 *
 * Security: reads go through the request's cookie-authenticated Supabase
 * client, so RLS still governs every row (`products_read` etc.). Pricing,
 * availability, MOQ and GST are computed by the existing canonical helpers —
 * none of that is re-implemented or relaxed here.
 */

export interface CatalogFeedTaxonomy {
  categories: { id: string; name: string; image_url: string | null; parent_id: string | null }[];
  brands: { id: string; name: string }[];
}

export interface CatalogFeedInput {
  supabase: ReturnType<typeof createClient>;
  retailerId: string;
  /**
   * Delivery area for retailer/area price overrides. Omit it and the loader
   * reads the caller's own retailer row — the page and the JSON route then
   * price identically without either of them remembering this detail.
   */
  areaId?: string | null;
  /** Raw, untrusted query string values. */
  query: CatalogQuery;
  /** Raw cursor. Non-numeric/negative = start at the top. */
  offset?: string | number;
  /** Hard cap for this feed session. */
  maxRows?: number;
}

export interface CatalogFeedResult extends CatalogFeedTaxonomy {
  cards: PricedCatalogCard[];
  /** True total for the active filters (not the number loaded so far). */
  total: number;
  /** Cursor this batch starts at (already clamped). */
  offset: number;
  limit: number;
  /** Cursor for the next batch, or `null` when the feed is finished. */
  nextOffset: number | null;
  hasMore: boolean;
  /** The bounded in-memory working set (price-derived filters) was hit. */
  workingSetCapped: boolean;
  /** The continuous feed cap was hit — more rows exist but are not loaded. */
  feedCapped: boolean;
  /** 'database' = paginated by SQL; 'working-set' = ranked in memory. */
  mode: 'database' | 'working-set';
  /** `fav=1` with nothing favourited: an honest empty result, not an error. */
  noPossibleResults: boolean;
}

interface CategoryRow {
  id: string;
  name: string;
  image_url: string | null;
  parent_id: string | null;
}

interface BrandRow {
  id: string;
  name: string;
}

/** Bound on how many variant/barcode matches are folded into the search disjunction. */
const PACK_MATCH_LIMIT = 150;

export async function loadCatalogFeed({
  supabase,
  retailerId,
  areaId,
  query,
  offset,
  maxRows = CATALOG_FEED_MAX_ROWS,
}: CatalogFeedInput): Promise<CatalogFeedResult> {
  const q = sanitizeSearchTerm(query.q ?? '');
  const categoryId = query.category?.trim() ?? '';
  const brandId = query.brand?.trim() ?? '';
  const sort = parseCatalogSort(query.sort);
  const minPrice = parseOptionalNumber(query.minPrice);
  const maxPrice = parseOptionalNumber(query.maxPrice);
  const minDiscount = parseOptionalNumber(query.discount);
  const maxMoq = parseOptionalNumber(query.maxMoq);
  const onlyFavorites = query.fav === '1';
  const onlyNew = query.new === '1';
  const onlyOffers = query.offers === '1';

  // A price/discount/MOQ/offer filter or a price/frequency sort compares
  // against the price resolved for THIS retailer, which SQL cannot know — so
  // those paths page over a bounded in-memory working set instead of asking the
  // database for a range. Everything else is paginated by the database.
  const needsDerivedPricing = hasDerivedPriceConstraints({
    sort,
    minPrice,
    maxPrice,
    minDiscount,
    maxMoq,
    onlyOffers,
  });

  const [{ data: categoryData }, { data: brandData }, { data: retailerRow }, favoriteIds, frequency] = await Promise.all([
    supabase.from('categories').select('id, name, image_url, parent_id').eq('is_active', true).order('sort_order').returns<CategoryRow[]>(),
    supabase.from('brands').select('id, name').eq('is_active', true).order('name').returns<BrandRow[]>(),
    // Owner-scoped (RLS) — the retailer can only ever read their own row. The
    // area drives retailer/area price overrides in the canonical price engine.
    areaId === undefined
      ? supabase.from('retailers').select('area_id').eq('id', retailerId).maybeSingle<{ area_id: string | null }>()
      : Promise.resolve({ data: null }),
    loadFavoriteIds(supabase, retailerId),
    // Order-frequency ranking costs two extra queries and is only ever read by
    // the `frequent` sort, so it is skipped on every other request.
    sort === 'frequent' ? getOrderFrequencyMap(supabase, retailerId) : Promise.resolve(new Map<string, number>()),
  ]);
  const resolvedAreaId = areaId === undefined ? retailerRow?.area_id ?? null : areaId;

  const categories = categoryData ?? [];
  const brands = brandData ?? [];
  const selectedCategory = categories.find((category) => category.id === categoryId) ?? null;
  const selectedBrand = brands.find((brand) => brand.id === brandId) ?? null;

  let matchingBrandIds: string[] = [];
  let matchingCategoryIds: string[] = [];
  let matchingPackProductIds: string[] = [];
  if (q) {
    const like = `%${q}%`;
    // Search covers every real, retailer-visible field: product name, brand,
    // category, product barcode (EAN/UPC) and the VARIANT/SIZE itself —
    // product_packs.pack_name is the size ("50g", "100g", "5L Jar") and packs
    // carry their own barcode. RLS already hides inactive packs from a
    // retailer, and the explicit is_active filter keeps staff sessions honest
    // too. Internal SKU codes are deliberately NOT a search field.
    const [{ data: brandMatches }, { data: categoryMatches }, { data: packMatches }] = await Promise.all([
      supabase.from('brands').select('id').eq('is_active', true).ilike('name', like).returns<{ id: string }[]>(),
      supabase.from('categories').select('id').eq('is_active', true).ilike('name', like).returns<{ id: string }[]>(),
      supabase
        .from('product_packs')
        .select('product_id')
        .eq('is_active', true)
        .or(`pack_name.ilike."%${q}%",barcode.ilike."%${q}%"`)
        .limit(PACK_MATCH_LIMIT)
        .returns<{ product_id: string }[]>(),
    ]);
    matchingBrandIds = (brandMatches ?? []).map((row) => row.id);
    matchingCategoryIds = (categoryMatches ?? []).map((row) => row.id);
    // De-duplicated and bounded so the disjunction below stays a sane URL/query
    // even for a broad term like "500g" that matches many variants.
    matchingPackProductIds = [...new Set((packMatches ?? []).map((row) => row.product_id))].slice(0, PACK_MATCH_LIMIT);
  }

  // `count: 'exact'` gives the true total for the result-set size.
  let productsQuery = supabase
    .from('products')
    .select(PRODUCT_CARD_SELECT, { count: 'exact' })
    .eq('is_active', true);

  // Every ordering ends with `id` so a batch cursor is deterministic: two
  // products equal on the visible sort key keep a stable relative order, which
  // is what stops an offset batch from skipping or repeating a product.
  if (needsDerivedPricing) {
    productsQuery = productsQuery.order('name').order('id');
  } else if (sort === 'name') {
    productsQuery = productsQuery.order('name', { ascending: true }).order('id', { ascending: true });
  } else if (sort === 'newest') {
    productsQuery = productsQuery.order('created_at', { ascending: false }).order('id', { ascending: true });
  } else {
    // 'recommended' — the existing deterministic catalog ordering: new launches
    // first, then name. No invented popularity or sales figures.
    productsQuery = productsQuery.order('is_new_launch', { ascending: false }).order('name', { ascending: true }).order('id', { ascending: true });
  }

  if (q) {
    const like = `"%${q}%"`;
    const clauses = [`name.ilike.${like}`, `barcode.ilike.${like}`];
    if (matchingBrandIds.length > 0) clauses.push(`brand_id.in.(${matchingBrandIds.join(',')})`);
    if (matchingCategoryIds.length > 0) clauses.push(`category_id.in.(${matchingCategoryIds.join(',')})`);
    if (matchingPackProductIds.length > 0) clauses.push(`id.in.(${matchingPackProductIds.join(',')})`);
    productsQuery = productsQuery.or(clauses.join(','));
  }
  if (selectedCategory) {
    const scopedIds = [
      selectedCategory.id,
      ...categories.filter((category) => category.parent_id === selectedCategory.id).map((category) => category.id),
    ];
    productsQuery = productsQuery.in('category_id', scopedIds);
  }
  if (selectedBrand) productsQuery = productsQuery.eq('brand_id', selectedBrand.id);
  if (onlyNew) productsQuery = productsQuery.eq('is_new_launch', true);
  if (onlyFavorites && favoriteIds.size > 0) productsQuery = productsQuery.in('id', [...favoriteIds]);

  /**
   * `frequent` ranks by this retailer's own order history, which is not a
   * column on `products`, so the ranking itself has to happen in memory
   * (Mode 2). Left unrestricted, Mode 2 would fetch an *alphabetical* window
   * of CATALOG_MAX_ROWS and rank only that. Restricting the query to the ids in
   * the history makes "Frequent" exactly the products this retailer has
   * actually ordered, ranked correctly and completely.
   */
  if (sort === 'frequent' && frequency.size > 0) {
    const frequentIds = [...frequency.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, CATALOG_MAX_ROWS)
      .map(([productId]) => productId);
    productsQuery = productsQuery.in('id', frequentIds);
  }

  // `fav=1` with nothing favourited can never match, so it short-circuits to an
  // empty set without touching the database (unchanged behaviour).
  const noPossibleResults = onlyFavorites && favoriteIds.size === 0;
  const requestedOffset = parseCatalogOffset(typeof offset === 'number' ? String(offset) : offset);
  const window = catalogFeedWindow(requestedOffset, CATALOG_FEED_PAGE_SIZE, maxRows);

  let cards: PricedCatalogCard[] = [];
  let total = 0;
  let workingSetCapped = false;

  if (noPossibleResults) {
    cards = [];
    total = 0;
  } else if (!needsDerivedPricing) {
    // Mode 1 — DB pagination. Every active constraint is already expressed in
    // SQL and the sort is a real ORDER BY, so `.range()` returns exactly the
    // requested batch and `count: 'exact'` returns the true total.
    const { data: productRows, count } = await productsQuery
      .returns<CatalogProductRow[]>()
      .range(window.from, window.to);
    cards = await priceCatalogProducts(
      supabase,
      productRows ?? [],
      retailerId,
      resolvedAreaId,
      favoriteIds,
      frequency
    );
    total = count ?? cards.length;
  } else {
    // Mode 2 — bounded working set. A derived-price constraint is active, so
    // the full (capped) set is priced, filtered and ranked in memory exactly as
    // before, then sliced to the requested window.
    const { data: productRows, count } = await productsQuery
      .returns<CatalogProductRow[]>()
      .limit(CATALOG_MAX_ROWS);
    workingSetCapped = (count ?? 0) > CATALOG_MAX_ROWS;

    const priced = await priceCatalogProducts(
      supabase,
      productRows ?? [],
      retailerId,
      resolvedAreaId,
      favoriteIds,
      frequency
    );

    const filtered = priced.filter((card) => {
      if (minPrice !== null && (card.fromPrice === null || card.fromPrice < minPrice)) return false;
      if (maxPrice !== null && (card.fromPrice === null || card.fromPrice > maxPrice)) return false;
      if (minDiscount !== null && calcDiscountPercent(card.mrp, card.fromPrice) < minDiscount) return false;
      if (maxMoq !== null && (card.moq ?? 1) > maxMoq) return false;
      if (onlyOffers && !card.hasOffer && calcDiscountPercent(card.mrp, card.fromPrice) <= 0) return false;
      return true;
    });

    const ranked = [...filtered].sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'price-low') return (a.fromPrice ?? Number.MAX_SAFE_INTEGER) - (b.fromPrice ?? Number.MAX_SAFE_INTEGER);
      if (sort === 'price-high') return (b.fromPrice ?? -1) - (a.fromPrice ?? -1);
      if (sort === 'discount') return calcDiscountPercent(b.mrp, b.fromPrice) - calcDiscountPercent(a.mrp, a.fromPrice);
      if (sort === 'newest') return +new Date(b.createdAt) - +new Date(a.createdAt);
      if (sort === 'frequent') return b.timesOrdered - a.timesOrdered || Number(b.isNewLaunch) - Number(a.isNewLaunch);
      return Number(b.isNewLaunch) - Number(a.isNewLaunch) || a.name.localeCompare(b.name);
    });

    total = ranked.length;
    cards = ranked.slice(window.from, window.to + 1);
  }

  const feedCapped = total > window.maxRows;
  const reachable = Math.min(total, window.maxRows);
  const consumed = window.offset + cards.length;
  // Stop conditions: a short batch means the end of the result set, and the
  // feed cap means the end of what we will ever hand to one browser session.
  // Either way `nextOffset` becomes null and the client stops asking.
  const hasMore = cards.length === window.limit && consumed < reachable;

  return {
    categories,
    brands,
    cards,
    total,
    offset: window.offset,
    limit: window.limit,
    nextOffset: hasMore ? consumed : null,
    hasMore,
    workingSetCapped,
    feedCapped,
    mode: needsDerivedPricing ? 'working-set' : 'database',
    noPossibleResults,
  };
}
