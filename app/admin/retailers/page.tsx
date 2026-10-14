import { districtOptions, areasInDistrict, serviceAreaLabel } from '@/lib/areas/district';
import { Select } from '@/components/ui/select';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Users, Search } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { RetailerRowActions } from '@/components/admin/retailer-row-actions';
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

interface RetailerRow {
  id: string;
  shop_name: string;
  address: string | null;
  status: 'pending_approval' | 'active' | 'suspended';
  created_at: string;
  areas: { name: string; district: string } | null;
  profiles: { full_name: string; phone: string } | null;
  assignedSalesmanName: string | null;
}

interface RetailerBaseRow {
  id: string;
  shop_name: string;
  address: string | null;
  status: 'pending_approval' | 'active' | 'suspended';
  created_at: string;
  area_id: string;
  assigned_salesman_id: string | null;
}

const STATUS_STYLES: Record<RetailerRow['status'], string> = {
  pending_approval: 'bg-amber-50 text-amber-700',
  active: 'bg-green-50 text-green-700',
  suspended: 'bg-primary-50 text-primary-700',
};

const STATUS_LABELS: Record<RetailerRow['status'], string> = {
  pending_approval: 'Pending Approval',
  active: 'Active',
  suspended: 'Suspended',
};

/** Rows per batch. */
const BATCH_SIZE = 25;

/**
 * Newest first, `id` breaking ties so batches never overlap. `created_at` is
 * NOT NULL (0001_init.sql), so the keyset comparison is always defined.
 */
const ORDER: KeysetColumn[] = [
  { column: 'created_at', ascending: false },
  { column: 'id', ascending: false },
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
 * One batch of retailers.
 *
 * Deliberately NOT using PostgREST's embedded-resource syntax
 * (`areas ( name ), profiles ( full_name, phone )`) here. retailers.id
 * is itself a foreign key to profiles.id (a 1:1 "extends" relationship,
 * not a regular nullable FK column), and PostgREST resolves that as a
 * strict to-one join — if the embed can't resolve for a given row for
 * ANY reason, the whole retailer row is silently dropped from the
 * result instead of just coming back with a null profiles/areas field.
 * That's what caused "Total Retailers: 2" on the dashboard (a plain,
 * unjoined count against the same table) while this page showed none.
 * Fetching retailers, profiles, and areas as separate plain queries
 * and merging them in JS sidesteps that entirely, uses the exact same
 * RLS-respecting server client as everywhere else, and is guaranteed
 * to show every retailer row the admin's RLS policies allow them to
 * see — which the dashboard count already proves is correct.
 *
 * The merges are scoped to THIS batch (`.in(...)` over ≤ BATCH_SIZE + 1 ids),
 * so scrolling costs the same three queries regardless of list length.
 */
