import { describe, expect, it } from 'vitest';
import { calcDiscountPercent, calcSavings, formatInr } from '@/lib/retailer/format';

/**
 * Display rules for the retailer cart. These helpers are shared by the cart
 * page, the cart item row and the checkout summary — the tests pin down the
 * "never invent savings" guarantee (savings exist only when the data provides
 * an MRP above the effective price) and the Indian-format currency output.
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
});
