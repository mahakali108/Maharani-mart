'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { createInAppNotification } from '@/lib/notifications/notify';
import type { Database } from '@/types/database.types';

type OrderInsert = Database['public']['Tables']['orders']['Insert'];
type OrderItemInsert = Database['public']['Tables']['order_items']['Insert'];

export type CheckoutResult = { error?: string } | { success: true; orderId: string };

interface CartItemForCheckout {
  id: string;
  quantity: number;
  pack_id: string;
  product_id: string;
  product_packs: { ptr: number | null; base_price: number; moq: number; is_active: boolean } | null;
  products: { gst_percent: number; is_active: boolean } | null;
}

interface PriceOverrideRow {
  product_id: string;
  scope: 'retailer' | 'area';
  price: number;
}

/**
 * Places an order from the retailer's current cart. Every price and
 * quantity is recomputed here from the database — nothing from the
 * client is trusted for money math, so this can never disagree with
 * what the cart page displayed (both read the same tables the same
 * way) and can never be manipulated by a tampered client request.
 */
export async function placeOrderAction(notes: string): Promise<CheckoutResult> {
  const user = await requirePermission('orders.create');
  const supabase = createClient();

  const { data: retailer } = await supabase
    .from('retailers')
    .select('area_id, status')
    .eq('id', user.id)
    .maybeSingle<{ area_id: string; status: string }>();

  if (!retailer) return { error: 'Retailer profile not found.' };
  if (retailer.status !== 'active') {
    return { error: 'Your account is not active. Contact your distributor before placing orders.' };
  }

  const { data: cartData } = await supabase
    .from('cart_items')
    .select(
      'id, quantity, pack_id, product_id, product_packs ( ptr, base_price, moq, is_active ), products ( gst_percent, is_active )'
    )
    .eq('retailer_id', user.id);

  const items = (cartData ?? []) as unknown as CartItemForCheckout[];
  if (items.length === 0) return { error: 'Your cart is empty.' };

  // Re-validate every line: reject the whole checkout if anything is
  // invalid, rather than silently dropping items the retailer didn't
  // explicitly agree to remove.
  for (const item of items) {
    if (!item.product_packs || !item.products) {
      return { error: 'One of the items in your cart no longer exists. Please review your cart.' };
    }
    if (!item.product_packs.is_active || !item.products.is_active) {
      return { error: 'One of the items in your cart is no longer available. Please remove it and try again.' };
    }
    if (item.quantity < item.product_packs.moq) {
      return { error: `Quantity for one item is below its minimum order quantity of ${item.product_packs.moq}.` };
    }
  }

  const productIds = [...new Set(items.map((i) => i.product_id))];
  const overrideByProduct = new Map<string, number>();
  const nowIso = new Date().toISOString();

  const { data: overrides } = await supabase
    .from('price_lists')
    .select('product_id, scope, price')
    .in('product_id', productIds)
    .in('scope', ['retailer', 'area'])
    .eq('is_active', true)
    .lte('valid_from', nowIso)
    .order('priority', { ascending: false })
    .returns<PriceOverrideRow[]>();

  for (const row of overrides ?? []) {
    const existing = overrideByProduct.get(row.product_id);
    if (existing === undefined || row.scope === 'retailer') {
      overrideByProduct.set(row.product_id, row.price);
    }
  }

  let subtotal = 0;
  let gstTotal = 0;
  const orderItemLines: { product_id: string; pack_id: string; quantity: number; unit_price: number; gst_percent: number; line_total: number }[] = [];

  for (const item of items) {
    const pack = item.product_packs!;
    const product = item.products!;
    const unitPrice = overrideByProduct.get(item.product_id) ?? pack.ptr ?? pack.base_price;
    const lineSubtotal = unitPrice * item.quantity;
    const lineGst = (lineSubtotal * product.gst_percent) / 100;

    subtotal += lineSubtotal;
    gstTotal += lineGst;

    orderItemLines.push({
      product_id: item.product_id,
      pack_id: item.pack_id,
      quantity: item.quantity,
      unit_price: unitPrice,
      gst_percent: product.gst_percent,
      line_total: lineSubtotal + lineGst,
    });
  }

  const grandTotal = subtotal + gstTotal;

  const orderPayload: OrderInsert = {
    retailer_id: user.id,
    status: 'pending',
    subtotal,
    gst_total: gstTotal,
    discount_total: 0,
    grand_total: grandTotal,
    notes: notes.trim() || null,
  };

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert(orderPayload as unknown as never)
    .select('id, order_number')
    .single<{ id: string; order_number: string }>();

  if (orderError || !order) {
    return { error: orderError?.message ?? 'Failed to create order.' };
  }

  const orderItemsPayload: OrderItemInsert[] = orderItemLines.map((line) => ({
    order_id: order.id,
    product_id: line.product_id,
    pack_id: line.pack_id,
    quantity: line.quantity,
    unit_price: line.unit_price,
    gst_percent: line.gst_percent,
    line_total: line.line_total,
  }));

  const { error: itemsError } = await supabase.from('order_items').insert(orderItemsPayload as unknown as never);

  if (itemsError) {
    // Roll back the order header so we don't leave an empty order behind.
    await supabase.from('orders').delete().eq('id', order.id);
    return { error: itemsError.message };
  }

  // Stock is intentionally NOT deducted here. In a real wholesale flow,
  // deduction happens when staff pack/dispatch the order (via
  // stock_movements), not at the moment a retailer places it — orders
  // can be partially fulfilled or backordered. That workflow is a
  // Staff-module feature, not part of retailer checkout.

  await supabase.from('cart_items').delete().eq('retailer_id', user.id);

  await createInAppNotification({
    recipientId: user.id,
    title: 'Order placed',
    body: `Your order ${order.order_number} has been placed and is awaiting confirmation.`,
    linkUrl: `/retailer/orders/${order.id}`,
  });

  revalidatePath('/retailer/cart');
  revalidatePath('/retailer/orders');
  redirect(`/retailer/orders/${order.id}`);
}
