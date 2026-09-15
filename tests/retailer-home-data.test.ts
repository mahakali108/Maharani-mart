import { describe, expect, it } from 'vitest';
import { bestSlabOffer, loadCatalogAvailability, priceCatalogRows, toPricedCard } from '@/lib/retailer/catalog';
import { homeCartSummary, homeCategories, homeHistory, loadRetailerHome, type HomeOrder } from '@/lib/retailer/home-data';
import { isBannerVisible, resolveBannerTarget } from '@/lib/retailer/banner-target';
import { homeServices } from '@/lib/retailer/home-services';
import { calculateRetailerPiecePrice } from '@/lib/retailer/retailer-pricing';
import { product, pricingData, tiers, RETAILER, AREA, PRODUCT, PACK, ORDER, CATEGORY, BRAND } from './fixtures/retailer-home';
import { supabaseFixture } from './helpers/supabase-fixture';

const line = { id: 'cart-line', product_id: PRODUCT, pack_id: PACK, quantity: 12 };
const order: HomeOrder = {
  id: ORDER, placed_at: '2026-01-10T12:00:00Z', status: 'delivered',
  order_items: [{ id: 'item', product_id: PRODUCT, pack_id: PACK, quantity: 12, quantity_unit: 'pieces', quantity_pieces: 12, units_per_case: 80 }],
};
function tables() {
  return {
    products: [{ ...product, is_active: true }],
    product_pricing_tiers: tiers.map((tier) => ({ ...tier, product_pack_id: PACK })),
    orders: [{ ...order, retailer_id: RETAILER }],
    cart_items: [{ ...line, retailer_id: RETAILER }],
    categories: [{ id: CATEGORY, name: 'Fixture category', image_url: null, parent_id: null, is_active: true, products: [{ count: 1 }] }],
    brands: [{ id: BRAND, name: 'Fixture brand', logo_url: null, is_active: true, products: [{ count: 1 }] }],
    banners: [{ id: 'banner', title: 'Configured promotion', image_url: '/test.png', link_url: '/retailer/catalog', is_active: true, area_id: AREA, starts_at: null, ends_at: null }],
    retailer_favorites: [{ retailer_id: RETAILER, product_id: PRODUCT }],
  };
}

describe('home pricing is the canonical GST-inclusive piece engine', () => {
  it('uses the MOQ slab instead of the internal case-derived reference', () => {
    const pricing = pricingData();
    pricing.packTiers.set(PACK, [...tiers, { min_quantity: 80, max_quantity: null, price_per_piece: 12.5, rule_type: 'case' }]);
    const card = priceCatalogRows([product], pricing)[0]!;
    expect(card.fromPrice).toBe(30);
    expect(card.fromPrice).not.toBe(1000 / 80);
    expect(card.moq).toBe(6);
    expect(card.bestSlab).toEqual({ minQuantity: 21, maxQuantity: null, pricePerPiece: 26 });
    expect(card.piecePricing).not.toHaveProperty('casePrice');
    expect(card.piecePricing?.tiers.some((tier) => tier.rule_type === 'case')).toBe(false);
    expect(card).not.toHaveProperty('available_quantity');
    const at12 = calculateRetailerPiecePrice({ quantity: 12, casePrice: 0, ...card.piecePricing!, gstPercent: 5, moq: 6 });
    expect(at12.unitPrice).toBe(28);
    expect(at12.lineTotal).toBe(336);
    expect(at12.subtotal + at12.gst).toBe(336);
  });

  it('keeps the chosen price, MRP, MOQ and image tied to the same active variant', () => {
    const alternate = { ...product.product_packs[0]!, id: 'alternate', case_price: 800, moq: 2, mrp: 15, image_url: '/variant.png' };
    const card = toPricedCard({ ...product, product_packs: [...product.product_packs, alternate] }, null, { packTiers: pricingData().packTiers });
    expect(card).toMatchObject({ defaultPackId: 'alternate', fromPrice: 10, mrp: 15, moq: 2, imageUrl: '/variant.png' });
    const inactive = toPricedCard({ ...product, product_packs: [{ ...alternate, is_active: false }] }, null);
    expect(inactive.fromPrice).toBeNull();
    expect(inactive.defaultPackId).toBeNull();
  });

  it('never advertises a zero-price variant as the cheapest buyable product', () => {
    const noPrice = { ...product.product_packs[0]!, id: 'unpriced', case_price: 0 };
    const card = toPricedCard({ ...product, product_packs: [noPrice, ...product.product_packs] }, null);
    expect(card.defaultPackId).toBe(PACK);
    expect(toPricedCard({ ...product, product_packs: [noPrice] }, null).fromPrice).toBeNull();
  });

  it('uses a scoped override only as the canonical no-tier fallback', () => {
    expect(toPricedCard(product, 1600).fromPrice).toBe(20);
    expect(toPricedCard(product, 1600, { packTiers: pricingData().packTiers }).fromPrice).toBe(30);
  });

  it('does not advertise a below-MOQ slab or invent quantity savings', () => {
    expect(bestSlabOffer(tiers, 80, 30, 26)).toBeNull();
    expect(bestSlabOffer([], 80, 6, 30)).toBeNull();
    expect(bestSlabOffer(tiers.map((tier) => ({ ...tier, price_per_piece: 30 })), 80, 6, 30)).toBeNull();
  });

  it('retains a bounded best-slab range and exact paise for non-monotonic rates', () => {
    const nonMonotonic = [tiers[0]!, { ...tiers[1]!, price_per_piece: 25.35 }, tiers[2]!];
    expect(bestSlabOffer(nonMonotonic, 80, 6, 30)).toEqual({ minQuantity: 7, maxQuantity: 21, pricePerPiece: 25.35 });
  });

  it('a failed pricing read cannot fall back to an invented lower rate', () => {
    const card = toPricedCard(product, null, { pricingUnavailable: true });
    expect(card.fromPrice).toBeNull();
    expect(card.piecePricing).toBeUndefined();
    expect(card.bestSlab).toBeNull();
    expect(card.nextTierHint).toBeNull();
  });
});

