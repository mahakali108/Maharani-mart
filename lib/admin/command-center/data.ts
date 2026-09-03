import 'server-only';

import type { createClient } from '@/lib/supabase/server';
import { runForecastPipeline } from '@/lib/ai/forecast/index';
import { generateForecastInsights, summaryNarrative } from '@/lib/ai/forecast/insights';
import type { ForecastResult, ForecastSummary } from '@/lib/ai/forecast/types';
import { roundMoney } from '@/lib/orders/credit';
import type {
  CommandCenterData,
  SalesIntelFilters,
  SectionStatus,
} from './types';
import {
  buildActions,
  buildDailySeries,
  computeBusinessOverview,
  computeCreditOverview,
  computeInventoryIntel,
  computeRetailerIntel,
  computeRiskCenter,
  computeSalesIntel,
  computeSalesmanIntel,
  computeSupplierIntel,
  computeTrends,
  computeTopPerformers,
  localDayEndIso,
  localMidnightIso,
  roundPct,
  summarizeAuditEvent,
  toDateKey,
  addDays,
  startOfDay,
  type RawAuditLog,
  type RawAiAuditLog,
  type RawExpiryRow,
  type RawGrn,
  type RawGrnItem,
  type RawInventoryTotal,
  type RawOrder,
  type RawOrderItem,
  type RawProfile,
  type RawRetailer,
  type RawVisit,
} from './compute';

type Supabase = ReturnType<typeof createClient>;

const MAX_ORDERS = 5_000;
const MAX_ITEMS = 50_000;

export async function fetchOrders(supabase: Supabase, fromIso: string, toIso: string): Promise<RawOrder[]> {
  const rows: RawOrder[] = [];
  const pageSize = 500;
  for (let offset = 0; offset < MAX_ORDERS; offset += pageSize) {
    const { data, error } = await supabase
      .from('orders')
      .select('id, order_number, retailer_id, collected_by, status, grand_total, placed_at')
      .neq('status', 'cancelled')
      .gte('placed_at', fromIso)
      .lte('placed_at', toIso)
      .order('placed_at', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as unknown as RawOrder[]));
    if ((data?.length ?? 0) < pageSize) break;
  }
  return rows;
}

export async function fetchOrderItems(supabase: Supabase, orderIds: string[]): Promise<RawOrderItem[]> {
  if (orderIds.length === 0) return [];
  const rows: RawOrderItem[] = [];
  for (let index = 0; index < orderIds.length; index += 40) {
    const chunk = orderIds.slice(index, index + 40);
    for (let offset = 0; offset < MAX_ITEMS; offset += 500) {
      const { data, error } = await supabase
        .from('order_items')
        .select(
          'order_id, product_id, quantity, quantity_pieces, line_total, products ( name, sku_code, brand_id, category_id )'
        )
        .in('order_id', chunk)
        .range(offset, offset + 499);
      if (error) throw new Error(error.message);
      rows.push(...((data ?? []) as unknown as RawOrderItem[]));
      if ((data?.length ?? 0) < 500) break;
      if (rows.length > MAX_ITEMS) return rows;
    }
  }
  return rows;
}

/** Bounded helper: a section failure degrades to 'unavailable' instead of crashing the page. */
async function trySection<T>(label: string, fn: () => Promise<T>): Promise<{ value: T | null; status: 'ok' | 'unavailable' }> {
  try {
    const value = await fn();
    return { value, status: 'ok' };
  } catch (error) {
    console.error(`[command-center] ${label} failed:`, error);
    return { value: null, status: 'unavailable' };
  }
}

