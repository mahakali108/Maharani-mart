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

// Business example: Example Face Wash — MRP ₹100/pc, units/case 12,
// case selling price ₹900 (GST-inclusive), GST 5%.
const FACE_WASH = { casePrice: 900, unitsPerCase: 12, gstPercent: 5 };

describe('case-based pricing engine', () => {
  it('derives the per-piece price from the case price (never stored)', () => {
    expect(piecePriceFromCase(900, 12)).toBe(75);
    expect(piecePriceFromCase(900, 1)).toBe(900);
  });

  it('charges exactly the case price for one full case and never adds GST', () => {
    const line = caseLineBreakdown({ ...FACE_WASH, tiers: [], packQuantity: 1 });
    // 1 case = 12 pieces @ ₹75 → ₹900 (GST-inclusive total stays ₹900, not ₹945)
    expect(line.pieces).toBe(12);
    expect(line.piecePrice).toBe(75);
    expect(line.total).toBe(900);
    // GST extracted from the inclusive price: 900 * 5/105 = 42.86
    expect(line.gst).toBe(42.86);
    expect(line.subtotal).toBe(857.14);
    expect(line.total).toBe(900);
  });

  it('decomposes quantities into cases and loose pieces accurately', () => {
    // 15 pieces of a 12-unit pack = 1 case + 3 loose pieces
    const breakdown = caseLineBreakdown({
      ...FACE_WASH,
      tiers: [],
      pieceQuantity: 15,
    });
    expect(breakdown.pieces).toBe(15);
    expect(breakdown.cases).toBe(1);
    expect(breakdown.loosePieces).toBe(3);
    // 1 case @ 900 + 3 loose pcs @ 75 = 900 + 225 = 1125
    expect(breakdown.total).toBe(1125);
    expect(breakdown.subtotal + breakdown.gst).toBe(1125);
  });

  // Superseded by the 0026 business rule: a slab is selected by the LOOSE
  // REMAINDER, and a full case is never repriced from a loose-piece rate. The
  // previous expectation (15 pcs → 15 × ₹70 = ₹1,050) priced the case part at
  // the loose rate, which the rule now forbids.
  it('applies quantity slabs to the loose remainder, never to the case part', () => {
    const tiers: PricingTier[] = [
      { min_quantity: 1, max_quantity: 10, price_per_piece: 80, rule_type: 'bulk' },
      { min_quantity: 10, max_quantity: null, price_per_piece: 70, rule_type: 'bulk' },
    ];

    // 5 loose pieces -> [1, 10) @ 80/pc = 400 (no case involved)
    const smallLoose = caseLineBreakdown({
      casePrice: 900,
      unitsPerCase: 12,
      tiers,
      pieceQuantity: 5,
      gstPercent: 5,
    });
    expect(smallLoose.piecePrice).toBe(80);
    expect(smallLoose.total).toBe(400);

    // 15 pieces = 1 full case @ ₹900 + 3 loose pcs. The remainder is 3, which
    // belongs to the [1, 10) slab → ₹80, NOT the 15-piece slab and NOT the case.
    const mixed = caseLineBreakdown({
      casePrice: 900,
      unitsPerCase: 12,
      tiers,
      pieceQuantity: 15,
      gstPercent: 5,
    });
    expect(mixed.cases).toBe(1);
    expect(mixed.loosePieces).toBe(3);
    expect(mixed.piecePrice).toBe(80);
    expect(mixed.total).toBe(900 + 3 * 80);

    // 22 pieces = 1 case + 10 loose → the [10, ∞) slab prices the remainder.
    const bigRemainder = caseLineBreakdown({
      casePrice: 900,
      unitsPerCase: 12,
      tiers,
      pieceQuantity: 22,
      gstPercent: 5,
    });
    expect(bigRemainder.piecePrice).toBe(70);
    expect(bigRemainder.total).toBe(900 + 10 * 70);
  });

  it('guarantees full cases use the exact case price source of truth without rounding drift', () => {
    // Pack with casePrice ₹100 for 3 units (100/3 = 33.333...)
    const oddCase = caseLineBreakdown({
      casePrice: 100,
      unitsPerCase: 3,
      tiers: [],
      packQuantity: 1,
      gstPercent: 12,
    });
    expect(oddCase.pieces).toBe(3);
    expect(oddCase.cases).toBe(1);
    expect(oddCase.loosePieces).toBe(0);
    // Total for 1 case is exactly ₹100.00
    expect(oddCase.total).toBe(100);
  });

  // 0026 rule: a full case is ALWAYS case price. A slab authored at or above
  // the case size (the old "2 cases at ₹70/pc" idea) can no longer reprice the
  // case part — such a slab can only ever price a remainder, and a remainder of
  // a 12-piece pack never reaches 12. The admin editor now rejects it outright.
  it('keeps the case price authoritative for 1, 2 and 3 full cases', () => {
    const tiers: PricingTier[] = [
      { min_quantity: 1, max_quantity: 12, price_per_piece: 75, rule_type: 'default' },
      { min_quantity: 12, max_quantity: null, price_per_piece: 75, rule_type: 'case' },
      { min_quantity: 24, max_quantity: 36, price_per_piece: 70, rule_type: 'bulk' },
      { min_quantity: 36, max_quantity: null, price_per_piece: 68, rule_type: 'bulk' },
    ];

    for (const [packs, expected] of [[1, 900], [2, 1800], [3, 2700], [7, 6300]] as const) {
      const line = caseLineBreakdown({ ...FACE_WASH, tiers, packQuantity: packs });
      expect(line.cases).toBe(packs);
      expect(line.loosePieces).toBe(0);
      expect(line.total).toBe(expected);
      expect(line.piecePrice).toBe(75); // derived reference: 900 / 12
    }

    // A slab that starts beyond the case size is inert for remainders; the
    // below-case slab still prices them.
    const withLoose = caseLineBreakdown({ ...FACE_WASH, tiers, pieceQuantity: 14 });
    expect(withLoose.total).toBe(900 + 2 * 75);
  });

  it('prices an admin loose slab on the remainder only', () => {
    const tiers: PricingTier[] = [
      { min_quantity: 1, max_quantity: 4, price_per_piece: 85, rule_type: 'loose' },
      { min_quantity: 4, max_quantity: 12, price_per_piece: 78, rule_type: 'loose' },
    ];
    // 1 case + 3 pcs → 900 + 3 × 85
    expect(caseLineBreakdown({ ...FACE_WASH, tiers, pieceQuantity: 15 }).total).toBe(900 + 3 * 85);
    // 2 cases + 11 pcs → 1800 + 11 × 78
    expect(caseLineBreakdown({ ...FACE_WASH, tiers, pieceQuantity: 35 }).total).toBe(1800 + 11 * 78);
    // 3 full cases → exactly 3 × case price, loose slabs ignored
    expect(caseLineBreakdown({ ...FACE_WASH, tiers, pieceQuantity: 36 }).total).toBe(2700);
  });

  it('extracts the GST component without double-charging', () => {
    // ₹75 GST-inclusive @ 5% → GST component is 75 * 5/105 = 3.57
    expect(gstComponentFromInclusive(75, 5)).toBe(3.57);
    expect(gstComponentFromInclusive(900, 5)).toBe(42.86);
  });

  it('picks the highest-priority matching tier by largest min_quantity', () => {
    const tiers: PricingTier[] = [
      { min_quantity: 1, max_quantity: 12, price_per_piece: 75 },
      { min_quantity: 12, max_quantity: null, price_per_piece: 75 },
      { min_quantity: 24, max_quantity: null, price_per_piece: 70 },
    ];
    expect(pickApplicableTier(tiers, 5)?.min_quantity).toBe(1);
    expect(pickApplicableTier(tiers, 12)?.min_quantity).toBe(12);
    expect(pickApplicableTier(tiers, 24)?.min_quantity).toBe(24);
    expect(pickApplicableTier(tiers, 30)?.min_quantity).toBe(24);
  });

  it('rounds money predictably', () => {
    expect(round2(900 / 12)).toBe(75);
    expect(round2(10.005)).toBe(10.01);
  });
});

describe('pricing tier validation', () => {
  it('rejects overlapping quantity ranges', () => {
    const tiers: PricingTier[] = [
      { min_quantity: 1, max_quantity: 20, price_per_piece: 75 },
      { min_quantity: 15, max_quantity: 30, price_per_piece: 70 },
    ];
    expect(validateTiers(tiers)).toContain('overlap');
  });

  it('accepts non-overlapping half-open ranges', () => {
    const tiers: PricingTier[] = [
      { min_quantity: 1, max_quantity: 12, price_per_piece: 75 },
      { min_quantity: 12, max_quantity: 24, price_per_piece: 73 },
      { min_quantity: 24, max_quantity: null, price_per_piece: 70 },
    ];
    expect(validateTiers(tiers)).toBeNull();
  });

  it('rejects a negative price and an invalid max < min', () => {
    expect(validateTiers([{ min_quantity: 1, max_quantity: null, price_per_piece: -5 }])).toContain('negative');
    expect(validateTiers([{ min_quantity: 10, max_quantity: 5, price_per_piece: 70 }])).toContain('greater');
  });
});
