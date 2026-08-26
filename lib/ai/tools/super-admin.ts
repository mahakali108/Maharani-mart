import 'server-only';

import { z } from 'zod';
import type { AICard, AIToolContext, AIToolDefinition } from '@/lib/ai/types';
import { dbFailure, inr, unavailable, verified } from '@/lib/ai/tools/helpers';
import { runForecastPipeline } from '@/lib/ai/forecast/index';
import type { ForecastResult } from '@/lib/ai/forecast/types';
import {
  buildActions,
  computeBusinessOverview,
  computeCreditOverview,
  computeRetailerIntel,
  computeRiskCenter,
  computeSupplierIntel,
  summarizeAuditEvent,
  addDays,
  type RawAiAuditLog,
  type RawAuditLog,
  type RawExpiryRow,
  type RawGrn,
  type RawGrnItem,
  type RawInventoryTotal,
  type RawOrder,
  type RawOrderItem,
  type RawProfile,
  type RawRetailer,
} from '@/lib/admin/command-center/compute';
import { fetchOrders, fetchOrderItems } from '@/lib/admin/command-center/data';

/**
 * Super Admin executive copilot tools.
 *
 * SECURITY MODEL
 * - actionClass 'READ' only: none of these tools can mutate inventory,
 *   prices, orders, credit, GST, schemes or retailer accounts. The executor
 *   also refuses WRITE tools without the platform confirmation flow and
 *   refuses SENSITIVE tools outright.
 * - roles ['super_admin'] + surfaces ['admin']: the tool registry filters by
 *   authenticated role, so a normal admin/staff/salesman/retailer session
 *   never receives these tools, even if the model requests them by name
 *   (executeBusinessTool re-checks the allowlist per call).
 * - Every query runs through the caller's RLS-scoped client; database text
 *   (notes, reasons, names) is returned as inert data, never interpreted as
 *   instructions (see the system prompt's untrusted-data rule).
 * - Tool allowlist is the fixed set exported here; there is no free-form
 *   query capability, no SQL, no table discovery beyond these tools.
 */

const noArgs = z.object({});
const noArgsJson = { type: 'object', additionalProperties: false };
const roles = ['super_admin'] as const;
const surfaces = ['admin'] as const;

// ---------------------------------------------------------------------------
// Shared, bounded fetch helpers (real rows only)
// ---------------------------------------------------------------------------

async function fetchRetailers(context: AIToolContext): Promise<RawRetailer[] | null> {
  const { data, error } = await context.supabase
    .from('retailers')
    .select('id, shop_name, status, credit_limit, outstanding_balance, created_at, approved_at')
    .limit(5000);
  return error ? null : ((data ?? []) as unknown as RawRetailer[]);
}

async function fetchProfiles(context: AIToolContext): Promise<RawProfile[] | null> {
  const { data, error } = await context.supabase
    .from('profiles')
    .select('id, full_name, role, is_active')
    .in('role', ['super_admin', 'admin', 'staff', 'salesman'])
    .limit(1000);
  return error ? null : ((data ?? []) as unknown as RawProfile[]);
}

async function fetchInventoryTotals(context: AIToolContext): Promise<RawInventoryTotal[] | null> {
  const { data, error } = await context.supabase
    .from('inventory_product_totals')
    .select('product_id, product_name, sku_code, quantity_on_hand, reserved_quantity, available_quantity, estimated_value, reorder_level, stock_status')
    .limit(5000);
  return error ? null : ((data ?? []) as unknown as RawInventoryTotal[]);
}

async function fetchExpiryRows(context: AIToolContext): Promise<RawExpiryRow[] | null> {
  const { data, error } = await context.supabase
    .from('inventory_expiry_report')
    .select('batch_id, product_id, product_name, batch_number, warehouse_name, expiry_date, available_quantity, current_quantity, estimated_value, days_remaining, expiry_status')
    .neq('expiry_status', 'healthy')
    .order('days_remaining', { ascending: true })
    .limit(200);
  return error ? null : ((data ?? []) as unknown as RawExpiryRow[]);
}

