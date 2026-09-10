import 'server-only';

import type { createClient } from '@/lib/supabase/server';
import {
  getActiveOfferProductIds,
  getProductPriceOverrides,
  resolvePackPrice,
} from '@/lib/retailer/effective-price';
import {
  piecePriceFromCase,
  resolveLooseTierSet,
  type PricingTier,
} from '@/lib/retailer/case-pricing';
import { calcDiscountPercent } from '@/lib/retailer/format';
import { loadPackTiers } from '@/lib/retailer/pricing-data';
import type { ProductCardProps } from '@/components/retailer/product-card';
import { buildProductCardName } from '@/lib/retailer/product-name';

export const PRODUCT_CARD_SELECT =
  'id, name, category_id, brand_id, gst_percent, is_new_launch, created_at, brands ( id, name ), product_images ( image_url, sort_order ), product_packs ( id, pack_name, ptr, base_price, case_price, units_per_case, mrp, moq, image_url, is_active, sort_order )';

export interface CatalogProductRow {
  id: string;
  name: string;
  category_id: string | null;
  brand_id: string | null;
  gst_percent: number;
  is_new_launch: boolean;
  created_at: string;
  brands: { id: string; name: string } | null;
  product_images: { image_url: string; sort_order: number }[];
  product_packs: {
    id: string;
    pack_name: string;
    ptr: number | null;
    base_price: number;
    case_price: number;
    units_per_case: number;
    mrp: number | null;
    moq: number;
    image_url: string | null;
    is_active: boolean;
    sort_order: number;
  }[];
}

export interface PricedCatalogCard extends ProductCardProps {
  categoryId: string | null;
  brandId: string | null;
  createdAt: string;
  timesOrdered: number;
}

function bestPricedPack(product: CatalogProductRow, override: number | null) {
  const activePacks = [...product.product_packs]
    .filter((pack) => pack.is_active)
    .sort((a, b) => a.sort_order - b.sort_order);
  const priced = activePacks.map((pack) => {
    // Internal GST-inclusive case price — NEVER shown to the retailer.
    const price = resolvePackPrice(pack, override);
    return {
      pack,
      price,
      // Reference per-piece rate (internal case price ÷ units per case). The
      // card shows this as the "from ₹/pc" figure; the case total is internal.
      piecePrice: piecePriceFromCase(price, pack.units_per_case),
    };
  });
  return priced.sort((a, b) => a.piecePrice - b.piecePrice)[0] ?? null;
}

/**
 * Builds a one-line "buy more, save more" hint for a product card from the
 * variant's selling tiers. Example: "7+ pcs se ₹80/pc". Only ever shown when
 * the admin has configured at least one deeper selling tier — the value comes
 * from the SAME tier rows the server uses to price the cart / order, so the
 * card can never advertise a rate the checkout will not honour.
 */
export function nextTierHint(
  tiers: PricingTier[] | null | undefined,
  unitsPerCase: number,
  currentFromPrice: number | null
): { minQuantity: number; pricePerPiece: number; label: string } | null {
  if (currentFromPrice === null) return null;
  const loose = resolveLooseTierSet(tiers ?? [], unitsPerCase).tiers;
  if (loose.length < 2) return null;
  // Find the next tier the retailer can reach — strictly better rate than the
  // displayed "from" price, and with a min quantity above 1.
  const sorted = [...loose].sort((a, b) => a.min_quantity - b.min_quantity);
  const next = sorted.find(
    (tier) => tier.min_quantity > 1 && tier.price_per_piece < currentFromPrice
  );
  if (!next) return null;
  const rate = next.price_per_piece;
  return {
    minQuantity: next.min_quantity,
    pricePerPiece: rate,
    label: `${next.min_quantity}+ pcs se ₹${rate.toFixed(0)}/pc`,
  };
}

