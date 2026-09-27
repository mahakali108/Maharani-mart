import 'server-only';

/**
 * Catalog batch loading for the retailer product list.
 *
 * The catalog used to answer a page number with a "Page 3 of 12" footer. It now
 * answers an opaque CURSOR with the next batch of cards, so the retailer just
 * keeps scrolling. The two honest modes from lib/retailer/catalog-params.ts are
 * preserved exactly:
 *
 *  MODE 1 — DB-PAGINATED (keyset). No filter depends on a per-retailer price
 *  and the sort is a real ORDER BY, so the database serves "everything after
 *  the row I just showed" straight from the index. Cost does not grow with how
 *  far the retailer scrolls.
 *
 *  MODE 2 — BOUNDED WORKING SET (offset cursor). A price / discount / MOQ /
 *  offer filter or a price / frequency sort compares against the price resolved
 *  for THIS retailer, which SQL cannot know. The working set stays capped at
 *  CATALOG_MAX_ROWS, is priced and ranked in memory exactly as before, and is
 *  then batched out with an offset cursor. `resultCapped` still tells the UI to
 *  say so.
 *
 * Nothing loads the whole catalog into the browser: one bounded query plus one
 * pricing resolution per batch, and never more than CATALOG_MAX_ROWS in memory.
 */

import type { createClient } from '@/lib/supabase/server';
import {
  PRODUCT_CARD_SELECT,
  priceCatalogProducts,
  loadFavoriteIds,
  type CatalogProductRow,
  type PricedCatalogCard,
} from '@/lib/retailer/catalog';
import { getOrderFrequencyMap } from '@/lib/retailer/personalization';
import { calcDiscountPercent } from '@/lib/retailer/format';
import {
  CATALOG_MAX_ROWS,
  CATALOG_PAGE_SIZE,
  hasDerivedPriceConstraints,
  type CatalogSort,
} from '@/lib/retailer/catalog-params';
import {
  applyCursor,
  applyKeysetOrder,
  cursorOffset,
  keysetCursorFor,
  offsetCursorFor,
  toListBatch,
  type KeysetColumn,
} from '@/lib/infinite-scroll/keyset';
import type { ListCursor } from '@/lib/infinite-scroll/cursor';

type SupabaseClient = ReturnType<typeof createClient>;

/** Bound on how many variant/barcode matches are folded into the search disjunction. */
const PACK_MATCH_LIMIT = 150;

export interface CatalogFilters {
  q: string;
  categoryId: string;
  brandId: string;
  sort: CatalogSort;
  minPrice: number | null;
  maxPrice: number | null;
  minDiscount: number | null;
  maxMoq: number | null;
  onlyFavorites: boolean;
  onlyNew: boolean;
  onlyOffers: boolean;
}

export interface CatalogBatch {
  cards: PricedCatalogCard[];
  /** Cursor for the next batch; `null` when the catalog is fully listed. */
  nextCursor: string | null;
  /** How many products match — drives the "N products" heading. */
  resultCount: number;
  /** True when Mode 2's working-set cap bound and the UI must say so. */
  resultCapped: boolean;
}

/**
 * The ORDER BY for a DB-sortable catalog sort, and — in the same breath — the
 * shape of the keyset cursor. `id` is always the last term so a cursor points
 * at exactly one row even when two products share a name or a launch flag.
 */
function catalogOrder(sort: CatalogSort): KeysetColumn[] {
  if (sort === 'name') {
    return [
      { column: 'name', ascending: true },
      { column: 'id', ascending: true },
    ];
  }
  if (sort === 'newest') {
    return [
      { column: 'created_at', ascending: false },
      { column: 'id', ascending: false },
    ];
  }
  // 'recommended' — the existing deterministic catalog ordering: new launches
  // first, then name. No invented popularity or sales figures.
  return [
    { column: 'is_new_launch', ascending: false },
    { column: 'name', ascending: true },
    { column: 'id', ascending: true },
  ];
}

export interface CatalogCategory {
  id: string;
  name: string;
  parent_id: string | null;
}

