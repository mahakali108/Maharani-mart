import Link from 'next/link';
import { Layers } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { InventoryNav } from '@/components/admin/inventory-nav';
import { BatchLossForm } from '@/components/admin/batch-loss-form';
import {
  InfiniteScrollProvider,
  InfiniteScrollRows,
  InfiniteScrollStatus,
  InfiniteScrollTableSkeleton,
  type InfiniteScrollBatch,
} from '@/components/ui/infinite-scroll';
import { indiaAddDaysToKey, indiaDiffDays, indiaTodayDateKey } from '@/lib/datetime/india';
import { applyCursor, cursorOffset, readCursor, toOffsetBatch } from '@/lib/infinite-scroll/keyset';

/** Rows per batch. */
const PAGE_SIZE = 25;

interface BatchRow {
  id: string;
  batch_number: string;
  manufacturing_date: string | null;
  expiry_date: string | null;
  received_quantity: number;
  current_quantity: number;
  reserved_quantity: number;
  damaged_quantity: number;
  expired_quantity: number;
  unit_cost: number | null;
  products: { id: string; name: string; sku_code: string } | null;
  warehouses: { id: string; name: string } | null;
}

function expiryBadge(expiry: string | null): { label: string; cls: string } {
  if (!expiry) return { label: 'No expiry', cls: 'bg-ink-100 text-ink-500' };
  // Compare India calendar days (expiry_date is a date-only value).
  const diff = indiaDiffDays(indiaTodayDateKey(), expiry);
  if (diff === null) return { label: expiry, cls: 'bg-mint-50 text-mint-700' };
  if (diff < 0) return { label: `Expired ${-diff}d ago`, cls: 'bg-primary-50 text-primary-700' };
  if (diff <= 7) return { label: `${diff}d left`, cls: 'bg-amber-50 text-amber-700' };
  if (diff <= 30) return { label: `${diff}d left`, cls: 'bg-amber-50 text-amber-700' };
  return { label: expiry, cls: 'bg-mint-50 text-mint-700' };
}

interface BatchFilters {
  q: string;
  warehouse: string;
  expiry: string;
}

type SupabaseClient = ReturnType<typeof createClient>;

/**
 * One batch of live batches.
 *
 * `expiry_date` is nullable (a batch can have no expiry), so this list uses an
 * OFFSET cursor rather than a keyset one — NULL cannot be compared with "after
 * this row". `id` is the tiebreaker so consecutive batches never overlap.
 *
 * The product search moved INTO the query: it used to filter each page in
 * memory after the database had already chosen its window, which silently
 * shrank some pages to a handful of rows. `batch_number` is a real column and
 * the product match is a bounded id lookup, so a batch is now always a full
 * batch.
 */
async function loadBatchPage(
  supabase: SupabaseClient,
  filters: BatchFilters,
  cursor: ReturnType<typeof readCursor>
) {
  const offset = cursorOffset(cursor);
  const today = indiaTodayDateKey();
  const in7 = indiaAddDaysToKey(today, 7) ?? today;
  const in30 = indiaAddDaysToKey(today, 30) ?? today;

  let query = supabase
    .from('inventory_batches')
    .select(
      'id, batch_number, manufacturing_date, expiry_date, received_quantity, current_quantity, reserved_quantity, damaged_quantity, expired_quantity, unit_cost, products ( id, name, sku_code ), warehouses ( id, name )'
    )
    .gt('current_quantity', 0);

  if (filters.warehouse) query = query.eq('warehouse_id', filters.warehouse);
  if (filters.expiry === 'expired') query = query.lt('expiry_date', today);
  else if (filters.expiry === 'critical') query = query.gte('expiry_date', today).lte('expiry_date', in7);
  else if (filters.expiry === 'warning') query = query.gt('expiry_date', in7).lte('expiry_date', in30);

  if (filters.q) {
    const { data: matches } = await supabase
      .from('products')
      .select('id')
      .or(`name.ilike.%${filters.q}%,sku_code.ilike.%${filters.q}%`)
      .limit(500);
    const productIds = ((matches ?? []) as { id: string }[]).map((product) => product.id);
    const clauses = [`batch_number.ilike.%${filters.q}%`];
    if (productIds.length > 0) clauses.push(`product_id.in.(${productIds.join(',')})`);
    query = query.or(clauses.join(','));
  }

  const { data } = await applyCursor(
    query.order('expiry_date', { ascending: true, nullsFirst: false }).order('id', { ascending: true }),
    cursor,
    [],
    PAGE_SIZE
  );
  const rows = (data ?? []) as unknown as BatchRow[];
  return toOffsetBatch(rows, PAGE_SIZE, offset);
}

