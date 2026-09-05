/**
 * Product variant (pack-size) helpers — pure, side-effect free.
 *
 * BUSINESS MODEL
 * --------------
 * A parent product (`products` row) sells through one or more
 * size/variants stored as `product_packs` rows — e.g. Baby Powder 50g,
 * 100g, 200g. Every pack already carries its own units_per_case,
 * GST-inclusive case_price, MRP, MOQ, quantity tiers (`product_pricing_tiers`)
 * and active flag. This module contains only the pure presentation /
 * navigation rules for the retailer-facing variant switcher:
 *
 *   - the URL of a variant's own product-detail route
 *   - the ordered switcher model (which pills render, which is selected,
 *     which is unavailable)
 *   - the gallery image list for a variant (pack image first, parent
 *     product gallery as the existing fallback)
 *
 * No NEW price is invented here. The switcher only *presents* per-piece
 * numbers the caller already resolved server-side from the pack's own selling
 * tiers; the internal case_price / units_per_case and any product-level
 * override stay in the pricing layer and are never surfaced to a retailer.
 * Pricing remains server-authoritative. No availability is invented: a variant
 * is "available" only when its `is_active` flag (and its parent product's)
 * is true, exactly what RLS already exposes to retailers.
 *
 * Stock quantities are deliberately NOT surfaced here: inventory lives at
 * product level (not per pack) and is staff-only under RLS
 * (`inventory_staff`), so a retailer-facing per-variant stock number would be
 * both invented and a data leak. See docs/warehouse-gaps.md.
 */

import { round2 } from '@/lib/retailer/case-pricing';
import { calcDiscountPercent } from '@/lib/retailer/format';

/** Server-resolved, GST-inclusive numbers for one variant card. */
export interface VariantPricing {
  /**
   * GST-INCLUSIVE per-piece selling price shown on the size pill. Resolved by
   * the caller from the variant's own selling tiers (deepest/`from` rate), never
   * derived in the browser.
   */
  piecePrice: number;
  /** Printed MRP per piece, when the admin recorded one. */
  mrp: number | null;
  /** Saving vs MRP, in %, 0 when there is no real MRP advantage. */
  discountPercent: number;
  /** True only when an active scheme/offer row really exists for the product. */
  hasOffer: boolean;
}

/** Pricing inputs a page may supply per pack (already resolved server-side). */
export interface VariantPricingInput {
  piecePrice: number;
  mrp?: number | null;
  hasOffer?: boolean;
}

/** A minimal pack shape needed for switcher/gallery decisions. */
export interface VariantPackBase {
  id: string;
  pack_name: string;
  is_active: boolean;
  sort_order: number;
}

const UUID_LIKE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The retailer product-detail route accepts either a parent product id
 * (existing links — renders the default variant) or a pack id (the exact
 * variant route the switcher navigates to). Both share /retailer/catalog/[id],
 * so browser back/forward between variants works naturally.
 */
export function isUuidLike(value: string | undefined | null): value is string {
  return typeof value === 'string' && UUID_LIKE_RE.test(value);
}

/** Canonical URL for one variant's product detail page. */
export function variantHref(packId: string): string {
  return `/retailer/catalog/${packId}`;
}

export interface VariantSwitcherItem {
  packId: string;
  /** Size label shown in the pill, e.g. "50g". */
  label: string;
  /** Route of this variant's own product detail page. */
  href: string;
  isSelected: boolean;
  /**
   * True only when the pack (and implicitly the parent product) is active.
   * Unavailable variants are never navigable or purchasable — the server
   * still re-validates every cart/order line.
   */
  isAvailable: boolean;
  /**
   * Real, server-resolved pricing for this variant, present only when the
   * caller supplied it. Never estimated and never computed in the browser —
   * the page passes the same numbers the server-side quote would use.
   */
  pricing: VariantPricing | null;
  /**
   * True for the variant with the strictly lowest per-piece price among the
   * available variants of this product. Only set when real prices were
   * supplied for more than one variant and a genuine advantage exists.
   */
  isBestValue: boolean;
}

export interface VariantSwitcherModel {
  variants: VariantSwitcherItem[];
  /** At least one navigable variant exists. */
  hasSelectableVariants: boolean;
}

/**
 * Builds the ordered size/variant switcher model from the parent product's
 * packs (already sorted by sort_order). Selected pill = the variant whose
 * id is in the URL. Inactive packs (visible only to staff — retailer RLS
 * hides them) render as a disabled "Unavailable" state, never as a link,
 * so availability is never faked.
 */
export function buildVariantSwitcher(
  packs: VariantPackBase[],
  selectedPackId: string | null,
  pricingByPackId?: Map<string, VariantPricingInput> | null
): VariantSwitcherModel {
  const ordered = [...(packs ?? [])].sort((a, b) => a.sort_order - b.sort_order);

  const variants: VariantSwitcherItem[] = ordered.map((pack) => {
    const input = pricingByPackId?.get(pack.id) ?? null;
    const pricing: VariantPricing | null = input
      ? {
          piecePrice: round2(input.piecePrice),
          mrp: input.mrp ?? null,
          discountPercent: calcDiscountPercent(input.mrp ?? null, round2(input.piecePrice)),
          hasOffer: input.hasOffer === true,
        }
      : null;

    return {
      packId: pack.id,
      label: pack.pack_name,
      href: variantHref(pack.id),
      isSelected: pack.id === selectedPackId,
      isAvailable: pack.is_active,
      pricing,
      isBestValue: false,
    };
  });

  markBestValueVariant(variants);

  return {
    variants,
    hasSelectableVariants: variants.some((variant) => variant.isAvailable),
  };
}

/**
 * Flags the available variant with the strictly lowest per-piece price.
 *
 * The badge is only awarded when at least two available variants have real
 * prices AND there is a genuine advantage (>= ₹0.005/piece) — a product whose
 * sizes all work out to the same per-piece rate gets no badge rather than an
 * arbitrary winner. Ties keep the first (lowest sort_order) variant.
 */
function markBestValueVariant(variants: VariantSwitcherItem[]): void {
  const priced = variants.filter((variant) => variant.isAvailable && variant.pricing !== null);
  if (priced.length < 2) return;

  let best = priced[0]!;
  let worst = priced[0]!;
  for (const variant of priced) {
    if (variant.pricing!.piecePrice < best.pricing!.piecePrice) best = variant;
    if (variant.pricing!.piecePrice > worst.pricing!.piecePrice) worst = variant;
  }
  if (worst.pricing!.piecePrice - best.pricing!.piecePrice >= 0.005) {
    best.isBestValue = true;
  }
}

export interface VariantGalleryImage {
  id: string;
  image_url: string;
}

/**
 * Gallery images for the selected variant:
 *   1. the variant's own image (when the admin uploaded one) — always first,
 *      so switching 50g -> 100g -> 200g swaps the main image;
 *   2. the parent product's existing gallery as the safe fallback;
 *   3. an empty list when neither exists — the gallery renders its existing
 *      "Product image unavailable" placeholder.
 */
export function variantGalleryImages(
  pack: { id: string; image_url?: string | null } | null | undefined,
  productImages: VariantGalleryImage[]
): VariantGalleryImage[] {
  const sorted = [...(productImages ?? [])];
  const packImage = pack?.image_url ? pack.image_url.trim() : '';
  if (packImage) {
    return [{ id: `pack-${pack!.id}`, image_url: packImage }, ...sorted];
  }
  return sorted;
}
