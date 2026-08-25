import 'server-only';

import { z } from 'zod';
import type { AICard, AIToolContext, AIToolDefinition, AIToolResult } from '@/lib/ai/types';
import { addCartLines, clearRetailerCart, removeCartLine, updateCartLine } from '@/lib/retailer/cart-service';
import { quoteOrderForRetailer, type OrderQuote, type RequestedQuoteLine } from '@/lib/orders/quote-order';
import { createConfirmationToken } from '@/lib/ai/safety/confirmation';
import { dbFailure, inr, unavailable, verified } from '@/lib/ai/tools/helpers';
import { stockForProducts } from '@/lib/ai/tools/products';

const lineSchema = z.object({ packId: z.string().uuid(), quantity: z.number().int().min(1).max(100000) });
const linesSchema = z.object({ lines: z.array(lineSchema).min(1).max(100) });
const LINE_JSON = {
  type: 'object', additionalProperties: false, required: ['lines'], properties: {
    lines: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object', additionalProperties: false, required: ['packId', 'quantity'], properties: { packId: { type: 'string', format: 'uuid' }, quantity: { type: 'integer', minimum: 1, maximum: 100000 } } } },
  },
};

function quoteCard(quote: OrderQuote, title = 'Cart preview'): AICard {
  const q = quote as { lines: Array<{ productName: string; packName: string; quantity: number; lineTotal: number }>; subtotal: number; gstTotal: number; discountTotal: number; grandTotal: number; credit: { availableCredit: number | null; exceedsLimit: boolean } };
  return {
    type: 'cart', title, subtitle: `${q.lines.length} verified line item${q.lines.length === 1 ? '' : 's'}`, quality: 'verified',
    source: 'Shared order quote service: current price, MOQ, GST and credit',
    lines: q.lines.map((line) => ({ label: `${line.productName} · ${line.packName}`, value: `${line.quantity} × ${inr(line.lineTotal / line.quantity)}`, detail: inr(line.lineTotal) })),
    metrics: [
      { label: 'Subtotal', value: inr(q.subtotal), quality: 'verified' },
      { label: 'GST', value: inr(q.gstTotal), quality: 'verified' },
      { label: 'Total', value: inr(q.grandTotal), quality: 'verified' },
      { label: 'Credit check', value: q.credit.exceedsLimit ? 'Exceeds available credit' : 'Within configured credit', quality: 'verified' },
    ],
    actions: [{ type: 'link', label: 'Review cart', href: '/retailer/cart', tone: 'secondary' }],
  };
}

async function getCurrentCart(context: AIToolContext): Promise<AIToolResult> {
  const { data, error } = await context.supabase.from('cart_items').select('id, pack_id, quantity').eq('retailer_id', context.actor.id).order('updated_at', { ascending: false }).returns<{ id: string; pack_id: string; quantity: number }[]>();
  if (error) return dbFailure();
  if (!data?.length) return verified({ items: [], quote: null }, [{ type: 'cart', title: 'Your cart is empty', quality: 'verified', actions: [{ type: 'link', label: 'Browse catalog', href: '/retailer/catalog' }] }]);
  const result = await quoteOrderForRetailer({ retailerId: context.actor.id, lines: data.map((item) => ({ packId: item.pack_id, quantity: item.quantity })), supabase: context.supabase });
  if ('error' in result) return unavailable(result.error);
  return verified({ items: data, quote: result.quote }, [quoteCard(result.quote)]);
}

