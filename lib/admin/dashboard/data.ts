import 'server-only';

import type { createClient } from '@/lib/supabase/server';
import {
  buildSystemAlerts,
  computeCreditSummary,
  computeExpiringBatches,
  computeGstSummary,
  computeInventoryAlerts,
  computeOrderKpis,
  computePaymentSummary,
  computePendingApprovals,
  computeRecentOrders,
  computeRetailerKpis,
  computeSalesKpis,
  computeSupportSummary,
  computeTopProducts,
  computeTopRetailers,
} from './compute';
import type {
  CatalogSnapshot,
  DashboardCollectionRow,
  DashboardData,
  DashboardExpiryRow,
  DashboardInventoryRow,
  DashboardLedgerRow,
  DashboardOrder,
  DashboardOrderItem,
  DashboardRange,
  DashboardRetailer,
  DashboardTicketRow,
  RecentActivity,
  SectionStatus,
} from './types';

type Supabase = ReturnType<typeof createClient>;

const MAX_ORDERS = 5_000;
const MAX_ITEMS = 20_000;
const PAGE = 500;

async function trySection<T>(
  label: string,
  fn: () => Promise<T>
): Promise<{ value: T | null; status: 'ok' | 'unavailable' }> {
  try {
    const value = await fn();
    return { value, status: 'ok' };
  } catch (error) {
    console.error(`[admin-dashboard] ${label} failed:`, error);
    return { value: null, status: 'unavailable' };
  }
}

