import 'server-only';

import { z } from 'zod';
import type { AICard, AIToolContext, AIToolDefinition } from '@/lib/ai/types';
import { getRetailerCoinPosition } from '@/lib/coins/server';
import { computeCoinPayment } from '@/lib/coins/math';
import { quoteOrderForRetailer } from '@/lib/orders/quote-order';
import { createConfirmationToken } from '@/lib/ai/safety/confirmation';
import { resolveRetailerTarget } from '@/lib/ai/safety/auth';
import { dbFailure, inr, unavailable, verified } from '@/lib/ai/tools/helpers';
import { formatRowQuantity, rowPieces, type OrderItemUnit} from '@/lib/orders/item-display';
import { formatIndiaDateTime } from '@/lib/datetime/india';

const orderIdSchema = z.object({ orderId: z.string().uuid() });
const retailerOptionalSchema = z.object({ retailerId: z.string().uuid().optional(), limit: z.number().int().min(1).max(30).optional(), status: z.enum(['pending', 'confirmed', 'processing', 'packed', 'dispatched', 'delivered', 'cancelled', 'returned']).optional() });

interface OrderRow { id: string; order_number: string; retailer_id: string; status: string; subtotal: number; gst_total: number; discount_total: number; grand_total: number; placed_at: string; notes?: string | null; retailers?: { shop_name: string } | null; }
interface OrderItemRow {
  id: string;
  order_id: string;
  product_id: string;
  pack_id: string | null;
  quantity: number;
  /** 'cases' | 'pieces' — the billing unit of this row (null on old rows). */
  quantity_unit: OrderItemUnit | null;
  /** Pieces this row covers, snapshotted at order time. */
  quantity_pieces: number | null;
  units_per_case: number | null;
  unit_price: number;
  gst_percent: number;
  line_total: number;
  products: { name: string; sku_code: string } | null;
  product_packs: { pack_name: string } | null;
}

function orderCard(order: OrderRow, context: AIToolContext, invoice = false): AICard {
  const base = context.actor.surface === 'retailer'
    ? '/retailer/orders'
    : context.actor.surface === 'salesman'
      ? '/salesman/orders'
      : context.actor.surface === 'staff'
        ? '/staff/orders'
        : '/admin/orders';
  return {
    type: invoice ? 'invoice' : 'order', id: order.id, title: invoice ? `Invoice ${order.order_number}` : order.order_number,
    subtitle: order.retailers?.shop_name ?? formatIndiaDateTime(order.placed_at), badge: order.status, quality: 'verified', source: 'RLS-authorized order record',
    metrics: [
      { label: 'Total', value: inr(order.grand_total), quality: 'verified' },
      { label: 'GST', value: inr(order.gst_total), quality: 'verified' },
      { label: 'Placed', value: formatIndiaDateTime(order.placed_at), quality: 'verified' },
    ],
    actions: [{ type: 'link', label: invoice && context.actor.surface === 'retailer' ? 'View invoice' : 'View order', href: invoice && context.actor.surface === 'retailer' ? `${base}/${order.id}/invoice` : `${base}/${order.id}`, tone: 'primary' }],
  };
}

async function listOrders(input: z.infer<typeof retailerOptionalSchema>, context: AIToolContext) {
  const target = resolveRetailerTarget(context.actor, input.retailerId);
  if (context.actor.role === 'salesman' && !target) return unavailable('Select an assigned retailer before requesting their orders.');
  let query = context.supabase.from('orders').select('id, order_number, retailer_id, status, subtotal, gst_total, discount_total, grand_total, placed_at, retailers ( shop_name )').order('placed_at', { ascending: false }).limit(input.limit ?? 10);
  if (target) query = query.eq('retailer_id', target);
  if (input.status) query = query.eq('status', input.status);
  const { data, error } = await query.returns<OrderRow[]>();
  if (error) return dbFailure();
  const orders = data ?? [];
  return verified({ orders }, orders.map((order) => orderCard(order, context)));
}

