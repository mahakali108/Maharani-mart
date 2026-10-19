'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { createInAppNotification } from '@/lib/notifications/notify';
import { createOrderForRetailer } from '@/lib/orders/create-order';
import { formatAddressLine } from '@/lib/retailer/address-shared';
import { loadActiveCouponForRetailer } from '@/lib/coupons/validate';

export type CheckoutResult = { error?: string } | { success: true; orderId: string };

interface CartItemForCheckout {
  pack_id: string;
  seller_offer_id: string | null;
  quantity: number;
}

/**
 * Places an order from the retailer's current cart through the shared
 * order service also used by salesman order capture. The service
 * re-reads and validates every pack, MOQ, price, GST rate, retailer
 * status and Coins balance; no client-supplied money value is trusted.
 *
 * `addressId` must select an owned saved address. The RLS-scoped server
 * freezes its structured district/state/PIN at checkout; free-form registered
 * shop text never establishes delivery coverage.
 */
export async function placeOrderAction(notes: string, addressId?: string): Promise<CheckoutResult> {
  const user = await requirePermission('orders.create');
  if (user.role !== 'retailer') return { error: 'Only a retailer can check out this cart.' };

  const supabase = createClient();

  // Read the persisted basket without clearing it. `create_order_atomic` takes
  // the same per-retailer cart lock as every add/update/remove, verifies that
  // these exact lines are still present, and clears them only in the transaction
  // that commits the order. A failed or uncertain response therefore never
  // re-adds a cart beside an order that may already have committed.
  const { data: cart, error: cartError } = await supabase
    .from('cart_items')
    .select('pack_id, seller_offer_id, quantity')
    .eq('retailer_id', user.id);

  if (cartError) return { error: 'Your cart could not be prepared for checkout. Please try again.' };
  const items = (cart ?? []) as CartItemForCheckout[];
  if (items.length === 0) {
    return { error: 'Your cart is empty — add products before placing an order.' };
  }

  // Resolve an OWNED saved address. The unstructured registered-shop text
  // cannot establish district/PIN coverage and cannot be used for checkout.
  let shippingAddress: { line: string; label?: string; receiverName?: string; phone?: string; district?: string | null; state?: string | null; pincode?: string } | null = null;
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
    if (!address) {
      return { error: 'The selected delivery address could not be found. Pick an address and try again.' };
    }
    shippingAddress = {
      line: formatAddressLine(address),
      district: address.district,
      state: address.state,
      pincode: address.pincode,
      label: address.label,
      receiverName: address.receiver_name,
      phone: address.phone,
    };
  } else {
    return { error: 'Add and select a saved delivery address with district, state and PIN to check coverage.' };
  }

  // The applied coupon is read from the retailer's OWN active-coupon row via
  // the RLS-scoped session — the client only ever submits notes/address. The
  // quote inside createOrderForRetailer revalidates it against fresh database
  // state before the order transaction applies any stock, coupon or Coins effects (0056).
  const activeCoupon = await loadActiveCouponForRetailer(supabase, user.id);
  if (activeCoupon.error) {
    return { error: 'The applied coupon could not be verified. Please open your cart and try again.' };
  }

  const result = await createOrderForRetailer({
    retailerId: user.id,
    collectedBy: null,
    lines: items.map((item) => ({ packId: item.pack_id, quantity: item.quantity })).map((line, i) =>
      items[i]?.seller_offer_id ? { ...line, sellerOfferId: items[i]!.seller_offer_id } : line
    ),
    notes,
    shippingAddress,
    couponCode: activeCoupon.coupon?.code ?? null,
    clearCartAfterOrder: true,
  });

  if ('error' in result) {
    // PostgreSQL rolls back the order and cart-clear together. On an uncertain
    // transport failure, the retailer can inspect order history; never invent a
    // second cart write that could duplicate goods beside a committed order.
    return { error: result.error };
  }

  // Coupon redemption and pointer removal are part of create_order_atomic.
  revalidatePath('/retailer/coupons');

  // Notifications are ancillary to the completed, persisted order. A
  // delivery failure must not tell the retailer their order failed and
  // invite an accidental duplicate submission.
  try {
    await createInAppNotification({
      recipientId: user.id,
      title: 'Order placed',
      body: `Your order ${result.order.orderNumber} has been placed and is awaiting confirmation.`,
      linkUrl: `/retailer/orders/${result.order.id}`,
      category: 'order',
    });
  } catch (error) {
    console.error('Order placed but notification creation failed.', error);
  }

  revalidatePath('/retailer/cart');
  revalidatePath('/retailer/orders');
  redirect(`/retailer/orders/${result.order.id}?placed=1`);
}
