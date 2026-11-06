import Link from 'next/link';
import { Search, ShoppingCart } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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

/** Rows per batch. Small enough for a phone, large enough to avoid chatter. */
const PAGE_SIZE = 20;

/**
 * The list ORDER BY — and, in the same breath, the shape of the keyset cursor.
 * `id` is the tiebreaker: two orders can share a `placed_at`, so without it a
 * batch boundary could repeat or skip a row.
 */
const ORDER: KeysetColumn[] = [
  { column: 'placed_at', ascending: false },
  { column: 'id', ascending: false },
];

const STATUS_OPTIONS = ['pending', 'confirmed', 'processing', 'packed', 'dispatched', 'delivered', 'cancelled', 'returned'];

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700',
  confirmed: 'bg-sky-50 text-sky-700',
  processing: 'bg-sky-50 text-sky-700',
  packed: 'bg-violet-50 text-violet-700',
  dispatched: 'bg-violet-50 text-violet-700',
  delivered: 'bg-mint-50 text-mint-700',
  cancelled: 'bg-primary-50 text-primary-700',
  returned: 'bg-primary-50 text-primary-700',
};

interface OrderRow {
  id: string;
  order_number: string;
  status: string;
  grand_total: number;
  placed_at: string;
  retailers: { shop_name: string } | null;
}

interface OrderFilters {
  q: string;
  status: string;
}

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/**
 * One batch of orders.
 *
 * Supabase/RLS behaviour is unchanged: this runs server-side with the caller's
 * session, so an admin sees every order and a scoped user still sees only the
 * rows their policies allow. Only the WINDOW changed — `?page=N` links became
 * an opaque cursor plus a `limit + 1` probe row.
 */
async function loadOrderBatch(
  supabase: SupabaseClient,
  filters: OrderFilters,
  cursor: ListCursor | null
) {
  let query = supabase
    .from('orders')
    .select('id, order_number, status, grand_total, placed_at, retailers ( shop_name )');

  if (filters.q) query = query.ilike('order_number', `%${filters.q}%`);
  if (filters.status) query = query.eq('status', filters.status);

  const { data, error } = await applyCursor(applyKeysetOrder(query, ORDER), cursor, ORDER, PAGE_SIZE);
  const rows = (data ?? []) as unknown as OrderRow[];
  return {
    ...toListBatch(rows, PAGE_SIZE, (row) => keysetCursorFor(row, ORDER)),
    // Without this flag a failed read is indistinguishable from "no orders":
    // the page would render the empty state and the pager would end the list
    // with "No more orders", both of which read as real business facts.
    failed: Boolean(error),
    failureMessage: error?.message ?? null,
  };
}

function renderOrderRows(rows: OrderRow[]) {
  return rows.map((o) => (
    <tr key={o.id}>
      <td className="px-5 py-3">
        <Link href={`/admin/orders/${o.id}`} className="font-mono text-xs font-medium text-ink-900 hover:text-primary-600">
          {o.order_number}
        </Link>
      </td>
      <td className="px-5 py-3 text-ink-600">{o.retailers?.shop_name ?? '—'}</td>
      <td className="px-5 py-3 font-medium text-ink-900">₹{o.grand_total.toFixed(2)}</td>
      <td className="px-5 py-3">
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[o.status]}`}>
          {o.status.charAt(0).toUpperCase() + o.status.slice(1)}
        </span>
      </td>
      <td className="px-5 py-3 text-ink-500">{formatIndiaDateTime(o.placed_at)}</td>
    </tr>
  ));
}

export default async function AdminOrdersPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const searchParams = await searchParamsPromise;
  const supabase = (await createClient());

  const filters: OrderFilters = {
    q: searchParams.q?.trim() ?? '',
    status: searchParams.status ?? '',
  };
  // `?page=` is dead. A deep link that still carries one starts at the top
  // instead of erroring or silently showing an empty slice.
  const firstBatch = await loadOrderBatch(supabase, filters, null);
  const orders = firstBatch.items;
  const hasFilters = Boolean(filters.q || filters.status);

  /**
   * Server Action for batches 2..n. `filters` rides along in React's encrypted
   * bound arguments, so the active search/status can never be swapped for
   * another retailer's data — and even if it could, RLS is still the last word.
   */
  async function loadMoreOrders(cursor: string | null): Promise<InfiniteScrollBatch> {
    'use server';
    const batch = await loadOrderBatch((await createClient()), filters, readCursor(cursor));
    if (batch.failed) {
      // Do not pretend the list ended normally: surface the failure so the
      // client shows its error row instead of "No more orders".
      throw new Error(`Could not load more orders: ${batch.failureMessage ?? 'unknown error'}`);
    }
    return { rows: renderOrderRows(batch.items), nextCursor: batch.nextCursor };
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Orders</h1>
        <p className="mt-1 text-sm text-ink-500">All retailer orders across the network.</p>
      </div>

      <Card>
        <form method="get" className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div className="relative sm:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <Input name="q" defaultValue={filters.q} placeholder="Search order number…" className="pl-9" />
          </div>
          <Select name="status" defaultValue={filters.status}>
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </Select>
          <div className="flex gap-2">
            <Button type="submit" variant="secondary" size="sm">
              Apply
            </Button>
            {hasFilters ? (
              <Link href="/admin/orders">
                <Button type="button" variant="ghost" size="sm">
                  Clear
                </Button>
              </Link>
            ) : null}
          </div>
        </form>
      </Card>

      {firstBatch.failed ? (
        <Card className="border-amber-200 bg-amber-50 p-5">
          <p className="text-sm font-semibold text-ink-900">Orders could not be loaded</p>
          <p className="mt-1 text-sm text-ink-600">
            The list is empty because the query failed, not because there are no orders. Retry, and if it
            keeps failing ask an engineer to check the project schema.
          </p>
          <p className="mt-2 font-mono text-xs text-ink-500">{firstBatch.failureMessage}</p>
        </Card>
      ) : orders.length === 0 ? (
        <AdminEmptyState
          icon={ShoppingCart}
          title={hasFilters ? 'No orders match your filters' : 'No orders yet'}
          body={hasFilters ? 'Try a different search or clear the filters above.' : 'Orders placed by retailers will appear here.'}
        />
      ) : (
        <InfiniteScrollProvider
          loader={loadMoreOrders}
          initialCursor={firstBatch.nextCursor}
          initialHasMore={Boolean(firstBatch.nextCursor)}
          resetKey={`${filters.q}|${filters.status}`}
        >
          <Card className="table-scroll p-0">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Order #</th>
                  <th className="px-5 py-3 font-medium">Retailer</th>
                  <th className="px-5 py-3 font-medium">Total</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Placed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                <InfiniteScrollRows skeleton={<InfiniteScrollTableSkeleton columns={5} />}>
                  {renderOrderRows(orders)}
                </InfiniteScrollRows>
              </tbody>
            </table>
          </Card>

          <InfiniteScrollStatus endLabel="No more orders" loadingLabel="Loading more orders…" />
        </InfiniteScrollProvider>
      )}
    </div>
  );
}
