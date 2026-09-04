import { describe, expect, it } from 'vitest';
import {
  calculateCaseLoosePrice,
  describeCaseLooseLine,
  findLooseCoverageGaps,
  formatLooseRanges,
  gstComponentFromInclusive,
  inclusiveMaxQuantity,
  isLooseConfigurationComplete,
  looseTierDraftToRow,
  maxLooseQuantity,
  resolveLooseTierSet,
  round2,
  suggestedQuantities,
  tierRangeLabel,
  toPaise,
  fromPaise,
  validateLooseTierSet,
  type PricingTier,
} from '@/lib/retailer/case-pricing';
import { formatInr } from '@/lib/retailer/format';

/**
 * CASE + LOOSE PIECE TIER PRICING — the business rules the whole platform
 * depends on, pinned here against the ONE canonical engine that cart, product
 * page, checkout, order creation, invoice and the admin preview all call.
 *
 * Reference configuration from the business requirement:
 *
 *   units per case  40 pcs
 *   case price      ₹1,000 / case
 *   loose tiers     1–6 pcs ₹30 · 7–12 pcs ₹28 · 13–20 pcs ₹27 · 21–39 pcs ₹26
 *
 * Tiers are stored half-open [min, max) exactly like `product_pricing_tiers`,
 * so 1–6 pcs is stored as min 1 / max 7 and 21–39 pcs as min 21 / max 40.
 */

const UNITS_PER_CASE = 40;
const CASE_PRICE = 1000;

const LOOSE_TIERS: PricingTier[] = [
  { id: 'l1', min_quantity: 1, max_quantity: 7, price_per_piece: 30, rule_type: 'loose' },
  { id: 'l2', min_quantity: 7, max_quantity: 13, price_per_piece: 28, rule_type: 'loose' },
  { id: 'l3', min_quantity: 13, max_quantity: 21, price_per_piece: 27, rule_type: 'loose' },
  { id: 'l4', min_quantity: 21, max_quantity: 40, price_per_piece: 26, rule_type: 'loose' },
];

function price(quantity: number, overrides: Partial<Parameters<typeof calculateCaseLoosePrice>[0]> = {}) {
  return calculateCaseLoosePrice({
    quantity,
    unitsPerCase: UNITS_PER_CASE,
    casePrice: CASE_PRICE,
    tiers: LOOSE_TIERS,
    gstPercent: 0,
    ...overrides,
  });
}

describe('case + loose engine: the worked examples from the business requirement', () => {
  it('prices every documented quantity exactly', () => {
    const expectations: [number, number, number, number][] = [
      //  [qty, total, fullCases, looseQty]
      [1, 30, 0, 1],
      [6, 180, 0, 6],
      [7, 196, 0, 7],
      [10, 280, 0, 10],
      [12, 336, 0, 12],
      [13, 351, 0, 13],
      [20, 540, 0, 20],
      [21, 546, 0, 21],
      [25, 650, 0, 25],
      [39, 1014, 0, 39],
      [40, 1000, 1, 0],
      [41, 1030, 1, 1],
      [46, 1180, 1, 6],
      [48, 1224, 1, 8],
      [79, 2014, 1, 39],
      [80, 2000, 2, 0],
      [81, 2030, 2, 1],
      [85, 2150, 2, 5],
      [92, 2336, 2, 12],
    ];

    for (const [quantity, total, fullCases, looseQuantity] of expectations) {
      const result = price(quantity);
      expect({ quantity, total: result.total, fullCases: result.fullCases, loose: result.looseQuantity }).toEqual({
        quantity,
        total,
        fullCases,
        loose: looseQuantity,
      });
      expect(result.orderable).toBe(true);
      // The two systems are added, never blended: nothing is lost in rounding.
      expect(result.caseSubtotal + result.looseSubtotal).toBe(result.total);
    }
  });

  it('uses ONLY the case price for a full case — never 40 × the loose rate', () => {
    const oneCase = price(40);
    expect(oneCase.total).toBe(1000);
    expect(oneCase.caseSubtotal).toBe(1000);
    expect(oneCase.looseSubtotal).toBe(0);
    expect(oneCase.looseUnitPrice).toBeNull();
    // 40 loose pcs at the cheapest slab would have been ₹1,040 — wrong by design.
    expect(oneCase.total).not.toBe(40 * 26);
  });

  it('uses ONLY the loose tier for the remainder — never the case price', () => {
    const result = price(46);
    expect(result.fullCases).toBe(1);
    expect(result.looseQuantity).toBe(6);
    expect(result.looseUnitPrice).toBe(30);
    expect(result.loosePriceSource).toBe('tier');
    expect(result.caseSubtotal).toBe(1000);
    expect(result.looseSubtotal).toBe(180);
    expect(result.total).toBe(1180);
    // A case price applied to the remainder would have billed ₹1,000 + ₹1,000.
    expect(result.total).not.toBe(2000);
  });

  it('picks the loose tier from the REMAINDER, not from the total quantity', () => {
    // 92 pcs → remainder 12 → the 7–12 slab at ₹28 (12 pcs inside 1–39 slabs
    // would have matched nothing on a total-quantity reading).
    const ninetyTwo = price(92);
    expect(ninetyTwo.looseUnitPrice).toBe(28);
    expect(ninetyTwo.total).toBe(2336);

    // 85 pcs → remainder 5 → the 1–6 slab at ₹30, not ₹26 and not ₹25 derived.
    expect(price(85).looseUnitPrice).toBe(30);
    expect(price(85).total).toBe(2150);

    // 48 pcs → remainder 8 → ₹28, giving ₹1,224 (not 48 × ₹25.50).
    expect(price(48).looseUnitPrice).toBe(28);
    expect(price(48).total).toBe(1224);
  });

  it('scales to many cases with the same two-system arithmetic', () => {
    expect(price(120).total).toBe(3000); // 3 cases
    expect(price(126).total).toBe(3180); // 3 cases + 6 @ 30
    expect(price(1000).total).toBe(25000); // 25 cases exactly
    expect(price(1000).fullCases).toBe(25);
  });
});