async function getOrder(orderId: string, context: AIToolContext) {
  const [{ data: order, error }, { data: items, error: itemError }] = await Promise.all([
    context.supabase.from('orders').select('id, order_number, retailer_id, status, subtotal, gst_total, discount_total, grand_total, placed_at, notes, retailers ( shop_name )').eq('id', orderId).maybeSingle<OrderRow>(),
    context.supabase.from('order_items').select('id, order_id, product_id, pack_id, quantity, quantity_unit, quantity_pieces, units_per_case, unit_price, gst_percent, line_total, products ( name, sku_code ), product_packs ( pack_name )').eq('order_id', orderId).returns<OrderItemRow[]>(),
  ]);
  if (error || itemError) return dbFailure();
  if (!order) return unavailable('That order was not found in your authorized data.');
  const card = orderCard(order, context);
  /*
   * Each row is shown with the unit it was billed in: new orders are one pieces
   * row per line at the per-piece rate, and the retailer is never shown a
   * case/loose split. Only pre-piece historical rows can carry a 'cases' unit.
   */
  card.lines = (items ?? []).map((item) => ({
    label: `${item.products?.name ?? 'Product'} · ${item.product_packs?.pack_name ?? 'Pack'}`,
    value: `${formatRowQuantity(item)} × ${inr(item.unit_price)}`,
    detail: `${rowPieces(item)} pcs · ${item.gst_percent}% GST · ${inr(item.line_total)}`,
  }));
  return verified({ order, items: items ?? [] }, [card]);
}

async function reorderDraft(orderId: string, context: AIToolContext) {
  if (context.actor.role !== 'retailer') return unavailable('Only a retailer cart can receive a reorder draft.');
  const details = await getOrder(orderId, context);
  if (!details.ok || !details.data) return details;
  const items = (details.data as { items: OrderItemRow[] }).items;
  // Reorder in PIECES: a previous line folds back into one piece-count request
  // (e.g. 46 pcs), which the server then prices with today's selling tiers.
  const piecesByPack = new Map<string, number>();
  for (const item of items) {
    if (!item.pack_id) continue;
    piecesByPack.set(item.pack_id, (piecesByPack.get(item.pack_id) ?? 0) + rowPieces(item));
  }
  const lines = [...piecesByPack.entries()].map(([packId, quantity]) => ({ packId, quantity }));
  const result = await quoteOrderForRetailer({ retailerId: context.actor.id, lines, supabase: context.supabase });
  if ('error' in result) return unavailable(`The previous order cannot be prepared with current rules: ${result.error}`);
  let token: string | undefined;
  try { token = createConfirmationToken(context.actor, 'add_to_cart', { lines }); } catch { /* configuration is reported by missing action */ }
  const card: AICard = {
    type: 'cart', title: `Reorder draft from ${(details.data as { order: OrderRow }).order.order_number}`, subtitle: 'Current price, MOQ, GST and coins were revalidated. No order was placed.', quality: 'verified', source: 'Previous owned order + shared current quote service',
    lines: result.quote.lines.map((line) => ({
      label: `${line.productName} · ${line.packName}`,
      value: `${line.pieces} pcs (${line.cases} Case${line.cases === 1 ? '' : 's'} + ${line.loosePieces} loose)`,
      detail: inr(line.lineTotal),
    })),
    metrics: [{ label: 'Subtotal', value: inr(result.quote.subtotal), quality: 'verified' }, { label: 'GST', value: inr(result.quote.gstTotal), quality: 'verified' }, { label: 'Current total', value: inr(result.quote.grandTotal), quality: 'verified' }],
    actions: [
      { type: 'link', label: 'Review cart', href: '/retailer/cart', tone: 'secondary' },
      ...(token ? [{ type: 'confirm_tool' as const, label: 'Add reorder to cart', confirmationToken: token, tone: 'primary' as const }] : []),
    ],
  };
  return verified({ draft: { lines, quote: result.quote }, orderPlaced: false }, [card]);
}

