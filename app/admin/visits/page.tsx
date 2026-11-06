import { Footprints } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { formatIndiaTime, indiaDayEndIso, indiaDayStartIso, indiaTodayDateKey } from '@/lib/datetime/india';
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

const STATUS_STYLES: Record<string, string> = {
  planned: 'bg-ink-100 text-ink-600',
  checked_in: 'bg-sky-50 text-sky-700',
  checked_out: 'bg-mint-50 text-mint-700',
  skipped: 'bg-primary-50 text-primary-700',
};

/** Rows per batch. */
const BATCH_SIZE = 30;

/**
 * Newest first, `id` breaking ties. `visits.created_at` is NOT NULL
 * (0001_init.sql), so the keyset comparison is always defined.
 */
const ORDER: KeysetColumn[] = [
  { column: 'created_at', ascending: false },
  { column: 'id', ascending: false },
];

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

interface VisitRow {
  id: string;
  status: string;
  check_in_at: string | null;
  check_out_at: string | null;
  notes: string | null;
  profiles: { full_name: string } | null;
  retailers: { shop_name: string } | null;
  orders: { order_number: string } | null;
}

/**
 * One batch of visits for the selected day.
 *
 * The date range and status filter stay in the WHERE clause, so a day with
 * hundreds of visits still costs one bounded query per scroll step instead of
 * one query for the whole day.
 */
async function loadVisitBatch(
  supabase: SupabaseClient,
  filters: { status: string; date: string },
  cursor: ListCursor | null
): Promise<{ items: VisitRow[]; nextCursor: string | null }> {
  let query = supabase
    .from('visits')
    .select('id, status, check_in_at, check_out_at, notes, profiles ( full_name ), retailers ( shop_name ), orders ( order_number )')
    .gte('created_at', indiaDayStartIso(filters.date)!)
    .lte('created_at', indiaDayEndIso(filters.date)!);

  if (filters.status) query = query.eq('status', filters.status);

  const { data } = await applyCursor(applyKeysetOrder(query, ORDER), cursor, ORDER, BATCH_SIZE);
  const rows = (data ?? []) as unknown as VisitRow[];
  const batch = toListBatch(rows, BATCH_SIZE, (row) => keysetCursorFor(row, ORDER));
  return { items: batch.items, nextCursor: batch.nextCursor };
}

function renderVisitRows(visits: VisitRow[]) {
  return visits.map((v) => (
    <tr key={v.id}>
      <td className="px-5 py-3 font-medium text-ink-900">{v.profiles?.full_name ?? '—'}</td>
      <td className="px-5 py-3 text-ink-600">{v.retailers?.shop_name ?? '—'}</td>
      <td className="px-5 py-3">
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[v.status]}`}>
          {v.status.replace('_', ' ')}
        </span>
      </td>
      <td className="px-5 py-3 text-ink-500">{v.check_in_at ? formatIndiaTime(v.check_in_at) : '—'}</td>
      <td className="px-5 py-3 text-ink-500">{v.check_out_at ? formatIndiaTime(v.check_out_at) : '—'}</td>
      <td className="px-5 py-3">
        {v.orders ? (
          <span className="font-mono text-xs text-primary-600">{v.orders.order_number}</span>
        ) : (
          <span className="text-xs text-ink-300">No order</span>
        )}
      </td>
    </tr>
  ));
}

export default async function AdminVisitsPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<{ status?: string; date?: string }>;
}) {
  const searchParams = await searchParamsPromise;
  const supabase = (await createClient());
  const status = searchParams.status ?? '';
  const date = searchParams.date || indiaTodayDateKey();

  const filters = { status, date };
  const firstBatch = await loadVisitBatch(supabase, filters, null);
  const visits = firstBatch.items;

  /** Server Action for the batches after the first; the filters are captured. */
  async function loadMoreVisits(cursor: string | null): Promise<InfiniteScrollBatch> {
    'use server';
    const batch = await loadVisitBatch((await createClient()), filters, readCursor(cursor));
    return { rows: renderVisitRows(batch.items), nextCursor: batch.nextCursor };
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Visits</h1>
        <p className="mt-1 text-sm text-ink-500">Retailer visits logged by your salesmen.</p>
      </div>

      <Card>
        <form method="get" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <input
            name="date"
            type="date"
            defaultValue={date}
            max={indiaTodayDateKey()}
            className="h-11 rounded-xl border border-ink-200 bg-white px-3.5 text-sm text-ink-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary-600"
          />
          <Select name="status" defaultValue={status}>
            <option value="">All statuses</option>
            <option value="planned">Planned</option>
            <option value="checked_in">Checked in</option>
            <option value="checked_out">Checked out</option>
            <option value="skipped">Skipped</option>
          </Select>
          <Button type="submit" size="sm" variant="secondary">
            Apply
          </Button>
        </form>
      </Card>

      {visits.length === 0 ? (
        <AdminEmptyState
          icon={Footprints}
          title="No visits for this date"
          body="Retailer visits your salesmen log on their routes will appear here."
        />
      ) : (
        <InfiniteScrollProvider
          loader={loadMoreVisits}
          initialCursor={firstBatch.nextCursor}
          initialHasMore={Boolean(firstBatch.nextCursor)}
          resetKey={`${status}|${date}`}
        >
          <Card className="table-scroll p-0">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Salesman</th>
                  <th className="px-5 py-3 font-medium">Retailer</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Check-in</th>
                  <th className="px-5 py-3 font-medium">Check-out</th>
                  <th className="px-5 py-3 font-medium">Order</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                <InfiniteScrollRows skeleton={<InfiniteScrollTableSkeleton columns={6} />}>
                  {renderVisitRows(visits)}
                </InfiniteScrollRows>
              </tbody>
            </table>
          </Card>

          <InfiniteScrollStatus endLabel="No more visits" loadingLabel="Loading more…" />
        </InfiniteScrollProvider>
      )}
    </div>
  );
}