describe('case + loose engine: the EXACT 80-piece configuration from the requirement', () => {
  //   units/case   80 pcs
  //   case price   ₹1,000 (GST-inclusive)
  //   loose tiers  1–6 → ₹30   ·   7–12 → ₹28   ·   13–20 → ₹27   ·   21–79 → ₹26
  const UNITS = 80;
  const CASE = 1000;
  const TIERS: PricingTier[] = [
    { id: 'e1', min_quantity: 1, max_quantity: 7, price_per_piece: 30, rule_type: 'loose' },
    { id: 'e2', min_quantity: 7, max_quantity: 13, price_per_piece: 28, rule_type: 'loose' },
    { id: 'e3', min_quantity: 13, max_quantity: 21, price_per_piece: 27, rule_type: 'loose' },
    { id: 'e4', min_quantity: 21, max_quantity: 80, price_per_piece: 26, rule_type: 'loose' },
  ];
  const exact = (quantity: number) =>
    calculateCaseLoosePrice({
      quantity,
      unitsPerCase: UNITS,
      casePrice: CASE,
      tiers: TIERS,
      gstPercent: 0,
    });

  it('prices 6 / 12 / 20 / 80 / 92 / 160 pcs exactly as mandated', () => {
    const expected: [number, number, number, number][] = [
      // [qty, total, fullCases, looseQty]
      [6, 180, 0, 6],
      [12, 336, 0, 12],
      [20, 540, 0, 20],
      [80, 1000, 1, 0],
      [92, 1336, 1, 12],
      [160, 2000, 2, 0],
    ];
    for (const [quantity, total, fullCases, looseQuantity] of expected) {
      const result = exact(quantity);
      expect({ q: quantity, total: result.total, cases: result.fullCases, loose: result.looseQuantity }).toEqual({
        q: quantity,
        total,
        cases: fullCases,
        loose: looseQuantity,
      });
      expect(result.orderable).toBe(true);
      expect(result.caseSubtotal + result.looseSubtotal).toBe(result.total);
    }
  });

  it('bills 12 pcs at the 7–12 loose rate — never 12/80 × ₹1000 and never the case price', () => {
    const twelve = exact(12);
    expect(twelve.looseUnitPrice).toBe(28);
    expect(twelve.loosePriceSource).toBe('tier');
    expect(twelve.caseSubtotal).toBe(0);
    expect(twelve.total).toBe(12 * 28);
    // The forbidden prorated quote (₹150) and the case price as piece price
    // (₹12,000) must both be impossible by construction.
    expect(twelve.total).not.toBe((12 / UNITS) * CASE);
    expect(twelve.total).not.toBe(12 * CASE);
  });

  it('splits 92 pcs into 1 case + 12 loose and bills each side at its own rate', () => {
    const ninetyTwo = exact(92);
    expect(ninetyTwo.fullCases).toBe(1);
    expect(ninetyTwo.looseQuantity).toBe(12);
    expect(ninetyTwo.caseSubtotal).toBe(1000);
    expect(ninetyTwo.looseSubtotal).toBe(336);
    expect(ninetyTwo.total).toBe(1336);
    // A full case is never repriced at the last loose slab (₹26 × 80 = ₹2,080).
    expect(ninetyTwo.total).not.toBe(1000 + 80 * 26);
  });

  it('keeps 160 pcs at exactly two case prices — the retailer buys cases, not 160 loose pieces', () => {
    const result = exact(160);
    expect(result.fullCases).toBe(2);
    expect(result.looseQuantity).toBe(0);
    expect(result.total).toBe(2000);
    expect(result.total).not.toBe(160 * 26);
  });
});

