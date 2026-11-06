import 'server-only';

import { randomUUID } from 'node:crypto';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { quoteOrderForRetailer } from '@/lib/orders/quote-order';
import { getOrderCoinMovement } from '@/lib/coins/server';
import { resolveActiveWarehouse } from '@/lib/warehouse/resolver';
import { createOrderRequestFingerprint } from '@/lib/orders/request-fingerprint';
import { checkDeliveryTerms, deliveryOrderBlocker, type DeliveryDestination } from '@/lib/config/delivery-serviceability';
import { isOrderingReady, ORDERING_NOT_ENABLED_MESSAGE } from '@/lib/compliance/ordering-readiness';
import type { Database } from '@/types/database.types';

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

export interface RequestedOrderLine {
  packId: string;
  quantity: number;
  /** Split-order identity (0064): the seller offer for this line, or null/omitted for the legacy Maharani pack line. */
  sellerOfferId?: string | null;
}

export interface CreatedOrder {
  id: string;
  orderNumber: string;
  status: string;
  placedAt: string;
  grandTotal: number;
  /** Coins actually spent, in rupees (2dp); never accepted from the client. */
  coinsUsed: number;
  /** Remaining amount on the order after Coins (legacy web terminology only). */
  payableOnDelivery: number;
  /** Wallet/Coins balance immediately after this order debit, in integer paise. */
  coinsBalanceAfterPaise: number | null;
  /** True when this is the original order returned for an idempotent retry. */
  idempotentReplay: boolean;
}

export type CreateOrderErrorCode =
  | 'idempotency_conflict'
  | 'conflict'
  | 'insufficient_stock'
  | 'minimum_order_quantity'
  | 'coupon_invalid'
  | 'ordering_not_enabled'
  | 'warehouse_configuration_error'
  | 'database_unavailable'
  | 'delivery_unavailable'
  | 'internal_error';

export type CreateOrderResult =
  | { error: string; code?: CreateOrderErrorCode; available?: number; minQuantity?: number }
  | { order: CreatedOrder };

interface RequestOrderRow {
  id: string;
  order_number: string;
  retailer_id: string;
  collected_by: string | null;
  grand_total: number;
  status: string;
  request_completed_at: string | null;
  request_fingerprint: string | null;
  placed_at: string;
  coins_balance_after_paise?: number | null;
}

interface AtomicOrderRow {
  id: string;
  orderNumber: string;
  status: string;
  grandTotalPaise: number;
  coinsUsedPaise: number;
  coinsBalanceAfterPaise: number | null;
  placedAt: string;
  replayed: boolean;
}

type AtomicOrderRpcArgs = Database['public']['Functions']['create_order_atomic']['Args'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/i;

function paiseToRupees(value: number): number {
  return Math.round(value) / 100;
}

function toCreatedOrder(row: AtomicOrderRow): CreatedOrder {
  const grandTotal = paiseToRupees(row.grandTotalPaise);
  const coinsUsed = paiseToRupees(row.coinsUsedPaise);
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    status: row.status,
    placedAt: row.placedAt,
    grandTotal,
    coinsUsed,
    // Keep the existing web-facing due amount separate from the actual wallet
    // balance, which is snapshotted by the atomic database transaction.
    payableOnDelivery: Math.max(0, grandTotal - coinsUsed),
    coinsBalanceAfterPaise: row.coinsBalanceAfterPaise,
    idempotentReplay: row.replayed,
  };
}

function isAtomicOrderRow(value: unknown): value is AtomicOrderRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Partial<AtomicOrderRow>;
  return typeof row.id === 'string'
    && typeof row.orderNumber === 'string'
    && typeof row.status === 'string'
    && typeof row.grandTotalPaise === 'number'
    && Number.isSafeInteger(row.grandTotalPaise)
    && row.grandTotalPaise >= 0
    && typeof row.coinsUsedPaise === 'number'
    && Number.isSafeInteger(row.coinsUsedPaise)
    && row.coinsUsedPaise >= 0
    && (row.coinsBalanceAfterPaise === null || (
      typeof row.coinsBalanceAfterPaise === 'number'
      && Number.isSafeInteger(row.coinsBalanceAfterPaise)
      && row.coinsBalanceAfterPaise >= 0
    ))
    && typeof row.placedAt === 'string'
    && typeof row.replayed === 'boolean';
}

