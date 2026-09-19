import 'server-only';

import type { createClient } from '@/lib/supabase/server';
import { computeCouponDiscount, eligibleSubtotalForCoupon, normalizeCouponCode } from './engine';
import type { CouponCartLine, CouponInvalidReason, CouponRow, CouponValidationResult } from './types';

/**
 * THE authoritative server-side coupon validation + calculation.
 *
 * Every surface that shows or applies a coupon discount (cart preview,
 * checkout preview, order creation) calls THIS function. Nothing it needs is
 * trusted from the client:
 *  - the retailer id comes from the caller's authenticated session,
 *  - the code is looked up by its normalized uppercase form,
 *  - every limit, window and eligibility flag is re-read from the database,
 *  - the discount is computed here, never sent by the browser.
 */

export interface CouponValidationInput {
  /** Authenticated session id of the retailer. Never client-supplied. */
  retailerId: string;
  /** Raw code; normalized internally. */
  code: string;
  /** Billable cart lines (GST-exclusive subtotals) for the current cart. */
  lines: CouponCartLine[];
  /** Injectable clock for tests; defaults to now. */
  now?: Date;
}

const COUPON_SELECT =
  'id, code, title, description, discount_type, discount_value, minimum_order_value, maximum_discount, usage_limit, per_retailer_limit, used_count, starts_at, expires_at, is_active, first_order_only, retailer_id, category_id, brand_id, product_id';

export async function loadCouponByCode(
  supabase: ReturnType<typeof createClient>,
  rawCode: string
): Promise<{ coupon: CouponRow | null; error: boolean }> {
  const code = normalizeCouponCode(rawCode);
  if (!code) return { coupon: null, error: false };
  const { data, error } = await supabase
    .from('coupons')
    .select(COUPON_SELECT)
    .eq('code', code)
    .maybeSingle<CouponRow>();
  if (error) return { coupon: null, error: true };
  return { coupon: data, error: false };
}

async function loadRetailerRedemptionCount(
  supabase: ReturnType<typeof createClient>,
  couponId: string,
  retailerId: string
): Promise<{ count: number; error: boolean }> {
  const { count, error } = await supabase
    .from('coupon_redemptions')
    .select('id', { count: 'exact', head: true })
    .eq('coupon_id', couponId)
    .eq('retailer_id', retailerId);
  if (error) return { count: 0, error: true };
  return { count: count ?? 0, error: false };
}

async function loadRetailerOrderCount(
  supabase: ReturnType<typeof createClient>,
  retailerId: string
): Promise<{ count: number; error: boolean }> {
  const { count, error } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('retailer_id', retailerId)
    .neq('status', 'cancelled');
  if (error) return { count: 0, error: true };
  return { count: count ?? 0, error: false };
}

function reject(code: string, reason: CouponInvalidReason, message: string): CouponValidationResult {
  return { valid: false, code, reason, message };
}

/**
 * Validates a code against the caller's cart and returns the authoritative
 * discount. See the module doc for the trust model.
 */
