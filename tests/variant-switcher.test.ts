import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildVariantSwitcher,
  isUuidLike,
  variantGalleryImages,
  variantHref,
  type VariantPackBase,
} from '@/lib/retailer/variants';
import { caseLineBreakdown, pickApplicableTier, type PricingTier } from '@/lib/retailer/case-pricing';
import { resolvePackPrice } from '@/lib/retailer/effective-price';
import { quoteOrderForRetailer, type RequestedQuoteLine } from '@/lib/orders/quote-order';

const root = join(__dirname, '..');

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

// ----------------------------------------------------------------------------
// Real-data-shaped fixture: "Baby Powder" parent product with three pack-size
// variants, exactly as the admin pack manager would create them. Every number
// mirrors the live schema: product_packs.case_price is the GST-INCLUSIVE
// source of truth, tiers are per-pack half-open [min, max) PIECE ranges.
// ----------------------------------------------------------------------------
const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const PACK_50G = '22222222-2222-4222-8222-222222222222';
const PACK_100G = '33333333-3333-4333-8333-333333333333';
const PACK_200G = '44444444-4444-4444-8444-444444444444';

interface BabyPowderPack {
  id: string;
  product_id: string;
  pack_name: string;
  base_price: number;
  ptr: number | null;
  case_price: number;
  units_per_case: number;
  moq: number;
  image_url: string | null;
  is_active: boolean;
  sort_order: number;
  mrp: number | null;
}

const BABY_POWDER_PACKS: BabyPowderPack[] = [
  {
    id: PACK_50G,
    product_id: PRODUCT_ID,
    pack_name: '50g',
    base_price: 40,
    ptr: 40,
    case_price: 1200, // ₹25.00 / pc @ 48 pcs
    units_per_case: 48,
    moq: 1,
    image_url: 'https://cdn.supabase.co/storage/v1/object/public/product-images/products/x/gallery/50g.webp',
    is_active: true,
    sort_order: 0,
    mrp: 40,
  },
  {
    id: PACK_100G,
    product_id: PRODUCT_ID,
    pack_name: '100g',
    base_price: 85,
    ptr: 85,
    case_price: 1440, // ₹60.00 / pc @ 24 pcs
    units_per_case: 24,
    moq: 1,
    image_url: 'https://cdn.supabase.co/storage/v1/object/public/product-images/products/x/gallery/100g.webp',
    is_active: true,
    sort_order: 1,
    mrp: 85,
  },
  {
    id: PACK_200G,
    product_id: PRODUCT_ID,
    pack_name: '200g',
    base_price: 160,
    ptr: 160,
    case_price: 1320, // ₹110.00 / pc @ 12 pcs
    units_per_case: 12,
    moq: 1,
    image_url: null, // no dedicated image -> parent gallery fallback
    is_active: true,
    sort_order: 2,
    mrp: 160,
  },
];

const TIERS_BY_PACK: Record<string, PricingTier[]> = {
  // 50g bulk slab starts at 96 pcs; below that the case price governs.
  [PACK_50G]: [{ id: 't-50', min_quantity: 96, max_quantity: null, price_per_piece: 23, rule_type: 'bulk', is_active: true }],
  // 100g has its OWN slab (from 48 pcs) — must never leak into the 50g pack.
  [PACK_100G]: [{ id: 't-100', min_quantity: 48, max_quantity: null, price_per_piece: 55, rule_type: 'bulk', is_active: true }],
  [PACK_200G]: [],
};

const GST_PERCENT = 5;

const PACK_BASES: VariantPackBase[] = BABY_POWDER_PACKS.map((pack) => ({
  id: pack.id,
  pack_name: pack.pack_name,
  is_active: pack.is_active,
  sort_order: pack.sort_order,
}));