export interface CatalogBrand {
  id: string;
  name: string;
}

/**
 * One batch of catalog cards.
 *
 * RLS scopes `products` to active rows the caller may see; every extra filter
 * here narrows the same query the old paged catalog ran.
 */
export async function loadCatalogBatch(
  supabase: SupabaseClient,
  shopper: { userId: string; areaId: string | null },
  filters: CatalogFilters,
  categories: CatalogCategory[],
  brands: CatalogBrand[],
  cursor: ListCursor | null
): Promise<CatalogBatch> {
  const { userId, areaId } = shopper;

  const needsDerivedPricing = hasDerivedPriceConstraints({
    sort: filters.sort,
    minPrice: filters.minPrice,
    maxPrice: filters.maxPrice,
    minDiscount: filters.minDiscount,
    maxMoq: filters.maxMoq,
    onlyOffers: filters.onlyOffers,
  });

  const [favoriteIds, frequency] = await Promise.all([
    loadFavoriteIds(supabase, userId),
    // Order-frequency ranking costs two extra queries and is only ever read by
    // the `frequent` sort, so it is skipped on every other batch.
    filters.sort === 'frequent' ? getOrderFrequencyMap(supabase, userId) : Promise.resolve(new Map<string, number>()),
  ]);

  // `fav=1` with nothing favourited can never match: short-circuit to an empty
  // set without touching the database (unchanged behaviour).
  if (filters.onlyFavorites && favoriteIds.size === 0) {
    return { cards: [], nextCursor: null, resultCount: 0, resultCapped: false };
  }

  const selectedCategory = categories.find((category) => category.id === filters.categoryId) ?? null;
  const selectedBrand = brands.find((brand) => brand.id === filters.brandId) ?? null;

  let matchingBrandIds: string[] = [];
  let matchingCategoryIds: string[] = [];
  let matchingPackProductIds: string[] = [];
  if (filters.q) {
    const like = `%${filters.q}%`;
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
        .or(`pack_name.ilike."%${filters.q}%",barcode.ilike."%${filters.q}%"`)
        .limit(PACK_MATCH_LIMIT)
        .returns<{ product_id: string }[]>(),
    ]);
    matchingBrandIds = (brandMatches ?? []).map((row) => row.id);
    matchingCategoryIds = (categoryMatches ?? []).map((row) => row.id);
    // De-duplicated and bounded so the disjunction below stays a sane
    // URL/query even for a broad term like "500g" that matches many variants.
    matchingPackProductIds = [...new Set((packMatches ?? []).map((row) => row.product_id))].slice(0, PACK_MATCH_LIMIT);
  }

  // The exact total is counted for the FIRST batch only — it feeds the
  // "N products" heading, and re-counting it on every scroll would be the most
  // expensive query on the page.
  let query = supabase
    .from('products')
    .select(PRODUCT_CARD_SELECT, cursor === null ? { count: 'exact' } : {})
    .eq('is_active', true);

  if (filters.q) {
    const like = `"%${filters.q}%"`;
    const clauses = [`name.ilike.${like}`, `barcode.ilike.${like}`];
    if (matchingBrandIds.length > 0) clauses.push(`brand_id.in.(${matchingBrandIds.join(',')})`);
    if (matchingCategoryIds.length > 0) clauses.push(`category_id.in.(${matchingCategoryIds.join(',')})`);
    if (matchingPackProductIds.length > 0) clauses.push(`id.in.(${matchingPackProductIds.join(',')})`);
    query = query.or(clauses.join(','));
  }
  if (selectedCategory) {
    const scopedIds = [
      selectedCategory.id,
      ...categories.filter((category) => category.parent_id === selectedCategory.id).map((category) => category.id),
    ];
    query = query.in('category_id', scopedIds);
  }
  if (selectedBrand) query = query.eq('brand_id', selectedBrand.id);
  if (filters.onlyNew) query = query.eq('is_new_launch', true);
  if (filters.onlyFavorites && favoriteIds.size > 0) query = query.in('id', [...favoriteIds]);

  /**
   * `frequent` ranks by this retailer's own order history, which is not a
   * column on `products`, so the ranking happens in memory (Mode 2). Left
   * unrestricted, Mode 2 would fetch an *alphabetical* window of
   * CATALOG_MAX_ROWS and rank only that — silently dropping any
   * frequently-ordered product whose name sorts past the cap. Restricting the
   * query to the ids in the history makes "Frequent" exactly the products this
   * retailer has actually ordered, ranked correctly and completely.
   */
  if (filters.sort === 'frequent' && frequency.size > 0) {
    const frequentIds = [...frequency.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, CATALOG_MAX_ROWS)
      .map(([productId]) => productId);
    query = query.in('id', frequentIds);
  }

  if (!needsDerivedPricing) {
    // MODE 1 — the database serves the batch through the sort's index.
    const order = catalogOrder(filters.sort);
    const { data, count } = await applyCursor(applyKeysetOrder(query, order), cursor, order, CATALOG_PAGE_SIZE);
    const rows = (data ?? []) as unknown as CatalogProductRow[];
    const batch = toListBatch(rows, CATALOG_PAGE_SIZE, (row) => keysetCursorFor(row, order));
    const cards = await priceCatalogProducts(supabase, batch.items, userId, areaId, favoriteIds, frequency);
    return {
      cards,
      nextCursor: batch.nextCursor,
      resultCount: count ?? batch.items.length,
      resultCapped: false,
    };
  }

  // MODE 2 — bounded working set, priced, filtered and ranked in memory, then
  // batched out. The cap is disclosed by `resultCapped` rather than hidden.
  const offset = cursorOffset(cursor);
  const { data, count } = await query.limit(CATALOG_MAX_ROWS);
  const rows = (data ?? []) as unknown as CatalogProductRow[];
  const priced = await priceCatalogProducts(supabase, rows, userId, areaId, favoriteIds, frequency);

  const filtered = priced.filter((card) => {
    if (filters.minPrice !== null && (card.fromPrice === null || card.fromPrice < filters.minPrice)) return false;
    if (filters.maxPrice !== null && (card.fromPrice === null || card.fromPrice > filters.maxPrice)) return false;
    if (filters.minDiscount !== null && calcDiscountPercent(card.mrp, card.fromPrice) < filters.minDiscount) return false;
    if (filters.maxMoq !== null && (card.moq ?? 1) > filters.maxMoq) return false;
    if (filters.onlyOffers && !card.hasOffer && calcDiscountPercent(card.mrp, card.fromPrice) <= 0) return false;
    return true;
  });

  const ranked = [...filtered].sort((a, b) => {
    if (filters.sort === 'name') return a.name.localeCompare(b.name);
    if (filters.sort === 'price-low') return (a.fromPrice ?? Number.MAX_SAFE_INTEGER) - (b.fromPrice ?? Number.MAX_SAFE_INTEGER);
    if (filters.sort === 'price-high') return (b.fromPrice ?? -1) - (a.fromPrice ?? -1);
    if (filters.sort === 'discount') return calcDiscountPercent(b.mrp, b.fromPrice) - calcDiscountPercent(a.mrp, a.fromPrice);
    if (filters.sort === 'newest') return +new Date(b.createdAt) - +new Date(a.createdAt);
    if (filters.sort === 'frequent') return b.timesOrdered - a.timesOrdered || Number(b.isNewLaunch) - Number(a.isNewLaunch);
    return Number(b.isNewLaunch) - Number(a.isNewLaunch) || a.name.localeCompare(b.name);
  });

  const page = ranked.slice(offset, offset + CATALOG_PAGE_SIZE);
  const hasMore = ranked.length > offset + CATALOG_PAGE_SIZE;
  return {
    cards: page,
    nextCursor: hasMore ? offsetCursorFor(offset, CATALOG_PAGE_SIZE) : null,
    resultCount: ranked.length,
    // The working set itself was capped, so a further batch cannot exist.
    resultCapped: (count ?? 0) > CATALOG_MAX_ROWS,
  };
}
