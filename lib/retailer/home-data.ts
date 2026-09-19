import 'server-only';

import type { createClient } from '@/lib/supabase/server';
import type { PromoBannerData } from '@/components/retailer/promo-carousel';
import type { CategoryCardData } from '@/components/retailer/category-card';
import type { BrandCardData } from '@/components/retailer/brand-card';
import { groupOrderLines, type OrderItemQuantityRow } from '@/lib/orders/item-display';
import { isBannerVisible, resolveBannerTarget, type ScheduledBanner } from '@/lib/retailer/banner-target';
import {
  loadCatalogPricing, loadFavoriteIds, loadProductsByIds, priceCatalogPack, priceCatalogRows,
  PRODUCT_CARD_SELECT, toPricedCard, type CatalogProductRow, type CatalogPricingData, type PricedCatalogCard,
} from '@/lib/retailer/catalog';
import { fromPaise, toPaise } from '@/lib/retailer/case-pricing';
import { calcSavings } from '@/lib/retailer/format';
import type { AvailabilityState } from '@/lib/retailer/availability';

interface BannerRow extends PromoBannerData, ScheduledBanner {}
export interface HomeCategoryRow extends CategoryCardData {
  parent_id: string | null;
  products: { count: number }[] | null;
}
interface BrandRow extends BrandCardData { products: { count: number }[] | null }
export interface HomeOrderItem extends OrderItemQuantityRow {
  id: string;
  product_id: string;
  pack_id: string | null;
}
export interface HomeOrder {
  id: string;
  placed_at: string;
  status: string;
  order_items: HomeOrderItem[];
}
export interface HomeCartLine { id: string; product_id: string; pack_id: string; quantity: number }
export interface HomeCartSummary {
  itemCount: number | null;
  totalQuantity: number | null;
  /** Current item total, GST included; not a checkout quote. */
  subtotal: number | null;
  savings: number | null;
  needsReview: boolean;
  unavailable: boolean;
}
export interface HomeReorderItem {
  orderId: string;
  productId: string;
  packId: string | null;
  name: string | null;
  packName: string | null;
  imageUrl: string | null;
  detailsHref: string | null;
  previousQuantity: number;
  quantity: number;
  moq: number | null;
  unitPrice: number | null;
  availability: AvailabilityState;
  canReorder: boolean;
}
/** Live scheme row — the same active/in-window rows the retailer Schemes page lists. */
export interface HomeSchemeRow {
  id: string;
  name: string;
  description: string | null;
  is_festival: boolean;
  starts_at: string;
  ends_at: string;
}
export interface RetailerHomeData {
  banners: PromoBannerData[];
  categories: CategoryCardData[];
  brands: BrandCardData[];
  products: PricedCatalogCard[];
  frequent: PricedCatalogCard[];
  reorders: HomeReorderItem[];
  schemes: HomeSchemeRow[];
  cart: HomeCartSummary;
  errors: { catalog: boolean; categories: boolean; brands: boolean; banners: boolean; history: boolean; pricing: boolean; schemes: boolean };
}

/** Same scope as the catalog filter: parent + its active immediate children.
 * A missing aggregate is unknown, not an invented zero. */
export function homeCategories(rows: HomeCategoryRow[]): CategoryCardData[] {
  const parents = rows.filter((row) => !row.parent_id);
  return (parents.length ? parents : rows).slice(0, 10).map((row) => {
    const scope = rows.filter((candidate) => candidate.id === row.id || candidate.parent_id === row.id);
    const known = scope.every((candidate) => candidate.products?.[0]?.count != null);
    return {
      id: row.id, name: row.name, image_url: row.image_url,
      productCount: known ? scope.reduce((sum, candidate) => sum + candidate.products![0]!.count, 0) : undefined,
    };
  });
}

/** One owner-scoped history read powers both frequency and exact-pack reorders.
 * Historical case/piece rows are folded by the established snapshot helper. */
export function homeHistory(orders: HomeOrder[]) {
  const frequency = new Map<string, number>();
  const recent = new Map<string, { orderId: string; productId: string; packId: string | null; previousQuantity: number }>();
  for (const order of [...orders].sort((a, b) => Date.parse(b.placed_at) - Date.parse(a.placed_at))) {
    if (order.status === 'cancelled') continue;
    for (const id of new Set(order.order_items.map((item) => item.product_id))) frequency.set(id, (frequency.get(id) ?? 0) + 1);
    if (!['confirmed', 'processing', 'packed', 'dispatched', 'delivered'].includes(order.status)) continue;
    for (const line of groupOrderLines(order.order_items)) {
      const key = line.first.pack_id ?? line.first.product_id;
      if (!recent.has(key)) recent.set(key, {
        orderId: order.id, productId: line.first.product_id, packId: line.first.pack_id,
        previousQuantity: line.quantity.pieces,
      });
    }
  }
  return { frequency, recent: [...recent.values()].slice(0, 8) };
}

