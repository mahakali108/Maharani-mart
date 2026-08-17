import 'server-only';

import type { createClient } from '@/lib/supabase/server';
import {
  loadProductsByIds,
  priceCatalogProducts,
  type CatalogProductRow,
  type PricedCatalogCard,
} from '@/lib/retailer/catalog';

interface OrderItemFreqRow {
  product_id: string;
  quantity: number;
  order_id: string;
}

const OPEN_ORDER_STATUSES = ['pending', 'confirmed', 'processing', 'packed', 'dispatched'];

export { OPEN_ORDER_STATUSES };

export async function getRetailerOrderIds(
  supabase: ReturnType<typeof createClient>,
  retailerId: string,
  limit = 40
): Promise<string[]> {
  const { data } = await supabase
    .from('orders')
    .select('id')
    .eq('retailer_id', retailerId)
    .neq('status', 'cancelled')
    .order('placed_at', { ascending: false })
    .limit(limit)
    .returns<{ id: string }[]>();
  return (data ?? []).map((row) => row.id);
}

export async function getOrderFrequencyMap(
  supabase: ReturnType<typeof createClient>,
  retailerId: string
): Promise<Map<string, number>> {
  const orderIds = await getRetailerOrderIds(supabase, retailerId, 40);
  return frequencyFromOrders(supabase, orderIds);
}

async function frequencyFromOrders(
  supabase: ReturnType<typeof createClient>,
  orderIds: string[]
): Promise<Map<string, number>> {
  const frequency = new Map<string, number>();
  if (orderIds.length === 0) return frequency;

  const { data } = await supabase
    .from('order_items')
    .select('product_id, quantity, order_id')
    .in('order_id', orderIds)
    .limit(800)
    .returns<OrderItemFreqRow[]>();

  for (const row of data ?? []) {
    frequency.set(row.product_id, (frequency.get(row.product_id) ?? 0) + 1);
  }
  return frequency;
}

export async function getFrequentlyOrderedCards(
  supabase: ReturnType<typeof createClient>,
  retailerId: string,
  areaId: string | null,
  favoriteIds: Set<string>,
  limit = 8
): Promise<PricedCatalogCard[]> {
  const frequency = await getOrderFrequencyMap(supabase, retailerId);
  const ranked = [...frequency.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  const products = await loadProductsByIds(
    supabase,
    ranked.map(([productId]) => productId)
  );
  const cards = await priceCatalogProducts(supabase, products, retailerId, areaId, favoriteIds, frequency);
  return cards.slice(0, limit);
}

export async function getBuyAgainCards(
  supabase: ReturnType<typeof createClient>,
  retailerId: string,
  areaId: string | null,
  favoriteIds: Set<string>,
  limit = 8
): Promise<PricedCatalogCard[]> {
  const { data: lastOrder } = await supabase
    .from('orders')
    .select('id')
    .eq('retailer_id', retailerId)
    .in('status', ['delivered', 'dispatched', 'packed', 'processing', 'confirmed'])
    .order('placed_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (!lastOrder) return [];

  const { data: items } = await supabase
    .from('order_items')
    .select('product_id')
    .eq('order_id', lastOrder.id)
    .returns<{ product_id: string }[]>();

  const productIds = [...new Set((items ?? []).map((item) => item.product_id))];
  const products = await loadProductsByIds(supabase, productIds);
  const cards = await priceCatalogProducts(supabase, products, retailerId, areaId, favoriteIds);
  return cards.slice(0, limit);
}

export async function getCoPurchasedCards(
  supabase: ReturnType<typeof createClient>,
  retailerId: string,
  areaId: string | null,
  productId: string,
  favoriteIds: Set<string>,
  limit = 6
): Promise<PricedCatalogCard[]> {
  const orderIds = await getRetailerOrderIds(supabase, retailerId, 40);
  if (orderIds.length === 0) return [];

  const { data: seedItems } = await supabase
    .from('order_items')
    .select('order_id')
    .eq('product_id', productId)
    .in('order_id', orderIds)
    .returns<{ order_id: string }[]>();

  const relatedOrderIds = [...new Set((seedItems ?? []).map((row) => row.order_id))];
  if (relatedOrderIds.length === 0) return [];

  const { data: companionItems } = await supabase
    .from('order_items')
    .select('product_id')
    .in('order_id', relatedOrderIds)
    .neq('product_id', productId)
    .returns<{ product_id: string }[]>();

  const counts = new Map<string, number>();
  for (const row of companionItems ?? []) {
    counts.set(row.product_id, (counts.get(row.product_id) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  const products = await loadProductsByIds(
    supabase,
    ranked.map(([id]) => id)
  );
  return priceCatalogProducts(supabase, products, retailerId, areaId, favoriteIds, counts);
}

export async function getSimilarProductCards(
  supabase: ReturnType<typeof createClient>,
  retailerId: string,
  areaId: string | null,
  product: { id: string; category_id: string | null; brand_id: string | null },
  favoriteIds: Set<string>,
  limit = 8
): Promise<PricedCatalogCard[]> {
  if (!product.category_id && !product.brand_id) return [];

  let query = supabase
    .from('products')
    .select(
      'id, name, sku_code, category_id, brand_id, gst_percent, is_new_launch, created_at, brands ( id, name ), product_images ( image_url, sort_order ), product_packs ( id, pack_name, ptr, base_price, mrp, moq, is_active, sort_order )'
    )
    .eq('is_active', true)
    .neq('id', product.id)
    .limit(12);

  if (product.category_id) query = query.eq('category_id', product.category_id);
  else if (product.brand_id) query = query.eq('brand_id', product.brand_id);

  const { data } = await query.returns<CatalogProductRow[]>();
  const cards = await priceCatalogProducts(supabase, data ?? [], retailerId, areaId, favoriteIds);
  return cards.slice(0, limit);
}

export function pickDiscoveryRails(cards: PricedCatalogCard[]) {
  const available = cards.filter((card) => card.defaultPackId && card.fromPrice !== null);
  const deals = [...available]
    .filter((card) => (card.mrp ?? 0) > (card.fromPrice ?? 0) || card.hasOffer)
    .sort((a, b) => {
      const discountA = a.mrp && a.fromPrice !== null ? a.mrp - a.fromPrice : 0;
      const discountB = b.mrp && b.fromPrice !== null ? b.mrp - b.fromPrice : 0;
      const pctA = a.mrp && a.fromPrice !== null && a.mrp > 0 ? discountA / a.mrp : 0;
      const pctB = b.mrp && b.fromPrice !== null && b.mrp > 0 ? discountB / b.mrp : 0;
      return pctB - pctA || discountB - discountA;
    })
    .slice(0, 10);

  const bestPrices = [...available]
    .filter((card) => card.fromPrice !== null)
    .sort((a, b) => (a.fromPrice ?? Number.MAX_SAFE_INTEGER) - (b.fromPrice ?? Number.MAX_SAFE_INTEGER))
    .slice(0, 10);

  const lowMoq = [...available].filter((card) => (card.moq ?? 1) <= 2).slice(0, 10);
  const newArrivals = [...cards]
    .filter((card) => card.isNewLaunch)
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
    .slice(0, 10);

  const newestFallback = [...cards]
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
    .slice(0, 10);

  return {
    deals,
    bestPrices,
    lowMoq,
    newArrivals: newArrivals.length > 0 ? newArrivals : newestFallback,
  };
}
