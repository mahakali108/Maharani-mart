import { Users } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  InfiniteScrollProvider,
  InfiniteScrollRows,
  InfiniteScrollStatus,
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

const STATUS_STYLES: Record<string, string> = {
  planned: 'bg-ink-100 text-ink-600',
  checked_in: 'bg-sky-50 text-sky-700',
  checked_out: 'bg-mint-50 text-mint-700',
  skipped: 'bg-amber-50 text-amber-700',
};

interface VisitRow {
  id: string;
  status: string;
  check_in_at: string | null;
  check_out_at: string | null;
  notes: string | null;
  created_at: string;
  retailers: { shop_name: string; address: string | null } | null;
}

/** Rows per batch. */
const PAGE_SIZE = 20;

/** Newest first, `id` breaking ties so batches never overlap. */
const ORDER: KeysetColumn[] = [
  { column: 'created_at', ascending: false },
  { column: 'id', ascending: false },
];

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/** One batch of this salesman's visits (RLS also scopes this to the caller). */
async function loadVisitBatch(supabase: SupabaseClient, salesmanId: string, cursor: ListCursor | null) {
  const { data } = await applyCursor(
    applyKeysetOrder(
      supabase
        .from('visits')
        .select('id, status, check_in_at, check_out_at, notes, created_at, retailers ( shop_name, address )')
        .eq('salesman_id', salesmanId),
      ORDER
    ),
    cursor,
    ORDER,
    PAGE_SIZE
  );
  const rows = (data ?? []) as unknown as VisitRow[];
  return toListBatch(rows, PAGE_SIZE, (row) => keysetCursorFor(row, ORDER));
}

function renderVisitRows(rows: VisitRow[]) {
  return rows.map((v) => (
    <Card key={v.id} className="p-4">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words font-medium text-ink-900">{v.retailers?.shop_name ?? 'Unknown retailer'}</p>
          {v.retailers?.address ? <p className="break-words text-xs text-ink-400">{v.retailers.address}</p> : null}
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[v.status]}`}>
          {v.status.replace('_', ' ')}
        </span>
      </div>
      <div className="mt-2 flex gap-4 text-xs text-ink-400">
        {v.check_in_at ? <span>In: {formatIndiaDateTime(v.check_in_at)}</span> : null}
        {v.check_out_at ? <span>Out: {formatIndiaDateTime(v.check_out_at)}</span> : null}
      </div>
      {v.notes ? <p className="mt-2 text-sm text-ink-600">{v.notes}</p> : null}
    </Card>
  ));
}

export default async function SalesmanVisitsPage() {
  const user = await requireUser();
  const supabase = (await createClient());

  const firstBatch = await loadVisitBatch(supabase, user.id, null);
  const visits = firstBatch.items;

  /** Server Action for batches 2..n; the salesman id is re-derived server-side. */
  async function loadMoreVisits(cursor: string | null): Promise<InfiniteScrollBatch> {
    'use server';
    const caller = await requireUser();
    const batch = await loadVisitBatch((await createClient()), caller.id, readCursor(cursor));
    return { rows: renderVisitRows(batch.items), nextCursor: batch.nextCursor };
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-ink-950">Visit History</h1>
        <p className="mt-1 text-sm text-ink-500">Every retailer visit you&apos;ve logged, most recent first.</p>
      </div>

      {visits.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 py-12 text-center">
          <Users className="h-8 w-8 text-ink-300" />
          <p className="font-medium text-ink-700">No visits logged yet</p>
          <p className="text-sm text-ink-400">Check in to a retailer from your Routes tab to log your first visit.</p>
        </Card>
      ) : (
        <InfiniteScrollProvider
          loader={loadMoreVisits}
          initialCursor={firstBatch.nextCursor}
          initialHasMore={Boolean(firstBatch.nextCursor)}
        >
          <div className="space-y-2">
            <InfiniteScrollRows
              skeleton={
                <>
                  {[0, 1, 2].map((index) => (
                    <Card key={index} className="space-y-2 p-4" aria-hidden="true">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-3 w-56" />
                      <Skeleton className="h-3 w-32" />
                    </Card>
                  ))}
                </>
              }
            >
              {renderVisitRows(visits)}
            </InfiniteScrollRows>
          </div>

          <InfiniteScrollStatus endLabel="No more visits" loadingLabel="Loading more…" />
        </InfiniteScrollProvider>
      )}
    </div>
  );
}
