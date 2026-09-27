import Link from 'next/link';
import { History } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { InventoryNav } from '@/components/admin/inventory-nav';
import {
  InfiniteScrollProvider,
  InfiniteScrollRows,
  InfiniteScrollStatus,
  InfiniteScrollTableSkeleton,
  type InfiniteScrollBatch,
} from '@/components/ui/infinite-scroll';
import { formatIndiaDateTime, indiaDayEndIso, indiaDayStartIso } from '@/lib/datetime/india';
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
const PAGE_SIZE = 30;

/**
 * `seq` is a monotonic NOT NULL sequence with its own `seq desc` index
 * (0017_inventory_batches_fefo_grn.sql), so it is a textbook keyset column:
 * "rows with a smaller seq" is exact, unique and index-only, and a movement
 * written while the user scrolls can never shift the rows already on screen.
 */
const ORDER: KeysetColumn[] = [{ column: 'seq', ascending: false }];

const MOVEMENT_STYLES: Record<string, string> = {
  inward: 'bg-green-50 text-green-700',
  outward: 'bg-primary-50 text-primary-700',
  damage: 'bg-primary-50 text-primary-700',
  return: 'bg-blue-50 text-blue-700',
  transfer: 'bg-violet-50 text-violet-700',
  transfer_out: 'bg-violet-50 text-violet-700',
  transfer_in: 'bg-violet-50 text-violet-700',
  adjustment: 'bg-amber-50 text-amber-700',
  stock_adjustment: 'bg-amber-50 text-amber-700',
  manual_correction: 'bg-amber-50 text-amber-700',
  opening_stock: 'bg-teal-50 text-teal-700',
  grn_receipt: 'bg-green-50 text-green-700',
  sale: 'bg-primary-50 text-primary-700',
  sale_reservation: 'bg-sky-50 text-sky-700',
  sale_release: 'bg-sky-50 text-sky-700',
  expiry: 'bg-orange-50 text-orange-700',
};

const MOVEMENT_OPTIONS = [
  'opening_stock', 'grn_receipt', 'sale', 'sale_reservation', 'sale_release', 'return', 'damage', 'expiry',
  'stock_adjustment', 'transfer_out', 'transfer_in', 'manual_correction', 'inward', 'outward', 'transfer', 'adjustment',
];

interface MovementRow {
  id: string;
  movement_type: string;
  quantity: number;
  direction: string | null;
  reason: string | null;
  reference_type: string | null;
  previous_quantity: number | null;
  new_quantity: number | null;
  created_at: string;
  seq: number;
  products: { name: string; sku_code: string } | null;
  warehouses: { name: string } | null;
  inventory_batches: { batch_number: string } | null;
  profiles: { full_name: string } | null;
}


interface MovementFilters {
  warehouse: string;
  type: string;
  q: string;
  from: string;
  to: string;
}

type SupabaseClient = ReturnType<typeof createClient>;

/**
 * One batch of stock movements.
 *
 * The product-name search stays a bounded two-step lookup because PostgREST
 * cannot filter an embedded relation from the parent query — unchanged from
 * before, just narrowed to the ids that can match.
 */
async function loadMovementBatch(
  supabase: SupabaseClient,
  filters: MovementFilters,
  cursor: ListCursor | null
) {
  let query = supabase
    .from('stock_movements')
    .select(
      'id, movement_type, quantity, direction, reason, reference_type, previous_quantity, new_quantity, created_at, seq, products ( name, sku_code ), warehouses ( name ), inventory_batches ( batch_number ), profiles ( full_name )'
    );

  if (filters.warehouse) query = query.eq('warehouse_id', filters.warehouse);
  if (filters.type) query = query.eq('movement_type', filters.type);
  // Date filters are Asia/Kolkata calendar days; convert to UTC instants.
  if (filters.from) query = query.gte('created_at', indiaDayStartIso(filters.from)!);
  if (filters.to) query = query.lte('created_at', indiaDayEndIso(filters.to)!);

  let productIds: string[] | null = null;
  if (filters.q) {
    const { data: matches } = await supabase
      .from('products')
      .select('id')
      .or(`name.ilike.%${filters.q}%,sku_code.ilike.%${filters.q}%`)
      .limit(500);
    productIds = ((matches ?? []) as { id: string }[]).map((p) => p.id);
    if (productIds.length === 0) productIds = ['00000000-0000-0000-0000-000000000000'];
  }
  if (productIds) query = query.in('product_id', productIds);

  const { data } = await applyCursor(applyKeysetOrder(query, ORDER), cursor, ORDER, PAGE_SIZE);
  const rows = (data ?? []) as unknown as MovementRow[];
  return toListBatch(rows, PAGE_SIZE, (row) => keysetCursorFor(row, ORDER));
}

