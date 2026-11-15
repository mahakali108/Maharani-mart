'use server';

import { revalidatePath } from 'next/cache';
import { createTrustedDeliveryWriter, TRUSTED_WRITER_UNAVAILABLE } from '@/lib/delivery/trusted-writer';
import { requirePermission } from '@/lib/admin/guard';
import { notifyOrderEvent } from '@/lib/notifications/notify';
import { notifyLowStockIfNeeded } from '@/lib/inventory/alerts';
import { generateDeliveryOtp, hashDeliveryOtp } from '@/lib/delivery/otp';
import {
  FULFILMENT_NOT_INSTALLED,
  isDispatchResult,
  isFulfilmentRpcMissing,
  mapDispatchError,
} from '@/lib/delivery/fulfilment';

type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
};

export type DispatchResult = { error?: string } | { success: true };

/**
 * Dispatches an order through dispatch_order_atomic (migration 0100). Inside
 * that one transaction the database calls consume_order_stock, which:
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
  if (typeof orderId !== 'string' || !/^[0-9a-f-]{36}$/i.test(orderId)) return { error: 'Order not found.' };

  // Dispatch is one database transaction (migration 0100): stock deduction,
  // order status, delivery task (new, or reset after a failed attempt) and the
  // line snapshot commit together or not at all. It runs with the server's
  // trusted role; the database re-verifies this user's role and scope.
  const trusted = createTrustedDeliveryWriter();
  if (!trusted) return { error: TRUSTED_WRITER_UNAVAILABLE };

  // The OTP is generated here and only its keyed digest reaches the database.
  const otp = generateDeliveryOtp();
  const otpHash = hashDeliveryOtp(orderId, otp);

  const { data, error } = await (trusted as unknown as RpcClient).rpc('dispatch_order_atomic', {
    p_order_id: orderId,
    p_actor_id: user.id,
    p_otp_hash: otpHash,
  });
  if (error) {
    if (isFulfilmentRpcMissing(error)) return { error: FULFILMENT_NOT_INSTALLED };
    return { error: mapDispatchError(error.message) };
  }
  if (!isDispatchResult(data)) {
    return { error: 'This order could not be dispatched. Nothing was changed. Refresh and try again.' };
  }

  // After commit only. The OTP is visible to the retailer in-app only.
  await notifyOrderEvent({
    recipientId: data.retailer_id,
    title: 'Order dispatched',
    body: `Your order ${data.order_number} is on its way. Your delivery OTP is ${otp} — share it with the delivery person only after receiving your goods.`,
    channelBody: `Your order ${data.order_number} is on its way. Open the Maharani app to view your delivery OTP.`,
    linkUrl: `/retailer/orders/${orderId}/delivery`,
  });

  await notifyLowStockIfNeeded(Array.isArray(data.product_ids) ? data.product_ids : []);

  revalidatePath(`/staff/orders/${orderId}`);
  revalidatePath('/staff/orders');
  revalidatePath('/staff/deliveries');
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath('/admin/orders');
  revalidatePath('/admin/inventory');
  return { success: true };
}
