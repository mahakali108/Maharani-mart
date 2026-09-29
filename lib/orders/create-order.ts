import 'server-only';

import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { quoteOrderForRetailer } from '@/lib/orders/quote-order';
import { releaseOrderCoupon } from '@/lib/coupons/validate';
import type { Database } from '@/types/database.types';
import { debitCoinsForOrder, getOrderCoinMovement } from '@/lib/coins/server';
import { resolveActiveWarehouse } from '@/lib/warehouse/resolver';

type OrderInsert = Database['public']['Tables']['orders']['Insert'];
type OrderItemInsert = Database['public']['Tables']['order_items']['Insert'];
type SupabaseClient = ReturnType<typeof createClient>;

export interface RequestedOrderLine {
  packId: string;
  quantity: number;
}

export interface CreatedOrder {
  id: string;
  orderNumber: string;
  grandTotal: number;
  /** 🪙 Coins spent by this order (rupees, 2dp). */
  coinsUsed: number;
  /** What remains payable on delivery after coins (rupees, 2dp). */
  payableOnDelivery: number;
}

export type CreateOrderResult = { error: string } | { order: CreatedOrder };

interface RequestOrderRow {
  id: string;
  order_number: string;
  retailer_id: string;
  collected_by: string | null;
  grand_total: number;
  status: string;
  request_completed_at: string | null;
}

/** Return the original result for a repeated salesman form submission. */
async function replayRequestKey(
  supabase: SupabaseClient,
  requestKey: string,
  retailerId: string,
  collectedBy: string | null
): Promise<CreateOrderResult | null> {
  const { data: existing, error } = await supabase
    .from('orders')
    .select('id, order_number, retailer_id, collected_by, grand_total, status, request_completed_at')
    .eq('request_key', requestKey)
    .maybeSingle<RequestOrderRow>();

  if (error) return { error: 'The previous order attempt could not be verified. Refresh and check your orders.' };
  if (!existing) return null;
  if (existing.retailer_id !== retailerId || existing.collected_by !== collectedBy) {
    return { error: 'This order request key has already been used.' };
  }
  if (existing.status === 'cancelled') {
    return { error: 'This order request was already cancelled. Review the current stock and submit a new order.' };
  }
  if (!existing.request_completed_at) {
    return { error: 'This order request is still being finalized. Refresh your orders before trying again.' };
  }

  const { data: firstItem, error: itemError } = await supabase
    .from('order_items')
    .select('id')
    .eq('order_id', existing.id)
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (itemError) return { error: 'The previous order attempt could not be verified. Refresh and check your orders.' };
  if (!firstItem) {
    return { error: 'The previous order attempt did not finish. Change the order and submit it again.' };
  }

  const movement = await getOrderCoinMovement(supabase, existing.id, retailerId);
  const grandTotal = Number(existing.grand_total);
  const coinsUsed = movement.spentPaise / 100;
  return {
    order: {
      id: existing.id,
      orderNumber: existing.order_number,
      grandTotal,
      coinsUsed,
      payableOnDelivery: Math.max(0, grandTotal - coinsUsed),
    },
  };
}

/**
 * Convert the database stock guard's structured error into the compact message
 * requested on customer checkout: “Only X available”.
 */
export function orderCreationErrorMessage(message: string): string {
  const shortage = message.match(/INSUFFICIENT_STOCK:\s*(Only\s+\d+\s+available(?:\s+for\s+[^.\n]+)?)/i);
  return shortage?.[1]?.trim() ?? message;
}

/**
 * Shared server-only order creation path. The authoritative read/validation
 * phase lives in quoteOrderForRetailer and is rerun immediately before every
 * write; callers can only submit pack IDs, quantities and notes.
 */
