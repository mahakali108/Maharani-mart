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
import { reverseOrderWalletDebit } from '@/lib/orders/wallet-reversal';

export const dynamic = 'force-dynamic';

const uuidSchema = z.string().uuid();
const bodySchema = z.object({ reason: z.string().trim().max(500).default('') }).strict();

/** Cancel only the caller's still-pending order; wallet/coupon cleanup is server-side. */
export async function POST(request: Request, context: { params: { id: string } }): Promise<Response> {
  const requestId = newRequestId();
  const auth = await requireRetailerCommerceSession(request, requestId, 'orders.cancel');
  if ('response' in auth) return auth.response;
  const limited = enforceRateLimit('write.orders', request, { requestId, keySuffix: auth.session.userId });
  if (limited) return limited;
  if (!uuidSchema.safeParse(context.params.id).success) {
    return jsonError('invalid_request', 'Order id is invalid.', { status: 400, requestId });
  }
  const body = await parseJsonBody(request, bodySchema, requestId);
  if (!body.ok) return body.response;

  try {
    const { data: cancelled, error } = await auth.session.supabase.from('orders')
      .update({ status: 'cancelled', cancelled_reason: body.data.reason || null } as unknown as never)
      .eq('id', context.params.id)
      .eq('retailer_id', auth.session.userId)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle<{ id: string }>();
    if (error) throw error;
    if (!cancelled) {
      // Use a generic conflict for missing, foreign, or already-processing
      // orders; no cross-retailer existence signal is returned.
      return jsonError('conflict', 'This order can no longer be cancelled — it may already be processing.', {
        status: 409,
        requestId,
      });
    }

    const reversal = await reverseOrderWalletDebit(
      context.params.id,
      auth.session.userId,
      body.data.reason || 'Retailer cancelled order',
      auth.session.userId,
      auth.session.supabase as never,
    );
    if ('error' in reversal) logServerError('orders.cancel.coin-reversal', requestId, reversal.error);
    await releaseOrderCoupon(auth.session.supabase as never, context.params.id);
    return jsonOk({ ok: true }, { requestId });
  } catch (cause) {
    logServerError('orders.cancel', requestId, cause);
    return jsonError('database_unavailable', 'The order could not be cancelled. Please try again.', { status: 503, requestId });
  }
}