async function reorderSuggestions(context: AIToolContext) {
  const target = resolveRetailerTarget(context.actor);
  if (!target) return unavailable('Reorder suggestions require a retailer context.');
  const { data: orders, error } = await context.supabase.from('orders').select('id, placed_at').eq('retailer_id', target).neq('status', 'cancelled').order('placed_at', { ascending: false }).limit(60).returns<{ id: string; placed_at: string }[]>();
  if (error) return dbFailure();
  if (!orders || orders.length < 2) return verified({ suggestions: [], quality: 'insufficient_data' }, [{ type: 'notice', title: 'Not enough data yet', subtitle: 'At least two non-cancelled orders are needed for reorder interval estimates.', quality: 'unavailable' }]);
  const dateByOrder = new Map(orders.map((order) => [order.id, order.placed_at]));
  const { data: items, error: itemError } = await context.supabase.from('order_items').select('order_id, product_id, pack_id, quantity, quantity_unit, quantity_pieces, units_per_case, products ( name )').in('order_id', orders.map((order) => order.id)).limit(1000).returns<Array<{ order_id: string; product_id: string; pack_id: string | null; quantity: number; quantity_unit: OrderItemUnit | null; quantity_pieces: number | null; units_per_case: number | null; products: { name: string } | null }>>();
  if (itemError) return dbFailure();
  // Rows are per billing unit, so one order can hold two rows for the same
  // product (its cases row and its loose-pieces row). Fold them back into one
  // observation per order before estimating intervals, in PIECES.
  const piecesByOrderProduct = new Map<string, { orderId: string; productId: string; packId: string | null; name: string; pieces: number }>();
  for (const item of items ?? []) {
    const key = `${item.order_id}:${item.product_id}`;
    const entry = piecesByOrderProduct.get(key) ?? {
      orderId: item.order_id,
      productId: item.product_id,
      packId: item.pack_id,
      name: item.products?.name ?? 'Product',
      pieces: 0,
    };
    entry.pieces += rowPieces(item);
    piecesByOrderProduct.set(key, entry);
  }
  const groups = new Map<string, { name: string; packId: string | null; points: { date: number; quantity: number }[] }>();
  for (const entry of piecesByOrderProduct.values()) {
    const group = groups.get(entry.productId) ?? { name: entry.name, packId: entry.packId, points: [] };
    group.points.push({ date: +new Date(dateByOrder.get(entry.orderId)!), quantity: entry.pieces });
    groups.set(entry.productId, group);
  }
  const now = Date.now();
  const suggestions = [...groups.entries()].flatMap(([productId, group]) => {
    const unique = [...group.points].sort((a, b) => a.date - b.date);
    if (unique.length < 2) return [];
    const intervals = unique.slice(1).map((point, index) => (point.date - unique[index]!.date) / 86_400_000);
    const intervalDays = Math.max(1, Math.round(intervals.reduce((sum, value) => sum + value, 0) / intervals.length));
    const last = unique[unique.length - 1]!;
    const daysSince = Math.floor((now - last.date) / 86_400_000);
    const avgQuantity = Math.max(1, Math.round(unique.reduce((sum, point) => sum + point.quantity, 0) / unique.length));
    return [{ productId, productName: group.name, packId: group.packId, expectedIntervalDays: intervalDays, daysSinceLastOrder: daysSince, suggestedQuantity: avgQuantity, sampleOrders: unique.length, dueEstimate: daysSince >= Math.max(1, intervalDays - 2) }];
  }).sort((a, b) => Number(b.dueEstimate) - Number(a.dueEstimate)).slice(0, 20);
  const cards: AICard[] = suggestions.map((s) => ({ type: 'insight', id: s.productId, title: s.productName, subtitle: `Usually purchased about every ${s.expectedIntervalDays} days; last purchased ${s.daysSinceLastOrder} days ago.`, badge: s.dueEstimate ? 'May be due' : 'Not due yet', quality: 'estimate', source: `${s.sampleOrders} actual order occurrences`, metrics: [{ label: 'Suggested qty', value: `${s.suggestedQuantity} pcs`, quality: 'estimate' }, { label: 'Sample', value: `${s.sampleOrders} orders`, quality: 'verified' }] }));
  return verified({ suggestions, quality: 'estimate' }, cards, `${orders.length} authorized order headers and ${items?.length ?? 0} item rows`);
}

/**
 * 🪙 Coins — the ONLY balance a retailer has.
 *
 * Maharani Traders does not offer retailer credit, so this tool answers with the
 * coin position (available / spent / used by this order / remaining payable)
 * instead of a credit limit. The amount is read from the same server-side source
 * the checkout uses, so the assistant can never quote a balance the till would
 * disagree with.
 *
 * The legacy tool names (`get_retailer_credit`, `get_credit_summary`, …) still
 * resolve here so existing assistants and stored conversations keep working —
 * they simply report coins now.
 */
