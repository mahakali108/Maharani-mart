/**
 * Catalogue shaping for the mobile API (`/api/mobile/v1/catalog`, `/home`).
 *
 * This module is deliberately ISOMORPHIC and SECRET-FREE — it reads no
 * environment, opens no client and runs no query. It does exactly two things:
 *
 *   1. turns an untrusted query string into a validated filter object, and
 *   2. turns the rows the EXISTING retailer services already produce into the
 *      wire shape the Android app consumes.
 *
 * Every number the app displays is produced here, on the server:
 *   - money crosses the boundary as INTEGER PAISE (`toPaise`), never a float;
 *   - availability is the two-state customer vocabulary from
 *     `get_retailer_pack_availability` (`in_stock` / `out_of_stock`) plus the
 *     internal `unknown` fallback. Exact stock counts are never mapped;
 *   - pack size, MOQ and selling tiers come from the priced card the pricing
 *     engine returned, so the app cannot be handed a price that checkout would
 *     disagree with.
 *
 * No business rule lives here. Pricing, overrides, tier resolution and stock
 * status all come from `lib/retailer/*`; this file only re-labels them.
 *
 * Contract: docs/NATIVE_ANDROID_API_CONTRACT.md §2.3.
 */

import {
  parseCatalogSort,
  parseOptionalNumber,
  sanitizeSearchTerm,
  type CatalogSort,
} from '@/lib/retailer/catalog-params';
import { normalizeAvailabilityState } from '@/lib/retailer/availability';
import { toPaise } from '@/lib/retailer/case-pricing';
import { resolveMediaUrl } from '@/lib/media/refs';
import { isBannerVisible, resolveBannerTarget } from '@/lib/retailer/banner-target';
import type { PricedCatalogCard } from '@/lib/retailer/catalog';

/** The only availability values the customer-facing API may emit. */
export const MOBILE_AVAILABILITY = ['in_stock', 'out_of_stock', 'unknown'] as const;
export type MobileAvailability = (typeof MOBILE_AVAILABILITY)[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuidLike(value: string): boolean {
  return UUID_RE.test(value.trim());
}

/**
 * Catalogue filters for one mobile list request.
 *
 * Structurally identical to `lib/retailer/catalog-batches`' `CatalogFilters`
 * (the web catalogue's own filter object) so the same service answers both
 * surfaces and the two can never drift on what a filter means.
 */
export interface MobileCatalogFilters {
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
  onlyInStock: boolean;
}

export type ParsedCatalogQuery =
  | { ok: true; filters: MobileCatalogFilters }
  | { ok: false; field: string };

/**
 * The unfiltered catalogue: the default sort with no constraint active.
 *
 * Used by `/home`, whose discovery rail is simply the first batch of the real
 * catalogue — not a separately curated, and therefore separately stale, list.
 */
export const DEFAULT_MOBILE_CATALOG_FILTERS: MobileCatalogFilters = {
  q: '',
  categoryId: '',
  brandId: '',
  sort: 'recommended',
  minPrice: null,
  maxPrice: null,
  minDiscount: null,
  maxMoq: null,
  onlyFavorites: false,
  onlyNew: false,
  onlyOffers: false,
  onlyInStock: false,
};

/** Reject a min above max rather than silently returning an empty catalogue. */
function priceRange(minPrice: number | null, maxPrice: number | null): string | null {
  if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) return 'minPrice';
  return null;
}

/**
 * Parse + validate the catalogue query string.
 *
 * Identity is never read here: there is no `retailerId`, `areaId` or `role`
 * parameter, and a caller that sends one gets nothing — those come from the
 * verified bearer token in `requireMobileSession`.
 *
 * Unknown `sort` values fall back to `recommended` (the web's own behaviour via
 * `parseCatalogSort`) instead of erroring, so an older app asking for a sort a
 * newer server renamed still gets a real list.
 */
export function parseCatalogQuery(url: URL | string): ParsedCatalogQuery {
  const search = new URL(typeof url === 'string' ? url : url.toString()).searchParams;

  const categoryId = search.get('categoryId')?.trim() ?? '';
  if (categoryId !== '' && !isUuidLike(categoryId)) return { ok: false, field: 'categoryId' };

  const brandId = search.get('brandId')?.trim() ?? '';
  if (brandId !== '' && !isUuidLike(brandId)) return { ok: false, field: 'brandId' };

  const minPrice = parseOptionalNumber(search.get('minPrice') ?? undefined);
  const maxPrice = parseOptionalNumber(search.get('maxPrice') ?? undefined);
  if (minPrice !== null && minPrice < 0) return { ok: false, field: 'minPrice' };
  if (maxPrice !== null && maxPrice < 0) return { ok: false, field: 'maxPrice' };
  const rangeError = priceRange(minPrice, maxPrice);
  if (rangeError) return { ok: false, field: rangeError };

  return {
    ok: true,
    filters: {
      q: sanitizeSearchTerm(search.get('q') ?? ''),
      categoryId,
      brandId,
      sort: parseCatalogSort(search.get('sort') ?? undefined),
      minPrice,
      maxPrice,
      minDiscount: parseOptionalNumber(search.get('discount') ?? undefined),
      maxMoq: parseOptionalNumber(search.get('maxMoq') ?? undefined),
      onlyFavorites: search.get('fav') === '1',
      onlyNew: search.get('new') === '1',
      onlyOffers: search.get('offers') === '1',
      onlyInStock: search.get('inStock') === '1',
    },
  };
}

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

