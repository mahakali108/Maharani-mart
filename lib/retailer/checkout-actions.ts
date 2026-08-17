'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { createInAppNotification } from '@/lib/notifications/notify';
import { createOrderForRetailer } from '@/lib/orders/create-order';

export type CheckoutResult = { error?: string } | { success: true; orderId: string };

interface CartItemForCheckout {
  pack_id: string;
  quantity: number;
}

/**
 * Places an order from the retailer's current cart through the shared
 * order service also used by salesman order capture. The service
 * re-reads and validates every pack, MOQ, price, GST rate, retailer
 * status, and credit value; no client-supplied money value is trusted.
 */
export async function placeOrderAction(notes: string): Promise<CheckoutResult> {
  const user = await requirePermission('orders.create');
  if (user.role !== 'retailer') return { error: 'Only a retailer can check out this cart.' };

  const supabase = createClient();
  const { data: cartData } = await supabase
    .from('cart_items')
    .select('pack_id, quantity')
    .eq('retailer_id', user.id);

  const items = (cartData ?? []) as CartItemForCheckout[];
  const result = await createOrderForRetailer({
    retailerId: user.id,
    collectedBy: null,
    lines: items.map((item) => ({ packId: item.pack_id, quantity: item.quantity })),
    notes,
  });

  if ('error' in result) return { error: result.error };

  await supabase.from('cart_items').delete().eq('retailer_id', user.id);

  // Notifications are ancillary to the completed, persisted order. A
  // delivery failure must not tell the retailer their order failed and
  // invite an accidental duplicate submission.
  try {
    await createInAppNotification({
      recipientId: user.id,
      title: 'Order placed',
      body: `Your order ${result.order.orderNumber} has been placed and is awaiting confirmation.`,
      linkUrl: `/retailer/orders/${result.order.id}`,
    });
  } catch (error) {
    console.error('Order placed but notification creation failed.', error);
  }

  revalidatePath('/retailer/cart');
  revalidatePath('/retailer/orders');
  redirect(`/retailer/orders/${result.order.id}?placed=1`);
}
