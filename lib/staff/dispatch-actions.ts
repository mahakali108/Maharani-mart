'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { notifyOrderEvent } from '@/lib/notifications/notify';
import type { Database } from '@/types/database.types';

type StockMovementInsert = Database['public']['Tables']['stock_movements']['Insert'];

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

  // Real stock deduction: insert an 'outward' stock_movements row per
  // line. The existing apply_stock_movement trigger (0001_init.sql)
  // deducts inventory_stock.quantity automatically — this is the
  // single source of truth for stock changes, not a separate
  // application-level decrement.
  const movementPayloads: StockMovementInsert[] = items.map((item) => ({
    product_id: item.product_id,
    warehouse_id: order.warehouse_id!,
    movement_type: 'outward',
    quantity: item.quantity,
    reference_order_id: orderId,
    reason: 'Order dispatch',
    performed_by: user.id,
  }));

  const { error: movementError } = await supabase.from('stock_movements').insert(movementPayloads as unknown as never);
  if (movementError) return { error: movementError.message };

  // Release the reservation now that stock has actually been deducted.
  for (const item of items) {
    const { data: stockRow } = await supabase
      .from('inventory_stock')
      .select('id, reserved_quantity')
      .eq('product_id', item.product_id)
      .eq('warehouse_id', order.warehouse_id)
      .maybeSingle<{ id: string; reserved_quantity: number }>();

    if (stockRow) {
      await supabase
        .from('inventory_stock')
        .update({ reserved_quantity: Math.max(0, stockRow.reserved_quantity - item.quantity) } as unknown as never)
        .eq('id', stockRow.id);
    }
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

  revalidatePath(`/staff/orders/${orderId}`);
  revalidatePath('/staff/orders');
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath('/admin/orders');
  return { success: true };
}
