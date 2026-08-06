'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { createInAppNotification } from '@/lib/notifications/notify';
import type { Database } from '@/types/database.types';

type ReturnRequestInsert = Database['public']['Tables']['return_requests']['Insert'];
type CartItemInsert = Database['public']['Tables']['cart_items']['Insert'];

export type RetailerOrderActionResult = { error?: string } | { success: true; skippedCount?: number };

export async function cancelOrderAction(orderId: string, reason: string): Promise<RetailerOrderActionResult> {
  const user = await requirePermission('orders.cancel');
  const supabase = createClient();

  // RLS (orders_retailer_cancel) already restricts this to the
  // caller's own pending orders — the .eq() filters here just make
  // the intent explicit and give a clean error instead of a silent
  // no-op update.
  const { data, error } = await supabase
    .from('orders')
    .update({ status: 'cancelled', cancelled_reason: reason || null } as unknown as never)
    .eq('id', orderId)
    .eq('retailer_id', user.id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle<{ id: string }>();

  if (error) return { error: error.message };
  if (!data) return { error: 'This order can no longer be cancelled — it may already be processing.' };

  revalidatePath(`/retailer/orders/${orderId}`);
  revalidatePath('/retailer/orders');
  return { success: true };
}

interface PastOrderItem {
  pack_id: string | null;
  quantity: number;
  product_packs: { is_active: boolean; moq: number } | null;
  products: { is_active: boolean } | null;
}

export async function repeatOrderAction(orderId: string): Promise<RetailerOrderActionResult> {
  const user = await requirePermission('orders.create');
  const supabase = createClient();

  const { data: order } = await supabase
    .from('orders')
    .select('id')
    .eq('id', orderId)
    .eq('retailer_id', user.id)
    .maybeSingle<{ id: string }>();

  if (!order) return { error: 'Order not found.' };

  const { data: itemData } = await supabase
    .from('order_items')
    .select('pack_id, quantity, product_packs ( is_active, moq ), products ( is_active )')
    .eq('order_id', orderId);

  const items = (itemData ?? []) as unknown as PastOrderItem[];
  let skippedCount = 0;

  for (const item of items) {
    if (!item.pack_id || !item.product_packs?.is_active || !item.products?.is_active) {
      skippedCount += 1;
      continue;
    }

    const quantity = Math.max(item.quantity, item.product_packs.moq);

    const { data: existing } = await supabase
      .from('cart_items')
      .select('id, quantity')
      .eq('retailer_id', user.id)
      .eq('pack_id', item.pack_id)
      .maybeSingle<{ id: string; quantity: number }>();

    if (existing) {
      await supabase
        .from('cart_items')
        .update({ quantity: existing.quantity + quantity } as unknown as never)
        .eq('id', existing.id);
    } else {
      const payload: CartItemInsert = { retailer_id: user.id, pack_id: item.pack_id, quantity };
      await supabase.from('cart_items').insert(payload as unknown as never);
    }
  }

  revalidatePath('/retailer/cart');
  return { success: true, skippedCount };
}

export async function requestReturnAction(
  orderId: string,
  orderItemId: string | null,
  reason: string
): Promise<RetailerOrderActionResult> {
  const user = await requirePermission('orders.return.request');

  if (!reason.trim()) return { error: 'Please describe the reason for the return.' };

  const supabase = createClient();
  const payload: ReturnRequestInsert = {
    order_id: orderId,
    order_item_id: orderItemId,
    retailer_id: user.id,
    reason: reason.trim(),
  };

  // RLS (return_requests_retailer_insert) independently enforces that
  // this order belongs to the caller and is 'delivered' — if either
  // is false, this insert is rejected at the database level.
  const { error } = await supabase.from('return_requests').insert(payload as unknown as never);
  if (error) {
    return {
      error: error.message.includes('row-level security')
        ? 'Return requests can only be made for your own delivered orders.'
        : error.message,
    };
  }

  // Notify every staff/admin — return requests need review, and this
  // architecture's notifications table has a single recipient per
  // row, so a small broadcast loop (staff counts are small in a
  // district-level distributor, not thousands) is the correct
  // approach rather than adding a new broadcast mechanism.
  const { data: staffProfiles } = await supabase
    .from('profiles')
    .select('id')
    .in('role', ['staff', 'admin', 'super_admin'])
    .eq('is_active', true)
    .returns<{ id: string }[]>();

  for (const staff of staffProfiles ?? []) {
    await createInAppNotification({
      recipientId: staff.id,
      title: 'New return request',
      body: `A retailer has requested a return: ${reason.trim()}`,
      linkUrl: '/admin/returns',
    });
  }

  revalidatePath(`/retailer/orders/${orderId}`);
  return { success: true };
}
