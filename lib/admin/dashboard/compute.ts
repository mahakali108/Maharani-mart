/**
 * Admin Dashboard — pure aggregations.
 *
 * Inputs are plain row shapes (see types.ts). No Supabase, no invented
 * numbers: cancelled orders are excluded from sales/GST; CGST/SGST/IGST is
 * never guessed; pending collections are not counted as collected money.
 */

import { calculateCreditPosition, roundMoney } from '@/lib/orders/credit';
import { rowPieces } from '@/lib/orders/item-display';
import { computeLineTax } from '@/lib/retailer/invoice-tax';
import { paiseToRupees, roundPct } from './format';
import type {
  CreditSummary,
  DashboardCollectionRow,
  DashboardExpiryRow,
  DashboardInventoryRow,
  DashboardLedgerRow,
  DashboardOrder,
  DashboardOrderItem,
  DashboardRetailer,
  DashboardTicketRow,
  ExpiringBatches,
  GstSummary,
  InventoryAlerts,
  OrderKpis,
  PaymentSummary,
  PendingApprovals,
  RankedRow,
  RecentOrderRow,
  RetailerKpis,
  SalesKpis,
  SupportSummary,
  SystemAlert,
  TopList,
} from './types';

const GST_NOTE =
  'GST is stored inclusive on each invoice (`orders.gst_total`). CGST/SGST vs IGST is decided per invoice when both GSTINs are present — it is never guessed here.';

function billedOrders(orders: DashboardOrder[]): DashboardOrder[] {
  return orders.filter((order) => order.status !== 'cancelled');
}

function sum(values: number[]): number {
  return roundMoney(values.reduce((total, value) => total + value, 0));
}

export function computeSalesKpis(orders: DashboardOrder[], previousOrders: DashboardOrder[]): SalesKpis {
  const billed = billedOrders(orders);
  const previous = billedOrders(previousOrders);
  const sales = sum(billed.map((order) => order.grand_total));
  const previousSales = sum(previous.map((order) => order.grand_total));
  const taxable = sum(billed.map((order) => order.subtotal));
  const gst = sum(billed.map((order) => order.gst_total));
  return {
    status: billed.length ? 'ok' : 'empty',
    sales,
    orderCount: billed.length,
    aov: billed.length ? roundMoney(sales / billed.length) : null,
    previousSales,
    growthPct: previousSales > 0 ? roundPct(((sales - previousSales) / previousSales) * 100) : null,
    taxable,
    gst,
  };
}

export function computeOrderKpis(orders: DashboardOrder[]): OrderKpis {
  const count = (status: string) => orders.filter((order) => order.status === status).length;
  const billed = billedOrders(orders).length;
  const delivered = count('delivered');
  return {
    status: orders.length ? 'ok' : 'empty',
    total: orders.length,
    billed,
    pending: count('pending'),
    confirmed: count('confirmed'),
    processing: count('processing'),
    packed: count('packed'),
    dispatched: count('dispatched'),
    delivered,
    cancelled: count('cancelled'),
    returned: count('returned'),
    fulfillmentPct: billed > 0 ? roundPct((delivered / billed) * 100) : null,
  };
}

export function computeRetailerKpis(
  retailers: DashboardRetailer[],
  fromIso: string,
  toIso: string
): RetailerKpis {
  const inRange = (stamp: string | null) => {
    if (!stamp) return false;
    return stamp >= fromIso && stamp <= toIso;
  };
  return {
    status: retailers.length ? 'ok' : 'empty',
    total: retailers.length,
    active: retailers.filter((row) => row.status === 'active').length,
    pendingApproval: retailers.filter((row) => row.status === 'pending_approval').length,
    suspended: retailers.filter((row) => row.status === 'suspended').length,
    newInRange: retailers.filter((row) => inRange(row.approved_at ?? row.created_at)).length,
  };
}

