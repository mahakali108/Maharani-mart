import Link from 'next/link';
import { Boxes } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { InventoryNav } from '@/components/admin/inventory-nav';
import { ProductThresholdsForm } from '@/components/admin/product-thresholds-form';
import type { ProductTotalsViewRow } from '@/types/inventory.types';

const PAGE_SIZE = 25;

const STATUS_STYLES: Record<string, string> = {
  healthy: 'bg-green-50 text-green-700',
  low_stock: 'bg-amber-50 text-amber-700',
  out_of_stock: 'bg-primary-50 text-primary-700',
};

const STATUS_LABELS: Record<string, string> = {
  healthy: 'Healthy',
  low_stock: 'Low stock',
  out_of_stock: 'Out of stock',
};

export default async function InventoryProductsPage({
  searchParams,
}: {
  searchParams: { q?: string; status?: string; page?: string };
}) {
  const supabase = createClient();
  const page = Math.max(1, Number(searchParams.page) || 1);
  const q = (searchParams.q ?? '').trim();
  const status = searchParams.status ?? '';

  let query = supabase.from('inventory_product_totals').select('*', { count: 'exact' });
  if (q) query = query.or(`product_name.ilike.%${q}%,sku_code.ilike.%${q}%`);
  if (status) query = query.eq('stock_status', status);

  // The view covers every product; hide never-stocked items unless the
  // caller explicitly asks for out-of-stock (where zero rows matter).
  if (status !== 'out_of_stock') query = query.gt('quantity_on_hand', 0);

  const from = (page - 1) * PAGE_SIZE;
  const { data, count } = await query.order('product_name').range(from, from + PAGE_SIZE - 1);

  const rows = (data ?? []) as unknown as ProductTotalsViewRow[];
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Product Stock</h1>
        <p className="mt-1 text-sm text-ink-500">
          On-hand, reserved and available quantities per product across all warehouses, with reorder thresholds.
        </p>
      </div>

      <InventoryNav />

      <Card>
        <form method="get" className="flex flex-wrap gap-2">
          <Input name="q" defaultValue={q} placeholder="Search name or SKU…" className="max-w-xs" />
          <Select name="status" defaultValue={status} className="max-w-[180px]">
            <option value="">All statuses</option>
            <option value="healthy">Healthy</option>
            <option value="low_stock">Low stock</option>
            <option value="out_of_stock">Out of stock</option>
          </Select>
          <Button type="submit" size="sm" variant="outline">
            Filter
          </Button>
        </form>
      </Card>

      {rows.length === 0 ? (
        <AdminEmptyState
          icon={Boxes}
          title="No matching products"
          body="Products appear here once they have stock recorded — confirm a GRN to receive inventory."
        />
      ) : (
        <>
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Product</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 text-right font-medium">On Hand</th>
                  <th className="px-5 py-3 text-right font-medium">Reserved</th>
                  <th className="px-5 py-3 text-right font-medium">Available</th>
                  <th className="px-5 py-3 text-right font-medium">Est. Value</th>
                  <th className="px-5 py-3 font-medium">Reorder thresholds (min / reorder / max)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {rows.map((r) => (
                  <tr key={r.product_id}>
                    <td className="px-5 py-3">
                      <Link href={`/admin/products/${r.product_id}`} className="font-medium text-ink-900 hover:text-primary-600">
                        {r.product_name}
                      </Link>
                      <p className="font-mono text-xs text-ink-400">{r.sku_code}</p>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[r.stock_status]}`}>
                        {STATUS_LABELS[r.stock_status]}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right font-medium text-ink-900">{r.quantity_on_hand}</td>
                    <td className="px-5 py-3 text-right text-ink-600">{r.reserved_quantity}</td>
                    <td className="px-5 py-3 text-right font-semibold text-ink-900">{r.available_quantity}</td>
                    <td className="px-5 py-3 text-right text-ink-600">
                      ₹{Number(r.estimated_value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    </td>
                    <td className="px-5 py-3">
                      <ProductThresholdsForm
                        productId={r.product_id}
                        minStock={r.min_stock}
                        reorderLevel={r.reorder_level}
                        maxStock={r.max_stock}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {totalPages > 1 ? (
            <div className="flex items-center justify-center gap-2">
              {page > 1 ? (
                <Link href={`/admin/inventory/products?q=${encodeURIComponent(q)}&status=${status}&page=${page - 1}`}>
                  <Button size="sm" variant="outline">Previous</Button>
                </Link>
              ) : null}
              <span className="text-xs text-ink-400">Page {page} of {totalPages}</span>
              {page < totalPages ? (
                <Link href={`/admin/inventory/products?q=${encodeURIComponent(q)}&status=${status}&page=${page + 1}`}>
                  <Button size="sm" variant="outline">Next</Button>
                </Link>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