describe('home cart summary', () => {
  it('agrees with checkout quantity pricing, inclusive GST and savings', () => {
    expect(homeCartSummary([line], [product], pricingData())).toEqual({
      itemCount: 1, totalQuantity: 12, subtotal: 336, savings: 144, needsReview: false, unavailable: false,
    });
  });
  it('has a real empty state without any prices or products', () => {
    expect(homeCartSummary([], [], null)).toMatchObject({ itemCount: 0, totalQuantity: 0, subtotal: 0, savings: 0, unavailable: false });
  });
  it('does not silently omit unavailable or unpriced items from the full subtotal', () => {
    expect(homeCartSummary([line], [], pricingData())).toMatchObject({ itemCount: 1, totalQuantity: 12, subtotal: null, savings: null, needsReview: true });
    expect(homeCartSummary([line], [product], null).subtotal).toBeNull();
  });
  it('distinguishes unknown MRP savings from a confirmed zero saving', () => {
    const noMrp = { ...product, product_packs: [{ ...product.product_packs[0]!, mrp: null }] };
    expect(homeCartSummary([line], [noMrp], pricingData())).toMatchObject({ subtotal: 336, savings: null });
    const lowMrp = { ...product, product_packs: [{ ...product.product_packs[0]!, mrp: 20 }] };
    expect(homeCartSummary([line], [lowMrp], pricingData()).savings).toBe(0);
  });
  it('flags changed MOQ and stock without claiming stock was reserved', () => {
    const changed = { ...product, product_packs: [{ ...product.product_packs[0]!, moq: 20 }] };
    expect(homeCartSummary([line], [changed], pricingData()).needsReview).toBe(true);
    const data = pricingData(); data.availability.set(PRODUCT, 'out_of_stock');
    expect(homeCartSummary([line], [product], data).needsReview).toBe(true);
  });
  it('never presents a bounded read or query failure as a complete/empty cart', () => {
    expect(homeCartSummary([line], [product], pricingData(), 251)).toMatchObject({ itemCount: 251, totalQuantity: null, subtotal: null, unavailable: true });
    expect(homeCartSummary([], [], null, null, true)).toMatchObject({ itemCount: null, subtotal: null, unavailable: true });
  });
});

