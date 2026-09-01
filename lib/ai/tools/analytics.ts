import 'server-only';

import { z } from 'zod';
import type { AICard, AIToolContext, AIToolDefinition } from '@/lib/ai/types';
import { dbFailure, inr, sourcePeriod, unavailable, verified } from '@/lib/ai/tools/helpers';

const periodSchema = z.object({ days: z.number().int().min(1).max(365).optional(), limit: z.number().int().min(1).max(30).optional() });
const periodJson = { type: 'object', additionalProperties: false, properties: { days: { type: 'integer', minimum: 1, maximum: 365 }, limit: { type: 'integer', minimum: 1, maximum: 30 } } };
const roles = ['retailer', 'salesman', 'admin', 'super_admin'] as const;
const surfaces = ['retailer', 'salesman', 'admin'] as const;

function range(days: number) {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

async function periodOrders(days: number, context: AIToolContext) {
  const { from, to } = range(days);
  type Row = { id: string; retailer_id: string; grand_total: number; subtotal: number; gst_total: number; discount_total: number; status: string; placed_at: string };
  const rows: Row[] = [];
  const pageSize = 500;
  for (let offset = 0; offset < 5000; offset += pageSize) {
    let query = context.supabase.from('orders').select('id, retailer_id, grand_total, subtotal, gst_total, discount_total, status, placed_at', { count: offset === 0 ? 'exact' : undefined }).neq('status', 'cancelled').gte('placed_at', from).lte('placed_at', to).order('placed_at', { ascending: false }).range(offset, offset + pageSize - 1);
    if (context.actor.role === 'retailer') query = query.eq('retailer_id', context.actor.id);
    if (context.actor.role === 'salesman') query = query.eq('collected_by', context.actor.id);
    const { data, error, count } = await query.returns<Row[]>();
    if (error) return { data: null, error, from, to };
    if (offset === 0 && (count ?? 0) > 5000) return { data: null, error: { message: 'result_too_large' }, from, to };
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < pageSize) break;
  }
  return { data: rows, error: null, from, to };
}

async function salesSummary(days: number, context: AIToolContext) {
  const { data, error, from, to } = await periodOrders(days, context);
  if (error) return dbFailure();
  const orders = data ?? [];
  const revenue = orders.reduce((sum, row) => sum + row.grand_total, 0);
  const summary = { revenue, orders: orders.length, averageOrderValue: orders.length ? revenue / orders.length : 0, gst: orders.reduce((sum, row) => sum + row.gst_total, 0), discounts: orders.reduce((sum, row) => sum + row.discount_total, 0), from, to };
  return verified(summary, [{ type: 'insight', title: context.actor.role === 'retailer' ? 'Your purchase summary' : 'Sales summary', subtitle: sourcePeriod(from, to, orders.length), quality: 'verified', source: 'Authorized non-cancelled order records', metrics: [{ label: context.actor.role === 'retailer' ? 'Purchase value' : 'Revenue', value: inr(revenue), quality: 'verified' }, { label: 'Orders', value: String(orders.length), quality: 'verified' }, { label: 'Average order', value: inr(summary.averageOrderValue), quality: 'verified' }, { label: 'GST', value: inr(summary.gst), quality: 'verified' }], actions: context.actor.surface === 'admin' ? [{ type: 'link', label: 'Open reports', href: '/admin/reports' }] : undefined }]);
}

async function productPerformance(days: number, context: AIToolContext, ascending = false, limit = 10) {
  const { data: orders, error, from, to } = await periodOrders(days, context);
  if (error) return dbFailure();
  const ids = (orders ?? []).map((row) => row.id);
  if (!ids.length) return verified({ products: [], from, to }, [], sourcePeriod(from, to, 0));
  type Item = { product_id: string; quantity: number; line_total: number; products: { name: string; sku_code: string | null } | null };
  const data: Item[] = [];
  for (let index = 0; index < ids.length; index += 40) {
    const chunk = ids.slice(index, index + 40);
    for (let offset = 0; offset < 8000; offset += 500) {
      const { data: page, error: itemError } = await context.supabase.from('order_items').select('product_id, quantity, line_total, products ( name, sku_code )').in('order_id', chunk).range(offset, offset + 499).returns<Item[]>();
      if (itemError) return dbFailure();
      data.push(...(page ?? []));
      if ((page?.length ?? 0) < 500) break;
      if (data.length > 50_000) return unavailable('The result is too large; choose a shorter time period.');
    }
  }
  const map = new Map<string, { productId: string; name: string; skuCode: string; quantity: number; revenue: number; rows: number }>();
  for (const item of data ?? []) { const row = map.get(item.product_id) ?? { productId: item.product_id, name: item.products?.name ?? 'Product', skuCode: item.products?.sku_code ?? '', quantity: 0, revenue: 0, rows: 0 }; row.quantity += item.quantity; row.revenue += item.line_total; row.rows += 1; map.set(item.product_id, row); }
  const products = [...map.values()].sort((a, b) => ascending ? a.quantity - b.quantity : b.quantity - a.quantity).slice(0, limit);
  const cards: AICard[] = products.map((row, index) => ({ type: 'insight', id: row.productId, title: row.name, subtitle: row.skuCode, badge: `#${index + 1}`, quality: 'verified', source: sourcePeriod(from, to, row.rows), metrics: [{ label: 'Quantity', value: String(row.quantity), quality: 'verified' }, { label: context.actor.role === 'retailer' ? 'Purchase value' : 'Revenue', value: inr(row.revenue), quality: 'verified' }] }));
  return verified({ products, from, to }, cards, sourcePeriod(from, to, data?.length ?? 0));
}

