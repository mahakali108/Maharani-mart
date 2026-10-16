import Link from 'next/link';
import { ClipboardList } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
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

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700',
  confirmed: 'bg-sky-50 text-sky-700',
  processing: 'bg-sky-50 text-sky-700',
  packed: 'bg-violet-50 text-violet-700',
  dispatched: 'bg-violet-50 text-violet-700',
  delivered: 'bg-mint-50 text-mint-700',
  cancelled: 'bg-primary-50 text-primary-700',
};

interface OrderRow {
  id: string;
  order_number: string;
  status: string;
  grand_total: number;
  placed_at: string;
  retailers: { shop_name: string; areas: { name: string } | null } | null;
}

/** Rows per batch. */
const BATCH_SIZE = 20;

/**
 * Newest first, `id` breaking ties. `placed_at` is NOT NULL and `id` is the
 * primary key, so batches can never overlap or skip a row.
 */
const ORDER: KeysetColumn[] = [
  { column: 'placed_at', ascending: false },
  { column: 'id', ascending: false },
];

type SupabaseClient = ReturnType<typeof createClient>;

/**
 * One batch of the salesman's orders.
 *
 * Keep the application query on orders' own columns (PostgREST does
 * not reliably support OR filters spanning embedded resources). RLS
 * independently enforces the same assigned-or-collected boundary.
 */
async function loadOrderBatch(
  supabase: SupabaseClient,
  salesmanId: string,
  options: { dispatchedOnly: boolean },
  cursor: ListCursor | null
): Promise<{ items: OrderRow[]; nextCursor: string | null }> {
  const { data: assignedData } = await supabase.from('retailers').select('id').eq('assigned_salesman_id', salesmanId);
  const assignedIds = ((assignedData ?? []) as { id: string }[]).map((retailer) => retailer.id);

  let query = supabase
    .from('orders')
    .select('id, order_number, status, grand_total, placed_at, retailers ( shop_name, areas ( name ) )');

  query =
    assignedIds.length > 0
      ? query.or(`collected_by.eq.${salesmanId},retailer_id.in.(${assignedIds.join(',')})`)
      : query.eq('collected_by', salesmanId);

  query = options.dispatchedOnly ? query.eq('status', 'dispatched') : query.neq('status', 'dispatched');

  const { data } = await applyCursor(applyKeysetOrder(query, ORDER), cursor, ORDER, BATCH_SIZE);
  const rows = (data ?? []) as unknown as OrderRow[];
  const batch = toListBatch(rows, BATCH_SIZE, (row) => keysetCursorFor(row, ORDER));
  return { items: batch.items, nextCursor: batch.nextCursor };
}

function renderOrderCards(orders: OrderRow[]) {
  return orders.map((o) => (
    <Link key={o.id} href={`/salesman/orders/${o.id}`} className="block">
      <Card className="flex min-w-0 flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <p className="font-mono text-sm font-medium text-ink-900">{o.order_number}</p>
          <p className="text-xs text-ink-500">{o.retailers?.shop_name}</p>
          <p className="text-xs text-ink-400">{o.retailers?.areas?.name}</p>
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

export default async function SalesmanOrdersPage() {
  const user = await requireUser();
  const supabase = createClient();

  const [dispatched, others] = await Promise.all([
    loadOrderBatch(supabase, user.id, { dispatchedOnly: true }, null),
    loadOrderBatch(supabase, user.id, { dispatchedOnly: false }, null),
  ]);

  /**
   * Server Action for the batches after the first. The salesman id is
   * re-derived from the session, never taken from the cursor.
   */
  async function loadMoreDispatched(cursor: string | null): Promise<InfiniteScrollBatch> {
    'use server';
    const caller = await requireUser();
    const batch = await loadOrderBatch(createClient(), caller.id, { dispatchedOnly: true }, readCursor(cursor));
    return { rows: renderOrderCards(batch.items), nextCursor: batch.nextCursor };
  }

  /** Server Action for the "Other orders" batches after the first. */
  async function loadMoreOthers(cursor: string | null): Promise<InfiniteScrollBatch> {
    'use server';
    const caller = await requireUser();
    const batch = await loadOrderBatch(createClient(), caller.id, { dispatchedOnly: false }, readCursor(cursor));
    return { rows: renderOrderCards(batch.items), nextCursor: batch.nextCursor };
  }

  const isEmpty = dispatched.items.length === 0 && others.items.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink-950">My Orders</h1>
          <p className="mt-1 text-sm text-ink-500">Orders you collected and orders belonging to your assigned retailers.</p>
        </div>
        <Link href="/salesman/orders/new" className="shrink-0 rounded-xl bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700">
          New order
        </Link>
      </div>

      {isEmpty ? (
        <AdminEmptyState
          icon={ClipboardList}
          title="No orders yet"
          body="Orders you capture and orders from your assigned retailers will show up here."
        />
      ) : (
        <>
          {dispatched.items.length > 0 ? (
            <InfiniteScrollProvider
              loader={loadMoreDispatched}
              initialCursor={dispatched.nextCursor}
              initialHasMore={Boolean(dispatched.nextCursor)}
            >
              <div>
                <h2 className="mb-2 text-sm font-semibold text-ink-800">Out for delivery</h2>
                <div className="space-y-2">
                  <InfiniteScrollRows skeleton={<OrderSkeleton />}>
                    {renderOrderCards(dispatched.items)}
                  </InfiniteScrollRows>
                </div>
              </div>
              <InfiniteScrollStatus endLabel="No more dispatched orders" loadingLabel="Loading more…" />
            </InfiniteScrollProvider>
          ) : null}

          {others.items.length > 0 ? (
            <InfiniteScrollProvider
              loader={loadMoreOthers}
              initialCursor={others.nextCursor}
              initialHasMore={Boolean(others.nextCursor)}
            >
              <div>
                <h2 className="mb-2 mt-4 text-sm font-semibold text-ink-800">Other orders</h2>
                <div className="space-y-2">
                  <InfiniteScrollRows skeleton={<OrderSkeleton />}>
                    {renderOrderCards(others.items)}
                  </InfiniteScrollRows>
                </div>
              </div>
              <InfiniteScrollStatus endLabel="No more orders" loadingLabel="Loading more…" />
            </InfiniteScrollProvider>
          ) : null}
        </>
      )}
    </div>
  );
}
