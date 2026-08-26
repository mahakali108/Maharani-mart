/**
 * Super Admin Command Center — pure computation layer.
 *
 * Every function here is side-effect free and consumes plain row data, so it
 * can be unit-tested without Supabase. No number is invented: inputs are real
 * RLS-authorized rows (see lib/admin/command-center/data.ts) and outputs are
 * either aggregated facts, explicitly-labelled derived metrics, or an
 * honest "empty"/"unavailable" status.
 *
 * Credit arithmetic is deliberately delegated to the single authoritative
 * calculator used by checkout and Maharani AI (lib/orders/credit.ts).
 */

import { calculateCreditPosition, roundMoney } from '@/lib/orders/credit';
import type {
  BusinessOverview,
  CommandCenterAction,
  CreditOverview,
  RetailerIntel,
  RetailerRowIntel,
  RiskCenter,
  RiskItem,
  SalesIntel,
  SalesIntelFilters,
  SalesmanIntel,
  Severity,
  SupplierIntel,
  TopPerformers,
  TopRow,
  Trends,
  TrendPoint,
} from './types';
import type { ForecastResult } from '@/lib/ai/forecast/types';

// ---------------------------------------------------------------------------
// Shared raw-row shapes (as fetched by data.ts)
// ---------------------------------------------------------------------------

export interface RawOrder {
  id: string;
  order_number: string;
  retailer_id: string;
  collected_by: string | null;
  status: string;
  grand_total: number;
  placed_at: string;
}

export interface RawOrderItem {
  order_id: string;
  product_id: string;
  quantity: number;
  line_total: number;
  products: { name: string; sku_code: string; brand_id: string | null; category_id: string | null } | null;
}

export interface RawRetailer {
  id: string;
  shop_name: string;
  status: string;
  credit_limit: number;
  outstanding_balance: number;
  created_at: string;
  approved_at: string | null;
}

export interface RawProfile {
  id: string;
  full_name: string;
  role: 'super_admin' | 'admin' | 'staff' | 'salesman' | 'retailer';
  is_active: boolean;
}

export interface RawInventoryTotal {
  product_id: string;
  product_name: string;
  sku_code: string;
  quantity_on_hand: number;
  reserved_quantity: number;
  available_quantity: number;
  estimated_value: number;
  reorder_level: number;
  stock_status: 'healthy' | 'low_stock' | 'out_of_stock';
}

export interface RawExpiryRow {
  batch_id: string;
  product_id: string;
  product_name: string;
  batch_number: string;
  warehouse_name: string;
  expiry_date: string | null;
  available_quantity: number;
  current_quantity: number;
  estimated_value: number;
  days_remaining: number | null;
  expiry_status: 'expired' | 'critical' | 'warning' | 'healthy';
}

export interface RawGrn {
  id: string;
  grn_number: string;
  status: 'draft' | 'confirmed' | 'cancelled';
  supplier_reference: string | null;
  warehouse_name: string | null;
  created_at: string;
  confirmed_at: string | null;
}

export interface RawGrnItem {
  grn_id: string;
  product_id: string;
  received_quantity: number;
  unit_cost: number | null;
  created_at: string;
  products: { name: string } | null;
}

export interface RawDemandDaily {
  product_id: string;
  demand_date: string;
  quantity: number;
}

export interface RawVisit {
  id: string;
  salesman_id: string;
  status: string;
  created_at: string;
}

export interface RawAuditLog {
  id: string;
  table_name: string;
  action: string;
  changed_by: string | null;
  created_at: string;
  profiles: { full_name: string } | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
}

export interface RawAiAuditLog {
  id: string;
  tool_name: string | null;
  request_type: string;
  success: boolean;
  error_code: string | null;
  provider: string | null;
  created_at: string;
}

/**
 * Date helpers — server-local dates, consistent with the existing Reports
 * page and the AI analytics tools (both use server-local calendar days).
 */
export function toDateKey(value: Date | string): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(value: Date, days: number): Date {
  const d = new Date(value);
  d.setDate(d.getDate() + days);
  return d;
}