async function purchaseTrends(days: number, context: AIToolContext) {
  const { data, error, from, to } = await periodOrders(days, context);
  if (error) return dbFailure();
  const daily = new Map<string, { date: string; orders: number; total: number }>();
  for (const order of data ?? []) { const date = order.placed_at.slice(0, 10); const row = daily.get(date) ?? { date, orders: 0, total: 0 }; row.orders += 1; row.total += order.grand_total; daily.set(date, row); }
  const trend = [...daily.values()].sort((a, b) => a.date.localeCompare(b.date));
  return verified({ trend, from, to }, [{ type: 'insight', title: context.actor.role === 'retailer' ? 'Purchase trend' : 'Order trend', subtitle: sourcePeriod(from, to, data?.length ?? 0), quality: 'verified', source: 'Authorized non-cancelled orders grouped by day', lines: trend.slice(-14).map((row) => ({ label: row.date, value: inr(row.total), detail: `${row.orders} order(s)` })) }]);
}

async function customerPattern(days: number, context: AIToolContext) {
  if (context.actor.role !== 'retailer') return unavailable('Customer purchase patterns require an explicitly authorized retailer context; use retailer reports in the normal admin UI.');
  const [summary, top, trends] = await Promise.all([salesSummary(days, context), productPerformance(days, context, false, 8), purchaseTrends(days, context)]);
  if (!summary.ok || !top.ok || !trends.ok) return dbFailure();
  return verified({ summary: summary.data, topProducts: top.data, trends: trends.data }, [...(summary.cards ?? []), ...(top.cards ?? [])], 'Authenticated retailer’s own order history only');
}

async function retailerTrends(days: number, context: AIToolContext) {
  const { data, error, from, to } = await periodOrders(days, context);
  if (error || !data) return dbFailure();
  const map = new Map<string, { retailerId: string; shopName: string; orders: number; value: number }>();
  for (const order of data) { const row = map.get(order.retailer_id) ?? { retailerId: order.retailer_id, shopName: 'Retailer', orders: 0, value: 0 }; row.orders += 1; row.value += order.grand_total; map.set(order.retailer_id, row); }
  const retailers = [...map.values()].sort((a, b) => b.value - a.value).slice(0, 20);
  const { data: retailerRows, error: retailerError } = retailers.length
    ? await context.supabase.from('retailers').select('id, shop_name').in('id', retailers.map((row) => row.retailerId)).returns<{ id: string; shop_name: string }[]>()
    : { data: [] as { id: string; shop_name: string }[], error: null };
  if (retailerError) return dbFailure();
  const names = new Map((retailerRows ?? []).map((row) => [row.id, row.shop_name]));
  for (const retailer of retailers) retailer.shopName = names.get(retailer.retailerId) ?? retailer.shopName;
  return verified({ retailers, from, to }, retailers.map((row) => ({ type: 'insight', id: row.retailerId, title: row.shopName, quality: 'verified' as const, source: sourcePeriod(from, to, row.orders), metrics: [{ label: 'Orders', value: String(row.orders), quality: 'verified' as const }, { label: 'Order value', value: inr(row.value), quality: 'verified' as const }] })));
}

