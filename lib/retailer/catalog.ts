import 'server-only';

import type { createClient } from '@/lib/supabase/server';
import {
  getActiveOfferProductIds,
  getProductPriceOverrides,
  resolvePackPrice,
} from '@/lib/retailer/effective-price';
import { piecePriceFromCase, resolveLooseTierSet, type PricingTier } from '@/lib/retailer/case-pricing';
import { calculateRetailerPiecePrice } from '@/lib/retailer/retailer-pricing';
import { normalizeAvailabilityState, type AvailabilityState } from '@/lib/retailer/availability';
import { calcDiscountPercent } from '@/lib/retailer/format';
import { loadPackTiers } from '@/lib/retailer/pricing-data';
import type { ProductCardProps, SlabOffer } from '@/components/retailer/product-card';
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

export type CatalogPack = CatalogProductRow['product_packs'][number];

export interface PricedCatalogCard extends ProductCardProps {
  categoryId: string | null;
  brandId: string | null;
  createdAt: string;
  timesOrdered: number;
}

/** One batched read is shared by home discovery, reorder and cart previews. */
export interface CatalogPricingData {
  overrides: Map<string, number | null>;
  offerIds: Set<string>;
  packTiers: Map<string, PricingTier[]>;
  availability: Map<string, AvailabilityState>;
}

export function priceCatalogPack(pack: CatalogPack, product: CatalogProductRow, data: CatalogPricingData, quantity: number) {
  return calculateRetailerPiecePrice({
    quantity,
    unitsPerCase: pack.units_per_case,
    casePrice: resolvePackPrice(pack, data.overrides.get(product.id) ?? null),
    tiers: data.packTiers.get(pack.id) ?? [],
    gstPercent: product.gst_percent,
    moq: pack.moq,
  });
}

function bestPricedPack(product: CatalogProductRow, override: number | null, packTiers: Map<string, PricingTier[]>) {
  const activePacks = [...product.product_packs]
    .filter((pack) => pack.is_active)
    .sort((a, b) => a.sort_order - b.sort_order);
  const priced = activePacks.map((pack) => {
    const price = resolvePackPrice(pack, override);
    const tiers = packTiers.get(pack.id) ?? [];
    const pricing = calculateRetailerPiecePrice({
      quantity: pack.moq,
      unitsPerCase: pack.units_per_case,
      casePrice: price,
      tiers,
      gstPercent: product.gst_percent,
      moq: pack.moq,
    });
    return {
      pack,
      // Only this GST-inclusive piece fallback crosses the client boundary.
      derivedPiecePrice: piecePriceFromCase(price, pack.units_per_case),
      pricing,
      tiers,
      piecePrice: pricing.orderable && Number.isFinite(pricing.unitPrice) ? pricing.unitPrice : null,
    };
  });
  return priced.sort((a, b) => (a.piecePrice ?? Infinity) - (b.piecePrice ?? Infinity))[0] ?? null;
}

/** Real next slab, priced through the same engine as checkout. */
export function nextTierHint(
  tiers: PricingTier[] | null | undefined,
  unitsPerCase: number,
  currentFromPrice: number | null,
  currentQuantity = 1
): { minQuantity: number; pricePerPiece: number; label: string } | null {
  if (currentFromPrice === null) return null;
  const loose = resolveLooseTierSet(tiers ?? [], unitsPerCase).tiers;
  if (loose.length < 2) return null;
  for (const tier of loose) {
    if (tier.min_quantity <= currentQuantity) continue;
    const pricing = calculateRetailerPiecePrice({
      quantity: tier.min_quantity, unitsPerCase, casePrice: 0, tiers,
    });
    if (pricing.orderable && pricing.unitPrice < currentFromPrice) {
      return {
        minQuantity: tier.min_quantity,
        pricePerPiece: pricing.unitPrice,
        label: `${tier.min_quantity}+ pcs se ₹${Number(pricing.unitPrice.toFixed(2))}/pc`,
      };
    }
  }
  return null;
}

/** Best reachable slab, not a misleading case-derived or below-MOQ rate.
 * The quantity range is retained: non-monotonic rates must not say “N+”. */
export function bestSlabOffer(
  tiers: PricingTier[], unitsPerCase: number, moq: number, currentPrice: number | null
): SlabOffer | null {
  if (currentPrice === null) return null;
  const loose = resolveLooseTierSet(tiers, unitsPerCase).tiers;
  let best: SlabOffer | null = null;
  for (const [index, tier] of loose.entries()) {
    const quantity = Math.max(moq, tier.min_quantity);
    if (quantity > 100_000 || quantity <= moq) continue;
    const pricing = calculateRetailerPiecePrice({ quantity, unitsPerCase, casePrice: 0, tiers, moq });
    if (!pricing.orderable || !Number.isFinite(pricing.unitPrice) || pricing.unitPrice >= currentPrice) continue;
    if (!best || pricing.unitPrice < best.pricePerPiece) {
      best = {
        minQuantity: quantity,
        maxQuantity: index === loose.length - 1 ? null : (pricing.tier?.max_quantity ?? null),
        pricePerPiece: pricing.unitPrice,
      };
    }
  }
  return best;
}