async function loadRetailerBatch(
  supabase: SupabaseClient,
  options: { q: string; pendingOnly: boolean; areaIds?: string[] },
  cursor: ListCursor | null
): Promise<{ items: RetailerRow[]; nextCursor: string | null }> {
  let query = supabase
    .from('retailers')
    .select('id, shop_name, address, status, created_at, area_id, assigned_salesman_id');

  query = options.pendingOnly ? query.eq('status', 'pending_approval') : query.neq('status', 'pending_approval');

  if (options.areaIds) {
    if (!options.areaIds.length) return { items: [], nextCursor: null };
    query = query.in('area_id', options.areaIds);
  }

  const term = sanitizeTerm(options.q);
  if (term) {
    // Shop name lives on `retailers`, but the owner's name, their phone and
    // their salesman's name live on `profiles`. A bounded lookup turns those
    // into an id list, so the whole search narrows the DB result instead of
    // downloading every retailer and filtering in the browser.
    const { data: profileRows } = await supabase
      .from('profiles')
      .select('id')
      .or(`full_name.ilike.*${term}*,phone.ilike.*${term}*`)
      .limit(500);
    const ids = ((profileRows ?? []) as unknown as { id: string }[]).map((profile) => profile.id);
    const clauses = [`shop_name.ilike.*${term}*`];
    if (ids.length > 0) {
      clauses.push(`id.in.(${ids.join(',')})`, `assigned_salesman_id.in.(${ids.join(',')})`);
    }
    query = query.or(clauses.join(','));
  }

  const { data: retailerRows } = await applyCursor(applyKeysetOrder(query, ORDER), cursor, ORDER, BATCH_SIZE);
  const baseRows = (retailerRows ?? []) as unknown as RetailerBaseRow[];

  const retailerIds = baseRows.map((r) => r.id);
  const profileIds = [
    ...new Set([...retailerIds, ...baseRows.flatMap((r) => (r.assigned_salesman_id ? [r.assigned_salesman_id] : []))]),
  ];
  const areaIds = [...new Set(baseRows.map((r) => r.area_id))];

  const [{ data: profileRows }, { data: areaRows }] = await Promise.all([
    profileIds.length > 0
      ? supabase.from('profiles').select('id, full_name, phone').in('id', profileIds)
      : Promise.resolve({ data: [] as unknown[] }),
    areaIds.length > 0
      ? supabase.from('areas').select('id, name, district').in('id', areaIds)
      : Promise.resolve({ data: [] as unknown[] }),
  ]);

  const profileById = new Map(
    ((profileRows ?? []) as unknown as { id: string; full_name: string; phone: string }[]).map((p) => [p.id, p])
  );
  const areaById = new Map(((areaRows ?? []) as unknown as { id: string; name: string; district: string }[]).map((a) => [a.id, a]));

  const batch = toListBatch(baseRows, BATCH_SIZE, (row) => keysetCursorFor(row, ORDER));
  return {
    items: batch.items.map((r) => ({
      id: r.id,
      shop_name: r.shop_name,
      address: r.address,
      status: r.status,
      created_at: r.created_at,
      areas: areaById.get(r.area_id) ?? null,
      profiles: profileById.get(r.id)
        ? { full_name: profileById.get(r.id)!.full_name, phone: profileById.get(r.id)!.phone }
        : null,
      assignedSalesmanName: r.assigned_salesman_id
        ? profileById.get(r.assigned_salesman_id)?.full_name ?? null
        : null,
    })),
    nextCursor: batch.nextCursor,
  };
}

