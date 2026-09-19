import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Source-level contract tests for the coupon → cart → checkout → order wiring.
 *
 * The unit and validator tests prove the MATH and the DECISION; these pin down
 * WHERE the decisions happen, so a regression that makes a page trust a
 * client-sent discount, or skips the server-side revalidation, fails the build
 * instead of shipping.
 */
const read = (file: string) => readFileSync(path.join(__dirname, '..', file), 'utf8');

const cartPage = () => read('app/retailer/cart/page.tsx');
const checkoutPage = () => read('app/retailer/checkout/page.tsx');
const checkoutActions = () => read('lib/retailer/checkout-actions.ts');
const quote = () => read('lib/orders/quote-order.ts');
const createOrder = () => read('lib/orders/create-order.ts');
const retailerCancel = () => read('lib/retailer/order-actions.ts');
const adminCancel = () => read('lib/admin/orders-actions.ts');

describe('cart and checkout never trust a client-sent discount', () => {
  it('revalidates the stored coupon through the authoritative validator on every render', () => {
    for (const [file, source] of [
      ['cart page', cartPage()],
      ['checkout page', checkoutPage()],
    ]) {
      expect(source, file).toContain('loadActiveCouponForRetailer');
      expect(source, file).toContain('validateCouponForOrder');
      // The stored pointer is a coupon id/code — no discount value is read
      // from the row or from any request parameter.
      expect(source, file).not.toMatch(/discount.*searchParams|searchParams.*discount/);
    }
  });

  it('subtracts only the server-computed discount from the grand total', () => {
    expect(cartPage()).toMatch(/grandTotal = subtotal \+ gstTotal - discountTotal/);
    expect(checkoutPage()).toMatch(/grandTotal = subtotal \+ gstTotal - discountTotal/);
  });

  it('does not render the discount when validation fails (warning instead)', () => {
    expect(cartPage()).toContain('couponWarning');
    expect(checkoutPage()).toContain('couponWarning');
  });
});

describe('order creation revalidates and records the coupon server-side', () => {
  it('passes the code into the quote, which is the final gate before billing', () => {
    expect(checkoutActions()).toContain('loadActiveCouponForRetailer');
    expect(checkoutActions()).toContain('couponCode: activeCoupon.coupon?.code ?? null');
    expect(createOrder()).toContain('quoteOrderForRetailer({ retailerId, lines, supabase, couponCode })');
  });

  it('quotes with a discount that can never exceed the eligible value and rounds money', () => {
    const source = quote();
    expect(source).toContain('validateCouponForOrder');
    expect(source).toContain('grandTotal = roundMoney(subtotal + gstTotal - discountTotal)');
    expect(source).toContain('discountTotal,');
  });

  it('stamps the revalidated coupon snapshot onto the persisted order', () => {
    const source = createOrder();
    expect(source).toContain('coupon_id: quote.coupon?.id ?? null');
    expect(source).toContain('coupon_code: quote.coupon?.code ?? null');
    expect(source).toContain('coupon_discount: quote.coupon?.discount ?? 0');
  });

  it('claims the redemption atomically via the database and cancels the order if the database refuses', () => {
    const source = createOrder();
    expect(source).toContain("rpc('redeem_coupon'");
    expect(source).toContain('p_coupon_id: quote.coupon.id');
    expect(source).toContain('p_order_id: order.id');
    expect(source).toMatch(/redeemError \|\| redeemed === false/);
    // The redemption claim happens before the wallet debit.
    const redeemIndex = source.indexOf("rpc('redeem_coupon'");
    const debitIndex = source.indexOf("rpc('check_and_debit_retailer_wallet'");
    expect(redeemIndex).toBeGreaterThan(-1);
    expect(debitIndex).toBeGreaterThan(redeemIndex);
  });

  it('clears the consumed coupon from the cart after a successful order', () => {
    const source = checkoutActions();
    expect(source).toContain("from('retailer_active_coupons').delete().eq('retailer_id', user.id)");
  });
});

describe('cancellation releases the coupon on every cancel path', () => {
  it('retailer self-cancel releases the redemption', () => {
    const source = retailerCancel();
    expect(source).toContain('releaseOrderCoupon');
    const cancelFn = source.slice(source.indexOf('export async function cancelOrderAction'));
    expect(cancelFn).toContain('releaseOrderCoupon(supabase, orderId)');
  });

  it('admin cancel releases the redemption', () => {
    const source = adminCancel();
    expect(source).toContain('releaseOrderCoupon');
    const cancelFn = source.slice(source.indexOf('export async function cancelOrderAction'));
    expect(cancelFn).toContain('releaseOrderCoupon(supabase, orderId)');
  });
});
