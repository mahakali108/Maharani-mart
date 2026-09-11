import Link from 'next/link';
import {
  ArrowDownToLine,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FileText,
  Percent,
  ReceiptText,
  Scale,
  TrendingUp,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { formatInr } from '@/lib/retailer/format';
import {
  loadInsightWindows,
  loadMostPurchased,
  loadSpendTrend,
} from '@/lib/retailer/reports';
import { getRetailerWalletSummary, formatPaise } from '@/lib/retailer/wallet';

export const metadata = { title: 'Purchase reports — Maharani Traders' };

function StatCard({
  icon: Icon,
  label,
  value,
  tone = 'bg-slate-50 text-slate-700',
}: {
  icon: typeof ClipboardList;
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm">
      <span className={`flex h-8 w-8 items-center justify-center rounded-xl ${tone}`}>
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <p className="mt-2.5 truncate text-lg font-bold tracking-tight text-slate-950">{value}</p>
      <p className="mt-0.5 text-[10px] font-semibold text-slate-500">{label}</p>
    </div>
  );
}

export default async function ReportsPage() {
  const user = await requireUser();
  const supabase = createClient();

  const [windows, trend, mostPurchased, walletSummary] = await Promise.all([
    loadInsightWindows(supabase, user.id),
    loadSpendTrend(supabase, user.id),
    loadMostPurchased(supabase, user.id),
    getRetailerWalletSummary(supabase, user.id),
  ]);

  const maxTrend = Math.max(...trend.map((row) => row.purchaseValue), 1);
  const hasAnyData = windows.month.totals.orderCount > 0 || windows.week.totals.orderCount > 0 || trend.some((row) => row.orderCount > 0);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-[10px] font-semibold text-slate-500 sm:text-xs">
        <Link href="/retailer/account" className="flex items-center gap-1 rounded px-1 py-0.5 hover:text-primary-600">
          <ChevronLeft className="h-3.5 w-3.5" /> Account
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="truncate text-slate-800">Reports</span>
      </nav>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-600">Business insights</p>
          <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-950 sm:text-2xl">Purchase reports</h1>
          <p className="mt-1 text-xs text-slate-500">Your purchases, GST and savings — computed from your own orders.</p>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <Link
            href="/retailer/reports/statement?type=orders"
            prefetch={false}
            className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 text-xs font-bold text-white transition hover:bg-primary-700 sm:flex-none"
          >
            <ArrowDownToLine className="h-4 w-4" aria-hidden="true" /> Purchase statement
          </Link>
          <Link
            href="/retailer/reports/statement?type=ledger"
            prefetch={false}
            className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-xs font-bold text-slate-700 transition hover:bg-slate-50 sm:flex-none"
          >
            <FileText className="h-4 w-4" aria-hidden="true" /> Payment ledger
          </Link>
        </div>
      </div>

      {!hasAnyData ? (
        <section className="flex min-h-[220px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-10 text-center">
          <BarChart3 className="h-8 w-8 text-slate-300" aria-hidden="true" />
          <h2 className="mt-3 text-sm font-bold text-slate-800">No purchase data yet</h2>
          <p className="mt-1 max-w-xs text-[11px] leading-4 text-slate-500">
            Reports appear here after your first order. Place an order and this page fills in automatically.
          </p>
          <Link href="/retailer/catalog" className="mt-4 text-xs font-bold text-primary-600">
            Start shopping
          </Link>
        </section>
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-sm font-bold text-slate-900">This week</h2>
            <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
              <StatCard icon={ClipboardList} label="Orders placed" value={String(windows.week.totals.orderCount)} tone="bg-blue-50 text-blue-700" />
              <StatCard icon={ReceiptText} label="Purchase value" value={formatInr(windows.week.totals.purchaseValue)} />
              <StatCard icon={Percent} label="GST paid" value={formatInr(windows.week.totals.gstTotal)} tone="bg-violet-50 text-violet-700" />
              <StatCard icon={Scale} label="Saved via discounts" value={formatInr(windows.week.totals.discountTotal)} tone="bg-emerald-50 text-emerald-700" />
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-bold text-slate-900">This month</h2>
            <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
              <StatCard icon={ClipboardList} label="Orders placed" value={String(windows.month.totals.orderCount)} tone="bg-blue-50 text-blue-700" />
              <StatCard icon={ReceiptText} label="Purchase value" value={formatInr(windows.month.totals.purchaseValue)} />
              <StatCard icon={Percent} label="GST paid" value={formatInr(windows.month.totals.gstTotal)} tone="bg-violet-50 text-violet-700" />
              <StatCard icon={Scale} label="Saved via discounts" value={formatInr(windows.month.totals.discountTotal)} tone="bg-emerald-50 text-emerald-700" />
            </div>
            {windows.month.topProducts.length > 0 ? (
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 bg-slate-50 px-4 py-3">
                  <h3 className="text-xs font-bold text-slate-900">Top products this month</h3>
                </div>
                <ul className="divide-y divide-slate-100">
                  {windows.month.topProducts.map((product, index) => (
                    <li key={product.productId} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-[10px] font-black text-primary-700">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11px] font-bold text-slate-900">{product.name}</span>
                        <span className="block truncate text-[10px] text-slate-500">
                          {product.brandName ? `${product.brandName} · ` : ''}{product.totalPieces} pcs
                        </span>
                      </span>
                      <span className="shrink-0 text-[11px] font-bold text-slate-900">{formatInr(product.totalValue)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          <section className="space-y-3">
            <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
              <TrendingUp className="h-4 w-4 text-primary-600" aria-hidden="true" /> Spending trend (6 months)
            </h2>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="space-y-2.5">
                {trend.map((row) => (
                  <div key={row.monthKey} className="flex items-center gap-3">
                    <span className="w-16 shrink-0 text-[10px] font-bold text-slate-500">{row.label}</span>
                    <span className="h-5 min-w-0 flex-1 overflow-hidden rounded-lg bg-slate-100">
                      <span
                        className="block h-full rounded-lg bg-primary-500/90"
                        style={{ width: `${Math.max(2, Math.round((row.purchaseValue / maxTrend) * 100))}%` }}
                      />
                    </span>
                    <span className="w-20 shrink-0 text-right text-[10px] font-bold text-slate-900">
                      {row.purchaseValue > 0 ? formatInr(row.purchaseValue) : '—'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-bold text-slate-900">Most purchased products</h2>
            {mostPurchased.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-5 text-center text-[11px] text-slate-500">
                Your most-ordered products will appear here once you have a few orders.
              </p>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <ul className="divide-y divide-slate-100">
                  {mostPurchased.map((product, index) => (
                    <li key={product.productId} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-[10px] font-black text-primary-700">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11px] font-bold text-slate-900">{product.name}</span>
                        <span className="block truncate text-[10px] text-slate-500">
                          {product.brandName ? `${product.brandName} · ` : ''}{product.totalPieces} pcs · {product.orderCount} order{product.orderCount === 1 ? '' : 's'}
                        </span>
                      </span>
                      <span className="shrink-0 text-[11px] font-bold text-slate-900">{formatInr(product.totalValue)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <StatCard icon={ReceiptText} label="All-time orders" value={String(trend.reduce((sum, row) => sum + row.orderCount, 0))} tone="bg-blue-50 text-blue-700" />
            <StatCard icon={Scale} label="Credit used (outstanding)" value={formatPaise(walletSummary.outstandingPaise)} tone="bg-amber-50 text-amber-700" />
            <StatCard icon={Percent} label="Available credit" value={walletSummary.availablePaise !== null ? formatPaise(walletSummary.availablePaise) : '—'} tone="bg-emerald-50 text-emerald-700" />
          </section>
        </>
      )}
    </div>
  );
}
