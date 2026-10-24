import Link from 'next/link';
import { Truck } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requirePermission, requirePagePermission } from '@/lib/admin/guard';
import { Card } from '@/components/ui/card';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { formatIndiaDateTime } from '@/lib/datetime/india';
import {
  InfiniteScrollProvider,
  InfiniteScrollRows,
  InfiniteScrollStatus,
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

interface OrderRow {
  id: string;
  order_number: string;
  status: string;
  grand_total: number;
  placed_at: string;
  retailers: { shop_name: string } | null;
  warehouses: { name: string } | null;
}

const STATUS_STYLES: Record<string, string> = {
  confirmed: 'bg-sky-50 text-sky-700',
  processing: 'bg-sky-50 text-sky-700',
  packed: 'bg-violet-50 text-violet-700',
};

/** Rows per batch. */
const BATCH_SIZE = 20;

/**
 * Oldest first — this is a work queue, so the order that has been waiting
 * longest is at the top. `placed_at` is NOT NULL and `id` is the primary key,
 * so the keyset cursor is always comparable and batches cannot overlap.
 */
const ORDER: KeysetColumn[] = [
  { column: 'placed_at', ascending: true },
  { column: 'id', ascending: true },
];

type SupabaseClient = ReturnType<typeof createClient>;

/** One batch of the dispatch queue. */
async function loadQueueBatch(
  supabase: SupabaseClient,
  cursor: ListCursor | null
): Promise<{ items: OrderRow[]; nextCursor: string | null }> {
  const query = supabase
    .from('orders')
    .select('id, order_number, status, grand_total, placed_at, retailers ( shop_name ), warehouses ( name )')
    .in('status', ['confirmed', 'processing', 'packed']);

  const { data } = await applyCursor(applyKeysetOrder(query, ORDER), cursor, ORDER, BATCH_SIZE);
  const rows = (data ?? []) as unknown as OrderRow[];
  const batch = toListBatch(rows, BATCH_SIZE, (row) => keysetCursorFor(row, ORDER));
  return { items: batch.items, nextCursor: batch.nextCursor };
}

function renderOrderCards(orders: OrderRow[]) {
  return orders.map((o) => (
    <Link key={o.id} href={`/staff/orders/${o.id}`} className="block">
      <Card className="flex min-w-0 flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <p className="font-mono text-sm font-medium text-ink-900">{o.order_number}</p>
          <p className="text-xs text-ink-500">{o.retailers?.shop_name}</p>
          <p className="text-xs text-ink-400">{o.warehouses?.name ?? 'No warehouse assigned'}</p>
          <p className="text-xs text-ink-400">{formatIndiaDateTime(o.placed_at)}</p>
        </div>
        <div className="text-right">
          <p className="font-semibold text-ink-900">₹{o.grand_total.toFixed(2)}</p>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[o.status] ?? 'bg-ink-100 text-ink-600'}`}>
            {o.status.charAt(0).toUpperCase() + o.status.slice(1)}
          </span>
        </div>
      </Card>
    </Link>
  ));
}

export default async function StaffOrdersPage() {
  await requirePagePermission('orders.view.all');
  const supabase = createClient();
  const firstBatch = await loadQueueBatch(supabase, null);
  const orders = firstBatch.items;

  /** Server Action for the batches after the first. */
  async function loadMoreOrders(cursor: string | null): Promise<InfiniteScrollBatch> {
    'use server';
    // The same permission gate as the page: a cursor cannot widen access.
    await requirePermission('orders.view.all');
    const batch = await loadQueueBatch(createClient(), readCursor(cursor));
    return { rows: renderOrderCards(batch.items), nextCursor: batch.nextCursor };
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Dispatch Queue</h1>
        <p className="mt-1 text-sm text-ink-500">Approved orders waiting to be packed and dispatched.</p>
      </div>

      {orders.length === 0 ? (
        <AdminEmptyState
          icon={Truck}
          title="Nothing to dispatch"
          body="Orders approved by an admin will appear here, ready for you to pack and dispatch."
        />
      ) : (
        <InfiniteScrollProvider
          loader={loadMoreOrders}
          initialCursor={firstBatch.nextCursor}
          initialHasMore={Boolean(firstBatch.nextCursor)}
        >
          <div className="space-y-2">
            <InfiniteScrollRows skeleton={<OrderSkeleton />}>{renderOrderCards(orders)}</InfiniteScrollRows>
          </div>

          <InfiniteScrollStatus endLabel="No more orders" loadingLabel="Loading more…" />
        </InfiniteScrollProvider>
      )}
    </div>
  );
}

function OrderSkeleton() {
  return (
    <>
      {[0, 1, 2].map((row) => (
        <div key={`skeleton-${row}`} aria-hidden="true" className="rounded-2xl border border-ink-100 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-2">
              <span className="block h-3 w-28 animate-pulse rounded bg-ink-100" />
              <span className="block h-3 w-40 animate-pulse rounded bg-ink-100" />
            </div>
            <span className="h-6 w-16 animate-pulse rounded-full bg-ink-100" />
          </div>
        </div>
      ))}
    </>
  );
}