async function coinSummary(input: { retailerId?: string; orderValue?: number }, context: AIToolContext) {
  const target = resolveRetailerTarget(context.actor, input.retailerId);
  if (!target) return unavailable('A valid authorized retailer context is required.');

  const { data, error } = await context.supabase
    .from('retailers')
    .select('id, shop_name')
    .eq('id', target)
    .maybeSingle<{ id: string; shop_name: string }>();
  if (error) return dbFailure();
  if (!data) return unavailable('This shop was not found in your authorized data.');

  let position: Awaited<ReturnType<typeof getRetailerCoinPosition>>;
  try {
    position = await getRetailerCoinPosition(context.supabase as never, data.id);
  } catch {
    return unavailable('The coin balance could not be read right now.');
  }

  // An order value turns the balance into the exact checkout arithmetic:
  // coins used = min(balance, total); the rest is payable on delivery.
  const orderTotalPaise = input.orderValue === undefined ? null : Math.round(input.orderValue * 100);
  const payment = orderTotalPaise === null
    ? null
    : computeCoinPayment({ orderTotalPaise, balancePaise: position.balancePaise });

  return verified(
    {
      retailerId: data.id,
      coinsAvailable: position.balanceRupees,
      coinsSpent: position.outstandingPaise / 100,
      ...(payment
        ? {
            orderTotal: payment.orderTotalPaise / 100,
            coinsUsed: payment.usedPaise / 100,
            remainingPayable: payment.remainingPaise / 100,
          }
        : {}),
    },
    [
      {
        type: 'coins',
        title: context.actor.role === 'retailer' ? 'Your coins' : data.shop_name,
        quality: 'verified',
        source: 'Retailer wallet ledger + shared coin calculator',
        metrics: [
          { label: '🪙 Coins available', value: inr(position.balanceRupees), quality: 'verified' },
          { label: 'Coins spent', value: inr(position.outstandingPaise / 100), quality: 'verified' },
          ...(payment
            ? [
                { label: '🪙 Coins used on this order', value: inr(payment.usedPaise / 100), quality: 'verified' as const },
                { label: 'Remaining payable', value: inr(payment.remainingPaise / 100), quality: 'verified' as const },
              ]
            : []),
        ],
      },
    ]
  );
}

/** @deprecated Renamed to `coinSummary`; kept for existing importers. */
const creditSummary = coinSummary;

