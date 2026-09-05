import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { calculateRetailerPiecePrice, pickRetailerPieceTier, type RetailerPiecePricing } from '@/lib/retailer/retailer-pricing';
import type { PricingTier } from '@/lib/retailer/case-pricing';

const root = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

/**
 * SMALL-RETAILER B2B PIECE MODEL
 *
 * The retailer buys PIECES, never cases. Quantity Q is priced at Q × (the
 * per-piece rate of the selling tier that covers Q). The case is an INTERNAL
 * supplier/warehouse/stock-packing concept and must NEVER leak to the retailer.
 *
 * Reference configuration from the business requirement:
 *   1 case = 80 pcs   ·   internal case price ₹1,000 (GST-inclusive)
 *   retailer loose-piece tiers
 *     1–6 → ₹30 · 7–12 → ₹28 · 13–20 → ₹27 · 21–79 → ₹26
 */

const UNITS_PER_CASE = 80;
const CASE_PRICE = 1000;

const LOOSE_TIERS: PricingTier[] = [
  { id: 'e1', min_quantity: 1, max_quantity: 7, price_per_piece: 30, rule_type: 'loose' },
  { id: 'e2', min_quantity: 7, max_quantity: 13, price_per_piece: 28, rule_type: 'loose' },
  { id: 'e3', min_quantity: 13, max_quantity: 21, price_per_piece: 27, rule_type: 'loose' },
  { id: 'e4', min_quantity: 21, max_quantity: 80, price_per_piece: 26, rule_type: 'loose' },
];

function price(quantity: number, overrides: Partial<Parameters<typeof calculateRetailerPiecePrice>[0]> = {}): RetailerPiecePricing {
  return calculateRetailerPiecePrice({
    quantity,
    unitsPerCase: UNITS_PER_CASE,
    casePrice: CASE_PRICE,
    tiers: LOOSE_TIERS,
    gstPercent: 0,
    ...overrides,
  });
}

describe('retailer piece pricing: the mandated worked examples', () => {
  it('prices every documented quantity exactly', () => {
    const expectations: [number, number, number][] = [
      // [qty, rate, total]
      [1, 30, 30],
      [6, 30, 180],
      [7, 28, 196],
      [12, 28, 336],
      [13, 27, 351],
      [20, 27, 540],
      [40, 26, 1040],
    ];
    for (const [quantity, rate, total] of expectations) {
      const result = price(quantity);
      expect({ q: quantity, rate: result.unitPrice, total: result.lineTotal }).toEqual({ q: quantity, rate, total });
      expect(result.orderable).toBe(true);
      // The retailer is charged quantity × rate exactly.
      expect(result.lineTotal).toBe(quantity * rate);
      expect(result.lineTotal).toBe(total);
    }
  });

  it('bills 12 pcs at the 7–12 slab — never the case price and never a per-case fraction', () => {
    const twelve = price(12);
    expect(twelve.unitPrice).toBe(28);
    expect(twelve.lineTotal).toBe(12 * 28);
    expect(twelve.tier?.id).toBe('e2');
    // Forbidden calculations for the retailer:
    expect(twelve.lineTotal).not.toBe((12 / UNITS_PER_CASE) * CASE_PRICE);
    expect(twelve.lineTotal).not.toBe(12 * CASE_PRICE);
  });

  it('lets the retailer order well below one case', () => {
    for (const quantity of [1, 6, 12, 40]) {
      expect(price(quantity).orderable).toBe(true);
    }
  });

  it('does NOT force a full case: 40 pcs uses the 21–79 piece rate', () => {
    const forty = price(40);
    expect(forty.unitPrice).toBe(26);
    expect(forty.lineTotal).toBe(40 * 26); // ₹1,040, not forced to 80 pcs
    expect(forty.orderable).toBe(true);
  });

  it('extends the deepest tier for any quantity above the top slab', () => {
    expect(price(80).unitPrice).toBe(26);
    expect(price(160).unitPrice).toBe(26);
    expect(price(160).lineTotal).toBe(160 * 26);
  });
});

describe('variant-specific selling tiers', () => {
  it('switching size swaps the per-piece rate (50g vs 100g)', () => {
    const fifty: PricingTier[] = [
      { min_quantity: 1, max_quantity: 7, price_per_piece: 30, rule_type: 'loose' },
      { min_quantity: 7, max_quantity: 13, price_per_piece: 28, rule_type: 'loose' },
    ];
    const hundred: PricingTier[] = [
      { min_quantity: 1, max_quantity: 7, price_per_piece: 45, rule_type: 'loose' },
      { min_quantity: 7, max_quantity: 13, price_per_piece: 42, rule_type: 'loose' },
    ];
    const at12 = (tiers: PricingTier[]) =>
      calculateRetailerPiecePrice({ quantity: 12, unitsPerCase: 80, casePrice: 1000, tiers, gstPercent: 0 });

    expect(at12(fifty).unitPrice).toBe(28);
    expect(at12(fifty).lineTotal).toBe(12 * 28);
    expect(at12(hundred).unitPrice).toBe(42);
    expect(at12(hundred).lineTotal).toBe(12 * 42);
  });
});

