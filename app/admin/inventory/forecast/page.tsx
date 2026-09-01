import Link from 'next/link';
import { TrendingUp, ArrowDownRight, ArrowUpRight, Boxes, CalendarClock, PackagePlus, ShoppingBag, ShieldAlert } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { runForecastPipeline } from '@/lib/ai/forecast/index';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { InventoryNav } from '@/components/admin/inventory-nav';
import type { ForecastResult } from '@/lib/ai/forecast/types';

const HORIZONS = [14, 30, 60, 90] as const;

function riskBadge(risk: string): { label: string; cls: string } {
  switch (risk) {
    case 'critical': return { label: 'Critical', cls: 'bg-red-600 text-white' };
    case 'high': return { label: 'High', cls: 'bg-red-100 text-red-700' };
    case 'medium': return { label: 'Medium', cls: 'bg-amber-100 text-amber-700' };
    case 'low': return { label: 'Low', cls: 'bg-blue-100 text-blue-700' };
    default: return { label: 'None', cls: 'bg-emerald-100 text-emerald-700' };
  }
}

function confidenceBadge(confidence: string): { label: string; cls: string } {
  switch (confidence) {
    case 'High': return { label: 'High', cls: 'bg-emerald-100 text-emerald-700' };
    case 'Medium': return { label: 'Medium', cls: 'bg-amber-100 text-amber-700' };
    case 'Low': return { label: 'Low', cls: 'bg-orange-100 text-orange-700' };
    default: return { label: 'Insufficient', cls: 'bg-slate-100 text-slate-600' };
  }
}

function directionIcon(direction: string) {
  if (direction === 'rising') return <ArrowUpRight className="inline h-3.5 w-3.5 text-green-600" />;
  if (direction === 'falling') return <ArrowDownRight className="inline h-3.5 w-3.5 text-red-600" />;
  return <TrendingUp className="inline h-3.5 w-3.5 text-slate-500" />;
}