export function toPricedCard(
  product: CatalogProductRow,
  override: number | null,
  extras: {
    isFavorite?: boolean;
    hasOffer?: boolean;
    timesOrdered?: number;
    tierHint?: { minQuantity: number; pricePerPiece: number; label: string } | null;
  } = {}
): PricedCatalogCard {
  const best = bestPricedPack(product, override);
  const images = [...product.product_images].sort((a, b) => a.sort_order - b.sort_order);
  // Universal product name: use canonical product name, not category.
  // Product card shows brand separately, so we build name as product + pack (size)
  // without duplicating size if already in product name.
  const cardName = buildProductCardName({
    productName: product.name,
    packName: best?.pack.pack_name ?? null,
  });
  return {
    id: product.id,
    name: cardName,
    brandName: product.brands?.name,
    // Prefer the shown variant's own image (Phase 3), falling back to the
    // parent product's gallery exactly as before when it has none.
    imageUrl: best?.pack.image_url ?? images[0]?.image_url,
    isNewLaunch: product.is_new_launch,
    fromPrice: best?.piecePrice ?? null,
    mrp: best?.pack.mrp,
    packName: best?.pack.pack_name,
    moq: best?.pack.moq ?? 1,
    defaultPackId: best?.pack.id ?? null,
    gstPercent: product.gst_percent,
    isFavorite: extras.isFavorite ?? false,
    hasOffer: extras.hasOffer ?? false,
    nextTierHint: extras.tierHint ?? null,
    categoryId: product.category_id,
    brandId: product.brand_id,
    createdAt: product.created_at,
    timesOrdered: extras.timesOrdered ?? 0,
  };
}

export async function priceCatalogProducts(
  supabase: ReturnType<typeof createClient>,
  products: CatalogProductRow[],
  retailerId: string,
  areaId: string | null,
  favoriteIds: Set<string> = new Set(),
  frequency: Map<string, number> = new Map()
): Promise<PricedCatalogCard[]> {
  const ids = products.map((product) => product.id);
  const [overrides, offerIds, packTiers] = await Promise.all([
    getProductPriceOverrides(supabase, ids, retailerId, areaId),
    getActiveOfferProductIds(supabase, ids),
    // Pull pricing tiers for every variant we are about to render so we can
    // surface a "buy more, save more" hint on the card. RLS already keeps
    // inactive tiers out of the retailer's view; we still filter on
    // is_active=true above. One query covers every pack of every product in
    // the working set.
    loadPackTiers(
      supabase,
      products.flatMap((product) => product.product_packs.map((pack) => pack.id))
    ),
  ]);

  return products.map((product) => {
    const override = overrides.get(product.id) ?? null;
    const offerIdsHas = offerIds.has(product.id);
    const best = bestPricedPack(product, override);
    const hint = best
      ? nextTierHint(packTiers.get(best.pack.id) ?? [], best.pack.units_per_case, best.piecePrice)
      : null;
    return toPricedCard(product, override, {
      isFavorite: favoriteIds.has(product.id),
      hasOffer: offerIdsHas,
      timesOrdered: frequency.get(product.id) ?? 0,
      tierHint: hint,
    });
  });
}

export async function loadProductsByIds(
  supabase: ReturnType<typeof createClient>,
  productIds: string[]
): Promise<CatalogProductRow[]> {
  const unique = [...new Set(productIds.filter(Boolean))];
  if (unique.length === 0) return [];

  const { data } = await supabase
    .from('products')
    .select(PRODUCT_CARD_SELECT)
    .in('id', unique)
    .eq('is_active', true)
    .returns<CatalogProductRow[]>();

  const byId = new Map((data ?? []).map((product) => [product.id, product]));
  return unique.map((id) => byId.get(id)).filter((product): product is CatalogProductRow => !!product);
}

export function discountForCard(card: Pick<PricedCatalogCard, 'mrp' | 'fromPrice'>): number {
  return calcDiscountPercent(card.mrp, card.fromPrice);
}

export async function loadFavoriteIds(
  supabase: ReturnType<typeof createClient>,
  retailerId: string
): Promise<Set<string>> {
  const { data } = await supabase
    .from('retailer_favorites')
    .select('product_id')
    .eq('retailer_id', retailerId)
    .returns<{ product_id: string }[]>();
  return new Set((data ?? []).map((row) => row.product_id));
}