describe('case + loose engine: boundary and edge cases', () => {
  it('handles Q < case, Q = case and Q = multiple of case', () => {
    expect(price(39).looseQuantity).toBe(39);
    expect(price(39).fullCases).toBe(0);
    expect(price(40).looseQuantity).toBe(0);
    expect(price(41).looseQuantity).toBe(1);
    expect(price(79).fullCases).toBe(1);
    expect(price(79).looseQuantity).toBe(39);
    expect(price(80).fullCases).toBe(2);
    expect(price(80).looseQuantity).toBe(0);
    expect(price(81).fullCases).toBe(2);
    expect(price(81).looseQuantity).toBe(1);
  });

  it('reports the Cases/Loose split the retailer must see', () => {
    for (const [quantity, cases, loose] of [
      [6, 0, 6],
      [40, 1, 0],
      [46, 1, 6],
      [80, 2, 0],
      [85, 2, 5],
    ] as const) {
      const result = price(quantity);
      expect(result.fullCases).toBe(cases);
      expect(result.looseQuantity).toBe(loose);
      expect(describeCaseLooseLine(result, formatInr).summary).toBe(`Cases: ${cases} · Loose: ${loose}`);
    }
  });

  it('rejects a zero, negative or fractional quantity instead of pricing ₹0', () => {
    expect(price(0).orderable).toBe(false);
    expect(price(0).total).toBe(0);
    expect(price(-5).orderable).toBe(false);
    expect(price(12.5).orderable).toBe(false);
    expect(price(12.5).message).toMatch(/whole number/i);
  });

  it('rejects an invalid case size rather than inventing one', () => {
    for (const unitsPerCase of [0, -4, 1.5, Number.NaN]) {
      const result = calculateCaseLoosePrice({ quantity: 6, unitsPerCase, casePrice: CASE_PRICE, tiers: LOOSE_TIERS });
      expect(result.orderable).toBe(false);
      expect(result.total).toBe(0);
      expect(result.message).toMatch(/case size/i);
    }
    // A 1-piece case has no loose domain: every quantity is a whole case.
    const single = calculateCaseLoosePrice({ quantity: 3, unitsPerCase: 1, casePrice: 250, tiers: LOOSE_TIERS });
    expect(single.fullCases).toBe(3);
    expect(single.total).toBe(750);
    expect(single.looseQuantity).toBe(0);
  });

  it('caps a line at the platform-wide 100000 piece limit', () => {
    expect(price(100000).orderable).toBe(true);
    expect(price(100001).orderable).toBe(false);
    expect(price(100001).message).toMatch(/100000/);
  });
});