export function computeCreditSummary(retailers: DashboardRetailer[]): CreditSummary {
  const rows = retailers.map((retailer) => ({
    retailer,
    position: calculateCreditPosition(retailer.credit_limit, retailer.outstanding_balance),
  }));
  const withLimit = rows.filter((row) => row.position.hasConfiguredLimit);
  const totalConfiguredLimit = sum(withLimit.map((row) => row.position.creditLimit));
  const totalOutstanding = sum(rows.map((row) => row.position.outstandingBalance));
  const overLimit = rows.filter((row) => row.position.exceedsLimit);
  const overLimitAmount = sum(
    overLimit.map((row) => row.position.outstandingBalance - row.position.creditLimit)
  );
  const highRisk = [...rows]
    .filter((row) => row.position.hasConfiguredLimit)
    .sort((a, b) => {
      const aUtil = a.position.outstandingBalance / a.position.creditLimit;
      const bUtil = b.position.outstandingBalance / b.position.creditLimit;
      return bUtil - aUtil;
    })
    .slice(0, 5)
    .map((row) => ({
      retailerId: row.retailer.id,
      shopName: row.retailer.shop_name,
      outstanding: row.position.outstandingBalance,
      limit: row.position.creditLimit,
      utilizationPct: roundPct((row.position.outstandingBalance / row.position.creditLimit) * 100),
      exceedsLimit: row.position.exceedsLimit,
    }));

  return {
    status: rows.length ? 'ok' : 'empty',
    totalOutstanding,
    totalConfiguredLimit,
    retailersWithLimit: withLimit.length,
    overLimitCount: overLimit.length,
    overLimitAmount,
    utilizationPct: totalConfiguredLimit > 0 ? roundPct((totalOutstanding / totalConfiguredLimit) * 100) : null,
    highRisk,
  };
}

/**
 * Collected money = wallet PAYMENT_CREDIT that is not reversed.
 * Pending field collections are shown separately and are NOT added to collected
 * (they have not hit the ledger yet).
 */
export function computePaymentSummary(
  ledger: DashboardLedgerRow[],
  collections: DashboardCollectionRow[]
): PaymentSummary {
  const credits = ledger.filter((row) => row.transaction_type === 'PAYMENT_CREDIT' && !row.is_reversed);
  const collected = sum(credits.map((row) => paiseToRupees(row.amount_paise)));
  const pending = collections.filter((row) => row.status === 'pending');
  const verified = collections.filter((row) => row.status === 'verified');
  const rejected = collections.filter((row) => row.status === 'rejected');

  const methodMap = new Map<string, { amount: number; count: number }>();
  for (const row of verified) {
    const current = methodMap.get(row.method) ?? { amount: 0, count: 0 };
    current.amount = roundMoney(current.amount + paiseToRupees(row.amount_paise));
    current.count += 1;
    methodMap.set(row.method, current);
  }
  const byMethod = [...methodMap.entries()]
    .map(([method, row]) => ({ method, amount: row.amount, count: row.count }))
    .sort((a, b) => b.amount - a.amount);

  const hasAnything = credits.length > 0 || collections.length > 0;
  return {
    status: hasAnything ? 'ok' : 'empty',
    collected,
    collectedCount: credits.length,
    pendingVerification: sum(pending.map((row) => paiseToRupees(row.amount_paise))),
    pendingCount: pending.length,
    rejected: sum(rejected.map((row) => paiseToRupees(row.amount_paise))),
    rejectedCount: rejected.length,
    verifiedCollections: sum(verified.map((row) => paiseToRupees(row.amount_paise))),
    verifiedCollectionCount: verified.length,
    byMethod,
  };
}