export function startOfDay(value: Date): Date {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** ISO instant of local midnight for a date key, e.g. '2026-08-26' -> '2026-08-26T00:00:00.000Z' shifted to local midnight. */
export function localMidnightIso(dateKey: string): string {
  const [y = 1970, m = 1, d = 1] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
}

export function localDayEndIso(dateKey: string): string {
  const [y = 1970, m = 1, d = 1] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Trend / daily series
// ---------------------------------------------------------------------------

/**
 * Builds a full daily series (zero-filled) for `days` ending today from real
 * order rows. Cancelled orders are excluded — same rule as the Reports page
 * and mv_top_products.
 */
export function buildDailySeries(orders: RawOrder[], days: number, now = new Date()): TrendPoint[] {
  const byDay = new Map<string, { sales: number; orders: number }>();
  for (const order of orders) {
    if (order.status === 'cancelled') continue;
    const key = toDateKey(order.placed_at);
    const row = byDay.get(key) ?? { sales: 0, orders: 0 };
    row.sales = roundMoney(row.sales + order.grand_total);
    row.orders += 1;
    byDay.set(key, row);
  }
  const points: TrendPoint[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = startOfDay(addDays(now, -i));
    const key = toDateKey(date);
    const row = byDay.get(key) ?? { sales: 0, orders: 0 };
    points.push({ date: key, label: key.slice(5), sales: row.sales, orders: row.orders });
  }
  return points;
}

// ---------------------------------------------------------------------------
// Business overview
// ---------------------------------------------------------------------------

export interface OverviewInputs {
  now?: Date;
  ordersToday: RawOrder[];
  ordersMonth: RawOrder[];
  ordersPreviousMonth: RawOrder[];
  orders30d: RawOrder[];
  retailers: RawRetailer[];
  profiles: RawProfile[];
  inventoryTotals: RawInventoryTotal[];
  expiryRows: RawExpiryRow[];
  items30d: RawOrderItem[];
  pendingGrns: number;
  supplierNames: string[];
}

export function computeBusinessOverview(input: OverviewInputs): BusinessOverview {
  const now = input.now ?? new Date();
  const sales = (rows: RawOrder[]) => roundMoney(rows.filter((o) => o.status !== 'cancelled').reduce((s, o) => s + o.grand_total, 0));
  const count = (rows: RawOrder[]) => rows.filter((o) => o.status !== 'cancelled').length;

  const credit = computeCreditRows(input.retailers);
  const overLimitAmount = roundMoney(credit.rows.filter((r) => r.position.exceedsLimit).reduce((s, r) => s + (r.position.outstandingBalance - r.position.creditLimit), 0));

  const soldProductIds = new Set(input.items30d.map((item) => item.product_id));
  const deadStock = input.inventoryTotals.filter((t) => t.available_quantity > 0 && !soldProductIds.has(t.product_id));
  const expired = input.expiryRows.filter((r) => r.expiry_status === 'expired');
  const critical = input.expiryRows.filter((r) => r.expiry_status === 'critical');
  const warning = input.expiryRows.filter((r) => r.expiry_status === 'warning');

  const monthSales = sales(input.ordersMonth);
  const prevMonthSales = sales(input.ordersPreviousMonth);

  return {
    status: 'ok',
    todaySales: sales(input.ordersToday),
    todayOrders: count(input.ordersToday),
    monthSales,
    monthOrders: count(input.ordersMonth),
    previousMonthSales: prevMonthSales,
    salesMoMChangePct: prevMonthSales > 0 ? roundPct(((monthSales - prevMonthSales) / prevMonthSales) * 100) : null,
    revenue30d: sales(input.orders30d),
    outstandingCredit: roundMoney(credit.rows.reduce((s, r) => s + r.position.outstandingBalance, 0)),
    overLimitAmount,
    inventoryValue: roundMoney(input.inventoryTotals.reduce((s, t) => s + t.estimated_value, 0)),
    lowStockCount: input.inventoryTotals.filter((t) => t.stock_status === 'low_stock').length,
    outOfStockCount: input.inventoryTotals.filter((t) => t.stock_status === 'out_of_stock').length,
    expiredBatches: expired.length,
    expiringCriticalBatches: critical.length,
    expiringWarningBatches: warning.length,
    deadStockValue: roundMoney(deadStock.reduce((s, t) => s + t.estimated_value, 0)),
    deadStockCount: deadStock.length,
    activeRetailers: input.retailers.filter((r) => r.status === 'active').length,
    totalRetailers: input.retailers.length,
    activeSalesmen: input.profiles.filter((p) => p.role === 'salesman' && p.is_active).length,
    activeStaff: input.profiles.filter((p) => (p.role === 'staff' || p.role === 'admin' || p.role === 'super_admin') && p.is_active).length,
    supplierCount: new Set(input.supplierNames.map((n) => n.trim().toLowerCase()).filter(Boolean)).size,
    pendingGrns: input.pendingGrns,
    dataAsOf: now.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Trends
// ---------------------------------------------------------------------------

export interface TrendInputs {
  now?: Date;
  orders30d: RawOrder[];
  retailers: RawRetailer[];
}

export function computeTrends(input: TrendInputs): Trends {
  const now = input.now ?? new Date();
  const series = buildDailySeries(input.orders30d, 14, now);
  const recent = input.orders30d.filter((o) => o.status !== 'cancelled');
  const aov30d = recent.length ? roundMoney(recent.reduce((s, o) => s + o.grand_total, 0) / recent.length) : null;

  const weekAgo = addDays(now, -7);
  const weekAgoIds = new Set(input.orders30d.filter((o) => o.status !== 'cancelled' && new Date(o.placed_at) < weekAgo).map((o) => o.retailer_id));
  const returning = new Set(
    input.orders30d.filter((o) => o.status !== 'cancelled' && new Date(o.placed_at) >= weekAgo).map((o) => o.retailer_id)
  );
  const returningCount = [...returning].filter((id) => weekAgoIds.has(id)).length;

  const new30d = input.retailers.filter((r) => {
    const stamp = r.approved_at ?? r.created_at;
    return new Date(stamp) >= addDays(now, -30);
  }).length;

  const hasAnySales = recent.length > 0;
  return {
    status: hasAnySales || input.retailers.length > 0 ? 'ok' : 'empty',
    daily: series,
    aov30d,
    newRetailers30d: new30d,
    returningRetailers7d: returningCount,
    creditCollectionAvailable: false,
  };
}

// ---------------------------------------------------------------------------
// Credit (reuses the authoritative calculator)
// ---------------------------------------------------------------------------

export interface CreditRow {
  retailer: RawRetailer;
  position: ReturnType<typeof calculateCreditPosition>;
}

export function computeCreditRows(retailers: RawRetailer[]): { rows: CreditRow[] } {
  return { rows: retailers.map((retailer) => ({ retailer, position: calculateCreditPosition(retailer.credit_limit, retailer.outstanding_balance) })) };
}

export function computeCreditOverview(retailers: RawRetailer[]): CreditOverview {
  const { rows } = computeCreditRows(retailers);
  const withLimit = rows.filter((r) => r.position.hasConfiguredLimit);
  const totalLimit = roundMoney(withLimit.reduce((s, r) => s + r.position.creditLimit, 0));
  const totalOutstanding = roundMoney(rows.reduce((s, r) => s + r.position.outstandingBalance, 0));
  const overLimit = rows.filter((r) => r.position.exceedsLimit);
  const overLimitAmount = roundMoney(overLimit.reduce((s, r) => s + (r.position.outstandingBalance - r.position.creditLimit), 0));

  const bucketCounts: Record<string, number> = {
    'No limit set': rows.length - withLimit.length,
    '0–25%': 0,
    '25–50%': 0,
    '50–80%': 0,
    '80–100%': 0,
    'Over limit': overLimit.length,
  };
  // Over-limit retailers are counted ONLY in the 'Over limit' bucket.
  const bump = (label: string) => {
    bucketCounts[label] = (bucketCounts[label] ?? 0) + 1;
  };
  for (const row of withLimit.filter((r) => !r.position.exceedsLimit)) {
    const pct = (row.position.outstandingBalance / row.position.creditLimit) * 100;
    if (pct < 25) bump('0–25%');
    else if (pct < 50) bump('25–50%');
    else if (pct < 80) bump('50–80%');
    else bump('80–100%');
  }
  const buckets = Object.entries(bucketCounts).map(([label, count]) => ({ label, count }));

  const highRisk = [...rows]
    .sort((a, b) => {
      const ap = a.position.hasConfiguredLimit ? a.position.outstandingBalance / a.position.creditLimit : -1;
      const bp = b.position.hasConfiguredLimit ? b.position.outstandingBalance / b.position.creditLimit : -1;
      return bp - ap;
    })
    .slice(0, 10)
    .map((r) => ({
      retailerId: r.retailer.id,
      shopName: r.retailer.shop_name,
      outstanding: r.position.outstandingBalance,
      limit: r.position.creditLimit,
      utilizationPct: r.position.hasConfiguredLimit ? roundPct((r.position.outstandingBalance / r.position.creditLimit) * 100) : null,
      status: r.retailer.status,
    }));

  return {
    status: rows.length ? 'ok' : 'empty',
    totalConfiguredLimit: totalLimit,
    retailersWithLimit: withLimit.length,
    totalOutstanding,
    overLimitCount: overLimit.length,
    overLimitAmount,
    utilizationPct: totalLimit > 0 ? roundPct((totalOutstanding / totalLimit) * 100) : null,
    buckets,
    highRisk,
    paymentTrendAvailable: false,
  };
}

// ---------------------------------------------------------------------------
// Top performers (bounded window of real order lines)
// ---------------------------------------------------------------------------

export interface TopPerformerInputs {
  windowDays: number;
  orders: RawOrder[];
  items: RawOrderItem[];
  retailers: RawRetailer[];
  profiles: RawProfile[];
}

export function computeTopPerformers(input: TopPerformerInputs): TopPerformers {
  const retailerName = new Map(input.retailers.map((r) => [r.id, r.shop_name]));
  const profileName = new Map(input.profiles.map((p) => [p.id, p.full_name]));
  const orders = input.orders.filter((o) => o.status !== 'cancelled');

  const byProduct = new Map<string, { name: string; qty: number; value: number }>();
  const byCategory = new Map<string, { name: string; value: number }>();
  const byBrand = new Map<string, { name: string; value: number }>();
  for (const item of input.items) {
    const order = orders.find((o) => o.id === item.order_id);
    if (!order) continue;
    const p = byProduct.get(item.product_id) ?? { name: item.products?.name ?? 'Product', qty: 0, value: 0 };
    p.qty += item.quantity;
    p.value = roundMoney(p.value + item.line_total);
    byProduct.set(item.product_id, p);
    const catId = item.products?.category_id;
    if (catId) {
      const c = byCategory.get(catId) ?? { name: 'Uncategorized', value: 0 };
      c.value = roundMoney(c.value + item.line_total);
      byCategory.set(catId, c);
    }
    const brandId = item.products?.brand_id;
    if (brandId) {
      const b = byBrand.get(brandId) ?? { name: 'Unbranded', value: 0 };
      b.value = roundMoney(b.value + item.line_total);
      byBrand.set(brandId, b);
    }
  }

  const byRetailer = new Map<string, { value: number; orders: number }>();
  const bySalesman = new Map<string, { value: number; orders: number }>();
  for (const order of orders) {
    const r = byRetailer.get(order.retailer_id) ?? { value: 0, orders: 0 };
    r.value = roundMoney(r.value + order.grand_total);
    r.orders += 1;
    byRetailer.set(order.retailer_id, r);
    if (order.collected_by) {
      const s = bySalesman.get(order.collected_by) ?? { value: 0, orders: 0 };
      s.value = roundMoney(s.value + order.grand_total);
      s.orders += 1;
      bySalesman.set(order.collected_by, s);
    }
  }

  const top = (map: Map<string, { name?: string; value: number; qty?: number; orders?: number }>, labelOf: (id: string) => string, limit = 10): TopRow[] =>
    [...map.entries()]
      .sort((a, b) => b[1].value - a[1].value)
      .slice(0, limit)
      .map(([id, row]) => ({
        id,
        name: row.name ?? labelOf(id),
        value: row.value,
        secondary: row.qty !== undefined ? `${row.qty} units` : row.orders !== undefined ? `${row.orders} orders` : undefined,
      }));

  const hasData = orders.length > 0;
  const productRows = [...byProduct.entries()]
    .sort((a, b) => b[1].value - a[1].value)
    .slice(0, 10)
    .map(([id, row]) => ({ id, name: row.name, value: row.value, secondary: `${row.qty} units` }));

  return {
    status: hasData ? 'ok' : 'empty',
    windowDays: input.windowDays,
    products: productRows,
    categories: top(byCategory, () => 'Uncategorized'),
    brands: top(byBrand, () => 'Unbranded'),
    retailers: top(byRetailer, (id) => retailerName.get(id) ?? 'Retailer'),
    salesmen: top(bySalesman, (id) => profileName.get(id) ?? 'Salesman'),
  };
}

// ---------------------------------------------------------------------------
// Risk center
// ---------------------------------------------------------------------------

export interface RiskInputs {
  now?: Date;
  retailers: RawRetailer[];
  inventoryTotals: RawInventoryTotal[];
  expiryRows: RawExpiryRow[];
  orders30d: RawOrder[];
  orders7d: RawOrder[];
  items30d: RawOrderItem[];
  forecasts: ForecastResult[];
  aiAuditLogs: RawAiAuditLog[];
  failedNotifications7d: number;
}

function riskItem(id: string, title: string, detail: string, severity: Severity, source: string, href?: string, value?: string): RiskItem {
  return { id, title, detail, severity, source, href, value };
}

export function computeRiskCenter(input: RiskInputs): RiskCenter {
  const now = input.now ?? new Date();

  const stockoutForecasts = input.forecasts
    .filter((f) => f.stockOutRisk === 'critical' || f.stockOutRisk === 'high')
    .sort((a, b) => (a.stockOutDays ?? 999) - (b.stockOutDays ?? 999));
  const stockout = {
    count: stockoutForecasts.length,
    value: undefined as number | undefined,
    items: stockoutForecasts.slice(0, 8).map((f) =>
      riskItem(
        f.productId,
        `${f.productName} — stock-out risk (${f.stockOutRisk})`,
        f.explanation,
        f.stockOutRisk === 'critical' ? 'urgent' : 'high',
        'forecast pipeline (lib/ai/forecast)',
        `/admin/inventory/forecast?risk=stockout&product=${f.productId}`,
        f.availableStock !== null ? `${f.availableStock} available` : undefined
      )
    ),
  };

  const overstock = input.forecasts.filter((f) => f.overstockWarning);
  const sold = new Set(input.items30d.map((i) => i.product_id));
  const deadStockRows = input.inventoryTotals.filter((t) => t.available_quantity > 0 && !sold.has(t.product_id));
  const deadStock = {
    count: deadStockRows.length,
    value: roundMoney(deadStockRows.reduce((s, t) => s + t.estimated_value, 0)),
    items: deadStockRows
      .slice(0, 8)
      .map((t) =>
        riskItem(
          t.product_id,
          `${t.product_name} — no sales in 30 days`,
          `${t.available_quantity} unit(s) on hand with zero recorded demand in the last 30 days.`,
          'medium',
          'order_items + inventory_product_totals',
          `/admin/inventory/products?q=${encodeURIComponent(t.sku_code)}`,
          `₹${t.estimated_value.toLocaleString('en-IN')}`
        )
      ),
  };

  const expiryItems = input.expiryRows
    .filter((r) => r.expiry_status !== 'healthy')
    .slice(0, 8)
    .map((r) =>
      riskItem(
        r.batch_id,
        `${r.product_name} batch ${r.batch_number} — ${r.expiry_status}`,
        r.expiry_date
          ? `${r.available_quantity} unit(s) available · expires ${r.expiry_date} (${r.days_remaining ?? 0} days) · ${r.warehouse_name}.`
          : `${r.available_quantity} unit(s) available · no expiry date recorded.`,
        r.expiry_status === 'expired' || r.expiry_status === 'critical' ? 'urgent' : 'high',
        'inventory_expiry_report view',
        `/admin/inventory/expiry?product=${r.product_id}`,
        `₹${r.estimated_value.toLocaleString('en-IN')}`
      )
    );

  const { rows } = computeCreditRows(input.retailers);
  const overLimit = rows.filter((r) => r.position.exceedsLimit);
  const nearLimit = rows.filter((r) => !r.position.exceedsLimit && r.position.hasConfiguredLimit && r.position.outstandingBalance / r.position.creditLimit >= 0.8);
  const creditItems = [
    ...overLimit.slice(0, 6).map((r) =>
      riskItem(
        r.retailer.id,
        `${r.retailer.shop_name} — credit over limit`,
        `Outstanding ₹${r.position.outstandingBalance.toLocaleString('en-IN')} exceeds the configured limit ₹${r.position.creditLimit.toLocaleString('en-IN')}.`,
        'urgent',
        'retailers + shared credit calculator',
        `/admin/retailers/${r.retailer.id}`,
        `+₹${(r.position.outstandingBalance - r.position.creditLimit).toLocaleString('en-IN')} over`
      )
    ),
    ...nearLimit.slice(0, 4).map((r) =>
      riskItem(
        r.retailer.id,
        `${r.retailer.shop_name} — credit near limit`,
        `Outstanding is ${Math.round((r.position.outstandingBalance / r.position.creditLimit) * 100)}% of the configured limit.`,
        'high',
        'retailers + shared credit calculator',
        `/admin/retailers/${r.retailer.id}`
      )
    ),
  ];

  // Unusual order activity: a 7-day order that is >3× the retailer's own
  // 30-day AOV (with at least 2 historical orders) or above a configured
  // credit limit. Real data only; nothing synthetic.
  const aovByRetailer = new Map<string, { total: number; count: number }>();
  for (const o of input.orders30d) {
    if (o.status === 'cancelled') continue;
    const row = aovByRetailer.get(o.retailer_id) ?? { total: 0, count: 0 };
    row.total += o.grand_total;
    row.count += 1;
    aovByRetailer.set(o.retailer_id, row);
  }
  const limitByRetailer = new Map(input.retailers.map((r) => [r.id, r.credit_limit]));
  const nameByRetailer = new Map(input.retailers.map((r) => [r.id, r.shop_name]));
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const unusual: RiskItem[] = [];
  for (const o of input.orders7d) {
    if (o.status === 'cancelled' || new Date(o.placed_at) < weekAgo) continue;
    const history = aovByRetailer.get(o.retailer_id);
    const limit = limitByRetailer.get(o.retailer_id) ?? 0;
    const reasons: string[] = [];
    if (history && history.count >= 2) {
      const aov = history.total / history.count;
      if (aov > 0 && o.grand_total > 3 * aov) reasons.push(`₹${Math.round(o.grand_total).toLocaleString('en-IN')} is ${Math.round((o.grand_total / aov) * 10) / 10}× the retailer's 30-day AOV of ₹${Math.round(aov).toLocaleString('en-IN')}`);
    }
    if (limit > 0 && o.grand_total > limit) reasons.push(`order value exceeds the configured credit limit of ₹${Math.round(limit).toLocaleString('en-IN')}`);
    if (reasons.length) {
      unusual.push(
        riskItem(
          o.id,
          `Unusual order ${o.order_number}`,
          `${nameByRetailer.get(o.retailer_id) ?? 'Retailer'} — ${reasons.join('; ')}.`,
          'high',
          'orders (30-day AOV baseline)',
          `/admin/orders/${o.id}`
        )
      );
    }
  }

  const aiFailures = input.aiAuditLogs.filter((l) => !l.success);
  const systemItems: RiskItem[] = [
    ...aiFailures
      .slice(0, 5)
      .map((l) =>
        riskItem(
          l.id,
          `AI/provider failure (${l.error_code ?? 'unknown'})`,
          `${l.request_type}${l.tool_name ? ` · tool ${l.tool_name}` : ''} · ${new Date(l.created_at).toLocaleString('en-IN')}.`,
          'medium',
          'ai_audit_logs'
        )
      ),
    ...(input.failedNotifications7d > 0
      ? [riskItem(
          'notification-failures',
          `${input.failedNotifications7d} notification delivery failure(s) in 7 days`,
          'Channel delivery failures recorded in the notification log.',
          'medium',
          'notification_logs'
        )]
      : []),
  ];

  return {
    status: 'ok',
    stockoutRisk: stockout,
    overstock: {
      count: overstock.length,
      items: overstock.slice(0, 8).map((f) =>
        riskItem(
          f.productId,
          `${f.productName} — possible overstock`,
          f.explanation,
          'medium',
          'forecast pipeline (lib/ai/forecast)',
          `/admin/inventory/forecast?risk=overstock&product=${f.productId}`
        )
      ),
    },
    deadStock,
    expiry: {
      count: expiryItems.length + Math.max(0, input.expiryRows.filter((r) => r.expiry_status !== 'healthy').length - expiryItems.length),
      items: expiryItems,
      value: roundMoney(input.expiryRows.filter((r) => r.expiry_status !== 'healthy').reduce((s, r) => s + r.estimated_value, 0)),
    },
    credit: { count: creditItems.length, items: creditItems },
    unusualOrders: { count: unusual.length, items: unusual.slice(0, 10) },
    systemFailures: { count: systemItems.length, items: systemItems },
  };
}

// ---------------------------------------------------------------------------
// Executive action center (prioritized, real signals only)
// ---------------------------------------------------------------------------

export function buildActions(input: {
  now?: Date;
  retailers: RawRetailer[];
  inventoryTotals: RawInventoryTotal[];
  expiryRows: RawExpiryRow[];
  orders30d: RawOrder[];
  orders7d: RawOrder[];
  items30d: RawOrderItem[];
  forecasts: ForecastResult[];
  retailersIntel: RetailerIntel;
  aiAuditLogs: RawAiAuditLog[];
  failedNotifications7d: number;
}): CommandCenterAction[] {
  const now = input.now ?? new Date();
  const actions: CommandCenterAction[] = [];
  const risk = computeRiskCenter(input);

  for (const item of risk.stockoutRisk.items.filter((i) => i.severity === 'urgent').slice(0, 5)) {
    actions.push({
      id: `stockout:${item.id}`,
      severity: 'urgent',
      category: 'Stock-out risk',
      source: item.source,
      entity: item.title,
      entityHref: item.href,
      reason: item.detail,
      recommendedAction: 'Prepare a GRN (Goods Receipt Note) to restock before projected stock-out.',
      requiredApproval: 'Admin/warehouse staff confirms the GRN — the existing /admin/inventory/grn flow. AI does not create it.',
      metric: item.value,
    });
  }

  for (const item of risk.credit.items.filter((i) => i.severity === 'urgent').slice(0, 5)) {
    actions.push({
      id: `credit:${item.id}`,
      severity: 'urgent',
      category: 'Credit exposure',
      source: item.source,
      entity: item.title,
      entityHref: item.href,
      reason: item.detail,
      recommendedAction: 'Review the account, collect dues or re-assess the credit limit.',
      requiredApproval: 'Retailer credit review is an admin workflow on the existing retailer page.',
      metric: item.value,
    });
  }

  for (const item of risk.expiry.items.filter((i) => i.severity === 'urgent').slice(0, 5)) {
    actions.push({
      id: `expiry:${item.id}`,
      severity: 'urgent',
      category: 'Batch expiry',
      source: item.source,
      entity: item.title,
      entityHref: item.href,
      reason: item.detail,
      recommendedAction: 'Dispatch/expedite sales of the batch, or record a batch loss through the existing loss flow.',
      requiredApproval: 'Existing batch-loss / dispatch workflows (admin inventory pages).',
      metric: item.value,
    });
  }

  for (const item of risk.unusualOrders.items.slice(0, 5)) {
    actions.push({
      id: `unusual:${item.id}`,
      severity: 'high',
      category: 'Unusual order activity',
      source: item.source,
      entity: item.title,
      entityHref: item.href,
      reason: item.detail,
      recommendedAction: 'Verify the order with the retailer/salesman before processing further.',
      requiredApproval: 'Order review on the existing order page.',
    });
  }

  const reorderForecasts = input.forecasts.filter((f) => (f.reorderQuantity ?? 0) > 0 && f.stockOutRisk !== 'critical').slice(0, 5);
  for (const f of reorderForecasts) {
    actions.push({
      id: `reorder:${f.productId}`,
      severity: 'high',
      category: 'Reorder recommendation',
      source: 'forecast pipeline (lib/ai/forecast)',
      entity: f.productName,
      entityHref: `/admin/inventory/forecast?risk=reorder&product=${f.productId}`,
      reason: f.explanation,
      recommendedAction: `Raise a GRN for ~${f.reorderQuantity} unit(s) (cover window ${f.reorderWindowDays ?? '?'} days).`,
      requiredApproval: 'GRN creation + confirmation via the existing inventory GRN flow.',
      metric: f.reorderQuantity !== null ? `${f.reorderQuantity} units` : undefined,
    });
  }

  for (const item of risk.deadStock.items.slice(0, 3)) {
    actions.push({
      id: `dead:${item.id}`,
      severity: 'medium',
      category: 'Dead-stock review',
      source: item.source,
      entity: item.title,
      entityHref: item.href,
      reason: item.detail,
      recommendedAction: 'Review pricing/scheme fit or plan a clearance; do not reorder until reviewed.',
      requiredApproval: 'Pricing/scheme changes via the existing admin pricing workflow.',
      metric: item.value,
    });
  }

  for (const f of input.forecasts.filter((f) => f.demandDirection === 'falling' && f.trendChangePercent <= -20).slice(0, 3)) {
    actions.push({
      id: `decline:${f.productId}`,
      severity: 'medium',
      category: 'Sales decline',
      source: 'forecast pipeline (lib/ai/forecast)',
      entity: f.productName,
      entityHref: `/admin/inventory/forecast?product=${f.productId}`,
      reason: `Demand fell ~${Math.abs(f.trendChangePercent)}% across the forecast window (${f.dataBasis}).`,
      recommendedAction: 'Check price changes, competitor activity or scheme gaps before the next restock.',
      requiredApproval: 'No system change — analysis only; pricing changes use the existing workflow.',
    });
  }

  const inactiveRetailers = input.retailersIntel.rows.filter((r) => r.tags.includes('Inactive')).slice(0, 5);
  for (const r of inactiveRetailers) {
    actions.push({
      id: `inactive:${r.retailerId}`,
      severity: 'medium',
      category: 'Retailer reactivation',
      source: 'orders + retailers',
      entity: r.shopName,
      entityHref: `/admin/retailers/${r.retailerId}`,
      reason: `No orders in the last 45 days${r.lastOrderAt ? ` (last order ${r.lastOrderAt.slice(0, 10)})` : ''}.`,
      recommendedAction: 'Assign a follow-up visit via the salesman route/visit workflow.',
      requiredApproval: 'Visits are planned by staff/salesmen on the existing visits page.',
    });
  }

  const momDecline = input.retailersIntel.counts.declining > 0;
  if (momDecline) {
    actions.push({
      id: 'declining-retailers',
      severity: 'medium',
      category: 'Sales decline',
      source: 'orders (30-day windows)',
      entity: `${input.retailersIntel.counts.declining} declining retailer(s)`,
      entityHref: '/admin/command-center?tab=retailers',
      reason: 'Retailer sales in the last 30 days fell by more than 20% vs the previous 30 days (materiality ₹500).',
      recommendedAction: 'Open the Retailer Intelligence tab to review the full list and plan follow-ups.',
      requiredApproval: 'No system change — analysis only.',
    });
  }

  const aiFailures24h = input.aiAuditLogs.filter((l) => !l.success && new Date(l.created_at) > new Date(now.getTime() - 86_400_000)).length;
  if (aiFailures24h > 0 || input.failedNotifications7d > 0) {
    actions.push({
      id: 'system-failures',
      severity: aiFailures24h > 0 ? 'high' : 'medium',
      category: 'System operations',
      source: 'ai_audit_logs + notification_logs',
      entity: `${aiFailures24h} AI/provider failure(s) in 24h · ${input.failedNotifications7d} failed notification(s) in 7d`,
      entityHref: '/admin/command-center?tab=security',
      reason: 'Recent automated operations failed; provider configuration or channel credentials may need attention.',
      recommendedAction: 'Check the Security tab for the failure codes and review provider environment configuration.',
      requiredApproval: 'Environment/configuration changes are deployment actions, not in-app mutations.',
    });
  }

  const severityRank: Record<Severity, number> = { urgent: 0, high: 1, medium: 2 };
  return actions
    .sort((a, b) => severityRank[a.severity] - severityRank[b.severity])
    .slice(0, 30);
}

// ---------------------------------------------------------------------------
// Inventory intelligence
// ---------------------------------------------------------------------------

export interface InventoryIntelInputs {
  inventoryTotals: RawInventoryTotal[];
  expiryRows: RawExpiryRow[];
  items30d: RawOrderItem[];
  forecasts: ForecastResult[];
}

export function computeInventoryIntel(input: InventoryIntelInputs) {
  const sold = new Map<string, number>();
  for (const item of input.items30d) {
    sold.set(item.product_id, (sold.get(item.product_id) ?? 0) + item.quantity);
  }
  const soldRows = [...sold.entries()].map(([id, units30d]) => ({ id, units30d }));
  const fastMoving = [...soldRows].sort((a, b) => b.units30d - a.units30d).slice(0, 10)
    .map((row) => ({ ...row, name: input.inventoryTotals.find((t) => t.product_id === row.id)?.product_name ?? 'Product' }));
  const slowMoving = [...soldRows].sort((a, b) => a.units30d - b.units30d).slice(0, 10)
    .map((row) => {
      const total = input.inventoryTotals.find((t) => t.product_id === row.id);
      return { id: row.id, name: total?.product_name ?? 'Product', units30d: row.units30d, available: total?.available_quantity ?? 0 };
    });

  return {
    status: input.inventoryTotals.length ? 'ok' : ('empty' as const),
    inventoryValue: roundMoney(input.inventoryTotals.reduce((s, t) => s + t.estimated_value, 0)),
    onHandProducts: input.inventoryTotals.filter((t) => t.quantity_on_hand > 0).length,
    lowStock: input.inventoryTotals
      .filter((t) => t.stock_status === 'low_stock' || t.stock_status === 'out_of_stock')
      .sort((a, b) => a.available_quantity - b.available_quantity)
      .slice(0, 12)
      .map((t) => ({ id: t.product_id, name: t.product_name, sku: t.sku_code, available: t.available_quantity, reorderLevel: t.reorder_level })),
    stockout: input.forecasts
      .filter((f) => f.stockOutRisk !== 'none' && f.stockOutRisk !== undefined)
      .sort((a, b) => (a.stockOutDays ?? 999) - (b.stockOutDays ?? 999))
      .slice(0, 12)
      .map((f) => ({
        id: f.productId,
        name: f.productName,
        days: f.stockOutDays,
        date: f.stockOutDate,
        risk: f.stockOutRisk,
        available: f.availableStock,
        dailyRate: Number(f.averageDailyRate.toFixed(2)),
      })),
    reorder: input.forecasts.filter((f) => (f.reorderQuantity ?? 0) > 0).slice(0, 12).map((f) => ({
      id: f.productId,
      name: f.productName,
      quantity: f.reorderQuantity,
      windowDays: f.reorderWindowDays,
      method: f.method,
    })),
    overstock: input.forecasts.filter((f) => f.overstockWarning).slice(0, 10).map((f) => ({ id: f.productId, name: f.productName, coverDays: f.overstockDaysOfCover })),
    deadStock: input.inventoryTotals
      .filter((t) => t.available_quantity > 0 && !sold.has(t.product_id))
      .sort((a, b) => b.estimated_value - a.estimated_value)
      .slice(0, 12)
      .map((t) => ({ id: t.product_id, name: t.product_name, available: t.available_quantity, value: roundMoney(t.estimated_value) })),
    expiring: input.expiryRows
      .filter((r) => r.expiry_status !== 'healthy')
      .sort((a, b) => (a.days_remaining ?? -9999) - (b.days_remaining ?? -9999))
      .slice(0, 12)
      .map((r) => ({
        id: r.batch_id,
        name: r.product_name,
        batch: r.batch_number,
        expiry: r.expiry_date,
        days: r.days_remaining,
        qty: r.available_quantity,
        status: r.expiry_status,
        value: roundMoney(r.estimated_value),
      })),
    fastMoving,
    slowMoving,
    forecastInsufficient: input.forecasts.every((f) => f.dataQuality === 'insufficient'),
  };
}

// ---------------------------------------------------------------------------
// Sales intelligence (with filters)
// ---------------------------------------------------------------------------

export interface SalesIntelInputs {
  filters: SalesIntelFilters;
  orders: RawOrder[];
  items: RawOrderItem[];
  previousOrders: RawOrder[];
  retailers: RawRetailer[];
  profiles: RawProfile[];
  brands: { id: string; name: string }[];
  categories: { id: string; name: string }[];
}

export function computeSalesIntel(input: SalesIntelInputs): SalesIntel {
  const { filters } = input;
  const retailerName = new Map(input.retailers.map((r) => [r.id, r.shop_name]));
  const profileName = new Map(input.profiles.map((p) => [p.id, p.full_name]));
  const brandName = new Map(input.brands.map((b) => [b.id, b.name]));
  const categoryName = new Map(input.categories.map((c) => [c.id, c.name]));

  const hasItemFilter = Boolean(filters.categoryId || filters.brandId || filters.productId);

  let orders = input.orders.filter((o) => o.status !== 'cancelled');
  if (filters.retailerId) orders = orders.filter((o) => o.retailer_id === filters.retailerId);
  if (filters.salesmanId) orders = orders.filter((o) => o.collected_by === filters.salesmanId);
  const orderIds = new Set(orders.map((o) => o.id));
  const orderById = new Map(orders.map((o) => [o.id, o]));

  let items = input.items.filter((i) => orderIds.has(i.order_id));
  if (filters.productId) items = items.filter((i) => i.product_id === filters.productId);
  if (filters.brandId) items = items.filter((i) => i.products?.brand_id === filters.brandId);
  if (filters.categoryId) items = items.filter((i) => i.products?.category_id === filters.categoryId);

  // Basis: order-level grand_total when no item-level filter is active (matches
  // the Reports page), line_total when a product/brand/category filter is applied.
  const filteredBasis: 'order' | 'item' = hasItemFilter ? 'item' : 'order';
  const revenueOf = (o: RawOrder) => (filteredBasis === 'item' ? roundMoney(items.filter((i) => i.order_id === o.id).reduce((s, i) => s + i.line_total, 0)) : o.grand_total);
  const countedOrders = hasItemFilter
    ? [...new Set(items.map((i) => i.order_id))].map((id) => orderById.get(id)).filter((o): o is RawOrder => Boolean(o))
    : orders;

  const totalSales = roundMoney(countedOrders.reduce((s, o) => s + revenueOf(o), 0));
  const totalOrders = countedOrders.length;

  // Growth vs the previous equal-length window (same filters, same basis).
  let prevOrders = input.previousOrders.filter((o) => o.status !== 'cancelled');
  if (filters.retailerId) prevOrders = prevOrders.filter((o) => o.retailer_id === filters.retailerId);
  if (filters.salesmanId) prevOrders = prevOrders.filter((o) => o.collected_by === filters.salesmanId);
  const prevIds = new Set(prevOrders.map((o) => o.id));
  let prevItems = input.items.filter((i) => prevIds.has(i.order_id));
  if (filters.productId) prevItems = prevItems.filter((i) => i.product_id === filters.productId);
  if (filters.brandId) prevItems = prevItems.filter((i) => i.products?.brand_id === filters.brandId);
  if (filters.categoryId) prevItems = prevItems.filter((i) => i.products?.category_id === filters.categoryId);
  const prevCounted = hasItemFilter
    ? [...new Set(prevItems.map((i) => i.order_id))]
    : prevOrders.map((o) => o.id);
  const previousPeriodSales = roundMoney(prevCounted.length ? prevCounted.reduce((s, id) => {
    const o = prevOrders.find((x) => x.id === id);
    if (!o) return s;
    if (filteredBasis === 'item') return s + roundMoney(prevItems.filter((i) => i.order_id === id).reduce((ss, i) => ss + i.line_total, 0));
    return s + o.grand_total;
  }, 0) : 0);
  const growthPct = previousPeriodSales > 0 ? roundPct(((totalSales - previousPeriodSales) / previousPeriodSales) * 100) : null;

  // Daily + weekly series on the counted basis.
  const daily = new Map<string, { sales: number; orders: number }>();
  const from = new Date(filters.from + 'T00:00:00');
  const to = new Date(filters.to + 'T23:59:59');
  for (const o of countedOrders) {
    const key = toDateKey(o.placed_at);
    const row = daily.get(key) ?? { sales: 0, orders: 0 };
    row.sales = roundMoney(row.sales + revenueOf(o));
    row.orders += 1;
    daily.set(key, row);
  }
  const dailyPoints: TrendPoint[] = [];
  for (let d = new Date(from); d <= to; d = addDays(d, 1)) {
    const key = toDateKey(d);
    const row = daily.get(key) ?? { sales: 0, orders: 0 };
    dailyPoints.push({ date: key, label: key.slice(5), sales: row.sales, orders: row.orders });
  }
  const weekly = new Map<number, { sales: number; orders: number }>();
  for (const point of dailyPoints) {
    const idx = Math.floor(daysBetween(from, new Date(point.date + 'T00:00:00')) / 7);
    const row = weekly.get(idx) ?? { sales: 0, orders: 0 };
    row.sales = roundMoney(row.sales + point.sales);
    row.orders += point.orders;
    weekly.set(idx, row);
  }
  const weeklyPoints = [...weekly.entries()].sort((a, b) => a[0] - b[0]).map(([idx, row]) => ({ label: `Wk ${idx + 1}`, ...row }));

  // Dimension breakdowns.
  const byProduct = new Map<string, { name: string; value: number; qty: number }>();
  const byCategory = new Map<string, { name: string; value: number }>();
  const byBrand = new Map<string, { name: string; value: number }>();
  for (const item of items) {
    const p = byProduct.get(item.product_id) ?? { name: item.products?.name ?? 'Product', value: 0, qty: 0 };
    p.value = roundMoney(p.value + item.line_total);
    p.qty += item.quantity;
    byProduct.set(item.product_id, p);
    if (item.products?.category_id) {
      const c = byCategory.get(item.products.category_id) ?? { name: categoryName.get(item.products.category_id) ?? 'Uncategorized', value: 0 };
      c.value = roundMoney(c.value + item.line_total);
      byCategory.set(item.products.category_id, c);
    }
    if (item.products?.brand_id) {
      const b = byBrand.get(item.products.brand_id) ?? { name: brandName.get(item.products.brand_id) ?? 'Unbranded', value: 0 };
      b.value = roundMoney(b.value + item.line_total);
      byBrand.set(item.products.brand_id, b);
    }
  }
  const byRetailer = new Map<string, { value: number; orders: number }>();
  const bySalesman = new Map<string, { value: number; orders: number }>();
  for (const o of countedOrders) {
    const rev = revenueOf(o);
    const r = byRetailer.get(o.retailer_id) ?? { value: 0, orders: 0 };
    r.value = roundMoney(r.value + rev);
    r.orders += 1;
    byRetailer.set(o.retailer_id, r);
    if (o.collected_by) {
      const s = bySalesman.get(o.collected_by) ?? { value: 0, orders: 0 };
      s.value = roundMoney(s.value + rev);
      s.orders += 1;
      bySalesman.set(o.collected_by, s);
    }
  }
  const top = (map: Map<string, { name?: string; value: number; qty?: number; orders?: number }>, labelOf: (id: string) => string): TopRow[] =>
    [...map.entries()].sort((a, b) => b[1].value - a[1].value).slice(0, 10).map(([id, row]) => ({
      id,
      name: row.name ?? labelOf(id),
      value: row.value,
      secondary: row.qty !== undefined ? `${row.qty} units` : row.orders !== undefined ? `${row.orders} orders` : undefined,
    }));

  return {
    status: countedOrders.length ? 'ok' : 'empty',
    from: filters.from,
    to: filters.to,
    totalSales,
    totalOrders,
    aov: totalOrders ? roundMoney(totalSales / totalOrders) : null,
    previousPeriodSales,
    growthPct,
    daily: dailyPoints.slice(-30),
    weekly: weeklyPoints,
    topProducts: top(byProduct, () => 'Product'),
    topCategories: top(byCategory, () => 'Uncategorized'),
    topBrands: top(byBrand, () => 'Unbranded'),
    topRetailers: top(byRetailer, (id) => retailerName.get(id) ?? 'Retailer'),
    topSalesmen: top(bySalesman, (id) => profileName.get(id) ?? 'Salesman'),
    filteredBasis,
  };
}

// ---------------------------------------------------------------------------
// Retailer intelligence
// ---------------------------------------------------------------------------

const MATERIAL_SALES = 500; // ₹ — below this a % change is noise, not a signal.

export interface RetailerIntelInputs {
  now?: Date;
  retailers: RawRetailer[];
  ordersRecent: RawOrder[]; // last 30 days
  ordersPrevious: RawOrder[]; // 30-60 days ago
}

export function computeRetailerIntel(input: RetailerIntelInputs): RetailerIntel {
  const now = input.now ?? new Date();
  const recent = input.ordersRecent.filter((o) => o.status !== 'cancelled');
  const previous = input.ordersPrevious.filter((o) => o.status !== 'cancelled');

  const lastOrder = new Map<string, string>();
  const recentByRetailer = new Map<string, { sales: number; orders: number }>();
  const prevByRetailer = new Map<string, number>();
  for (const o of recent) {
    const row = recentByRetailer.get(o.retailer_id) ?? { sales: 0, orders: 0 };
    row.sales = roundMoney(row.sales + o.grand_total);
    row.orders += 1;
    recentByRetailer.set(o.retailer_id, row);
    const key = o.placed_at;
    if (!lastOrder.has(o.retailer_id) || key > lastOrder.get(o.retailer_id)!) lastOrder.set(o.retailer_id, key);
  }
  for (const o of previous) {
    prevByRetailer.set(o.retailer_id, roundMoney((prevByRetailer.get(o.retailer_id) ?? 0) + o.grand_total));
    const key = o.placed_at;
    if (!lastOrder.has(o.retailer_id) || key > lastOrder.get(o.retailer_id)!) lastOrder.set(o.retailer_id, key);
  }

  const inactiveCutoff = addDays(now, -45);
  const rows: RetailerRowIntel[] = input.retailers.map((r) => {
    const recentRow = recentByRetailer.get(r.id);
    const salesRecent = recentRow?.sales ?? 0;
    const salesPrev = prevByRetailer.get(r.id) ?? 0;
    const sales60d = roundMoney(salesRecent + salesPrev);
    const orders60d = (recentRow?.orders ?? 0) + previous.filter((o) => o.retailer_id === r.id).length;
    const lastAt = lastOrder.get(r.id) ?? null;
    const inactive = r.status === 'active' && (!lastAt || new Date(lastAt) < inactiveCutoff);
    const isNew = new Date(r.approved_at ?? r.created_at) >= addDays(now, -30);
    const declining = salesPrev >= MATERIAL_SALES && salesRecent < 0.8 * salesPrev;
    const increasing = salesPrev >= MATERIAL_SALES && salesRecent > 1.2 * salesPrev;
    const position = calculateCreditPosition(r.credit_limit, r.outstanding_balance);
    const tags: string[] = [];
    if (inactive) tags.push('Inactive');
    if (isNew) tags.push('New');
    if (declining) tags.push('Declining');
    if (increasing) tags.push('Increasing');
    if (position.exceedsLimit) tags.push('Over credit limit');
    return {
      retailerId: r.id,
      shopName: r.shop_name,
      status: r.status,
      lastOrderAt: lastAt,
      orders60d,
      frequencyPerMonth: orders60d > 0 ? Number((orders60d / 2).toFixed(1)) : null,
      aov60d: orders60d > 0 ? roundMoney(sales60d / orders60d) : null,
      sales60d,
      salesChangePct: salesPrev > 0 ? roundPct(((salesRecent - salesPrev) / salesPrev) * 100) : null,
      creditUtilizationPct: position.hasConfiguredLimit ? roundPct((position.outstandingBalance / position.creditLimit) * 100) : null,
      tags,
    };
  });

  const sorted = [...rows].sort((a, b) => b.sales60d - a.sales60d);
  const highValueIds = new Set(sorted.slice(0, Math.min(10, Math.max(0, Math.ceil(input.retailers.length * 0.1)))).map((r) => r.retailerId));
  for (const row of rows) if (highValueIds.has(row.retailerId) && row.sales60d > 0) row.tags.push('High value');

  return {
    status: input.retailers.length ? 'ok' : 'empty',
    counts: {
      active: rows.filter((r) => !r.tags.includes('Inactive') && r.status === 'active').length,
      inactive: rows.filter((r) => r.tags.includes('Inactive')).length,
      new30d: rows.filter((r) => r.tags.includes('New')).length,
      highValue: rows.filter((r) => r.tags.includes('High value')).length,
      declining: rows.filter((r) => r.tags.includes('Declining')).length,
      increasing: rows.filter((r) => r.tags.includes('Increasing')).length,
      overLimit: rows.filter((r) => r.tags.includes('Over credit limit')).length,
    },
    rows: sorted.slice(0, 25),
    dataNotes: [
      'Windows: "recent" = last 30 days, "previous" = the 30 days before it (60-day basis for totals).',
      'Declining/increasing require ≥ ₹500 of sales in the earlier window to avoid noise.',
    ],
  };
}

// ---------------------------------------------------------------------------
// Salesman intelligence
// ---------------------------------------------------------------------------

export interface SalesmanIntelInputs {
  now?: Date;
  profiles: RawProfile[];
  ordersRecent: RawOrder[]; // last 30 days
  ordersPrevious: RawOrder[]; // 30-60 days ago
  visits30d: RawVisit[];
}

export function computeSalesmanIntel(input: SalesmanIntelInputs): SalesmanIntel {
  const salesmen = input.profiles.filter((p) => p.role === 'salesman' && p.is_active);
  const visitsBySalesman = new Map<string, number>();
  for (const v of input.visits30d) {
    if (v.status === 'planned') continue;
    visitsBySalesman.set(v.salesman_id, (visitsBySalesman.get(v.salesman_id) ?? 0) + 1);
  }

  const recent = input.ordersRecent.filter((o) => o.status !== 'cancelled' && o.collected_by);
  const previous = input.ordersPrevious.filter((o) => o.status !== 'cancelled' && o.collected_by);
  const prevSales = new Map<string, number>();
  for (const o of previous) prevSales.set(o.collected_by!, roundMoney((prevSales.get(o.collected_by!) ?? 0) + o.grand_total));

  const rows = salesmen.map((p) => {
    const mine = recent.filter((o) => o.collected_by === p.id);
    const sales = roundMoney(mine.reduce((s, o) => s + o.grand_total, 0));
    const salesPrev = prevSales.get(p.id) ?? 0;
    return {
      profileId: p.id,
      name: p.full_name,
      sales30d: sales,
      orders30d: mine.length,
      aov30d: mine.length ? roundMoney(sales / mine.length) : null,
      activeRetailers30d: new Set(mine.map((o) => o.retailer_id)).size,
      visits30d: visitsBySalesman.get(p.id) ?? 0,
      salesChangePct: salesPrev >= MATERIAL_SALES ? roundPct(((sales - salesPrev) / salesPrev) * 100) : null,
      status: (mine.length > 0 ? 'active' : 'inactive') as 'active' | 'inactive' | 'new',
    };
  }).sort((a, b) => b.sales30d - a.sales30d);

  return {
    status: salesmen.length ? 'ok' : 'empty',
    rows: rows.slice(0, 25),
    hasVisitData: input.visits30d.length > 0,
    targetsAvailable: false,
    dataNotes: [
      'Sales = non-cancelled orders captured by the salesman (orders.collected_by) in the last 30 days.',
      'Target achievement is not shown because no target/plan data exists in the schema.',
      input.visits30d.length === 0 ? 'No visit records exist in the last 30 days.' : '',
    ].filter(Boolean),
  };
}

// ---------------------------------------------------------------------------
// Supplier & purchase intelligence (GRN-based; no supplier master table exists)
// ---------------------------------------------------------------------------

export interface SupplierIntelInputs {
  now?: Date;
  grns90d: RawGrn[];
  grnItems: RawGrnItem[];
  reorderForecasts: ForecastResult[];
}

export function computeSupplierIntel(input: SupplierIntelInputs): SupplierIntel {
  const now = input.now ?? new Date();
  const valueOf = (grnId: string) =>
    roundMoney(input.grnItems.filter((i) => i.grn_id === grnId).reduce((s, i) => s + i.received_quantity * (i.unit_cost ?? 0), 0));

  const pending = input.grns90d
    .filter((g) => g.status === 'draft')
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((g) => {
      const items = input.grnItems.filter((i) => i.grn_id === g.id);
      return {
        id: g.id,
        number: g.grn_number,
        supplier: g.supplier_reference ?? 'Unspecified supplier',
        warehouse: g.warehouse_name ?? '—',
        createdAt: g.created_at,
        value: valueOf(g.id),
        items: items.length,
      };
    });

  const confirmed30d = input.grns90d.filter((g) => g.status === 'confirmed' && g.confirmed_at && new Date(g.confirmed_at) >= addDays(now, -30));
  const confirmedValue = roundMoney(confirmed30d.reduce((s, g) => s + valueOf(g.id), 0));

  const supplierMap = new Map<string, { grns90d: number; value90d: number }>();
  for (const g of input.grns90d) {
    if (g.status === 'cancelled') continue;
    const name = (g.supplier_reference ?? '').trim() || 'Unspecified supplier';
    const row = supplierMap.get(name) ?? { grns90d: 0, value90d: 0 };
    row.grns90d += 1;
    row.value90d = roundMoney(row.value90d + valueOf(g.id));
    supplierMap.set(name, row);
  }

  // Supplier price change: last two confirmed receipts of the same product
  // with recorded unit costs.
  const receipts = new Map<string, { cost: number; at: string; name: string }[]>();
  for (const item of input.grnItems) {
    if (item.unit_cost === null || item.unit_cost <= 0) continue;
    const grn = input.grns90d.find((g) => g.id === item.grn_id);
    if (!grn || grn.status !== 'confirmed' || !grn.confirmed_at) continue;
    const list = receipts.get(item.product_id) ?? [];
    list.push({ cost: item.unit_cost, at: grn.confirmed_at, name: item.products?.name ?? 'Product' });
    receipts.set(item.product_id, list);
  }
  const costChanges: SupplierIntel['costChanges'] = [];
  for (const [productId, list] of receipts) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.at.localeCompare(b.at));
    const latest = list[list.length - 1];
    const previous = list[list.length - 2];
    if (!latest || !previous || previous.cost <= 0) continue;
    const changePct = roundPct(((latest.cost - previous.cost) / previous.cost) * 100);
    if (Math.abs(changePct) < 0.5) continue;
    costChanges.push({ productId, productName: latest.name, previousCost: previous.cost, latestCost: latest.cost, changePct, latestAt: latest.at });
  }
  costChanges.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));

  return {
    status: input.grns90d.length ? 'ok' : 'empty',
    pendingGrns: pending.slice(0, 15),
    confirmed30dValue: confirmedValue,
    confirmed30dCount: confirmed30d.length,
    suppliers: [...supplierMap.entries()].sort((a, b) => b[1].value90d - a[1].value90d).slice(0, 12).map(([name, row]) => ({ name, ...row })),
    costChanges: costChanges.slice(0, 10),
    productsRequiringPurchase: input.reorderForecasts.slice(0, 10).map((f) => ({
      id: f.productId,
      name: f.productName,
      quantity: f.reorderQuantity,
      reason: f.explanation,
    })),
    hasGrnData: input.grns90d.length > 0,
  };
}