/** One selling tier of a pack, in paise. Bounds are in PIECES. */
export interface MobilePriceTier {
  minQuantity: number;
  maxQuantity: number | null;
  pricePerPiecePaise: number;
}

/**
 * The variant the card is priced at.
 *
 * `null` on the parent object means the product has no active pack — it is
 * listed so the catalogue is complete, but carries no price, no MOQ and no
 * availability, and the app must not offer to order it.
 */
export interface MobileCatalogPack {
  packId: string;
  /** Pack size as the retailer knows it (`500g`, `5L Jar`, …). */
  packName: string | null;
  unitsPerCase: number | null;
  /** Minimum order quantity in pieces, exactly as the pricing engine saw it. */
  moq: number | null;
  /** GST-inclusive per-piece rate at the pack's MOQ. Server-computed. */
  unitPricePaise: number | null;
  /** Printed MRP, when the pack has one. Server-computed. */
  mrpPaise: number | null;
  /** Case price implied by the resolved pack price. Display only. */
  derivedCasePricePaise: number | null;
  /** The active slab table, so the app can show "N+ pcs se ₹X/pc" truthfully. */
  tiers: MobilePriceTier[];
  availability: MobileAvailability;
}

export interface MobileCatalogProduct {
  id: string;
  name: string;
  brandName: string | null;
  /** Resolved public URL, or null when the stored value is not renderable. */
  imageUrl: string | null;
  isNewLaunch: boolean;
  categoryId: string | null;
  brandId: string | null;
  createdAt: string;
  hasOffer: boolean;
  isFavorite: boolean;
  pack: MobileCatalogPack | null;
}

function mobileTiers(card: PricedCatalogCard): MobilePriceTier[] {
  const tiers = card.piecePricing?.tiers ?? [];
  return tiers.map((tier) => ({
    minQuantity: tier.min_quantity,
    maxQuantity: tier.max_quantity,
    pricePerPiecePaise: toPaise(tier.price_per_piece),
  }));
}

function mobilePack(card: PricedCatalogCard): MobileCatalogPack | null {
  const packId = card.defaultPackId;
  if (!packId) return null;

  const unitsPerCase = card.piecePricing?.unitsPerCase ?? null;
  const derivedPiecePrice = card.piecePricing?.derivedPiecePrice ?? null;

  return {
    packId,
    packName: card.packName ?? null,
    unitsPerCase,
    moq: card.moq ?? null,
    // `fromPrice === null` means the pricing engine could not resolve a rate
    // (pricing unavailable, or no selling price configured). It is reported as
    // null, never as zero: a zero price would look like "free" on the device.
    unitPricePaise: card.fromPrice === null ? null : toPaise(card.fromPrice),
    mrpPaise: card.mrp == null ? null : toPaise(card.mrp),
    derivedCasePricePaise:
      derivedPiecePrice === null || unitsPerCase === null
        ? null
        : toPaise(derivedPiecePrice) * unitsPerCase,
    tiers: mobileTiers(card),
    availability: normalizeAvailabilityState(card.availability),
  };
}

/** One catalogue card, exactly as the Android list renders it. */
export function toMobileCatalogProduct(card: PricedCatalogCard): MobileCatalogProduct {
  return {
    id: card.id,
    name: card.name,
    brandName: card.brandName ?? null,
    imageUrl: resolveMediaUrl(card.imageUrl),
    isNewLaunch: card.isNewLaunch,
    categoryId: card.categoryId,
    brandId: card.brandId,
    createdAt: card.createdAt,
    hasOffer: card.hasOffer ?? false,
    isFavorite: card.isFavorite ?? false,
    pack: mobilePack(card),
  };
}

export function toMobileCatalogProducts(cards: PricedCatalogCard[]): MobileCatalogProduct[] {
  return cards.map(toMobileCatalogProduct);
}

// ---------------------------------------------------------------------------
// Categories / brands
// ---------------------------------------------------------------------------

/**
 * The columns the taxonomy read selects.
 *
 * Deliberately PLAIN columns: no `products(count)` aggregate embed. Counting
 * through an aggregate is a second, optional PostgREST capability
 * (`db-aggregates-enabled`), and when it is unavailable the *whole* query fails
 * — which would take the category list down with it, not just its counts. The
 * taxonomy is read the same way the catalogue's own filter scope reads it
 * (`loadTaxonomyRows`), i.e. through the one query shape this API has already
 * proven against the caller's RLS, and the counts are derived separately.
 */
export interface MobileCategoryRow {
  id: string;
  name: string;
  image_url: string | null;
  parent_id: string | null;
}

