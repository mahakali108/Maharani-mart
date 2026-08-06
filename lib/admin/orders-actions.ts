'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { notifyOrderEvent } from '@/lib/notifications/notify';
import type { Database } from '@/types/database.types';

type OrderStatusEnum = Database['public']['Enums']['order_status'];

export type OrderActionResult = { error?: string } | { success: true };

interface OrderItemForReservation {
  product_id: string;
  quantity: number;
}

/**
 * Adjusts (increments or decrements) reserved_quantity on
 * inventory_stock for every line of an order, at a given warehouse.
 * Uses upsert so a first-time reservation at a warehouse that has no
 * inventory_stock row yet still succeeds (starting from 0 stock,
 * reserved going negative would be a real data problem — caught by
 * the reserved_quantity >= 0 check constraint from migration 0009).
 */
async function adjustReservation(
  warehouseId: string,
  items: OrderItemForReservation[],
  direction: 1 | -1
) {
  const supabase = createClient();

  for (const item of items) {
    const { data: existing } = await supabase
      .from('inventory_stock')
      .select('id, reserved_quantity')
      .eq('product_id', item.product_id)
      .eq('warehouse_id', warehouseId)
      .maybeSingle<{ id: string; reserved_quantity: number }>();

    if (existing) {
      const nextReserved = existing.reserved_quantity + direction * item.quantity;
      await supabase
        .from('inventory_stock')
        .update({ reserved_quantity: Math.max(0, nextReserved) } as unknown as never)
        .eq('id', existing.id);
    } else if (direction === 1) {
      await supabase
        .from('inventory_stock')
        .insert({ product_id: item.product_id, warehouse_id: warehouseId, reserved_quantity: item.quantity } as unknown as never);
    }
    // direction === -1 with no existing row: nothing to release, skip.
  }
}

export async function assignWarehouseAction(orderId: string, warehouseId: string): Promise<OrderActionResult> {
  await requirePermission('orders.assign');
  const supabase = createClient();

  const { data: order } = await supabase
    .from('orders')
    .select('status, warehouse_id, retailer_id, order_number')
    .eq('id', orderId)
    .maybeSingle<{ status: OrderStatusEnum; warehouse_id: string | null; retailer_id: string; order_number: string }>();

  if (!order) return { error: 'Order not found.' };
  if (order.status !== 'pending') return { error: 'Warehouse can only be reassigned before the order is approved.' };

  const { error } = await supabase.from('orders').update({ warehouse_id: warehouseId } as unknown as never).eq('id', orderId);
  if (error) return { error: error.message };

  await notifyOrderEvent({
    recipientId: order.retailer_id,
    title: 'Order assigned',
    body: `Order ${order.order_number} has been assigned to a warehouse and is being processed.`,
    linkUrl: `/retailer/orders/${orderId}`,
  });

  revalidatePath(`/admin/orders/${orderId}`);
  return { success: true };
}

export async function approveOrderAction(orderId: string): Promise<OrderActionResult> {
  await requirePermission('orders.approve');
  const supabase = createClient();

  const { data: order } = await supabase
    .from('orders')
    .select('status, warehouse_id, retailer_id, order_number')
    .eq('id', orderId)
    .maybeSingle<{ status: OrderStatusEnum; warehouse_id: string | null; retailer_id: string; order_number: string }>();

  if (!order) return { error: 'Order not found.' };
  if (order.status !== 'pending') return { error: 'Only pending orders can be approved.' };
  if (!order.warehouse_id) return { error: 'Assign a warehouse before approving this order.' };

  const { data: itemData } = await supabase.from('order_items').select('product_id, quantity').eq('order_id', orderId);
  const items = (itemData ?? []) as OrderItemForReservation[];

  await adjustReservation(order.warehouse_id, items, 1);

  const { error } = await supabase.from('orders').update({ status: 'confirmed' } as unknown as never).eq('id', orderId);
  if (error) return { error: error.message };

  await notifyOrderEvent({
    recipientId: order.retailer_id,
    title: 'Order approved',
    body: `Order ${order.order_number} has been approved and is being prepared.`,
    linkUrl: `/retailer/orders/${orderId}`,
  });

  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath('/admin/orders');
  revalidatePath('/staff/orders');
  return { success: true };
}

export async function cancelOrderAction(orderId: string, reason: string): Promise<OrderActionResult> {
  await requirePermission('orders.cancel');
  const supabase = createClient();

  const { data: order } = await supabase
    .from('orders')
    .select('status, warehouse_id')
    .eq('id', orderId)
    .maybeSingle<{ status: OrderStatusEnum; warehouse_id: string | null }>();

  if (!order) return { error: 'Order not found.' };
  if (order.status === 'dispatched' || order.status === 'delivered') {
    return { error: 'Dispatched or delivered orders cannot be cancelled — use a return request instead.' };
  }
  if (order.status === 'cancelled') return { error: 'This order is already cancelled.' };

  // If stock was reserved (order had already been approved/packed),
  // release it back.
  if (order.warehouse_id && (order.status === 'confirmed' || order.status === 'processing' || order.status === 'packed')) {
    const { data: itemData } = await supabase.from('order_items').select('product_id, quantity').eq('order_id', orderId);
    await adjustReservation(order.warehouse_id, (itemData ?? []) as OrderItemForReservation[], -1);
  }

  const { error } = await supabase
    .from('orders')
    .update({ status: 'cancelled', cancelled_reason: reason || null } as unknown as never)
    .eq('id', orderId);
  if (error) return { error: error.message };

  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath('/admin/orders');
  return { success: true };
}

export async function updateOrderStatusAction(orderId: string, status: OrderStatusEnum): Promise<OrderActionResult> {
  await requirePermission('orders.approve');
  const supabase = createClient();

  const { error } = await supabase.from('orders').update({ status } as unknown as never).eq('id', orderId);
  if (error) return { error: error.message };

  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath('/admin/orders');
  return { success: true };
}