function renderMovementRows(rows: MovementRow[]) {
  return rows.map((m) => (
    <tr key={m.id}>
      <td className="whitespace-nowrap px-5 py-3 text-ink-500">{formatIndiaDateTime(m.created_at)}</td>
      <td className="px-5 py-3">
        <p className="font-medium text-ink-900">{m.products?.name ?? '—'}</p>
        <p className="font-mono text-xs text-ink-400">{m.products?.sku_code}</p>
      </td>
      <td className="px-5 py-3 font-mono text-xs text-ink-500">{m.inventory_batches?.batch_number ?? '—'}</td>
      <td className="px-5 py-3 text-ink-600">{m.warehouses?.name ?? '—'}</td>
      <td className="px-5 py-3">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${MOVEMENT_STYLES[m.movement_type] ?? 'bg-ink-100 text-ink-600'}`}>
          {m.movement_type.replace(/_/g, ' ')}
        </span>
      </td>
      <td className={`px-5 py-3 text-right font-semibold ${m.direction === 'out' ? 'text-primary-600' : 'text-green-600'}`}>
        {m.direction === 'out' ? '\u2212' : '+'}
        {Math.abs(m.quantity)}
      </td>
      <td className="whitespace-nowrap px-5 py-3 text-right text-xs text-ink-400">
        {m.previous_quantity != null && m.new_quantity != null ? `${m.previous_quantity} \u2192 ${m.new_quantity}` : '—'}
      </td>
      <td className="px-5 py-3 text-ink-600">{m.profiles?.full_name ?? '—'}</td>
      <td className="max-w-[220px] truncate px-5 py-3 text-ink-500" title={m.reason ?? undefined}>
        {m.reason ?? '—'}
      </td>
    </tr>
  ));
}

export default async function InventoryMovementsPage({
  searchParams,
}: {
  searchParams: { warehouse?: string; type?: string; q?: string; from?: string; to?: string };
}) {
  const supabase = createClient();

  const filters: MovementFilters = {
    warehouse: searchParams.warehouse ?? '',
    type: searchParams.type ?? '',
    q: (searchParams.q ?? '').trim(),
    from: searchParams.from ?? '',
    to: searchParams.to ?? '',
  };

  const [firstBatch, { data: warehouseData }] = await Promise.all([
    loadMovementBatch(supabase, filters, null),
    supabase.from('warehouses').select('id, name').order('name'),
  ]);
  const movements = firstBatch.items;

  /** Server Action for batches 2..n. Filters ride along encrypted. */
  async function loadMoreMovements(cursor: string | null): Promise<InfiniteScrollBatch> {
    'use server';
    const batch = await loadMovementBatch(createClient(), filters, readCursor(cursor));
    return { rows: renderMovementRows(batch.items), nextCursor: batch.nextCursor };
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Stock Movement Ledger</h1>
        <p className="mt-1 text-sm text-ink-500">
          Append-only audit trail of every stock change — receipts, FEFO reservations, sales, write-offs, transfers
          and corrections. Historical rows cannot be edited or deleted.
        </p>
      </div>

      <InventoryNav />

      <Card>
        <form method="get" className="flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-500">Search product</label>
            <Input name="q" defaultValue={filters.q} placeholder="Name or SKU" className="w-44" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-500">Warehouse</label>
            <Select name="warehouse" defaultValue={filters.warehouse} className="w-40">
              <option value="">All</option>
              {(warehouseData ?? []).map((w: { id: string; name: string }) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-500">Type</label>
            <Select name="type" defaultValue={filters.type} className="w-44">
              <option value="">All types</option>
              {MOVEMENT_OPTIONS.map((t) => (
                <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
              ))}
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-500">From</label>
            <Input type="date" name="from" defaultValue={filters.from} className="w-40" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-500">To</label>
            <Input type="date" name="to" defaultValue={filters.to} className="w-40" />
          </div>
          <Button type="submit" size="sm" variant="outline">Filter</Button>
          <Link href="/admin/inventory/movements" className="text-xs text-ink-400 hover:text-ink-600">Reset</Link>
        </form>
      </Card>

      {movements.length === 0 ? (
        <AdminEmptyState
          icon={History}
          title="No movements match"
          body="Every receipt, reservation, dispatch, write-off and transfer is recorded here as it happens."
        />
      ) : (
        <InfiniteScrollProvider
          loader={loadMoreMovements}
          initialCursor={firstBatch.nextCursor}
          initialHasMore={Boolean(firstBatch.nextCursor)}
          resetKey={`${filters.warehouse}|${filters.type}|${filters.q}|${filters.from}|${filters.to}`}
        >
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[1000px] text-sm">
              <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-3 font-medium">When</th>
                  <th className="px-5 py-3 font-medium">Product</th>
                  <th className="px-5 py-3 font-medium">Batch</th>
                  <th className="px-5 py-3 font-medium">Warehouse</th>
                  <th className="px-5 py-3 font-medium">Type</th>
                  <th className="px-5 py-3 text-right font-medium">Qty</th>
                  <th className="px-5 py-3 text-right font-medium">Prev → New</th>
                  <th className="px-5 py-3 font-medium">By</th>
                  <th className="px-5 py-3 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                <InfiniteScrollRows skeleton={<InfiniteScrollTableSkeleton columns={9} />}>
                  {renderMovementRows(movements)}
                </InfiniteScrollRows>
              </tbody>
            </table>
          </Card>

          <InfiniteScrollStatus endLabel="No more movements" loadingLabel="Loading more…" />
        </InfiniteScrollProvider>
      )}
    </div>
  );
}
