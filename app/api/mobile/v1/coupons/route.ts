import {
  enforceRateLimit,
  jsonError,
  jsonOk,
  logServerError,
  newRequestId,
} from '@/lib/mobile';
import { requireRetailerCommerceSession } from '@/lib/mobile/commerce-route';

export const dynamic = 'force-dynamic';

/**
 * GET /api/mobile/v1/coupons
 *
 * Active coupons visible to this retailer. The query uses RLS
 * (0051_coupon_system.sql) which shows only active coupons;
 * retailer-specific coupons for other shops are filtered by the
 * server-side classification.
 */
export async function GET(request: Request): Promise<Response> {
  const requestId = newRequestId();

  const auth = await requireRetailerCommerceSession(request, requestId, ['orders.view.own']);
  if ('response' in auth) return auth.response;

  const limited = enforceRateLimit('read.orders', request, { requestId, keySuffix: auth.session.userId });
  if (limited) return limited;

  const { session } = auth;

  try {
    const { data: coupons, error } = await session.supabase
      .from('coupons')
      .select(
        'id, code, title, description, discount_type, discount_value, minimum_order_value, maximum_discount, ' +
        'usage_limit, per_retailer_limit, used_count, starts_at, expires_at, first_order_only, ' +
        'retailer_id, category_id, brand_id, product_id',
      )
      .eq('is_active', true)
      .order('starts_at', { ascending: false })
      .returns<CouponRow[]>();

    if (error) throw error;

    // Get retailer's redemptions for classification
    const { data: redemptions } = await session.supabase
      .from('coupon_redemptions')
      .select('id, coupon_id, redeemed_at')
      .eq('retailer_id', session.userId)
      .order('redeemed_at', { ascending: false })
      .limit(100)
      .returns<RedemptionRow[]>();

    const redemptionsByCoupon: Record<string, number> = {};
    for (const row of redemptions ?? []) {
      if (row.coupon_id) {
        redemptionsByCoupon[row.coupon_id] = (redemptionsByCoupon[row.coupon_id] ?? 0) + 1;
      }
    }

    const items = (coupons ?? []).map((coupon) => {
      const section = classifyCouponSection(coupon, session.userId, redemptionsByCoupon);
      return {
        id: coupon.id,
        code: coupon.code,
        title: coupon.title,
        description: coupon.description,
        discountType: coupon.discount_type,
        discountValue: coupon.discount_value,
        minimumOrderValue: coupon.minimum_order_value,
        maximumDiscount: coupon.maximum_discount,
        usageLimit: coupon.usage_limit,
        perRetailerLimit: coupon.per_retailer_limit,
        startsAt: coupon.starts_at,
        expiresAt: coupon.expires_at,
        firstOrderOnly: coupon.first_order_only,
        isRetailerSpecific: coupon.retailer_id !== null,
        section,
      };
    });

    return jsonOk({ coupons: items }, { requestId });
  } catch (cause) {
    logServerError('coupons', requestId, cause);
    return jsonError('database_unavailable', 'Coupons could not be loaded. Please try again.', {
      status: 503,
      requestId,
    });
  }
}

interface CouponRow {
  id: string;
  code: string;
  title: string;
  description: string | null;
  discount_type: string;
  discount_value: number;
  minimum_order_value: number;
  maximum_discount: number | null;
  usage_limit: number | null;
  per_retailer_limit: number;
  used_count: number | null;
  starts_at: string | null;
  expires_at: string | null;
  first_order_only: boolean;
  retailer_id: string | null;
  category_id: string | null;
  brand_id: string | null;
  product_id: string | null;
}

interface RedemptionRow {
  id: string;
  coupon_id: string | null;
  redeemed_at: string;
}

function classifyCouponSection(
  coupon: CouponRow,
  retailerId: string,
  redemptionsByCoupon: Record<string, number>,
): string {
  const now = new Date();

  if (coupon.retailer_id && coupon.retailer_id !== retailerId) return 'hidden';
  if (coupon.expires_at && new Date(coupon.expires_at) < now) return 'recently_expired';
  if (coupon.starts_at && new Date(coupon.starts_at) > now) return 'starting_soon';
  if (coupon.usage_limit !== null && (coupon.used_count ?? 0) >= coupon.usage_limit) {
    return 'exhausted';
  }
  const used = redemptionsByCoupon[coupon.id] ?? 0;
  if (coupon.per_retailer_limit > 0 && used >= coupon.per_retailer_limit) {
    return 'used';
  }
  return 'available';
}