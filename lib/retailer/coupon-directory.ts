/**
 * Pure classification for the retailer's coupon page (0051).
 *
 * The database/RLS already hides inactive and staff-only rows; this decides
 * which SECTION a visible coupon lands in for the caller and WHY, using only
 * server-read values (order count, the caller's own redemption count, the
 * window). No client input is involved.
 */

export interface RetailerCouponRow {
  id: string;
  code: string;
  title: string;
  description: string | null;
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
  minimum_order_value: number;
  maximum_discount: number | null;
  usage_limit: number | null;
  per_retailer_limit: number;
  used_count: number;
  starts_at: string;
  expires_at: string;
  first_order_only: boolean;
  retailer_id: string | null;
  category_id: string | null;
  brand_id: string | null;
  product_id: string | null;
  retailers: { shop_name: string } | null;
  categories: { name: string } | null;
  brands: { name: string } | null;
  products: { name: string } | null;
}

export type CouponSection = 'available' | 'starting_soon' | 'recently_expired' | 'hidden';

export interface ClassifiedCoupon {
  coupon: RetailerCouponRow;
  section: CouponSection;
  /** Human reason when the coupon is visible but not currently applicable. */
  blockedReason: string | null;
  /** This retailer's redemption count for this coupon (from own rows). */
  usedByMe: number;
}

export interface ClassifyInput {
  retailerId: string;
  now?: Date;
  /** Non-cancelled order count for the caller (first-order check). */
  orderCount: number;
  /** Caller's redemption count per coupon id. */
  redemptionsByCoupon: Record<string, number>;
  /** Expired coupons shown for at most this many days (default 30). */
  expiredWindowDays?: number;
}

export function classifyCoupon(coupon: RetailerCouponRow, input: ClassifyInput): ClassifiedCoupon | null {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const startsMs = new Date(coupon.starts_at).getTime();
  const expiresMs = new Date(coupon.expires_at).getTime();
  const usedByMe = input.redemptionsByCoupon[coupon.id] ?? 0;
  const expiredDays = input.expiredWindowDays ?? 30;

  // Customer-specific coupons for someone else: not shown at all.
  if (coupon.retailer_id !== null && coupon.retailer_id !== input.retailerId) return null;

  const base: Omit<ClassifiedCoupon, 'section' | 'blockedReason'> = { coupon, usedByMe };

  if (expiresMs <= nowMs) {
    const daysSinceExpiry = (nowMs - expiresMs) / 86_400_000;
    if (daysSinceExpiry > expiredDays) return null;
    return { ...base, section: 'recently_expired', blockedReason: 'This coupon has expired.' };
  }

  if (startsMs > nowMs) {
    return { ...base, section: 'starting_soon', blockedReason: 'This coupon has not started yet.' };
  }

  // Live window.
  if (coupon.usage_limit !== null && coupon.used_count >= coupon.usage_limit) {
    return { ...base, section: 'available', blockedReason: 'All uses of this coupon are gone.' };
  }
  if (usedByMe >= coupon.per_retailer_limit) {
    return { ...base, section: 'available', blockedReason: `You have used this coupon ${usedByMe} time${usedByMe === 1 ? '' : 's'} — your limit is ${coupon.per_retailer_limit}.` };
  }
  if (coupon.first_order_only && input.orderCount > 0) {
    return { ...base, section: 'available', blockedReason: 'This coupon is only valid on your first order.' };
  }

  return { ...base, section: 'available', blockedReason: null };
}

/** Human-readable eligibility details for a coupon (real data only). */
export function couponScopeLabel(coupon: RetailerCouponRow): string | null {
  const parts: string[] = [];
  if (coupon.categories) parts.push(`category: ${coupon.categories.name}`);
  if (coupon.brands) parts.push(`brand: ${coupon.brands.name}`);
  if (coupon.products) parts.push(`product: ${coupon.products.name}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}
