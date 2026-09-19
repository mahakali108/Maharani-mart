import { describe, expect, it } from 'vitest';
import { validateCouponForOrder } from '@/lib/coupons/validate';
import { supabaseFixture } from './helpers/supabase-fixture';
import type { CouponRow } from '@/lib/coupons/types';

const RETAILER = '11111111-1111-4111-8111-111111111111';
const OTHER_RETAILER = '99999999-9999-4999-8999-999999999999';
const COUPON = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CATEGORY = '66666666-6666-4666-8666-666666666666';
const OTHER_CATEGORY = '66666666-6666-4666-8666-666666669999';
const BRAND = '77777777-7777-4777-8777-777777777777';
const PRODUCT_A = '33333333-3333-4333-8333-333333333333';
const PRODUCT_B = '33333333-3333-4333-8333-333333339999';
const NOW = new Date('2026-09-19T12:00:00Z');

function baseCoupon(overrides: Partial<CouponRow> = {}): CouponRow {
  return {
    id: COUPON,
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

const cart = [
  { productId: PRODUCT_A, categoryId: CATEGORY, brandId: BRAND, subtotal: 200 },
  { productId: PRODUCT_B, categoryId: OTHER_CATEGORY, brandId: 'other', subtotal: 300 },
];

function db(
  couponRow: CouponRow = baseCoupon(),
  orders: object[] = [],
  redemptions: object[] = []
) {
  return supabaseFixture({
    coupons: [couponRow],
    orders,
    coupon_redemptions: redemptions,
  }) as never;
}

describe('validateCouponForOrder — acceptance', () => {
  it('accepts a valid percentage coupon and computes the authoritative discount', async () => {
    const result = await validateCouponForOrder(db(), { retailerId: RETAILER, code: 'save10', lines: cart, now: NOW });
    expect(result.valid).toBe(true);
    if (result.valid) {
      // 10% of the 500 GST-exclusive cart = 50.
      expect(result.discount).toBe(50);
      expect(result.coupon.code).toBe('SAVE10');
    }
  });

  it('accepts a fixed-amount coupon', async () => {
    const result = await validateCouponForOrder(
      db(baseCoupon({ discount_type: 'fixed', discount_value: 500, code: 'SAVE500' })),
      { retailerId: RETAILER, code: 'SAVE500', lines: cart, now: NOW }
    );
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.discount).toBe(500);
  });

  it('caps a percentage discount at maximum_discount', async () => {
    const bigCart = [...cart, { productId: PRODUCT_A, categoryId: CATEGORY, brandId: BRAND, subtotal: 20000 }];
    const result = await validateCouponForOrder(
      db(baseCoupon({ maximum_discount: 750 })),
      { retailerId: RETAILER, code: 'SAVE10', lines: bigCart, now: NOW }
    );
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.discount).toBe(750);
  });

  it('normalizes case on lookup (save10 == SAVE10)', async () => {
    const result = await validateCouponForOrder(db(), { retailerId: RETAILER, code: '  SAVE10 ', lines: cart, now: NOW });
    expect(result.valid).toBe(true);
  });
});

