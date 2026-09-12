'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { canTransitionOrderStatus, type OrderStatus } from '@/lib/orders/state-machine';

export type PickPackResult = { error?: string } | { success: true };

interface OrderForFulfilment {
  id: string;
  order_number: string;
  status: OrderStatus;
  warehouse_id: string | null;
}

/**
 * Shared engine for the staff pick/pack workflow (confirmed → processing →
 * packed). The transition table lives in lib/orders/state-machine.ts; the
 * `.eq('status', expectedFrom)` guard makes the flip atomic, so two staff
 * members racing on the same order cannot both advance it. RLS
 * (orders_update_staff, 0037) independently restricts the update to orders
 * in the caller's assigned warehouse or area.
 */
async function advanceFulfilmentStatus(
  orderId: string,
  expectedFrom: OrderStatus,
  next: OrderStatus,
  actionLabel: string
): Promise<PickPackResult> {
  await requirePermission('orders.dispatch');
  if (!orderId) return { error: 'Order not found.' };

  const supabase = createClient();

  const { data: order } = await supabase
    .from('orders')
    .select('id, order_number, status, warehouse_id')
    .eq('id', orderId)
    .maybeSingle<OrderForFulfilment>();

  if (!order) return { error: 'Order not found or not assigned to you.' };
  if (!order.warehouse_id) return { error: 'This order has no warehouse assigned yet.' };
  if (!canTransitionOrderStatus(order.status, next)) {
    return {
      error: `Cannot mark ${actionLabel}: order ${order.order_number} is currently ${order.status}.`,
    };
  }
  if (order.status !== expectedFrom) {
    return { error: `Order ${order.order_number} is no longer ${expectedFrom} — refresh and try again.` };
  }

  const { data: updated, error } = await supabase
    .from('orders')
    .update({ status: next } as unknown as never)
    .eq('id', orderId)
    .eq('status', expectedFrom)
    .select('id')
    .maybeSingle<{ id: string }>();

  if (error) return { error: error.message };
  if (!updated) {
    return { error: `Order ${order.order_number} was changed by someone else — refresh and try again.` };
  }

  revalidatePath(`/staff/orders/${orderId}`);
  revalidatePath('/staff/orders');
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath('/admin/orders');
  return { success: true };
}

/** Pick start: confirmed → processing. */
export async function markProcessingAction(orderId: string): Promise<PickPackResult> {
  return advanceFulfilmentStatus(orderId, 'confirmed', 'processing', 'picking started');
}

/** Pack complete: processing → packed. */
export async function markPackedAction(orderId: string): Promise<PickPackResult> {
  return advanceFulfilmentStatus(orderId, 'processing', 'packed', 'packed');
}
