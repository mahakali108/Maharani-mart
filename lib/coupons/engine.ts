import { roundMoney } from '@/lib/orders/credit';
import type { CouponCartLine, CouponRow } from './types';

/**
 * Pure coupon math — no database, no session. The validator (validate.ts)
 * supplies the coupon row and the billable lines; this module owns ONLY the
 * discount arithmetic and the per-line eligibility rules, so every surface
 * (cart preview, checkout preview, order creation) computes the identical
 * number through the same code path.
 */

/** Normalizes a code the way the database stores it: trimmed UPPERCASE. */
export function normalizeCouponCode(raw: string | null | undefined): string {
  return (raw ?? '').trim().toUpperCase();
}

/**
 * Whether one billable line qualifies for a coupon. Unscoped fields (null)
 * accept everything; a scoped field must match exactly. Scopes AND together
 * (a coupon scoped to a brand AND a product applies only to that product).
 */
export function lineEligibleForCoupon(
  coupon: Pick<CouponRow, 'category_id' | 'brand_id' | 'product_id'>,
  line: Pick<CouponCartLine, 'productId' | 'categoryId' | 'brandId'>
): boolean {
  if (coupon.category_id && line.categoryId !== coupon.category_id) return false;
  if (coupon.brand_id && line.brandId !== coupon.brand_id) return false;
  if (coupon.product_id && line.productId !== coupon.product_id) return false;
  return true;
}

/** Sum of GST-exclusive line values for lines the coupon applies to. */
export function eligibleSubtotalForCoupon(coupon: CouponRow, lines: CouponCartLine[]): number {
  return roundMoney(
    lines
      .filter((line) => line.subtotal > 0 && lineEligibleForCoupon(coupon, line))
      .reduce((sum, line) => sum + line.subtotal, 0)
  );
}

/**
 * The rupee discount a coupon yields on the eligible cart value.
 *
 * - percentage: eligible × value / 100, capped by `maximum_discount` when set.
 * - fixed: the flat amount.
 *
 * The discount can never exceed the eligible value (a coupon cannot drive the
 * qualifying lines below zero) and is always a clean two-decimal rupee amount.
 */
export function computeCouponDiscount(coupon: CouponRow, eligibleSubtotal: number): number {
  if (!(eligibleSubtotal > 0)) return 0;
  let discount: number;
  if (coupon.discount_type === 'percentage') {
    discount = (eligibleSubtotal * coupon.discount_value) / 100;
    if (coupon.maximum_discount !== null && coupon.maximum_discount > 0) {
      discount = Math.min(discount, coupon.maximum_discount);
    }
  } else {
    discount = coupon.discount_value;
  }
  return roundMoney(Math.max(0, Math.min(discount, eligibleSubtotal)));
}

/** Human label for the discount value, e.g. "10% off" / "₹500 off". */
export function describeDiscountValue(coupon: Pick<CouponRow, 'discount_type' | 'discount_value'>): string {
  return coupon.discount_type === 'percentage'
    ? `${coupon.discount_value}% off`
    : `₹${coupon.discount_value.toFixed(2)} off`;
}
