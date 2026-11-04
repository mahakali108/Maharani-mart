import { z } from 'zod';
import { enforceRateLimit, jsonError, jsonOk, logServerError, newRequestId } from '@/lib/mobile';
import { requireRetailerCommerceSession } from '@/lib/mobile/commerce-route';
import {
  serializeMobileOrder,
  type MobileOrderRow,
  type MobileOrderStatusEntry,
} from '@/lib/mobile/order-data';
import { getOrderCoinMovement } from '@/lib/coins/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const ORDER_SELECT = 'id, order_number, status, subtotal, gst_total, discount_total, grand_total, placed_at, updated_at, notes, shipping_address, coins_balance_after_paise, order_items(id, product_id, pack_id, quantity, quantity_unit, quantity_pieces, units_per_case, unit_price, gst_percent, line_total, products(name), product_packs(pack_name))';

const HISTORY_SELECT = 'id, status, note, created_at';

interface OrderHistoryRow {
  id: string;
  status: string;
  note: string | null;
  created_at: string;
}

/**
 * GET /api/mobile/v1/orders/{id} — one actual order belonging to this retailer.
 *
 * The DETAIL response carries two facts the list cannot: the order's own status
 * history (the same rows the web timeline renders) and the Coins this order
 * spent or refunded, read from the wallet ledger exactly as the web order page
 * reads it. Both are additive keys; the list payload is unchanged.
 *
 * The ledger read is allowed to degrade: if it fails, the order itself is still
 * real and still returned, without the movement keys. The failure is logged
 * against the request id rather than hidden.
 */
export async function GET(
  request: Request,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const params = await paramsPromise;
  const requestId = newRequestId();
  const auth = await requireRetailerCommerceSession(request, requestId, 'orders.view.own');
  if ('response' in auth) return auth.response;
  const limited = enforceRateLimit('read.orders', request, { requestId, keySuffix: auth.session.userId });
  if (limited) return limited;
  if (!z.string().uuid().safeParse(params.id).success) {
    return jsonError('not_found', 'This order could not be found.', { status: 404, requestId });
  }

  try {
    const supabase = auth.session.supabase as unknown as Awaited<ReturnType<typeof createClient>>;
    const { data, error } = await supabase
      .from('orders')
      .select(ORDER_SELECT)
      .eq('id', params.id)
      .eq('retailer_id', auth.session.userId)
      .maybeSingle<MobileOrderRow>();
    if (error) throw error;
    if (!data) return jsonError('not_found', 'This order could not be found.', { status: 404, requestId });

    const { data: historyData, error: historyError } = await supabase
      .from('order_status_history')
      .select(HISTORY_SELECT)
      .eq('order_id', params.id)
      .order('created_at', { ascending: true });
    if (historyError) throw historyError;

    const statusHistory: MobileOrderStatusEntry[] = ((historyData ?? []) as OrderHistoryRow[]).map(
      (row) => ({ id: row.id, status: row.status, note: row.note, createdAt: row.created_at })
    );

    let coinMovement: { spentPaise: number; refundedPaise: number; refunded: boolean } | null = null;
    try {
      coinMovement = await getOrderCoinMovement(supabase, params.id, auth.session.userId);
    } catch (ledgerError) {
      logServerError('orders.detail.ledger', requestId, ledgerError);
    }

    return jsonOk(serializeMobileOrder(data, { statusHistory, coinMovement }), { requestId });
  } catch (cause) {
    logServerError('orders.detail', requestId, cause);
    return jsonError('database_unavailable', 'This order could not be loaded. Please try again.', {
      status: 503,
      requestId,
    });
  }
}
