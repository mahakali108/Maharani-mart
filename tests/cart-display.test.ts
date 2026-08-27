import { describe, expect, it } from 'vitest';
import {
  calcDiscountPercent,
  calcRetailerMargin,
  calcSavings,
  determineBestValueTier,
  formatInr,
  formatMargin,
  resolveUnitPrice,
} from '@/lib/retailer/format';

/**
 * Display rules for the retailer cart and multi-price product detail.
 * These helpers are shared across catalog, product detail, and cart —
 * the tests pin down the "never invent savings/margin" guarantee
 * and verify best-value tier resolution.
 */
describe('cart display helpers', () => {
  it('formats rupee values in Indian grouping with two decimals', () => {
    expect(formatInr(0)).toBe('₹0.00');
    expect(formatInr(115)).toBe('₹115.00');
    expect(formatInr(184115)).toBe('₹1,84,115.00');
  });

  it('only reports savings when MRP is above the effective price', () => {
    expect(calcSavings(120, 115, 10)).toBe(50);
    expect(calcSavings(120, 115, 0)).toBe(0); // zero quantity -> no savings
    expect(calcSavings(120, 120, 10)).toBe(0); // MRP == price -> no invented savings
    expect(calcSavings(null, 115, 10)).toBe(0); // no MRP -> no savings
    expect(calcSavings(120, 130, 10)).toBe(0); // price above MRP -> no savings
  });

  it('computes honest discount percentages only when a discount exists', () => {
    expect(calcDiscountPercent(120, 115)).toBe(4);
    expect(calcDiscountPercent(120, 120)).toBe(0);
    expect(calcDiscountPercent(null, 115)).toBe(0);
    expect(calcDiscountPercent(120, null)).toBe(0);
  });

  it('computes retailer margin accurately and never invents a margin percentage', () => {
    // Example from Maharani Traders specification:
    // MRP ₹150, Pack of 2 @ ₹120.87 -> 19.42% margin
    expect(calcRetailerMargin(150, 120.87)).toBe(19.42);
    // MRP ₹150, Pack of 4 @ ₹118.50 -> 21.00% margin
    expect(calcRetailerMargin(150, 118.50)).toBe(21.0);
    expect(formatMargin(calcRetailerMargin(150, 120.87))).toBe('19.42%');
    expect(formatMargin(calcRetailerMargin(150, 118.50))).toBe('21.00%');

    // Edge cases: No invented margin
    expect(calcRetailerMargin(null, 120.87)).toBeNull();
    expect(calcRetailerMargin(150, null)).toBeNull();
    expect(calcRetailerMargin(120, 120)).toBeNull(); // MRP == price -> no margin
    expect(calcRetailerMargin(100, 120)).toBeNull(); // price > MRP -> no margin
    expect(formatMargin(null)).toBeNull();
  });

  it('resolves price per unit correctly across single-pack and multi-pack items', () => {
    // Single unit pack (units_per_case = 1)
    expect(resolveUnitPrice(120.87, 1)).toBe(120.87);
    // Multi-unit pack (units_per_case = 2, total pack price 241.74)
    expect(resolveUnitPrice(241.74, 2)).toBe(120.87);
    // Multi-unit pack (units_per_case = 4, total pack price 474.00)
    expect(resolveUnitPrice(474.00, 4)).toBe(118.50);
  });

  it('identifies best-value tier only when comparison data is authoritative', () => {
    const packs = [
      { id: 'p1', unitPrice: 120.87, pack_name: 'Pack of 2' },
      { id: 'p2', unitPrice: 118.50, pack_name: 'Pack of 4' },
    ];
    const result = determineBestValueTier(packs);
    expect(result.bestPackId).toBe('p2');
    expect(result.savingsVsRef).toBe(2.37);
    expect(result.refPackName).toBe('Pack of 2');

    // Single pack -> no comparison possible, no invented recommendation
    expect(determineBestValueTier([packs[0]!])).toEqual({
      bestPackId: null,
      savingsVsRef: null,
      refPackName: null,
    });

    // Identical unit prices -> no best value tier
    const identicalPacks = [
      { id: 'p1', unitPrice: 100, pack_name: 'Pack A' },
      { id: 'p2', unitPrice: 100, pack_name: 'Pack B' },
    ];
    expect(determineBestValueTier(identicalPacks)).toEqual({
      bestPackId: null,
      savingsVsRef: null,
      refPackName: null,
    });
  });
});
