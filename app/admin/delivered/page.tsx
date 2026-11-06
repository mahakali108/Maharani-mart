import Link from 'next/link';
import { Download, PackageCheck, Search, ShieldAlert } from 'lucide-react';
import { requirePermission, requirePagePermission } from '@/lib/admin/guard';
import { createClient } from '@/lib/supabase/server';
import { DeliveryStatusBadge } from '@/components/delivery/delivery-status-badge';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import {
  InfiniteScrollProvider,
  InfiniteScrollRows,
  InfiniteScrollStatus,
  InfiniteScrollTableSkeleton,
  type InfiniteScrollBatch,
} from '@/components/ui/infinite-scroll';
import { formatIndiaDateTime } from '@/lib/datetime/india';
import { applyCursor, cursorOffset, readCursor, toOffsetBatch } from '@/lib/infinite-scroll/keyset';

/** Rows per batch. */
const PAGE_SIZE = 20;

const COMPLETED_STATUSES = ['delivered', 'partially_delivered', 'returned_to_warehouse'];

interface DeliveredRow {
  order_id: string;
  delivery_status: string;
  delivered_at: string | null;
  receiver_name: string | null;
  otp_verified_at: string | null;
  signature_url: string | null;
  photo_url: string | null;
  assigned_name: { full_name: string } | null;
  orders: {
    order_number: string;
    grand_total: number;
    retailers: { shop_name: string } | null;
  } | null;
}

interface DeliveredFilters {
  q: string;
  outcome: string;
  staff: string;
  from: string;
  to: string;
}

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/**
 * One batch of completed deliveries.
 *
 * `delivered_at` is nullable, so this list uses an OFFSET cursor rather than a
 * keyset one: a NULL cannot be compared with "after this row". The ORDER BY
 * still ends in a unique tiebreaker (`order_id`), so batches are deterministic
 * and never overlap, and the cursor stays opaque and server-side.
 */
async function loadDeliveredBatch(
  supabase: SupabaseClient,
  filters: DeliveredFilters,
  cursor: ReturnType<typeof readCursor>
) {
  const offset = cursorOffset(cursor);

  let query = supabase
    .from('order_deliveries')
    .select(
      `order_id, delivery_status, delivered_at, receiver_name, otp_verified_at, signature_url, photo_url,
       assigned_name:profiles!order_deliveries_assigned_staff_id_fkey ( full_name ),
       orders!inner ( order_number, grand_total, retailers ( shop_name ) )`
    )
    .in('delivery_status', COMPLETED_STATUSES)
    .order('delivered_at', { ascending: false, nullsFirst: false })
    .order('order_id', { ascending: false });

  if (filters.outcome) query = query.eq('delivery_status', filters.outcome);
  if (filters.staff) query = query.eq('assigned_staff_id', filters.staff);
  if (filters.from) query = query.gte('delivered_at', `${filters.from}T00:00:00`);
  if (filters.to) query = query.lte('delivered_at', `${filters.to}T23:59:59`);
  if (filters.q) query = query.ilike('orders.order_number', `%${filters.q}%`);

  const { data, error } = await applyCursor(query, cursor, [], PAGE_SIZE);
  // "No completed deliveries yet" must not stand in for a failed read.
  if (error) throw new Error(`Deliveries could not be loaded [${error.code ?? 'unknown'}]: ${error.message}`);
  const rows = (data ?? []) as unknown as DeliveredRow[];
  return toOffsetBatch(rows, PAGE_SIZE, offset);
}

function renderDeliveredRows(rows: DeliveredRow[]) {
  return rows.map((row) => {
    const proofsMissing = !row.signature_url && !row.photo_url;
    return (
      <tr key={row.order_id} className="hover:bg-ink-50/50">
        <td className="px-5 py-3">
          <Link
            href={`/admin/delivered/${row.order_id}`}
            className="font-mono text-xs font-medium text-ink-900 hover:text-primary-600"
          >
            {row.orders?.order_number ?? '—'}
          </Link>
        </td>
        <td className="px-5 py-3 text-ink-600">{row.orders?.retailers?.shop_name ?? '—'}</td>
        <td className="px-5 py-3 text-ink-500">
          {row.delivered_at ? formatIndiaDateTime(row.delivered_at) : '—'}
        </td>
        <td className="px-5 py-3 text-ink-600">{row.receiver_name ?? '—'}</td>
        <td className="px-5 py-3 text-ink-600">{row.assigned_name?.full_name ?? '—'}</td>
        <td className="px-5 py-3">
          {row.otp_verified_at ? (
            <span className="rounded-full bg-mint-50 px-2 py-0.5 text-xs font-medium text-mint-700">Verified</span>
          ) : (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">Not verified</span>
          )}
        </td>
        <td className="px-5 py-3">
          {proofsMissing ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
              <ShieldAlert className="h-3 w-3" /> None
            </span>
          ) : (
            <span className="rounded-full bg-mint-50 px-2 py-0.5 text-xs font-medium text-mint-700">
              Attached
            </span>
          )}
        </td>
        <td className="px-5 py-3">
          <DeliveryStatusBadge status={row.delivery_status} />
        </td>
      </tr>
    );
  });
}

