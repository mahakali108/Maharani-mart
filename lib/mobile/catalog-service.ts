import 'server-only';

/**
 * Data access for the mobile catalogue (`/api/mobile/v1/catalog`, `/home`).
 *
 * Routes stay thin; everything that touches the database for the catalogue
 * lives here and does ONE thing: call the existing retailer services with the
 * caller's own RLS-scoped client. No price, stock value, MOQ or business rule
 * is computed in this module — `lib/retailer/*` is the only source.
 *
 * Identity always comes from the verified session
 * (`requireMobileSession` → `session.userId` / `session.supabase`). Nothing here
 * accepts a retailer id, area id or role from a request body or query string.
 */

import type { createClient } from '@/lib/supabase/server';
import {
  loadCatalogPricing,
  loadFavoriteIds,
  priceCatalogPack,
  type CatalogProductRow,
} from '@/lib/retailer/catalog';
import { loadCatalogBatch } from '@/lib/retailer/catalog-batches';
import { CATALOG_PAGE_SIZE } from '@/lib/retailer/catalog-params';
import { resolvePackPrice } from '@/lib/retailer/effective-price';
import { loadTaxonomyProductCounts } from '@/lib/retailer/taxonomy-counts';
import { normalizeAvailabilityState, type AvailabilityState } from '@/lib/retailer/availability';
import { toPaise } from '@/lib/retailer/case-pricing';
import {
  isUuidLike,
  toMobileBanners,
  toMobileBrands,
  toMobileCategories,
  toMobileCatalogProducts,
  type MobileBanner,
  type MobileBannerRow,
  type MobileBrandRow,
  type MobileCatalogBrand,
  type MobileCatalogCategory,
  type MobileCatalogFilters,
  type MobileCatalogProduct,
  type MobileCategoryRow,
  type MobilePriceTier,
} from '@/lib/mobile/catalog';
import type { ListCursor } from '@/lib/infinite-scroll/cursor';
import type { MobileSession } from '@/lib/mobile/auth';

type SupabaseClient = ReturnType<typeof createClient>;

/**
 * The caller's RLS-scoped client, typed the way `lib/retailer/*` expects.
 *
 * `createMobileSupabaseClient` builds a plain `@supabase/supabase-js` client
 * (four generic parameters, including the schema name) while the retailer
 * services are typed against `@supabase/ssr`'s `createServerClient` (three). The
 * runtime object is the same client over the same `Database` type — only the
 * declared arity differs — so this is the one place the two declared types meet,
 * rather than an `as never` at every call site.
 *
 * The client is still the CALLER's: it carries their bearer token, so every
 * query below is subject to exactly the RLS policies their session has.
 */
function retailerSupabase(session: MobileSession): SupabaseClient {
  return session.supabase as unknown as SupabaseClient;
}

/** One catalogue list batch, already in wire shape. */
export interface MobileCatalogPage {
  products: MobileCatalogProduct[];
  nextCursor: string | null;
  /** Exact match count, known on the first batch only (the service's rule). */
  resultCount: number;
  /** True when a bounded working set capped the list; the app must say so. */
  resultCapped: boolean;
}

export interface MobileCatalogContext {
  areaId: string | null;
  categories: MobileCatalogCategory[];
  brands: MobileCatalogBrand[];
}

interface AreaRow {
  area_id: string | null;
}

/** The raw taxonomy rows the shared catalogue service needs to scope a filter. */
interface TaxonomyRow {
  categories: { id: string; name: string; parent_id: string | null }[];
  brands: { id: string; name: string }[];
}

/**
 * The retailer's service area plus the active taxonomy.
 *
 * The area drives per-area price overrides and banner targeting, so it is read
 * from the caller's own `retailers` row under their own token — never accepted
 * from the request.
 */
