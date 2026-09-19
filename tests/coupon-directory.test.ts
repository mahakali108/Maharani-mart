import { describe, expect, it } from 'vitest';
import { classifyCoupon, couponScopeLabel, type RetailerCouponRow } from '@/lib/retailer/coupon-directory';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';
const NOW = new Date('2026-09-19T12:00:00Z');

function coupon(overrides: Partial<RetailerCouponRow> = {}): RetailerCouponRow {
  return {
    id: 'coupon-1',
    code: 'SAVE10',
    title: 'Save 10%',
    description: null,
    discount_type: 'percentage',
    discount_value: 10,
    minimum_order_value: 0,
    maximum_discount: null,
    usage_limit: null,
    per_retailer_limit: 1,
    used_count: 0,
    starts_at: '2026-09-01T00:00:00Z',
    expires_at: '2026-12-01T00:00:00Z',
    first_order_only: false,
    retailer_id: null,
    category_id: null,
    brand_id: null,
    product_id: null,
    retailers: null,
    categories: null,
    brands: null,
    products: null,
    ...overrides,
  };
}

const input = (overrides: Partial<Parameters<typeof classifyCoupon>[1]> = {}) => ({
  retailerId: ME,
  now: NOW,
  orderCount: 1,
  redemptionsByCoupon: {},
  ...overrides,
});

describe('classifyCoupon', () => {
  it('classifies a live, applicable coupon as available with no block', () => {
    const result = classifyCoupon(coupon(), input())!;
    expect(result.section).toBe('available');
    expect(result.blockedReason).toBeNull();
  });

  it('hides customer-specific coupons that belong to another retailer', () => {
    expect(classifyCoupon(coupon({ retailer_id: OTHER }), input())).toBeNull();
    expect(classifyCoupon(coupon({ retailer_id: ME }), input())?.section).toBe('available');
  });

  it('sends scheduled coupons to "starting soon"', () => {
    const result = classifyCoupon(coupon({ starts_at: '2026-10-01T00:00:00Z' }), input())!;
    expect(result.section).toBe('starting_soon');
    expect(result.blockedReason).toMatch(/not started/);
  });

  it('sends coupons expired within 30 days to "recently expired"', () => {
    const result = classifyCoupon(coupon({ expires_at: '2026-09-01T00:00:00Z' }), input())!;
    expect(result.section).toBe('recently_expired');
    expect(result.blockedReason).toMatch(/expired/);
  });

  it('hides coupons expired beyond the 30-day tail', () => {
    expect(classifyCoupon(coupon({ expires_at: '2026-07-01T00:00:00Z' }), input())).toBeNull();
  });

  it('marks an exhausted global limit as visible but blocked', () => {
    const result = classifyCoupon(coupon({ usage_limit: 10, used_count: 10 }), input())!;
    expect(result.section).toBe('available');
    expect(result.blockedReason).toMatch(/uses.*gone/i);
  });

  it('marks the caller hitting their per-retailer limit as visible but blocked', () => {
    const result = classifyCoupon(
      coupon({ per_retailer_limit: 2, used_count: 5 }),
      input({ redemptionsByCoupon: { 'coupon-1': 2 } })
    )!;
    expect(result.blockedReason).toMatch(/limit is 2/);
  });

  it('allows the coupon again once another retailer used it (own count under limit)', () => {
    const result = classifyCoupon(
      coupon({ per_retailer_limit: 2, used_count: 5 }),
      input({ redemptionsByCoupon: { 'coupon-1': 1 } })
    )!;
    expect(result.blockedReason).toBeNull();
  });

  it('blocks first-order coupons for retailers with prior orders, allows with none', () => {
    const blocked = classifyCoupon(coupon({ first_order_only: true }), input({ orderCount: 3 }))!;
    expect(blocked.blockedReason).toMatch(/first order/);
    const allowed = classifyCoupon(coupon({ first_order_only: true }), input({ orderCount: 0 }))!;
    expect(allowed.blockedReason).toBeNull();
  });

  it('reports usedByMe from the caller redemption map', () => {
    const result = classifyCoupon(coupon({ per_retailer_limit: 3 }), input({ redemptionsByCoupon: { 'coupon-1': 2 } }))!;
    expect(result.usedByMe).toBe(2);
  });
});

describe('couponScopeLabel', () => {
  it('joins scopes and returns null for unscoped coupons', () => {
    expect(couponScopeLabel(coupon())).toBeNull();
    expect(
      couponScopeLabel(
        coupon({ categories: { name: 'Snacks' }, brands: { name: 'Mama' }, products: { name: 'Biscuit' } })
      )
    ).toBe('category: Snacks · brand: Mama · product: Biscuit');
  });
});
