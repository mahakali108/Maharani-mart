import Link from 'next/link';
import type { ElementType, ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  Clock,
  Headset,
  IndianRupee,
  PackageSearch,
  Receipt,
  ShoppingCart,
  Tag,
  Tags,
  Truck,
  UserCheck,
  Users,
  Warehouse,
  Wallet,
} from 'lucide-react';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatIndiaDateTime } from '@/lib/datetime/india';
import type { DashboardData, DashboardVisibility, SectionStatus } from '@/lib/admin/dashboard/types';
import {
  AUDIT_TABLE_LABELS,
  ORDER_STATUS_STYLES,
  PAYMENT_METHOD_LABELS,
  formatCompact,
  formatInr,
  formatInrCompact,
  formatPct,
} from '@/lib/admin/dashboard/format';
import { DashboardRangeFilter } from './dashboard-range-filter';

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${ORDER_STATUS_STYLES[status] ?? 'bg-ink-100 text-ink-600'}`}
    >
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function SectionState({
  status,
  emptyTitle,
  emptyBody,
  children,
}: {
  status: SectionStatus;
  emptyTitle: string;
  emptyBody: string;
  children: ReactNode;
}) {
  if (status === 'unavailable') {
    return <p className="px-1 pb-1 text-sm text-ink-400">This section could not be loaded. Refresh to retry.</p>;
  }
  if (status === 'empty') {
    return (
      <div className="px-1 py-4">
        <p className="text-sm font-medium text-ink-700">{emptyTitle}</p>
        <p className="mt-0.5 text-sm text-ink-400">{emptyBody}</p>
      </div>
    );
  }
  return <>{children}</>;
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  warn,
  href,
}: {
  icon: ElementType;
  label: string;
  value: number | string;
  hint?: string;
  warn?: boolean;
  href?: string;
}) {
  const content = (
    <div className="flex min-w-0 items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="break-words text-xs text-ink-500">{label}</p>
        <p className={`mt-1 break-words text-xl font-semibold ${warn ? 'text-primary-600' : 'text-ink-950'}`}>
          {value}
        </p>
        {hint ? <p className="mt-0.5 text-[11px] text-ink-400">{hint}</p> : null}
      </div>
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${warn ? 'bg-primary-50' : 'bg-ink-50'}`}>
        <Icon className={`h-4 w-4 ${warn ? 'text-primary-600' : 'text-ink-400'}`} />
      </div>
    </div>
  );
  if (href) {
    return (
      <Link href={href}>
        <Card className="transition-colors hover:border-primary-200">{content}</Card>
      </Link>
    );
  }
  return <Card>{content}</Card>;
}

function AlertTone(severity: 'urgent' | 'high' | 'medium'): string {
  if (severity === 'urgent') return 'border-primary-200 bg-primary-50/40';
  if (severity === 'high') return 'border-amber-200 bg-amber-50/40';
  return 'border-ink-100 bg-white';
}

