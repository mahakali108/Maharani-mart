import { Warehouse, AlertTriangle, Boxes } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { StockAdjustmentForm } from '@/components/admin/stock-adjustment-form';

/**
 * Business rule constant, not data: any SKU/warehouse combination
 * with on-hand quantity at or below this number is flagged in the
 * Low Stock panel. Not configurable per-product yet — Phase 2B could
 * move this to a per-product `reorder_point` column if needed.
 */
const LOW_STOCK_THRESHOLD = 10;

interface StockRow {
  id: string;
  quantity: number;
  reserved_quantity: number;
  updated_at: string;
  products: { id: string; name: string; sku_code: string } | null;
  warehouses: { id: string; name: string } | null;
}

interface Option {
  id: string;
  name: string;
}

export default async function InventoryPage() {
  const supabase = createClient();

  const [{ data: stockData }, { data: productData }, { data: warehouseData }] = await Promise.all([
    supabase
      .from('inventory_stock')
      .select('id, quantity, reserved_quantity, updated_at, products ( id, name, sku_code ), warehouses ( id, name )')
      .order('updated_at', { ascending: false }),
    supabase.from('products').select('id, name').eq('is_active', true).order('name'),
    supabase.from('warehouses').select('id, name').eq('is_active', true).order('name'),
  ]);

  const stock = (stockData ?? []) as unknown as StockRow[];
  const products = (productData ?? []) as Option[];
  const warehouses = (warehouseData ?? []) as Option[];

  const totalUnits = stock.reduce((sum, s) => sum + s.quantity, 0);
  const lowStockRows = stock.filter((s) => s.quantity <= LOW_STOCK_THRESHOLD);
  const warehouseCount = new Set(stock.map((s) => s.warehouses?.id).filter(Boolean)).size;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Inventory</h1>
        <p className="mt-1 text-sm text-ink-500">
          Live stock across all warehouses. Quantities are always derived from stock movements — never edited directly.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard icon={Boxes} label="Total Units in Stock" value={totalUnits} />
        <StatCard icon={Warehouse} label="Warehouses with Stock" value={warehouseCount} />
        <StatCard icon={AlertTriangle} label="Low Stock Alerts" value={lowStockRows.length} accent={lowStockRows.length > 0} />
      </div>

      {lowStockRows.length > 0 ? (
        <Card className="border-primary-100 bg-primary-50/40">
          <CardHeader>
            <CardTitle>Low stock — at or below {LOW_STOCK_THRESHOLD} units</CardTitle>
          </CardHeader>
          <ul className="divide-y divide-primary-100">
            {lowStockRows.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-2 text-sm">
                <span className="font-medium text-ink-900">
                  {s.products?.name ?? 'Unknown product'}{' '}
                  <span className="font-mono text-xs text-ink-400">{s.products?.sku_code}</span>
                </span>
                <span className="text-ink-600">
                  {s.warehouses?.name ?? '—'} · <span className="font-semibold text-primary-600">{s.quantity} units</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Record a stock adjustment</CardTitle>
        </CardHeader>
        <StockAdjustmentForm products={products} warehouses={warehouses} />
      </Card>

      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-800">Warehouse-wise stock</h2>
          <a href="/admin/inventory/ledger" className="text-xs font-medium text-primary-600 hover:text-primary-700">
            View stock movement ledger →
          </a>
        </div>
        {stock.length === 0 ? (
          <AdminEmptyState
            icon={Boxes}
            title="No inventory recorded yet"
            body="Stock levels will appear here once inward stock, dispatches, or adjustments are recorded against a warehouse."
          />
        ) : (
          <Card className="mt-3 overflow-hidden p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Product</th>
                  <th className="px-5 py-3 font-medium">SKU</th>
                  <th className="px-5 py-3 font-medium">Warehouse</th>
                  <th className="px-5 py-3 font-medium">On Hand</th>
                  <th className="px-5 py-3 font-medium">Reserved</th>
                  <th className="px-5 py-3 font-medium">Available</th>
                  <th className="px-5 py-3 font-medium">Last Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {stock.map((s) => (
                  <tr key={s.id}>
                    <td className="px-5 py-3 font-medium text-ink-900">{s.products?.name ?? '—'}</td>
                    <td className="px-5 py-3 font-mono text-xs text-ink-500">{s.products?.sku_code ?? '—'}</td>
                    <td className="px-5 py-3 text-ink-600">{s.warehouses?.name ?? '—'}</td>
                    <td className={`px-5 py-3 font-semibold ${s.quantity <= LOW_STOCK_THRESHOLD ? 'text-primary-600' : 'text-ink-900'}`}>
                      {s.quantity}
                    </td>
                    <td className="px-5 py-3 text-ink-600">{s.reserved_quantity}</td>
                    <td className="px-5 py-3 font-medium text-ink-900">{s.quantity - s.reserved_quantity}</td>
                    <td className="px-5 py-3 text-ink-500">{new Date(s.updated_at).toLocaleString('en-IN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <Card>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-ink-500">{label}</p>
          <p className={`mt-1 text-2xl font-semibold ${accent ? 'text-primary-600' : 'text-ink-950'}`}>{value}</p>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50">
          <Icon className="h-5 w-5 text-primary-600" />
        </div>
      </div>
    </Card>
  );
}
