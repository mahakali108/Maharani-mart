import 'server-only';

import type { createClient } from '@/lib/supabase/server';
import {
  getActiveOfferProductIds,
  getProductPriceOverrides,
  resolvePackPrice,
} from '@/lib/retailer/effective-price';
import { calcDiscountPercent } from '@/lib/retailer/format';
import type { ProductCardProps } from '@/components/retailer/product-card';

export const PRODUCT_CARD_SELECT =
  'id, name, sku_code, category_id, brand_id, gst_percent, is_new_launch, created_at, brands ( id, name ), product_images ( image_url, sort_order ), product_packs ( id, pack_name, ptr, base_price, mrp, moq, is_active, sort_order )';

export interface CatalogProductRow {
  id: string;
  name: string;
  sku_code: string;
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
    mrp: number | null;
    moq: number;
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
  const priced = activePacks.map((pack) => ({
    pack,
    price: resolvePackPrice(pack, override),
  }));
  return priced.sort((a, b) => a.price - b.price)[0] ?? null;
}

export function toPricedCard(
  product: CatalogProductRow,
  override: number | null,
  extras: { isFavorite?: boolean; hasOffer?: boolean; timesOrdered?: number } = {}
): PricedCatalogCard {
  const best = bestPricedPack(product, override);
  const images = [...product.product_images].sort((a, b) => a.sort_order - b.sort_order);
  return {
    id: product.id,
    name: product.name,
    skuCode: product.sku_code,
    brandName: product.brands?.name,
    imageUrl: images[0]?.image_url,
    isNewLaunch: product.is_new_launch,
    fromPrice: best?.price ?? null,
    mrp: best?.pack.mrp,
    packName: best?.pack.pack_name,
    moq: best?.pack.moq ?? 1,
    defaultPackId: best?.pack.id ?? null,
    gstPercent: product.gst_percent,
    isFavorite: extras.isFavorite ?? false,
    hasOffer: extras.hasOffer ?? false,
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
  const [overrides, offerIds] = await Promise.all([
    getProductPriceOverrides(supabase, ids, retailerId, areaId),
    getActiveOfferProductIds(supabase, ids),
  ]);

  return products.map((product) =>
    toPricedCard(product, overrides.get(product.id) ?? null, {
      isFavorite: favoriteIds.has(product.id),
      hasOffer: offerIds.has(product.id),
      timesOrdered: frequency.get(product.id) ?? 0,
    })
  );
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
