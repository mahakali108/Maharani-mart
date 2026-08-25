import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { quoteOrderForRetailer } from '@/lib/orders/quote-order';
import type { Database } from '@/types/database.types';

type OrderInsert = Database['public']['Tables']['orders']['Insert'];
type OrderItemInsert = Database['public']['Tables']['order_items']['Insert'];

export interface RequestedOrderLine {
  packId: string;
  quantity: number;
}

export interface CreatedOrder {
  id: string;
  orderNumber: string;
  grandTotal: number;
}

export type CreateOrderResult = { error: string } | { order: CreatedOrder };

/**
 * Shared server-only order creation path. The authoritative read/validation
 * phase lives in quoteOrderForRetailer and is rerun immediately before every
 * write; callers can only submit pack IDs, quantities and notes.
 */
export async function createOrderForRetailer({
  retailerId,
  collectedBy,
  lines,
  notes,
}: {
  retailerId: string;
  collectedBy: string | null;
  lines: RequestedOrderLine[];
  notes: string;
}): Promise<CreateOrderResult> {
  const supabase = createClient();
  const quoted = await quoteOrderForRetailer({ retailerId, lines, supabase });
  if ('error' in quoted) return quoted;
  const { quote } = quoted;

  if (quote.credit.exceedsLimit) {
    return {
      error: `This order exceeds the retailer's available credit of ₹${(quote.credit.availableCredit ?? 0).toFixed(2)}.`,
    };
  }

  const orderPayload: OrderInsert = {
    retailer_id: retailerId,
    collected_by: collectedBy,
    status: 'pending',
    subtotal: quote.subtotal,
    gst_total: quote.gstTotal,
    discount_total: quote.discountTotal,
    grand_total: quote.grandTotal,
    notes: notes.trim() || null,
  };

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert(orderPayload as unknown as never)
    .select('id, order_number')
    .single<{ id: string; order_number: string }>();
  if (orderError || !order) return { error: orderError?.message ?? 'Failed to create order.' };

  const itemPayloads: OrderItemInsert[] = quote.lines.map((line) => ({
    order_id: order.id,
    product_id: line.productId,
    pack_id: line.packId,
    quantity: line.quantity,
    unit_price: line.unitPrice,
    gst_percent: line.gstPercent,
    line_total: line.lineTotal,
  }));
  const { error: itemsError } = await supabase.from('order_items').insert(itemPayloads as unknown as never);

  if (itemsError) {
    await supabase
      .from('orders')
      .update({ status: 'cancelled', cancelled_reason: 'Order line creation failed' } as unknown as never)
      .eq('id', order.id)
      .eq('status', 'pending');
    return { error: itemsError.message };
  }

  return { order: { id: order.id, orderNumber: order.order_number, grandTotal: quote.grandTotal } };
}
