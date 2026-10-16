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
  it('passes only the server-loaded active code into the quote before the atomic writer', () => {
    expect(checkoutActions()).toContain('loadActiveCouponForRetailer');
    expect(checkoutActions()).toContain('couponCode: activeCoupon.coupon?.code ?? null');
    const source = createOrder();
    expect(source).toMatch(/quoteOrderForRetailer\([\s\S]*?couponCode,\s*\}\)/);
    expect(source).toContain('p_coupon_id: quote.coupon?.id ?? null');
    expect(source).toContain('p_coupon_discount: quote.coupon?.discount ?? 0');
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

  it('claims the coupon, debits Coins, finalizes the request and clears cart in one database transaction', () => {
    const source = read('supabase/migrations/0056_mobile_checkout_atomic.sql');
    expect(source).toContain('public.redeem_coupon(');
    expect(source).toContain('p_coupon_id, p_retailer_id, v_order.id, p_coupon_discount');
    expect(source).toContain('v_coupon_eligible_subtotal');
    expect(source).toContain('v_expected_coupon_discount');
    expect(source).toContain('v_coupon.minimum_order_value');
    expect(source).toContain('public.serialize_retailer_active_coupon_mutation');
    expect(source).toContain('coins_balance_after_paise');
    expect(source).toContain('coinsBalanceAfterPaise');
    expect(source).toContain('public.check_and_debit_retailer_wallet(');
    expect(source).toContain('p_expected_coins_used_paise');
    expect(source).toContain('request_completed_at = now()');
    expect(source).toContain('delete from public.cart_items ci where ci.retailer_id = p_retailer_id');
    // Both coupon and Coins calls happen inside create_order_atomic; any failure
    // raises out of the function and rolls every write back together.
    const redeemIndex = source.indexOf('public.redeem_coupon(');
    const debitIndex = source.indexOf('public.check_and_debit_retailer_wallet(');
    const completionIndex = source.indexOf('request_completed_at = now()');
    const cartClearIndex = source.indexOf('delete from public.cart_items ci where ci.retailer_id = p_retailer_id');
    expect(redeemIndex).toBeGreaterThan(-1);
    expect(debitIndex).toBeGreaterThan(redeemIndex);
    expect(completionIndex).toBeGreaterThan(debitIndex);
    expect(cartClearIndex).toBeGreaterThan(completionIndex);
  });

  it('rolls coupon, stock, order and Coins writes back together when any atomic step fails', () => {
    const source = read('supabase/migrations/0056_mobile_checkout_atomic.sql');
    expect(source).toContain('A failure at any point rolls back all order, stock, coupon, coin, completion');
    expect(source).toContain('create or replace function public.create_order_atomic');
    // The PostgreSQL integration suite injects stale stock, price and totals and
    // asserts that no order/cart/stock side effect survives the exception.
    expect(read('tests/mobile-checkout-atomic-db.test.ts')).toContain('rolls back the order, cart and all side effects');
  });

  it('removes the consumed coupon pointer in the same transaction as the order', () => {
    const source = read('supabase/migrations/0056_mobile_checkout_atomic.sql');
    expect(source).toContain('delete from public.retailer_active_coupons rac');
    expect(source).toContain('where rac.retailer_id = p_retailer_id and rac.coupon_id = p_coupon_id');
  });
});

describe('cancellation preserves coupon redemption evidence pending reviewed reversal model', () => {
  it('retailer, admin and mobile cancellations still call the hold helper', () => {
    for (const source of [retailerCancel(), adminCancel(), read('app/api/mobile/v1/orders/[id]/cancel/route.ts')]) {
      expect(source).toContain('releaseOrderCoupon(');
    }
    const helper = read('lib/coupons/validate.ts');
    const release = helper.slice(helper.indexOf('export async function releaseOrderCoupon'));
    expect(release).not.toContain(".rpc('release_coupon'");
    expect(release).toContain('No mutation. Preserve the redemption');
    expect(read('supabase/migrations/0059_india_compliance_safety.sql')).toContain('revoke execute on function public.release_coupon(uuid)');
  });
});
