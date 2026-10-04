import { z } from 'zod';
import { enforceRateLimit, jsonError, jsonOk, logServerError, newRequestId } from '@/lib/mobile';
import { requireRetailerCommerceSession } from '@/lib/mobile/commerce-route';
import { serializeMobileOrder, type MobileOrderRow } from '@/lib/mobile/order-data';
import { getOrderCoinMovement } from '@/lib/coins/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const ORDER_SELECT = 'id, order_number, status, subtotal, gst_total, discount_total, grand_total, placed_at, updated_at, notes, shipping_address, request_completed_at, coins_balance_after_paise, order_items(id, product_id, pack_id, quantity, quantity_unit, quantity_pieces, units_per_case, unit_price, gst_percent, line_total, products(name), product_packs(pack_name))';

/**
 * GET /api/mobile/v1/orders/requests/{requestKey} — recover an uncertain submit
 * by its stable idempotency key. A miss is an ordinary 404; no key existence
 * for another retailer is revealed because RLS and the explicit owner filter
 * both apply.
 */
export async function GET(
  request: Request,
  { params }: { params: { requestKey: string } }
): Promise<Response> {
  const requestId = newRequestId();
  const auth = await requireRetailerCommerceSession(request, requestId, 'orders.view.own');
  if ('response' in auth) return auth.response;
  const limited = enforceRateLimit('read.orders', request, { requestId, keySuffix: auth.session.userId });
  if (limited) return limited;
  if (!z.string().uuid().safeParse(params.requestKey).success) {
    return jsonError('not_found', 'No completed order was found for this request.', { status: 404, requestId });
  }

  try {
    const supabase = auth.session.supabase as unknown as ReturnType<typeof createClient>;
    const { data, error } = await supabase
      .from('orders')
      .select(ORDER_SELECT)
      .eq('request_key', params.requestKey)
      .eq('retailer_id', auth.session.userId)
      .maybeSingle<MobileOrderRow>();
    if (error) throw error;
    if (!data) return jsonError('not_found', 'No completed order was found for this request.', { status: 404, requestId });
    if (!data.request_completed_at || !data.order_items?.length) {
      return jsonError('conflict', 'The order request is still being finalized. Refresh your orders and try again.', {
        status: 409,
        requestId,
      });
    }
    const coinMovement = await getOrderCoinMovement(supabase, data.id, auth.session.userId);
    const coinsBalanceAfterPaise = data.coins_balance_after_paise == null
      ? null
      : Number(data.coins_balance_after_paise);
    if (coinsBalanceAfterPaise !== null && (!Number.isSafeInteger(coinsBalanceAfterPaise) || coinsBalanceAfterPaise < 0)) {
      throw new Error('Order coin balance snapshot is invalid.');
    }
    return jsonOk({
      ...serializeMobileOrder(data),
      coinsUsedPaise: coinMovement.spentPaise,
      balanceAfterCoinsPaise: coinsBalanceAfterPaise,
    }, { requestId });
  } catch (cause) {
    logServerError('orders.request-recovery', requestId, cause);
    return jsonError('database_unavailable', 'The order request could not be checked. Please try again.', {
      status: 503,
      requestId,
    });
  }
}
