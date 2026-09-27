import { History } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import type { Permission } from '@/lib/permissions/permissions';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { AdminEmptyState } from '@/components/admin/empty-state';
import {
  InfiniteScrollProvider,
  InfiniteScrollRows,
  InfiniteScrollStatus,
  InfiniteScrollTableSkeleton,
  type InfiniteScrollBatch,
} from '@/components/ui/infinite-scroll';
import { formatIndiaDateTime } from '@/lib/datetime/india';
import {
  applyCursor,
  applyKeysetOrder,
  keysetCursorFor,
  readCursor,
  toListBatch,
  type KeysetColumn,
} from '@/lib/infinite-scroll/keyset';
import type { ListCursor } from '@/lib/infinite-scroll/cursor';

/**
 * The stock movement ledger list, shared by /admin/inventory/ledger and
 * /staff/inventory/ledger — the two pages were byte-for-byte the same except
 * for the route in their pagination links, so the list (and its "load more"
 * Server Action) lives here once.
 *
 * It scrolls instead of paging: the ledger is an append-only audit trail that
 * only ever grows, which is exactly the case where an old-style page counter is useless
 * and "keep scrolling" is right.
 */

/** Rows per batch. */
const PAGE_SIZE = 30;

/** Newest first, `id` breaking ties so batches never overlap. */
const ORDER: KeysetColumn[] = [
  { column: 'created_at', ascending: false },
  { column: 'id', ascending: false },
];

const MOVEMENT_STYLES: Record<string, string> = {
  inward: 'bg-green-50 text-green-700',
  outward: 'bg-primary-50 text-primary-700',
  damage: 'bg-primary-50 text-primary-700',
  return: 'bg-blue-50 text-blue-700',
  transfer: 'bg-violet-50 text-violet-700',
  adjustment: 'bg-amber-50 text-amber-700',
};

interface Option {
  id: string;
  name: string;
}

interface MovementRow {
  id: string;
  movement_type: string;
  quantity: number;
  reason: string | null;
  created_at: string;
  products: { name: string; sku_code: string } | null;
  warehouses: { name: string } | null;
  profiles: { full_name: string } | null;
}

type SupabaseClient = ReturnType<typeof createClient>;

async function loadMovementBatch(
  supabase: SupabaseClient,
  warehouseFilter: string,
  cursor: ListCursor | null
) {
  let query = supabase
    .from('stock_movements')
    .select(
      'id, movement_type, quantity, reason, created_at, products ( name, sku_code ), warehouses ( name ), profiles ( full_name )'
    );

  if (warehouseFilter) query = query.eq('warehouse_id', warehouseFilter);

  const { data } = await applyCursor(applyKeysetOrder(query, ORDER), cursor, ORDER, PAGE_SIZE);
  const rows = (data ?? []) as unknown as MovementRow[];
  return toListBatch(rows, PAGE_SIZE, (row) => keysetCursorFor(row, ORDER));
}

function renderMovementRows(rows: MovementRow[]) {
  return rows.map((m) => (
    <tr key={m.id}>
      <td className="px-5 py-3">
        <p className="font-medium text-ink-900">{m.products?.name ?? '—'}</p>
        <p className="font-mono text-xs text-ink-400">{m.products?.sku_code}</p>
      </td>
      <td className="px-5 py-3 text-ink-600">{m.warehouses?.name ?? '—'}</td>
      <td className="px-5 py-3">
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${MOVEMENT_STYLES[m.movement_type] ?? 'bg-ink-100 text-ink-600'}`}
        >
          {m.movement_type}
        </span>
      </td>
      <td className="px-5 py-3 font-medium text-ink-900">{m.quantity}</td>
      <td className="px-5 py-3 text-ink-600">{m.profiles?.full_name ?? '—'}</td>
      <td className="px-5 py-3 text-ink-500">{m.reason ?? '—'}</td>
      <td className="px-5 py-3 text-ink-500">{formatIndiaDateTime(m.created_at)}</td>
    </tr>
  ));
}

export async function StockLedgerList({
  warehouseFilter = '',
  permission,
}: {
  warehouseFilter?: string;
  /** Optional Server Action guard — the staff route passes 'inventory.view'. */
  permission?: Permission;
}) {
  if (permission) await requirePermission(permission);
  const supabase = createClient();

  const [firstBatch, { data: warehouseData }] = await Promise.all([
    loadMovementBatch(supabase, warehouseFilter, null),
    supabase.from('warehouses').select('id, name').order('name'),
  ]);
  const movements = firstBatch.items;
  const warehouses = (warehouseData ?? []) as Option[];

  /** Server Action for batches 2..n; the guard is re-run inside it. */
  async function loadMoreMovements(cursor: string | null): Promise<InfiniteScrollBatch> {
    'use server';
    if (permission) await requirePermission(permission);
    const batch = await loadMovementBatch(createClient(), warehouseFilter, readCursor(cursor));
    return { rows: renderMovementRows(batch.items), nextCursor: batch.nextCursor };
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Stock Movement Ledger</h1>
        <p className="mt-1 text-sm text-ink-500">
          The complete audit trail of every stock change — inward, outward (dispatch), damage, returns, transfers, and
          manual adjustments. Nothing here is editable; it&apos;s a historical record.
        </p>
      </div>

      <Card>
        <form method="get" className="flex gap-2">
          <Select name="warehouse" defaultValue={warehouseFilter}>
            <option value="">All warehouses</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
          <Button type="submit" size="sm" variant="outline">
            Filter
          </Button>
        </form>
      </Card>

      {movements.length === 0 ? (
        <AdminEmptyState
          icon={History}
          title="No stock movements yet"
          body="Every inward delivery, dispatch, damage report, return, or adjustment will be logged here as it happens."
        />
      ) : (
        <InfiniteScrollProvider
          loader={loadMoreMovements}
          initialCursor={firstBatch.nextCursor}
          initialHasMore={Boolean(firstBatch.nextCursor)}
          resetKey={warehouseFilter}
        >
          <Card className="table-scroll p-0">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Product</th>
                  <th className="px-5 py-3 font-medium">Warehouse</th>
                  <th className="px-5 py-3 font-medium">Type</th>
                  <th className="px-5 py-3 font-medium">Qty</th>
                  <th className="px-5 py-3 font-medium">By</th>
                  <th className="px-5 py-3 font-medium">Reason</th>
                  <th className="px-5 py-3 font-medium">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                <InfiniteScrollRows skeleton={<InfiniteScrollTableSkeleton columns={7} />}>
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