describe('reorder history and category counts', () => {
  it('uses the latest order per exact pack and folds historical case/piece snapshots', () => {
    const mixed: HomeOrder = { ...order, id: 'latest', placed_at: '2026-02-01T00:00:00Z', order_items: [
      { ...order.order_items[0]!, quantity: 1, quantity_unit: 'cases', quantity_pieces: 40, units_per_case: 40 },
      { ...order.order_items[0]!, id: 'loose', quantity: 6, quantity_unit: 'pieces', quantity_pieces: 6, units_per_case: 40 },
    ] };
    const history = homeHistory([order, mixed]);
    expect(history.recent).toEqual([{ orderId: 'latest', productId: PRODUCT, packId: PACK, previousQuantity: 46 }]);
    expect(history.frequency.get(PRODUCT)).toBe(2);
  });
  it('does not reorder cancelled or unconfirmed products', () => {
    expect(homeHistory([{ ...order, status: 'cancelled' }, { ...order, status: 'pending' }]).recent).toEqual([]);
    expect(homeHistory([]).frequency.size).toBe(0);
  });
  it('uses the persisted case size for legacy rows, not today’s pack size', () => {
    const legacy = { ...order, order_items: [{ ...order.order_items[0]!, quantity: 2, quantity_unit: null, quantity_pieces: null, units_per_case: 24 }] };
    expect(homeHistory([legacy]).recent[0]?.previousQuantity).toBe(48);
  });
  it('matches category filter scope and omits unknown counts', () => {
    const root = { id: 'root', name: 'Root', image_url: null, parent_id: null, products: [{ count: 2 }] };
    const child = { ...root, id: 'child', parent_id: 'root', products: [{ count: 3 }] };
    expect(homeCategories([root, child])[0]?.productCount).toBe(5);
    expect(homeCategories([root, { ...child, products: null }])[0]?.productCount).toBeUndefined();
  });
});

describe('live banners and configured services only', () => {
  const banner = { is_active: true, area_id: AREA, starts_at: null, ends_at: null };
  const now = Date.parse('2026-01-01T12:00:00Z');
  it('enforces active, area, start and end, with timezone-aware date comparisons', () => {
    expect(isBannerVisible(banner, AREA, now)).toBe(true);
    expect(isBannerVisible(banner, null, now)).toBe(false);
    expect(isBannerVisible({ ...banner, area_id: null }, null, now)).toBe(true);
    expect(isBannerVisible({ ...banner, is_active: false }, AREA, now)).toBe(false);
    expect(isBannerVisible({ ...banner, starts_at: '2026-01-01T18:00:00+05:30' }, AREA, now)).toBe(false);
    expect(isBannerVisible({ ...banner, ends_at: '2026-01-01T17:00:00+05:30' }, AREA, now)).toBe(false);
    expect(isBannerVisible({ ...banner, starts_at: 'invalid' }, AREA, now)).toBe(false);
  });
  it.each(['javascript:alert(1)', 'data:text/html,hi', '//evil.test', '/\\evil.test', 'https://user:password@example.com', 'not a route'])('rejects unsafe target %s', (value) => {
    expect(resolveBannerTarget(value)).toBeNull();
  });
  it('keeps internal CTA navigation same-tab and preserves external links', () => {
    expect(resolveBannerTarget('/retailer/catalog?category=abc')).toEqual({ href: '/retailer/catalog?category=abc', external: false });
    expect(resolveBannerTarget('https://shop.test/retailer/catalog?q=tea', 'https://shop.test')).toEqual({ href: '/retailer/catalog?q=tea', external: false });
    expect(resolveBannerTarget('https://merchant.test/offers')).toEqual({ href: 'https://merchant.test/offers', external: true });
  });
  it('does not invent a warehouse, delivery SLA, GSTIN or phone', () => {
    const services = homeServices({ hasWholesalePrices: false });
    expect(services.map((item) => item.id)).toEqual(['moq', 'support']);
    expect(services.find((item) => item.id === 'support')?.href).toBe('/retailer/help');
    const configured = homeServices({ hasWholesalePrices: true, dispatch: 'Configured dispatch note', deliveryEstimate: 'Configured delivery note', gstin: 'TEST-GSTIN', supportPhone: 'TEST-PHONE' });
    expect(configured).toHaveLength(6);
    expect(configured[1]?.detail).toBe('Configured delivery note');
  });
});

