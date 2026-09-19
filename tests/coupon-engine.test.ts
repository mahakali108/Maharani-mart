import { describe, expect, it } from 'vitest';
import {
  computeCouponDiscount,
  describeDiscountValue,
  eligibleSubtotalForCoupon,
  lineEligibleForCoupon,
  normalizeCouponCode,
} from '@/lib/coupons/engine';
import type { CouponRow } from '@/lib/coupons/types';

const PRODUCT = '33333333-3333-4333-8333-333333333333';
const CATEGORY = '66666666-6666-4666-8666-666666666666';
const BRAND = '77777777-7777-4777-8777-777777777777';

function coupon(overrides: Partial<CouponRow> = {}): CouponRow {
  return {
    id: 'coupon-1',
    code: 'SAVE10',
    title: 'Test coupon',
    description: null,
    discount_type: 'percentage',
    discount_value: 10,
    minimum_order_value: 0,
    maximum_discount: null,
    usage_limit: null,
    per_retailer_limit: 1,
    used_count: 0,
    starts_at: '2026-01-01T00:00:00Z',
    expires_at: '2027-01-01T00:00:00Z',
    is_active: true,
    first_order_only: false,
    retailer_id: null,
    category_id: null,
    brand_id: null,
    product_id: null,
    ...overrides,
  };
}

const lines = [
  { productId: 'a', categoryId: CATEGORY, brandId: BRAND, subtotal: 200 },
  { productId: 'b', categoryId: null, brandId: 'other-brand', subtotal: 300 },
];

describe('normalizeCouponCode', () => {
  it('uppercases and trims, matching database normalization', () => {
    expect(normalizeCouponCode(' save10 ')).toBe('SAVE10');
    expect(normalizeCouponCode('SAVE10')).toBe('SAVE10');
    expect(normalizeCouponCode('')).toBe('');
    expect(normalizeCouponCode(null)).toBe('');
    expect(normalizeCouponCode(undefined)).toBe('');
  });
});

describe('lineEligibleForCoupon', () => {
  it('accepts every line when the coupon is unscoped', () => {
    const c = coupon();
    expect(lines.every((line) => lineEligibleForCoupon(c, line))).toBe(true);
  });

  it('matches on category, brand and product scoping', () => {
    expect(lineEligibleForCoupon(coupon({ category_id: CATEGORY }), lines[0]!)).toBe(true);
    expect(lineEligibleForCoupon(coupon({ category_id: CATEGORY }), lines[1]!)).toBe(false);
    expect(lineEligibleForCoupon(coupon({ brand_id: BRAND }), lines[0]!)).toBe(true);
    expect(lineEligibleForCoupon(coupon({ brand_id: BRAND }), lines[1]!)).toBe(false);
    expect(lineEligibleForCoupon(coupon({ product_id: 'b' }), lines[0]!)).toBe(false);
    expect(lineEligibleForCoupon(coupon({ product_id: 'b' }), lines[1]!)).toBe(true);
  });

  it('ANDs multiple scopes together', () => {
    const both = coupon({ category_id: CATEGORY, brand_id: BRAND });
    expect(lineEligibleForCoupon(both, lines[0]!)).toBe(true);
    expect(lineEligibleForCoupon(both, lines[1]!)).toBe(false);
  });
});

describe('eligibleSubtotalForCoupon', () => {
  it('sums only the qualifying lines', () => {
    expect(eligibleSubtotalForCoupon(coupon({ brand_id: BRAND }), lines)).toBe(200);
    expect(eligibleSubtotalForCoupon(coupon(), lines)).toBe(500);
  });
});

describe('computeCouponDiscount', () => {
  it('computes a percentage discount on the eligible value', () => {
    expect(computeCouponDiscount(coupon({ discount_value: 10 }), 250)).toBe(25);
  });

  it('caps a percentage discount at maximum_discount', () => {
    expect(computeCouponDiscount(coupon({ discount_value: 10, maximum_discount: 500 }), 25000)).toBe(500);
    expect(computeCouponDiscount(coupon({ discount_value: 10, maximum_discount: 500 }), 3000)).toBe(300);
  });

  it('applies a fixed amount', () => {
    expect(computeCouponDiscount(coupon({ discount_type: 'fixed', discount_value: 500 }), 2500)).toBe(500);
  });

  it('never discounts a line set below zero', () => {
    expect(computeCouponDiscount(coupon({ discount_type: 'fixed', discount_value: 500 }), 300)).toBe(300);
  });

  it('returns zero when nothing is eligible', () => {
    expect(computeCouponDiscount(coupon(), 0)).toBe(0);
  });

  it('rounds to clean rupee amounts', () => {
    // 10% of 333.33 = 33.333 -> 33.33
    expect(computeCouponDiscount(coupon({ discount_value: 10 }), 333.33)).toBe(33.33);
  });
});

describe('describeDiscountValue', () => {
  it('labels percentage and fixed coupons', () => {
    expect(describeDiscountValue(coupon())).toBe('10% off');
    expect(describeDiscountValue(coupon({ discount_type: 'fixed', discount_value: 500 }))).toBe('₹500.00 off');
  });
});