// ---------------------------------------------------------------------------
// Security & audit
// ---------------------------------------------------------------------------

/** Curated, bounded summary of an audit row — raw jsonb is never surfaced. */
export function summarizeAuditEvent(event: RawAuditLog): string {
  const field = (key: string, data: Record<string, unknown> | null): string | null => {
    if (!data) return null;
    const value = data[key];
    if (value === null || value === undefined) return null;
    const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
    return text.length > 60 ? `${text.slice(0, 57)}…` : text;
  };
  if (event.table_name === 'price_lists') {
    const oldP = field('price', event.old_data);
    const newP = field('price', event.new_data);
    if (oldP !== null || newP !== null) return `price ${oldP ?? '?'} → ${newP ?? '?'}`;
  }
  if (event.table_name === 'orders') {
    const oldS = field('status', event.old_data);
    const newS = field('status', event.new_data);
    if (oldS !== null || newS !== null) return `status ${oldS ?? '?'} → ${newS ?? '?'}`;
  }
  if (event.table_name === 'products') {
    const oldP = field('base_price', event.old_data);
    const newP = field('base_price', event.new_data);
    if (oldP !== null || newP !== null) return `base price ${oldP ?? '?'} → ${newP ?? '?'}`;
  }
  if (event.table_name === 'retailers') {
    const oldS = field('status', event.old_data);
    const newS = field('status', event.new_data);
    if (oldS !== null || newS !== null) return `status ${oldS ?? '?'} → ${newS ?? '?'}`;
  }
  return event.action === 'insert' ? 'record created' : event.action === 'delete' ? 'record deleted' : 'record updated';
}

// ---------------------------------------------------------------------------
// Small numeric helpers (exported for tests)
// ---------------------------------------------------------------------------

export function roundPct(value: number): number {
  return Math.round(value * 10) / 10;
}
