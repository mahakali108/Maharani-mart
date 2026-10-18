import { z } from 'zod';
import { createOrderForRetailer, mapAtomicOrderError, replayOrderRequest } from '@/lib/orders/create-order';
import { createOrderRequestFingerprint } from '@/lib/orders/request-fingerprint';
import { loadActiveCouponForRetailer } from '@/lib/coupons/validate';
import {
  applyCursor,
  applyKeysetOrder,
  keysetCursorFor,
  readContinuation,
  toListBatch,
  type KeysetColumn,
} from '@/lib/infinite-scroll/keyset';
import {
  enforceRateLimit,
  jsonError,
  jsonOk,
  jsonOkPage,
  logServerError,
  newRequestId,
  parseJsonBody,
} from '@/lib/mobile';
import { requireRetailerCommerceSession, mobileCommerceErrorResponse } from '@/lib/mobile/commerce-route';
import {
  assertCartIntentMatches,
  isValidCartRequest,
  loadRetailerCartRows,
  MobileCommerceError,
  resolveMobileAddress,
} from '@/lib/mobile/commerce-service';
import { serializeMobileOrder, type MobileOrderRow } from '@/lib/mobile/order-data';
import { createClient } from '@/lib/supabase/server';
import { toPaise } from '@/lib/retailer/case-pricing';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;
const ORDER: KeysetColumn[] = [
  { column: 'placed_at', ascending: false },
  { column: 'id', ascending: false },
];

const submitSchema = z.object({
  lines: z.array(z.object({ packId: z.string().uuid(), quantity: z.number().int().min(1).max(100000) }).strict()).min(1).max(200),
  // Omitted/null is parsed for old clients, then rejected by the address
  // resolver: registered-shop free text cannot establish PIN coverage.
  addressId: z.string().uuid().nullable().default(null),
  notes: z.string().max(1000).default(''),
}).strict();

const ORDER_SELECT = 'id, order_number, status, subtotal, gst_total, discount_total, grand_total, placed_at, updated_at, notes, shipping_address, coins_balance_after_paise, order_items(id, product_id, pack_id, quantity, quantity_unit, quantity_pieces, units_per_case, unit_price, gst_percent, line_total, products(name), product_packs(pack_name))';

function orderErrorResponse(result: Exclude<Awaited<ReturnType<typeof createOrderForRetailer>>, { order: unknown }>, requestId: string): Response {
  const mapped = result.code ? result : mapAtomicOrderError(result.error);
  // Preserve the versioned mobile error vocabulary: older clients understand
  // conflict (refresh checkout) but do not recognise a new coverage code.
  const code = mapped.code === 'delivery_unavailable' ? 'conflict' : mapped.code ?? 'internal_error';
  const status = code === 'minimum_order_quantity' || code === 'coupon_invalid' || code === 'insufficient_stock'
    ? 422
    : code === 'warehouse_configuration_error' || code === 'database_unavailable' || code === 'internal_error'
      ? 503
      : 409;
  const details: Record<string, unknown> = {};
  if (mapped.available !== undefined) details.available = mapped.available;
  if (mapped.minQuantity !== undefined) details.minQuantity = mapped.minQuantity;
  return jsonError(code as Parameters<typeof jsonError>[0], mapped.error, {
    status,
    details: Object.keys(details).length ? details : undefined,
    requestId,
  });
}

/**
 * GET /api/mobile/v1/orders — this retailer's real order history, newest first.
 * POST /api/mobile/v1/orders — submit a reviewed cart using Idempotency-Key.
 */
export async function GET(request: Request): Promise<Response> {
  const requestId = newRequestId();
  const auth = await requireRetailerCommerceSession(request, requestId, 'orders.view.own');
  if ('response' in auth) return auth.response;
  const limited = enforceRateLimit('read.orders', request, { requestId, keySuffix: auth.session.userId });
  if (limited) return limited;

  const url = new URL(request.url);
  const continuation = readContinuation(url.searchParams.get('cursor'));
  if (!continuation.ok) {
    return jsonError('invalid_request', 'That order page reference is not valid. Refresh your order history.', {
      status: 400,
      details: { fields: { cursor: 'Not a valid cursor.' } },
      requestId,
    });
  }

  try {
    const supabase = auth.session.supabase as unknown as ReturnType<typeof createClient>;
    const query = supabase
      .from('orders')
      .select(ORDER_SELECT)
      .eq('retailer_id', auth.session.userId);
    const ordered = applyKeysetOrder(query, ORDER);
    const { data, error } = await applyCursor(ordered, continuation.cursor, ORDER, PAGE_SIZE)
      .returns<MobileOrderRow[]>();
    if (error) throw error;
    const batch = toListBatch(data ?? [], PAGE_SIZE, (row) => keysetCursorFor(row, ORDER));
    return jsonOkPage(
      batch.items.map((row) => serializeMobileOrder(row)),
      { nextCursor: batch.nextCursor, hasMore: batch.nextCursor !== null, limit: PAGE_SIZE },
      { requestId }
    );
  } catch (cause) {
    logServerError('orders.list', requestId, cause);
    return jsonError('database_unavailable', 'Your order history could not be loaded. Please try again.', {
      status: 503,
      requestId,
    });
  }
}

