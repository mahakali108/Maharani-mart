import { BarChart3 } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface OrderRow {
  id: string;
  grand_total: number;
  retailer_id: string;
  collected_by: string | null;
  retailers: { shop_name: string; areas: { name: string } | null } | null;
  profiles: { full_name: string } | null;
}

interface OrderItemRow {
  order_id: string;
  quantity: number;
  line_total: number;
  products: { name: string } | null;
}

function firstOfMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string };
}) {
  const supabase = createClient();
  const from = searchParams.from || firstOfMonth();
  const to = searchParams.to || new Date().toISOString().slice(0, 10);

  const { data: orderData } = await supabase
    .from('orders')
    .select('id, grand_total, retailer_id, collected_by, retailers ( shop_name, areas ( name ) ), profiles ( full_name )')
    .neq('status', 'cancelled')
    .gte('placed_at', `${from}T00:00:00`)
    .lte('placed_at', `${to}T23:59:59`);

  const orders = (orderData ?? []) as unknown as OrderRow[];
  const orderIds = orders.map((o) => o.id);

  const { data: itemData } =
    orderIds.length > 0
      ? await supabase.from('order_items').select('order_id, quantity, line_total, products ( name )').in('order_id', orderIds)
      : { data: [] };

  const items = (itemData ?? []) as unknown as OrderItemRow[];

  const totalSales = orders.reduce((sum, o) => sum + o.grand_total, 0);
  const totalOrders = orders.length;
  const aov = totalOrders > 0 ? totalSales / totalOrders : 0;

  const byRetailer = aggregate(orders, (o) => o.retailers?.shop_name ?? 'Unknown', (o) => o.grand_total);
  const byArea = aggregate(orders, (o) => o.retailers?.areas?.name ?? 'Unassigned', (o) => o.grand_total);
  const bySalesman = aggregate(
    orders.filter((o) => o.profiles),
    (o) => o.profiles!.full_name,
    (o) => o.grand_total
  );
  const byProduct = aggregate(items, (i) => i.products?.name ?? 'Unknown', (i) => i.line_total);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Reports</h1>
        <p className="mt-1 text-sm text-ink-500">Real-time sales figures from actual orders — nothing here is estimated.</p>
      </div>

      <Card>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-ink-800">From</label>
            <input
              name="from"
              type="date"
              defaultValue={from}
              className="h-10 rounded-xl border border-ink-200 bg-white px-3 text-sm text-ink-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary-600"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-ink-800">To</label>
            <input
              name="to"
              type="date"
              defaultValue={to}
              max={new Date().toISOString().slice(0, 10)}
              className="h-10 rounded-xl border border-ink-200 bg-white px-3 text-sm text-ink-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary-600"
            />
          </div>
          <Button type="submit" size="sm" variant="secondary">
            Apply
          </Button>
        </form>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Total Sales" value={`₹${totalSales.toFixed(2)}`} />
        <StatCard label="Total Orders" value={totalOrders} />
        <StatCard label="Avg. Order Value" value={`₹${aov.toFixed(2)}`} />
      </div>

      {totalOrders === 0 ? (
        <Card className="flex flex-col items-center gap-2 py-12 text-center">
          <BarChart3 className="h-8 w-8 text-ink-300" />
          <p className="font-medium text-ink-700">No orders in this date range</p>
          <p className="text-sm text-ink-400">Reports will populate as real orders come in.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ReportTable title="Retailer-wise Sales" rows={byRetailer} />
          <ReportTable title="Area-wise Sales" rows={byArea} />
          <ReportTable title="Product-wise Sales" rows={byProduct} />
          <ReportTable title="Salesman Performance" rows={bySalesman} />
        </div>
      )}
    </div>
  );
}

function aggregate<T>(rows: T[], keyFn: (row: T) => string, valueFn: (row: T) => number) {
  const map = new Map<string, { label: string; total: number; count: number }>();
  for (const row of rows) {
    const key = keyFn(row);
    const existing = map.get(key) ?? { label: key, total: 0, count: 0 };
    existing.total += valueFn(row);
    existing.count += 1;
    map.set(key, existing);
  }
  return [...map.values()].sort((a, b) => b.total - a.total).slice(0, 10);
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <p className="text-sm text-ink-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-ink-950">{value}</p>
    </Card>
  );
}

function ReportTable({ title, rows }: { title: string; rows: { label: string; total: number; count: number }[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-500">No data for this range.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.label} className="flex justify-between text-sm">
              <span className="text-ink-700">
                {r.label} <span className="text-xs text-ink-400">({r.count})</span>
              </span>
              <span className="font-medium text-ink-900">₹{r.total.toFixed(2)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
              }
    
