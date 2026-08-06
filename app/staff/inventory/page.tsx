import Link from 'next/link';
import { Boxes, History } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { StockAdjustmentForm } from '@/components/admin/stock-adjustment-form';

interface StockRow {
  id: string;
  quantity: number;
  reserved_quantity: number;
  products: { name: string; sku_code: string } | null;
  warehouses: { name: string } | null;
}

interface Option {
  id: string;
  name: string;
}

export default async function StaffInventoryPage() {
  const supabase = createClient();

  const [{ data: stockData }, { data: productData }, { data: warehouseData }] = await Promise.all([
    supabase
      .from('inventory_stock')
      .select('id, quantity, reserved_quantity, products ( name, sku_code ), warehouses ( name )')
      .order('updated_at', { ascending: false }),
    supabase.from('products').select('id, name').eq('is_active', true).order('name'),
    supabase.from('warehouses').select('id, name').eq('is_active', true).order('name'),
  ]);

  const stock = (stockData ?? []) as unknown as StockRow[];
  const products = (productData ?? []) as Option[];
  const warehouses = (warehouseData ?? []) as Option[];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink-950">Inventory</h1>
          <p className="mt-1 text-sm text-ink-500">Stock on hand, reserved for confirmed orders, and available to sell.</p>
        </div>
        <Link href="/staff/inventory/ledger" className="flex items-center gap-1 text-sm font-medium text-primary-600 hover:text-primary-700">
          <History className="h-4 w-4" />
          Ledger
        </Link>
      </div>

      <Card>
        <p className="mb-3 text-sm font-semibold text-ink-800">Record a stock adjustment</p>
        <StockAdjustmentForm products={products} warehouses={warehouses} />
      </Card>

      {stock.length === 0 ? (
        <AdminEmptyState
          icon={Boxes}
          title="No inventory recorded yet"
          body="Stock levels will appear here once inward stock, dispatches, or adjustments are recorded."
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-5 py-3 font-medium">Product</th>
                <th className="px-5 py-3 font-medium">Warehouse</th>
                <th className="px-5 py-3 font-medium">On Hand</th>
                <th className="px-5 py-3 font-medium">Reserved</th>
                <th className="px-5 py-3 font-medium">Available</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {stock.map((s) => (
                <tr key={s.id}>
                  <td className="px-5 py-3">
                    <p className="font-medium text-ink-900">{s.products?.name ?? '—'}</p>
                    <p className="font-mono text-xs text-ink-400">{s.products?.sku_code}</p>
                  </td>
                  <td className="px-5 py-3 text-ink-600">{s.warehouses?.name ?? '—'}</td>
                  <td className="px-5 py-3 font-semibold text-ink-900">{s.quantity}</td>
                  <td className="px-5 py-3 text-ink-600">{s.reserved_quantity}</td>
                  <td className="px-5 py-3 font-medium text-ink-900">{s.quantity - s.reserved_quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