export default async function ForecastDashboardPage({
  searchParams,
}: {
  searchParams: { days?: string; risk?: string };
}) {
  await requirePermission('reports.view.all');
  const days = Math.min(365, Math.max(14, Number(searchParams.days ?? 30) || 30));
  const riskFilter = searchParams.risk ?? '';

  const supabase = createClient();
  const { summary } = await runForecastPipeline(supabase, { days, limit: 200 });

  let forecasts = summary.forecasts;
  if (riskFilter === 'stockout') forecasts = forecasts.filter((f) => f.stockOutRisk === 'critical' || f.stockOutRisk === 'high');
  if (riskFilter === 'reorder') forecasts = forecasts.filter((f) => (f.reorderQuantity ?? 0) > 0);
  if (riskFilter === 'overstock') forecasts = forecasts.filter((f) => f.overstockWarning);
  if (riskFilter === 'dead') forecasts = forecasts.filter((f) => f.deadStockWarning);

  // Expiry overview from the authorized FEFO view (not part of the forecast engine).
  const { data: expiryData } = await supabase
    .from('inventory_expiry_report')
    .select('product_name, available_quantity, days_remaining, expiry_status')
    .in('expiry_status', ['expired', 'critical'])
    .order('days_remaining', { ascending: true })
    .limit(10);
  const expiryRisk = (expiryData ?? []) as { product_name: string; available_quantity: number; days_remaining: number | null; expiry_status: string }[];

  const needsReorder = summary.forecasts.filter((f) => (f.reorderQuantity ?? 0) > 0);
  const stockoutRisk = summary.forecasts.filter((f) => f.stockOutRisk === 'critical' || f.stockOutRisk === 'high');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Demand Forecast</h1>
        <p className="mt-1 text-sm text-ink-500">
          Explainable demand forecasts from real order history and current authorized stock. Estimates are labelled —
          this never fabricates predictive data or changes stock.
        </p>
      </div>

      <InventoryNav />

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-ink-600">Forecast horizon:</span>
          {HORIZONS.map((h) => (
            <a
              key={h}
              href={`/admin/inventory/forecast?days=${h}`}
              className={h === days
                ? 'rounded-full bg-blue-700 px-3 py-1.5 text-xs font-bold text-white'
                : 'rounded-full border border-blue-100 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-100'}
            >
              {h} days
            </a>
          ))}
        </div>
        <p className="mt-2 text-xs text-ink-400">
          Analysed {summary.productsForecast} product(s) over {summary.windowDays} day(s) of real, non-cancelled order data. Average confidence{' '}
          <span className="font-semibold text-ink-700">{Math.round(summary.averageConfidence * 100)}%</span>.
        </p>
      </Card>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={ShoppingBag} label="Forecasted" value={String(summary.productsForecast)} sub={`${summary.productsWithInsufficientData} insufficient data`} href="/admin/inventory/forecast" />
        <StatCard icon={ShieldAlert} label="Stock-out risk" value={String(summary.productsWithStockoutRisk)} sub="critical ⚠ / high" accent={summary.productsWithStockoutRisk > 0} href="/admin/inventory/forecast?risk=stockout" />
        <StatCard icon={PackagePlus} label="Need reorder" value={String(summary.productsNeedingReorder)} sub="recommended qty" accent={summary.productsNeedingReorder > 0} href="/admin/inventory/forecast?risk=reorder" />
        <StatCard icon={Boxes} label="Overstock / dead" value={String(summary.productsOverstocked + summary.productsDeadStock)} sub={`${summary.productsOverstocked} overstock · ${summary.productsDeadStock} dead`} accent={summary.productsOverstocked + summary.productsDeadStock > 0} href="/admin/inventory/forecast?risk=overstock" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="border-l-4 border-l-red-500">
          <CardHeader><CardTitle>⚠️ Stock-out risk ({stockoutRisk.length})</CardTitle></CardHeader>
          {stockoutRisk.length === 0 ? (
            <p className="text-sm text-ink-500">No product is projected to run out within the forecast horizon.</p>
          ) : (
            <ul className="space-y-2">
              {stockoutRisk.slice(0, 5).map((f) => <RiskRow key={f.productId} f={f} />)}
            </ul>
          )}
        </Card>

        <Card className="border-l-4 border-l-amber-500">
          <CardHeader><CardTitle>📦 Recommended reorder ({needsReorder.length})</CardTitle></CardHeader>
          {needsReorder.length === 0 ? (
            <p className="text-sm text-ink-500">No demand-based reorder is recommended right now. Configured stock thresholds remain the source of truth for immediate action.</p>
          ) : (
            <ul className="space-y-2">
              {needsReorder.slice(0, 5).map((f) => (
                <li key={f.productId} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink-900">{f.productName}</p>
                    <p className="text-xs text-ink-400">{[f.skuCode, f.explanation].filter(Boolean).join(' · ')}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-bold text-blue-700">+{f.reorderQuantity}</p>
                    <p className="text-[10px] text-ink-400">stock {f.availableStock}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="border-l-4 border-l-purple-500">
          <CardHeader><CardTitle>🧟 Overstock & dead stock</CardTitle></CardHeader>
          {summary.productsOverstocked + summary.productsDeadStock === 0 ? (
            <p className="text-sm text-ink-500">No overstock or dead-stock signal detected.</p>
          ) : (
            <ul className="space-y-2">
              {summary.forecasts.filter((f) => f.overstockWarning || f.deadStockWarning).slice(0, 5).map((f) => (
                <li key={f.productId} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink-900">{f.productName}</p>
                    <p className="text-xs text-ink-400">{f.overstockWarning ? 'Overstock' : 'Dead stock'}</p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold text-purple-600">stock {f.availableStock}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="border-l-4 border-l-orange-500">
        <CardHeader><CardTitle>⚠️ Expiry risk (event)</CardTitle></CardHeader>
        {expiryRisk.length === 0 ? (
          <p className="text-sm text-ink-500">No batches are expired or expiring soon (within the configured critical window).</p>
        ) : (
          <ul className="divide-y divide-ink-100">
            {expiryRisk.map((row, index) => (
              <li key={index} className="flex items-center justify-between py-2 text-sm">
                <span className="font-medium text-ink-900">{row.product_name}</span>
                <span className="text-ink-600">
                  {row.days_remaining === null ? 'No expiry' : row.days_remaining < 0 ? `${-row.days_remaining}d overdue` : `${row.days_remaining}d left`}
                  {' · '}{row.available_quantity} units
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {forecasts.length === 0 ? (
        <AdminEmptyState
          icon={CalendarClock}
          title="No forecast data for this view"
          body="Authorized products with order history and stock appear here. Add products, stock and orders to unlock demand forecasting."
        />
      ) : (
        <Card className="p-0 overflow-x-auto">
          <CardHeader>
            <CardTitle>Product forecast ({forecasts.length})</CardTitle>
          </CardHeader>
          <table className="w-full min-w-[980px] text-sm">
            <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-5 py-3 font-medium">Product</th>
                <th className="px-5 py-3 text-right font-medium">Stock</th>
                <th className="px-5 py-3 text-right font-medium">7-day</th>
                <th className="px-5 py-3 text-right font-medium">30-day</th>
                <th className="px-5 py-3 font-medium">Trend</th>
                <th className="px-5 py-3 text-right font-medium">Stock-out</th>
                <th className="px-5 py-3 text-right font-medium">Reorder</th>
                <th className="px-5 py-3 font-medium">Confidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {forecasts.map((f) => <ForecastRow key={f.productId} f={f} days={days} />)}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub, accent, href }: { icon: React.ElementType; label: string; value: string; sub?: string; accent?: boolean; href?: string }) {
  const inner = (
    <Card className="h-full">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-sm text-ink-500">{label}</p>
          <p className={`mt-1 text-2xl font-semibold ${accent ? 'text-primary-600' : 'text-ink-950'}`}>{value}</p>
          {sub ? <p className="mt-0.5 text-xs text-ink-400">{sub}</p> : null}
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50">
          <Icon className="h-5 w-5 text-blue-700" />
        </div>
      </div>
    </Card>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function RiskRow({ f }: { f: ForecastResult }) {
  const badge = riskBadge(f.stockOutRisk);
  return (
    <li className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-ink-900">{f.productName}</p>
        <p className="truncate text-xs text-ink-400">{f.skuCode ? `${f.skuCode} · ` : ''}cover ≈ {f.stockOutDays ?? '—'} d</p>
      </div>
      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${badge.cls}`}>{badge.label}</span>
    </li>
  );
}

function ForecastRow({ f, days }: { f: ForecastResult; days: number }) {
  const risk = riskBadge(f.stockOutRisk);
  const conf = confidenceBadge(f.confidenceLabel);
  return (
    <tr className="align-top">
      <td className="px-5 py-3">
        <Link href={`/admin/products/${f.productId}`} className="font-medium text-ink-900 hover:text-primary-600">{f.productName}</Link>
        {f.skuCode ? <p className="text-xs text-ink-400">{f.skuCode}</p> : null}
        <p className="mt-1 max-w-xs text-[11px] leading-4 text-ink-400">{f.explanation}</p>
        <p className="text-[10px] text-ink-300">{f.dataBasis}</p>
      </td>
      <td className="px-5 py-3 text-right font-medium text-ink-900">{f.availableStock ?? '—'}</td>
      <td className="px-5 py-3 text-right text-ink-700">{f.demand7Day}<span className="block text-[10px] text-ink-400">{f.dataQuality === 'real' ? 'verified' : 'estimate'}</span></td>
      <td className="px-5 py-3 text-right text-ink-700">{f.demand30Day}<span className="block text-[10px] text-ink-400">{days > 30 ? `${days}d horizon` : '30d'}</span></td>
      <td className="px-5 py-3 text-ink-700">{directionIcon(f.demandDirection)} {f.demandDirection}<span className="block text-[10px] text-ink-400">{f.trendChangePercent}%</span></td>
      <td className="px-5 py-3 text-right">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${risk.cls}`}>{risk.label}</span>
        {f.stockOutDays !== null ? <span className="block text-[10px] text-ink-400">{f.stockOutDays}d</span> : null}
      </td>
      <td className="px-5 py-3 text-right">
        <span className="font-semibold text-blue-700">{f.reorderQuantity ?? '—'}</span>
        {f.reorderQuantity !== null ? <span className="block text-[10px] text-ink-400">window {f.reorderWindowDays}d</span> : null}
      </td>
      <td className="px-5 py-3">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${conf.cls}`}>{conf.label}</span>
        <span className="block text-[10px] text-ink-400">{Math.round(f.confidence * 100)}%</span>
      </td>
    </tr>
  );
}