describe('validateCouponForOrder — rejections', () => {
  it('rejects an unknown code', async () => {
    const result = await validateCouponForOrder(db(), { retailerId: RETAILER, code: 'NOPE', lines: cart, now: NOW });
    expect(result).toMatchObject({ valid: false, reason: 'not_found' });
  });

  it('rejects empty codes', async () => {
    const result = await validateCouponForOrder(db(), { retailerId: RETAILER, code: '   ', lines: cart, now: NOW });
    expect(result).toMatchObject({ valid: false, reason: 'invalid_code' });
  });

  it('rejects inactive coupons', async () => {
    const result = await validateCouponForOrder(db(baseCoupon({ is_active: false })), {
      retailerId: RETAILER, code: 'SAVE10', lines: cart, now: NOW,
    });
    expect(result).toMatchObject({ valid: false, reason: 'inactive' });
  });

  it('rejects coupons before their start date', async () => {
    const result = await validateCouponForOrder(db(baseCoupon({ starts_at: '2026-10-01T00:00:00Z' })), {
      retailerId: RETAILER, code: 'SAVE10', lines: cart, now: NOW,
    });
    expect(result).toMatchObject({ valid: false, reason: 'not_started' });
  });

  it('rejects expired coupons', async () => {
    const result = await validateCouponForOrder(db(baseCoupon({ expires_at: '2026-09-01T00:00:00Z' })), {
      retailerId: RETAILER, code: 'SAVE10', lines: cart, now: NOW,
    });
    expect(result).toMatchObject({ valid: false, reason: 'expired' });
  });

  it('rejects customer-specific coupons for other retailers', async () => {
    const result = await validateCouponForOrder(db(baseCoupon({ retailer_id: OTHER_RETAILER })), {
      retailerId: RETAILER, code: 'SAVE10', lines: cart, now: NOW,
    });
    expect(result).toMatchObject({ valid: false, reason: 'not_eligible' });
  });

  it('accepts a customer-specific coupon for the target retailer', async () => {
    const result = await validateCouponForOrder(db(baseCoupon({ retailer_id: RETAILER })), {
      retailerId: RETAILER, code: 'SAVE10', lines: cart, now: NOW,
    });
    expect(result.valid).toBe(true);
  });

  it('rejects first-order coupons for retailers with prior (non-cancelled) orders', async () => {
    const result = await validateCouponForOrder(
      db(baseCoupon({ first_order_only: true }), [{ id: 'o1', retailer_id: RETAILER, status: 'delivered' }]),
      { retailerId: RETAILER, code: 'SAVE10', lines: cart, now: NOW }
    );
    expect(result).toMatchObject({ valid: false, reason: 'first_order_only' });
  });

  it('counts cancelled orders as NOT prior orders for first-order coupons', async () => {
    const result = await validateCouponForOrder(
      db(baseCoupon({ first_order_only: true }), [{ id: 'o1', retailer_id: RETAILER, status: 'cancelled' }]),
      { retailerId: RETAILER, code: 'SAVE10', lines: cart, now: NOW }
    );
    expect(result.valid).toBe(true);
  });

  it('rejects once the global usage limit is exhausted', async () => {
    const result = await validateCouponForOrder(db(baseCoupon({ usage_limit: 5, used_count: 5 })), {
      retailerId: RETAILER, code: 'SAVE10', lines: cart, now: NOW,
    });
    expect(result).toMatchObject({ valid: false, reason: 'usage_limit' });
  });

  it('rejects once the per-retailer limit is exhausted', async () => {
    const result = await validateCouponForOrder(
      db(baseCoupon({ per_retailer_limit: 1 }), [], [{ id: 'r1', coupon_id: COUPON, retailer_id: RETAILER, order_id: 'o1' }]),
      { retailerId: RETAILER, code: 'SAVE10', lines: cart, now: NOW }
    );
    expect(result).toMatchObject({ valid: false, reason: 'retailer_limit' });
  });

  it('allows another retailer when only this retailer hit the per-retailer limit', async () => {
    const result = await validateCouponForOrder(
      db(baseCoupon({ per_retailer_limit: 1 }), [], [{ id: 'r1', coupon_id: COUPON, retailer_id: OTHER_RETAILER, order_id: 'o1' }]),
      { retailerId: RETAILER, code: 'SAVE10', lines: cart, now: NOW }
    );
    expect(result.valid).toBe(true);
  });

  it('rejects when the cart is below the minimum order value', async () => {
    const result = await validateCouponForOrder(db(baseCoupon({ minimum_order_value: 1000 })), {
      retailerId: RETAILER, code: 'SAVE10', lines: cart, now: NOW,
    });
    expect(result).toMatchObject({ valid: false, reason: 'minimum_order' });
    if (!result.valid) expect(result.message).toContain('₹500.00');
  });

  it('accepts when the cart meets the minimum order value', async () => {
    const result = await validateCouponForOrder(db(baseCoupon({ minimum_order_value: 500 })), {
      retailerId: RETAILER, code: 'SAVE10', lines: cart, now: NOW,
    });
    expect(result.valid).toBe(true);
  });

  it('category-scoped coupons only discount eligible lines', async () => {
    const scoped = db(baseCoupon({ category_id: CATEGORY }));
    const result = await validateCouponForOrder(scoped, { retailerId: RETAILER, code: 'SAVE10', lines: cart, now: NOW });
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.discount).toBe(20); // 10% of 200 only
  });

  it('brand-scoped coupons only discount eligible lines', async () => {
    const result = await validateCouponForOrder(db(baseCoupon({ brand_id: BRAND })), {
      retailerId: RETAILER, code: 'SAVE10', lines: cart, now: NOW,
    });
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.discount).toBe(20);
  });

  it('product-scoped coupons only discount that product', async () => {
    const result = await validateCouponForOrder(db(baseCoupon({ product_id: PRODUCT_B })), {
      retailerId: RETAILER, code: 'SAVE10', lines: cart, now: NOW,
    });
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.discount).toBe(30); // 10% of 300
  });

  it('rejects scoped coupons when the cart has no eligible products', async () => {
    const result = await validateCouponForOrder(db(baseCoupon({ product_id: 'missing' })), {
      retailerId: RETAILER, code: 'SAVE10', lines: cart, now: NOW,
    });
    expect(result).toMatchObject({ valid: false, reason: 'no_eligible_items' });
  });

  it('rejects when the cart is empty', async () => {
    const result = await validateCouponForOrder(db(), { retailerId: RETAILER, code: 'SAVE10', lines: [], now: NOW });
    expect(result).toMatchObject({ valid: false, reason: 'no_eligible_items' });
  });

  it('survives a failed coupon read with a retry message, never a silent pass', async () => {
    const fixture = supabaseFixture({ coupons: [] }, { coupons: 'offline' }) as never;
    const result = await validateCouponForOrder(fixture, { retailerId: RETAILER, code: 'SAVE10', lines: cart, now: NOW });
    expect(result).toMatchObject({ valid: false, reason: 'invalid_code' });
    if (!result.valid) expect(result.message).toMatch(/try again/i);
  });
});
