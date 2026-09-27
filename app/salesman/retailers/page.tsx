import Link from 'next/link';
import { Search, Store } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
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

interface RetailerRow {
  id: string;
  shop_name: string;
  address: string | null;
  area_id: string;
  status: 'pending_approval' | 'active' | 'suspended';
  credit_limit: number;
  outstanding_balance: number;
}

interface RecentOrderRow {
  id: string;
  retailer_id: string;
  order_number: string;
  status: string;
  grand_total: number;
  placed_at: string;
}

interface RetailerCard extends RetailerRow {
  areaName: string | null;
  ownerName: string | null;
  phone: string | null;
  recentOrder: RecentOrderRow | null;
}

const STATUS_STYLES: Record<RetailerRow['status'], string> = {
  pending_approval: 'bg-amber-50 text-amber-700',
  active: 'bg-green-50 text-green-700',
  suspended: 'bg-primary-50 text-primary-700',
};

/** Cards per batch. */
const BATCH_SIZE = 24;

/**
 * Alphabetical by shop name, `id` breaking ties. `shop_name` is NOT NULL
 * (0001_init.sql) and `id` is the primary key, so the keyset cursor is always
 * comparable and two batches can never overlap.
 */
const ORDER: KeysetColumn[] = [
  { column: 'shop_name', ascending: true },
  { column: 'id', ascending: true },
];

type SupabaseClient = ReturnType<typeof createClient>;

/**
 * Strip the characters that could change the shape of a PostgREST `or=()`
 * filter, then cap the length so a search box can never build a huge
 * predicate. The search term is user input and lands inside a quoted literal.
 */
