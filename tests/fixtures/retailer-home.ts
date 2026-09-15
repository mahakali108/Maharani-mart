/** Isolated test fixtures. Never imported by application routes/loaders. */
import type { CatalogProductRow, CatalogPricingData } from '@/lib/retailer/catalog';
import type { PricingTier } from '@/lib/retailer/case-pricing';
import type { RetailerHomeData } from '@/lib/retailer/home-data';

export const RETAILER = '11111111-1111-4111-8111-111111111111';
export const AREA = '22222222-2222-4222-8222-222222222222';
export const PRODUCT = '33333333-3333-4333-8333-333333333333';
export const PACK = '44444444-4444-4444-8444-444444444444';
export const ORDER = '55555555-5555-4555-8555-555555555555';
export const CATEGORY = '66666666-6666-4666-8666-666666666666';
export const BRAND = '77777777-7777-4777-8777-777777777777';

export const tiers: PricingTier[] = [
  { min_quantity: 1, max_quantity: 7, price_per_piece: 30, rule_type: 'loose', is_active: true },
  { min_quantity: 7, max_quantity: 21, price_per_piece: 28, rule_type: 'loose', is_active: true },
  { min_quantity: 21, max_quantity: 80, price_per_piece: 26, rule_type: 'loose', is_active: true },
];
export const product: CatalogProductRow = {
  id: PRODUCT, name: 'Fixture grocery item', category_id: CATEGORY, brand_id: BRAND,
  gst_percent: 5, is_new_launch: false, created_at: '2026-01-01T00:00:00Z',
  brands: { id: BRAND, name: 'Fixture brand' }, product_images: [],
  product_packs: [{
    id: PACK, pack_name: '100 g', ptr: null, base_price: 1000, case_price: 1000,
    units_per_case: 80, mrp: 40, moq: 6, image_url: null, is_active: true, sort_order: 0,
  }],
};
export function pricingData(): CatalogPricingData {
  return { overrides: new Map(), offerIds: new Set(), packTiers: new Map([[PACK, tiers]]), availability: new Map([[PRODUCT, 'in_stock']]) };
}
export function emptyHome(): RetailerHomeData {
  return {
    banners: [], categories: [], brands: [], products: [], frequent: [], reorders: [],
    cart: { itemCount: 0, totalQuantity: 0, subtotal: 0, savings: 0, needsReview: false, unavailable: false },
    errors: { catalog: false, categories: false, brands: false, banners: false, history: false, pricing: false },
  };
}