async function fetchOrders(
  supabase: Supabase,
  fromIso: string,
  toIso: string
): Promise<{ rows: DashboardOrder[]; truncated: boolean }> {
  const rows: DashboardOrder[] = [];
  for (let offset = 0; offset < MAX_ORDERS; offset += PAGE) {
    const { data, error } = await supabase
      .from('orders')
      .select('id, order_number, retailer_id, status, subtotal, gst_total, grand_total, placed_at')
      .gte('placed_at', fromIso)
      .lte('placed_at', toIso)
      .order('placed_at', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as unknown as DashboardOrder[]));
    if ((data?.length ?? 0) < PAGE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

async function fetchOrderItems(supabase: Supabase, orderIds: string[]): Promise<DashboardOrderItem[]> {
  if (orderIds.length === 0) return [];
  const rows: DashboardOrderItem[] = [];
  for (let index = 0; index < orderIds.length; index += 40) {
    const chunk = orderIds.slice(index, index + 40);
    for (let offset = 0; offset < MAX_ITEMS; offset += PAGE) {
      const { data, error } = await supabase
        .from('order_items')
        .select('order_id, product_id, quantity, quantity_pieces, quantity_unit, units_per_case, line_total, gst_percent')
        .in('order_id', chunk)
        .range(offset, offset + PAGE - 1);
      if (error) throw new Error(error.message);
      rows.push(...((data ?? []) as unknown as DashboardOrderItem[]));
      if ((data?.length ?? 0) < PAGE) break;
      if (rows.length >= MAX_ITEMS) return rows;
    }
  }
  return rows;
}

async function headCount(
  result: PromiseLike<{ count: number | null; error: { message: string } | null }>
): Promise<number> {
  const { count, error } = await result;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

function markStatus<T extends { status: SectionStatus }>(
  fetchOk: boolean,
  computed: T
): T {
  if (!fetchOk) return { ...computed, status: 'unavailable' };
  return computed;
}

export async function gatherDashboardData(
  supabase: Supabase,
  range: DashboardRange
): Promise<DashboardData> {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();

  const [
    currentOrders,
    previousOrders,
    retailers,
    inventory,
    expiry,
    ledger,
    collections,
    tickets,
    activity,
    catalogCounts,
    pendingReturns,
    pendingCollections,
    failedNotifications,
  ] = await Promise.all([
    trySection('orders:range', () => fetchOrders(supabase, range.fromIso, range.toIso)),
    trySection('orders:previous', () => fetchOrders(supabase, range.previousFromIso, range.previousToIso)),
    trySection('retailers', async () => {
      const { data, error } = await supabase
        .from('retailers')
        .select('id, shop_name, status, credit_limit, outstanding_balance, created_at, approved_at')
        .order('created_at', { ascending: false })
        .limit(5000);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as DashboardRetailer[];
    }),
    trySection('inventory', async () => {
      const { data, error } = await supabase
        .from('inventory_product_totals')
        .select('product_id, product_name, sku_code, quantity_on_hand, reorder_level, stock_status')
        .limit(5000);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as DashboardInventoryRow[];
    }),
    trySection('expiry', async () => {
      const { data, error } = await supabase
        .from('inventory_expiry_report')
        .select(
          'batch_id, product_id, product_name, batch_number, warehouse_name, expiry_date, available_quantity, estimated_value, days_remaining, expiry_status'
        )
        .neq('expiry_status', 'healthy')
        .order('days_remaining', { ascending: true })
        .limit(200);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as DashboardExpiryRow[];
    }),
    trySection('ledger:payments', async () => {
      const { data, error } = await supabase
        .from('retailer_wallet_ledger')
        .select('amount_paise, transaction_type, is_reversed, created_at')
        .eq('transaction_type', 'PAYMENT_CREDIT')
        .eq('is_reversed', false)
        .gte('created_at', range.fromIso)
        .lte('created_at', range.toIso)
        .limit(5000);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as DashboardLedgerRow[];
    }),
    trySection('collections:range', async () => {
      const { data, error } = await supabase
        .from('payment_collections')
        .select('amount_paise, status, method, created_at')
        .gte('created_at', range.fromIso)
        .lte('created_at', range.toIso)
        .limit(5000);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as DashboardCollectionRow[];
    }),
    trySection('tickets', async () => {
      const { data, error } = await supabase
        .from('support_tickets')
        .select('id, ticket_number, subject, status, priority, created_at')
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as DashboardTicketRow[];
    }),
    trySection('audit', async () => {
      const { data, error } = await supabase
        .from('audit_logs')
        .select('id, table_name, action, created_at, changed_by')
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as {
        id: string;
        table_name: string;
        action: string;
        created_at: string;
        changed_by: string | null;
      }[];
      const ids = [...new Set(rows.map((row) => row.changed_by).filter((id): id is string => Boolean(id)))];
      const { data: profiles } =
        ids.length > 0
          ? await supabase.from('profiles').select('id, full_name').in('id', ids)
          : { data: [] as { id: string; full_name: string }[] };
      const names = new Map(
        ((profiles ?? []) as { id: string; full_name: string }[]).map((profile) => [profile.id, profile.full_name])
      );
      const activityRows: RecentActivity = {
        status: rows.length ? 'ok' : 'empty',
        rows: rows.map((row) => ({
          id: row.id,
          tableName: row.table_name,
          action: row.action,
          createdAt: row.created_at,
          changedByName: row.changed_by ? names.get(row.changed_by) ?? 'Unknown' : null,
        })),
      };
      return activityRows;
    }),
    trySection('catalog', async () => {
      const [products, variants, brands, categories, warehouses] = await Promise.all([
        headCount(supabase.from('products').select('id', { count: 'exact', head: true }).eq('is_active', true)),
        headCount(supabase.from('product_packs').select('id', { count: 'exact', head: true }).eq('is_active', true)),
        headCount(supabase.from('brands').select('id', { count: 'exact', head: true })),
        headCount(supabase.from('categories').select('id', { count: 'exact', head: true })),
        headCount(supabase.from('warehouses').select('id', { count: 'exact', head: true })),
      ]);
      const snapshot: CatalogSnapshot = {
        status: products + variants + brands + categories + warehouses > 0 ? 'ok' : 'empty',
        products,
        variants,
        brands,
        categories,
        warehouses,
      };
      return snapshot;
    }),
    trySection('returns:pending', () =>
      headCount(supabase.from('return_requests').select('id', { count: 'exact', head: true }).eq('status', 'requested'))
    ),
    trySection('collections:pending-all', () =>
      headCount(supabase.from('payment_collections').select('id', { count: 'exact', head: true }).eq('status', 'pending'))
    ),
    trySection('notifications:failed', async () => {
      const { data, error } = await supabase
        .from('notification_logs')
        .select('id')
        .eq('status', 'failed')
        .gte('created_at', sevenDaysAgo)
        .limit(100);
      if (error) throw new Error(error.message);
      return (data ?? []).length;
    }),
  ]);

  const orderRows = currentOrders.value?.rows ?? [];
  const previousRows = previousOrders.value?.rows ?? [];
  const retailerRows = retailers.value ?? [];
  const inventoryRows = inventory.value ?? [];
  const expiryRows = expiry.value ?? [];
  const ledgerRows = ledger.value ?? [];
  const collectionRows = collections.value ?? [];
  const ticketRows = tickets.value ?? [];
  const emptyCatalog: CatalogSnapshot = {
    status: 'unavailable',
    products: 0,
    variants: 0,
    brands: 0,
    categories: 0,
    warehouses: 0,
  };
  const catalog = catalogCounts.value ?? emptyCatalog;
  const pendingReturnCount = pendingReturns.value ?? 0;
  const pendingCollectionCount = pendingCollections.value ?? 0;
  const failedNotifCount = failedNotifications.value ?? 0;
  const ordersTruncated = currentOrders.value?.truncated ?? false;

  const itemsResult = await trySection('order-items', () =>
    fetchOrderItems(
      supabase,
      orderRows.filter((order) => order.status !== 'cancelled').map((order) => order.id)
    )
  );
  const items = itemsResult.value ?? [];

  const productIds = [...new Set(items.map((item) => item.product_id))];
  const productNames = await trySection('product-names', async () => {
    const names = new Map<string, string>();
    if (productIds.length === 0) return names;
    for (let index = 0; index < productIds.length; index += 100) {
      const chunk = productIds.slice(index, index + 100);
      const { data, error } = await supabase.from('products').select('id, name').in('id', chunk);
      if (error) throw new Error(error.message);
      for (const row of (data ?? []) as { id: string; name: string }[]) names.set(row.id, row.name);
    }
    return names;
  });
  const nameByProduct = productNames.value ?? new Map<string, string>();
  const nameByRetailer = new Map(retailerRows.map((row) => [row.id, row.shop_name]));

  const sales = markStatus(currentOrders.status === 'ok', computeSalesKpis(orderRows, previousRows));
  if (currentOrders.status === 'ok' && previousOrders.status === 'unavailable') {
    sales.growthPct = null;
    sales.previousSales = 0;
  }

  const orderKpis = markStatus(currentOrders.status === 'ok', computeOrderKpis(orderRows));
  const retailerKpis = markStatus(
    retailers.status === 'ok',
    computeRetailerKpis(retailerRows, range.fromIso, range.toIso)
  );
  const credit = markStatus(retailers.status === 'ok', computeCreditSummary(retailerRows));
  const payments = markStatus(
    ledger.status === 'ok' && collections.status === 'ok',
    computePaymentSummary(ledgerRows, collectionRows)
  );
  const gst = markStatus(currentOrders.status === 'ok', computeGstSummary(orderRows, items));
  if (itemsResult.status === 'unavailable') {
    gst.rateBuckets = [];
  }
  const topProducts = markStatus(
    currentOrders.status === 'ok' && itemsResult.status === 'ok' && productNames.status === 'ok',
    computeTopProducts(orderRows, items, nameByProduct)
  );
  const topRetailers = markStatus(currentOrders.status === 'ok', computeTopRetailers(orderRows, nameByRetailer));
  const recentOrderRows = computeRecentOrders(orderRows, nameByRetailer);
  const recentOrders = {
    status: (currentOrders.status === 'unavailable'
      ? 'unavailable'
      : recentOrderRows.length
        ? 'ok'
        : 'empty') as SectionStatus,
    rows: recentOrderRows,
  };
  const inventoryAlerts = markStatus(inventory.status === 'ok', computeInventoryAlerts(inventoryRows));
  const expiring = markStatus(expiry.status === 'ok', computeExpiringBatches(expiryRows));
  const support = markStatus(tickets.status === 'ok', computeSupportSummary(ticketRows));

  const pendingRetailers = retailerKpis.pendingApproval;
  const openTickets = support.open + support.inProgress;
  const pendingApprovals = computePendingApprovals({
    pendingRetailers,
    pendingReturns: pendingReturnCount,
    pendingCollections: pendingCollectionCount,
    openTickets,
  });
  if (
    retailers.status === 'unavailable' &&
    pendingReturns.status === 'unavailable' &&
    pendingCollections.status === 'unavailable' &&
    tickets.status === 'unavailable'
  ) {
    pendingApprovals.status = 'unavailable';
  }

  const alerts =
    retailers.status === 'unavailable' && inventory.status === 'unavailable'
      ? []
      : buildSystemAlerts({
          pendingRetailers,
          pendingReturns: pendingReturnCount,
          pendingCollections: pendingCollectionCount,
          openTickets,
          urgentTickets: support.urgentOpen,
          lowStockCount: inventoryAlerts.lowStockCount,
          outOfStockCount: inventoryAlerts.outOfStockCount,
          expiredBatches: expiring.expired,
          criticalBatches: expiring.critical,
          overLimitCount: credit.overLimitCount,
          overLimitAmount: credit.overLimitAmount,
          failedNotifications7d: failedNotifCount,
        });

  const activitySection: RecentActivity =
    activity.status === 'unavailable'
      ? { status: 'unavailable', rows: [] }
      : activity.value ?? { status: 'empty', rows: [] };

  return {
    generatedAt: now.toISOString(),
    range,
    ordersTruncated,
    sales,
    orders: orderKpis,
    retailers: retailerKpis,
    catalog: catalogCounts.status === 'unavailable' ? emptyCatalog : catalog,
    credit,
    payments,
    gst,
    topProducts,
    topRetailers,
    recentOrders,
    pendingApprovals,
    inventory: inventoryAlerts,
    expiring,
    support,
    alerts,
    activity: activitySection,
  };
}
