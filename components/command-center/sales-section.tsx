import type { ReactNode } from 'react';
import { BarChart3, Filter, IndianRupee, ShoppingCart, TrendingUp, type LucideIcon } from 'lucide-react';
import type { SalesIntel, SalesIntelFilters } from '@/lib/admin/command-center/types';
import { Card } from '@/components/ui/card';
import { BarChart, TopBars, TrendChart } from './charts';
import { GrowthText, inr, Section, SectionEmptyState } from './shared';

export interface SalesOptions {
  brands: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  products: { id: string; name: string; sku: string }[];
  retailers: { id: string; shopName: string }[];
  salesmen: { id: string; name: string }[];
}

/**
 * Sales Intelligence — server-rendered, filter via GET searchParams.
 * All numbers come from authorized server-side queries (orders +
 * order_items). When a product/brand/category filter is active the revenue
 * basis is line_total (item level); otherwise it is the order grand_total —
 * the same basis the existing Reports page uses.
 */
export function SalesSection({
  intel,
  filters,
  options,
}: {
  intel: SalesIntel;
  filters: SalesIntelFilters;
  options: SalesOptions;
}) {
  return (
    <Section
      title="Sales intelligence"
      subtitle={`Window ${intel.from} → ${intel.to} · basis: ${intel.filteredBasis === 'item' ? 'order line totals (product filter active)' : 'order totals'} · non-cancelled orders`}
      icon={BarChart3}
      status={intel.status}
    >
      {/* Filters */}
      <Card className="p-4">
        <form method="get" action="/admin/command-center" className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
          <input type="hidden" name="tab" value="sales" />
          <Field label="From">
            <input type="date" name="from" defaultValue={filters.from} max={filters.to} className="field-input" />
          </Field>
          <Field label="To">
            <input type="date" name="to" defaultValue={filters.to} max={new Date().toISOString().slice(0, 10)} className="field-input" />
          </Field>
          <Field label="Category">
            <select name="category" defaultValue={filters.categoryId ?? ''} className="field-input">
              <option value="">All categories</option>
              {options.categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Brand">
            <select name="brand" defaultValue={filters.brandId ?? ''} className="field-input">
              <option value="">All brands</option>
              {options.brands.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Product">
            <select name="product" defaultValue={filters.productId ?? ''} className="field-input">
              <option value="">All products</option>
              {options.products.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
              ))}
            </select>
          </Field>
          <Field label="Retailer">
            <select name="retailer" defaultValue={filters.retailerId ?? ''} className="field-input">
              <option value="">All retailers</option>
              {options.retailers.map((r) => (
                <option key={r.id} value={r.id}>{r.shopName}</option>
              ))}
            </select>
          </Field>
          <Field label="Salesman">
            <select name="salesman" defaultValue={filters.salesmanId ?? ''} className="field-input">
              <option value="">All salesmen</option>
              {options.salesmen.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </Field>
          <div className="col-span-2 flex items-end gap-2 sm:col-span-4 xl:col-span-7">
            <button type="submit" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink-950 px-3.5 text-xs font-bold text-white transition hover:bg-ink-800">
              <Filter className="h-3.5 w-3.5" /> Apply filters
            </button>
            <a href="/admin/command-center?tab=sales" className="inline-flex h-9 items-center rounded-lg border border-ink-200 bg-white px-3.5 text-xs font-semibold text-ink-600 hover:text-ink-900">
              Reset
            </a>
          </div>
        </form>
      </Card>

      {intel.status === 'empty' ? (
        <SectionEmptyState
          title="No sales in this window"
          body="No non-cancelled orders match this window and filter set. Widen the dates or clear a filter — numbers appear automatically once real orders exist."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricCard icon={IndianRupee} label="Total sales" value={inr(intel.totalSales)} />
            <MetricCard icon={ShoppingCart} label="Orders" value={String(intel.totalOrders)} />
            <MetricCard icon={BarChart3} label="Average order" value={intel.aov === null ? '—' : inr(intel.aov)} />
            <Card className="p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">Growth vs previous window</p>
              <div className="mt-1.5 flex items-baseline gap-2">
                <GrowthText value={intel.growthPct} />
                {intel.previousPeriodSales !== null ? <span className="text-[10px] text-ink-400">prev {inr(intel.previousPeriodSales)}</span> : null}
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Card className="p-4">
              <p className="mb-2 text-xs font-semibold text-ink-700">Daily sales (last 30 days of window)</p>
              <TrendChart points={intel.daily} />
            </Card>
            <Card className="p-4">
              <p className="mb-2 text-xs font-semibold text-ink-700">Weekly totals</p>
              {intel.weekly.length === 0 ? (
                <p className="py-10 text-center text-xs text-ink-400">No weekly data.</p>
              ) : (
                <BarChart bars={intel.weekly.map((w) => ({ label: w.label, value: w.sales }))} />
              )}
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <DimensionCard title="Top products" rows={intel.topProducts} />
            <DimensionCard title="Top retailers" rows={intel.topRetailers} />
            <DimensionCard title="Top categories" rows={intel.topCategories} />
            <DimensionCard title="Top brands" rows={intel.topBrands} />
            <DimensionCard title="Top salesmen" rows={intel.topSalesmen} />
            <Card className="flex items-center justify-center border-dashed p-6 text-xs text-ink-400">
              <TrendingUp className="mr-2 h-4 w-4" />
              Full order-level detail remains on the Reports page — this view is the executive lens over the same data.
            </Card>
          </div>
        </>
      )}
    </Section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-ink-400">{label}</span>
      {children}
    </label>
  );
}

function MetricCard({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-400">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <p className="mt-1.5 truncate text-base font-bold text-ink-950" title={value}>{value}</p>
    </Card>
  );
}

function DimensionCard({ title, rows }: { title: string; rows: { id: string; name: string; value: number; secondary?: string }[] }) {
  return (
    <Card className="p-4">
      <p className="mb-3 text-xs font-semibold text-ink-700">{title}</p>
      {rows.length === 0 ? (
        <p className="py-4 text-center text-xs text-ink-400">No data in this window.</p>
      ) : (
        <TopBars rows={rows.map((r) => ({ name: r.name, value: r.value, secondary: r.secondary }))} formatValue={(v) => inr(v)} />
      )}
    </Card>
  );
}