describe('case + loose engine: missing tier / gaps / legacy packs', () => {
  it('blocks an orderable-but-unpriced loose quantity instead of guessing a price', () => {
    // Tiers deliberately cover 1–12 and 21–39 only; 13–20 is a gap.
    const partial: PricingTier[] = [
      { min_quantity: 1, max_quantity: 13, price_per_piece: 30, rule_type: 'loose' },
      { min_quantity: 21, max_quantity: 40, price_per_piece: 26, rule_type: 'loose' },
    ];
    const insideGap = calculateCaseLoosePrice({
      quantity: 53, // 1 case + 13 loose → 13 sits in the 13–20 gap
      unitsPerCase: 40,
      casePrice: CASE_PRICE,
      tiers: partial,
    });
    expect(insideGap.orderable).toBe(false);
    expect(insideGap.loosePriceSource).toBe('gap');
    expect(insideGap.looseUnitPrice).toBeNull();
    expect(insideGap.total).toBe(0);
    expect(insideGap.message).toMatch(/not priced/i);
    expect(insideGap.message).toMatch(/1–12, 21–39/);

    // The same pack still prices a covered remainder and any full case.
    expect(
      calculateCaseLoosePrice({ quantity: 46, unitsPerCase: 40, casePrice: CASE_PRICE, tiers: partial }).total
    ).toBe(1180);
    expect(
      calculateCaseLoosePrice({ quantity: 80, unitsPerCase: 40, casePrice: CASE_PRICE, tiers: partial }).total
    ).toBe(2000);
  });

  it('falls back to the derived case piece price only when the pack has no loose slabs at all', () => {
    // Migration 0022-style legacy pack: a single derived 'default' tier.
    const legacyDefault: PricingTier[] = [
      { min_quantity: 1, max_quantity: 40, price_per_piece: 25, rule_type: 'default' },
    ];
    const withDefault = calculateCaseLoosePrice({
      quantity: 46,
      unitsPerCase: 40,
      casePrice: CASE_PRICE,
      tiers: legacyDefault,
    });
    expect(withDefault.total).toBe(1150); // 1000 + 6 × 25
    expect(withDefault.loosePriceSource).toBe('tier');

    const noTiers = calculateCaseLoosePrice({ quantity: 46, unitsPerCase: 40, casePrice: CASE_PRICE, tiers: [] });
    expect(noTiers.total).toBe(1150);
    expect(noTiers.loosePriceSource).toBe('derived');
    expect(noTiers.orderable).toBe(true);
  });

  it('never lets a legacy bulk slab reprice a full case', () => {
    // A pre-existing 24+ pcs bulk slab must NOT turn 2 cases into 2 × 40 × ₹70.
    const legacyBulk: PricingTier[] = [
      { min_quantity: 1, max_quantity: 40, price_per_piece: 75, rule_type: 'default' },
      { min_quantity: 24, max_quantity: null, price_per_piece: 70, rule_type: 'bulk' },
    ];
    const twoCases = calculateCaseLoosePrice({
      quantity: 80,
      unitsPerCase: 40,
      casePrice: 2400,
      tiers: legacyBulk,
    });
    expect(twoCases.total).toBe(4800); // 2 × case price, exactly
    const oneCasePlus25 = calculateCaseLoosePrice({
      quantity: 65,
      unitsPerCase: 40,
      casePrice: 2400,
      tiers: legacyBulk,
    });
    // The 25-piece remainder is priced by the deepest slab that covers 25 pcs.
    expect(oneCasePlus25.looseUnitPrice).toBe(70);
    expect(oneCasePlus25.total).toBe(2400 + 25 * 70);
  });

  it('reports coverage gaps for the admin screen and calls a full set complete', () => {
    expect(findLooseCoverageGaps(LOOSE_TIERS, UNITS_PER_CASE)).toEqual([]);
    expect(isLooseConfigurationComplete(LOOSE_TIERS, UNITS_PER_CASE)).toBe(true);

    expect(findLooseCoverageGaps([LOOSE_TIERS[0]!, LOOSE_TIERS[3]!], UNITS_PER_CASE)).toEqual([
      { min: 7, max: 20 },
    ]);
    expect(isLooseConfigurationComplete([LOOSE_TIERS[0]!], UNITS_PER_CASE)).toBe(false);
    expect(findLooseCoverageGaps([], UNITS_PER_CASE)).toEqual([{ min: 1, max: 39 }]);
    // A 1-piece case has no loose domain at all, so nothing is ever "missing".
    expect(findLooseCoverageGaps(LOOSE_TIERS, 1)).toEqual([]);
    expect(maxLooseQuantity(40)).toBe(39);
    expect(maxLooseQuantity(1)).toBe(0);
  });

  it('ignores inactive tiers and slabs that start at a full case', () => {
    const resolved = resolveLooseTierSet(
      [
        { min_quantity: 1, max_quantity: 7, price_per_piece: 30, rule_type: 'loose', is_active: false },
        { min_quantity: 8, max_quantity: 40, price_per_piece: 26, rule_type: 'loose' },
        { min_quantity: 40, max_quantity: null, price_per_piece: 20, rule_type: 'loose' },
      ],
      UNITS_PER_CASE
    );
    expect(resolved.tiers.map((tier) => tier.min_quantity)).toEqual([8]);
    expect(
      calculateCaseLoosePrice({
        quantity: 68, // 1 case + 28 loose → covered by the active 8–39 slab
        unitsPerCase: 40,
        casePrice: CASE_PRICE,
        tiers: resolved.tiers,
      }).total
    ).toBe(1000 + 28 * 26);
  });
});