async function prepareBudgetCart(budget: number, context: AIToolContext): Promise<AIToolResult> {
  const { data: orderRows, error } = await context.supabase.from('orders').select('id').eq('retailer_id', context.actor.id).neq('status', 'cancelled').order('placed_at', { ascending: false }).limit(30).returns<{ id: string }[]>();
  if (error) return dbFailure();
  const orderIds = (orderRows ?? []).map((row) => row.id);
  const history = orderIds.length
    ? await context.supabase.from('order_items').select('product_id, pack_id, quantity').in('order_id', orderIds).limit(500).returns<{ product_id: string; pack_id: string | null; quantity: number }[]>()
    : { data: [] as { product_id: string; pack_id: string | null; quantity: number }[], error: null };
  if (history.error) return dbFailure();

  const frequency = new Map<string, { productId: string; packId: string; count: number; totalQuantity: number }>();
  for (const row of history.data ?? []) {
    if (!row.pack_id) continue;
    const existing = frequency.get(row.pack_id) ?? { productId: row.product_id, packId: row.pack_id, count: 0, totalQuantity: 0 };
    existing.count += 1;
    existing.totalQuantity += row.quantity;
    frequency.set(row.pack_id, existing);
  }

  let candidates = [...frequency.values()].sort((a, b) => b.count - a.count);
  if (candidates.length === 0) {
    const { data: products, error: productError } = await context.supabase
      .from('products')
      .select('id, product_packs ( id, moq, is_active, sort_order )')
      .eq('is_active', true).order('created_at', { ascending: false }).limit(30)
      .returns<{ id: string; product_packs: { id: string; moq: number; is_active: boolean; sort_order: number }[] }[]>();
    if (productError) return dbFailure();
    candidates = (products ?? []).flatMap((product) => {
      const pack = [...product.product_packs].filter((p) => p.is_active).sort((a, b) => a.sort_order - b.sort_order)[0];
      return pack ? [{ productId: product.id, packId: pack.id, count: 0, totalQuantity: pack.moq }] : [];
    });
  }

  const stock = await stockForProducts(context, candidates.map((candidate) => candidate.productId));
  const available = candidates.filter((candidate) => (stock.get(candidate.productId)?.available ?? 0) > 0).slice(0, 15);
  const { data: packRows, error: packError } = available.length
    ? await context.supabase.from('product_packs').select('id, moq').in('id', available.map((candidate) => candidate.packId)).eq('is_active', true).returns<{ id: string; moq: number }[]>()
    : { data: [] as { id: string; moq: number }[], error: null };
  if (packError) return dbFailure();
  const packById = new Map((packRows ?? []).map((pack) => [pack.id, pack]));
  const proposed = available.flatMap((candidate) => {
    const pack = packById.get(candidate.packId);
    if (!pack) return [];
    const usual = candidate.count > 0 ? Math.max(pack.moq, Math.round(candidate.totalQuantity / candidate.count)) : pack.moq;
    const quantity = Math.min(usual, stock.get(candidate.productId)?.available ?? 0);
    return quantity >= pack.moq ? [{ candidate, line: { packId: candidate.packId, quantity } }] : [];
  });
  // Independent one-line quotes run concurrently; a final combined quote below
  // is still the authoritative cart total and credit check.
  const individuallyQuoted = await Promise.all(proposed.map(async (proposal) => ({
    ...proposal,
    result: await quoteOrderForRetailer({ retailerId: context.actor.id, lines: [proposal.line], supabase: context.supabase }),
  })));
  const selected: RequestedQuoteLine[] = [];
  const reasons = new Map<string, string>();
  let runningTotal = 0;
  for (const entry of individuallyQuoted) {
    if ('error' in entry.result) continue;
    if (runningTotal + entry.result.quote.grandTotal > budget || entry.result.quote.credit.exceedsLimit) continue;
    selected.push(entry.line);
    runningTotal += entry.result.quote.grandTotal;
    reasons.set(entry.line.packId, entry.candidate.count > 0 ? `Purchased in ${entry.candidate.count} recent order(s); quantity uses your recent average.` : 'Catalog fallback because there is not enough purchase history.');
  }
  const finalResult = selected.length
    ? await quoteOrderForRetailer({ retailerId: context.actor.id, lines: selected, supabase: context.supabase })
    : null;
  if (!finalResult || 'error' in finalResult || finalResult.quote.grandTotal > budget || finalResult.quote.credit.exceedsLimit) {
    return unavailable('No in-stock MOQ-valid combination fit the budget and configured credit using current data.');
  }
  const bestQuote: OrderQuote = finalResult.quote;

  let addToken: string | undefined;
  try { addToken = createConfirmationToken(context.actor, 'add_to_cart', { lines: selected }); } catch { /* writes remain disabled until secret is configured */ }
  const card = quoteCard(bestQuote, `Suggested cart under ${inr(budget)}`);
  card.quality = 'estimate';
  card.source = `${orderIds.length} recent order(s), live availability and shared quote service`;
  card.lines = bestQuote.lines.map((line) => ({ label: `${line.productName} · ${line.packName}`, value: `${line.quantity} units`, detail: reasons.get(line.packId) }));
  card.actions = [
    { type: 'link', label: 'Review current cart', href: '/retailer/cart', tone: 'secondary' },
    { type: 'prompt', label: 'Adjust budget', value: 'Please adjust this suggested cart to ₹', tone: 'secondary' },
    ...(addToken ? [{ type: 'confirm_tool' as const, label: 'Add suggested items', confirmationToken: addToken, tone: 'primary' as const }] : []),
  ];
  return verified({ draft: { lines: selected, quote: bestQuote, reasons: Object.fromEntries(reasons), estimate: true }, orderHistorySample: orderIds.length }, [card], 'Purchase history, authorized availability and authoritative quote service');
}