interface RiskInputs {
  now: Date;
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

async function collectRiskInputs(context: AIToolContext): Promise<RiskInputs | null> {
  const now = new Date();
  const d30 = addDays(now, -30);
  const d7 = addDays(now, -7);
  const [retailers, inventoryTotals, expiryRows, orders30d, orders7d] = await Promise.all([
    fetchRetailers(context),
    fetchInventoryTotals(context),
    fetchExpiryRows(context),
    fetchOrders(context.supabase, d30.toISOString(), now.toISOString()),
    fetchOrders(context.supabase, d7.toISOString(), now.toISOString()),
  ]);
  if (retailers === null || inventoryTotals === null || expiryRows === null) return null;
  let items30d: RawOrderItem[] = [];
  try {
    items30d = await fetchOrderItems(context.supabase, orders30d.map((o) => o.id));
  } catch {
    items30d = [];
  }
  let forecasts: RiskInputs['forecasts'] = [];
  try {
    forecasts = (await runForecastPipeline(context.supabase, { days: 30, limit: 120 })).summary.forecasts;
  } catch {
    forecasts = [];
  }
  let aiAuditLogs: RawAiAuditLog[] = [];
  let failedNotifications7d = 0;
  try {
    const [ai, notif] = await Promise.all([
      context.supabase
        .from('ai_audit_logs')
        .select('id, tool_name, request_type, success, error_code, provider, created_at')
        .gte('created_at', d7.toISOString())
        .order('created_at', { ascending: false })
        .limit(300),
      context.supabase.from('notification_logs').select('id').eq('status', 'failed').gte('created_at', d7.toISOString()).limit(100),
    ]);
    if (!ai.error) aiAuditLogs = (ai.data ?? []) as unknown as RawAiAuditLog[];
    if (!notif.error) failedNotifications7d = (notif.data ?? []).length;
  } catch {
    // best-effort context
  }
  return { now, retailers, inventoryTotals, expiryRows, orders30d, orders7d, items30d, forecasts, aiAuditLogs, failedNotifications7d };
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

async function commandOverview(context: AIToolContext) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
  const d30 = addDays(now, -30);

  const [ordersToday, ordersMonth, ordersPrevMonth, orders30d, retailers, profiles, totals] = await Promise.all([
    fetchOrders(context.supabase, new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).toISOString(), new Date(now.getTime() + 86_399_000).toISOString()),
    fetchOrders(context.supabase, monthStart.toISOString(), now.toISOString()),
    fetchOrders(context.supabase, prevMonthStart.toISOString(), monthStart.toISOString()),
    fetchOrders(context.supabase, d30.toISOString(), now.toISOString()),
    fetchRetailers(context),
    fetchProfiles(context),
    fetchInventoryTotals(context),
  ]);
  if (retailers === null || profiles === null || totals === null) return dbFailure();
  let items30d: RawOrderItem[] = [];
  try {
    items30d = await fetchOrderItems(context.supabase, orders30d.map((o) => o.id));
  } catch {
    items30d = [];
  }
  const grns = await context.supabase.from('grns').select('id, status, supplier_reference').gte('created_at', addDays(now, -90).toISOString()).limit(300);