// ----------------------------------------------------------------------------
// Minimal fake Supabase client that satisfies the exact query chains used by
// quoteOrderForRetailer (retailers / product_packs / price_lists /
// product_pricing_tiers). The SERVICE code under test is the real, unchanged
// production module — only the transport is stubbed.
// ----------------------------------------------------------------------------
function makeFakeSupabase(options: {
  retailer: Record<string, unknown> | null;
  packs: Record<string, unknown>[];
  tiersByPack: Record<string, PricingTier[]>;
}) {
  function resolve(table: string): { data: unknown; error: null } {
    switch (table) {
      case 'retailers':
        return { data: options.retailer, error: null };
      case 'product_packs':
        return { data: options.packs, error: null };
      case 'price_lists':
        return { data: [], error: null }; // no overrides -> pack case_price rules
      case 'product_pricing_tiers':
        return {
          data: options.packs.flatMap((pack) =>
            (options.tiersByPack[pack.id as string] ?? []).map((tier) => ({ ...tier, product_pack_id: pack.id }))
          ),
          error: null,
        };
      default:
        return { data: [], error: null };
    }
  }

  function makeBuilder(table: string) {
    const builder: {
      select: () => unknown;
      eq: () => unknown;
      in: () => unknown;
      lte: () => unknown;
      order: () => unknown;
      maybeSingle: () => Promise<{ data: unknown; error: null }>;
      returns: () => Promise<{ data: unknown; error: null }>;
      then: PromiseLike<{ data: unknown; error: null }>['then'];
    } = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      lte: () => builder,
      order: () => builder,
      maybeSingle: () => Promise.resolve(resolve(table)),
      returns: () => Promise.resolve(resolve(table)),
      then: (onFulfilled, onRejected) => Promise.resolve(resolve(table)).then(onFulfilled, onRejected),
    };
    return builder;
  }

  return {
    from: (table: string) => makeBuilder(table),
  };
}

const RETAILER = {
  id: '99999999-9999-4999-8999-999999999999',
  area_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  status: 'active',
  credit_limit: 100000,
  outstanding_balance: 0,
};