/** Return the original result for a completed request-key submission. */
async function findOrderRequest(
  supabase: SupabaseClient,
  requestKey: string,
  retailerId: string,
  collectedBy: string | null,
  requestFingerprint: string
): Promise<CreateOrderResult | null> {
  const { data: existing, error } = await supabase
    .from('orders')
    .select('id, order_number, retailer_id, collected_by, grand_total, status, request_completed_at, request_fingerprint, placed_at, coins_balance_after_paise')
    .eq('request_key', requestKey)
    .maybeSingle<RequestOrderRow>();

  if (error) return { error: 'The previous order attempt could not be verified. Refresh and check your orders.', code: 'database_unavailable' };
  if (!existing) return null;
  if (existing.retailer_id !== retailerId || existing.collected_by !== collectedBy) {
    return { error: 'This order request key has already been used.', code: 'idempotency_conflict' };
  }
  if (existing.request_fingerprint && existing.request_fingerprint !== requestFingerprint) {
    return { error: 'This order request key was already used for different order details.', code: 'idempotency_conflict' };
  }
  // Pre-migration salesman requests had no fingerprint. They can only be
  // replayed by their original actor; a retailer request fails closed because
  // its original body cannot be verified.
  if (!existing.request_fingerprint && collectedBy === null) {
    return { error: 'This older order request cannot be verified safely. Check your order history before submitting again.', code: 'conflict' };
  }
  if (existing.status === 'cancelled') {
    return { error: 'This order request was already cancelled. Review the current stock and submit a new order.', code: 'conflict' };
  }
  if (!existing.request_completed_at) {
    return { error: 'This order request is still being finalized. Refresh your orders before trying again.', code: 'conflict' };
  }

  const { data: firstItem, error: itemError } = await supabase
    .from('order_items')
    .select('id')
    .eq('order_id', existing.id)
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (itemError) return { error: 'The previous order attempt could not be verified. Refresh and check your orders.', code: 'database_unavailable' };
  if (!firstItem) {
    return { error: 'The previous order attempt did not finish. Check order history before submitting again.', code: 'conflict' };
  }

  let movement: Awaited<ReturnType<typeof getOrderCoinMovement>>;
  try {
    movement = await getOrderCoinMovement(supabase, existing.id, retailerId);
  } catch {
    return { error: 'The previous order attempt could not be verified. Refresh and check your orders.', code: 'database_unavailable' };
  }
  const grandTotal = Number(existing.grand_total);
  const rawBalanceAfter = existing.coins_balance_after_paise;
  const coinsBalanceAfterPaise = rawBalanceAfter == null ? null : Number(rawBalanceAfter);
  if (!Number.isFinite(grandTotal) || grandTotal < 0
      || (coinsBalanceAfterPaise !== null && (!Number.isSafeInteger(coinsBalanceAfterPaise) || coinsBalanceAfterPaise < 0))) {
    return { error: 'The previous order attempt could not be verified. Refresh and check your orders.', code: 'database_unavailable' };
  }
  const coinsUsed = movement.spentPaise / 100;
  return {
    order: {
      id: existing.id,
      orderNumber: existing.order_number,
      status: existing.status,
      placedAt: existing.placed_at,
      grandTotal,
      coinsUsed,
      payableOnDelivery: Math.max(0, grandTotal - coinsUsed),
      coinsBalanceAfterPaise,
      idempotentReplay: true,
    },
  };
}