describe('case + loose engine: variants carry their own configuration', () => {
  const VARIANTS = {
    '50g': { unitsPerCase: 40, casePrice: 1000 },
    '100g': { unitsPerCase: 24, casePrice: 900 },
    '200g': { unitsPerCase: 12, casePrice: 1000 },
  } as const;

  const variantTiers = (unitsPerCase: number, prices: [number, number, number][]): PricingTier[] =>
    prices.map(([min, maxInclusive, pricePerPiece]) =>
      looseTierDraftToRow({ minQty: min, maxQty: maxInclusive, pricePerPiece }, unitsPerCase)
    );

  it('prices the same 10 pcs differently per variant, from that variant only', () => {
    const fifty = calculateCaseLoosePrice({
      quantity: 10,
      unitsPerCase: VARIANTS['50g'].unitsPerCase,
      casePrice: VARIANTS['50g'].casePrice,
      tiers: LOOSE_TIERS,
    });
    const hundred = calculateCaseLoosePrice({
      quantity: 10,
      unitsPerCase: VARIANTS['100g'].unitsPerCase,
      casePrice: VARIANTS['100g'].casePrice,
      tiers: variantTiers(24, [
        [1, 6, 42],
        [7, 12, 40],
        [13, 23, 38],
      ]),
    });
    const twoHundred = calculateCaseLoosePrice({
      quantity: 10,
      unitsPerCase: VARIANTS['200g'].unitsPerCase,
      casePrice: VARIANTS['200g'].casePrice,
      tiers: variantTiers(12, [
        [1, 4, 95],
        [5, 11, 90],
      ]),
    });

    expect(fifty.total).toBe(280); // 10 × ₹28
    expect(hundred.total).toBe(400); // 10 × ₹40
    expect(twoHundred.total).toBe(900); // 10 × ₹90
    expect(fifty.looseTiers.length).toBe(4);
    expect(twoHundred.looseTiers.length).toBe(2);
  });

  it('keeps case arithmetic per variant (100g: 24 pcs/case, ₹900)', () => {
    const tiers = variantTiers(24, [
      [1, 6, 42],
      [7, 12, 40],
      [13, 23, 38],
    ]);
    const result = calculateCaseLoosePrice({ quantity: 48, unitsPerCase: 24, casePrice: 900, tiers });
    expect(result.fullCases).toBe(2);
    expect(result.total).toBe(1800);
    const mixed = calculateCaseLoosePrice({ quantity: 30, unitsPerCase: 24, casePrice: 900, tiers });
    expect(mixed.total).toBe(900 + 6 * 42);
  });
});

describe('case + loose engine: GST stays inclusive and reconciliation is exact', () => {
  it('extracts GST from the inclusive line total and never adds it', () => {
    for (const gstPercent of [0, 5, 12, 18, 28]) {
      for (const quantity of [1, 6, 12, 39, 40, 46, 48, 80, 85, 92, 125]) {
        const result = price(quantity, { gstPercent });
        expect(result.gst).toBe(round2((result.total * gstPercent) / (100 + gstPercent)));
        expect(result.gst).toBe(gstComponentFromInclusive(result.total, gstPercent));
        expect(result.subtotal + result.gst).toBe(result.total);
        // The GST rate never changes what the retailer was quoted.
        expect(result.total).toBe(price(quantity).total);
      }
    }
  });

  it('adds case and loose money exactly, with no float drift, for a large sweep', () => {
    for (let quantity = 1; quantity <= 400; quantity += 1) {
      const result = price(quantity, { gstPercent: 5 });
      expect(toPaise(result.caseSubtotal) + toPaise(result.looseSubtotal)).toBe(toPaise(result.total));
      expect(toPaise(result.total) - toPaise(result.gst)).toBe(toPaise(result.subtotal));
      expect(result.total).toBe(
        result.fullCases * CASE_PRICE + result.looseQuantity * (result.looseUnitPrice ?? 0)
      );
    }
    expect(fromPaise(118000)).toBe(1180);
    expect(toPaise(25.65)).toBe(2565);
  });
});