describe('product size / variant switcher', () => {
  describe('1&2. 50g -> 100g and 100g -> 200g navigate to each variant route', () => {
    it('builds a pill per existing pack linking to /retailer/catalog/<packId>', () => {
      const model = buildVariantSwitcher(PACK_BASES, PACK_50G);

      expect(model.variants.map((variant) => variant.label)).toEqual(['50g', '100g', '200g']);
      expect(model.variants.map((variant) => variant.href)).toEqual([
        variantHref(PACK_50G),
        variantHref(PACK_100G),
        variantHref(PACK_200G),
      ]);
      expect(model.variants.every((variant) => variant.href.startsWith('/retailer/catalog/'))).toBe(true);
      expect(model.hasSelectableVariants).toBe(true);
    });

    it('marks exactly the URL-selected variant as selected (50g then 100g then 200g)', () => {
      const on50 = buildVariantSwitcher(PACK_BASES, PACK_50G);
      expect(on50.variants.find((variant) => variant.isSelected)?.packId).toBe(PACK_50G);

      const on100 = buildVariantSwitcher(PACK_BASES, PACK_100G);
      expect(on100.variants.filter((variant) => variant.isSelected).map((variant) => variant.packId)).toEqual([PACK_100G]);

      const on200 = buildVariantSwitcher(PACK_BASES, PACK_200G);
      expect(on200.variants.find((variant) => variant.isSelected)?.packId).toBe(PACK_200G);

      // Parent-product URL: nothing preselected, still navigable.
      const onProduct = buildVariantSwitcher(PACK_BASES, null);
      expect(onProduct.variants.some((variant) => variant.isSelected)).toBe(false);
      expect(onProduct.hasSelectableVariants).toBe(true);
    });

    it('renders an unavailable (inactive) variant as non-navigable — never a fake link', () => {
      const model = buildVariantSwitcher(
        PACK_BASES.map((variant) => (variant.id === PACK_200G ? { ...variant, is_active: false } : variant)),
        PACK_50G
      );
      const unavailable200 = model.variants.find((variant) => variant.packId === PACK_200G);
      expect(unavailable200?.isAvailable).toBe(false);
      expect(model.hasSelectableVariants).toBe(true);
    });

    it('the product page navigates via real Links (URL change), not local React state', () => {
      const page = read('app/retailer/catalog/[id]/page.tsx');
      // The switcher is rendered from server data and builds its model from the raw packs.
      expect(page).toContain('<VariantSwitcher');
      expect(page).toContain('buildVariantSwitcher(rawPacks, selectedPack?.id ?? null)');
      // A pack id in the URL pins the selected variant.
      expect(page).toContain('requestedPackId ? rawPacks.find((pack) => pack.id === requestedPackId)');
      // The component uses next/link <Link href>, not onClick state updates.
      const switcher = read('components/retailer/variant-switcher.tsx');
      expect(switcher).toContain("from 'next/link'");
      expect(switcher).toContain('href={variant.href}');
      expect(switcher).not.toContain('useState');
    });

    it('route ids are validated as UUIDs and unknown routes 404', () => {
      expect(isUuidLike(PACK_100G)).toBe(true);
      expect(isUuidLike('../../etc/passwd')).toBe(false);
      expect(isUuidLike('not-a-uuid')).toBe(false);
      const page = read('app/retailer/catalog/[id]/page.tsx');
      expect(page).toContain('if (!isUuidLike(params.id)) notFound();');
      expect(page).toContain('if (requestedPackId && !urlPack) notFound();');
    });
  });

  describe('3. correct variant image', () => {
    it('uses the 100g variant image when switching 50g -> 100g', () => {
      const productImages = [{ id: 'img-1', image_url: 'product.webp' }];
      const pack100 = BABY_POWDER_PACKS.find((pack) => pack.id === PACK_100G)!;
      const images = variantGalleryImages(pack100, productImages);
      expect(images[0]?.image_url).toBe(pack100.image_url);
      expect(images[0]?.image_url).toContain('100g');
      // The parent gallery is kept behind the variant image.
      expect(images.map((image) => image.image_url)).toContain('product.webp');
    });

    it('falls back to the product gallery when a variant has no dedicated image', () => {
      const productImages = [
        { id: 'img-1', image_url: 'first.webp' },
        { id: 'img-2', image_url: 'second.webp' },
      ];
      const pack200 = BABY_POWDER_PACKS.find((pack) => pack.id === PACK_200G)!;
      expect(variantGalleryImages(pack200, productImages).map((image) => image.image_url)).toEqual([
        'first.webp',
        'second.webp',
      ]);
      // No images at all -> empty list -> the gallery's existing placeholder renders.
      expect(variantGalleryImages(pack200, [])).toEqual([]);
    });

    it('the page feeds the SELECTED pack image into the gallery and cart/checkout prefer it too', () => {
      const page = read('app/retailer/catalog/[id]/page.tsx');
      expect(page).toContain('variantGalleryImages(selectedPack, productImages)');
      const cart = read('app/retailer/cart/page.tsx');
      expect(cart).toContain('pack?.image_url ?? images[0]?.image_url');
      const checkout = read('app/retailer/checkout/page.tsx');
      expect(checkout).toContain('pack?.image_url ?? images[0]?.image_url');
    });
  });

  describe('4-7. variant price, units-per-case, quantity tiers and GST stay per-variant', () => {
    it('resolves each variant case price from its own case_price (override aware)', () => {
      const pack50 = BABY_POWDER_PACKS[0]!;
      const pack100 = BABY_POWDER_PACKS[1]!;
      expect(resolvePackPrice(pack50, null)).toBe(1200);
      expect(resolvePackPrice(pack100, null)).toBe(1440); // NOT the 50g price
      // Product-level override applies to whichever variant is selected.
      expect(resolvePackPrice(pack100, 1500)).toBe(1500);
    });

    it('uses the 100g units_per_case (24) — not the 50g (48) — for pieces and per-piece price', () => {
      const pack100 = BABY_POWDER_PACKS.find((pack) => pack.id === PACK_100G)!;
      const breakdown = caseLineBreakdown({
        casePrice: pack100.case_price,
        unitsPerCase: pack100.units_per_case,
        tiers: TIERS_BY_PACK[PACK_100G]!,
        packQuantity: 1,
        gstPercent: GST_PERCENT,
      });
      expect(breakdown.pieces).toBe(24);
      expect(breakdown.cases).toBe(1);
      expect(breakdown.piecePrice).toBe(60); // 1440 / 24
      expect(breakdown.total).toBe(1440); // one full case = exact case price
    });

    it('applies each variant’s OWN quantity slab at the same piece count', () => {
      // 48 pieces: inside the 100g slab (>=48 -> ₹55/pc) but NOT inside the 50g slab (>=96).
      expect(pickApplicableTier(TIERS_BY_PACK[PACK_100G]!, 48)?.price_per_piece).toBe(55);
      expect(pickApplicableTier(TIERS_BY_PACK[PACK_50G]!, 48)).toBeNull();
      const hundredG = caseLineBreakdown({
        casePrice: 1440,
        unitsPerCase: 24,
        tiers: TIERS_BY_PACK[PACK_100G]!,
        pieceQuantity: 48,
        gstPercent: GST_PERCENT,
      });
      expect(hundredG.total).toBe(48 * 55); // 2640, slab applied for the 100g variant
      const fiftyG = caseLineBreakdown({
        casePrice: 1200,
        unitsPerCase: 48,
        tiers: TIERS_BY_PACK[PACK_50G]!,
        pieceQuantity: 48,
        gstPercent: GST_PERCENT,
      });
      expect(fiftyG.total).toBe(1200); // 1 full case at the case price — 50g slab not reached
    });

    it('never adds GST on top — the GST component is extracted from the inclusive price', () => {
      const breakdown = caseLineBreakdown({
        casePrice: 1440,
        unitsPerCase: 24,
        tiers: TIERS_BY_PACK[PACK_100G]!,
        packQuantity: 2,
        gstPercent: GST_PERCENT,
      });
      // 48 pcs @ ₹55 = ₹2640 GST-inclusive; GST is extracted, not added.
      expect(breakdown.total).toBe(2640);
      expect(breakdown.gst).toBeCloseTo((2640 * 5) / 105, 2);
      expect(breakdown.subtotal + breakdown.gst).toBe(2640);
    });
  });

  describe('8-9. cart, checkout and server quote/order carry the SELECTED variant', () => {
    it('cart lines are keyed by pack id with a unique (retailer_id, pack_id) constraint', () => {
      const migration = read('supabase/migrations/0007_pack_based_ordering.sql');
      expect(migration).toContain('unique (retailer_id, pack_id)');
      expect(migration).toContain('sync_cart_item_product_id');
      // The merge service matches on pack_id, so 100g can never merge into a 50g line.
      const merge = read('lib/retailer/cart-merge.ts');
      expect(merge).toContain(".eq('pack_id', line.packId)");
      // Product detail adds the exact pack that was acted upon.
      const selector = read('components/retailer/pack-selector.tsx');
      expect(selector).toContain('addToCartAction(pack.id, qty)');
    });

    it('checkout re-prices every cart line from its own pack (never the product default)', () => {
      const checkout = read('app/retailer/checkout/page.tsx');
      // The page reads the cart's pack_id rows and re-derives pricing per pack.
      expect(checkout).toContain('.eq(\'retailer_id\', user.id)');
      expect(checkout).toContain('pack_id');
      expect(checkout).toContain('loadPackTiers');
      expect(checkout).toContain('packQuantity: item.quantity');
      expect(checkout).toContain('unitsPerCase: pack?.units_per_case ?? 1');
      // No client-submitted money value is ever posted — only notes are.
      const actions = read('lib/retailer/checkout-actions.ts');
      expect(actions).toContain("lines: items.map((item) => ({ packId: item.pack_id, quantity: item.quantity }))");
      // no client-submitted money field is accepted or forwarded
      expect(actions).not.toMatch(/price\s*:/);
    });

    it('server-side quote prices the 100g variant with 100g case price, units and slab', async () => {
      const supabase = makeFakeSupabase({
        retailer: RETAILER,
        packs: BABY_POWDER_PACKS.map((pack) => ({ ...pack, products: { id: PRODUCT_ID, name: 'Baby Powder', gst_percent: GST_PERCENT, is_active: true } })),
        tiersByPack: TIERS_BY_PACK,
      });

      const lines: RequestedQuoteLine[] = [
        { packId: PACK_100G, quantity: 2 }, // 48 pcs -> 100g slab ₹55/pc
        { packId: PACK_50G, quantity: 1 }, // 48 pcs -> below 50g slab -> case price
      ];
      const result = await quoteOrderForRetailer({ retailerId: RETAILER.id, lines, supabase: supabase as never });
      expect('quote' in result).toBe(true);
      if (!('quote' in result)) return;

      const hundred = result.quote.lines.find((line) => line.packId === PACK_100G);
      const fifty = result.quote.lines.find((line) => line.packId === PACK_50G);

      // The 100g line uses the 100g configuration exclusively.
      expect(hundred?.unitsPerCase).toBe(24);
      expect(hundred?.pieces).toBe(48);
      expect(hundred?.casePrice).toBe(1440);
      expect(hundred?.piecePrice).toBe(55); // the 100g tier won
      expect(hundred?.lineTotal).toBe(2640);
      expect(hundred?.gstPercent).toBe(GST_PERCENT);

      // The 50g line keeps its own configuration — proof the variants never mix.
      expect(fifty?.unitsPerCase).toBe(48);
      expect(fifty?.piecePrice).toBe(25);
      expect(fifty?.lineTotal).toBe(1200);

      expect(result.quote.grandTotal).toBe(3840); // 2640 + 1200, GST-inclusive
    });

    it('the server quote rejects an unavailable variant instead of faking it', async () => {
      const inactive100 = BABY_POWDER_PACKS.map((pack) =>
        pack.id === PACK_100G ? { ...pack, is_active: false } : pack
      );
      const supabase = makeFakeSupabase({
        retailer: RETAILER,
        packs: inactive100.map((pack) => ({ ...pack, products: { id: PRODUCT_ID, name: 'Baby Powder', gst_percent: GST_PERCENT, is_active: true } })),
        tiersByPack: TIERS_BY_PACK,
      });
      const result = await quoteOrderForRetailer({
        retailerId: RETAILER.id,
        lines: [{ packId: PACK_100G, quantity: 1 }],
        supabase: supabase as never,
      });
      expect('error' in result && result.error.includes('no longer available')).toBe(true);
    });

    it('order creation persists quote lines verbatim — pack_id included — and never trusts client prices', () => {
      const create = read('lib/orders/create-order.ts');
      expect(create).toContain('pack_id: line.packId');
      expect(create).toContain('unit_price: line.unitPrice');
      expect(create).toContain('quoteOrderForRetailer');
      // The order detail page and invoice read product_packs per order item.
      const detail = read('app/retailer/orders/[id]/page.tsx');
      expect(detail).toContain('product_packs ( pack_name, units_per_case )');
      const invoice = read('app/retailer/orders/[id]/invoice/page.tsx');
      expect(invoice).toContain('product_packs ( pack_name, units_per_case )');
    });
  });

  describe('data model & admin', () => {
    it('migration 0024 only adds a nullable pack image column — no data or RLS changes', () => {
      const migration = read('supabase/migrations/0024_pack_variant_images.sql');
      expect(migration).toContain('alter table product_packs add column image_url text;');
      expect(migration).not.toMatch(/drop column/i);
      expect(migration).not.toMatch(/create policy/i);
      expect(migration).not.toMatch(/drop policy/i);
      expect(migration).not.toMatch(/grant /i);
      expect(migration).not.toMatch(/update .*set/i);
    });

    it('types expose product_packs.image_url as nullable', () => {
      const types = read('types/database.types.ts');
      expect(types).toContain('image_url: string | null;');
    });

    it('admin can attach an image to each pack variant through the existing pack manager', () => {
      const manager = read('components/admin/product-pack-manager.tsx');
      expect(manager).toContain('setPackImageAction');
      expect(manager).toContain("kind=\"product-gallery\"");
      const actions = read('lib/admin/products-actions.ts');
      expect(actions).toContain('setPackImageAction');
      expect(actions).toContain(".eq('product_id', productId)"); // pack must belong to the product
      // SKU code stays removed from the workflow.
      expect(actions).not.toContain('skuCode: z.string()');
    });
  });
});
