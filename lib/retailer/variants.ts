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
 * No price is computed here — pricing stays in lib/retailer/case-pricing.ts
 * and remains server-authoritative. No availability is invented: a variant
 * is "available" only when its `is_active` flag (and its parent product's)
 * is true, exactly what RLS already exposes to retailers.
 */

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
  selectedPackId: string | null
): VariantSwitcherModel {
  const ordered = [...(packs ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const variants: VariantSwitcherItem[] = ordered.map((pack) => ({
    packId: pack.id,
    label: pack.pack_name,
    href: variantHref(pack.id),
    isSelected: pack.id === selectedPackId,
    isAvailable: pack.is_active,
  }));
  return {
    variants,
    hasSelectableVariants: variants.some((variant) => variant.isAvailable),
  };
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