describe('case + loose engine: MOQ and full-case-only packs', () => {
  it('evaluates MOQ against the piece quantity, not the case size', () => {
    expect(price(6, { moq: 1 }).orderable).toBe(true);
    expect(price(6, { moq: 6 }).orderable).toBe(true);
    expect(price(5, { moq: 6 }).orderable).toBe(false);
    expect(price(5, { moq: 6 }).message).toBe('Minimum order quantity for this pack is 6 pcs.');
    expect(price(10, { moq: 6 }).orderable).toBe(true);
    expect(price(20, { moq: 6 }).orderable).toBe(true);
    expect(price(40, { moq: 6 }).orderable).toBe(true);
    // MOQ never forces a case: 41 pcs is fine with MOQ 6.
    expect(price(41, { moq: 6 }).orderable).toBe(true);
  });

  it('enforces full-case-only packs explicitly instead of silently repricing', () => {
    const looseForbidden = calculateCaseLoosePrice({
      quantity: 46,
      unitsPerCase: UNITS_PER_CASE,
      casePrice: CASE_PRICE,
      tiers: LOOSE_TIERS,
      allowLoosePieces: false,
    });
    expect(looseForbidden.orderable).toBe(false);
    expect(looseForbidden.total).toBe(0);
    expect(looseForbidden.message).toMatch(/full cases of 40 pcs only/);
    expect(looseForbidden.message).toMatch(/40 or 80/);

    const wholeCases = calculateCaseLoosePrice({
      quantity: 80,
      unitsPerCase: UNITS_PER_CASE,
      casePrice: CASE_PRICE,
      tiers: LOOSE_TIERS,
      allowLoosePieces: false,
    });
    expect(wholeCases.orderable).toBe(true);
    expect(wholeCases.total).toBe(2000);
  });
});