export interface SalesFilterValidation {
  filters: SalesIntelFilters;
  error: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateKey(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(value + 'T00:00:00');
  return !Number.isNaN(d.getTime()) && toDateKey(d) === value;
}

/** Validates raw searchParams into bounded, safe Sales Intelligence filters. */
export function parseSalesIntelFilters(params: { from?: string; to?: string; category?: string; brand?: string; product?: string; retailer?: string; salesman?: string }, now = new Date()): SalesFilterValidation {
  const maxFrom = toDateKey(addDays(now, -90));
  let from = params.from && isValidDateKey(params.from) ? params.from : toDateKey(addDays(now, -30));
  let to = params.to && isValidDateKey(params.to) ? params.to : toDateKey(now);
  if (from < maxFrom) from = maxFrom;
  if (from > to) [from, to] = [to, from];
  if (toDateKey(addDays(new Date(to + 'T00:00:00'), 1)) < toDateKey(now)) to = toDateKey(now);
  // Cap the window at 90 days so the query stays bounded.
  if (new Date(to + 'T00:00:00').getTime() - new Date(from + 'T00:00:00').getTime() > 89 * 86_400_000) {
    from = toDateKey(addDays(new Date(to + 'T00:00:00'), -89));
  }

  const uuidOr = (value: string | undefined): string | null => (value && UUID_RE.test(value) ? value : null);

  return {
    filters: {
      from,
      to,
      categoryId: uuidOr(params.category),
      brandId: uuidOr(params.brand),
      productId: uuidOr(params.product),
      retailerId: uuidOr(params.retailer),
      salesmanId: uuidOr(params.salesman),
    },
    error: null,
  };
}

export async function gatherCommandCenterData(
  supabase: Supabase,
  options: { salesFilters?: SalesIntelFilters } = {}
): Promise<CommandCenterData> {
  const now = new Date();
  const todayKey = toDateKey(now);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
  const d30 = addDays(now, -30);
  const d60 = addDays(now, -60);
  const d7 = addDays(now, -7);
  const d90 = addDays(now, -90);

  // ---- Parallel, error-isolated fetches ---------------------------------
  const [ordersToday, ordersMonth, ordersPrevMonth, orders30, ordersPrev30, retailers, profiles, totals, expiry, grnsSection, audit, aiAudit, notifFail, myNotifs, visits, adjustments, forecastSection] =
    await Promise.all([
      trySection('orders:today', async () => fetchOrders(supabase, localMidnightIso(todayKey), new Date(now.getTime() + 86_399_000).toISOString())),
      trySection('orders:month', async () => fetchOrders(supabase, monthStart.toISOString(), now.toISOString())),
      trySection('orders:prev-month', async () => fetchOrders(supabase, prevMonthStart.toISOString(), monthStart.toISOString())),
      trySection('orders:30d', async () => fetchOrders(supabase, d30.toISOString(), now.toISOString())),
      trySection('orders:prev-30d', async () => fetchOrders(supabase, d60.toISOString(), d30.toISOString())),
      trySection('retailers', async () => {
        const { data, error } = await supabase.from('retailers').select('id, shop_name, status, credit_limit, outstanding_balance, created_at, approved_at').order('created_at', { ascending: false }).limit(5000);
        if (error) throw new Error(error.message);
        return (data ?? []) as unknown as RawRetailer[];
      }),
      trySection('profiles', async () => {
        const { data, error } = await supabase.from('profiles').select('id, full_name, role, is_active').in('role', ['super_admin', 'admin', 'staff', 'salesman']).limit(1000);
        if (error) throw new Error(error.message);
        return (data ?? []) as unknown as RawProfile[];
      }),
      trySection('inventory:totals', async () => {
        const { data, error } = await supabase.from('inventory_product_totals').select('product_id, product_name, sku_code, quantity_on_hand, reserved_quantity, available_quantity, estimated_value, reorder_level, stock_status').limit(5000);
        if (error) throw new Error(error.message);
        return (data ?? []) as unknown as RawInventoryTotal[];
      }),
      trySection('inventory:expiry', async () => {
        const { data, error } = await supabase.from('inventory_expiry_report').select('batch_id, product_id, product_name, batch_number, warehouse_name, expiry_date, available_quantity, current_quantity, estimated_value, days_remaining, expiry_status').neq('expiry_status', 'healthy').order('days_remaining', { ascending: true }).limit(200);
        if (error) throw new Error(error.message);
        return (data ?? []) as unknown as RawExpiryRow[];
      }),
      trySection('grns:90d', async () => {
        const { data, error } = await supabase.from('grns').select('id, grn_number, status, supplier_reference, created_at, confirmed_at, warehouses ( name )').gte('created_at', d90.toISOString()).order('created_at', { ascending: false }).limit(300);
        if (error) throw new Error(error.message);
        return (data ?? []) as unknown as RawGrnWithWarehouse[];
      }),
      trySection('audit:recent', async () => {
        const { data, error } = await supabase.from('audit_logs').select('id, table_name, action, changed_by, created_at, old_data, new_data, profiles ( full_name )').order('created_at', { ascending: false }).limit(30);
        if (error) throw new Error(error.message);
        return (data ?? []) as unknown as RawAuditLog[];
      }),
      trySection('ai-audit:7d', async () => {
        const { data, error } = await supabase.from('ai_audit_logs').select('id, tool_name, request_type, success, error_code, provider, created_at').gte('created_at', d7.toISOString()).order('created_at', { ascending: false }).limit(300);
        if (error) throw new Error(error.message);
        return (data ?? []) as unknown as RawAiAuditLog[];
      }),
      trySection('notifications:failed', async () => {
        const { data, error } = await supabase.from('notification_logs').select('id').eq('status', 'failed').gte('created_at', d7.toISOString()).limit(100);
        if (error) throw new Error(error.message);
        return (data ?? []).length;
      }),
      trySection('notifications:unread', async () => {
        const { data, error } = await supabase.from('notifications').select('id, title, body, link_url, created_at').eq('is_read', false).order('created_at', { ascending: false }).limit(20);
        if (error) throw new Error(error.message);
        return (data ?? []) as { id: string; title: string; body: string; link_url: string | null; created_at: string }[];
      }),
      trySection('visits:30d', async () => {
        const { data, error } = await supabase.from('visits').select('id, salesman_id, status, created_at').gte('created_at', d30.toISOString()).limit(5000);
        if (error) throw new Error(error.message);
        return (data ?? []) as unknown as RawVisit[];
      }),
      trySection('movements:adjustments', async () => {
        const { data, error } = await supabase.from('stock_movements').select('id, product_id, quantity, reason, performed_by, created_at, products ( name, sku_code ), profiles ( full_name )').eq('movement_type', 'adjustment').gte('created_at', d7.toISOString()).order('created_at', { ascending: false }).limit(50);
        if (error) throw new Error(error.message);
        return (data ?? []) as { id: string; product_id: string; quantity: number; reason: string | null; created_at: string; products: { name: string } | null; profiles: { full_name: string } | null }[];
      }),
      trySection('forecast:pipeline', async () => runForecastPipeline(supabase, { days: 30, limit: 150 })),
    ]);

  const ordersTodayRows = ordersToday.value ?? [];
  const ordersMonthRows = ordersMonth.value ?? [];
  const ordersPrevMonthRows = ordersPrevMonth.value ?? [];
  const orders30Rows = orders30.value ?? [];
  const ordersPrev30Rows = ordersPrev30.value ?? [];
  const retailersRows = retailers.value ?? [];
  const profilesRows = profiles.value ?? [];
  const totalsRows = totals.value ?? [];
  const expiryRowsList = expiry.value ?? [];
  const grnRowsRaw = (grnsSection.value ?? []) as RawGrnWithWarehouse[];
  const auditRows = audit.value ?? [];
  const aiAuditRows = aiAudit.value ?? [];
  const failedNotifCount = notifFail.value ?? 0;
  const myNotifications = myNotifs.value ?? [];
  const visitsRows = visits.value ?? [];
  const adjustmentRows = adjustments.value ?? [];
  const forecast: { summary: ForecastSummary; forecasts: ForecastResult[] } = forecastSection.value
    ? { summary: forecastSection.value.summary, forecasts: forecastSection.value.summary.forecasts }
    : emptyForecast();

  // GRN items for the fetched GRNs (bounded, chunked).
  let grnItems: RawGrnItem[] = [];
  let grnItemsStatus: SectionStatus = 'ok';
  if (grnRowsRaw.length > 0) {
    const result = await trySection('grn-items', async () => {
      const rows: RawGrnItem[] = [];
      for (let index = 0; index < grnRowsRaw.length; index += 40) {
        const chunk = grnRowsRaw.slice(index, index + 40).map((g) => g.id);
        const { data, error } = await supabase.from('grn_items').select('grn_id, product_id, received_quantity, unit_cost, created_at, products ( name )').in('grn_id', chunk).limit(2000);
        if (error) throw new Error(error.message);
        rows.push(...((data ?? []) as unknown as RawGrnItem[]));
      }
      return rows;
    });
    grnItems = result.value ?? [];
    grnItemsStatus = result.status === 'ok' ? 'ok' : 'unavailable';
  }

  const orders7Rows = orders30Rows.filter((o) => new Date(o.placed_at) >= d7);
  const grns: RawGrn[] = grnRowsRaw.map(({ warehouses, ...rest }) => ({ ...rest, warehouse_name: warehouses?.name ?? null }));
  const supplierNames = grns.map((g) => g.supplier_reference ?? '');
  const pendingGrnCount = grns.filter((g) => g.status === 'draft').length;

  // ---- Items for the 30-day window (shared by many sections) -------------
  const itemsResult = await trySection('order-items:30d', () => fetchOrderItems(supabase, orders30Rows.map((o) => o.id)));
  const items30 = itemsResult.value ?? [];

  // ---- Sections -----------------------------------------------------------
  const overview =
    ordersToday.status === 'ok' && ordersMonth.status === 'ok' && retailers.status === 'ok' && totals.status === 'ok'
      ? computeBusinessOverview({
          now,
          ordersToday: ordersTodayRows,
          ordersMonth: ordersMonthRows,
          ordersPreviousMonth: ordersPrevMonthRows,
          orders30d: orders30Rows,
          retailers: retailersRows,
          profiles: profilesRows,
          inventoryTotals: totalsRows,
          expiryRows: expiryRowsList,
          items30d: items30,
          pendingGrns: pendingGrnCount,
          supplierNames,
        })
      : unavailableOverview();

  const trends =
    orders30.status === 'ok' && retailers.status === 'ok'
      ? computeTrends({ now, orders30d: orders30Rows, retailers: retailersRows })
      : { status: 'unavailable' as const, daily: buildDailySeries([], 14, now), aov30d: null, newRetailers30d: 0, returningRetailers7d: 0, creditCollectionAvailable: false };

  const top =
    orders30.status === 'ok' && itemsResult.status === 'ok' && retailers.status === 'ok'
      ? computeTopPerformers({ windowDays: 30, orders: orders30Rows, items: items30, retailers: retailersRows, profiles: profilesRows })
      : { status: 'unavailable' as const, windowDays: 30, products: [], categories: [], brands: [], retailers: [], salesmen: [] };

  const credit = retailers.status === 'ok' ? computeCreditOverview(retailersRows) : { status: 'unavailable' as const, totalConfiguredLimit: 0, retailersWithLimit: 0, totalOutstanding: 0, overLimitCount: 0, overLimitAmount: 0, utilizationPct: null, buckets: [], highRisk: [], paymentTrendAvailable: false };

  const inventory =
    totals.status === 'ok' && expiry.status === 'ok'
      ? { ...computeInventoryIntel({ inventoryTotals: totalsRows, expiryRows: expiryRowsList, items30d: items30, forecasts: forecast.forecasts }), status: itemsResult.status === 'unavailable' ? ('unavailable' as const) : inventoryStatus(totalsRows) }
      : { status: 'unavailable' as const, inventoryValue: 0, onHandProducts: 0, lowStock: [], stockout: [], reorder: [], overstock: [], deadStock: [], expiring: [], fastMoving: [], slowMoving: [], forecastInsufficient: false };

  const retailersIntel =
    retailers.status === 'ok' && orders30.status === 'ok' && ordersPrev30.status === 'ok'
      ? computeRetailerIntel({ now, retailers: retailersRows, ordersRecent: orders30Rows, ordersPrevious: ordersPrev30Rows })
      : { status: 'unavailable' as const, counts: { active: 0, inactive: 0, new30d: 0, highValue: 0, declining: 0, increasing: 0, overLimit: 0 }, rows: [], dataNotes: [] };

  const salesmenIntel =
    profiles.status === 'ok' && orders30.status === 'ok' && ordersPrev30.status === 'ok' && visits.status === 'ok'
      ? computeSalesmanIntel({ now, profiles: profilesRows, ordersRecent: orders30Rows, ordersPrevious: ordersPrev30Rows, visits30d: visitsRows })
      : { status: 'unavailable' as const, rows: [], hasVisitData: false, targetsAvailable: false, dataNotes: [] };

  const supplierIntel =
    grnsSection.status === 'ok' && grnItemsStatus === 'ok'
      ? computeSupplierIntel({ now, grns90d: grns, grnItems, reorderForecasts: forecast.forecasts.filter((f) => (f.reorderQuantity ?? 0) > 0) })
      : { status: 'unavailable' as const, pendingGrns: [], confirmed30dValue: 0, confirmed30dCount: 0, suppliers: [], costChanges: [], productsRequiringPurchase: [], hasGrnData: false };

  const risk =
    retailers.status === 'ok' && totals.status === 'ok' && orders30.status === 'ok'
      ? computeRiskCenter({
          now,
          retailers: retailersRows,
          inventoryTotals: totalsRows,
          expiryRows: expiryRowsList,
          orders30d: orders30Rows,
          orders7d: orders7Rows,
          items30d: items30,
          forecasts: forecast.forecasts,
          aiAuditLogs: aiAuditRows,
          failedNotifications7d: failedNotifCount,
        })
      : { status: 'unavailable' as const, stockoutRisk: emptyBucket(), overstock: emptyBucket(), deadStock: emptyBucket(), expiry: emptyBucket(), credit: emptyBucket(), unusualOrders: emptyBucket(), systemFailures: emptyBucket() };

  const actions =
    retailers.status === 'ok' && totals.status === 'ok' && orders30.status === 'ok'
      ? buildActions({
          now,
          retailers: retailersRows,
          inventoryTotals: totalsRows,
          expiryRows: expiryRowsList,
          orders30d: orders30Rows,
          orders7d: orders7Rows,
          items30d: items30,
          forecasts: forecast.forecasts,
          retailersIntel,
          aiAuditLogs: aiAuditRows,
          failedNotifications7d: failedNotifCount,
        })
      : [];

  const aiFailures7d = aiAuditRows.filter((l) => !l.success);
  const failedTools = new Map<string, { tool: string; code: string; count: number }>();
  for (const l of aiFailures7d) {
    const key = `${l.tool_name ?? l.request_type}:${l.error_code ?? 'unknown'}`;
    const row = failedTools.get(key) ?? { tool: l.tool_name ?? l.request_type, code: l.error_code ?? 'unknown', count: 0 };
    row.count += 1;
    failedTools.set(key, row);
  }
  const security = {
    status: audit.status === 'ok' && aiAudit.status === 'ok' ? ('ok' as const) : ('unavailable' as const),
    events: auditRows.map((e) => ({
      id: e.id,
      table: e.table_name,
      action: e.action,
      changedBy: e.profiles?.full_name ?? (e.changed_by ? 'Unknown user' : 'System'),
      createdAt: e.created_at,
      summary: summarizeAuditEvent(e),
    })),
    ai: {
      requests7d: aiAuditRows.length,
      failures7d: aiFailures7d.length,
      failedTools: [...failedTools.values()].sort((a, b) => b.count - a.count).slice(0, 8),
    },
    failedNotifications7d: failedNotifCount,
    recentAdjustments: adjustmentRows.map((a) => ({
      id: a.id,
      productName: a.products?.name ?? 'Product',
      qty: a.quantity,
      reason: a.reason,
      by: a.profiles?.full_name ?? null,
      at: a.created_at,
    })),
  };

  const insightsSummary = forecast.summary;
  const aiInsights = {
    status: forecastSection.status === 'ok' ? ('ok' as const) : ('unavailable' as const),
    windowDays: insightsSummary.windowDays,
    narrative: insightsSummary.productsWithInsufficientData >= insightsSummary.productsForecast && insightsSummary.productsForecast > 0
      ? 'Not enough order history yet for reliable forecasts — this will populate automatically as real orders accumulate.'
      : summaryNarrative(insightsSummary),
    insights: generateForecastInsights(insightsSummary)
      .slice(0, 12)
      .map((i) => ({ kind: i.kind, severity: i.severity, title: i.title, detail: i.detail, trace: i.trace, productId: i.productId })),
    productsForecast: insightsSummary.productsForecast,
  };

  // ---- Sales Intelligence tab (independent window + filters) --------------
  const salesFilters = options.salesFilters ?? parseSalesIntelFilters({}).filters;
  const salesIntel = await gatherSalesIntel(supabase, salesFilters, retailersRows, profilesRows);

  return {
    generatedAt: now.toISOString(),
    overview,
    trends,
    top,
    risk,
    actions,
    credit,
    inventory,
    retailers: retailersIntel,
    salesmen: salesmenIntel,
    suppliers: supplierIntel,
    security,
    ai: aiInsights,
    notifications: myNotifications.map((n) => ({ id: n.id, title: n.title, body: n.body, linkUrl: n.link_url, createdAt: n.created_at })),
    salesIntel,
  };
}

async function gatherSalesIntel(
  supabase: Supabase,
  filters: SalesIntelFilters,
  retailers: RawRetailer[],
  profiles: RawProfile[]
): Promise<CommandCenterData['salesIntel']> {
  const fromIso = localMidnightIso(filters.from);
  const toIso = localDayEndIso(filters.to);
  const spanDays = Math.max(1, Math.round((new Date(filters.to + 'T00:00:00').getTime() - new Date(filters.from + 'T00:00:00').getTime()) / 86_400_000) + 1);
  const prevTo = new Date(new Date(filters.from + 'T00:00:00').getTime() - 86_400_000);
  const prevFrom = new Date(prevTo.getTime() - (spanDays - 1) * 86_400_000);

  const [orders, prevOrders, brands, categories] = await Promise.all([
    trySection('sales:orders', () => fetchOrders(supabase, fromIso, toIso)),
    trySection('sales:prev-orders', () => fetchOrders(supabase, prevFrom.toISOString(), new Date(prevTo.getTime() + 86_399_999).toISOString())),
    trySection('sales:brands', async () => {
      const { data, error } = await supabase.from('brands').select('id, name').eq('is_active', true).limit(500);
      if (error) throw new Error(error.message);
      return (data ?? []) as { id: string; name: string }[];
    }),
    trySection('sales:categories', async () => {
      const { data, error } = await supabase.from('categories').select('id, name').eq('is_active', true).limit(500);
      if (error) throw new Error(error.message);
      return (data ?? []) as { id: string; name: string }[];
    }),
  ]);

  if (orders.status !== 'ok') {
    return { status: 'unavailable', from: filters.from, to: filters.to, totalSales: 0, totalOrders: 0, aov: null, previousPeriodSales: null, growthPct: null, daily: [], weekly: [], topProducts: [], topCategories: [], topBrands: [], topRetailers: [], topSalesmen: [], filteredBasis: 'order' };
  }

  const ordersRows = orders.value ?? [];
  const prevRows = prevOrders.value ?? [];
  const items = await (async () => {
    const result = await trySection('sales:items', () => fetchOrderItems(supabase, [...ordersRows.map((o) => o.id), ...prevRows.map((o) => o.id)]));
    return result.value ?? [];
  })();

  const brandsRows = brands.value ?? [];
  const categoriesRows = categories.value ?? [];

  // If a filter targets a brand/category/product that no fetched order line
  // references, the result is a real empty set — computed normally below.
  return computeSalesIntel({
    filters,
    orders: ordersRows,
    items,
    previousOrders: prevRows,
    retailers,
    profiles,
    brands: brandsRows,
    categories: categoriesRows,
  });
}

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

interface RawGrnWithWarehouse extends Omit<RawGrn, 'warehouse_name'> {
  warehouses: { name: string } | null;
}

function emptyForecast(): { summary: ForecastSummary; forecasts: ForecastResult[] } {
  return {
    summary: {
      generatedAt: new Date().toISOString(),
      windowDays: 30,
      productsForecast: 0,
      productsWithInsufficientData: 0,
      productsWithStockoutRisk: 0,
      productsNeedingReorder: 0,
      productsOverstocked: 0,
      productsDeadStock: 0,
      rising: 0,
      falling: 0,
      stable: 0,
      averageConfidence: 0,
      totalUnitsOutflow: 0,
      forecasts: [],
    },
    forecasts: [],
  };
}

function inventoryStatus(totalsRows: RawInventoryTotal[]): SectionStatus {
  return totalsRows.length ? 'ok' : 'empty';
}

function unavailableOverview(): CommandCenterData['overview'] {
  return {
    status: 'unavailable',
    todaySales: 0,
    todayOrders: 0,
    monthSales: 0,
    monthOrders: 0,
    previousMonthSales: 0,
    salesMoMChangePct: null,
    revenue30d: 0,
    outstandingCredit: 0,
    overLimitAmount: 0,
    inventoryValue: 0,
    lowStockCount: 0,
    outOfStockCount: 0,
    expiredBatches: 0,
    expiringCriticalBatches: 0,
    expiringWarningBatches: 0,
    deadStockValue: 0,
    deadStockCount: 0,
    activeRetailers: 0,
    totalRetailers: 0,
    activeSalesmen: 0,
    activeStaff: 0,
    supplierCount: 0,
    pendingGrns: 0,
    dataAsOf: new Date().toISOString(),
  };
}

function emptyBucket() {
  return { count: 0, items: [] as import('./types').RiskItem[] };
}

export function formatInr(value: number): string {
  return `₹${roundMoney(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatInrCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_00_00_000) return `₹${roundPct(value / 1_00_00_000)}Cr`;
  if (abs >= 1_00_000) return `₹${roundPct(value / 1_00_000)}L`;
  if (abs >= 1_000) return `₹${Math.round(value / 1_000)}k`;
  return formatInr(value);
}

export function formatPct(value: number | null, suffix = '%'): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${roundPct(value)}${suffix}`;
}

export { startOfDay };
