import { BadgeIndianRupee } from 'lucide-react';
import { requirePermission, requirePagePermission } from '@/lib/admin/guard';
import { createClient } from '@/lib/supabase/server';
import { RecordCollectionForm } from '@/components/salesman/record-collection-form';
import { AdminEmptyState } from '@/components/admin/empty-state';
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

/** Rows per batch. */
const PAGE_SIZE = 20;

/** Newest first, `id` breaking ties so batches never overlap. */
const ORDER: KeysetColumn[] = [
  { column: 'created_at', ascending: false },
  { column: 'id', ascending: false },
];

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700',
  verified: 'bg-mint-50 text-mint-700',
  rejected: 'bg-primary-50 text-primary-700',
};

const METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
  upi: 'UPI',
  cheque: 'Cheque',
  other: 'Other',
};

interface CollectionRow {
  id: string;
  amount_paise: number;
  method: string;
  reference_number: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  verified_at: string | null;
  retailers: { shop_name: string } | null;
}

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/**
 * One batch of MY collection history. RLS already scopes
 * `payment_collections` to the caller; the explicit `collected_by` filter is
 * the same belt-and-braces the old paged query used.
 */
async function loadCollectionBatch(
  supabase: SupabaseClient,
  salesmanId: string,
  cursor: ListCursor | null
) {
  const { data, error } = await applyCursor(
    applyKeysetOrder(
      supabase
        .from('payment_collections')
        .select('id, amount_paise, method, reference_number, status, notes, created_at, verified_at, retailers ( shop_name )')
        .eq('collected_by', salesmanId),
      ORDER
    ),
    cursor,
    ORDER,
    PAGE_SIZE
  );
  // A salesman's own collection history is money evidence: a failed read must
  // never render as "No collections recorded yet".
  if (error) throw new Error(`Collections could not be loaded [${error.code ?? 'unknown'}]: ${error.message}`);
  const rows = (data ?? []) as unknown as CollectionRow[];
  return toListBatch(rows, PAGE_SIZE, (row) => keysetCursorFor(row, ORDER));
}

function renderCollectionRows(rows: CollectionRow[]) {
  return rows.map((row) => (
    <Card key={row.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink-950">
          ₹{(row.amount_paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
          <span className="ml-2 rounded-full bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-600">
            {METHOD_LABELS[row.method] ?? row.method}
          </span>
        </p>
        <p className="truncate text-xs text-ink-500">
          {row.retailers?.shop_name ?? '—'}
          {row.reference_number ? ` · ref ${row.reference_number}` : ''}
        </p>
        <p className="text-xs text-ink-400">{formatIndiaDateTime(row.created_at)}</p>
        {row.notes ? <p className="text-xs text-ink-400">{row.notes}</p> : null}
      </div>
      <span
        className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[row.status] ?? 'bg-ink-100 text-ink-600'}`}
      >
        {row.status === 'verified' ? 'Verified — coins added' : row.status.charAt(0).toUpperCase() + row.status.slice(1)}
      </span>
    </Card>
  ));
}

export default async function SalesmanCollectionsPage() {
  const user = await requirePagePermission('collections.record');
  const supabase = (await createClient());

  // My assigned retailers for the entry form.
  const { data: retailerRows } = await supabase
    .from('retailers')
    .select('id, shop_name')
    .eq('assigned_salesman_id', user.id)
    .order('shop_name');
  const retailers = (retailerRows ?? []) as { id: string; shop_name: string }[];

  const firstBatch = await loadCollectionBatch(supabase, user.id, null);
  const rows = firstBatch.items;

  /** Server Action for batches 2..n; the permission is re-checked here. */
  async function loadMoreCollections(cursor: string | null): Promise<InfiniteScrollBatch> {
    'use server';
    const caller = await requirePermission('collections.record');
    const batch = await loadCollectionBatch((await createClient()), caller.id, readCursor(cursor));
    return { rows: renderCollectionRows(batch.items), nextCursor: batch.nextCursor };
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Collections</h1>
        <p className="mt-1 text-sm text-ink-500">
          Record money you collect in the field. The office verifies it before the coins are added to the shop.
        </p>
      </div>

      {user.role === 'salesman' ? <RecordCollectionForm retailers={retailers.map((r) => ({ id: r.id, shopName: r.shop_name }))} /> : null}

      {rows.length === 0 ? (
        <AdminEmptyState
          icon={BadgeIndianRupee}
          title="No collections recorded yet"
          body="Every collection you submit for verification appears here with its status."
        />
      ) : (
        <InfiniteScrollProvider
          loader={loadMoreCollections}
          initialCursor={firstBatch.nextCursor}
          initialHasMore={Boolean(firstBatch.nextCursor)}
        >
          <div className="space-y-3">
            <InfiniteScrollRows
              skeleton={
                <>
                  {[0, 1, 2].map((index) => (
                    <Card key={index} className="space-y-2 p-4" aria-hidden="true">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3 w-48" />
                      <Skeleton className="h-3 w-24" />
                    </Card>
                  ))}
                </>
              }
            >
              {renderCollectionRows(rows)}
            </InfiniteScrollRows>
          </div>

          <InfiniteScrollStatus endLabel="No more collections" loadingLabel="Loading more…" />
        </InfiniteScrollProvider>
      )}
    </div>
  );
}