export function computeGstSummary(orders: DashboardOrder[], items: DashboardOrderItem[]): GstSummary {
  const billed = billedOrders(orders);
  const billedIds = new Set(billed.map((order) => order.id));
  const taxable = sum(billed.map((order) => order.subtotal));
  const gst = sum(billed.map((order) => order.gst_total));
  const invoiceValue = sum(billed.map((order) => order.grand_total));

  const bucketMap = new Map<number, { lineCount: number; inclusive: number; tax: number }>();
  for (const item of items) {
    if (!billedIds.has(item.order_id)) continue;
    const rate = Number(item.gst_percent) || 0;
    const tax = computeLineTax(item.line_total, rate);
    const current = bucketMap.get(rate) ?? { lineCount: 0, inclusive: 0, tax: 0 };
    current.lineCount += 1;
    current.inclusive = roundMoney(current.inclusive + item.line_total);
    current.tax = roundMoney(current.tax + tax);
    bucketMap.set(rate, current);
  }
  const rateBuckets = [...bucketMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([gstPercent, row]) => ({
      gstPercent,
      lineCount: row.lineCount,
      inclusive: row.inclusive,
      tax: row.tax,
      taxable: roundMoney(row.inclusive - row.tax),
    }));

  return {
    status: billed.length ? 'ok' : 'empty',
    invoiceCount: billed.length,
    taxable,
    gst,
    invoiceValue,
    rateBuckets,
    note: GST_NOTE,
  };
}