/** Public recovery check used by the mobile route before loading a mutable cart/address. */
export async function replayOrderRequest({
  supabase,
  requestKey,
  retailerId,
  collectedBy,
  requestFingerprint,
}: {
  supabase: SupabaseClient;
  requestKey: string;
  retailerId: string;
  collectedBy: string | null;
  requestFingerprint: string;
}): Promise<CreateOrderResult | null> {
  if (!UUID_RE.test(requestKey) || !SHA256_RE.test(requestFingerprint)) {
    return { error: 'Invalid order request identity.', code: 'internal_error' };
  }
  return findOrderRequest(supabase, requestKey, retailerId, collectedBy, requestFingerprint.toLowerCase());
}

/**
 * Convert the database stock guard's structured error into the customer-safe
 * "Only X available" message and the mobile API's typed error fields.
 */
export function orderCreationErrorMessage(message: string): string {
  const shortage = message.match(/INSUFFICIENT_STOCK:\s*(Only\s+\d+\s+available(?:\s+for\s+[^.\n]+)?)/i);
  return shortage?.[1]?.trim() ?? message;
}

export function mapAtomicOrderError(message: string): Exclude<CreateOrderResult, { order: CreatedOrder }> {
  const available = /INSUFFICIENT_STOCK:\s*Only\s+(\d+)\s+available/i.exec(message)?.[1];
  if (available !== undefined) {
    const count = Number(available);
    return {
      error: orderCreationErrorMessage(message),
      code: 'insufficient_stock',
      available: Number.isFinite(count) ? count : undefined,
    };
  }

  const minQuantity = /MINIMUM_ORDER_QUANTITY:\s*minimum is\s+(\d+)\s+pieces/i.exec(message)?.[1];
  if (minQuantity !== undefined) {
    const quantity = Number(minQuantity);
    return {
      error: `Minimum order quantity for this pack is ${quantity} pieces.`,
      code: 'minimum_order_quantity',
      minQuantity: Number.isFinite(quantity) ? quantity : undefined,
    };
  }
  if (/DELIVERY_ADDRESS_REQUIRED/i.test(message)) {
    return { error: 'Select a saved delivery address with district, state and a 6-digit PIN.', code: 'delivery_unavailable' };
  }
  if (/DELIVERY_AREA_UNAVAILABLE/i.test(message)) {
    return { error: 'Delivery is no longer confirmed for this address/PIN. Choose another address or contact the team.', code: 'delivery_unavailable' };
  }
  if (/DELIVERY_MINIMUM_NOT_MET/i.test(message)) {
    return { error: 'The order is below this PIN’s current delivery minimum. Refresh checkout before retrying.', code: 'delivery_unavailable' };
  }
  if (/DELIVERY_FEE_NOT_SUPPORTED/i.test(message)) {
    return { error: 'Online ordering is not available for this PIN while its delivery fee is being configured.', code: 'delivery_unavailable' };
  }
  if (/COUPON_INVALID/i.test(message)) {
    return { error: 'The applied coupon is no longer valid. Remove it or choose another coupon, then review the order again.', code: 'coupon_invalid' };
  }
  if (/WAREHOUSE_CONFIGURATION_ERROR|Warehouse configuration error/i.test(message)) {
    return { error: 'The warehouse setup is not ready for orders. Please contact Maharani Traders.', code: 'warehouse_configuration_error' };
  }
  if (/IDEMPOTENCY_CONFLICT/i.test(message)) {
    return { error: 'This order request key was already used for different order details.', code: 'idempotency_conflict' };
  }
  if (/CART_CHANGED|COIN_BALANCE_CHANGED|ORDER_QUOTE_INVALID|ORDER_PRICE_CHANGED|ORDER_REQUEST_INCOMPLETE|ORDER_REQUEST_CANCELLED|MINIMUM_ORDER_QUANTITY|PACK_UNAVAILABLE|RETAILER_NOT_ACTIVE|RETAILER_ASSIGNMENT_REQUIRED|Insufficient credit|Overdue limit/i.test(message)) {
    return { error: 'Your cart, availability or balance changed. Refresh the quote before placing the order.', code: 'conflict' };
  }
  return { error: 'The order could not be confirmed. Check your order history before trying again.', code: 'internal_error' };
}