export const orderTools: AIToolDefinition[] = [
  { name: 'get_orders', description: 'List RLS-authorized orders with optional retailer/status filters.', actionClass: 'READ', roles: ['retailer', 'salesman', 'staff', 'admin', 'super_admin'], surfaces: ['retailer', 'salesman', 'staff', 'admin'], inputSchema: retailerOptionalSchema, inputJsonSchema: { type: 'object', additionalProperties: false, properties: { retailerId: { type: 'string', format: 'uuid' }, status: { type: 'string' }, limit: { type: 'integer', maximum: 30 } } }, execute: listOrders },
  { name: 'get_recent_orders', description: 'Get recent RLS-authorized orders.', actionClass: 'READ', roles: ['retailer', 'salesman', 'staff', 'admin', 'super_admin'], surfaces: ['retailer', 'salesman', 'staff', 'admin'], inputSchema: retailerOptionalSchema, inputJsonSchema: { type: 'object', additionalProperties: false, properties: { retailerId: { type: 'string', format: 'uuid' }, limit: { type: 'integer', maximum: 30 } } }, execute: listOrders },
  { name: 'get_order_details', description: 'Get a full RLS-authorized order and line details.', actionClass: 'READ', roles: ['retailer', 'salesman', 'staff', 'admin', 'super_admin'], surfaces: ['retailer', 'salesman', 'staff', 'admin'], inputSchema: orderIdSchema, inputJsonSchema: { type: 'object', additionalProperties: false, required: ['orderId'], properties: { orderId: { type: 'string', format: 'uuid' } } }, execute: async ({ orderId }, context) => getOrder(orderId, context) },
  { name: 'get_order_status', description: 'Get current status from an RLS-authorized order.', actionClass: 'READ', roles: ['retailer', 'salesman', 'staff', 'admin', 'super_admin'], surfaces: ['retailer', 'salesman', 'staff', 'admin'], inputSchema: orderIdSchema, inputJsonSchema: { type: 'object', additionalProperties: false, required: ['orderId'], properties: { orderId: { type: 'string', format: 'uuid' } } }, execute: async ({ orderId }, context) => getOrder(orderId, context) },
  { name: 'reorder_previous_order', description: 'Prepare a current validated reorder draft from an owned previous order. Never places an order.', actionClass: 'PREPARE', roles: ['retailer'], surfaces: ['retailer'], inputSchema: orderIdSchema, inputJsonSchema: { type: 'object', additionalProperties: false, required: ['orderId'], properties: { orderId: { type: 'string', format: 'uuid' } } }, execute: async ({ orderId }, context) => reorderDraft(orderId, context) },
  { name: 'get_reorder_suggestions', description: 'Estimate retailer reorder intervals using actual authorized purchase occurrences. Estimates are labeled.', actionClass: 'READ', roles: ['retailer'], surfaces: ['retailer'], inputSchema: z.object({}), inputJsonSchema: { type: 'object', additionalProperties: false }, execute: async (_, context) => reorderSuggestions(context) },
  { name: 'get_retailer_orders', description: 'Get orders for the current or explicitly selected RLS-authorized retailer.', actionClass: 'READ', roles: ['retailer', 'salesman', 'staff', 'admin', 'super_admin'], surfaces: ['retailer', 'salesman', 'staff', 'admin'], inputSchema: retailerOptionalSchema, inputJsonSchema: { type: 'object', additionalProperties: false, properties: { retailerId: { type: 'string', format: 'uuid' }, status: { type: 'string' }, limit: { type: 'integer' } } }, execute: listOrders },
  { name: 'get_retailer_coins', description: '🪙 Get the coin balance (available, spent) of the current or explicitly selected retailer. Coins are the only shop balance; there is no credit.', actionClass: 'READ', roles: ['retailer', 'salesman', 'staff', 'admin', 'super_admin'], surfaces: ['retailer', 'salesman', 'staff', 'admin'], inputSchema: z.object({ retailerId: z.string().uuid().optional(), orderValue: z.number().nonnegative().max(10_000_000).optional() }), inputJsonSchema: { type: 'object', additionalProperties: false, properties: { retailerId: { type: 'string', format: 'uuid' }, orderValue: { type: 'number', minimum: 0 } } }, execute: coinSummary },
  { name: 'get_coin_balance', description: '🪙 Get the coin balance of the current or explicitly selected retailer, using the shared coin source of truth.', actionClass: 'READ', roles: ['retailer', 'salesman', 'staff', 'admin', 'super_admin'], surfaces: ['retailer', 'salesman', 'staff', 'admin'], inputSchema: z.object({ retailerId: z.string().uuid().optional() }), inputJsonSchema: { type: 'object', additionalProperties: false, properties: { retailerId: { type: 'string', format: 'uuid' } } }, execute: coinSummary },
  { name: 'calculate_order_coin_impact', description: '🪙 Calculate how many coins an order of the given value would use, and what stays payable on delivery.', actionClass: 'READ', roles: ['retailer', 'salesman', 'staff', 'admin', 'super_admin'], surfaces: ['retailer', 'salesman', 'staff', 'admin'], inputSchema: z.object({ retailerId: z.string().uuid().optional(), orderValue: z.number().nonnegative().max(10_000_000) }), inputJsonSchema: { type: 'object', additionalProperties: false, required: ['orderValue'], properties: { retailerId: { type: 'string', format: 'uuid' }, orderValue: { type: 'number', minimum: 0 } } }, execute: coinSummary },
  // Legacy names kept so an existing assistant keeps working; they report coins.
  { name: 'get_credit_summary', description: 'Deprecated alias of get_retailer_coins — retailer credit was removed; this reports the 🪙 coin balance.', actionClass: 'READ', roles: ['retailer', 'salesman', 'admin', 'super_admin'], surfaces: ['retailer', 'salesman', 'admin'], inputSchema: z.object({ retailerId: z.string().uuid().optional(), orderValue: z.number().nonnegative().max(10_000_000).optional() }), inputJsonSchema: { type: 'object', additionalProperties: false, properties: { retailerId: { type: 'string', format: 'uuid' }, orderValue: { type: 'number', minimum: 0 } } }, execute: coinSummary },
  { name: 'get_retailer_credit', description: 'Deprecated alias of get_retailer_coins — retailer credit was removed; this reports the 🪙 coin balance.', actionClass: 'READ', roles: ['retailer', 'salesman', 'admin', 'super_admin'], surfaces: ['retailer', 'salesman', 'admin'], inputSchema: z.object({ retailerId: z.string().uuid().optional(), orderValue: z.number().nonnegative().max(10_000_000).optional() }), inputJsonSchema: { type: 'object', additionalProperties: false, properties: { retailerId: { type: 'string', format: 'uuid' }, orderValue: { type: 'number' } } }, execute: coinSummary },
  { name: 'get_available_credit', description: 'Deprecated alias of get_retailer_coins — retailer credit was removed; this reports 🪙 coins available.', actionClass: 'READ', roles: ['retailer', 'salesman', 'admin', 'super_admin'], surfaces: ['retailer', 'salesman', 'admin'], inputSchema: z.object({ retailerId: z.string().uuid().optional() }), inputJsonSchema: { type: 'object', additionalProperties: false, properties: { retailerId: { type: 'string', format: 'uuid' } } }, execute: coinSummary },
  { name: 'calculate_order_credit_impact', description: 'Deprecated alias of calculate_order_coin_impact — reports the 🪙 coins an order would use.', actionClass: 'READ', roles: ['retailer', 'salesman', 'admin', 'super_admin'], surfaces: ['retailer', 'salesman', 'admin'], inputSchema: z.object({ retailerId: z.string().uuid().optional(), orderValue: z.number().nonnegative().max(10_000_000) }), inputJsonSchema: { type: 'object', additionalProperties: false, required: ['orderValue'], properties: { retailerId: { type: 'string', format: 'uuid' }, orderValue: { type: 'number', minimum: 0 } } }, execute: coinSummary },
  { name: 'search_invoices', description: 'Search existing order-generated tax invoices in RLS-authorized order data.', actionClass: 'READ', roles: ['retailer', 'salesman', 'staff', 'admin', 'super_admin'], surfaces: ['retailer', 'salesman', 'staff', 'admin'], inputSchema: retailerOptionalSchema, inputJsonSchema: { type: 'object', additionalProperties: false, properties: { retailerId: { type: 'string', format: 'uuid' }, limit: { type: 'integer', maximum: 30 } } }, execute: async (input, context) => { const result = await listOrders(input, context); if (result.cards) result.cards = result.cards.map((card) => ({ ...card, type: 'invoice' as const, title: `Invoice ${card.title}`, actions: card.id ? [{ type: 'link', label: context.actor.surface === 'retailer' ? 'View invoice' : 'View order', href: context.actor.surface === 'retailer' ? `/retailer/orders/${card.id}/invoice` : `${context.actor.surface === 'salesman' ? '/salesman/orders' : context.actor.surface === 'staff' ? '/staff/orders' : '/admin/orders'}/${card.id}` }] : card.actions })); return result; } },
  { name: 'get_invoice', description: 'Get an existing order-generated invoice from RLS-authorized order data.', actionClass: 'READ', roles: ['retailer', 'salesman', 'staff', 'admin', 'super_admin'], surfaces: ['retailer', 'salesman', 'staff', 'admin'], inputSchema: orderIdSchema, inputJsonSchema: { type: 'object', additionalProperties: false, required: ['orderId'], properties: { orderId: { type: 'string', format: 'uuid' } } }, execute: async ({ orderId }, context) => getOrder(orderId, context) },
  { name: 'get_invoice_summary', description: 'Summarize verified subtotal, discount, GST and total from an order-generated invoice.', actionClass: 'READ', roles: ['retailer', 'salesman', 'staff', 'admin', 'super_admin'], surfaces: ['retailer', 'salesman', 'staff', 'admin'], inputSchema: orderIdSchema, inputJsonSchema: { type: 'object', additionalProperties: false, required: ['orderId'], properties: { orderId: { type: 'string', format: 'uuid' } } }, execute: async ({ orderId }, context) => getOrder(orderId, context) },
];

export { listOrders, getOrder, reorderDraft, reorderSuggestions, coinSummary, creditSummary };