function renderRetailerRows(retailers: RetailerRow[]) {
  return retailers.map((r) => (
    <tr key={r.id}>
      <td className="px-5 py-3">
        <Link href={`/admin/retailers/${r.id}`} className="font-medium text-ink-900 hover:text-primary-600">
          {r.shop_name}
        </Link>
        {r.address ? <p className="text-xs text-ink-400">{r.address}</p> : null}
      </td>
      <td className="px-5 py-3 text-ink-600">
        {r.profiles?.full_name ?? '—'}
        {r.profiles?.phone ? <p className="text-xs text-ink-400">{r.profiles.phone}</p> : null}
      </td>
      <td className="px-5 py-3 text-ink-600">{r.areas ? serviceAreaLabel(r.areas) : '—'}</td>
      <td className="px-5 py-3 text-ink-600">{r.assignedSalesmanName ?? 'Unassigned'}</td>
      <td className="px-5 py-3">
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[r.status]}`}>
          {STATUS_LABELS[r.status]}
        </span>
      </td>
      <td className="px-5 py-3 text-right">
        <RetailerRowActions retailerId={r.id} status={r.status} />
      </td>
    </tr>
  ));
}

function RetailerTableShell({ children }: { children: ReactNode }) {
  return (
    <Card className="table-scroll p-0">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
          <tr>
            <th className="px-5 py-3 font-medium">Shop</th>
            <th className="px-5 py-3 font-medium">Owner</th>
            <th className="px-5 py-3 font-medium">Area / district</th>
            <th className="px-5 py-3 font-medium">Salesman</th>
            <th className="px-5 py-3 font-medium">Status</th>
            <th className="px-5 py-3 font-medium" />
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
          <InfiniteScrollRows skeleton={<InfiniteScrollTableSkeleton columns={6} />}>{children}</InfiniteScrollRows>
        </tbody>
      </table>
    </Card>
  );
}

export default async function RetailersPage({ searchParams }: { searchParams: { q?: string; district?: string } }) {
  const supabase = createClient();
  const q = searchParams.q?.trim() ?? '';
  const district = searchParams.district ?? '';
  const { data: directory, error: directoryError } = await supabase.from('areas').select('id, district').order('district').returns<{ id: string; district: string }[]>();
  if (directoryError) throw new Error('Service district directory could not be loaded.');
  const districts = districtOptions(directory ?? []);
  const areaIds = district ? areasInDistrict(directory ?? [], district).map((area) => area.id) : undefined;


  const [pending, others, { count: pendingCount }] = await Promise.all([
    loadRetailerBatch(supabase, { q, areaIds, pendingOnly: true }, null),
    loadRetailerBatch(supabase, { q, areaIds, pendingOnly: false }, null),
    supabase
      .from('retailers')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending_approval'),
  ]);

  /**
   * Server Action for the batches after the first. The search term is captured
   * by the closure and re-sent encrypted with each call, and the query itself
   * still runs through the caller's own RLS-scoped client.
   */
  async function loadMorePending(cursor: string | null): Promise<InfiniteScrollBatch> {
    'use server';
    const batch = await loadRetailerBatch(createClient(), { q, areaIds, pendingOnly: true }, readCursor(cursor));
    return { rows: renderRetailerRows(batch.items), nextCursor: batch.nextCursor };
  }

  /** Server Action for the "All Retailers" batches after the first. */
  async function loadMoreOthers(cursor: string | null): Promise<InfiniteScrollBatch> {
    'use server';
    const batch = await loadRetailerBatch(createClient(), { q, areaIds, pendingOnly: false }, readCursor(cursor));
    return { rows: renderRetailerRows(batch.items), nextCursor: batch.nextCursor };
  }

  const isEmpty = pending.items.length === 0 && others.items.length === 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Retailers</h1>
        <p className="mt-1 text-sm text-ink-500">
          New retailer registrations must be approved here before they can place orders.
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-2xl border border-ink-100 bg-white p-4">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <Input aria-label="Search retailers" name="q" defaultValue={q} placeholder="Search shop, owner, or phone…" className="pl-9" />
        </div>
        <label className="min-w-0 flex-1 text-xs font-medium text-ink-600 sm:max-w-xs">
          Service district
          <Select name="district" defaultValue={district} className="mt-1">
            <option value="">All districts</option>
            {district && !districts.includes(district) ? <option value={district}>{district} (not configured)</option> : null}
            {districts.map((name) => <option key={name} value={name}>{name}</option>)}
          </Select>
        </label>
        <Link href="/admin/retailers" className="inline-flex min-h-11 items-center text-sm text-ink-600 underline">Clear filters</Link>
        <Button type="submit" variant="outline" size="sm">
          Search
        </Button>
      </form>

      {isEmpty ? (
        <AdminEmptyState
          icon={Users}
          title={q || district ? 'No retailers match your search' : 'No retailer registrations yet'}
          body={
            q || district
              ? 'Try a different name or phone number, or clear the search box above.'
              : "Once retailers sign up at /register-retailer, they'll appear here awaiting your approval."
          }
        />
      ) : (
        <>
          {pending.items.length > 0 ? (
            <InfiniteScrollProvider
              loader={loadMorePending}
              initialCursor={pending.nextCursor}
              initialHasMore={Boolean(pending.nextCursor)}
              resetKey={`pending|${q}|${district}`}
            >
              <div>
                <h2 className="mb-3 text-sm font-semibold text-ink-800">
                  Pending Approval <span className="text-primary-600">{q || district ? '— filtered results' : `(${pendingCount ?? pending.items.length})`}</span>
                </h2>
                <RetailerTableShell>{renderRetailerRows(pending.items)}</RetailerTableShell>
              </div>
              <InfiniteScrollStatus endLabel="No more pending retailers" loadingLabel="Loading more…" />
            </InfiniteScrollProvider>
          ) : null}

          {others.items.length > 0 ? (
            <InfiniteScrollProvider
              loader={loadMoreOthers}
              initialCursor={others.nextCursor}
              initialHasMore={Boolean(others.nextCursor)}
              resetKey={`others|${q}|${district}`}
            >
              <div>
                <h2 className="mb-3 mt-8 text-sm font-semibold text-ink-800">All Retailers</h2>
                <RetailerTableShell>{renderRetailerRows(others.items)}</RetailerTableShell>
              </div>
              <InfiniteScrollStatus endLabel="No more retailers" loadingLabel="Loading more…" />
            </InfiniteScrollProvider>
          ) : null}
        </>
      )}
    </div>
  );
}
