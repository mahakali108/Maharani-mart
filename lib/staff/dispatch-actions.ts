'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { notifyOrderEvent } from '@/lib/notifications/notify';
import { notifyLowStockIfNeeded } from '@/lib/inventory/alerts';
import { generateDeliveryOtp, hashDeliveryOtp } from '@/lib/delivery/otp';

export type DispatchResult = { error?: string } | { success: true };

interface OrderForDispatch {
  status: string;
  warehouse_id: string | null;
  retailer_id: string;
  order_number: string;
}

interface OrderItemRow {
  id: string;
  product_id: string;
  quantity: number;
  quantity_pieces: number | null;
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

  // A re-dispatch currently overwrites the failed task and DELETES its old
  // item snapshots; it also clears proof links and failure details. Preserve
  // that evidence until an immutable multi-attempt model is reviewed. Check
  // BEFORE stock consumption and the order status write so rejection is safe.
  const { data: priorDelivery, error: priorDeliveryError } = await supabase
    .from('order_deliveries')
    .select('id, delivery_status')
    .eq('order_id', orderId)
    .maybeSingle<{ id: string; delivery_status: string }>();
  if (priorDeliveryError) return { error: 'Delivery history could not be checked. Dispatch paused.' };
  if (priorDelivery) {
    return { error: priorDelivery.delivery_status === 'failed'
      ? 'Re-dispatch is paused to preserve the failed attempt and its proof; contact an administrator.'
      : 'A delivery task already exists for this order.' };
  }

  const { data: itemData } = await supabase
    .from('order_items')
    .select('id, product_id, quantity, quantity_pieces')
    .eq('order_id', orderId);
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

  // --- Phase 4: create a NEW delivery task with a fresh OTP. The plain OTP
  // goes ONLY to the retailer; only its SHA-256 hash is stored. An existing
  // (especially failed) task must not be reset or its evidence erased. ---
  const otp = generateDeliveryOtp();
  const otpHash = hashDeliveryOtp(orderId, otp);
  const nowIso = new Date().toISOString();
  const { data: inserted, error: insertError } = await supabase
    .from('order_deliveries')
    .insert({
      order_id: orderId,
      delivery_status: 'assigned',
      assigned_staff_id: user.id,
      assigned_at: nowIso,
      assigned_by: user.id,
      dispatched_at: nowIso,
      otp_hash: otpHash,
    } as never)
    .select('id')
    .maybeSingle<{ id: string }>();
  if (insertError || !inserted) return { error: `Delivery task could not be created: ${insertError?.message ?? 'unknown error'}` };
  const deliveryId = inserted.id;

  // Snapshot the ordered quantities for the completion form + settlement.
  const itemSnapshots = items.map((item) => ({
    delivery_id: deliveryId,
    order_item_id: item.id,
    quantity_ordered: item.quantity_pieces ?? item.quantity,
  }));
  const { error: snapshotError } = await supabase
    .from('order_delivery_items')
    .insert(itemSnapshots as never);
  if (snapshotError) return { error: `Delivery lines could not be snapshotted: ${snapshotError.message}` };

  await notifyOrderEvent({
    recipientId: order.retailer_id,
    title: 'Order dispatched',
    body: `Your order ${order.order_number} is on its way. Your delivery OTP is ${otp} — share it with the delivery person only after receiving your goods.`,
    // The OTP is shown only in the retailer's in-app notification — never persisted in the channel queue.
    channelBody: `Your order ${order.order_number} is on its way. Open the Maharani app to view your delivery OTP.`,
    linkUrl: `/retailer/orders/${orderId}/delivery`,
    category: 'account', // essential OTP; opting out of routine order updates must not block delivery
  });

  // Stock just went out — check reorder levels (anti-spam dedupe inside).
  await notifyLowStockIfNeeded(items.map((i) => i.product_id));

  revalidatePath(`/staff/orders/${orderId}`);
  revalidatePath('/staff/orders');
  revalidatePath('/staff/deliveries');
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath('/admin/orders');
  revalidatePath('/admin/inventory');
  return { success: true };
}
