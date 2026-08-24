'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { notifyOrderEvent } from '@/lib/notifications/notify';
import { notifyLowStockIfNeeded } from '@/lib/inventory/alerts';

export type DispatchResult = { error?: string } | { success: true };

interface OrderForDispatch {
  status: string;
  warehouse_id: string | null;
  retailer_id: string;
  order_number: string;
}

interface OrderItemRow {
  product_id: string;
  quantity: number;
}

/**
 * Dispatches an order. Stock deduction is delegated to the
 * consume_order_stock RPC, which atomically:
 *   - consumes the FEFO batch allocations recorded at approval time
 *     (SALE movements, releasing the matching reserved quantities),
 *   - falls back to a direct FEFO deduction for pre-migration orders
 *     that have no allocations,
 *   - is idempotent on retry (an already-dispatched line is never
 *     deducted twice).
 * The order's pricing/totals are untouched.
 */
export async function dispatchOrderAction(orderId: string): Promise<DispatchResult> {
  const user = await requirePermission('orders.dispatch');
  const supabase = createClient();

  const { data: order } = await supabase
    .from('orders')
    .select('status, warehouse_id, retailer_id, order_number')
    .eq('id', orderId)
    .maybeSingle<OrderForDispatch>();

  if (!order) return { error: 'Order not found.' };
  if (!order.warehouse_id) return { error: 'This order has no warehouse assigned.' };
  if (order.status !== 'confirmed' && order.status !== 'processing' && order.status !== 'packed') {
    return { error: 'Only confirmed, processing, or packed orders can be dispatched.' };
  }

  const { data: itemData } = await supabase.from('order_items').select('product_id, quantity').eq('order_id', orderId);
  const items = (itemData ?? []) as OrderItemRow[];
  if (items.length === 0) return { error: 'This order has no items.' };

  const { error: consumeError } = await supabase.rpc('consume_order_stock' as never, {
    p_order_id: orderId,
  } as never);
  if (consumeError) {
    const msg = consumeError.message;
    const match = msg.match(/INSUFFICIENT_STOCK:\s*(.+)$/);
    return { error: match?.[1] ? match[1].trim() : `Stock could not be deducted: ${msg}` };
  }

  const { error: orderError } = await supabase
    .from('orders')
    .update({
      status: 'dispatched',
      dispatched_by: user.id,
      dispatched_at: new Date().toISOString(),
    } as unknown as never)
    .eq('id', orderId);

  if (orderError) return { error: orderError.message };

  await notifyOrderEvent({
    recipientId: order.retailer_id,
    title: 'Order dispatched',
    body: `Your order ${order.order_number} is on its way.`,
    linkUrl: `/retailer/orders/${orderId}`,
  });

  // Stock just went out — check reorder levels (anti-spam dedupe inside).
  await notifyLowStockIfNeeded(items.map((i) => i.product_id));

  revalidatePath(`/staff/orders/${orderId}`);
  revalidatePath('/staff/orders');
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath('/admin/orders');
  revalidatePath('/admin/inventory');
  return { success: true };
}
