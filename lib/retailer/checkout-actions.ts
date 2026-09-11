'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { createInAppNotification } from '@/lib/notifications/notify';
import { createOrderForRetailer } from '@/lib/orders/create-order';
import { formatAddressLine } from '@/lib/retailer/address-shared';

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
 *
 * `addressId` (when provided) is resolved server-side through the
 * RLS-scoped session, so the frozen order snapshot is ALWAYS one of the
 * retailer's own saved addresses or the profile address — never a
 * client-typed string.
 */
export async function placeOrderAction(notes: string, addressId?: string): Promise<CheckoutResult> {
  const user = await requirePermission('orders.create');
  if (user.role !== 'retailer') return { error: 'Only a retailer can check out this cart.' };

  const supabase = createClient();
  const { data: cartData } = await supabase
    .from('cart_items')
    .select('pack_id, quantity')
    .eq('retailer_id', user.id);

  const items = (cartData ?? []) as CartItemForCheckout[];

  // Resolve the delivery address server-side: a saved address book entry
  // when an id is given, otherwise the profile address. Both flows freeze
  // the one-line address onto the order (0036) for invoice/delivery truth.
  let shippingAddress: { line: string; label?: string; receiverName?: string; phone?: string } | null = null;
  if (addressId) {
    const { data: address } = await supabase
      .from('retailer_addresses')
      .select('label, receiver_name, phone, line1, line2, landmark, city, district, state, pincode')
      .eq('id', addressId)
      .eq('retailer_id', user.id)
      .maybeSingle<{
        label: string;
        receiver_name: string;
        phone: string;
        line1: string;
        line2: string | null;
        landmark: string | null;
        city: string;
        district: string | null;
        state: string | null;
        pincode: string;
      } | never>();
    if (!address) return { error: 'The selected delivery address could not be found. Pick an address and try again.' };
    shippingAddress = {
      line: formatAddressLine(address),
      label: address.label,
      receiverName: address.receiver_name,
      phone: address.phone,
    };
  } else {
    const { data: retailer } = await supabase
      .from('retailers')
      .select('address')
      .eq('id', user.id)
      .maybeSingle<{ address: string | null }>();
    if (retailer?.address) shippingAddress = { line: retailer.address, label: 'Shop' };
  }

  const result = await createOrderForRetailer({
    retailerId: user.id,
    collectedBy: null,
    lines: items.map((item) => ({ packId: item.pack_id, quantity: item.quantity })),
    notes,
    shippingAddress,
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
