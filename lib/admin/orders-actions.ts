'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { notifyOrderEvent } from '@/lib/notifications/notify';
import type { Database } from '@/types/database.types';
import { restoreAndVerifyCancellationCoins } from '@/lib/orders/cancellation-coins';
import { canTransitionOrderStatus, describeTransitionError } from '@/lib/orders/state-machine';
import { releaseOrderCoupon } from '@/lib/coupons/validate';
import { resolveActiveWarehouse } from '@/lib/warehouse/resolver';

type OrderStatusEnum = Database['public']['Enums']['order_status'];

export type OrderActionResult = { error?: string } | { success: true };

export async function assignWarehouseAction(orderId: string, warehouseId: string): Promise<OrderActionResult> {
  await requirePermission('orders.assign');
  const supabase = (await createClient());

  const { data: order } = await supabase
    .from('orders')
    .select('status, warehouse_id, retailer_id, order_number')
    .eq('id', orderId)
    .maybeSingle<{ status: OrderStatusEnum; warehouse_id: string | null; retailer_id: string; order_number: string }>();

  if (!order) return { error: 'Order not found.' };
  if (order.status !== 'pending') return { error: 'Warehouse can only be reassigned before the order is approved.' };

  // ONE active warehouse: an order can only be assigned to it, never to an
  // arbitrary (or stale/deactivated) warehouse id posted by a browser.
  const resolved = await resolveActiveWarehouse(supabase);
  if (!resolved.ok) return { error: resolved.message };
  if (resolved.warehouse.id !== warehouseId) {
    return { error: `Orders can only be assigned to the active warehouse (${resolved.warehouse.name}).` };
  }

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
 * New simple-stock orders already deducted the selected pack quantity at
 * creation; approval must not reserve that stock a second time. Historical
 * orders remain on their original warehouse/FEFO reservation path.
 */
export async function approveOrderAction(orderId: string): Promise<OrderActionResult> {
  await requirePermission('orders.approve');
  const supabase = (await createClient());

  const { data: order } = await supabase
    .from('orders')
    .select('status, warehouse_id, retailer_id, order_number, simple_stock_mode')
    .eq('id', orderId)
    .maybeSingle<{ status: OrderStatusEnum; warehouse_id: string | null; retailer_id: string; order_number: string; simple_stock_mode: boolean }>();

  if (!order) return { error: 'Order not found.' };
  if (order.status !== 'pending') return { error: 'Only pending orders can be approved.' };
  if (!order.warehouse_id) {
    // No warehouse on the order: try the configured one before asking a human.
    const resolved = await resolveActiveWarehouse(supabase);
    if (!resolved.ok) return { error: resolved.message };
    const { error: assignError } = await supabase
      .from('orders')
      .update({ warehouse_id: resolved.warehouse.id } as unknown as never)
      .eq('id', orderId);
    if (assignError) return { error: assignError.message };
    order.warehouse_id = resolved.warehouse.id;
  }

  if (!order.simple_stock_mode) {
    const { data: reservation, error: reservationError } = await supabase.rpc('reserve_order_stock' as never, {
      p_order_id: orderId,
    } as never);

    if (reservationError) {
      const msg = reservationError.message;
      const match = msg.match(/INSUFFICIENT_STOCK:\s*(.+)$/);
      return { error: match?.[1] ? match[1].trim() : `Stock could not be reserved: ${msg}` };
    }
    void reservation;
  }

  const { error } = await supabase.from('orders').update({ status: 'confirmed' } as unknown as never).eq('id', orderId);
  if (error) {
    // Only a historical order has a legacy reservation to release.
    if (!order.simple_stock_mode) {
      await supabase.rpc('release_order_stock' as never, { p_order_id: orderId } as never);
    }
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
  const supabase = (await createClient());

  const { data: order } = await supabase
    .from('orders')
    .select('status, warehouse_id, retailer_id')
    .eq('id', orderId)
    .maybeSingle<{ status: OrderStatusEnum; warehouse_id: string | null; retailer_id: string }>();

  if (!order) return { error: 'Order not found.' };
  if (order.status === 'dispatched' || order.status === 'delivered' || order.status === 'returned') {
    return { error: 'Dispatched, delivered or returned orders cannot be cancelled — use the appropriate return process.' };
  }
  if (order.status !== 'cancelled') {
    const { data: cancelled, error } = await supabase
      .from('orders')
      .update({ status: 'cancelled', cancelled_reason: reason || null } as unknown as never)
      .eq('id', orderId).eq('status', order.status).select('id').maybeSingle<{ id: string }>();
    if (error) return { error: 'Cancellation could not be confirmed. Check the order before retrying.' };
    if (!cancelled) return { error: 'The order status changed; refresh before retrying.' };
  }

  // This verifier calls reverseOrderWalletDebit through its atomic refund RPC
  // and checks the ledger; it does not make status and refund one transaction.
  const user = await supabase.auth.getUser();
  const coins = await restoreAndVerifyCancellationCoins(supabase, orderId, order.retailer_id, reason || 'Order cancelled', user.data.user?.id ?? null);
  await releaseOrderCoupon(supabase, orderId);

  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath('/admin/orders');
  revalidatePath('/admin/inventory');
  revalidatePath(`/admin/wallets/${order.retailer_id}`);
  if ('error' in coins) return coins;
  return { success: true };
}

export async function updateOrderStatusAction(orderId: string, status: OrderStatusEnum): Promise<OrderActionResult> {
  await requirePermission('orders.approve');
  // Never bypass cancellation's refund verification via the generic status UI.
  if (status === 'cancelled') return cancelOrderAction(orderId, '');
  const supabase = (await createClient());

  // Phase 4: transitions must follow the shared state machine
  // (lib/orders/state-machine.ts). The 0042 DB trigger enforces the same
  // table; this pre-check turns a raw Postgres denial into a clear message.
  const { data: order } = await supabase
    .from('orders')
    .select('status, order_number')
    .eq('id', orderId)
    .maybeSingle<{ status: OrderStatusEnum; order_number: string }>();
  if (!order) return { error: 'Order not found.' };

  if (!canTransitionOrderStatus(order.status, status)) {
    return { error: describeTransitionError(order.status, status) ?? 'That status change is not allowed.' };
  }

  const { error } = await supabase.from('orders').update({ status } as unknown as never).eq('id', orderId);
  if (error) return { error: error.message };

  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath('/admin/orders');
  return { success: true };
}