export const cartTools: AIToolDefinition[] = [
  {
    name: 'get_cart', description: 'Get the authenticated retailer’s current cart and authoritative order preview.', actionClass: 'READ', roles: ['retailer'], surfaces: ['retailer'], inputSchema: z.object({}), inputJsonSchema: { type: 'object', additionalProperties: false }, execute: async (_, context) => getCurrentCart(context),
  },
  {
    name: 'prepare_ai_cart', description: 'Prepare (but do not persist) an optimized MOQ/stock/price/GST/credit-valid suggested cart under a budget using purchase history.', actionClass: 'PREPARE', roles: ['retailer'], surfaces: ['retailer'], inputSchema: z.object({ budget: z.number().min(100).max(10_000_000) }),
    inputJsonSchema: { type: 'object', additionalProperties: false, required: ['budget'], properties: { budget: { type: 'number', minimum: 100, maximum: 10000000 } } }, execute: async ({ budget }, context) => prepareBudgetCart(budget, context),
  },
  {
    name: 'calculate_order_preview', description: 'Calculate a read-only authoritative price, MOQ, GST and credit preview for pack IDs and quantities.', actionClass: 'PREPARE', roles: ['retailer'], surfaces: ['retailer'], inputSchema: linesSchema, inputJsonSchema: LINE_JSON,
    execute: async ({ lines }, context) => { const result = await quoteOrderForRetailer({ retailerId: context.actor.id, lines, supabase: context.supabase }); return 'error' in result ? unavailable(result.error) : verified({ quote: result.quote }, [quoteCard(result.quote)]); },
  },
  {
    name: 'add_to_cart', description: 'Add validated pack quantities to the authenticated retailer cart. Requires explicit confirmation.', actionClass: 'WRITE', roles: ['retailer'], surfaces: ['retailer'], inputSchema: linesSchema, inputJsonSchema: LINE_JSON,
    execute: async ({ lines }, context) => { const result = await addCartLines(context.supabase, context.actor.id, lines); return 'error' in result ? unavailable(result.error) : verified({ success: true }, [{ type: 'cart', title: 'Items added to cart', quality: 'verified', actions: [{ type: 'link', label: 'Review cart', href: '/retailer/cart', tone: 'primary' }] }]); },
  },
  {
    name: 'add_cart_item', description: 'Alias for adding one validated pack quantity to the authenticated retailer cart. Requires confirmation.', actionClass: 'WRITE', roles: ['retailer'], surfaces: ['retailer'], inputSchema: lineSchema,
    inputJsonSchema: { type: 'object', additionalProperties: false, required: ['packId', 'quantity'], properties: { packId: { type: 'string', format: 'uuid' }, quantity: { type: 'integer', minimum: 1, maximum: 100000 } } },
    execute: async (line, context) => { const result = await addCartLines(context.supabase, context.actor.id, [line]); return 'error' in result ? unavailable(result.error) : verified({ success: true }, [{ type: 'cart', title: 'Item added to cart', quality: 'verified', actions: [{ type: 'link', label: 'Review cart', href: '/retailer/cart' }] }]); },
  },
  {
    name: 'update_cart_quantity', description: 'Update one owned cart line after explicit confirmation and current MOQ validation.', actionClass: 'WRITE', roles: ['retailer'], surfaces: ['retailer'], inputSchema: z.object({ cartItemId: z.string().uuid(), quantity: z.number().int().min(1).max(100000) }),
    inputJsonSchema: { type: 'object', additionalProperties: false, required: ['cartItemId', 'quantity'], properties: { cartItemId: { type: 'string', format: 'uuid' }, quantity: { type: 'integer', minimum: 1 } } },
    execute: async ({ cartItemId, quantity }, context) => { const result = await updateCartLine(context.supabase, context.actor.id, cartItemId, quantity); return 'error' in result ? unavailable(result.error) : verified({ success: true }, [{ type: 'cart', title: 'Cart quantity updated', quality: 'verified' }]); },
  },
  {
    name: 'remove_from_cart', description: 'Remove one owned cart line after explicit confirmation.', actionClass: 'WRITE', roles: ['retailer'], surfaces: ['retailer'], inputSchema: z.object({ cartItemId: z.string().uuid() }),
    inputJsonSchema: { type: 'object', additionalProperties: false, required: ['cartItemId'], properties: { cartItemId: { type: 'string', format: 'uuid' } } },
    execute: async ({ cartItemId }, context) => { const result = await removeCartLine(context.supabase, context.actor.id, cartItemId); return 'error' in result ? unavailable(result.error) : verified({ success: true }, [{ type: 'cart', title: 'Item removed from cart', quality: 'verified' }]); },
  },
  {
    name: 'clear_cart', description: 'Clear the authenticated retailer cart after explicit confirmation.', actionClass: 'WRITE', roles: ['retailer'], surfaces: ['retailer'], inputSchema: z.object({}), inputJsonSchema: { type: 'object', additionalProperties: false },
    execute: async (_, context) => { const result = await clearRetailerCart(context.supabase, context.actor.id); return 'error' in result ? unavailable(result.error) : verified({ success: true }, [{ type: 'cart', title: 'Cart cleared', quality: 'verified' }]); },
  },
];

export { getCurrentCart, prepareBudgetCart, quoteCard };