  const overview = computeBusinessOverview({
    now,
    ordersToday,
    ordersMonth,
    ordersPreviousMonth: ordersPrevMonth,
    orders30d,
    retailers,
    profiles,
    inventoryTotals: totals,
    expiryRows: [],
    items30d,
    pendingGrns: ((grns.data ?? []) as { status: string }[]).filter((g) => g.status === 'draft').length,
    supplierNames: ((grns.data ?? []) as { supplier_reference: string | null }[]).map((g) => g.supplier_reference ?? ''),
  });
  const compact = {
    today: { sales: overview.todaySales, orders: overview.todayOrders },
    monthToDate: { sales: overview.monthSales, orders: overview.monthOrders, previousMonthSales: overview.previousMonthSales, changePct: overview.salesMoMChangePct },
    revenue30d: overview.revenue30d,
    credit: { outstanding: overview.outstandingCredit, overLimitAmount: overview.overLimitAmount },
    inventory: {
      value: overview.inventoryValue,
      lowStock: overview.lowStockCount,
      outOfStock: overview.outOfStockCount,
      deadStockValue30dNoSales: overview.deadStockValue,
      deadStockCount30dNoSales: overview.deadStockCount,
    },
    network: {
      activeRetailers: overview.activeRetailers,
      totalRetailers: overview.totalRetailers,
      activeSalesmen: overview.activeSalesmen,
      activeStaff: overview.activeStaff,
      suppliersByGrn: overview.supplierCount,
      pendingGrns: overview.pendingGrns,
    },
  };
  const cards: AICard[] = [
    {
      type: 'insight',
      title: 'Business overview (today + month)',
      subtitle: `Data as of ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
      quality: 'verified',
      source: 'Authorized orders, retailers, profiles and inventory_product_totals rows',
      metrics: [
        { label: 'Today sales', value: inr(overview.todaySales), quality: 'verified' },
        { label: 'Today orders', value: String(overview.todayOrders), quality: 'verified' },
        { label: 'Month sales', value: inr(overview.monthSales), quality: 'verified' },
        { label: 'Month orders', value: String(overview.monthOrders), quality: 'verified' },
        { label: '30d revenue', value: inr(overview.revenue30d), quality: 'verified' },
        { label: 'Credit outstanding', value: inr(overview.outstandingCredit), quality: 'verified' },
        { label: 'Inventory value', value: inr(overview.inventoryValue), quality: 'verified' },
        { label: 'Low stock', value: String(overview.lowStockCount), quality: 'verified' },
      ],
      actions: [{ type: 'link', label: 'Open Command Center', href: '/admin/command-center' }],
    },
  ];
  return verified(compact, cards, `orders/retailers/profiles/inventory_product_totals · non-cancelled basis · ${orders30d.length} order rows (30d)`);
}

async function businessRisks(context: AIToolContext) {
  const inputs = await collectRiskInputs(context);
  if (!inputs) return dbFailure();
  const risk = computeRiskCenter(inputs);
  const compact = {
    stockoutRisk: { count: risk.stockoutRisk.count, top: risk.stockoutRisk.items.slice(0, 5).map((i) => ({ title: i.title, severity: i.severity, detail: i.detail, source: i.source })) },
    overstock: { count: risk.overstock.count, top: risk.overstock.items.slice(0, 5).map((i) => ({ title: i.title, detail: i.detail })) },
    deadStock: { count: risk.deadStock.count, value: risk.deadStock.value ?? 0, top: risk.deadStock.items.slice(0, 5).map((i) => ({ title: i.title, value: i.value })) },
    expiry: { count: risk.expiry.count, value: risk.expiry.value ?? 0, top: risk.expiry.items.slice(0, 5).map((i) => ({ title: i.title, severity: i.severity, detail: i.detail })) },
    credit: { count: risk.credit.count, top: risk.credit.items.slice(0, 5).map((i) => ({ title: i.title, severity: i.severity, detail: i.detail, value: i.value })) },
    unusualOrders: { count: risk.unusualOrders.count, top: risk.unusualOrders.items.slice(0, 5).map((i) => ({ title: i.title, detail: i.detail })) },
    systemFailures: { count: risk.systemFailures.count, top: risk.systemFailures.items.slice(0, 5).map((i) => ({ title: i.title, detail: i.detail })) },
  };
  const cards: AICard[] = [
    {
      type: 'insight',
      title: 'Risk center',
      subtitle: 'Signals derived from real rows + the demand-forecast pipeline; nothing synthetic.',
      quality: 'verified',
      source: 'orders, order_items, retailers, inventory views, ai_audit_logs, notification_logs',
      metrics: [
        { label: 'Stock-out risk', value: String(risk.stockoutRisk.count), quality: 'estimate' },
        { label: 'Expiry at risk', value: String(risk.expiry.count), quality: 'verified' },
        { label: 'Credit alerts', value: String(risk.credit.count), quality: 'verified' },
        { label: 'Unusual orders', value: String(risk.unusualOrders.count), quality: 'verified' },
      ],
    },
  ];
  return verified(compact, cards, 'Risk signals computed server-side from authorized data');
}

async function creditRiskReport(context: AIToolContext) {
  const retailers = await fetchRetailers(context);
  if (retailers === null) return dbFailure();
  const overview = computeCreditOverview(retailers);
  const cards: AICard[] = [
    {
      type: 'credit',
      title: 'Credit & risk position',
      subtitle: `Based on ${overview.retailersWithLimit} retailer(s) with a configured limit`,
      quality: 'verified',
      source: 'retailers table + shared calculateCreditPosition (checkout source of truth)',
      metrics: [
        { label: 'Total outstanding', value: inr(overview.totalOutstanding), quality: 'verified' },
        { label: 'Total limit', value: inr(overview.totalConfiguredLimit), quality: 'verified' },
        { label: 'Utilization', value: overview.utilizationPct === null ? 'n/a' : `${overview.utilizationPct}%`, quality: 'verified' },
        { label: 'Over limit', value: `${overview.overLimitCount} (₹${Math.round(overview.overLimitAmount).toLocaleString('en-IN')})`, quality: 'verified' },
      ],
      actions: [{ type: 'link', label: 'Retailers', href: '/admin/retailers' }],
    },
  ];
  return verified(
    {
      totalOutstanding: overview.totalOutstanding,
      totalConfiguredLimit: overview.totalConfiguredLimit,
      utilizationPct: overview.utilizationPct,
      overLimitCount: overview.overLimitCount,
      overLimitAmount: overview.overLimitAmount,
      buckets: overview.buckets,
      highRisk: overview.highRisk.slice(0, 8),
      paymentTrendAvailable: overview.paymentTrendAvailable,
      paymentTrendNote: 'No payment/collection ledger exists in the schema, so collection trends are reported as unavailable — never estimated.',
    },
    cards,
    'retailers + authoritative credit calculator'
  );
}

async function executiveActionPlan(context: AIToolContext) {
  const inputs = await collectRiskInputs(context);
  if (!inputs) return dbFailure();
  const retailersIntel = computeRetailerIntel({
    now: inputs.now,
    retailers: inputs.retailers,
    ordersRecent: inputs.orders30d,
    ordersPrevious: await (async () => {
      const d60 = addDays(inputs.now, -60);
      return fetchOrders(context.supabase, d60.toISOString(), addDays(inputs.now, -30).toISOString());
    })(),
  });
  const actions = buildActions({
    now: inputs.now,
    retailers: inputs.retailers,
    inventoryTotals: inputs.inventoryTotals,
    expiryRows: inputs.expiryRows,
    orders30d: inputs.orders30d,
    orders7d: inputs.orders7d,
    items30d: inputs.items30d,
    forecasts: inputs.forecasts,
    retailersIntel,
    aiAuditLogs: inputs.aiAuditLogs,
    failedNotifications7d: inputs.failedNotifications7d,
  });
  const cards: AICard[] = actions.slice(0, 8).map((action, index) => ({
    type: 'insight' as const,
    id: action.id,
    title: `${index + 1}. [${action.severity.toUpperCase()}] ${action.category}`,
    subtitle: action.entity,
    badge: action.severity,
    quality: 'verified' as const,
    source: action.source,
    lines: [
      { label: 'Reason', value: action.reason },
      { label: 'Recommended action', value: action.recommendedAction },
      { label: 'Required approval', value: action.requiredApproval },
    ],
    actions: action.entityHref ? [{ type: 'link' as const, label: 'View', href: action.entityHref }] : undefined,
  }));
  return verified(
    { actions: actions.slice(0, 10).map(({ id, severity, category, source, entity, reason, recommendedAction, requiredApproval, metric }) => ({ id, severity, category, source, entity, reason, recommendedAction, requiredApproval, metric })) },
    cards,
    'Prioritized from real signals; every action links to the existing workflow that must execute it'
  );
}

async function auditActivity(context: AIToolContext) {
  const days = 7;
  const since = addDays(new Date(), -days).toISOString();
  const { data, error } = await context.supabase
    .from('audit_logs')
    .select('id, table_name, action, changed_by, created_at, old_data, new_data, profiles ( full_name )')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) return dbFailure();
  const rows = (data ?? []) as unknown as RawAuditLog[];
  if (rows.length === 0) {
    return unavailable(`No audited changes recorded in the last ${days} days. Data available nahi hai.`);
  }
  // DB text is untrusted data: fields are bounded and returned inert — never
  // interpreted as instructions (see the system prompt's rule 15).
  const events = rows.map((row) => ({
    at: row.created_at,
    table: row.table_name.slice(0, 60),
    action: row.action.slice(0, 20),
    user: (row.profiles?.full_name ?? (row.changed_by ? 'Unknown user' : 'System')).slice(0, 80),
    summary: summarizeAuditEvent(row),
  }));
  const cards: AICard[] = [
    {
      type: 'insight',
      title: `Recent admin activity (last ${days} days)`,
      subtitle: `${events.length} audited event(s) — curated summaries only, raw payloads are never exposed.`,
      quality: 'verified',
      source: 'audit_logs trigger-populated table (RLS staff+ read)',
      lines: events.slice(0, 12).map((e) => ({ label: `${e.at.slice(0, 16).replace('T', ' ')} · ${e.user}`, value: `${e.table}: ${e.action} — ${e.summary}` })),
    },
  ];
  return verified({ events }, cards, 'audit_logs');
}

async function retailerHealthReport(context: AIToolContext) {
  const now = new Date();
  const [retailers, ordersRecent, ordersPrevious] = await Promise.all([
    fetchRetailers(context),
    fetchOrders(context.supabase, addDays(now, -30).toISOString(), now.toISOString()),
    fetchOrders(context.supabase, addDays(now, -60).toISOString(), addDays(now, -30).toISOString()),
  ]);
  if (retailers === null) return dbFailure();
  const intel = computeRetailerIntel({ now, retailers, ordersRecent, ordersPrevious });
  const cards: AICard[] = [
    {
      type: 'insight',
      title: 'Retailer health (60-day windows)',
      subtitle: intel.dataNotes.join(' '),
      quality: 'verified',
      source: 'orders + retailers + shared credit calculator',
      metrics: [
        { label: 'Active', value: String(intel.counts.active), quality: 'verified' },
        { label: 'Inactive 45d+', value: String(intel.counts.inactive), quality: 'verified' },
        { label: 'New 30d', value: String(intel.counts.new30d), quality: 'verified' },
        { label: 'Declining', value: String(intel.counts.declining), quality: 'verified' },
        { label: 'Over limit', value: String(intel.counts.overLimit), quality: 'verified' },
      ],
      actions: [{ type: 'link', label: 'Retailer Intelligence tab', href: '/admin/command-center?tab=retailers' }],
    },
  ];
  return verified(
    {
      counts: intel.counts,
      top: intel.rows.slice(0, 10).map((r) => ({ shop: r.shopName, sales60d: r.sales60d, orders60d: r.orders60d, lastOrderAt: r.lastOrderAt, salesChangePct: r.salesChangePct, tags: r.tags })),
      notes: intel.dataNotes,
    },
    cards,
    'retailers + orders (non-cancelled), 30/30-day windows'
  );
}

async function supplierStatus(context: AIToolContext) {
  const now = new Date();
  const grnsRes = await context.supabase
    .from('grns')
    .select('id, grn_number, status, supplier_reference, created_at, confirmed_at, warehouses ( name )')
    .gte('created_at', addDays(now, -90).toISOString())
    .order('created_at', { ascending: false })
    .limit(300);
  if (grnsRes.error) return dbFailure();
  const grnRows = (grnsRes.data ?? []) as unknown as Array<Omit<RawGrn, 'warehouse_name'> & { warehouses: { name: string } | null }>;
  const grns: RawGrn[] = grnRows.map(({ warehouses, ...rest }) => ({ ...rest, warehouse_name: warehouses?.name ?? null }));
  if (grns.length === 0) {
    return unavailable('No GRNs (goods receipt notes) recorded in the last 90 days. Purchase intelligence activates when GRNs exist. Data available nahi hai.');
  }
  let grnItems: RawGrnItem[] = [];
  try {
    for (let index = 0; index < grns.length; index += 40) {
      const chunk = grns.slice(index, index + 40).map((g) => g.id);
      const { data, error } = await context.supabase.from('grn_items').select('grn_id, product_id, received_quantity, unit_cost, created_at, products ( name )').in('grn_id', chunk).limit(2000);
      if (error) throw new Error(error.message);
      grnItems.push(...((data ?? []) as unknown as RawGrnItem[]));
    }
  } catch {
    grnItems = [];
  }
  let reorderForecasts: ForecastResult[] = [];
  try {
    reorderForecasts = (await runForecastPipeline(context.supabase, { days: 30, limit: 120 })).summary.forecasts.filter((f) => (f.reorderQuantity ?? 0) > 0);
  } catch {
    reorderForecasts = [];
  }
  const intel = computeSupplierIntel({ now, grns90d: grns, grnItems, reorderForecasts });
  const cards: AICard[] = [
    {
      type: 'insight',
      title: 'Supplier & purchase status (90 days)',
      subtitle: 'No supplier master table exists — suppliers are the free-text supplier references recorded on GRNs.',
      quality: 'verified',
      source: 'grns + grn_items + forecast pipeline reorder signals',
      metrics: [
        { label: 'Pending GRNs', value: String(intel.pendingGrns.length), quality: 'verified' },
        { label: 'Confirmed 30d value', value: inr(intel.confirmed30dValue), quality: 'verified' },
        { label: 'Suppliers', value: String(intel.suppliers.length), quality: 'verified' },
        { label: 'Cost changes', value: String(intel.costChanges.length), quality: 'verified' },
      ],
      actions: [{ type: 'link', label: 'GRNs', href: '/admin/inventory/grn' }],
    },
  ];
  return verified(
    {
      pendingGrns: intel.pendingGrns.slice(0, 8).map((g) => ({ number: g.number, supplier: g.supplier, createdAt: g.createdAt, value: g.value, items: g.items })),
      confirmed30d: { value: intel.confirmed30dValue, count: intel.confirmed30dCount },
      suppliers: intel.suppliers.slice(0, 8),
      costChanges: intel.costChanges.slice(0, 8),
      productsRequiringPurchase: intel.productsRequiringPurchase.slice(0, 8),
    },
    cards,
    'grns + grn_items (90 days)'
  );
}

async function systemHealth(context: AIToolContext) {
  const since = addDays(new Date(), -7).toISOString();
  const [ai, notif, adjustments] = await Promise.all([
    context.supabase.from('ai_audit_logs').select('id, tool_name, request_type, success, error_code, provider, created_at').gte('created_at', since).order('created_at', { ascending: false }).limit(300),
    context.supabase.from('notification_logs').select('id, channel, error, created_at').eq('status', 'failed').gte('created_at', since).order('created_at', { ascending: false }).limit(50),
    context.supabase.from('stock_movements').select('id, product_id, quantity, reason, created_at, products ( name, sku_code ), profiles ( full_name )').eq('movement_type', 'adjustment').gte('created_at', since).order('created_at', { ascending: false }).limit(20),
  ]);
  if (ai.error) return dbFailure();
  const aiRows = (ai.data ?? []) as unknown as RawAiAuditLog[];
  const failures = aiRows.filter((l) => !l.success);
  const failedNotifs = (notif.data ?? []) as { channel: string; error: string | null; created_at: string }[];
  const adjustmentRows = (adjustments.data ?? []) as unknown as Array<{ id: string; quantity: number; reason: string | null; created_at: string; products: { name: string } | null; profiles: { full_name: string } | null }>;
  const cards: AICard[] = [
    {
      type: 'insight',
      title: 'System health (7 days)',
      subtitle: 'Provider/automation failures and manual stock adjustments — for review, not auto-remediation.',
      quality: 'verified',
      source: 'ai_audit_logs + notification_logs + stock_movements',
      metrics: [
        { label: 'AI requests', value: String(aiRows.length), quality: 'verified' },
        { label: 'AI/provider failures', value: String(failures.length), quality: 'verified' },
        { label: 'Failed deliveries', value: String(failedNotifs.length), quality: 'verified' },
        { label: 'Stock adjustments', value: String(adjustmentRows.length), quality: 'verified' },
      ],
      lines: [
        ...failures.slice(0, 6).map((l) => ({ label: `AI failure · ${l.error_code ?? 'unknown'}`, value: `${l.request_type}${l.tool_name ? ` · ${l.tool_name}` : ''}` })),
        ...adjustmentRows.slice(0, 6).map((a) => ({ label: `Adjustment · ${a.products?.name ?? 'product'}`, value: `${a.quantity} by ${a.profiles?.full_name ?? 'unknown'}${a.reason ? ` — ${a.reason}` : ''}` })),
      ],
    },
  ];
  return verified(
    {
      aiRequests7d: aiRows.length,
      aiFailures7d: failures.slice(0, 10).map((l) => ({ code: l.error_code ?? 'unknown', tool: l.tool_name ?? l.request_type, at: l.created_at })),
      failedNotifications7d: failedNotifs.slice(0, 10).map((n) => ({ channel: n.channel, at: n.created_at })),
      stockAdjustments7d: adjustmentRows.map((a) => ({ product: a.products?.name ?? 'product', quantity: a.quantity, by: a.profiles?.full_name ?? null, reason: a.reason, at: a.created_at })),
    },
    cards,
    'ai_audit_logs, notification_logs, stock_movements (7 days)'
  );
}

export const superAdminTools: AIToolDefinition[] = [
  // See SECURITY MODEL at the top of this file: READ-only, role-gated,
  // RLS-scoped, fixed allowlist, no mutation capability.
  {
    name: 'get_command_overview',
    description: 'Get the Super Admin business overview: today/month sales & orders, 30d revenue, credit exposure, inventory value, low/out-of-stock and network counts. Verified data only.',
    actionClass: 'READ',
    roles: [...roles],
    surfaces: [...surfaces],
    inputSchema: noArgs,
    inputJsonSchema: noArgsJson,
    execute: async (_input, context) => commandOverview(context),
  },
  {
    name: 'get_business_risks',
    description: 'Get the full risk center: stock-out, overstock, dead-stock, expiry, credit, unusual-order and system-failure signals from real data. Forecast-derived counts are labelled as estimates.',
    actionClass: 'READ',
    roles: [...roles],
    surfaces: [...surfaces],
    inputSchema: noArgs,
    inputJsonSchema: noArgsJson,
    execute: async (_input, context) => businessRisks(context),
  },
  {
    name: 'get_credit_risk_report',
    description: 'Get credit & risk control: outstanding vs configured limits, utilization buckets, over-limit and highest-utilization retailers. Uses the shared authoritative credit calculator; payment/collection trend is reported unavailable (no payment ledger exists).',
    actionClass: 'READ',
    roles: [...roles],
    surfaces: [...surfaces],
    inputSchema: noArgs,
    inputJsonSchema: noArgsJson,
    execute: async (_input, context) => creditRiskReport(context),
  },
  {
    name: 'get_executive_action_plan',
    description: "Get today's prioritized action plan (URGENT/HIGH/MEDIUM) with reason, recommended action and required approval for each item. Every item traces to a real signal and an existing workflow.",
    actionClass: 'READ',
    roles: [...roles],
    surfaces: [...surfaces],
    inputSchema: noArgs,
    inputJsonSchema: noArgsJson,
    execute: async (_input, context) => executiveActionPlan(context),
  },
  {
    name: 'get_audit_activity',
    description: 'Get recent audited admin activity (price changes, order status changes, record changes) with curated summaries. Raw payloads are never exposed.',
    actionClass: 'READ',
    roles: [...roles],
    surfaces: [...surfaces],
    inputSchema: noArgs,
    inputJsonSchema: noArgsJson,
    execute: async (_input, context) => auditActivity(context),
  },
  {
    name: 'get_retailer_health_report',
    description: 'Get retailer health: active/inactive/new/declining/increasing/over-limit counts and the top movers with order frequency, AOV, last order and credit utilization.',
    actionClass: 'READ',
    roles: [...roles],
    surfaces: [...surfaces],
    inputSchema: noArgs,
    inputJsonSchema: noArgsJson,
    execute: async (_input, context) => retailerHealthReport(context),
  },
  {
    name: 'get_supplier_status',
    description: 'Get supplier & purchase status from GRNs: pending receipts, 30d confirmed purchase value, supplier summary, supplier cost changes and products requiring purchase (forecast reorder signals).',
    actionClass: 'READ',
    roles: [...roles],
    surfaces: [...surfaces],
    inputSchema: noArgs,
    inputJsonSchema: noArgsJson,
    execute: async (_input, context) => supplierStatus(context),
  },
  {
    name: 'get_system_health',
    description: 'Get system operations health: AI/provider failures, failed notification deliveries and manual stock adjustments in the last 7 days.',
    actionClass: 'READ',
    roles: [...roles],
    surfaces: [...surfaces],
    inputSchema: noArgs,
    inputJsonSchema: noArgsJson,
    execute: async (_input, context) => systemHealth(context),
  },
];