export async function POST(request: Request): Promise<Response> {
  const requestId = newRequestId();
  const auth = await requireRetailerCommerceSession(request, requestId, ['orders.create', 'orders.view.own']);
  if ('response' in auth) return auth.response;
  const limited = enforceRateLimit('write.orders', request, { requestId, keySuffix: auth.session.userId });
  if (limited) return limited;

  const requestKey = request.headers.get('Idempotency-Key')?.trim() ?? '';
  if (!z.string().uuid().safeParse(requestKey).success) {
    return jsonError('invalid_request', 'A valid Idempotency-Key is required before placing an order.', {
      status: 400,
      details: { fields: { 'Idempotency-Key': 'Send a UUID that stays the same for every retry of this order.' } },
      requestId,
    });
  }

  const parsed = await parseJsonBody(request, submitSchema, requestId);
  if (!parsed.ok) return parsed.response;
  if (!isValidCartRequest(parsed.data.lines)) {
    return jsonError('invalid_request', 'The reviewed cart contains repeated items or invalid quantities.', {
      status: 400,
      requestId,
    });
  }

  const notes = (parsed.data.notes ?? '').trim();
  const addressId = parsed.data.addressId ?? null;
  const requestContext = addressId ? `saved-address:${addressId}` : 'profile-address';
  const fingerprint = createOrderRequestFingerprint({
    retailerId: auth.session.userId,
    collectedBy: null,
    lines: parsed.data.lines,
    notes,
    context: requestContext,
  });
  const supabase = auth.session.supabase as unknown as ReturnType<typeof createClient>;

  try {
    // Recover before reading mutable cart/address/coupon state. If the previous
    // commit cleared the basket but its response was lost, this returns that
    // exact confirmed order without issuing another write.
    const previous = await replayOrderRequest({
      supabase,
      requestKey,
      retailerId: auth.session.userId,
      collectedBy: null,
      requestFingerprint: fingerprint,
    });
    if (previous) {
      if ('error' in previous) return orderErrorResponse(previous, requestId);
      const order = {
        id: previous.order.id,
        orderNumber: previous.order.orderNumber,
        status: previous.order.status,
        placedAt: previous.order.placedAt,
        grandTotalPaise: toPaise(previous.order.grandTotal),
        coinsUsedPaise: toPaise(previous.order.coinsUsed),
        balanceAfterCoinsPaise: previous.order.coinsBalanceAfterPaise,
        idempotentReplay: true,
      };
      return jsonOk({ order }, { status: 200, requestId });
    }

    const cartRows = await loadRetailerCartRows(auth.session);
    assertCartIntentMatches(cartRows, parsed.data.lines);
    const address = await resolveMobileAddress(auth.session, addressId);
    const activeCoupon = await loadActiveCouponForRetailer(supabase, auth.session.userId);
    if (activeCoupon.error) {
      throw new MobileCommerceError('database_unavailable', 503, 'The applied coupon could not be verified. Please try again.');
    }

    const result = await createOrderForRetailer({
      retailerId: auth.session.userId,
      collectedBy: null,
      lines: parsed.data.lines,
      notes,
      shippingAddress: address.snapshot,
      couponCode: activeCoupon.coupon?.code ?? null,
      requestKey,
      requestFingerprint: fingerprint,
      requestContext,
      clearCartAfterOrder: true,
      supabase,
    });
    if ('error' in result) return orderErrorResponse(result, requestId);

    return jsonOk({
      order: {
        id: result.order.id,
        orderNumber: result.order.orderNumber,
        status: result.order.status,
        placedAt: result.order.placedAt,
        grandTotalPaise: toPaise(result.order.grandTotal),
        coinsUsedPaise: toPaise(result.order.coinsUsed),
        balanceAfterCoinsPaise: result.order.coinsBalanceAfterPaise,
        idempotentReplay: result.order.idempotentReplay,
      },
    }, { status: result.order.idempotentReplay ? 200 : 201, requestId });
  } catch (cause) {
    if (cause instanceof MobileCommerceError) return mobileCommerceErrorResponse(cause, requestId);
    logServerError('orders.create', requestId, cause);
    return jsonError('database_unavailable', 'The order could not be confirmed. Check your order history before trying again.', {
      status: 503,
      requestId,
    });
  }
}
