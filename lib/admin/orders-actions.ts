'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { notifyOrderEvent } from '@/lib/notifications/notify';
import type { Database } from '@/types/database.types';

type OrderStatusEnum = Database['public']['Enums']['order_status'];

export type OrderActionResult = { error?: string } | { success: true };

interface OrderItemForNotification {
  product_id: string;
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

/**
 * Approves a pending order. Stock reservation is done ATOMICALLY and
 * SERVER-SIDE by the reserve_order_stock RPC (FEFO across the order's
 * warehouse): expired batches are excluded, allocations are recorded per
 * batch, and concurrent approvals/orders can never oversell. If there is
 * not enough stock the approval fails cleanly and the order stays pending.
 *
 * Pricing/GST/MOQ/credit validation remain untouched in the order
 * creation path (lib/orders/create-order.ts).
 */
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

  const { data: reservation, error: reservationError } = await supabase.rpc('reserve_order_stock' as never, {
    p_order_id: orderId,
  } as never);

  if (reservationError) {
    const msg = reservationError.message;
    const match = msg.match(/INSUFFICIENT_STOCK:\s*(.+)$/);
    return { error: match?.[1] ? match[1].trim() : `Stock could not be reserved: ${msg}` };
  }
  void reservation; // { status: 'reserved' | 'already_reserved', ... }

  const { error } = await supabase.from('orders').update({ status: 'confirmed' } as unknown as never).eq('id', orderId);
  if (error) {
    // The reservation succeeded but the status flip failed — release the
    // reservation so stock is not held hostage by a half-approved order.
    await supabase.rpc('release_order_stock' as never, { p_order_id: orderId } as never);
    return { error: error.message };
  }

  await notifyOrderEvent({
    recipientId: order.retailer_id,
    title: 'Order approved',
    body: `Order ${order.order_number} has been approved and is being prepared.`,
    linkUrl: `/retailer/orders/${orderId}`,
  });

  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath('/admin/orders');
  revalidatePath('/staff/orders');
  revalidatePath('/admin/inventory');
  return { success: true };
}

/**
 * Cancels an order. Reservation release is handled by the database
 * (trg_release_stock_on_order_cancel fires release_order_stock for ANY
 * cancellation path — admin, staff, or retailer self-cancel), so stock is
 * freed exactly once and never leaks.
 */
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

  const { error } = await supabase
    .from('orders')
    .update({ status: 'cancelled', cancelled_reason: reason || null } as unknown as never)
    .eq('id', orderId);
  if (error) return { error: error.message };

  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath('/admin/orders');
  revalidatePath('/admin/inventory');
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

/**
 * Helper for other actions: reads the product ids of an order's items so
 * low-stock alerts can be raised after stock-decreasing operations.
 */
export async function productIdsForOrder(orderId: string): Promise<string[]> {
  const supabase = createClient();
  const { data } = await supabase.from('order_items').select('product_id').eq('order_id', orderId);
  return ((data ?? []) as unknown as OrderItemForNotification[]).map((i) => i.product_id);
}