export async function validateCouponForOrder(
  supabase: ReturnType<typeof createClient>,
  input: CouponValidationInput
): Promise<CouponValidationResult> {
  const code = normalizeCouponCode(input.code);
  if (!code) return reject(code, 'invalid_code', 'Enter a coupon code to apply.');
  if (input.lines.length === 0) {
    return reject(code, 'no_eligible_items', 'Add at least one product to the cart to use a coupon.');
  }

  const { coupon, error: readError } = await loadCouponByCode(supabase, code);
  if (readError) return reject(code, 'invalid_code', 'The coupon could not be checked right now. Please try again.');
  if (!coupon) return reject(code, 'not_found', 'That coupon code is not valid.');

  if (!coupon.is_active) return reject(code, 'inactive', 'This coupon has been deactivated.');

  const now = input.now ?? new Date();
  if (new Date(coupon.starts_at).getTime() > now.getTime()) {
    return reject(code, 'not_started', 'This coupon has not started yet.');
  }
  if (new Date(coupon.expires_at).getTime() < now.getTime()) {
    return reject(code, 'expired', 'This coupon has expired.');
  }

  // Customer-specific coupons: the scoped retailer must be the caller.
  if (coupon.retailer_id !== null && coupon.retailer_id !== input.retailerId) {
    return reject(code, 'not_eligible', 'This coupon is not available for your shop.');
  }

  if (coupon.first_order_only) {
    const orders = await loadRetailerOrderCount(supabase, input.retailerId);
    if (orders.error) return reject(code, 'invalid_code', 'Your order history could not be checked. Please try again.');
    if (orders.count > 0) {
      return reject(code, 'first_order_only', 'This coupon is only valid on your first order.');
    }
  }

  if (coupon.usage_limit !== null && coupon.used_count >= coupon.usage_limit) {
    return reject(code, 'usage_limit', 'This coupon has reached its total usage limit.');
  }

  const redemptions = await loadRetailerRedemptionCount(supabase, coupon.id, input.retailerId);
  if (redemptions.error) return reject(code, 'invalid_code', 'Your coupon usage could not be checked. Please try again.');
  if (redemptions.count >= coupon.per_retailer_limit) {
    return reject(code, 'retailer_limit', 'You have already used this coupon the maximum number of times.');
  }

  const isScoped = coupon.category_id !== null || coupon.brand_id !== null || coupon.product_id !== null;
  const eligibleSubtotal = eligibleSubtotalForCoupon(coupon, input.lines);
  if (isScoped && eligibleSubtotal <= 0) {
    return reject(code, 'no_eligible_items', 'Your cart has no products this coupon applies to.');
  }

  const orderSubtotal = input.lines.reduce((sum, line) => sum + line.subtotal, 0);
  if (orderSubtotal < coupon.minimum_order_value) {
    return reject(
      code,
      'minimum_order',
      `Add ₹${(coupon.minimum_order_value - orderSubtotal).toFixed(2)} more to use this code.`
    );
  }

  const discount = computeCouponDiscount(coupon, eligibleSubtotal);
  if (discount <= 0) {
    return reject(code, 'no_eligible_items', 'This coupon does not reduce the total of your cart.');
  }

  return {
    valid: true,
    coupon,
    discount,
    message: `Code ${coupon.code} applied — you save ${discount.toFixed(2)} rupees.`,
  };
}

/**
 * Loads the coupon currently applied to a retailer's cart (0051
 * `retailer_active_coupons`) WITHOUT trusting it: the caller revalidates with
 * `validateCouponForOrder` before anything is shown as a live discount or
 * billed to an order.
 */
export async function loadActiveCouponForRetailer(
  supabase: ReturnType<typeof createClient>,
  retailerId: string
): Promise<{ coupon: CouponRow | null; error: boolean }> {
  const { data, error } = await supabase
    .from('retailer_active_coupons')
    .select('coupon_id, coupons ( ' + COUPON_SELECT + ' )')
    .eq('retailer_id', retailerId)
    .maybeSingle<{ coupon_id: string; coupons: CouponRow | null }>();
  if (error) return { coupon: null, error: true };
  return { coupon: data?.coupons ?? null, error: false };
}

/**
 * Releases a coupon redemption when its order is cancelled. Best-effort: a
 * failed release must not block the cancellation itself (the redemption row
 * is audited; support can reconcile).
 */
export async function releaseOrderCoupon(
  supabase: ReturnType<typeof createClient>,
  orderId: string
): Promise<void> {
  try {
    const { error } = await (
      supabase as unknown as {
        rpc: (name: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
      }
    ).rpc('release_coupon', { p_order_id: orderId });
    if (error) console.warn('Coupon release failed (order cancelled anyway):', error.message);
  } catch (error) {
    console.warn('Coupon release failed (order cancelled anyway):', error instanceof Error ? error.message : error);
  }
}