function sanitizeTerm(raw: string): string {
  return raw.replace(/[%,()*"'\\]/g, ' ').trim().slice(0, 60);
}

/**
 * One batch of the salesman's assigned retailers.
 *
 * Keep retailers/profiles/areas as separate queries, matching the
 * proven-safe admin retailer implementation. The shared-primary-key
 * profiles relationship is intentionally not embedded through PostgREST.
 * Every merge is scoped to THIS batch (`.in()` over ≤ BATCH_SIZE + 1 ids), so
 * a scroll step costs the same four queries no matter how many retailers are
 * assigned. The search narrows the DB result instead of pulling every
 * assigned retailer and filtering in the browser.
 */
async function loadRetailerBatch(
  supabase: SupabaseClient,
  options: { salesmanId: string; q: string },
  cursor: ListCursor | null
): Promise<{ items: RetailerCard[]; nextCursor: string | null }> {
  let query = supabase
    .from('retailers')
    .select('id, shop_name, address, area_id, status, credit_limit, outstanding_balance')
    .eq('assigned_salesman_id', options.salesmanId);

  const term = sanitizeTerm(options.q);
  if (term) {
    const [{ data: profileData }, { data: areaData }] = await Promise.all([
      supabase.from('profiles').select('id').or(`full_name.ilike.*${term}*,phone.ilike.*${term}*`).limit(500),
      supabase.from('areas').select('id').ilike('name', `*${term}*`).limit(200),
    ]);
    const clauses = [`shop_name.ilike.*${term}*`];
    const profileIds = ((profileData ?? []) as unknown as { id: string }[]).map((profile) => profile.id);
    const areaIds = ((areaData ?? []) as unknown as { id: string }[]).map((area) => area.id);
    if (profileIds.length > 0) clauses.push(`id.in.(${profileIds.join(',')})`);
    if (areaIds.length > 0) clauses.push(`area_id.in.(${areaIds.join(',')})`);
    query = query.or(clauses.join(','));
  }

  const { data: retailerData } = await applyCursor(applyKeysetOrder(query, ORDER), cursor, ORDER, BATCH_SIZE);
  const retailers = (retailerData ?? []) as unknown as RetailerRow[];
  const retailerIds = retailers.map((retailer) => retailer.id);
  const areaIds = [...new Set(retailers.map((retailer) => retailer.area_id))];

  const [{ data: profileRows }, { data: areaRows }, { data: orderRows }] = await Promise.all([
    retailerIds.length
      ? supabase.from('profiles').select('id, full_name, phone').in('id', retailerIds)
      : Promise.resolve({ data: [] as unknown[] }),
    areaIds.length
      ? supabase.from('areas').select('id, name').in('id', areaIds)
      : Promise.resolve({ data: [] as unknown[] }),
    retailerIds.length
      ? supabase
          .from('orders')
          .select('id, retailer_id, order_number, status, grand_total, placed_at')
          .in('retailer_id', retailerIds)
          .order('placed_at', { ascending: false })
      : Promise.resolve({ data: [] as unknown[] }),
  ]);

  const profileById = new Map(
    ((profileRows ?? []) as unknown as { id: string; full_name: string; phone: string }[]).map((profile) => [profile.id, profile])
  );
  const areaById = new Map(
    ((areaRows ?? []) as unknown as { id: string; name: string }[]).map((area) => [area.id, area.name])
  );
  const recentOrderByRetailer = new Map<string, RecentOrderRow>();
  for (const order of (orderRows ?? []) as unknown as RecentOrderRow[]) {
    // The query is newest-first, so the first row retained per retailer
    // is that retailer's latest authorized order.
    if (!recentOrderByRetailer.has(order.retailer_id)) {
      recentOrderByRetailer.set(order.retailer_id, order);
    }
  }

  const batch = toListBatch(retailers, BATCH_SIZE, (row) => keysetCursorFor(row, ORDER));
  return {
    items: batch.items.map((retailer) => ({
      ...retailer,
      areaName: areaById.get(retailer.area_id) ?? null,
      ownerName: profileById.get(retailer.id)?.full_name ?? null,
      phone: profileById.get(retailer.id)?.phone ?? null,
      recentOrder: recentOrderByRetailer.get(retailer.id) ?? null,
    })),
    nextCursor: batch.nextCursor,
  };
}

function renderRetailerCards(cards: RetailerCard[]) {
  return cards.map((retailer) => (
    <Link key={retailer.id} href={`/salesman/retailers/${retailer.id}`} className="block">
      <Card className="h-full p-4 transition-colors hover:border-primary-200">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-medium text-ink-900">{retailer.shop_name}</p>
            <p className="text-xs text-ink-500">{retailer.ownerName ?? 'Owner name unavailable'}</p>
          </div>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${STATUS_STYLES[retailer.status]}`}>
            {retailer.status.replace('_', ' ')}
          </span>
        </div>
        <div className="mt-3 space-y-1 text-xs text-ink-400">
          <p>{retailer.phone ?? 'Phone unavailable'}</p>
          <p>{retailer.areaName ?? 'Area unavailable'}</p>
          {retailer.address ? <p className="line-clamp-2">{retailer.address}</p> : null}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-ink-100 pt-3">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wide text-ink-400">Credit limit</p>
            <p className="break-words text-xs font-medium text-ink-800">
              {retailer.credit_limit > 0 ? `₹${retailer.credit_limit.toFixed(2)}` : 'Not set'}
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wide text-ink-400">Outstanding</p>
            <p className="break-words text-xs font-medium text-ink-800">₹{retailer.outstanding_balance.toFixed(2)}</p>
          </div>
        </div>

        {retailer.recentOrder ? (
          <div className="mt-3 border-t border-ink-100 pt-3 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono font-medium text-ink-700">{retailer.recentOrder.order_number}</span>
              <span className="font-semibold text-ink-900">₹{retailer.recentOrder.grand_total.toFixed(2)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-ink-400">
              <span>{formatIndiaDateTime(retailer.recentOrder.placed_at)}</span>
              <span className="capitalize">{retailer.recentOrder.status}</span>
            </div>
          </div>
        ) : (
          <p className="mt-3 border-t border-ink-100 pt-3 text-xs text-ink-400">No orders yet</p>
        )}
      </Card>
    </Link>
  ));
}

function CardSkeleton() {
  return (
    <>
      {[0, 1, 2].map((row) => (
        <div key={`skeleton-${row}`} aria-hidden="true" className="rounded-2xl border border-ink-100 bg-white p-4">
          <div className="space-y-2">
            <span className="block h-3 w-32 animate-pulse rounded bg-ink-100" />
            <span className="block h-3 w-24 animate-pulse rounded bg-ink-100" />
            <span className="block h-3 w-40 animate-pulse rounded bg-ink-100" />
          </div>
        </div>
      ))}
    </>
  );
}

export default async function SalesmanRetailersPage({ searchParams }: { searchParams: { q?: string } }) {
  const user = await requireUser();
  const supabase = createClient();
  const q = searchParams.q?.trim().toLowerCase() ?? '';

  const firstBatch = await loadRetailerBatch(supabase, { salesmanId: user.id, q }, null);
  const cards = firstBatch.items;

  /**
   * Server Action for the batches after the first. The salesman id is
   * re-derived from the session, never trusted from the cursor, so one
   * salesman can never page through another's retailers.
   */
  async function loadMoreRetailers(cursor: string | null): Promise<InfiniteScrollBatch> {
    'use server';
    const caller = await requireUser();
    const batch = await loadRetailerBatch(createClient(), { salesmanId: caller.id, q }, readCursor(cursor));
    return { rows: renderRetailerCards(batch.items), nextCursor: batch.nextCursor };
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-ink-950">My Retailers</h1>
        <p className="mt-1 text-sm text-ink-500">Only retailers currently assigned to you are shown.</p>
      </div>

      <form method="get" className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <Input name="q" defaultValue={searchParams.q ?? ''} placeholder="Search shop, owner, phone, or area" className="pl-9" />
        </div>
        <Button type="submit" size="sm" variant="outline">Search</Button>
      </form>

      {cards.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 py-12 text-center">
          <Store className="h-8 w-8 text-ink-300" />
          <p className="font-medium text-ink-700">{q ? 'No assigned retailers match' : 'No retailers assigned yet'}</p>
          <p className="text-sm text-ink-400">{q ? 'Try a different search.' : 'Your admin can assign retailers from the retailer details screen.'}</p>
        </Card>
      ) : (
        <InfiniteScrollProvider
          loader={loadMoreRetailers}
          initialCursor={firstBatch.nextCursor}
          initialHasMore={Boolean(firstBatch.nextCursor)}
          resetKey={q}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <InfiniteScrollRows skeleton={<CardSkeleton />}>{renderRetailerCards(cards)}</InfiniteScrollRows>
          </div>

          <InfiniteScrollStatus endLabel="No more retailers" loadingLabel="Loading more…" />
        </InfiniteScrollProvider>
      )}
    </div>
  );
}
