import { z } from 'zod';
import { enforceRateLimit, jsonError, jsonOk, logServerError, newRequestId } from '@/lib/mobile';
import { requireRetailerCommerceSession } from '@/lib/mobile/commerce-route';
import { serializeMobileOrder, type MobileOrderRow } from '@/lib/mobile/order-data';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const ORDER_SELECT = 'id, order_number, status, subtotal, gst_total, discount_total, grand_total, placed_at, updated_at, notes, shipping_address, coins_balance_after_paise, order_items(id, product_id, pack_id, quantity, quantity_unit, quantity_pieces, units_per_case, unit_price, gst_percent, line_total, products(name), product_packs(pack_name))';

/** GET /api/mobile/v1/orders/{id} — one actual order belonging to this retailer. */
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  const requestId = newRequestId();
  const auth = await requireRetailerCommerceSession(request, requestId, 'orders.view.own');
  if ('response' in auth) return auth.response;
  const limited = enforceRateLimit('read.orders', request, { requestId, keySuffix: auth.session.userId });
  if (limited) return limited;
  if (!z.string().uuid().safeParse(params.id).success) {
    return jsonError('not_found', 'This order could not be found.', { status: 404, requestId });
  }

  try {
    const supabase = auth.session.supabase as unknown as ReturnType<typeof createClient>;
    const { data, error } = await supabase
      .from('orders')
      .select(ORDER_SELECT)
      .eq('id', params.id)
      .eq('retailer_id', auth.session.userId)
      .maybeSingle<MobileOrderRow>();
    if (error) throw error;
    if (!data) return jsonError('not_found', 'This order could not be found.', { status: 404, requestId });
    return jsonOk(serializeMobileOrder(data), { requestId });
  } catch (cause) {
    logServerError('orders.detail', requestId, cause);
    return jsonError('database_unavailable', 'This order could not be loaded. Please try again.', {
      status: 503,
      requestId,
    });
  }
}
