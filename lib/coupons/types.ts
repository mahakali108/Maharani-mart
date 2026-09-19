/** One `coupons` row (migration 0051). */
export interface CouponRow {
  id: string;
  /** Uppercase, application-normalized. */
  code: string;
  title: string;
  description: string | null;
  discount_type: 'percentage' | 'fixed';
  /** Percentage points (0-100) or rupees, depending on discount_type. */
  discount_value: number;
  minimum_order_value: number;
  /** Cap for percentage coupons; null = no cap. */
  maximum_discount: number | null;
  /** null = unlimited. */
  usage_limit: number | null;
  per_retailer_limit: number;
  used_count: number;
  starts_at: string;
  expires_at: string;
  is_active: boolean;
  first_order_only: boolean;
  /** Customer-specific coupon; null = all retailers. */
  retailer_id: string | null;
  category_id: string | null;
  brand_id: string | null;
  product_id: string | null;
}

/** Machine-readable failure reason for a rejected coupon. */
export type CouponInvalidReason =
  | 'invalid_code'
  | 'not_found'
  | 'inactive'
  | 'not_started'
  | 'expired'
  | 'not_eligible'
  | 'first_order_only'
  | 'usage_limit'
  | 'retailer_limit'
  | 'minimum_order'
  | 'no_eligible_items';

export type CouponValidationResult =
  | {
      valid: true;
      coupon: CouponRow;
      /** Rupees off the order (GST-inclusive grand total), computed by the engine. */
      discount: number;
      message: string;
    }
  | {
      valid: false;
      code: string;
      reason: CouponInvalidReason;
      message: string;
    };

/**
 * A billable cart line as the coupon engine sees it. Subtotals are GST-
 * EXCLUSIVE (the quote's `subtotal` basis); the ids exist so category /
 * brand / product eligibility can be applied without a second read.
 */
export interface CouponCartLine {
  productId: string;
  categoryId: string | null;
  brandId: string | null;
  /** GST-exclusive line value in rupees. */
  subtotal: number;
}