async function predictedStockouts(context: AIToolContext) {
  const since = new Date(Date.now() - 48 * 60 * 60_000).toISOString();
  const { data, error } = await context.supabase.from('ai_predictions').select('id, prediction_type, scope_id, payload, confidence, computed_at').eq('prediction_type', 'low_stock').gte('computed_at', since).order('computed_at', { ascending: false }).limit(50);
  if (error) return dbFailure();
  if (!data?.length) return unavailable('No current verified stock-out predictions are available. Data available nahi hai.');
  const predictions = data as Array<{ id: string; prediction_type: string; scope_id: string | null; payload: Record<string, unknown>; confidence: number | null; computed_at: string }>;
  return verified({ predictions, estimate: true }, predictions.map((row) => ({ type: 'insight', id: row.scope_id ?? undefined, title: 'Stored low-stock estimate', subtitle: `Computed ${new Date(row.computed_at).toLocaleString('en-IN')}`, quality: 'estimate', source: 'Stored ai_predictions row from the existing business prediction job', metrics: [{ label: 'Confidence', value: row.confidence === null ? 'Not recorded' : `${Number(row.confidence).toFixed(2)}`, quality: row.confidence === null ? 'unavailable' : 'estimate' }] })));
}

export const analyticsTools: AIToolDefinition[] = [
  { name: 'get_sales_summary', description: 'Get authorized real order sales/purchase summary for a bounded period.', actionClass: 'READ', roles: [...roles], surfaces: [...surfaces], inputSchema: periodSchema, inputJsonSchema: periodJson, execute: async ({ days }, context) => salesSummary(days ?? 30, context) },
  { name: 'get_top_products', description: 'Rank products from authorized actual order lines.', actionClass: 'READ', roles: [...roles], surfaces: [...surfaces], inputSchema: periodSchema, inputJsonSchema: periodJson, execute: async ({ days, limit }, context) => productPerformance(days ?? 30, context, false, limit ?? 10) },
  { name: 'get_best_sellers', description: 'Get best sellers using authorized actual order lines, never synthetic rankings.', actionClass: 'READ', roles: [...roles], surfaces: [...surfaces], inputSchema: periodSchema, inputJsonSchema: periodJson, execute: async ({ days, limit }, context) => productPerformance(days ?? 30, context, false, limit ?? 10) },
  { name: 'get_slow_products', description: 'Get lowest-selling products among those present in actual authorized order lines for the period.', actionClass: 'READ', roles: ['admin', 'super_admin'], surfaces: ['admin'], inputSchema: periodSchema, inputJsonSchema: periodJson, execute: async ({ days, limit }, context) => productPerformance(days ?? 30, context, true, limit ?? 10) },
  { name: 'get_purchase_trends', description: 'Group authorized order values/counts by day.', actionClass: 'READ', roles: [...roles], surfaces: [...surfaces], inputSchema: periodSchema, inputJsonSchema: periodJson, execute: async ({ days }, context) => purchaseTrends(days ?? 30, context) },
  { name: 'get_customer_purchase_pattern', description: 'Summarize the authenticated retailer’s own purchase pattern.', actionClass: 'READ', roles: ['retailer'], surfaces: ['retailer'], inputSchema: periodSchema, inputJsonSchema: periodJson, execute: async ({ days }, context) => customerPattern(days ?? 90, context) },
  { name: 'get_order_trends', description: 'Get authorized real daily order trends.', actionClass: 'READ', roles: [...roles], surfaces: [...surfaces], inputSchema: periodSchema, inputJsonSchema: periodJson, execute: async ({ days }, context) => purchaseTrends(days ?? 30, context) },
  { name: 'get_retailer_trends', description: 'Rank authorized retailer order value/count trends for a bounded period.', actionClass: 'READ', roles: ['admin', 'super_admin'], surfaces: ['admin'], inputSchema: periodSchema, inputJsonSchema: periodJson, execute: async ({ days }, context) => retailerTrends(days ?? 30, context) },
  { name: 'get_scheme_performance', description: 'Check whether scheme-attributed order performance is available.', actionClass: 'READ', roles: ['admin', 'super_admin'], surfaces: ['admin'], inputSchema: periodSchema, inputJsonSchema: periodJson, execute: async () => unavailable('Orders do not currently record a scheme attribution, so scheme performance cannot be calculated reliably.') },
  { name: 'get_predicted_stockouts', description: 'Read stored current stock-out predictions only when the existing prediction job has produced them.', actionClass: 'READ', roles: ['admin', 'super_admin'], surfaces: ['admin'], inputSchema: z.object({}), inputJsonSchema: { type: 'object', additionalProperties: false }, execute: async (_, context) => predictedStockouts(context) },
];

export { salesSummary, productPerformance, purchaseTrends, customerPattern, predictedStockouts };
