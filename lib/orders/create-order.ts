import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { getProductPriceOverride, resolvePackPrice } from '@/lib/retailer/effective-price';
import type { Database } from '@/types/database.types';

type OrderInsert = Database['public']['Tables']['orders']['Insert'];
type OrderItemInsert = Database['public']['Tables']['order_items']['Insert'];

export interface RequestedOrderLine {
  packId: string;
  quantity: number;
}

export interface CreatedOrder {
  id: string;
  orderNumber: string;
  grandTotal: number;
}

export type CreateOrderResult = { error: string } | { order: CreatedOrder };

interface RetailerForOrder {
  id: string;
  area_id: string;
  status: 'pending_approval' | 'active' | 'suspended';
  credit_limit: number;
  outstanding_balance: number;
}

interface PackForOrder {
  id: string;
  product_id: string;
  pack_name: string;
  base_price: number;
  ptr: number | null;
  moq: number;
  is_active: boolean;
  products: { id: string; name: string; gst_percent: number; is_active: boolean } | null;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * The shared, server-only order creation path used by both retailer
 * checkout and salesman order capture. It deliberately accepts only
 * pack IDs and quantities: pack availability, MOQ, retailer status,
 * effective price, GST, credit, and all monetary totals are read and
 * recalculated from Supabase immediately before the write.
 *
 * RLS remains part of the authorization boundary. In particular, a
 * salesman cannot read the retailer row unless assigned to it, and the
 * orders INSERT policy independently requires that same assignment.
 */
export async function createOrderForRetailer({
  retailerId,
  collectedBy,
  lines,
  notes,
}: {
  retailerId: string;
  collectedBy: string | null;
  lines: RequestedOrderLine[];
  notes: string;
}): Promise<CreateOrderResult> {
  if (lines.length === 0) return { error: 'Add at least one product to the order.' };
  if (lines.length > 200) return { error: 'An order can contain at most 200 different packs.' };

  const normalizedLines = new Map<string, number>();
  for (const line of lines) {
    if (!line.packId || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 100000) {
      return { error: 'Every order line must have a valid whole-number quantity.' };
    }
    if (normalizedLines.has(line.packId)) {
      return { error: 'The same pack cannot be added more than once.' };
    }
    normalizedLines.set(line.packId, line.quantity);
  }

  const supabase = createClient();
  const { data: retailer } = await supabase
    .from('retailers')
    .select('id, area_id, status, credit_limit, outstanding_balance')
    .eq('id', retailerId)
    .maybeSingle<RetailerForOrder>();

  // This intentionally uses the same message for missing and denied
  // rows so a caller cannot use the action to enumerate retailers.
  if (!retailer) return { error: 'Retailer not found or not assigned to you.' };
  if (retailer.status !== 'active') {
    return { error: 'Orders can only be created for an active retailer.' };
  }

  const packIds = [...normalizedLines.keys()];
  const { data: packData, error: packError } = await supabase
    .from('product_packs')
    .select('id, product_id, pack_name, base_price, ptr, moq, is_active, products ( id, name, gst_percent, is_active )')
    .in('id', packIds);

  if (packError) return { error: 'The product catalog could not be loaded. Please try again.' };

  const packs = (packData ?? []) as unknown as PackForOrder[];
  const packById = new Map(packs.map((pack) => [pack.id, pack]));

  for (const [packId, quantity] of normalizedLines) {
    const pack = packById.get(packId);
    if (!pack || !pack.products) return { error: 'One of the selected packs no longer exists.' };
    if (!pack.is_active || !pack.products.is_active) {
      return { error: `${pack.products.name} (${pack.pack_name}) is no longer available.` };
    }
    if (quantity < pack.moq) {
      return { error: `Minimum order quantity for ${pack.products.name} (${pack.pack_name}) is ${pack.moq}.` };
    }
  }

  const productIds = [...new Set(packs.map((pack) => pack.product_id))];
  const overrides = await Promise.all(
    productIds.map(async (productId) => [
      productId,
      await getProductPriceOverride(supabase, productId, retailer.id, retailer.area_id),
    ] as const)
  );
  const overrideByProduct = new Map(overrides);

  let subtotal = 0;
  let gstTotal = 0;
  const orderItemLines: Omit<OrderItemInsert, 'order_id'>[] = [];

  // Iterate in request order so order detail screens remain intuitive.
  for (const [packId, quantity] of normalizedLines) {
    const pack = packById.get(packId)!;
    const product = pack.products!;
    const unitPrice = roundMoney(resolvePackPrice(pack, overrideByProduct.get(pack.product_id) ?? null));
    const lineSubtotal = roundMoney(unitPrice * quantity);
    const lineGst = roundMoney((lineSubtotal * product.gst_percent) / 100);

    subtotal = roundMoney(subtotal + lineSubtotal);
    gstTotal = roundMoney(gstTotal + lineGst);
    orderItemLines.push({
      product_id: pack.product_id,
      pack_id: pack.id,
      quantity,
      unit_price: unitPrice,
      gst_percent: product.gst_percent,
      line_total: roundMoney(lineSubtotal + lineGst),
    });
  }

  const grandTotal = roundMoney(subtotal + gstTotal);
  // A zero limit is treated as "not configured", preserving the
  // existing checkout behavior until an admin explicitly sets a limit.
  if (retailer.credit_limit > 0 && roundMoney(retailer.outstanding_balance + grandTotal) > retailer.credit_limit) {
    const available = Math.max(0, roundMoney(retailer.credit_limit - retailer.outstanding_balance));
    return { error: `This order exceeds the retailer's available credit of ₹${available.toFixed(2)}.` };
  }

  const orderPayload: OrderInsert = {
    retailer_id: retailer.id,
    collected_by: collectedBy,
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

  if (orderError || !order) return { error: orderError?.message ?? 'Failed to create order.' };

  const itemPayloads: OrderItemInsert[] = orderItemLines.map((line) => ({ ...line, order_id: order.id }));
  const { error: itemsError } = await supabase.from('order_items').insert(itemPayloads as unknown as never);

  if (itemsError) {
    // Keep the header auditable rather than granting clients DELETE access
    // to pending orders. The status-history trigger records this failure.
    await supabase
      .from('orders')
      .update({ status: 'cancelled', cancelled_reason: 'Order line creation failed' } as unknown as never)
      .eq('id', order.id)
      .eq('status', 'pending');
    return { error: itemsError.message };
  }

  return {
    order: { id: order.id, orderNumber: order.order_number, grandTotal },
  };
}
