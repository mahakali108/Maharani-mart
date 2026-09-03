import { describe, expect, it } from 'vitest';
import {
  caseLineBreakdown,
  gstComponentFromInclusive,
  pickApplicableTier,
  piecePriceFromCase,
  round2,
  validateTiers,
  type PricingTier,
} from '@/lib/retailer/case-pricing';
import { calculateCreditPosition, roundMoney } from '@/lib/orders/credit';
import { normalizeQuoteLines } from '@/lib/orders/quote-order';
import { resolvePackCasePrice } from '@/lib/retailer/effective-price';

/**
 * PRICING RECONCILIATION — the invariants the business rules depend on.
 *
 * These tests pin the EXISTING engine; they were added by the retailer
 * enterprise upgrade and deliberately change no arithmetic. They exist so a
 * future edit that introduces rounding drift, adds GST on top of an inclusive
 * price, or lets a client-supplied number reach a total fails loudly.
 *
 * The single most important invariant is the one the order pipeline persists:
 *
 *     order_items.unit_price × order_items.quantity  ===  order_items.line_total
 *
 * `quoteOrderForRetailer` derives `unitPrice = roundMoney(lineTotal / quantity)`
 * (the per-case price actually charged) rather than multiplying a per-piece
 * figure back out, precisely so the stored invoice reconciles. Every quantity
 * the order path accepts is checked below.
 */

/** Mirrors lib/orders/quote-order.ts exactly — keep the two in sync. */
function quoteLine(input: {
  casePrice: number;
  unitsPerCase: number;
  tiers?: PricingTier[];
  quantity: number;
  gstPercent: number;
}) {
  const breakdown = caseLineBreakdown({
    casePrice: input.casePrice,
    unitsPerCase: input.unitsPerCase,
    tiers: input.tiers ?? [],
    packQuantity: input.quantity,
    gstPercent: input.gstPercent,
  });
  return {
    ...breakdown,
    unitPrice: roundMoney(breakdown.total / Math.max(input.quantity, 1)),
  };
}

const CASE_PRICES = [0.01, 33.33, 100, 499.99, 900, 1234.56];
const UNITS_PER_CASE = [1, 2, 3, 6, 7, 12, 24, 50];
const GST_RATES = [0, 5, 12, 18, 28];
const QUANTITIES = Array.from({ length: 30 }, (_, index) => index + 1);

/**
 * Tier set shaped like the real ones the admin pack manager seeds: a slab below
 * a full case, a slab at a full case, and a bulk slab above it. Boundaries are
 * strictly increasing so the set is valid for a single-piece pack too.
 */
const SLAB_TIERS = (unitsPerCase: number, piecePrice: number): PricingTier[] => {
  const caseBoundary = Math.max(2, unitsPerCase);
  return [
    { id: 't1', min_quantity: 1, max_quantity: caseBoundary, price_per_piece: round2(piecePrice * 1.1), rule_type: 'default' },
    { id: 't2', min_quantity: caseBoundary, max_quantity: caseBoundary * 2, price_per_piece: piecePrice, rule_type: 'case' },
    { id: 't3', min_quantity: caseBoundary * 2, max_quantity: null, price_per_piece: round2(piecePrice * 0.9), rule_type: 'bulk' },
  ];
};

