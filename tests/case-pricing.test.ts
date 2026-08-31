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

  it('recognises 24 pcs = 2 cases and 36 pcs = 3 cases', () => {
    const twoCases = caseLineBreakdown({ ...FACE_WASH, tiers: [], packQuantity: 2 });
    expect(twoCases.pieces).toBe(24);
    expect(twoCases.total).toBe(1800);

    const threeCases = caseLineBreakdown({ ...FACE_WASH, tiers: [], packQuantity: 3 });
    expect(threeCases.pieces).toBe(36);
    expect(threeCases.total).toBe(2700);
  });

  it('applies the Super Admin quantity tier automatically', () => {
    const tiers: PricingTier[] = [
      { min_quantity: 1, max_quantity: 12, price_per_piece: 75, rule_type: 'default' },
      { min_quantity: 12, max_quantity: null, price_per_piece: 75, rule_type: 'case' },
      { min_quantity: 24, max_quantity: 36, price_per_piece: 70, rule_type: 'bulk' }, // 2 cases bulk
      { min_quantity: 36, max_quantity: null, price_per_piece: 68, rule_type: 'bulk' }, // 3+ cases bulk
    ];

    // 1 case (12 pcs) → case price tier
    const oneCase = caseLineBreakdown({ ...FACE_WASH, tiers, packQuantity: 1 });
    expect(oneCase.total).toBe(900);

    // 2 cases (24 pcs) → bulk tier at ₹70/pc
    const twoCases = caseLineBreakdown({ ...FACE_WASH, tiers, packQuantity: 2 });
    expect(twoCases.piecePrice).toBe(70);
    expect(twoCases.total).toBe(1680);

    // 3 cases (36 pcs) → deepest bulk tier at ₹68/pc
    const threeCases = caseLineBreakdown({ ...FACE_WASH, tiers, packQuantity: 3 });
    expect(threeCases.piecePrice).toBe(68);
    expect(threeCases.total).toBe(2448);
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
