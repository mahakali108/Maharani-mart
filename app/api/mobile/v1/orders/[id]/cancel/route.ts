import { z } from 'zod';
import {
  enforceRateLimit,
  jsonError,
  jsonOk,
  logServerError,
  newRequestId,
  parseJsonBody,
} from '@/lib/mobile';
import { requireRetailerCommerceSession } from '@/lib/mobile/commerce-route';
import { releaseOrderCoupon } from '@/lib/coupons/validate';
import { attemptAtomicOrderCancellation, restoreAndVerifyCancellationCoins } from '@/lib/orders/cancellation-coins';

export const dynamic = 'force-dynamic';

const uuidSchema = z.string().uuid();
const bodySchema = z.object({ reason: z.string().trim().max(500).default('') }).strict();

/** Cancel only the caller's still-pending order; wallet/coupon cleanup is server-side. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const requestId = newRequestId();
  const auth = await requireRetailerCommerceSession(request, requestId, 'orders.cancel');
  if ('response' in auth) return auth.response;
  const limited = enforceRateLimit('write.orders', request, { requestId, keySuffix: auth.session.userId });
  if (limited) return limited;
  if (!uuidSchema.safeParse((await context.params).id).success) {
    return jsonError('invalid_request', 'Order id is invalid.', { status: 400, requestId });
  }
  const body = await parseJsonBody(request, bodySchema, requestId);
  if (!body.ok) return body.response;

  try {
    // Preferred path: one transaction for status, Coins refund and coupon release.
    const atomic = await attemptAtomicOrderCancellation(
      auth.session.supabase as never,
      (await context.params).id,
      body.data.reason || 'Retailer cancelled order',
    );
    // Declined by the database: nothing changed, and no non-atomic fallback.
    if (atomic.status === 'refused') {
      return jsonError('conflict', atomic.error, { status: 409, requestId });
    }
    const { data: cancelled, error } = await auth.session.supabase.from('orders')
      .update({ status: 'cancelled', cancelled_reason: body.data.reason || null } as unknown as never)
      .eq('id', (await context.params).id)
      .eq('retailer_id', auth.session.userId)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle<{ id: string }>();
    if (error) throw error;
    if (!cancelled) {
      const { data: existing, error: readError } = await auth.session.supabase.from('orders')
        .select('status').eq('id', (await context.params).id).eq('retailer_id', auth.session.userId)
        .maybeSingle<{ status: string }>();
      if (readError || existing?.status !== 'cancelled') {
        // Missing, foreign, and processing orders all receive the same conflict.
        return jsonError('conflict', 'This order can no longer be cancelled — it may already be processing.', {
          status: 409,
          requestId,
        });
      }
    }

    const coins = await restoreAndVerifyCancellationCoins(
      auth.session.supabase as never,
      (await context.params).id,
      auth.session.userId,
      body.data.reason || 'Retailer cancelled order',
      auth.session.userId,
    );
    await releaseOrderCoupon(auth.session.supabase as never, (await context.params).id);
    if ('error' in coins) return jsonError('database_unavailable', coins.error, { status: 503, requestId });
    return jsonOk({ ok: true }, { requestId });
  } catch (cause) {
    logServerError('orders.cancel', requestId, cause);
    return jsonError('database_unavailable', 'Cancellation could not be confirmed. Check the order and contact support if needed.', { status: 503, requestId });
  }
}