export async function loadMobileCatalogContext(session: MobileSession): Promise<MobileCatalogContext> {
  const [{ data: retailer }, taxonomy] = await Promise.all([
    retailerSupabase(session).from('retailers').select('area_id').eq('id', session.userId).maybeSingle<AreaRow>(),
    loadMobileTaxonomy(session),
  ]);

  return { areaId: retailer?.area_id ?? null, ...taxonomy };
}

interface TaxonomyScope {
  categoryRows: MobileCategoryRow[];
  brandRows: MobileBrandRow[];
  /** `null` when the counts could not be read completely. */
  categoryCounts: Map<string, number> | null;
  brandCounts: Map<string, number> | null;
}

/**
 * Active categories and brands, plus their active-product counts.
 *
 * THROWS when the taxonomy itself cannot be read. That is the point: an empty
 * list has to mean "the shop publishes no categories", and a failure has to
 * mean "this read did not happen". Coalescing a failed query into `[]` — which
 * is what this function used to do — rendered a silent, permanently empty
 * Categories pane whose Retry could never change anything, because the request
 * had actually succeeded with an empty body.
 *
 * The COUNTS are separate and optional: when counting fails the taxonomy is
 * still returned with `productCount: null`, so a count outage degrades the
 * number, not the list.
 */
async function loadTaxonomyScope(supabase: SupabaseClient): Promise<TaxonomyScope> {
  const [categoryResult, brandResult] = await Promise.all([
    supabase
      .from('categories')
      .select('id, name, image_url, parent_id')
      .eq('is_active', true)
      .order('sort_order')
      .returns<MobileCategoryRow[]>(),
    supabase
      .from('brands')
      .select('id, name, logo_url')
      .eq('is_active', true)
      .order('name')
      .returns<MobileBrandRow[]>(),
  ]);

  if (categoryResult.error) {
    throw new Error(`Categories could not be read: ${categoryResult.error.message}`);
  }
  if (brandResult.error) {
    throw new Error(`Brands could not be read: ${brandResult.error.message}`);
  }

  const counts = await loadTaxonomyProductCounts(supabase);

  return {
    categoryRows: categoryResult.data ?? [],
    brandRows: brandResult.data ?? [],
    categoryCounts: counts?.categories ?? null,
    brandCounts: counts?.brands ?? null,
  };
}

/** Active categories and brands, in wire shape. Throws when the read fails. */
export async function loadMobileTaxonomy(
  session: MobileSession
): Promise<{ categories: MobileCatalogCategory[]; brands: MobileCatalogBrand[] }> {
  const scope = await loadTaxonomyScope(retailerSupabase(session));
  return {
    categories: toMobileCategories(scope.categoryRows, scope.categoryCounts),
    brands: toMobileBrands(scope.brandRows, scope.brandCounts),
  };
}

/** Raw taxonomy for the shared filter scope (ids + parent links only). */
async function loadTaxonomyRows(supabase: SupabaseClient): Promise<TaxonomyRow> {
  const [categoryResult, brandResult] = await Promise.all([
    supabase
      .from('categories')
      .select('id, name, parent_id')
      .eq('is_active', true)
      .order('sort_order')
      .returns<{ id: string; name: string; parent_id: string | null }[]>(),
    supabase
      .from('brands')
      .select('id, name')
      .eq('is_active', true)
      .order('name')
      .returns<{ id: string; name: string }[]>(),
  ]);
  if (categoryResult.error) throw categoryResult.error;
  if (brandResult.error) throw brandResult.error;
  return { categories: categoryResult.data ?? [], brands: brandResult.data ?? [] };
}

/** One catalogue batch through the SAME service the web catalogue uses. */
export async function loadMobileCatalogPage(
  session: MobileSession,
  filters: MobileCatalogFilters,
  cursor: ListCursor | null
): Promise<MobileCatalogPage> {
  const supabase = retailerSupabase(session);

  const [{ data: retailer }, taxonomy] = await Promise.all([
    supabase.from('retailers').select('area_id').eq('id', session.userId).maybeSingle<AreaRow>(),
    loadTaxonomyRows(supabase),
  ]);

  const batch = await loadCatalogBatch(
    supabase,
    { userId: session.userId, areaId: retailer?.area_id ?? null },
    filters,
    taxonomy.categories,
    taxonomy.brands,
    cursor
  );

  return {
    products: toMobileCatalogProducts(batch.cards),
    nextCursor: batch.nextCursor,
    resultCount: batch.resultCount,
    resultCapped: batch.resultCapped,
  };
}

