import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { quoteOrderForRetailer } from '@/lib/orders/quote-order';
import type { Database } from '@/types/database.types';
import { debitCoinsForOrder } from '@/lib/coins/server';
import { resolveActiveWarehouse } from '@/lib/warehouse/resolver';

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
  /** 🪙 Coins spent by this order (rupees, 2dp). */
  coinsUsed: number;
  /** What remains payable on delivery after coins (rupees, 2dp). */
  payableOnDelivery: number;
}

export type CreateOrderResult = { error: string } | { order: CreatedOrder };

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
}: {
  retailerId: string;
  collectedBy: string | null;
  lines: RequestedOrderLine[];
  notes: string;
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
  const quoted = await quoteOrderForRetailer({ retailerId, lines, supabase, couponCode });
  if ('error' in quoted) return quoted;
  const { quote } = quoted;

  // ONE active warehouse: resolved server-side and frozen onto the order, so a
  // freshly placed order is immediately dispatchable. A configuration problem
  // (0 or 2+ active warehouses) is reported to the operator rather than
  // guessed — the order is still taken, because refusing a shop's order is
  // worse than an operator fixing the warehouse before approval.
  const warehouse = await resolveActiveWarehouse(supabase);
  if (!warehouse.ok) {
    console.warn(`[orders] warehouse configuration error: ${warehouse.message}`);
  }

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
    // Single-warehouse assignment (never a client value).
    ...(warehouse.ok ? { warehouse_id: warehouse.warehouse.id } : {}),
  };

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert(orderPayload as unknown as never)
    .select('id, order_number')
    .single<{ id: string; order_number: string }>();
  if (orderError || !order) return { error: orderError?.message ?? 'Failed to create order.' };

  // Every quote line expands into ONE `order_items` row billed in PIECES at the
  // applicable retail tier rate. The row is internally exact (`unit_price ×
  // quantity = line_total`), `quantity_unit = 'pieces'` says what the row is
  // billed in, and `quantity_pieces` snapshots the piece count so an invoice, a
  // reorder or a dispatch never has to re-derive it from a pack configuration
  // that may change afterwards. Order totals are the sum of these rows, so the
  // persisted money always reconciles with the quote the retailer saw.
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
    return { error: itemsError.message };
  }

  // Coupon redemption (0051): claim the redemption ATOMICALLY in the database
  // (row-locked limit checks) BEFORE the wallet is debited. A concurrent
  // checkout that exhausted the coupon between the quote and this claim
  // fails here and the order is cancelled — the retailer never pays a
  // discount the database refused.
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
      return redeemError
        ? { error: redeemError.message }
        : { error: 'This coupon could not be redeemed (limit reached or no longer eligible). Please remove it and try again.' };
    }
  }

  // 🪙 COINS: the server decides the deduction from the LIVE balance — the
  // browser never sends an amount, and an order is never refused for a low
  // balance. The ledger write is atomic and idempotent (order:<id>), so a
  // retried checkout cannot spend the same coins twice.
  const debit = await debitCoinsForOrder(supabase, {
    retailerId,
    orderId: order.id,
    orderTotalPaise: Math.round(quote.grandTotal * 100),
    createdBy: collectedBy,
    description: `Order ${order.order_number} — ₹${quote.grandTotal.toFixed(2)}`,
  });

  if (!debit.ok) {
    // Coins could not be spent: cancel the order rather than create one whose
    // balance movement is unknown, and tell the caller exactly what happened.
    await supabase
      .from('orders')
      .update({ status: 'cancelled', cancelled_reason: `Coin debit failed: ${debit.error}` } as unknown as never)
      .eq('id', order.id)
      .eq('status', 'pending');
    return { error: `Your coins could not be applied: ${debit.error}` };
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