describe('home Supabase query contracts (mocked, not live RLS)', () => {
  it('batches the shared product, history, tier and availability reads', async () => {
    const db = supabaseFixture(tables(), {}, [{ product_id: PRODUCT, stock_status: 'in_stock', available_quantity: 100 }]);
    const home = await loadRetailerHome(db as never, RETAILER, AREA);
    expect(home.products[0]).toMatchObject({ fromPrice: 30, availability: 'in_stock', isFavorite: true });
    expect(home.reorders[0]).toMatchObject({ packId: PACK, previousQuantity: 12, quantity: 12, unitPrice: 28, canReorder: true });
    expect(home.cart.subtotal).toBe(336);
    for (const table of ['products', 'orders', 'cart_items', 'product_pricing_tiers']) expect(db.queries.filter((query) => query.table === table)).toHaveLength(1);
    expect(db.rpcs).toHaveLength(1);
    for (const table of ['orders', 'cart_items', 'retailer_favorites']) {
      expect(db.queries.find((query) => query.table === table)?.filters).toContainEqual({ op: 'eq', column: 'retailer_id', value: RETAILER });
    }
    for (const table of ['brands', 'categories']) {
      expect(db.queries.find((query) => query.table === table)?.filters).toContainEqual({ op: 'eq', column: 'products.is_active', value: true });
    }
    expect(home.banners[0]?.link_url).toBe('/retailer/catalog');
  });
  it('keeps an inactive historic pack unavailable and links to its active parent instead of a 404', async () => {
    const rows = tables();
    rows.products[0] = { ...product, is_active: true, product_packs: [{ ...product.product_packs[0]!, is_active: false }] };
    const home = await loadRetailerHome(supabaseFixture(rows) as never, RETAILER, AREA);
    expect(home.reorders[0]).toMatchObject({ packId: PACK, canReorder: false, unitPrice: null, detailsHref: `/retailer/catalog/${PRODUCT}` });
  });
  it('returns honest empty states and skips pricing/availability when there are no products', async () => {
    const db = supabaseFixture();
    const home = await loadRetailerHome(db as never, RETAILER, null);
    expect(home.products).toEqual([]); expect(home.banners).toEqual([]); expect(home.brands).toEqual([]); expect(home.reorders).toEqual([]);
    expect(home.cart.itemCount).toBe(0); expect(home.cart.unavailable).toBe(false);
    expect(db.rpcs).toHaveLength(0);
    expect(db.queries.some((query) => query.table === 'product_pricing_tiers')).toBe(false);
  });
  it('distinguishes database errors from a new retailer’s empty lists', async () => {
    const home = await loadRetailerHome(supabaseFixture(tables(), { categories: 'offline', orders: 'offline', cart_items: 'offline' }) as never, RETAILER, AREA);
    expect(home.errors).toMatchObject({ categories: true, history: true });
    expect(home.cart.unavailable).toBe(true);
    expect(home.cart.itemCount).toBeNull();
  });
  it.each(['price_lists', 'product_pricing_tiers'])('a %s failure blocks prices, deals and reorder instead of inventing fallback money', async (table) => {
    const home = await loadRetailerHome(supabaseFixture(tables(), { [table]: 'offline' }) as never, RETAILER, AREA);
    expect(home.errors.pricing).toBe(true);
    expect(home.products[0]?.fromPrice).toBeNull();
    expect(home.products[0]?.bestSlab).toBeNull();
    expect(home.reorders[0]?.canReorder).toBe(false);
    expect(home.cart.subtotal).toBeNull();
  });
  it('does not guess area pricing after a profile read failure', async () => {
    const home = await loadRetailerHome(supabaseFixture(tables()) as never, RETAILER, null, undefined, false);
    expect(home.errors.pricing).toBe(true);
    expect(home.products[0]?.fromPrice).toBeNull();
  });
  it('failed or omitted stock results stay unknown, never green availability', async () => {
    const home = await loadRetailerHome(supabaseFixture(tables(), { rpc: 'unavailable' }) as never, RETAILER, AREA);
    expect(home.products[0]?.availability).toBe('unknown');
  });
  it('chunks the sanctioned availability RPC at its 100-product limit', async () => {
    const db = supabaseFixture();
    await loadCatalogAvailability(db as never, Array.from({ length: 205 }, (_, i) => `product-${i}`));
    expect(db.rpcs.map((rpc) => (rpc.args.p_product_ids as string[]).length)).toEqual([100, 100, 5]);
  });
});