/**
 * Shared server-only order creation path for retailer checkout and salesman
 * capture. Prices, GST, coupons and Coins are re-read by the existing
 * authoritative quote service; one server-only PostgreSQL RPC then writes the
 * order, lines, stock, coupon, coin movement, request completion and optional
 * cart clear atomically.
 */
export async function createOrderForRetailer({
  retailerId,
  collectedBy,
  lines,
  notes,
  shippingAddress,
  couponCode,
  requestKey,
  requestFingerprint,
  requestContext,
  clearCartAfterOrder = false,
  supabase: suppliedClient,
}: {
  retailerId: string;
  collectedBy: string | null;
  lines: RequestedOrderLine[];
  notes: string;
  /** Stable per-submission key. A UUID is generated when omitted. */
  requestKey?: string | null;
  /** Optional caller-computed hash of the canonical intent (server-created only). */
  requestFingerprint?: string;
  /** Non-sensitive context included in the hash, e.g. a verified address id. */
  requestContext?: string | null;
  /** Server-verified address; structured fields required for retailer self-checkout. */
  shippingAddress?: ({ line: string; label?: string; receiverName?: string; phone?: string } & DeliveryDestination) | null;
  /** Coupon code loaded from the retailer's own active-coupon row, never trusted from the app. */
  couponCode?: string | null;
  /** Clear a verified retailer cart in the same transaction for self-checkout. */
  clearCartAfterOrder?: boolean;
  /** Caller-scoped client. Mobile routes pass their verified bearer-token client. */
  supabase?: SupabaseClient;
}): Promise<CreateOrderResult> {
  // This must run before request parsing, replay lookup, delivery checks,
  // quoting, warehouse resolution, service-role order RPCs, Coins, cart
  // clearing, or any payment work. Callers provide no readiness input, so no
  // web/mobile/salesman payload can bypass the protected platform-settings gate.
  if (!await isOrderingReady()) {
    return { error: ORDERING_NOT_ENABLED_MESSAGE, code: 'ordering_not_enabled' };
  }

  const normalizedNotes = (notes ?? '').trim();
  if (normalizedNotes.length > 1000) return { error: 'Order notes must be 1000 characters or fewer.', code: 'internal_error' };

  const supabase = suppliedClient ?? (await createClient());
  const effectiveRequestKey = requestKey ?? randomUUID();
  if (!UUID_RE.test(effectiveRequestKey)) return { error: 'Invalid order request key.', code: 'internal_error' };

  const fingerprint = (requestFingerprint ?? createOrderRequestFingerprint({
    retailerId,
    collectedBy,
    lines,
    notes: normalizedNotes,
    context: requestContext,
    shippingAddress,
    couponCode,
  })).toLowerCase();
  if (!SHA256_RE.test(fingerprint)) return { error: 'Invalid order request fingerprint.', code: 'internal_error' };

  const previous = await findOrderRequest(
    supabase,
    effectiveRequestKey,
    retailerId,
    collectedBy,
    fingerprint
  );
  if (previous) return previous;

  // Salesman captures are a separately supervised, manual delivery workflow.
  // Retailer web + mobile self-checkout MUST pass verified structured address
  // fields and confirm live coverage before the service-role atomic RPC.
  const delivery = collectedBy === null ? await checkDeliveryTerms(supabase, shippingAddress) : null;
  if (delivery && !delivery.ok) {
    return { error: delivery.message, code: delivery.code === 'database_unavailable' ? 'database_unavailable' : 'delivery_unavailable' };
  }

  const quoted = await quoteOrderForRetailer({
    retailerId,
    lines,
    supabase,
    couponCode,
  });
  if ('error' in quoted) {
    return {
      error: quoted.error,
      code: quoted.code === 'coupon_invalid' ? 'coupon_invalid' : 'conflict',
    };
  }
  const { quote } = quoted;
  if (delivery) {
    const blocker = deliveryOrderBlocker(delivery, Math.round(quote.grandTotal * 100));
    if (blocker) return { error: blocker, code: 'delivery_unavailable' };
  }

  // Split orders that touch pack stock keep the warehouse rule; seller-stock
  // only orders need no warehouse (0065 profile-conditional trigger agrees).
  const isSplitOrder = quote.lines.some((line) => Boolean(line.sellerOfferId));
  const needsWarehouse = quote.fulfilmentProfile !== 'all_seller';
  if (needsWarehouse) {
    // Preserve the shared resolver's clear failure if zero/multiple warehouses
    // exist. The 0054 insert trigger independently re-checks this inside the
    // transaction, so a change after this read still rolls the order back.
    const warehouse = await resolveActiveWarehouse(supabase);
    if (!warehouse.ok) {
      return { error: warehouse.message, code: 'warehouse_configuration_error' };
    }
  }

  const atomicItems = quote.lines.map((line) => {
    const item = line.items[0];
    return {
      pack_id: line.packId,
      quantity: item?.quantity ?? line.quantity,
      unit_price: item?.unitPrice ?? line.unitPrice,
      gst_percent: line.gstPercent,
      line_total: item?.lineTotal ?? line.lineTotal,
      ...(isSplitOrder ? { seller_offer_id: line.sellerOfferId ?? null } : {}),
    };
  });

  try {
    // Split checkouts go through the source-aware v2 RPC (0065); offer-less
    // callers keep the byte-identical v1 entry point and semantics.
    const rpcName = isSplitOrder ? 'create_order_atomic_v2' : 'create_order_atomic';
    const writer = createServiceRoleClient() as unknown as {
      rpc: (name: 'create_order_atomic' | 'create_order_atomic_v2', args: AtomicOrderRpcArgs) => Promise<{
        data: unknown;
        error: { code?: string; message: string } | null;
      }>;
    };
    const { data, error } = await writer.rpc(rpcName, {
      p_retailer_id: retailerId,
      p_collected_by: collectedBy,
      p_request_key: effectiveRequestKey,
      p_request_fingerprint: fingerprint,
      p_notes: normalizedNotes || null,
      p_shipping_address: shippingAddress ?? null,
      p_subtotal: quote.subtotal,
      p_gst_total: quote.gstTotal,
      p_discount_total: quote.discountTotal,
      p_grand_total: quote.grandTotal,
      p_coupon_id: quote.coupon?.id ?? null,
      p_coupon_code: quote.coupon?.code ?? null,
      p_coupon_discount: quote.coupon?.discount ?? 0,
      p_expected_coins_used_paise: quote.coins.usedPaise,
      p_order_items: atomicItems,
      p_clear_cart_after_order: clearCartAfterOrder,
    });

    if (error) {
      // A concurrent request with the same UUID may have committed while this
      // request was loading the quote. Resolve the winner through caller-scoped
      // reads instead of returning a duplicate or retrying a new write.
      if (error.code === '23505') {
        const concurrent = await findOrderRequest(
          supabase,
          effectiveRequestKey,
          retailerId,
          collectedBy,
          fingerprint
        );
        if (concurrent) return concurrent;
      }
      return mapAtomicOrderError(error.message);
    }

    if (!isAtomicOrderRow(data)) {
      return { error: 'The order response could not be verified. Check your order history before trying again.', code: 'database_unavailable' };
    }
    return { order: toCreatedOrder(data) };
  } catch {
    // The commit outcome may be uncertain after a transport failure. The same
    // request key remains available for GET recovery and a safe retry.
    return { error: 'The order could not be confirmed. Check your order history before trying again.', code: 'database_unavailable' };
  }
}
