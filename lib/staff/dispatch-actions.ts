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

  // --- Phase 4: create (or reset, after a failed attempt) the delivery task
  // with a fresh OTP. The plain OTP goes ONLY to the retailer; only its
  // SHA-256 hash is stored (lib/delivery/otp.ts, decision D5). ---
  const otp = generateDeliveryOtp();
  const otpHash = hashDeliveryOtp(orderId, otp);
  const nowIso = new Date().toISOString();

  const { data: existingDelivery } = await supabase
    .from('order_deliveries')
    .select('id, delivery_status')
    .eq('order_id', orderId)
    .maybeSingle<{ id: string; delivery_status: string }>();

  let deliveryId: string;
  if (existingDelivery) {
    // Re-dispatch after a failed attempt: reset the same task row.
    const { data: reset, error: resetError } = await supabase
      .from('order_deliveries')
      .update({
        delivery_status: 'assigned',
        assigned_staff_id: user.id,
        assigned_at: nowIso,
        assigned_by: user.id,
        dispatched_at: nowIso,
        in_progress_at: null,
        delivered_at: null,
        receiver_name: null,
        otp_hash: otpHash,
        otp_verified_at: null,
        otp_attempts: 0,
        signature_url: null,
        photo_url: null,
        delivery_notes: null,
        failure_reason: null,
        return_window_days: null,
        return_deadline: null,
        completed_by: null,
      } as never)
      .eq('id', existingDelivery.id)
      .eq('delivery_status', 'failed')
      .select('id')
      .maybeSingle<{ id: string }>();
    if (resetError) return { error: `Delivery task could not be reset: ${resetError.message}` };
    if (reset) {
      deliveryId = reset.id;
      await supabase.from('order_delivery_items').delete().eq('delivery_id', deliveryId);
    } else {
      return { error: 'A delivery task already exists for this order and is not in a failed state.' };
    }
  } else {
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
    deliveryId = inserted.id;
  }

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
    linkUrl: `/retailer/orders/${orderId}/delivery`,
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