export interface MobileCatalogCategory {
  id: string;
  name: string;
  imageUrl: string | null;
  parentName: string | null;
  /** Active products in the category and its active children; null = unknown. */
  productCount: number | null;
}

/**
 * Parent categories with their rolled-up active product count.
 *
 * Mirrors `homeCategories` in `lib/retailer/home-data.ts` — the same scope
 * (parent + its active immediate children) and the same honesty rule: a count
 * the server could not read completely is `null`, never an invented zero. A
 * category that genuinely has no active products is a real `0` (the scan
 * completed, so the absence of a row IS the answer).
 *
 * A flat taxonomy (no parent rows at all) is listed in full rather than
 * silently emptied.
 */
export function toMobileCategories(
  rows: MobileCategoryRow[],
  counts: ReadonlyMap<string, number> | null
): MobileCatalogCategory[] {
  const parents = rows.filter((row) => !row.parent_id);
  const shown = parents.length > 0 ? parents : rows;

  return shown.map((row) => {
    const scope = rows.filter((candidate) => candidate.id === row.id || candidate.parent_id === row.id);
    return {
      id: row.id,
      name: row.name,
      imageUrl: resolveMediaUrl(row.image_url),
      parentName: null,
      productCount: counts === null
        ? null
        : scope.reduce((sum, candidate) => sum + (counts.get(candidate.id) ?? 0), 0),
    };
  });
}

export interface MobileBrandRow {
  id: string;
  name: string;
  logo_url: string | null;
}

export interface MobileCatalogBrand {
  id: string;
  name: string;
  logoUrl: string | null;
  productCount: number | null;
}

export function toMobileBrands(
  rows: MobileBrandRow[],
  counts: ReadonlyMap<string, number> | null
): MobileCatalogBrand[] {
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    logoUrl: resolveMediaUrl(row.logo_url),
    productCount: counts === null ? null : counts.get(row.id) ?? 0,
  }));
}

// ---------------------------------------------------------------------------
// Banners
// ---------------------------------------------------------------------------

/** The `banners` row, narrowed to the columns the storefront uses. */
export interface MobileBannerRow {
  id: string;
  title: string;
  subtitle: string | null;
  image_url: string;
  cta_label: string | null;
  link_url: string | null;
  is_active: boolean;
  area_id: string | null;
  starts_at: string | null;
  ends_at: string | null;
}

export interface MobileBanner {
  id: string;
  title: string;
  subtitle: string | null;
  imageUrl: string | null;
  ctaLabel: string | null;
  /** Safe navigation target, or null when the stored link is not navigable. */
  linkUrl: string | null;
}

/**
 * Eligible banners, in the admin's own order.
 *
 * Visibility is decided by the SAME function the web storefront uses
 * (`isBannerVisible`: active + area targeting + the IST schedule window) and
 * the link is passed through `resolveBannerTarget`, which only ever yields a
 * rooted app route or an http(s) URL — a `javascript:` value becomes `null`.
 *
 * An empty array is a legitimate answer: the app then shows its own fallback
 * rather than a fabricated promotion.
 */
export function toMobileBanners(
  rows: MobileBannerRow[],
  areaId: string | null,
  nowMs: number,
  siteUrl?: string | null
): MobileBanner[] {
  return rows
    .filter((banner) => isBannerVisible(banner, areaId, nowMs))
    .map((banner) => ({
      id: banner.id,
      title: banner.title,
      subtitle: banner.subtitle ?? null,
      imageUrl: resolveMediaUrl(banner.image_url),
      ctaLabel: banner.cta_label ?? null,
      linkUrl: resolveBannerTarget(banner.link_url, siteUrl)?.href ?? null,
    }));
}

// ---------------------------------------------------------------------------
// Home offers (schemes)
// ---------------------------------------------------------------------------

/**
 * The `schemes` row, narrowed to the columns the storefront's home shows.
 *
 * The mobile `/schemes` endpoint already answers these rows; the home payload
 * carries the SAME shape so a retailer sees one offers list, not two that could
 * disagree. `endsAt` is what makes an offer a deadline rather than a label.
 */
export interface MobileSchemeRow {
  id: string;
  name: string;
  description: string | null;
  is_festival: boolean;
  starts_at: string;
  ends_at: string;
}

export interface MobileHomeScheme {
  id: string;
  name: string;
  description: string | null;
  isFestival: boolean;
  startsAt: string;
  endsAt: string;
}

/**
 * Active, in-window schemes in wire shape — the web home's own mapping.
 *
 * The window itself is applied by the QUERY (`is_active` + `starts_at <= now` +
 * `ends_at >= now`), exactly as `lib/retailer/home-data.ts` and the mobile
 * `/schemes` route do it, so there is one scheduler and not three.
 */
export function toMobileHomeSchemes(rows: MobileSchemeRow[]): MobileHomeScheme[] {
  return rows.map((scheme) => ({
    id: scheme.id,
    name: scheme.name,
    description: scheme.description ?? null,
    isFestival: scheme.is_festival,
    startsAt: scheme.starts_at,
    endsAt: scheme.ends_at,
  }));
}