describe('case + loose engine: admin tier validation and conversion', () => {
  const validDrafts = [
    { minQty: 1, maxQty: 6, pricePerPiece: 30 },
    { minQty: 7, maxQty: 12, pricePerPiece: 28 },
    { minQty: 13, maxQty: 20, pricePerPiece: 27 },
    { minQty: 21, maxQty: 39, pricePerPiece: 26 },
  ];

  it('accepts the reference configuration', () => {
    expect(validateLooseTierSet(validDrafts, 40)).toEqual([]);
  });

  it('rejects overlapping and duplicated ranges', () => {
    expect(
      validateLooseTierSet(
        [
          { minQty: 1, maxQty: 10, pricePerPiece: 30 },
          { minQty: 7, maxQty: 12, pricePerPiece: 28 },
        ],
        40
      ).join(' ')
    ).toMatch(/Overlapping ranges: 1–10 pcs and 7–12 pcs/);

    expect(
      validateLooseTierSet(
        [
          { minQty: 1, maxQty: 6, pricePerPiece: 30 },
          { minQty: 1, maxQty: 6, pricePerPiece: 29 },
        ],
        40
      ).join(' ')
    ).toMatch(/listed twice/);
  });

  it('rejects min > max, zero/negative prices and bad quantities', () => {
    expect(validateLooseTierSet([{ minQty: 10, maxQty: 5, pricePerPiece: 30 }], 40).join(' ')).toMatch(
      /cannot be lower than the minimum/
    );
    expect(validateLooseTierSet([{ minQty: 1, maxQty: 6, pricePerPiece: 0 }], 40).join(' ')).toMatch(
      /must be more than zero/
    );
    expect(validateLooseTierSet([{ minQty: 1, maxQty: 6, pricePerPiece: -5 }], 40).join(' ')).toMatch(
      /must be more than zero/
    );
    expect(validateLooseTierSet([{ minQty: 0, maxQty: 6, pricePerPiece: 30 }], 40).join(' ')).toMatch(
      /at least 1/
    );
    expect(validateLooseTierSet([{ minQty: -3, maxQty: 6, pricePerPiece: 30 }], 40).join(' ')).toMatch(/at least 1/);
    expect(validateLooseTierSet([{ minQty: 1.5, maxQty: 6, pricePerPiece: 30 }], 40).join(' ')).toMatch(/whole number/);
  });

  it('rejects a loose tier that reaches into full-case territory', () => {
    // 40 pcs IS a full case, so a loose slab must stop at 39.
    expect(validateLooseTierSet([{ minQty: 21, maxQty: 40, pricePerPiece: 26 }], 40).join(' ')).toMatch(
      /cannot reach 40 pcs/
    );
    expect(validateLooseTierSet([{ minQty: 41, maxQty: 45, pricePerPiece: 26 }], 40).join(' ')).toMatch(
      /must start at 39 pcs or below/
    );
    expect(validateLooseTierSet([{ minQty: 1, maxQty: 39, pricePerPiece: 30 }], 1).join(' ')).toMatch(
      /1 piece per case/
    );
    // An open-ended max is clamped to the loose ceiling, so it stays legal.
    expect(validateLooseTierSet([{ minQty: 21, maxQty: null, pricePerPiece: 26 }], 40)).toEqual([]);
  });

  it('round-trips inclusive admin ranges to stored half-open rows', () => {
    const stored = validDrafts.map((draft) => looseTierDraftToRow(draft, 40));
    expect(stored.map((tier) => [tier.min_quantity, tier.max_quantity])).toEqual([
      [1, 7],
      [7, 13],
      [13, 21],
      [21, 40],
    ]);
    expect(stored.every((tier) => tier.rule_type === 'loose')).toBe(true);
    expect(stored.map((tier) => tierRangeLabel(tier.min_quantity, tier.max_quantity))).toEqual([
      '1–6 pcs',
      '7–12 pcs',
      '13–20 pcs',
      '21–39 pcs',
    ]);
    expect(stored.map((tier) => inclusiveMaxQuantity(tier.max_quantity, 40))).toEqual([6, 12, 20, 39]);
    // The stored rows price exactly what the admin typed.
    const priced = calculateCaseLoosePrice({
      quantity: 25,
      unitsPerCase: 40,
      casePrice: 1000,
      tiers: stored,
    });
    expect(priced.looseUnitPrice).toBe(26);
    expect(priced.total).toBe(650);
    // An open max is clamped to the last piece before a case.
    expect(looseTierDraftToRow({ minQty: 21, maxQty: null, pricePerPiece: 26 }, 40).max_quantity).toBe(40);
    expect(formatLooseRanges(stored, 40)).toBe('1–6, 7–12, 13–20, 21–39');
  });
});

describe('case + loose engine: smart quantity suggestions', () => {
  it('suggests useful quantities without restricting the retailer', () => {
    const suggestions = suggestedQuantities({ unitsPerCase: 40, moq: 1, tiers: LOOSE_TIERS });
    expect(suggestions).toContain(1);
    expect(suggestions).toContain(39);
    expect(suggestions).toContain(40);
    expect(suggestions).toContain(80);
    expect(suggestions).toEqual([...suggestions].sort((a, b) => a - b));
    expect(new Set(suggestions).size).toBe(suggestions.length);
    // Every suggestion is orderable.
    for (const quantity of suggestions) expect(price(quantity, { moq: 1 }).orderable).toBe(true);
  });

  it('never suggests a quantity below MOQ and respects case-only packs', () => {
    expect(suggestedQuantities({ unitsPerCase: 40, moq: 25, tiers: LOOSE_TIERS })).toEqual([25, 39, 40, 80]);
    expect(suggestedQuantities({ unitsPerCase: 12, moq: 1, allowLoosePieces: false })).toEqual([12, 24]);
  });

  it('renders the retailer-facing breakdown exactly as the requirement asks', () => {
    const labels = describeCaseLooseLine(price(46), formatInr);
    expect(labels.casePart).toBe('1 Case × ₹1,000.00');
    expect(labels.loosePart).toBe('6 pcs × ₹30.00');
    expect(labels.quantity).toBe('1 Case + 6 loose pcs · 46 pcs');

    const casesOnly = describeCaseLooseLine(price(80), formatInr);
    expect(casesOnly.loosePart).toBeNull();
    expect(casesOnly.quantity).toBe('2 Cases · 80 pcs');

    const looseOnly = describeCaseLooseLine(price(6), formatInr);
    expect(looseOnly.casePart).toBe('₹0.00');
    expect(looseOnly.quantity).toBe('6 pcs');
  });
});
