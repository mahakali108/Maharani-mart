'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { notifyOrderEvent } from '@/lib/notifications/notify';

export type DeliveryResult = { error?: string } | { success: true };

interface OrderForDelivery {
  status: string;
  retailer_id: string;
  order_number: string;
  notes: string | null;
}

export async function markDeliveredAction(orderId: string, deliveryNote: string): Promise<DeliveryResult> {
  await requirePermission('orders.deliver');
  const supabase = createClient();

  const { data: order } = await supabase
    .from('orders')
    .select('status, retailer_id, order_number, notes')
    .eq('id', orderId)
    .maybeSingle<OrderForDelivery>();

  if (!order) return { error: 'Order not found.' };
  if (order.status !== 'dispatched') return { error: 'Only dispatched orders can be marked delivered.' };

  const trimmedNote = deliveryNote.trim();
  const combinedNotes = trimmedNote
    ? [order.notes, `Delivery note: ${trimmedNote}`].filter(Boolean).join('\n')
    : order.notes;

  const { error } = await supabase
    .from('orders')
    .update({
      status: 'delivered',
      delivered_at: new Date().toISOString(),
      notes: combinedNotes,
    } as unknown as never)
    .eq('id', orderId);

  if (error) return { error: error.message };

  await notifyOrderEvent({
    recipientId: order.retailer_id,
    title: 'Order delivered',
    body: `Your order ${order.order_number} has been delivered.`,
    linkUrl: `/retailer/orders/${orderId}`,
  });

  revalidatePath(`/salesman/orders/${orderId}`);
  revalidatePath('/salesman/orders');
  return { success: true };
}