export function homeCartSummary(
  lines: HomeCartLine[], products: CatalogProductRow[], pricingData: CatalogPricingData | null,
  count: number | null = lines.length, readFailed = false
): HomeCartSummary {
  if (readFailed || count === null || count !== lines.length) {
    return { itemCount: count, totalQuantity: null, subtotal: null, savings: null, needsReview: true, unavailable: true };
  }
  const byId = new Map(products.map((product) => [product.id, product]));
  let subtotalPaise = 0;
  let savingsPaise = 0;
  let allPriced = true;
  let savingsKnown = true;
  let needsReview = false;
  for (const line of lines) {
    const product = byId.get(line.product_id);
    const pack = product?.product_packs.find((candidate) => candidate.id === line.pack_id && candidate.is_active);
    if (!product || !pack || !pricingData) { allPriced = false; needsReview = true; continue; }
    const pricing = priceCatalogPack(pack, product, pricingData, line.quantity);
    if (!Number.isFinite(pricing.unitPrice) || pricing.unitPrice <= 0) { allPriced = false; needsReview = true; continue; }
    subtotalPaise += toPaise(pricing.lineTotal);
    if (pack.mrp == null || pack.mrp <= 0) savingsKnown = false;
    else savingsPaise += toPaise(calcSavings(pack.mrp, pricing.unitPrice, line.quantity));
    needsReview ||= !pricing.orderable || pricingData.availability.get(product.id) === 'out_of_stock';
  }
  return {
    itemCount: count,
    totalQuantity: lines.reduce((sum, line) => sum + line.quantity, 0),
    subtotal: allPriced ? fromPaise(subtotalPaise) : null,
    savings: allPriced && savingsKnown ? fromPaise(savingsPaise) : null,
    needsReview,
    unavailable: !allPriced,
  };
}