export function computeTopProducts(
  orders: DashboardOrder[],
  items: DashboardOrderItem[],
  names: Map<string, string>,
  limit = 5
): TopList {
  const billedIds = new Set(billedOrders(orders).map((order) => order.id));
  const byProduct = new Map<string, { qty: number; revenue: number }>();
  for (const item of items) {
    if (!billedIds.has(item.order_id)) continue;
    const current = byProduct.get(item.product_id) ?? { qty: 0, revenue: 0 };
    current.qty += rowPieces(item);
    current.revenue = roundMoney(current.revenue + item.line_total);
    byProduct.set(item.product_id, current);
  }
  const rows: RankedRow[] = [...byProduct.entries()]
    .map(([id, row]) => ({
      id,
      name: names.get(id) ?? 'Unknown',
      value: row.revenue,
      secondary: `${row.qty} pcs`,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
  return { status: rows.length ? 'ok' : 'empty', rows };
}

export function computeTopRetailers(
  orders: DashboardOrder[],
  names: Map<string, string>,
  limit = 5
): TopList {
  const billed = billedOrders(orders);
  const byRetailer = new Map<string, { value: number; orders: number }>();
  for (const order of billed) {
    const current = byRetailer.get(order.retailer_id) ?? { value: 0, orders: 0 };
    current.value = roundMoney(current.value + order.grand_total);
    current.orders += 1;
    byRetailer.set(order.retailer_id, current);
  }
  const rows: RankedRow[] = [...byRetailer.entries()]
    .map(([id, row]) => ({
      id,
      name: names.get(id) ?? 'Unknown',
      value: row.value,
      secondary: `${row.orders} order${row.orders === 1 ? '' : 's'}`,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
  return { status: rows.length ? 'ok' : 'empty', rows };
}

export function computeRecentOrders(
  orders: DashboardOrder[],
  names: Map<string, string>,
  limit = 8
): RecentOrderRow[] {
  return [...orders]
    .sort((a, b) => b.placed_at.localeCompare(a.placed_at))
    .slice(0, limit)
    .map((order) => ({
      id: order.id,
      orderNumber: order.order_number,
      status: order.status,
      grandTotal: order.grand_total,
      placedAt: order.placed_at,
      retailerName: names.get(order.retailer_id) ?? null,
    }));
}

export function computeInventoryAlerts(rows: DashboardInventoryRow[]): InventoryAlerts {
  const low = rows
    .filter((row) => row.stock_status === 'low_stock' || row.stock_status === 'out_of_stock')
    .sort((a, b) => a.quantity_on_hand - b.quantity_on_hand);
  return {
    status: rows.length ? 'ok' : 'empty',
    lowStockCount: rows.filter((row) => row.stock_status === 'low_stock').length,
    outOfStockCount: rows.filter((row) => row.stock_status === 'out_of_stock').length,
    onHandProducts: rows.filter((row) => row.quantity_on_hand > 0).length,
    lowStock: low.slice(0, 8).map((row) => ({
      productId: row.product_id,
      productName: row.product_name,
      skuCode: row.sku_code,
      quantityOnHand: row.quantity_on_hand,
      reorderLevel: row.reorder_level,
      stockStatus: row.stock_status,
    })),
  };
}

export function computeExpiringBatches(rows: DashboardExpiryRow[]): ExpiringBatches {
  const atRisk = rows.filter((row) => row.expiry_status !== 'healthy');
  const sorted = [...atRisk].sort((a, b) => (a.days_remaining ?? -9999) - (b.days_remaining ?? -9999));
  return {
    status: atRisk.length ? 'ok' : 'empty',
    expired: atRisk.filter((row) => row.expiry_status === 'expired').length,
    critical: atRisk.filter((row) => row.expiry_status === 'critical').length,
    warning: atRisk.filter((row) => row.expiry_status === 'warning').length,
    rows: sorted.slice(0, 8).map((row) => ({
      batchId: row.batch_id,
      productName: row.product_name,
      batchNumber: row.batch_number,
      warehouseName: row.warehouse_name,
      expiryDate: row.expiry_date,
      daysRemaining: row.days_remaining,
      quantity: row.available_quantity,
      value: roundMoney(row.estimated_value),
      expiryStatus: row.expiry_status,
    })),
  };
}

export function computeSupportSummary(tickets: DashboardTicketRow[]): SupportSummary {
  const openish = (status: string) => status === 'open' || status === 'in_progress';
  const recent = [...tickets]
    .filter((ticket) => openish(ticket.status))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 5)
    .map((ticket) => ({
      id: ticket.id,
      ticketNumber: ticket.ticket_number,
      subject: ticket.subject,
      status: ticket.status,
      priority: ticket.priority,
      createdAt: ticket.created_at,
    }));
  return {
    status: tickets.length ? 'ok' : 'empty',
    open: tickets.filter((ticket) => ticket.status === 'open').length,
    inProgress: tickets.filter((ticket) => ticket.status === 'in_progress').length,
    urgentOpen: tickets.filter((ticket) => openish(ticket.status) && ticket.priority === 'urgent').length,
    resolved: tickets.filter((ticket) => ticket.status === 'resolved').length,
    closed: tickets.filter((ticket) => ticket.status === 'closed').length,
    recent,
  };
}

export function computePendingApprovals(input: {
  pendingRetailers: number;
  pendingReturns: number;
  pendingCollections: number;
  openTickets: number;
}): PendingApprovals {
  const total =
    input.pendingRetailers + input.pendingReturns + input.pendingCollections + input.openTickets;
  return {
    status: total > 0 ? 'ok' : 'empty',
    retailers: input.pendingRetailers,
    returns: input.pendingReturns,
    collections: input.pendingCollections,
    openTickets: input.openTickets,
  };
}

export function buildSystemAlerts(input: {
  pendingRetailers: number;
  pendingReturns: number;
  pendingCollections: number;
  openTickets: number;
  urgentTickets: number;
  lowStockCount: number;
  outOfStockCount: number;
  expiredBatches: number;
  criticalBatches: number;
  overLimitCount: number;
  overLimitAmount: number;
  failedNotifications7d: number;
}): SystemAlert[] {
  const alerts: SystemAlert[] = [];
  if (input.urgentTickets > 0) {
    alerts.push({
      id: 'tickets-urgent',
      severity: 'urgent',
      title: `${input.urgentTickets} urgent support ticket${input.urgentTickets === 1 ? '' : 's'}`,
      detail: 'Open or in-progress tickets marked urgent by the retailer.',
      href: '/admin/support?status=open&priority=urgent',
    });
  }
  if (input.expiredBatches > 0) {
    alerts.push({
      id: 'expiry-expired',
      severity: 'urgent',
      title: `${input.expiredBatches} expired batch${input.expiredBatches === 1 ? '' : 'es'}`,
      detail: 'Expired stock is never allocated by FEFO. Record a loss or isolate the batch.',
      href: '/admin/inventory/expiry?bucket=expired',
    });
  }
  if (input.overLimitCount > 0) {
    alerts.push({
      id: 'credit-over-limit',
      severity: 'urgent',
      title: `${input.overLimitCount} retailer${input.overLimitCount === 1 ? '' : 's'} over credit limit`,
      detail: `₹${input.overLimitAmount.toLocaleString('en-IN', { maximumFractionDigits: 0 })} beyond configured limits.`,
      href: '/admin/wallets',
    });
  }
  if (input.pendingRetailers > 0) {
    alerts.push({
      id: 'retailers-pending',
      severity: 'high',
      title: `${input.pendingRetailers} retailer registration${input.pendingRetailers === 1 ? '' : 's'} awaiting approval`,
      detail: 'Pending retailers cannot place live orders until approved.',
      href: '/admin/retailers',
    });
  }
  if (input.pendingReturns > 0) {
    alerts.push({
      id: 'returns-pending',
      severity: 'high',
      title: `${input.pendingReturns} return request${input.pendingReturns === 1 ? '' : 's'} awaiting review`,
      detail: 'Retailer return requests on delivered orders.',
      href: '/admin/returns',
    });
  }
  if (input.pendingCollections > 0) {
    alerts.push({
      id: 'collections-pending',
      severity: 'high',
      title: `${input.pendingCollections} field collection${input.pendingCollections === 1 ? '' : 's'} awaiting verification`,
      detail: 'Wallet is credited only after finance verifies the collection.',
      href: '/admin/collections?status=pending',
    });
  }
  if (input.outOfStockCount > 0) {
    alerts.push({
      id: 'stock-out',
      severity: 'high',
      title: `${input.outOfStockCount} product${input.outOfStockCount === 1 ? '' : 's'} out of stock`,
      detail: 'On-hand quantity is zero versus the configured reorder level.',
      href: '/admin/inventory/low-stock',
    });
  }
  if (input.criticalBatches > 0) {
    alerts.push({
      id: 'expiry-critical',
      severity: 'high',
      title: `${input.criticalBatches} batch${input.criticalBatches === 1 ? '' : 'es'} in the critical expiry window`,
      detail: 'FEFO will still allocate these; expedite dispatch or record a loss.',
      href: '/admin/inventory/expiry?bucket=critical',
    });
  }
  if (input.openTickets > 0) {
    alerts.push({
      id: 'tickets-open',
      severity: 'medium',
      title: `${input.openTickets} open support ticket${input.openTickets === 1 ? '' : 's'}`,
      detail: 'Retailer-raised tickets waiting for an admin reply or status change.',
      href: '/admin/support?status=open',
    });
  }
  if (input.lowStockCount > 0) {
    alerts.push({
      id: 'stock-low',
      severity: 'medium',
      title: `${input.lowStockCount} product${input.lowStockCount === 1 ? '' : 's'} below reorder level`,
      detail: 'Live inventory totals, not a forecast.',
      href: '/admin/inventory/low-stock',
    });
  }
  if (input.failedNotifications7d > 0) {
    alerts.push({
      id: 'notifications-failed',
      severity: 'medium',
      title: `${input.failedNotifications7d} notification delivery failure${input.failedNotifications7d === 1 ? '' : 's'} in 7 days`,
      detail: 'Channel failures recorded in notification_logs.',
      href: '/admin/notifications',
    });
  }

  const rank: Record<SystemAlert['severity'], number> = { urgent: 0, high: 1, medium: 2 };
  return alerts.sort((a, b) => rank[a.severity] - rank[b.severity]).slice(0, 12);
}
