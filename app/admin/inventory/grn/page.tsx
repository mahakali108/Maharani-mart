import Link from 'next/link';
import { FileCheck2, Plus } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { InventoryNav } from '@/components/admin/inventory-nav';
import { StatusBadge } from '@/components/admin/status-badge';
import {
  InfiniteScrollProvider,
  InfiniteScrollRows,
  InfiniteScrollStatus,
  InfiniteScrollTableSkeleton,
  type InfiniteScrollBatch,
} from '@/components/ui/infinite-scroll';
import type { GrnRow } from '@/types/inventory.types';
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

/** Rows per batch. */
const PAGE_SIZE = 25;

/** Newest first, `id` breaking ties so batches never overlap. */
const ORDER: KeysetColumn[] = [
  { column: 'created_at', ascending: false },
  { column: 'id', ascending: false },
];

interface GrnListRow extends GrnRow {
  warehouses: { name: string } | null;
}

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/**
 * One batch of GRNs. Line counts are resolved for the rows in THIS batch only
 * (the old page pulled every grn_items row in the database on every request).
 */
async function loadGrnBatch(supabase: SupabaseClient, status: string, cursor: ListCursor | null) {
  let query = supabase.from('grns').select('*, warehouses ( name )');
  if (status) query = query.eq('status', status);

  const { data } = await applyCursor(applyKeysetOrder(query, ORDER), cursor, ORDER, PAGE_SIZE);
  const batch = toListBatch((data ?? []) as unknown as GrnListRow[], PAGE_SIZE, (row) =>
    keysetCursorFor(row, ORDER)
  );

  const itemCounts = new Map<string, number>();
  if (batch.items.length > 0) {
    const { data: itemData } = await supabase
      .from('grn_items')
      .select('grn_id')
      .in('grn_id', batch.items.map((grn) => grn.id));
    for (const item of (itemData ?? []) as { grn_id: string }[]) {
      itemCounts.set(item.grn_id, (itemCounts.get(item.grn_id) ?? 0) + 1);
    }
  }

  return { items: batch.items, nextCursor: batch.nextCursor, itemCounts };
}

function renderGrnRows(rows: GrnListRow[], itemCounts: Map<string, number>) {
  return rows.map((g) => (
    <tr key={g.id}>
      <td className="px-5 py-3">
        <Link href={`/admin/inventory/grn/${g.id}`} className="font-mono font-medium text-ink-900 hover:text-primary-600">
          {g.grn_number}
        </Link>
      </td>
      <td className="px-5 py-3 text-ink-600">{g.warehouses?.name ?? '—'}</td>
      <td className="px-5 py-3 text-ink-600">{g.supplier_reference ?? '—'}</td>
      <td className="px-5 py-3 text-right text-ink-600">{itemCounts.get(g.id) ?? 0}</td>
      <td className="px-5 py-3">
        <StatusBadge status={g.status} />
      </td>
      <td className="px-5 py-3 text-ink-500">{formatIndiaDateTime(g.created_at)}</td>
      <td className="px-5 py-3 text-ink-500">{g.confirmed_at ? formatIndiaDateTime(g.confirmed_at) : '—'}</td>
    </tr>
  ));
}

export default async function GrnListPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const searchParams = await searchParamsPromise;
  const supabase = (await createClient());
  const status = searchParams.status ?? '';

  const firstBatch = await loadGrnBatch(supabase, status, null);
  const grns = firstBatch.items;

  async function loadMoreGrns(cursor: string | null): Promise<InfiniteScrollBatch> {
    'use server';
    const batch = await loadGrnBatch((await createClient()), status, readCursor(cursor));
    return { rows: renderGrnRows(batch.items, new Map(batch.itemCounts)), nextCursor: batch.nextCursor };
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink-950">Goods Received Notes</h1>
          <p className="mt-1 text-sm text-ink-500">
            Receiving stock via GRN creates batches, expiry dates and GRN_RECEIPT ledger entries atomically on
            confirmation.
          </p>
        </div>
        <Link href="/admin/inventory/grn/new">
          <Button size="sm">
            <Plus className="h-4 w-4" /> New GRN
          </Button>
        </Link>
      </div>

      <InventoryNav />

      <Card>
        <form method="get" className="flex gap-2">
          <Select name="status" defaultValue={status} className="max-w-[180px]">
            <option value="">All statuses</option>
            <option value="draft">Draft</option>
            <option value="confirmed">Confirmed</option>
            <option value="cancelled">Cancelled</option>
          </Select>
          <Button type="submit" size="sm" variant="outline">
            Filter
          </Button>
        </form>
      </Card>

      {grns.length === 0 ? (
        <AdminEmptyState
          icon={FileCheck2}
          title="No GRNs yet"
          body="Create your first Goods Received Note to bring stock into inventory with batch and expiry tracking."
        />
      ) : (
        <InfiniteScrollProvider
          loader={loadMoreGrns}
          initialCursor={firstBatch.nextCursor}
          initialHasMore={Boolean(firstBatch.nextCursor)}
          resetKey={status}
        >
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[800px] text-sm">
              <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-3 font-medium">GRN #</th>
                  <th className="px-5 py-3 font-medium">Warehouse</th>
                  <th className="px-5 py-3 font-medium">Supplier ref</th>
                  <th className="px-5 py-3 text-right font-medium">Lines</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Created</th>
                  <th className="px-5 py-3 font-medium">Confirmed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                <InfiniteScrollRows skeleton={<InfiniteScrollTableSkeleton columns={7} />}>
                  {renderGrnRows(grns, firstBatch.itemCounts)}
                </InfiniteScrollRows>
              </tbody>
            </table>
          </Card>

          <InfiniteScrollStatus endLabel="No more GRNs" loadingLabel="Loading more…" />
        </InfiniteScrollProvider>
      )}
    </div>
  );
}