export async function loadRetailerHome(
  supabase: ReturnType<typeof createClient>, retailerId: string, areaId: string | null,
  siteUrl?: string, canResolvePrices = true
): Promise<RetailerHomeData> {
  const now = new Date();
  const nowIso = now.toISOString();
  // `*` is intentional for this small public-content table: existing banners
  // keep rendering before the optional subtitle/CTA migration is applied.
  let bannerQuery = supabase.from('banners').select('*').eq('is_active', true)
    .or(`starts_at.is.null,starts_at.lte.${nowIso}`).or(`ends_at.is.null,ends_at.gte.${nowIso}`);
  bannerQuery = areaId ? bannerQuery.or(`area_id.is.null,area_id.eq.${areaId}`) : bannerQuery.is('area_id', null);

  const [bannerResult, categoryResult, brandResult, productResult, schemeResult, historyResult, cartResult, favoriteIds] = await Promise.all([
    bannerQuery.order('sort_order').limit(12).returns<BannerRow[]>(),
    supabase.from('categories').select('id, name, image_url, parent_id, products(count)')
      .eq('is_active', true).eq('products.is_active', true).order('sort_order').returns<HomeCategoryRow[]>(),
    supabase.from('brands').select('id, name, logo_url, products(count)')
      .eq('is_active', true).eq('products.is_active', true).order('name').returns<BrandRow[]>(),
    supabase.from('products').select(PRODUCT_CARD_SELECT).eq('is_active', true)
      .order('created_at', { ascending: false }).order('id').limit(80).returns<CatalogProductRow[]>(),
    // Same active/in-window rules as the retailer Schemes page — real rows only.
    supabase.from('schemes').select('id, name, description, is_festival, starts_at, ends_at')
      .eq('is_active', true).lte('starts_at', nowIso).gte('ends_at', nowIso).order('ends_at').limit(6).returns<HomeSchemeRow[]>(),
    supabase.from('orders').select('id, placed_at, status, order_items ( id, product_id, pack_id, quantity, quantity_unit, quantity_pieces, units_per_case )')
      .eq('retailer_id', retailerId).neq('status', 'cancelled').order('placed_at', { ascending: false }).limit(40).returns<HomeOrder[]>(),
    // Header's cheap HEAD count is separate; this bounded detail read is needed
    // for quantity/totals. A larger cart is explicitly unavailable, not partial.
    supabase.from('cart_items').select('id, product_id, pack_id, quantity', { count: 'exact' })
      .eq('retailer_id', retailerId).order('id').limit(250).returns<HomeCartLine[]>(),
    loadFavoriteIds(supabase, retailerId),
  ]);

  const errors = {
    catalog: !!productResult.error, categories: !!categoryResult.error, brands: !!brandResult.error,
    banners: !!bannerResult.error, history: !!historyResult.error, pricing: false, schemes: !!schemeResult.error,
  };
  const discoveryRows = productResult.error ? [] : productResult.data ?? [];
  const history = homeHistory(historyResult.error ? [] : historyResult.data ?? []);
  const cartLines = cartResult.error ? [] : cartResult.data ?? [];
  const frequentIds = [...history.frequency.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id]) => id);
  const loadedIds = new Set(discoveryRows.map((row) => row.id));
  const neededIds = [...new Set([...history.recent.map((item) => item.productId), ...frequentIds, ...cartLines.map((item) => item.product_id)])]
    .filter((id) => !loadedIds.has(id));
  let extraRows: CatalogProductRow[] = [];
  try { extraRows = await loadProductsByIds(supabase, neededIds); }
  catch { errors.catalog = true; }
  const products = [...discoveryRows, ...extraRows];
  let pricingData: CatalogPricingData | null = null;
  try {
    if (!canResolvePrices) throw new Error('Retailer profile is unavailable.');
    pricingData = await loadCatalogPricing(supabase, products, retailerId, areaId);
  }
  catch { errors.pricing = true; }

  const cards = pricingData ? priceCatalogRows(products, pricingData, favoriteIds, history.frequency)
    : products.map((product) => toPricedCard(product, null, { pricingUnavailable: true, isFavorite: favoriteIds.has(product.id) }));
  const cardById = new Map(cards.map((card) => [card.id, card]));
  const productById = new Map(products.map((product) => [product.id, product]));
  const reorders: HomeReorderItem[] = history.recent.map((line) => {
    const product = productById.get(line.productId);
    const pack = product?.product_packs.find((candidate) => candidate.id === line.packId && candidate.is_active);
    const quantity = Math.max(line.previousQuantity, pack?.moq ?? line.previousQuantity);
    const pricing = product && pack && pricingData ? priceCatalogPack(pack, product, pricingData, quantity) : null;
    const availability = pricingData?.availability.get(line.productId) ?? 'unknown';
    const hasPrice = !!pricing?.orderable && Number.isFinite(pricing.unitPrice) && pricing.unitPrice > 0;
    return {
      ...line, quantity, name: product?.name ?? null, packName: pack?.pack_name ?? null,
      // An inactive historic pack is no longer a valid PDP route. Its active
      // parent remains browseable; a missing product has no details link.
      detailsHref: product ? `/retailer/catalog/${pack?.id ?? product.id}` : null,
      imageUrl: pack?.image_url || [...product?.product_images ?? []].sort((a, b) => a.sort_order - b.sort_order)[0]?.image_url || null,
      moq: pack?.moq ?? null,
      unitPrice: hasPrice ? pricing!.unitPrice : null,
      availability,
      canReorder: hasPrice && availability !== 'out_of_stock',
    };
  });
  return {
    banners: (bannerResult.error ? [] : bannerResult.data ?? [])
      .filter((banner) => isBannerVisible(banner, areaId, now.getTime()))
      .map((banner) => ({ id: banner.id, title: banner.title, subtitle: banner.subtitle,
        image_url: banner.image_url, cta_label: banner.cta_label,
        link_url: resolveBannerTarget(banner.link_url, siteUrl)?.href ?? null })),
    categories: homeCategories(categoryResult.error ? [] : categoryResult.data ?? []),
    brands: (brandResult.error ? [] : brandResult.data ?? []).map((brand) => ({
      id: brand.id, name: brand.name, logo_url: brand.logo_url, productCount: brand.products?.[0]?.count,
    })),
    products: discoveryRows.map((row) => cardById.get(row.id)!),
    frequent: frequentIds.map((id) => cardById.get(id)).filter((card): card is PricedCatalogCard => !!card),
    reorders,
    schemes: (schemeResult.error ? [] : schemeResult.data ?? []).map((scheme) => ({
      id: scheme.id, name: scheme.name, description: scheme.description,
      is_festival: scheme.is_festival, starts_at: scheme.starts_at, ends_at: scheme.ends_at,
    })),
    cart: homeCartSummary(cartLines, products, pricingData, cartResult.count, !!cartResult.error),
    errors,
  };
}