export async function createOrderForRetailer({
  retailerId,
  collectedBy,
  lines,
  notes,
  shippingAddress,
  couponCode,
  requestKey,
}: {
  retailerId: string;
  collectedBy: string | null;
  lines: RequestedOrderLine[];
  notes: string;
  /** Stable per-submission key used by the salesman form for retries. */
  requestKey?: string | null;
  /** Server-verified delivery-address snapshot (0036); optional for legacy callers. */
  shippingAddress?: { line: string; label?: string; receiverName?: string; phone?: string } | null;
  /**
   * Raw coupon code applied to the cart (read server-side from the
   * retailer's active-coupon row — never client-supplied). Revalidated
   * inside the quote; the redemption is claimed atomically by the database
   * before the order is kept.
   */
  couponCode?: string | null;
}): Promise<CreateOrderResult> {
  const supabase = createClient();
  if (requestKey) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestKey)) {
      return { error: 'Invalid order request key.' };
    }
    if (!collectedBy) return { error: 'A capturing salesman is required for this retry-safe order.' };
    const previous = await replayRequestKey(supabase, requestKey, retailerId, collectedBy);
    if (previous) return previous;
  }

  const quoted = await quoteOrderForRetailer({ retailerId, lines, supabase, couponCode });
  if ('error' in quoted) return quoted;
  const { quote } = quoted;

  // New simple-stock orders require the one configured active warehouse,
  // resolved server-side. No client-supplied warehouse id is trusted.
  const warehouse = await resolveActiveWarehouse(supabase);
  if (!warehouse.ok) return { error: warehouse.message };

  const orderPayload: OrderInsert = {
    retailer_id: retailerId,
    collected_by: collectedBy,
    status: 'pending',
    subtotal: quote.subtotal,
    gst_total: quote.gstTotal,
    discount_total: quote.discountTotal,
    grand_total: quote.grandTotal,
    notes: notes.trim() || null,
    // 0036: the address that was true AT ORDER TIME, frozen onto the order.
    shipping_address: shippingAddress ?? null,
    // 0051: the coupon snapshot that was revalidated in the quote.
    coupon_id: quote.coupon?.id ?? null,
    coupon_code: quote.coupon?.code ?? null,
    coupon_discount: quote.coupon?.discount ?? 0,
    // Re-resolved and forced again by the database BEFORE INSERT.
    warehouse_id: warehouse.warehouse.id,
    request_key: requestKey ?? null,
  };

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert(orderPayload as unknown as never)
    .select('id, order_number')
    .single<{ id: string; order_number: string }>();
  if (orderError || !order) {
    if (requestKey && orderError?.code === '23505') {
      const previous = await replayRequestKey(supabase, requestKey, retailerId, collectedBy);
      if (previous) return previous;
    }
    return { error: orderError?.message ?? 'Failed to create order.' };
  }

  // Every quote line becomes one order_items row in pieces. The BEFORE INSERT
  // trigger locks the selected product pack, checks its current count and
  // atomically deducts it. A failure rolls the whole INSERT statement back.
  const itemPayloads: OrderItemInsert[] = quote.lines.flatMap((line) =>
    line.items.map((item) => ({
      order_id: order.id,
      product_id: line.productId,
      pack_id: line.packId,
      quantity: item.quantity,
      quantity_unit: item.quantityUnit,
      quantity_pieces: item.quantityPieces,
      units_per_case: item.unitsPerCase,
      unit_price: item.unitPrice,
      gst_percent: line.gstPercent,
      line_total: item.lineTotal,
    }))
  );
  const { error: itemsError } = await supabase.from('order_items').insert(itemPayloads as unknown as never);

  if (itemsError) {
    await supabase
      .from('orders')
      .update({ status: 'cancelled', cancelled_reason: 'Order line creation failed' } as unknown as never)
      .eq('id', order.id)
      .eq('status', 'pending');
    return { error: orderCreationErrorMessage(itemsError.message) };
  }

  // Coupon redemption (0051): claim the redemption atomically before the
  // wallet is debited. A failed claim cancels the order, whose status trigger
  // restores each simple-pack deduction exactly once.
  if (quote.coupon) {
    const { error: redeemError, data: redeemed } = await (
      supabase as unknown as {
        rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
      }
    ).rpc('redeem_coupon', {
      p_coupon_id: quote.coupon.id,
      p_retailer_id: retailerId,
      p_order_id: order.id,
      p_discount: quote.coupon.discount,
    });
    if (redeemError || redeemed === false) {
      await supabase
        .from('orders')
        .update({
          status: 'cancelled',
          cancelled_reason: redeemError ? `Coupon redemption failed: ${redeemError.message}` : 'Coupon usage limit reached at order time',
        } as unknown as never)
        .eq('id', order.id)
        .eq('status', 'pending');
      if (redeemError) await releaseOrderCoupon(supabase, order.id);
      return redeemError
        ? { error: redeemError.message }
        : { error: 'This coupon could not be redeemed (limit reached or no longer eligible). Please remove it and try again.' };
    }
  }

  // 🪙 Coins remain server-computed from the live balance and idempotent on
  // order:<id>. A debit failure cancels the order and restores pack stock.
  const debit = await debitCoinsForOrder(supabase, {
    retailerId,
    orderId: order.id,
    orderTotalPaise: Math.round(quote.grandTotal * 100),
    createdBy: collectedBy,
    description: `Order ${order.order_number} — ₹${quote.grandTotal.toFixed(2)}`,
  });

  if (!debit.ok) {
    await supabase
      .from('orders')
      .update({ status: 'cancelled', cancelled_reason: `Coin debit failed: ${debit.error}` } as unknown as never)
      .eq('id', order.id)
      .eq('status', 'pending');
    if (quote.coupon) await releaseOrderCoupon(supabase, order.id);
    return { error: `Your coins could not be applied: ${debit.error}` };
  }

  if (requestKey) {
    try {
      const finalizer = createServiceRoleClient() as unknown as {
        rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
      };
      const { data: completed, error: completionError } = await finalizer.rpc('complete_order_request', {
        p_order_id: order.id,
        p_request_key: requestKey,
        p_actor_id: collectedBy!,
      });
      if (completionError || completed !== true) {
        return { error: 'Your order could not be fully confirmed. Refresh your orders before trying again.' };
      }
    } catch {
      return { error: 'Your order could not be fully confirmed. Refresh your orders before trying again.' };
    }
  }

  return {
    order: {
      id: order.id,
      orderNumber: order.order_number,
      grandTotal: quote.grandTotal,
      coinsUsed: debit.usedPaise / 100,
      payableOnDelivery: debit.remainingPaise / 100,
    },
  };
}