export default async function AdminDeliveredPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<{ q?: string; outcome?: string; staff?: string; from?: string; to?: string }>;
}) {
  const searchParams = await searchParamsPromise;
  await requirePagePermission('orders.view.all');
  const supabase = (await createClient());

  const filters: DeliveredFilters = {
    q: searchParams.q?.trim() ?? '',
    outcome: searchParams.outcome ?? '',
    staff: searchParams.staff ?? '',
    from: searchParams.from ?? '',
    to: searchParams.to ?? '',
  };

  // Delivery people for the filter dropdown.
  const { data: staffProfiles } = await supabase
    .from('profiles')
    .select('id, full_name, role')
    .in('role', ['staff', 'salesman'])
    .eq('is_active', true)
    .order('full_name');
  const staffOptions = (staffProfiles ?? []) as { id: string; full_name: string; role: string }[];

  const firstBatch = await loadDeliveredBatch(supabase, filters, null);
  const rows = firstBatch.items;
  const hasFilters = Boolean(filters.q || filters.outcome || filters.staff || filters.from || filters.to);

  const exportHref = `/admin/delivered/export?${new URLSearchParams({
    ...(filters.q ? { q: filters.q } : {}),
    ...(filters.outcome ? { outcome: filters.outcome } : {}),
    ...(filters.staff ? { staff: filters.staff } : {}),
    ...(filters.from ? { from: filters.from } : {}),
    ...(filters.to ? { to: filters.to } : {}),
  }).toString()}`;

  /** Server Action for batches 2..n; the permission check is re-run here. */
  async function loadMoreDelivered(cursor: string | null): Promise<InfiniteScrollBatch> {
    'use server';
    await requirePermission('orders.view.all');
    const batch = await loadDeliveredBatch((await createClient()), filters, readCursor(cursor));
    return { rows: renderDeliveredRows(batch.items), nextCursor: batch.nextCursor };
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink-950">Delivered Orders</h1>
          <p className="mt-1 text-sm text-ink-500">
            Every completed delivery with proof status, receiver, OTP verification and return window.
          </p>
        </div>
        <Link href={exportHref}>
          <Button variant="outline" size="sm">
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        </Link>
      </div>

      <Card>
        <form method="get" className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div className="relative sm:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <Input name="q" defaultValue={filters.q} placeholder="Search order number…" className="pl-9" />
          </div>
          <Select name="outcome" defaultValue={filters.outcome}>
            <option value="">All outcomes</option>
            <option value="delivered">Fully delivered</option>
            <option value="partially_delivered">Partially delivered</option>
            <option value="returned_to_warehouse">Returned to warehouse</option>
          </Select>
          <Select name="staff" defaultValue={filters.staff}>
            <option value="">Any delivery person</option>
            {staffOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name} ({s.role === 'salesman' ? 'sales' : 'staff'})
              </option>
            ))}
          </Select>
          <Input name="from" type="date" defaultValue={filters.from} aria-label="Delivered from" />
          <div className="flex gap-2">
            <Input name="to" type="date" defaultValue={filters.to} aria-label="Delivered to" />
            <Button type="submit" variant="secondary" size="sm">
              Apply
            </Button>
          </div>
        </form>
        {hasFilters ? (
          <div className="mt-2">
            <Link href="/admin/delivered">
              <Button type="button" variant="ghost" size="sm">
                Clear filters
              </Button>
            </Link>
          </div>
        ) : null}
      </Card>

      {rows.length === 0 ? (
        <AdminEmptyState
          icon={PackageCheck}
          title={hasFilters ? 'No deliveries match your filters' : 'No completed deliveries yet'}
          body={
            hasFilters
              ? 'Try a different search or clear the filters above.'
              : 'When dispatched orders are completed with the retailer’s OTP, they appear here.'
          }
        />
      ) : (
        <InfiniteScrollProvider
          loader={loadMoreDelivered}
          initialCursor={firstBatch.nextCursor}
          initialHasMore={Boolean(firstBatch.nextCursor)}
          resetKey={`${filters.q}|${filters.outcome}|${filters.staff}|${filters.from}|${filters.to}`}
        >
          <Card className="table-scroll p-0">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Order #</th>
                  <th className="px-5 py-3 font-medium">Retailer</th>
                  <th className="px-5 py-3 font-medium">Delivered at</th>
                  <th className="px-5 py-3 font-medium">Receiver</th>
                  <th className="px-5 py-3 font-medium">By</th>
                  <th className="px-5 py-3 font-medium">OTP</th>
                  <th className="px-5 py-3 font-medium">Proof</th>
                  <th className="px-5 py-3 font-medium">Outcome</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                <InfiniteScrollRows skeleton={<InfiniteScrollTableSkeleton columns={8} />}>
                  {renderDeliveredRows(rows)}
                </InfiniteScrollRows>
              </tbody>
            </table>
          </Card>

          <InfiniteScrollStatus endLabel="No more deliveries" loadingLabel="Loading more…" />
        </InfiniteScrollProvider>
      )}
    </div>
  );
}
