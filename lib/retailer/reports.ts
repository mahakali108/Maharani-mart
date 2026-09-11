import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { indiaDayEndIso, indiaDayStartIso } from '@/lib/datetime/india';
import { formatIndiaDate, indiaMonthStart } from '@/lib/datetime/india';

/**
 * Retailer business insights (Purchase reports). Every number is computed
 * from the retailer's OWN order rows and ledger rows via their
 * RLS-scoped session — cross-retailer data is structurally unreachable.
 * Cancelled orders are excluded from purchase totals, matching the ledger.
 */

export interface PurchaseTotals {
  orderCount: number;
  purchaseValue: number;
  gstTotal: number;
  discountTotal: number;
  creditUsed: number;
}

export interface TopProductRow {
  productId: string;
  name: string;
  brandName: string | null;
  totalPieces: number;
  totalValue: number;
  orderCount: number;
}

export interface MonthTrendRow {
  monthKey: string; // 'YYYY-MM'
  label: string; // 'Sep 2026'
  orderCount: number;
  purchaseValue: number;
}

export interface InsightWindow {
  totals: PurchaseTotals;
  topProducts: TopProductRow[];
}

export const EMPTY_TOTALS: PurchaseTotals = {
  orderCount: 0,
  purchaseValue: 0,
  gstTotal: 0,
  discountTotal: 0,
  creditUsed: 0,
};

/**
 * Pure aggregation over order rows — shared by the weekly/monthly windows
 * and unit-tested so the money math (subtotal − discount + gst, cancelled
 * exclusion) has one implementation.
 */
export function aggregateTotals(
  orders: {
    status: string;
    subtotal: number;
    gst_total: number;
    discount_total: number;
    grand_total: number;
    collected_by: string | null;
  }[]
): PurchaseTotals {
  const totals = { ...EMPTY_TOTALS };
  for (const order of orders) {
    if (order.status === 'cancelled') continue;
    totals.orderCount += 1;
    totals.gstTotal += order.gst_total;
    totals.discountTotal += order.discount_total;
    totals.purchaseValue += order.subtotal - order.discount_total + order.gst_total;
  }
  return totals;
}

/** Pure grouping of order rows into calendar-month trend buckets. */
export function buildMonthTrend(
  orders: { placed_at: string; status: string; subtotal: number; discount_total: number; gst_total: number }[],
  monthsBack = 6,
  now: Date = new Date()
): MonthTrendRow[] {
  const buckets = new Map<string, MonthTrendRow>();
  const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  for (let i = monthsBack - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    buckets.set(key, {
      monthKey: key,
      label: d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
      orderCount: 0,
      purchaseValue: 0,
    });
  }
  for (const order of orders) {
    if (order.status === 'cancelled') continue;
    const placed = new Date(order.placed_at);
    const key = `${placed.getUTCFullYear()}-${String(placed.getUTCMonth() + 1).padStart(2, '0')}`;
    const bucket = buckets.get(key);
    if (!bucket) continue;
    bucket.orderCount += 1;
    bucket.purchaseValue += order.subtotal - order.discount_total + order.gst_total;
  }
  return [...buckets.values()];
}

function purchasesSelect() {
  return 'status, subtotal, gst_total, discount_total, grand_total, collected_by, placed_at';
}

async function loadOrdersBetween(supabase: ReturnType<typeof createClient>, retailerId: string, startIso: string, endIso: string) {
  const { data } = await supabase
    .from('orders')
    .select(purchasesSelect())
    .eq('retailer_id', retailerId)
    .gte('placed_at', startIso)
    .lte('placed_at', endIso);
  return data ?? [];
}