function renderBatchRows(rows: BatchRow[]) {
  return rows.map((b) => {
    const badge = expiryBadge(b.expiry_date);
    const available = b.current_quantity - b.reserved_quantity;
    return (
      <tr key={b.id}>
        <td className="px-5 py-3">
          <Link href={`/admin/products/${b.products?.id}`} className="font-medium text-ink-900 hover:text-primary-600">
            {b.products?.name ?? '—'}
          </Link>
          <p className="font-mono text-xs text-ink-400">{b.batch_number}</p>
        </td>
        <td className="px-5 py-3 text-ink-600">{b.warehouses?.name ?? '—'}</td>
        <td className="px-5 py-3">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.cls}`}>{badge.label}</span>
        </td>
        <td className="px-5 py-3 text-right font-medium text-ink-900">{b.current_quantity}</td>
        <td className="px-5 py-3 text-right text-ink-600">{b.reserved_quantity}</td>
        <td className="px-5 py-3 text-right font-semibold text-ink-900">{available}</td>
        <td className="px-5 py-3 text-right text-ink-500">{b.damaged_quantity + b.expired_quantity}</td>
        <td className="px-5 py-3">
          {available > 0 ? (
            <div className="flex gap-2">
              <BatchLossForm batchId={b.id} lossType="damage" maxQuantity={available} />
              <BatchLossForm batchId={b.id} lossType="expiry" maxQuantity={available} />
            </div>
          ) : (
            <span className="text-xs text-ink-400">Fully reserved</span>
          )}
        </td>
      </tr>
    );
  });
}

export default async function InventoryBatchesPage({
  searchParams,
}: {
  searchParams: { q?: string; warehouse?: string; expiry?: string };
}) {
  const supabase = createClient();

  const filters: BatchFilters = {
    q: (searchParams.q ?? '').trim(),
    warehouse: searchParams.warehouse ?? '',
    expiry: searchParams.expiry ?? '',
  };

  const [firstBatch, { data: warehouseData }] = await Promise.all([
    loadBatchPage(supabase, filters, null),
    supabase.from('warehouses').select('id, name').eq('is_active', true).order('name'),
  ]);
  const batches = firstBatch.items;

  async function loadMoreBatches(cursor: string | null): Promise<InfiniteScrollBatch> {
    'use server';
    const batch = await loadBatchPage(createClient(), filters, readCursor(cursor));
    return { rows: renderBatchRows(batch.items), nextCursor: batch.nextCursor };
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Batches</h1>
        <p className="mt-1 text-sm text-ink-500">
          Every live batch with expiry and FEFO order. Reserved units are committed to approved orders and cannot be
          written off until those orders are cancelled.
        </p>
      </div>

      <InventoryNav />

      <Card>
        <form method="get" className="flex flex-wrap gap-2">
          <Input name="q" defaultValue={filters.q} placeholder="Search product / SKU / batch…" className="max-w-xs" />
          <Select name="warehouse" defaultValue={filters.warehouse} className="max-w-[180px]">
            <option value="">All warehouses</option>
            {(warehouseData ?? []).map((w: { id: string; name: string }) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
          <Select name="expiry" defaultValue={filters.expiry} className="max-w-[180px]">
            <option value="">All expiry</option>
            <option value="expired">Expired</option>
            <option value="critical">≤ 7 days</option>
            <option value="warning">8–30 days</option>
          </Select>
          <Button type="submit" size="sm" variant="outline">
            Filter
          </Button>
        </form>
      </Card>

      {batches.length === 0 ? (
        <AdminEmptyState icon={Layers} title="No batches found" body="Confirm a GRN to create batches with expiry tracking." />
      ) : (
        <InfiniteScrollProvider
          loader={loadMoreBatches}
          initialCursor={firstBatch.nextCursor}
          initialHasMore={Boolean(firstBatch.nextCursor)}
          resetKey={`${filters.q}|${filters.warehouse}|${filters.expiry}`}
        >
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[1000px] text-sm">
              <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Product / Batch</th>
                  <th className="px-5 py-3 font-medium">Warehouse</th>
                  <th className="px-5 py-3 font-medium">Expiry</th>
                  <th className="px-5 py-3 text-right font-medium">On Hand</th>
                  <th className="px-5 py-3 text-right font-medium">Reserved</th>
                  <th className="px-5 py-3 text-right font-medium">Available</th>
                  <th className="px-5 py-3 text-right font-medium">Damaged</th>
                  <th className="px-5 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                <InfiniteScrollRows skeleton={<InfiniteScrollTableSkeleton columns={8} />}>
                  {renderBatchRows(batches)}
                </InfiniteScrollRows>
              </tbody>
            </table>
          </Card>

          <InfiniteScrollStatus endLabel="No more batches" loadingLabel="Loading more…" />
        </InfiniteScrollProvider>
      )}
    </div>
  );
}