describe('GST-inclusive pricing stays correct', () => {
  it('extracts GST from the inclusive amount and never adds it on top', () => {
    const result = calculateRetailerPiecePrice({
      quantity: 12,
      unitsPerCase: UNITS_PER_CASE,
      casePrice: CASE_PRICE,
      tiers: LOOSE_TIERS,
      gstPercent: 5,
    });
    expect(result.lineTotal).toBe(336);
    // GST is the component already inside the inclusive total.
    expect(result.gst).toBeCloseTo((336 * 5) / 105, 2);
    expect(result.subtotal + result.gst).toBeCloseTo(result.lineTotal, 2);
  });
});

describe('validation', () => {
  it('rejects zero, negative and fractional quantities', () => {
    expect(price(0).orderable).toBe(false);
    expect(price(0).lineTotal).toBe(0);
    expect(price(-5).orderable).toBe(false);
    expect(price(12.5).orderable).toBe(false);
    expect(price(12.5).message).toMatch(/whole number/i);
  });

  it('respects the piece MOQ', () => {
    const result = calculateRetailerPiecePrice({
      quantity: 3,
      unitsPerCase: UNITS_PER_CASE,
      casePrice: CASE_PRICE,
      tiers: LOOSE_TIERS,
      gstPercent: 0,
      moq: 6,
    });
    expect(result.orderable).toBe(false);
    expect(result.message).toMatch(/minimum order quantity/i);
  });

  it('falls back to the derived per-piece rate when a pack has no tiers', () => {
    const result = calculateRetailerPiecePrice({
      quantity: 40,
      unitsPerCase: 80,
      casePrice: 1000,
      tiers: [],
      gstPercent: 0,
    });
    expect(result.priceSource).toBe('derived');
    expect(result.unitPrice).toBe(CASE_PRICE / UNITS_PER_CASE);
    expect(result.lineTotal).toBe((CASE_PRICE / UNITS_PER_CASE) * 40);
  });
});