export function toPricedCard(
  product: CatalogProductRow,
  override: number | null,
  extras: {
    isFavorite?: boolean;
    hasOffer?: boolean;
    timesOrdered?: number;
    tierHint?: { minQuantity: number; pricePerPiece: number; label: string } | null;
    packTiers?: Map<string, PricingTier[]>;
    availability?: AvailabilityState;
    pricingUnavailable?: boolean;
  } = {}
): PricedCatalogCard {
  const best = bestPricedPack(product, override, extras.packTiers ?? new Map());
  const images = [...product.product_images].sort((a, b) => a.sort_order - b.sort_order);
  const fromPrice = extras.pricingUnavailable ? null : best?.piecePrice ?? null;
  return {
    id: product.id,
    name: buildProductCardName({ productName: product.name, packName: best?.pack.pack_name ?? null }),
    brandName: product.brands?.name,
    imageUrl: best?.pack.image_url || images[0]?.image_url,
    isNewLaunch: product.is_new_launch,
    fromPrice,
    mrp: best?.pack.mrp,
    packName: best?.pack.pack_name,
    moq: best?.pack.moq,
    defaultPackId: best?.pack.id ?? null,
    gstPercent: product.gst_percent,
    availability: extras.availability ?? 'unknown',
    isFavorite: extras.isFavorite ?? false,
    hasOffer: extras.hasOffer ?? false,
    nextTierHint: fromPrice === null || !best ? null : extras.tierHint ?? nextTierHint(best.tiers, best.pack.units_per_case, fromPrice, best.pack.moq),
    bestSlab: fromPrice === null || !best ? null : bestSlabOffer(best.tiers, best.pack.units_per_case, best.pack.moq, fromPrice),
    piecePricing: best && fromPrice !== null ? {
      unitsPerCase: best.pack.units_per_case,
      derivedPiecePrice: best.derivedPiecePrice,
      tiers: best.pricing.tiers,
    } : undefined,
    categoryId: product.category_id,
    brandId: product.brand_id,
    createdAt: product.created_at,
    timesOrdered: extras.timesOrdered ?? 0,
  };
}

/** Sanctioned retailer RPC only. No warehouse/batch data or invented stock.
 * A missing RPC/failed read stays unknown, never “in stock”. */
export async function loadCatalogAvailability(supabase: ReturnType<typeof createClient>, productIds: string[]) {
  const ids = [...new Set(productIds)];
  const states = new Map<string, AvailabilityState>();
  for (let i = 0; i < ids.length; i += 100) {
    try {
      const { data, error } = await supabase.rpc('get_retailer_product_availability' as never, { p_product_ids: ids.slice(i, i + 100) } as never) as unknown as {
        data: { product_id: string; stock_status: string }[] | null; error: unknown;
      };
      if (!error) for (const row of data ?? []) states.set(row.product_id, normalizeAvailabilityState(row.stock_status));
    } catch {
      // Discovery remains usable when availability cannot be checked.
    }
  }
  return states;
}

export async function loadCatalogPricing(
  supabase: ReturnType<typeof createClient>, products: CatalogProductRow[], retailerId: string, areaId: string | null
): Promise<CatalogPricingData> {
  const ids = products.map((product) => product.id);
  const [overrides, offerIds, packTiers, availability] = await Promise.all([
    getProductPriceOverrides(supabase, ids, retailerId, areaId),
    getActiveOfferProductIds(supabase, ids),
    loadPackTiers(supabase, products.flatMap((product) => product.product_packs.map((pack) => pack.id))),
    loadCatalogAvailability(supabase, ids),
  ]);
  return { overrides, offerIds, packTiers, availability };
}

export function priceCatalogRows(
  products: CatalogProductRow[], data: CatalogPricingData, favoriteIds: Set<string> = new Set(), frequency: Map<string, number> = new Map()
): PricedCatalogCard[] {
  return products.map((product) => toPricedCard(product, data.overrides.get(product.id) ?? null, {
    isFavorite: favoriteIds.has(product.id),
    hasOffer: data.offerIds.has(product.id),
    timesOrdered: frequency.get(product.id) ?? 0,
    packTiers: data.packTiers,
    availability: data.availability.get(product.id),
  }));
}

export async function priceCatalogProducts(
  supabase: ReturnType<typeof createClient>, products: CatalogProductRow[], retailerId: string, areaId: string | null,
  favoriteIds: Set<string> = new Set(), frequency: Map<string, number> = new Map()
): Promise<PricedCatalogCard[]> {
  return priceCatalogRows(products, await loadCatalogPricing(supabase, products, retailerId, areaId), favoriteIds, frequency);
}

export async function loadProductsByIds(supabase: ReturnType<typeof createClient>, productIds: string[]): Promise<CatalogProductRow[]> {
  const unique = [...new Set(productIds.filter(Boolean))];
  const products: CatalogProductRow[] = [];
  for (let i = 0; i < unique.length; i += 80) {
    const { data, error } = await supabase.from('products').select(PRODUCT_CARD_SELECT)
      .in('id', unique.slice(i, i + 80)).eq('is_active', true).returns<CatalogProductRow[]>();
    if (error) throw new Error('Products could not be loaded. Please try again.');
    products.push(...data ?? []);
  }
  const byId = new Map(products.map((product) => [product.id, product]));
  return unique.map((id) => byId.get(id)).filter((product): product is CatalogProductRow => !!product);
}

export function discountForCard(card: Pick<PricedCatalogCard, 'mrp' | 'fromPrice'>): number {
  return calcDiscountPercent(card.mrp, card.fromPrice);
}

export async function loadFavoriteIds(supabase: ReturnType<typeof createClient>, retailerId: string): Promise<Set<string>> {
  const { data } = await supabase.from('retailer_favorites').select('product_id').eq('retailer_id', retailerId).returns<{ product_id: string }[]>();
  return new Set((data ?? []).map((row) => row.product_id));
}