async function loadTopProductsBetween(
  supabase: ReturnType<typeof createClient>,
  retailerId: string,
  startIso: string,
  endIso: string,
  limit = 5
): Promise<TopProductRow[]> {
  const { data } = await supabase
    .from('order_items')
    .select(
      'quantity_pieces, quantity, unit_price, line_total, orders!inner ( retailer_id, placed_at, status ), products ( id, name, brands ( name ) )'
    )
    .eq('orders.retailer_id', retailerId)
    .gte('orders.placed_at', startIso)
    .lte('orders.placed_at', endIso)
    .neq('orders.status', 'cancelled');

  type Row = {
    quantity: number;
    quantity_pieces: number | null;
    line_total: number;
    products: { id: string; name: string; brands: { name: string } | null } | null;
  };
  const byProduct = new Map<string, TopProductRow>();
  for (const row of (data ?? []) as unknown as Row[]) {
    const product = row.products;
    if (!product) continue;
    const pieces = row.quantity_pieces ?? row.quantity;
    const existing = byProduct.get(product.id) ?? {
      productId: product.id,
      name: product.name,
      brandName: product.brands?.name ?? null,
      totalPieces: 0,
      totalValue: 0,
      orderCount: 0,
    };
    existing.totalPieces += pieces;
    existing.totalValue += row.line_total;
    existing.orderCount += 1;
    byProduct.set(product.id, existing);
  }
  return [...byProduct.values()].sort((a, b) => b.totalValue - a.totalValue).slice(0, limit);
}

/**
 * Weekly (last 7 days incl. today) and monthly (current IST calendar month)
 * insight windows for the reports page.
 */
export async function loadInsightWindows(supabase: ReturnType<typeof createClient>, retailerId: string): Promise<{ week: InsightWindow; month: InsightWindow }> {
  const now = new Date();
  const weekStart = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
  weekStart.setUTCHours(0, 0, 0, 0);
  const monthStart = indiaMonthStart(now);

  const [weekOrders, monthOrders] = await Promise.all([
    loadOrdersBetween(supabase, retailerId, weekStart.toISOString(), now.toISOString()),
    loadOrdersBetween(supabase, retailerId, monthStart.toISOString(), now.toISOString()),
  ]);

  const [weekTop, monthTop] = await Promise.all([
    loadTopProductsBetween(supabase, retailerId, weekStart.toISOString(), now.toISOString()),
    loadTopProductsBetween(supabase, retailerId, monthStart.toISOString(), now.toISOString()),
  ]);

  return {
    week: { totals: aggregateTotals(weekOrders), topProducts: weekTop },
    month: { totals: aggregateTotals(monthOrders), topProducts: monthTop },
  };
}

/** Six-month spend trend (cancelled excluded) for the reports page. */
export async function loadSpendTrend(supabase: ReturnType<typeof createClient>, retailerId: string): Promise<MonthTrendRow[]> {
  const { data } = await supabase
    .from('orders')
    .select('placed_at, status, subtotal, discount_total, gst_total')
    .eq('retailer_id', retailerId)
    .order('placed_at', { ascending: false })
    .limit(500);
  return buildMonthTrend(data ?? [], 6);
}

/** Most purchased products across the account's full history. */
export async function loadMostPurchased(supabase: ReturnType<typeof createClient>, retailerId: string, limit = 8): Promise<TopProductRow[]> {
  const nowIso = new Date().toISOString();
  const epochIso = '2000-01-01T00:00:00Z';
  return loadTopProductsBetween(supabase, retailerId, epochIso, nowIso, limit);
}

export interface StatementRow {
  orderNumber: string;
  placedAt: string;
  status: string;
  subtotal: number;
  discountTotal: number;
  gstTotal: number;
  grandTotal: number;
}

/** Purchase statement rows for CSV export (own orders only, RLS-scoped). */
export async function loadPurchaseStatement(
  supabase: ReturnType<typeof createClient>,
  retailerId: string,
  fromIso: string,
  toIso: string
): Promise<StatementRow[]> {
  const { data } = await supabase
    .from('orders')
    .select('order_number, placed_at, status, subtotal, discount_total, gst_total, grand_total')
    .eq('retailer_id', retailerId)
    .gte('placed_at', fromIso)
    .lte('placed_at', toIso)
    .order('placed_at', { ascending: true });
  return (data ?? []) as StatementRow[];
}

export function statementCsv(rows: StatementRow[]): string {
  const header = 'Order number,Placed on (IST),Status,Subtotal (Rs),Discount (Rs),GST (Rs),Grand total (Rs)';
  const lines = rows.map((row) =>
    [
      row.orderNumber,
      formatIndiaDate(row.placedAt),
      row.status,
      row.subtotal.toFixed(2),
      row.discountTotal.toFixed(2),
      row.gstTotal.toFixed(2),
      row.grandTotal.toFixed(2),
    ]
      .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
      .join(',')
  );
  return [header, ...lines].join('\n');
}