/** The catalogue batch size the shared service uses, reported to the client. */
export const MOBILE_CATALOG_PAGE_SIZE = CATALOG_PAGE_SIZE;

// ---------------------------------------------------------------------------
// Product detail
// ---------------------------------------------------------------------------

/**
 * A superset of `PRODUCT_CARD_SELECT`, written out in full rather than built by
 * concatenation: PostgREST rejects a repeated `product_packs ( … )` embed, and
 * the detail screen needs extra columns on both the product and the pack.
 */
const PRODUCT_DETAIL_SELECT =
  'id, name, unit, hsn_code, barcode, lead_time_days, category_id, brand_id, gst_percent, is_new_launch, created_at, ' +
  'brands ( id, name ), categories ( id, name ), ' +
  'product_images ( id, image_url, sort_order ), ' +
  'product_packs ( id, pack_name, ptr, base_price, case_price, units_per_case, mrp, moq, allow_loose_pieces, barcode, image_url, is_active, sort_order )';

interface ProductDetailRow extends CatalogProductRow {
  unit: string;
  hsn_code: string | null;
  barcode: string | null;
  lead_time_days: number;
  categories: { id: string; name: string } | null;
  product_images: { id: string; image_url: string; sort_order: number }[];
  product_packs: (CatalogProductRow['product_packs'][number] & {
    allow_loose_pieces: boolean;
    barcode: string | null;
  })[];
}

interface PackImageRow {
  id: string;
  product_pack_id: string;
  image_url: string;
  sort_order: number;
}

export interface MobileProductPack {
  packId: string;
  packName: string;
  unitsPerCase: number;
  moq: number;
  /** Catalog case/loose metadata; the current retailer cart contract still uses one-piece increments. */
  allowLoosePieces: boolean;
  unitPricePaise: number | null;
  lineTotalAtMoqPaise: number | null;
  gstPercent: number;
  mrpPaise: number | null;
  derivedCasePricePaise: number | null;
  tiers: MobilePriceTier[];
  availability: AvailabilityState;
  /** True when this pack was the one the route was asked for. */
  selected: boolean;
  images: string[];
  /** Non-null when the engine refused this pack (no price, below MOQ, …). */
  message: string | null;
}

export interface MobileProductDetail {
  id: string;
  name: string;
  brandName: string | null;
  brandId: string | null;
  categoryId: string | null;
  categoryName: string | null;
  unit: string;
  hsnCode: string | null;
  gstPercent: number;
  leadTimeDays: number;
  isNewLaunch: boolean;
  isFavorite: boolean;
  hasOffer: boolean;
  images: string[];
  packs: MobileProductPack[];
}

/**
 * Resolve the route id to a product.
 *
 * The catalogue links to a pack (the variant the shopper was looking at) while
 * a deep link may name the product itself — the web PDP accepts both, and so
 * does this endpoint. An id that is neither an active product nor a visible
 * pack yields `null`, which the route turns into `404 not_found` (the same
 * answer for "does not exist" and "is not visible to you").
 */
async function resolveProductRef(
  supabase: SupabaseClient,
  id: string
): Promise<{ productId: string; requestedPackId: string | null } | null> {
  if (!isUuidLike(id)) return null;

  const { data: productRef } = await supabase
    .from('products')
    .select('id')
    .eq('id', id)
    .eq('is_active', true)
    .maybeSingle<{ id: string }>();
  if (productRef) return { productId: productRef.id, requestedPackId: null };

  const { data: packRef } = await supabase
    .from('product_packs')
    .select('id, product_id')
    .eq('id', id)
    .maybeSingle<{ id: string; product_id: string }>();
  if (!packRef) return null;
  return { productId: packRef.product_id, requestedPackId: packRef.id };
}