export function DashboardView({
  data,
  visibility,
}: {
  data: DashboardData;
  visibility: DashboardVisibility;
}) {
  const { range } = data;
  const rangeLabel = range.label;

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-semibold text-ink-950">Dashboard</h1>
          <p className="mt-1 text-sm text-ink-500">
            Live overview of Maharani Traders. Every figure is from authorized database rows — nothing is estimated.
          </p>
        </div>
        {visibility.commandCenter ? (
          <Link href="/admin/command-center">
            <Button variant="secondary" size="sm">
              <BarChart3 className="h-4 w-4" />
              Command Center
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </Link>
        ) : null}
      </div>

      <DashboardRangeFilter range={range} />
      {data.ordersTruncated ? (
        <p className="text-xs text-amber-700">
          Showing the first 5,000 orders in this range. Narrow the dates for a complete total.
        </p>
      ) : null}

      {visibility.systemAlerts ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-ink-800">System alerts</h2>
          {data.alerts.length === 0 ? (
            <Card className="border-emerald-200 bg-emerald-50/40">
              <p className="text-sm font-medium text-emerald-800">No operational alerts</p>
              <p className="mt-0.5 text-xs text-emerald-700">
                Alerts appear from real queues: approvals, credit over-limit, stock, expiry, tickets, and failed notifications.
              </p>
            </Card>
          ) : (
            <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
              {data.alerts.map((alert) => (
                <li key={alert.id}>
                  <Link href={alert.href}>
                    <Card className={`transition-colors hover:border-primary-200 ${AlertTone(alert.severity)}`}>
                      <div className="flex min-w-0 items-start gap-2">
                        <AlertTriangle
                          className={`mt-0.5 h-4 w-4 shrink-0 ${alert.severity === 'urgent' ? 'text-primary-600' : 'text-amber-600'}`}
                        />
                        <div className="min-w-0">
                          <p className="break-words text-sm font-medium text-ink-900">{alert.title}</p>
                          <p className="mt-0.5 break-words text-xs text-ink-500">{alert.detail}</p>
                        </div>
                      </div>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {visibility.sales ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-ink-800">Sales</h2>
          <SectionState
            status={data.sales.status}
            emptyTitle="No billed sales in this range"
            emptyBody="Sales KPIs populate from non-cancelled orders as they are placed."
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <StatCard icon={IndianRupee} label="Sales" value={formatInrCompact(data.sales.sales)} hint={rangeLabel} />
              <StatCard icon={ShoppingCart} label="Billed orders" value={data.sales.orderCount} hint={rangeLabel} />
              <StatCard
                icon={Receipt}
                label="Avg. order value"
                value={data.sales.aov === null ? '—' : formatInr(data.sales.aov)}
              />
              <StatCard
                icon={BarChart3}
                label="vs previous period"
                value={formatPct(data.sales.growthPct)}
                hint={data.sales.growthPct === null ? 'Previous window has no sales' : formatInrCompact(data.sales.previousSales)}
              />
              <StatCard icon={Receipt} label="Taxable value" value={formatInrCompact(data.sales.taxable)} hint="Order subtotals" />
            </div>
          </SectionState>
        </section>
      ) : null}

      {visibility.orders ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-ink-800">Orders</h2>
          <SectionState
            status={data.orders.status}
            emptyTitle="No orders in this range"
            emptyBody="Order counts appear as soon as retailers or staff place real orders."
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <StatCard icon={Clock} label="Pending" value={data.orders.pending} warn={data.orders.pending > 0} href="/admin/orders" />
              <StatCard icon={CheckCircle2} label="Confirmed" value={data.orders.confirmed} />
              <StatCard icon={PackageSearch} label="Packed" value={data.orders.packed} />
              <StatCard icon={Truck} label="Dispatched" value={data.orders.dispatched} />
              <StatCard icon={CheckCircle2} label="Delivered" value={data.orders.delivered} />
              <StatCard
                icon={BarChart3}
                label="Fulfilment"
                value={data.orders.fulfillmentPct === null ? '—' : `${data.orders.fulfillmentPct}%`}
                hint={`${data.orders.cancelled} cancelled · ${data.orders.returned} returned`}
              />
            </div>
          </SectionState>
        </section>
      ) : null}

      {visibility.retailers || visibility.catalog ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-ink-800">Network</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {visibility.retailers ? (
              <>
                <StatCard icon={Users} label="Retailers" value={data.retailers.total} hint={`${data.retailers.active} active`} />
                <StatCard
                  icon={UserCheck}
                  label="Pending approvals"
                  value={data.retailers.pendingApproval}
                  warn={data.retailers.pendingApproval > 0}
                  href={data.retailers.pendingApproval > 0 ? '/admin/retailers' : undefined}
                />
                <StatCard icon={Users} label="New in range" value={data.retailers.newInRange} hint={rangeLabel} />
                <StatCard icon={Users} label="Suspended" value={data.retailers.suspended} />
              </>
            ) : null}
            {visibility.catalog ? (
              <>
                <StatCard icon={PackageSearch} label="Active products" value={data.catalog.products} />
                <StatCard icon={Tag} label="Active variants" value={data.catalog.variants} />
              </>
            ) : null}
          </div>
        </section>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {visibility.credit ? (
          <Card>
            <div className="flex items-center justify-between">
              <CardHeader className="mb-3">
                <CardTitle className="flex items-center gap-2">
                  <Wallet className="h-4 w-4 text-primary-600" />
                  Credit / outstanding
                </CardTitle>
              </CardHeader>
              <Link href="/admin/wallets" className="text-xs font-medium text-primary-600 hover:text-primary-700">
                Wallets →
              </Link>
            </div>
            <SectionState
              status={data.credit.status}
              emptyTitle="No retailer accounts yet"
              emptyBody="Outstanding and limits appear once retailers are on the books."
            >
              <p className="text-2xl font-semibold text-ink-950">{formatInr(data.credit.totalOutstanding)}</p>
              <p className="mt-1 text-xs text-ink-400">
                Limit {formatInrCompact(data.credit.totalConfiguredLimit)} · utilization{' '}
                {data.credit.utilizationPct === null ? '—' : `${data.credit.utilizationPct}%`}
              </p>
              <p className={`mt-2 text-sm ${data.credit.overLimitCount > 0 ? 'font-medium text-primary-700' : 'text-ink-500'}`}>
                {data.credit.overLimitCount} over limit
                {data.credit.overLimitCount > 0 ? ` · ${formatInrCompact(data.credit.overLimitAmount)} beyond cap` : ''}
              </p>
              {data.credit.highRisk.length > 0 ? (
                <ul className="mt-3 divide-y divide-ink-100">
                  {data.credit.highRisk.map((row) => (
                    <li key={row.retailerId} className="flex min-w-0 items-center justify-between gap-2 py-2 text-sm">
                      <Link href={`/admin/wallets/${row.retailerId}`} className="min-w-0 truncate text-ink-800 hover:text-primary-600">
                        {row.shopName}
                      </Link>
                      <span className={`shrink-0 text-xs ${row.exceedsLimit ? 'font-medium text-primary-700' : 'text-ink-400'}`}>
                        {formatInrCompact(row.outstanding)}
                        {row.utilizationPct !== null ? ` · ${row.utilizationPct}%` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </SectionState>
          </Card>
        ) : null}

        {visibility.payments ? (
          <Card>
            <div className="flex items-center justify-between">
              <CardHeader className="mb-3">
                <CardTitle>Payments</CardTitle>
              </CardHeader>
              <Link href="/admin/collections" className="text-xs font-medium text-primary-600 hover:text-primary-700">
                Collections →
              </Link>
            </div>
            <SectionState
              status={data.payments.status}
              emptyTitle="No payments in this range"
              emptyBody="Wallet PAYMENT_CREDIT rows and field collections will show here. Pending collections are not counted as collected."
            >
              <p className="text-2xl font-semibold text-ink-950">{formatInr(data.payments.collected)}</p>
              <p className="mt-1 text-xs text-ink-400">
                {data.payments.collectedCount} wallet credit{data.payments.collectedCount === 1 ? '' : 's'} · {rangeLabel}
              </p>
              <p className="mt-2 text-sm text-ink-600">
                Awaiting verification {formatInrCompact(data.payments.pendingVerification)} ({data.payments.pendingCount})
              </p>
              <p className="text-xs text-ink-400">
                Field-verified {formatInrCompact(data.payments.verifiedCollections)} · rejected{' '}
                {formatInrCompact(data.payments.rejected)}
              </p>
              {data.payments.byMethod.length > 0 ? (
                <ul className="mt-3 space-y-1 text-xs text-ink-500">
                  {data.payments.byMethod.map((row) => (
                    <li key={row.method} className="flex justify-between gap-2">
                      <span>{PAYMENT_METHOD_LABELS[row.method] ?? row.method}</span>
                      <span>
                        {formatInrCompact(row.amount)} · {row.count}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </SectionState>
          </Card>
        ) : null}

        {visibility.gst ? (
          <Card>
            <CardHeader className="mb-3">
              <CardTitle>GST summary</CardTitle>
            </CardHeader>
            <SectionState
              status={data.gst.status}
              emptyTitle="No invoices in this range"
              emptyBody="GST is taken from stored order totals once billed orders exist."
            >
              <p className="text-2xl font-semibold text-ink-950">{formatInr(data.gst.gst)}</p>
              <p className="mt-1 text-xs text-ink-400">
                Taxable {formatInrCompact(data.gst.taxable)} · invoice value {formatInrCompact(data.gst.invoiceValue)} ·{' '}
                {data.gst.invoiceCount} invoice{data.gst.invoiceCount === 1 ? '' : 's'}
              </p>
              {data.gst.rateBuckets.length > 0 ? (
                <ul className="mt-3 space-y-1 text-xs text-ink-500">
                  {data.gst.rateBuckets.map((bucket) => (
                    <li key={bucket.gstPercent} className="flex justify-between gap-2">
                      <span>{bucket.gstPercent}% · {bucket.lineCount} lines</span>
                      <span>{formatInrCompact(bucket.tax)}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="mt-3 text-[11px] leading-4 text-ink-400">{data.gst.note}</p>
            </SectionState>
          </Card>
        ) : null}
      </div>

      {visibility.pendingApprovals ? (
        <Card>
          <CardHeader className="mb-3">
            <CardTitle>Pending approvals</CardTitle>
          </CardHeader>
          <SectionState
            status={data.pendingApprovals.status}
            emptyTitle="Nothing waiting"
            emptyBody="Retailer registrations, return requests, field collections, and open tickets land here."
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Link href="/admin/retailers" className="rounded-xl bg-ink-50 px-3 py-3 hover:bg-primary-50">
                <p className="text-xs text-ink-500">Retailer registrations</p>
                <p className={`mt-1 text-lg font-semibold ${data.pendingApprovals.retailers > 0 ? 'text-primary-600' : 'text-ink-950'}`}>
                  {data.pendingApprovals.retailers}
                </p>
              </Link>
              <Link href="/admin/returns" className="rounded-xl bg-ink-50 px-3 py-3 hover:bg-primary-50">
                <p className="text-xs text-ink-500">Return requests</p>
                <p className={`mt-1 text-lg font-semibold ${data.pendingApprovals.returns > 0 ? 'text-primary-600' : 'text-ink-950'}`}>
                  {data.pendingApprovals.returns}
                </p>
              </Link>
              <Link href="/admin/collections?status=pending" className="rounded-xl bg-ink-50 px-3 py-3 hover:bg-primary-50">
                <p className="text-xs text-ink-500">Collections to verify</p>
                <p className={`mt-1 text-lg font-semibold ${data.pendingApprovals.collections > 0 ? 'text-primary-600' : 'text-ink-950'}`}>
                  {data.pendingApprovals.collections}
                </p>
              </Link>
              <Link href="/admin/support?status=open" className="rounded-xl bg-ink-50 px-3 py-3 hover:bg-primary-50">
                <p className="text-xs text-ink-500">Open tickets</p>
                <p className={`mt-1 text-lg font-semibold ${data.pendingApprovals.openTickets > 0 ? 'text-primary-600' : 'text-ink-950'}`}>
                  {data.pendingApprovals.openTickets}
                </p>
              </Link>
            </div>
          </SectionState>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {visibility.recentOrders ? (
          <Card>
            <div className="flex items-center justify-between">
              <CardHeader>
                <CardTitle>Recent orders</CardTitle>
              </CardHeader>
              <Link href="/admin/orders" className="text-xs font-medium text-primary-600 hover:text-primary-700">
                View all →
              </Link>
            </div>
            <SectionState
              status={data.recentOrders.status}
              emptyTitle="No orders in this range"
              emptyBody="The latest billed and pending orders for the selected dates will appear here."
            >
              <ul className="divide-y divide-ink-100">
                {data.recentOrders.rows.map((order) => (
                  <li key={order.id} className="flex min-w-0 items-center justify-between gap-3 px-1 py-3 text-sm">
                    <div className="min-w-0">
                      <Link
                        href={`/admin/orders/${order.id}`}
                        className="font-mono text-xs font-medium text-ink-900 hover:text-primary-600"
                      >
                        {order.orderNumber}
                      </Link>
                      <p className="break-words text-xs text-ink-400">
                        {order.retailerName ?? 'Unknown'} · {formatIndiaDateTime(order.placedAt)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-medium text-ink-900">{formatInr(order.grandTotal)}</p>
                      <StatusBadge status={order.status} />
                    </div>
                  </li>
                ))}
              </ul>
            </SectionState>
          </Card>
        ) : null}

        {visibility.topProducts ? (
          <Card>
            <CardHeader>
              <CardTitle>Top products ({rangeLabel})</CardTitle>
            </CardHeader>
            <SectionState
              status={data.topProducts.status}
              emptyTitle="No product sales yet"
              emptyBody="Top products rank by stored line totals (pieces, not cases) as orders come in."
            >
              <ul className="divide-y divide-ink-100">
                {data.topProducts.rows.map((row, index) => (
                  <li key={row.id} className="flex min-w-0 items-center justify-between gap-3 px-1 py-3 text-sm">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink-100 text-xs font-semibold text-ink-600">
                        {index + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="break-words font-medium text-ink-900">{row.name}</p>
                        <p className="text-xs text-ink-400">{row.secondary}</p>
                      </div>
                    </div>
                    <p className="shrink-0 font-semibold text-ink-900">{formatInr(row.value)}</p>
                  </li>
                ))}
              </ul>
            </SectionState>
          </Card>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {visibility.topRetailers ? (
          <Card>
            <div className="flex items-center justify-between">
              <CardHeader>
                <CardTitle>Top retailers ({rangeLabel})</CardTitle>
              </CardHeader>
              <Link href="/admin/retailers" className="text-xs font-medium text-primary-600 hover:text-primary-700">
                Retailers →
              </Link>
            </div>
            <SectionState
              status={data.topRetailers.status}
              emptyTitle="No retailer sales in this range"
              emptyBody="Ranked by non-cancelled order grand totals."
            >
              <ul className="divide-y divide-ink-100">
                {data.topRetailers.rows.map((row, index) => (
                  <li key={row.id} className="flex min-w-0 items-center justify-between gap-3 px-1 py-3 text-sm">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink-100 text-xs font-semibold text-ink-600">
                        {index + 1}
                      </span>
                      <div className="min-w-0">
                        <Link href={`/admin/retailers/${row.id}`} className="break-words font-medium text-ink-900 hover:text-primary-600">
                          {row.name}
                        </Link>
                        <p className="text-xs text-ink-400">{row.secondary}</p>
                      </div>
                    </div>
                    <p className="shrink-0 font-semibold text-ink-900">{formatInr(row.value)}</p>
                  </li>
                ))}
              </ul>
            </SectionState>
          </Card>
        ) : null}

        {visibility.support ? (
          <Card>
            <div className="flex items-center justify-between">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Headset className="h-4 w-4 text-primary-600" />
                  Support tickets
                </CardTitle>
              </CardHeader>
              <Link href="/admin/support" className="text-xs font-medium text-primary-600 hover:text-primary-700">
                Queue →
              </Link>
            </div>
            <SectionState
              status={data.support.status}
              emptyTitle="No support tickets yet"
              emptyBody="Retailer-raised tickets appear here as soon as they are opened."
            >
              <div className="mb-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-amber-50 px-2 py-2">
                  <p className="text-lg font-semibold text-amber-800">{data.support.open}</p>
                  <p className="text-[10px] text-amber-700">Open</p>
                </div>
                <div className="rounded-xl bg-blue-50 px-2 py-2">
                  <p className="text-lg font-semibold text-blue-800">{data.support.inProgress}</p>
                  <p className="text-[10px] text-blue-700">In progress</p>
                </div>
                <div className="rounded-xl bg-primary-50 px-2 py-2">
                  <p className="text-lg font-semibold text-primary-700">{data.support.urgentOpen}</p>
                  <p className="text-[10px] text-primary-700">Urgent</p>
                </div>
              </div>
              <ul className="divide-y divide-ink-100">
                {data.support.recent.map((ticket) => (
                  <li key={ticket.id} className="flex min-w-0 items-center justify-between gap-3 py-2 text-sm">
                    <div className="min-w-0">
                      <Link href={`/admin/support/${ticket.id}`} className="font-mono text-xs font-medium text-ink-900 hover:text-primary-600">
                        {ticket.ticketNumber}
                      </Link>
                      <p className="truncate text-xs text-ink-400">{ticket.subject}</p>
                    </div>
                    <span className="shrink-0 text-[10px] font-medium uppercase text-ink-400">{ticket.priority}</span>
                  </li>
                ))}
              </ul>
            </SectionState>
          </Card>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {visibility.lowStock ? (
          <Card className={data.inventory.lowStock.length > 0 ? 'border-primary-100' : undefined}>
            <div className="flex items-center justify-between">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-primary-600" />
                  Low-stock products
                </CardTitle>
              </CardHeader>
              <Link href="/admin/inventory/low-stock" className="text-xs font-medium text-primary-600 hover:text-primary-700">
                Manage →
              </Link>
            </div>
            <SectionState
              status={data.inventory.status === 'ok' && data.inventory.lowStock.length === 0 ? 'empty' : data.inventory.status}
              emptyTitle={data.inventory.status === 'empty' ? 'No inventory records yet' : 'No low-stock products'}
              emptyBody={
                data.inventory.status === 'empty'
                  ? 'Stock alerts appear after warehouse movements are recorded.'
                  : `${data.inventory.onHandProducts} product(s) currently have stock on hand.`
              }
            >
              <p className="mb-2 text-xs text-ink-400">
                {data.inventory.outOfStockCount} out of stock · {data.inventory.lowStockCount} below reorder
              </p>
              <ul className="divide-y divide-ink-100">
                {data.inventory.lowStock.map((row) => (
                  <li key={row.productId} className="flex min-w-0 items-center justify-between gap-3 py-2.5 text-sm">
                    <span className="min-w-0 break-words text-ink-700">{row.productName}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          row.stockStatus === 'out_of_stock' ? 'bg-primary-50 text-primary-700' : 'bg-amber-50 text-amber-700'
                        }`}
                      >
                        {row.stockStatus === 'out_of_stock' ? 'Out of stock' : 'Low stock'}
                      </span>
                      <span className="text-xs text-ink-400">{row.quantityOnHand} left</span>
                    </span>
                  </li>
                ))}
              </ul>
            </SectionState>
          </Card>
        ) : null}

        {visibility.expiringBatches ? (
          <Card>
            <div className="flex items-center justify-between">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CalendarClock className="h-4 w-4 text-primary-600" />
                  Expiring batches
                </CardTitle>
              </CardHeader>
              <Link href="/admin/inventory/expiry" className="text-xs font-medium text-primary-600 hover:text-primary-700">
                Expiry →
              </Link>
            </div>
            <SectionState
              status={data.expiring.status}
              emptyTitle="No batches in the expiry window"
              emptyBody="Expired, critical, and warning batches from inventory_expiry_report appear here."
            >
              <p className="mb-2 text-xs text-ink-400">
                {data.expiring.expired} expired · {data.expiring.critical} critical · {data.expiring.warning} warning
              </p>
              <ul className="divide-y divide-ink-100">
                {data.expiring.rows.map((row) => (
                  <li key={row.batchId} className="flex min-w-0 items-center justify-between gap-3 py-2.5 text-sm">
                    <div className="min-w-0">
                      <p className="break-words text-ink-800">{row.productName}</p>
                      <p className="text-xs text-ink-400">
                        {row.batchNumber} · {row.warehouseName}
                      </p>
                    </div>
                    <span className="shrink-0 text-right text-xs text-ink-500">
                      {row.daysRemaining === null
                        ? 'No date'
                        : row.daysRemaining < 0
                          ? `${-row.daysRemaining}d overdue`
                          : `${row.daysRemaining}d left`}
                    </span>
                  </li>
                ))}
              </ul>
            </SectionState>
          </Card>
        ) : null}
      </div>

      {visibility.activity ? (
        <Card>
          <div className="flex items-center justify-between">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary-600" />
                Recent activity
              </CardTitle>
            </CardHeader>
            <Link href="/admin/audit-logs" className="text-xs font-medium text-primary-600 hover:text-primary-700">
              Audit log →
            </Link>
          </div>
          <SectionState
            status={data.activity.status}
            emptyTitle="No audited changes yet"
            emptyBody="Changes to products, pricing, orders, and more will appear here."
          >
            <ul className="divide-y divide-ink-100">
              {data.activity.rows.map((row) => (
                <li key={row.id} className="flex min-w-0 items-center justify-between gap-3 px-1 py-3 text-sm">
                  <span className="min-w-0 break-words text-ink-700">
                    <span className="font-medium text-ink-900">{row.changedByName ?? 'System'}</span>{' '}
                    {row.action === 'INSERT' || row.action === 'insert'
                      ? 'added'
                      : row.action === 'UPDATE' || row.action === 'update'
                        ? 'updated'
                        : 'removed'}{' '}
                    {AUDIT_TABLE_LABELS[row.tableName] ?? row.tableName}
                  </span>
                  <span className="shrink-0 text-xs text-ink-400">{formatIndiaDateTime(row.createdAt)}</span>
                </li>
              ))}
            </ul>
          </SectionState>
        </Card>
      ) : null}

      {visibility.catalog ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard icon={Tag} label="Brands" value={data.catalog.brands} />
          <StatCard icon={Tags} label="Categories" value={data.catalog.categories} />
          <StatCard icon={Warehouse} label="Warehouses" value={data.catalog.warehouses} />
          {visibility.credit ? (
            <StatCard icon={IndianRupee} label="Outstanding" value={`₹${formatCompact(data.credit.totalOutstanding)}`} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
