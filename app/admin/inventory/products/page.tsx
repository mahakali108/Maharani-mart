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
import {
  InfiniteScrollProvider,
  InfiniteScrollRows,
  InfiniteScrollStatus,
  InfiniteScrollTableSkeleton,
  type InfiniteScrollBatch,
} from '@/components/ui/infinite-scroll';
import type { ProductTotalsViewRow } from '@/types/inventory.types';
import {
  applyCursor,
  applyKeysetOrder,
  keysetCursorFor,
  readCursor,
  toListBatch,
  type KeysetColumn,
} from '@/lib/infinite-scroll/keyset';
import type { ListCursor } from '@/lib/infinite-scroll/cursor';

/** Rows per batch. */
const PAGE_SIZE = 25;

/**
 * Name order, `product_id` breaking ties: two products can share a name, and a
 * keyset cursor must be able to point at exactly one row.
 */
const ORDER: KeysetColumn[] = [
  { column: 'product_name', ascending: true },
  { column: 'product_id', ascending: true },
];

const STATUS_STYLES: Record<string, string> = {
  healthy: 'bg-mint-50 text-mint-700',
  low_stock: 'bg-amber-50 text-amber-700',
  out_of_stock: 'bg-primary-50 text-primary-700',
};

const STATUS_LABELS: Record<string, string> = {
  healthy: 'Healthy',
  low_stock: 'Low stock',
  out_of_stock: 'Out of stock',
};

interface ProductFilters {
  q: string;
  status: string;
}

type SupabaseClient = ReturnType<typeof createClient>;

/**
 * One batch of `inventory_product_totals` rows. The view is already
 * is_staff_or_above()-gated (0017), so this keeps exactly the same visibility
 * rules as the old paged query — only the window changed.
 */
async function loadProductBatch(
  supabase: SupabaseClient,
  filters: ProductFilters,
  cursor: ListCursor | null
) {
  let query = supabase.from('inventory_product_totals').select('*');
  if (filters.q) query = query.or(`product_name.ilike.%${filters.q}%,sku_code.ilike.%${filters.q}%`);
  if (filters.status) query = query.eq('stock_status', filters.status);

  // The view covers every product; hide never-stocked items unless the
  // caller explicitly asks for out-of-stock (where zero rows matter).
  if (filters.status !== 'out_of_stock') query = query.gt('quantity_on_hand', 0);

  const { data, error } = await applyCursor(applyKeysetOrder(query, ORDER), cursor, ORDER, PAGE_SIZE);
  // "No matching products" must mean zero rows, never a failed read.
  if (error) throw new Error(`Inventory products could not be loaded [${error.code ?? 'unknown'}]: ${error.message}`);
  const rows = (data ?? []) as unknown as ProductTotalsViewRow[];
  return toListBatch(rows, PAGE_SIZE, (row) => keysetCursorFor(row, ORDER));
}

function renderProductRows(rows: ProductTotalsViewRow[]) {
  return rows.map((r) => (
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
  ));
}

export default async function InventoryProductsPage({
  searchParams,
}: {
  searchParams: { q?: string; status?: string };
}) {
  const supabase = createClient();

  const filters: ProductFilters = {
    q: (searchParams.q ?? '').trim(),
    status: searchParams.status ?? '',
  };

  const firstBatch = await loadProductBatch(supabase, filters, null);
  const rows = firstBatch.items;

  async function loadMoreProducts(cursor: string | null): Promise<InfiniteScrollBatch> {
    'use server';
    const batch = await loadProductBatch(createClient(), filters, readCursor(cursor));
    return { rows: renderProductRows(batch.items), nextCursor: batch.nextCursor };
  }

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
          <Input name="q" defaultValue={filters.q} placeholder="Search name or SKU…" className="max-w-xs" />
          <Select name="status" defaultValue={filters.status} className="max-w-[180px]">
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
        <InfiniteScrollProvider
          loader={loadMoreProducts}
          initialCursor={firstBatch.nextCursor}
          initialHasMore={Boolean(firstBatch.nextCursor)}
          resetKey={`${filters.q}|${filters.status}`}
        >
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
                <InfiniteScrollRows skeleton={<InfiniteScrollTableSkeleton columns={7} />}>
                  {renderProductRows(rows)}
                </InfiniteScrollRows>
              </tbody>
            </table>
          </Card>

          <InfiniteScrollStatus endLabel="No more products" loadingLabel="Loading more…" />
        </InfiniteScrollProvider>
      )}
    </div>
  );
}