describe('the retailer experience never leaks internal case / cost data', () => {
  const retailerSurfaces = [
    'app/retailer/catalog/[id]/page.tsx',
    'app/retailer/cart/page.tsx',
    'app/retailer/checkout/page.tsx',
    'components/retailer/pack-selector.tsx',
    'components/retailer/cart-item-row.tsx',
    'components/retailer/quick-order-row.tsx',
    'components/retailer/pricing-schedule.tsx',
    'components/retailer/product-card.tsx',
    'components/retailer/reorder-form.tsx',
  ];

  it('retailer UI never prices a quantity through the case+loose engine', () => {
    for (const file of retailerSurfaces) {
      const source = read(file);
      // The case+loose engine is internal-only. If a retailer surface priced a
      // line with it, the retailer would see a case-based number.
      expect(source, file).not.toContain('calculateCaseLoosePrice');
    }
  });

  it('surfaces that price a quantity on the fly use the piece engine or a piece schedule', () => {
    // These surfaces compute a price for an arbitrary typed/selected quantity, so
    // they MUST use the piece engine or its schedule/breakdown component. A card
    // that only shows a static per-piece "from" rate is excluded.
    const quantityPriced = [
      'app/retailer/catalog/[id]/page.tsx',
      'app/retailer/cart/page.tsx',
      'app/retailer/checkout/page.tsx',
      'components/retailer/pack-selector.tsx',
      'components/retailer/cart-item-row.tsx',
      'components/retailer/quick-order-row.tsx',
      'components/retailer/pricing-schedule.tsx',
      'components/retailer/reorder-form.tsx',
    ];
    for (const file of quantityPriced) {
      const source = read(file);
      expect(source, file).toMatch(/calculateRetailerPiecePrice|RetailerPriceSchedule|RetailerLineBreakdown/);
    }
  });

  it('does not render a case selling price, supplier cost or units-per-case requirement to the retailer', () => {
    // Case/loose terms the retailer must never read as a buying requirement.
    const forbidden = [
      /Case price/i,
      /case price/i,
      /supplier cost/i,
      /landed cost/i,
      /admin margin/i,
      /pcs per case/i,
      /pcs\/case/i,
      /per case of/i,
    ];
    for (const file of retailerSurfaces) {
      const source = read(file);
      for (const pattern of forbidden) {
        // Comments describing the internal model are allowed; the UI text is not.
        // We strip block/line comments before the check so the guard targets
        // what the retailer would actually read.
        const codeOnly = source
          .split('\n')
          .filter((line) => !line.trimStart().startsWith('*') && !line.trimStart().startsWith('//') && !line.trimStart().startsWith('/*'))
          .join('\n');
        expect(codeOnly, `${file} :: ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it('keeps the internal case model intact for admin / warehouse', () => {
    const engine = read('lib/retailer/case-pricing.ts');
    expect(engine).toContain('calculateCaseLoosePrice');
    expect(engine).toContain('fullCases');
    expect(engine).toContain('looseQuantity');
    // The case engine is still the SINGLE internal source of truth.
    const quote = read('lib/orders/quote-order.ts');
    expect(quote).toContain('calculateRetailerPiecePrice({');
  });
});

describe('server re-calculates the final price authoritatively', () => {
  it('quote-order prices a line with the retailer piece engine', () => {
    const quote = read('lib/orders/quote-order.ts');
    expect(quote).toContain('calculateRetailerPiecePrice({');
    expect(quote).toContain("quantityUnit: 'pieces'");
    expect(quote).not.toMatch(/unitPrice: pricing\.casePrice/);
    expect(quote).not.toMatch(/unitPrice: pricing\.looseUnitPrice/);
  });

  it('quotes 12 pcs as a single exact piece row', async () => {
    // Imported lazily to avoid loading server-only at collection time in some
    // runtimes; the function is exercised through the public API.
    const { quoteOrderForRetailer } = await import('@/lib/orders/quote-order');
    const pack = {
      id: '99999999-9999-4999-8999-999999999999',
      product_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      pack_name: '50G',
      base_price: 1000,
      ptr: null,
      case_price: CASE_PRICE,
      units_per_case: UNITS_PER_CASE,
      moq: 1,
      is_active: true,
      products: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Test', gst_percent: 0, is_active: true },
    };
    const retailer = {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      area_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      status: 'active' as const,
      credit_limit: 1000000,
      outstanding_balance: 0,
    };
    const tiersByPack: Record<string, PricingTier[]> = {
      [pack.id]: LOOSE_TIERS.map((tier) => ({
        ...tier,
        id: `row-${tier.id}`,
        product_pack_id: pack.id,
        is_active: true,
      })),
    };
    const supabase = {
      from: (table: string) => {
        const chain: Record<string, unknown> = {};
        const self = () => chain as never;
        Object.assign(chain, {
          select: () => self(),
          eq: () => self(),
          lte: () => self(),
          in: () => self(),
          order: () => self(),
          returns: () => chain,
          maybeSingle: async () => ({ data: table === 'retailers' ? retailer : null, error: null }),
          then: (resolve: (value: { data: unknown[]; error: null }) => unknown) => {
            if (table === 'product_packs') return resolve({ data: [pack], error: null });
            if (table === 'product_pricing_tiers') return resolve({ data: tiersByPack[pack.id] ?? [], error: null });
            return resolve({ data: [], error: null });
          },
        });
        return chain;
      },
    };
    const result = await quoteOrderForRetailer({
      retailerId: retailer.id,
      lines: [{ packId: pack.id, quantity: 12 }],
      supabase: supabase as never,
    });
    expect('quote' in result).toBe(true);
    if (!('quote' in result)) return;
    const line = result.quote.lines[0]!;
    expect(line.pieces).toBe(12);
    expect(line.cases).toBe(0);
    expect(line.loosePieces).toBe(0);
    expect(line.piecePrice).toBe(28);
    expect(line.lineTotal).toBe(336);
    // One exact piece row, never a case/loose split.
    expect(line.items).toHaveLength(1);
    expect(line.items[0]).toMatchObject({ quantity: 12, quantityUnit: 'pieces', unitPrice: 28, lineTotal: 336 });
  });

  it('pickRetailerPieceTier extends the top tier', () => {
    expect(pickRetailerPieceTier(LOOSE_TIERS, 1)?.price_per_piece).toBe(30);
    expect(pickRetailerPieceTier(LOOSE_TIERS, 6)?.price_per_piece).toBe(30);
    expect(pickRetailerPieceTier(LOOSE_TIERS, 7)?.price_per_piece).toBe(28);
    expect(pickRetailerPieceTier(LOOSE_TIERS, 40)?.price_per_piece).toBe(26);
    expect(pickRetailerPieceTier(LOOSE_TIERS, 200)?.price_per_piece).toBe(26);
  });
});
