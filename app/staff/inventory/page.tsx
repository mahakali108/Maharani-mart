import Link from 'next/link';
import { Boxes, History } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requirePermission, requirePagePermission } from '@/lib/admin/guard';
import { Card } from '@/components/ui/card';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { StockAdjustmentForm } from '@/components/admin/stock-adjustment-form';
import { resolveActiveWarehouse } from '@/lib/warehouse/resolver';
import {
  InfiniteScrollProvider,
  InfiniteScrollRows,
  InfiniteScrollStatus,
  InfiniteScrollTableSkeleton,
  type InfiniteScrollBatch,
} from '@/components/ui/infinite-scroll';
import {
  applyCursor,
  applyKeysetOrder,
  keysetCursorFor,
  readCursor,
  toListBatch,
  type KeysetColumn,
} from '@/lib/infinite-scroll/keyset';
import type { ListCursor } from '@/lib/infinite-scroll/cursor';

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

/** Rows per batch. */
const BATCH_SIZE = 30;

/**
 * Most recently touched stock first. `inventory_stock.updated_at` is NOT NULL
 * (0001_init.sql) and `id` is the primary key, so the keyset cursor is always
 * defined and two batches can never overlap. A row that is adjusted while the
 * user scrolls only moves towards the top, i.e. behind the cursor, so it can
 * never be shown twice.
 */
const ORDER: KeysetColumn[] = [
  { column: 'updated_at', ascending: false },
  { column: 'id', ascending: false },
];

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/** One batch of the stock table. */
async function loadStockBatch(
  supabase: SupabaseClient,
  cursor: ListCursor | null
): Promise<{ items: StockRow[]; nextCursor: string | null }> {
  const query = supabase
    .from('inventory_stock')
    .select('id, quantity, reserved_quantity, products ( name, sku_code ), warehouses ( name )');

  const { data, error } = await applyCursor(applyKeysetOrder(query, ORDER), cursor, ORDER, BATCH_SIZE);
  // Never render a failed stock read as "No inventory recorded yet".
  if (error) throw new Error(`Stock levels could not be loaded [${error.code ?? 'unknown'}]: ${error.message}`);
  const rows = (data ?? []) as unknown as StockRow[];
  const batch = toListBatch(rows, BATCH_SIZE, (row) => keysetCursorFor(row, ORDER));
  return { items: batch.items, nextCursor: batch.nextCursor };
}

function renderStockRows(stock: StockRow[]) {
  return stock.map((s) => (
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
  ));
}

export default async function StaffInventoryPage() {
  await requirePagePermission('inventory.view');
  const supabase = (await createClient());

  const [firstBatch, { data: productData, error: productError }, warehouseResolution] = await Promise.all([
    loadStockBatch(supabase, null),
    supabase.from('products').select('id, name').eq('is_active', true).order('name'),
    resolveActiveWarehouse(supabase),
  ]);

  // The product picker is part of the adjustment form; a failed read there
  // would silently offer an empty list, so fail loudly instead.
  if (productError) {
    throw new Error(`Products could not be loaded [${productError.code ?? 'unknown'}]: ${productError.message}`);
  }
  const stock = firstBatch.items;
  const products = (productData ?? []) as Option[];

  /** Server Action for the batches after the first. */
  async function loadMoreStock(cursor: string | null): Promise<InfiniteScrollBatch> {
    'use server';
    // Same permission gate as the page: a cursor cannot widen access.
    await requirePermission('inventory.view');
    const batch = await loadStockBatch((await createClient()), readCursor(cursor));
    return { rows: renderStockRows(batch.items), nextCursor: batch.nextCursor };
  }

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
        <StockAdjustmentForm
          products={products}
          warehouse={warehouseResolution.ok ? { name: warehouseResolution.warehouse.name } : null}
          warehouseError={warehouseResolution.ok ? null : warehouseResolution.message}
        />
      </Card>

      {stock.length === 0 ? (
        <AdminEmptyState
          icon={Boxes}
          title="No inventory recorded yet"
          body="Stock levels will appear here once inward stock, dispatches, or adjustments are recorded."
        />
      ) : (
        <InfiniteScrollProvider
          loader={loadMoreStock}
          initialCursor={firstBatch.nextCursor}
          initialHasMore={Boolean(firstBatch.nextCursor)}
        >
          <Card className="table-scroll p-0">
            <table className="w-full min-w-[680px] text-sm">
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
                <InfiniteScrollRows skeleton={<InfiniteScrollTableSkeleton columns={5} />}>
                  {renderStockRows(stock)}
                </InfiniteScrollRows>
              </tbody>
            </table>
          </Card>

          <InfiniteScrollStatus endLabel="No more stock rows" loadingLabel="Loading more…" />
        </InfiniteScrollProvider>
      )}
    </div>
  );
}