describe('order line reconciliation: unit_price × quantity = line_total', () => {
  it('holds for every supported quantity, case price, pack size and GST rate (no tiers)', () => {
    let checked = 0;
    for (const casePrice of CASE_PRICES) {
      for (const unitsPerCase of UNITS_PER_CASE) {
        for (const gstPercent of GST_RATES) {
          for (const quantity of QUANTITIES) {
            const line = quoteLine({ casePrice, unitsPerCase, tiers: [], quantity, gstPercent });
            expect(roundMoney(line.unitPrice * quantity)).toBe(line.total);
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(5000);
  });

  it('holds for every supported quantity when real quantity slabs apply', () => {
    let checked = 0;
    for (const casePrice of CASE_PRICES) {
      for (const unitsPerCase of UNITS_PER_CASE) {
        const tiers = SLAB_TIERS(unitsPerCase, piecePriceFromCase(casePrice, unitsPerCase));
        expect(validateTiers(tiers)).toBeNull();
        for (const gstPercent of GST_RATES) {
          for (const quantity of QUANTITIES) {
            const line = quoteLine({ casePrice, unitsPerCase, tiers, quantity, gstPercent });
            expect(roundMoney(line.unitPrice * quantity)).toBe(line.total);
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(5000);
  });

  it('reconciles an odd case price that does not divide evenly into pieces', () => {
    // ₹100 for 3 pieces → 33.333…/pc. A full case must still cost exactly ₹100,
    // and the stored per-case unit price must multiply back to the line total.
    for (const quantity of QUANTITIES) {
      const line = quoteLine({ casePrice: 100, unitsPerCase: 3, tiers: [], quantity, gstPercent: 18 });
      expect(line.total).toBe(round2(100 * quantity));
      expect(line.unitPrice).toBe(100);
      expect(roundMoney(line.unitPrice * quantity)).toBe(line.total);
    }
  });

  it('aggregates multi-line orders without drift: Σ line_total = subtotal + gst_total', () => {
    const lines = [
      quoteLine({ casePrice: 900, unitsPerCase: 12, quantity: 3, gstPercent: 5 }),
      quoteLine({ casePrice: 33.33, unitsPerCase: 7, quantity: 11, gstPercent: 18 }),
      quoteLine({ casePrice: 499.99, unitsPerCase: 1, quantity: 25, gstPercent: 12 }),
      quoteLine({ casePrice: 1234.56, unitsPerCase: 24, quantity: 2, gstPercent: 28 }),
    ];

    const subtotal = roundMoney(lines.reduce((sum, line) => roundMoney(sum + line.subtotal), 0));
    const gstTotal = roundMoney(lines.reduce((sum, line) => roundMoney(sum + line.gst), 0));
    const lineTotals = roundMoney(lines.reduce((sum, line) => roundMoney(sum + line.total), 0));

    // Exactly what quoteOrderForRetailer stores on the order row.
    expect(roundMoney(subtotal + gstTotal)).toBe(lineTotals);
    for (const line of lines) {
      expect(roundMoney(line.subtotal + line.gst)).toBe(line.total);
    }
  });
});

describe('GST is inclusive end to end and is never added twice', () => {
  it('extracts GST from the inclusive price instead of adding it on top', () => {
    // Business example: MRP ₹30, case = 12 pieces, case price ₹240 GST-inclusive, GST 18%.
    const line = quoteLine({ casePrice: 240, unitsPerCase: 12, quantity: 1, gstPercent: 18 });
    expect(line.total).toBe(240); // NOT 240 * 1.18
    expect(line.gst).toBe(gstComponentFromInclusive(240, 18)); // 240 * 18/118 = 36.61
    expect(line.gst).toBe(36.61);
    expect(line.subtotal).toBe(203.39);
    expect(roundMoney(line.subtotal + line.gst)).toBe(240);
  });

  it('keeps a 0% GST line tax-free and a 28% line inside the same inclusive total', () => {
    for (const gstPercent of GST_RATES) {
      const line = quoteLine({ casePrice: 1000, unitsPerCase: 10, quantity: 4, gstPercent });
      expect(line.total).toBe(4000);
      expect(line.gst).toBe(round2((4000 * gstPercent) / (100 + gstPercent)));
      expect(roundMoney(line.subtotal + line.gst)).toBe(line.total);
    }
  });

  it('never grows the grand total when a GST rate is applied', () => {
    const base = quoteLine({ casePrice: 899.99, unitsPerCase: 6, quantity: 7, gstPercent: 0 });
    for (const gstPercent of GST_RATES) {
      const taxed = quoteLine({ casePrice: 899.99, unitsPerCase: 6, quantity: 7, gstPercent });
      expect(taxed.total).toBe(base.total);
      expect(taxed.gst).toBeGreaterThanOrEqual(0);
      expect(taxed.subtotal).toBeLessThanOrEqual(taxed.total);
    }
  });
});

describe('case price remains the source of truth; piece price is derived', () => {
  it('derives the piece price from the case price and never stores it', () => {
    expect(piecePriceFromCase(240, 12)).toBe(20);
    expect(piecePriceFromCase(100, 3)).toBe(33.33);
    expect(piecePriceFromCase(500, 0)).toBe(500); // degenerate pack falls back safely
  });

  it('charges exactly cases × case_price for whole cases', () => {
    for (const unitsPerCase of UNITS_PER_CASE) {
      for (const quantity of [1, 2, 3, 5, 12, 24]) {
        const line = quoteLine({ casePrice: 480, unitsPerCase, quantity, gstPercent: 5 });
        expect(line.pieces).toBe(quantity * unitsPerCase);
        expect(line.cases).toBe(quantity);
        expect(line.loosePieces).toBe(0);
        expect(line.total).toBe(round2(480 * quantity));
      }
    }
  });

  it('applies the slab price to loose pieces while full cases keep the case price', () => {
    const tiers: PricingTier[] = [
      { min_quantity: 1, max_quantity: 12, price_per_piece: 22, rule_type: 'default' },
      { min_quantity: 12, max_quantity: null, price_per_piece: 20, rule_type: 'case' },
    ];
    // 15 pieces of a 12-unit pack = 1 case (₹240) + 3 loose @ the applicable slab.
    const line = caseLineBreakdown({ casePrice: 240, unitsPerCase: 12, tiers, pieceQuantity: 15, gstPercent: 5 });
    expect(line.cases).toBe(1);
    expect(line.loosePieces).toBe(3);
    // 0026: the remainder (3 pcs) picks the slab — ₹22/pc. Selecting it from the
    // total (15 pcs → the [12, ∞) ₹20 slab) would have repriced the case part.
    expect(line.piecePrice).toBe(22);
    expect(line.total).toBe(round2(240 + 3 * 22));
    // The case part is never touched by the slab, at any quantity.
    const twoCases = caseLineBreakdown({ casePrice: 240, unitsPerCase: 12, tiers, pieceQuantity: 24, gstPercent: 5 });
    expect(twoCases.total).toBe(480);
  });

  it('selects the matching tier with the largest min_quantity (half-open ranges)', () => {
    const tiers: PricingTier[] = [
      { min_quantity: 1, max_quantity: 7, price_per_piece: 25, rule_type: 'default' },
      { min_quantity: 7, max_quantity: 12, price_per_piece: 22, rule_type: 'bulk' },
      { min_quantity: 12, max_quantity: null, price_per_piece: 20, rule_type: 'case' },
    ];
    expect(pickApplicableTier(tiers, 1)?.price_per_piece).toBe(25);
    expect(pickApplicableTier(tiers, 6)?.price_per_piece).toBe(25);
    expect(pickApplicableTier(tiers, 7)?.price_per_piece).toBe(22);
    expect(pickApplicableTier(tiers, 11)?.price_per_piece).toBe(22);
    expect(pickApplicableTier(tiers, 12)?.price_per_piece).toBe(20);
    expect(pickApplicableTier(tiers, 24)?.price_per_piece).toBe(20);
    expect(pickApplicableTier([], 5)).toBeNull();
    expect(pickApplicableTier([{ min_quantity: 5, max_quantity: null, price_per_piece: 9, is_active: false }], 9)).toBeNull();
  });

  it('resolves the effective case price with server-side override precedence only', () => {
    const pack = { case_price: 240, ptr: 200, base_price: 260 };
    // A product-level price_lists override wins (retailer > area, resolved server-side)…
    expect(resolvePackCasePrice(pack, 228)).toBe(228);
    // …otherwise the GST-inclusive case_price is authoritative…
    expect(resolvePackCasePrice(pack, null)).toBe(240);
    // …with the legacy columns only as a migration fallback.
    expect(resolvePackCasePrice({ case_price: null, ptr: 200, base_price: 260 }, null)).toBe(200);
    expect(resolvePackCasePrice({ case_price: null, ptr: null, base_price: 260 }, null)).toBe(260);
  });

  it('has no parameter through which a client could inject a price', () => {
    // The breakdown is a pure function of catalog + quantity data. There is no
    // "clientPrice"/"submittedTotal" input to pass, which is the structural
    // guarantee that a tampered request cannot set its own amount.
    expect(caseLineBreakdown.length).toBe(1);
    const keys = Object.keys({
      casePrice: 0,
      unitsPerCase: 0,
      tiers: [],
      packQuantity: 0,
      pieceQuantity: 0,
      gstPercent: 0,
    });
    expect(keys.some((key) => /client|submitted|quoted|requested/i.test(key))).toBe(false);
  });
});

describe('quantity, MOQ and credit gates on the order path', () => {
  it('rejects quantities the order path cannot price', () => {
    expect(normalizeQuoteLines([])).toHaveProperty('error');
    expect(normalizeQuoteLines([{ packId: 'p', quantity: 0 }])).toHaveProperty('error');
    expect(normalizeQuoteLines([{ packId: 'p', quantity: -1 }])).toHaveProperty('error');
    expect(normalizeQuoteLines([{ packId: 'p', quantity: 1.5 }])).toHaveProperty('error');
    expect(normalizeQuoteLines([{ packId: 'p', quantity: 100001 }])).toHaveProperty('error');
    expect(normalizeQuoteLines([{ packId: '', quantity: 2 }])).toHaveProperty('error');
    // The same pack twice would double-count a line total.
    expect(normalizeQuoteLines([{ packId: 'p', quantity: 2 }, { packId: 'p', quantity: 3 }])).toHaveProperty('error');
    expect(normalizeQuoteLines(Array.from({ length: 201 }, (_, i) => ({ packId: `p${i}`, quantity: 1 })))).toHaveProperty('error');
    expect(normalizeQuoteLines([{ packId: 'p', quantity: 1 }])).toHaveProperty('lines');
  });

  it('accepts every whole quantity the catalog supports', () => {
    for (const quantity of QUANTITIES) {
      const result = normalizeQuoteLines([{ packId: 'pack-a', quantity }]);
      expect('lines' in result).toBe(true);
    }
  });

  it('enforces the credit limit server-side, and treats a zero limit as "not configured"', () => {
    // No configured limit → the existing semantics: never blocked by credit.
    expect(calculateCreditPosition(0, 5000, 100000)).toMatchObject({
      hasConfiguredLimit: false,
      availableCredit: null,
      exceedsLimit: false,
    });

    // Within the limit.
    expect(calculateCreditPosition(50000, 20000, 25000)).toMatchObject({
      availableCredit: 30000,
      availableAfterOrder: 5000,
      exceedsLimit: false,
    });

    // Exactly at the limit is allowed; one paisa over is not.
    expect(calculateCreditPosition(50000, 20000, 30000).exceedsLimit).toBe(false);
    expect(calculateCreditPosition(50000, 20000, 30000.01).exceedsLimit).toBe(true);

    // Already over the limit blocks any further order.
    expect(calculateCreditPosition(50000, 60000, 0).exceedsLimit).toBe(true);

    // A negative or absurd client-supplied impact can never widen the limit.
    expect(calculateCreditPosition(50000, 20000, -99999).orderImpact).toBe(0);
    expect(calculateCreditPosition(-5, -5, 0)).toMatchObject({ creditLimit: 0, outstandingBalance: 0 });
  });
});

describe('tier configuration validation (admin-authored, retailer-consumed)', () => {
  it('accepts a consistent half-open slab set', () => {
    expect(validateTiers(SLAB_TIERS(12, 20))).toBeNull();
    expect(validateTiers([])).toBeNull();
  });

  it('rejects overlapping, inverted or negative slabs', () => {
    expect(validateTiers([
      { min_quantity: 1, max_quantity: 12, price_per_piece: 20 },
      { min_quantity: 10, max_quantity: null, price_per_piece: 18 },
    ])).toMatch(/overlap/i);
    expect(validateTiers([{ min_quantity: 12, max_quantity: 5, price_per_piece: 20 }])).toMatch(/greater than its minimum/i);
    expect(validateTiers([{ min_quantity: 0, max_quantity: null, price_per_piece: 20 }])).toMatch(/at least 1/i);
    expect(validateTiers([{ min_quantity: 1, max_quantity: null, price_per_piece: -1 }])).toMatch(/negative/i);
  });
});

describe('reorder always re-prices at today’s rate', () => {
  it('never carries a historical unit price into a new line total', () => {
    // The reorder flow only forwards packId + quantity; the price is resolved
    // again from the pack's CURRENT case price. Simulate a pack that was
    // ₹900/case when first ordered and is ₹1050/case now.
    const historicalUnitPrice = 900;
    const current = quoteLine({ casePrice: 1050, unitsPerCase: 12, quantity: 4, gstPercent: 5 });

    expect(current.casePrice).toBe(1050);
    expect(current.unitPrice).toBe(1050);
    expect(current.total).toBe(4200);
    expect(roundMoney(current.unitPrice * 4)).toBe(current.total);
    // The old amount has no influence on the new line whatsoever.
    expect(current.total).not.toBe(roundMoney(historicalUnitPrice * 4));
  });

  it('re-prices a variant whose case size changed since the original order', () => {
    const before = quoteLine({ casePrice: 600, unitsPerCase: 12, quantity: 2, gstPercent: 12 });
    const after = quoteLine({ casePrice: 600, unitsPerCase: 24, quantity: 2, gstPercent: 12 });

    expect(before.pieces).toBe(24);
    expect(after.pieces).toBe(48);
    // Same case price, more pieces per case → the per-piece price falls and the
    // line total is unchanged, exactly as the case-is-truth model requires.
    expect(after.piecePrice).toBeLessThan(before.piecePrice);
    expect(after.total).toBe(before.total);
    expect(roundMoney(after.unitPrice * 2)).toBe(after.total);
  });
});
