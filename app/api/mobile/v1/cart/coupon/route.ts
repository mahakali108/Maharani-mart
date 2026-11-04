import { z } from 'zod';
import { loadCartCouponLines } from '@/lib/coupons/cart-lines';
import { validateCouponForOrder } from '@/lib/coupons/validate';
import { toPaise } from '@/lib/retailer/case-pricing';
import { createClient } from '@/lib/supabase/server';
import {
  enforceRateLimit,
  jsonError,
  jsonOk,
  logServerError,
  newRequestId,
  parseJsonBody,
} from '@/lib/mobile';
import { requireRetailerCommerceSession } from '@/lib/mobile/commerce-route';

export const dynamic = 'force-dynamic';

const couponSchema = z.object({ code: z.string().trim().min(1).max(40) }).strict();

/** POST /api/mobile/v1/cart/coupon — validate and set a server-owned coupon pointer. */
export async function POST(request: Request): Promise<Response> {
  const requestId = newRequestId();
  const auth = await requireRetailerCommerceSession(request, requestId, ['orders.create', 'orders.view.own']);
  if ('response' in auth) return auth.response;
  const limited = enforceRateLimit('write.cart', request, { requestId, keySuffix: auth.session.userId });
  if (limited) return limited;
  const parsed = await parseJsonBody(request, couponSchema, requestId);
  if (!parsed.ok) return parsed.response;

  try {
    const client = auth.session.supabase as unknown as Awaited<ReturnType<typeof createClient>>;
    const { data: retailer, error: retailerError } = await client
      .from('retailers')
      .select('area_id')
      .eq('id', auth.session.userId)
      .maybeSingle<{ area_id: string | null }>();
    if (retailerError || !retailer) {
      return jsonError('database_unavailable', 'The coupon could not be checked. Please try again.', { status: 503, requestId });
    }

    const cart = await loadCartCouponLines(client, auth.session.userId, retailer.area_id);
    if (cart.error) {
      return jsonError('database_unavailable', 'Your cart could not be priced for this coupon. Please try again.', { status: 503, requestId });
    }
    if (cart.lines.length === 0) {
      return jsonError('coupon_invalid', 'Add at least one orderable product to the cart before applying a coupon.', {
        status: 422,
        requestId,
      });
    }

    const validation = await validateCouponForOrder(client, {
      retailerId: auth.session.userId,
      code: parsed.data.code.toUpperCase(),
      lines: cart.lines,
    });
    if (!validation.valid) {
      return jsonError('coupon_invalid', validation.message, { status: 422, requestId });
    }

    const { error: saveError } = await client
      .from('retailer_active_coupons')
      .upsert(
        { retailer_id: auth.session.userId, coupon_id: validation.coupon.id } as never,
        { onConflict: 'retailer_id' }
      );
    if (saveError) throw saveError;
    return jsonOk({ code: validation.coupon.code, discountPaise: toPaise(validation.discount) }, { requestId });
  } catch (cause) {
    logServerError('cart.coupon.apply', requestId, cause);
    return jsonError('database_unavailable', 'The coupon could not be applied. Please try again.', {
      status: 503,
      requestId,
    });
  }
}

/** DELETE /api/mobile/v1/cart/coupon — remove only the caller's active coupon pointer. */
export async function DELETE(request: Request): Promise<Response> {
  const requestId = newRequestId();
  const auth = await requireRetailerCommerceSession(request, requestId, ['orders.create', 'orders.view.own']);
  if ('response' in auth) return auth.response;
  const limited = enforceRateLimit('write.cart', request, { requestId, keySuffix: auth.session.userId });
  if (limited) return limited;

  try {
    const client = auth.session.supabase as unknown as Awaited<ReturnType<typeof createClient>>;
    const { error } = await client
      .from('retailer_active_coupons')
      .delete()
      .eq('retailer_id', auth.session.userId);
    if (error) throw error;
    return jsonOk({ removed: true }, { requestId });
  } catch (cause) {
    logServerError('cart.coupon.remove', requestId, cause);
    return jsonError('database_unavailable', 'The applied coupon could not be removed. Please try again.', {
      status: 503,
      requestId,
    });
  }
}
