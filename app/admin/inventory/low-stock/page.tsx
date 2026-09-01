import Link from 'next/link';
import { AlertTriangle, TrendingUp } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { InventoryNav } from '@/components/admin/inventory-nav';
import type { ProductTotalsViewRow } from '@/types/inventory.types';

interface FastMover {
  product_id: string;
  qty_sold: number;
  revenue: number;
}

export default async function LowStockPage({
  searchParams,
}: {
  searchParams: { product?: string };
}) {
  const supabase = createClient();
  const highlight = searchParams.product ?? '';

  const [{ data: totalsData }, { data: moversData }] = await Promise.all([
    supabase
      .from('inventory_product_totals')
      .select('*')
      .in('stock_status', ['low_stock', 'out_of_stock'])
      .order('available_quantity', { ascending: true })
      .limit(200),
    // mv_top_products is refreshed nightly (pg_cron) from real orders;
    // empty until delivered orders exist. Not guarded by table RLS, but
    // this page is admin-only via middleware + layout.
    supabase.from('mv_top_products' as never).select('*').order('qty_sold', { ascending: false }).limit(10),
  ]);

  const totals = ((totalsData ?? []) as unknown as ProductTotalsViewRow[]).filter(
    // Never-stocked catalog items are not "out of stock" — they were never in inventory.
    (t) => t.warehouse_count !== null || t.reorder_level > 0
  );
  const outOfStock = totals.filter((t) => t.stock_status === 'out_of_stock');
  const lowStock = totals.filter((t) => t.stock_status === 'low_stock');
  const movers = (moversData ?? []) as unknown as FastMover[];

  const { data: moverNames } = movers.length
    ? await supabase
        .from('products')
        .select('id, name, sku_code')
        .in('id', movers.map((m) => m.product_id))
    : { data: [] };
  const nameById = new Map(((moverNames ?? []) as { id: string; name: string; sku_code: string | null }[]).map((p) => [p.id, p]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Low Stock Alerts</h1>
        <p className="mt-1 text-sm text-ink-500">
          Products at or below their configured reorder level. Set thresholds on the Products tab or a product&apos;s
          detail page — alerts notify admins at most once per cooldown window per product.
        </p>
      </div>

      <InventoryNav />

      <Card className="p-0 overflow-hidden">
        <CardHeader>
          <CardTitle>
            <AlertTriangle className="mr-2 inline h-4 w-4 text-primary-600" />
            Out of stock ({outOfStock.length})
          </CardTitle>
        </CardHeader>
        {outOfStock.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-ink-500">Nothing is out of stock. 🎉</p>
        ) : (
          <ul className="divide-y divide-ink-100">
            {outOfStock.map((t) => (
              <Row key={t.product_id} t={t} highlight={highlight} />
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-0 overflow-hidden">
        <CardHeader>
          <CardTitle>Below reorder level ({lowStock.length})</CardTitle>
        </CardHeader>
        {lowStock.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-ink-500">No products are below their reorder level.</p>
        ) : (
          <ul className="divide-y divide-ink-100">
            {lowStock.map((t) => (
              <Row key={t.product_id} t={t} highlight={highlight} />
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-0 overflow-hidden">
        <CardHeader>
          <CardTitle>
            <TrendingUp className="mr-2 inline h-4 w-4 text-primary-600" />
            Fast movers (last 30 days)
          </CardTitle>
        </CardHeader>
        {movers.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-ink-500">
            Sales velocity appears here once delivered orders exist (computed nightly from real order data).
          </p>
        ) : (
          <ul className="divide-y divide-ink-100">
            {movers.map((m) => {
              const p = nameById.get(m.product_id);
              return (
                <li key={m.product_id} className="flex items-center justify-between px-5 py-2.5 text-sm">
                  <span className="font-medium text-ink-900">
                    {p?.name ?? 'Unknown product'} <span className="font-mono text-xs text-ink-400">{p?.sku_code}</span>
                  </span>
                  <span className="text-ink-600">
                    {m.qty_sold} sold · ₹{Number(m.revenue).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {outOfStock.length + lowStock.length === 0 ? (
        <AdminEmptyState
          icon={AlertTriangle}
          title="All stock levels are healthy"
          body="Configure reorder levels per product to start receiving low-stock alerts."
        />
      ) : null}
    </div>
  );
}

function Row({ t, highlight }: { t: ProductTotalsViewRow; highlight: string }) {
  const isHighlight = highlight === t.product_id;
  return (
    <li className={`flex items-center justify-between px-5 py-2.5 text-sm ${isHighlight ? 'bg-primary-50' : ''}`}>
      <div>
        <Link href={`/admin/products/${t.product_id}`} className="font-medium text-ink-900 hover:text-primary-600">
          {t.product_name}
        </Link>{' '}
        <span className="font-mono text-xs text-ink-400">{t.sku_code}</span>
        {t.reorder_level > 0 ? (
          <span className="ml-2 text-xs text-ink-400">reorder at {t.reorder_level}</span>
        ) : null}
      </div>
      <span className={`font-semibold ${t.available_quantity <= 0 ? 'text-primary-600' : 'text-amber-600'}`}>
        {t.available_quantity} available
      </span>
    </li>
  );
}