/** One product, priced per pack, in wire shape. */
export async function loadMobileProductDetail(
  session: MobileSession,
  id: string
): Promise<MobileProductDetail | null> {
  const supabase = retailerSupabase(session);

  const ref = await resolveProductRef(supabase, id);
  if (!ref) return null;

  const [{ data: retailer }, { data: product }, favoriteIds] = await Promise.all([
    supabase.from('retailers').select('area_id').eq('id', session.userId).maybeSingle<AreaRow>(),
    supabase
      .from('products')
      .select(PRODUCT_DETAIL_SELECT)
      .eq('id', ref.productId)
      .eq('is_active', true)
      .maybeSingle<ProductDetailRow>(),
    loadFavoriteIds(supabase, session.userId),
  ]);

  if (!product) return null;

  const areaId = retailer?.area_id ?? null;
  const activePacks = [...product.product_packs]
    .filter((pack) => pack.is_active)
    .sort((a, b) => a.sort_order - b.sort_order);

  const [pricingData, { data: packImageRows }, { data: offerRows }] = await Promise.all([
    loadCatalogPricing(supabase, [product], session.userId, areaId),
    supabase
      .from('product_pack_images')
      .select('id, product_pack_id, image_url, sort_order')
      .in('product_pack_id', activePacks.map((pack) => pack.id))
      .order('sort_order')
      .returns<PackImageRow[]>(),
    supabase
      .from('price_lists')
      .select('id')
      .eq('product_id', product.id)
      .in('scope', ['scheme', 'festival'])
      .eq('is_active', true)
      .lte('valid_from', new Date().toISOString())
      .limit(1)
      .returns<{ id: string }[]>(),
  ]);

  const override = pricingData.overrides.get(product.id) ?? null;
  const imagesByPack = new Map<string, string[]>();
  for (const row of packImageRows ?? []) {
    const list = imagesByPack.get(row.product_pack_id) ?? [];
    list.push(row.image_url);
    imagesByPack.set(row.product_pack_id, list);
  }

  const packs: MobileProductPack[] = activePacks.map((pack) => {
    const tiers = pricingData.packTiers.get(pack.id) ?? [];
    // Priced at the pack's own MOQ through the SAME engine checkout uses, so
    // the number on this screen is the number an order would be charged.
    const pricing = priceCatalogPack(pack, product, pricingData, pack.moq);
    const unitPrice = pricing.orderable && Number.isFinite(pricing.unitPrice) && pricing.unitPrice > 0
      ? pricing.unitPrice
      : null;
    const derivedPiece = pack.units_per_case > 0
      ? Math.round((resolvePackPrice(pack, override) / pack.units_per_case) * 100) / 100
      : null;

    return {
      packId: pack.id,
      packName: pack.pack_name,
      unitsPerCase: pack.units_per_case,
      moq: pack.moq,
      allowLoosePieces: pack.allow_loose_pieces,
      unitPricePaise: unitPrice === null ? null : toPaise(unitPrice),
      lineTotalAtMoqPaise: unitPrice === null ? null : toPaise(pricing.lineTotal),
      gstPercent: product.gst_percent,
      mrpPaise: pack.mrp == null ? null : toPaise(pack.mrp),
      derivedCasePricePaise: derivedPiece === null ? null : toPaise(derivedPiece) * pack.units_per_case,
      tiers: tiers.map((tier) => ({
        minQuantity: tier.min_quantity,
        maxQuantity: tier.max_quantity,
        pricePerPiecePaise: toPaise(tier.price_per_piece),
      })),
      // Availability is the sanctioned status-only RPC's answer for THIS pack.
      availability: normalizeAvailabilityState(pricingData.availability.get(pack.id)?.state ?? null),
      selected: pack.id === ref.requestedPackId,
      images: (imagesByPack.get(pack.id) ?? []).map((url) => url).filter((url) => url.length > 0),
      message: pricing.message,
    };
  });

  return {
    id: product.id,
    name: product.name,
    brandName: product.brands?.name ?? null,
    brandId: product.brand_id,
    categoryId: product.category_id,
    categoryName: product.categories?.name ?? null,
    unit: product.unit,
    hsnCode: product.hsn_code ?? null,
    gstPercent: product.gst_percent,
    leadTimeDays: product.lead_time_days,
    isNewLaunch: product.is_new_launch,
    isFavorite: favoriteIds.has(product.id),
    hasOffer: pricingData.offerIds.has(product.id) || (offerRows?.length ?? 0) > 0,
    images: [...product.product_images]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((image) => image.image_url),
    packs,
  };
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------

export interface MobileHome {
  banners: MobileBanner[];
  categories: MobileCatalogCategory[];
  brands: MobileCatalogBrand[];
  /** Discovery rail: the first catalogue batch in the default sort. */
  products: MobileCatalogProduct[];
  nextCursor: string | null;
}

/**
 * The retailer home payload for Phase D: real banners, real taxonomy and a real
 * catalogue batch.
 *
 * Deliberately NOT included yet — commerce reads have dedicated Phase E
 * endpoints, and adding summaries here would duplicate responses without a
 * home contract. Coins wallet/history and schemes belong to later work. The
 * home remains a catalogue/discovery payload, not a second commerce API.
 */
export async function loadMobileHome(
  session: MobileSession,
  filters: MobileCatalogFilters,
  nowMs: number = Date.now()
): Promise<MobileHome> {
  const supabase = retailerSupabase(session);

  const [{ data: retailer }, { data: bannerRows }, taxonomy] = await Promise.all([
    supabase.from('retailers').select('area_id').eq('id', session.userId).maybeSingle<AreaRow>(),
    // Same narrowing as the web home: active rows in the caller's area. The
    // IST schedule window is applied below by `isBannerVisible`, the one
    // place that decides it.
    (async () => {
      const { data } = await supabase.from('banners').select('*').eq('is_active', true);
      return { data };
    })(),
    // The SAME taxonomy read the catalogue panes use — one query shape, so the
    // home rails and the Categories/Brands panes can never disagree about the
    // shop's master data. A taxonomy outage degrades the two rails (and the
    // filter scope) and nothing else: unlike the catalogue panes, home still
    // returns banners and the product rail, so it does not fail as a whole.
    loadTaxonomyScope(supabase).catch(() => null),
  ]);

  const areaId = retailer?.area_id ?? null;

  // A banner read is never allowed to take the home screen down with it.
  let banners: MobileBanner[] = [];
  try {
    banners = toMobileBanners(
      (bannerRows ?? []) as MobileBannerRow[],
      areaId,
      nowMs,
      process.env.NEXT_PUBLIC_SITE_URL ?? null
    );
  } catch {
    banners = [];
  }

  const scope = {
    categories: (taxonomy?.categoryRows ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      parent_id: row.parent_id,
    })),
    brands: (taxonomy?.brandRows ?? []).map((row) => ({ id: row.id, name: row.name })),
  };

  const batch = await loadCatalogBatch(
    supabase,
    { userId: session.userId, areaId },
    filters,
    scope.categories,
    scope.brands,
    null
  );

  return {
    banners,
    // A `null` counts map is passed through as null: an unreadable count is
    // unknown, and must not be multiplied into a zero for every tile.
    categories: toMobileCategories(taxonomy?.categoryRows ?? [], taxonomy?.categoryCounts ?? null),
    brands: toMobileBrands(taxonomy?.brandRows ?? [], taxonomy?.brandCounts ?? null),
    products: toMobileCatalogProducts(batch.cards),
    nextCursor: batch.nextCursor,
  };
}
