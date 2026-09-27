import Link from 'next/link';
import {
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  ClipboardList,
  Clock3,
  FileText,
  PackageCheck,
  RotateCcw,
  Search,
  Truck,
  XCircle,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { formatInr } from '@/lib/retailer/format';
import { describeOrderTotals } from '@/lib/orders/item-display';
import { formatIndiaRelativeDateTime, indiaDayEndIso, indiaDayStartIso } from '@/lib/datetime/india';
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

/** Rows per batch. */
const PAGE_SIZE = 15;

/** Newest first, `id` breaking ties so batches never overlap. */
const ORDER: KeysetColumn[] = [
  { column: 'placed_at', ascending: false },
  { column: 'id', ascending: false },
];

type OrderStatus = 'pending' | 'confirmed' | 'processing' | 'packed' | 'dispatched' | 'delivered' | 'cancelled' | 'returned';

const STATUS_TABS: { value: OrderStatus | ''; label: string }[] = [
  { value: '', label: 'All orders' },
  { value: 'pending', label: 'Pending' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'processing', label: 'Processing' },
  { value: 'packed', label: 'Packed' },
  { value: 'dispatched', label: 'On the way' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'returned', label: 'Returned' },
];

const STATUS_META: Record<OrderStatus, { label: string; style: string; icon: typeof Clock3; message: string }> = {
  pending: { label: 'Pending confirmation', style: 'bg-amber-50 text-amber-700 ring-amber-200', icon: Clock3, message: 'Waiting for distributor confirmation' },
  confirmed: { label: 'Confirmed', style: 'bg-blue-50 text-blue-700 ring-blue-200', icon: CheckCircle2, message: 'Order confirmed and queued' },
  processing: { label: 'Processing', style: 'bg-blue-50 text-blue-700 ring-blue-200', icon: CircleDashed, message: 'Your order is being prepared' },
  packed: { label: 'Packed', style: 'bg-violet-50 text-violet-700 ring-violet-200', icon: PackageCheck, message: 'Packed and ready to dispatch' },
  dispatched: { label: 'On the way', style: 'bg-cyan-50 text-cyan-700 ring-cyan-200', icon: Truck, message: 'Dispatched for delivery' },
  delivered: { label: 'Delivered', style: 'bg-emerald-50 text-emerald-700 ring-emerald-200', icon: CheckCircle2, message: 'Delivery completed' },
  cancelled: { label: 'Cancelled', style: 'bg-slate-100 text-slate-600 ring-slate-200', icon: XCircle, message: 'This order was cancelled' },
  returned: { label: 'Returned', style: 'bg-slate-100 text-slate-600 ring-slate-200', icon: RotateCcw, message: 'This order was returned' },
};

interface OrderRow {
  id: string;
  order_number: string;
  status: OrderStatus;
  subtotal: number;
  gst_total: number;
  grand_total: number;
  placed_at: string;
  order_items: { quantity: number; quantity_unit: 'cases' | 'pieces' | null; quantity_pieces: number | null }[] | null;
}

function ordersHref({ status, q, from, to }: { status?: string; q?: string; from?: string; to?: string }) {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (q) params.set('q', q);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const query = params.toString();
  return `/retailer/orders${query ? `?${query}` : ''}`;
}

interface OrderFilters {
  status: string;
  q: string;
  from: string;
  to: string;
}

type SupabaseClient = ReturnType<typeof createClient>;

/**
 * One batch of this retailer's orders. RLS scopes `orders` to the caller, and
 * the extra `.eq('retailer_id', user.id)` is the same belt-and-braces filter
 * the old paged query used.
 *
 * The exact total is counted for the FIRST batch only — it is the "N orders
 * found" heading, and re-counting it on every scroll would be the single most
 * expensive thing on the page.
 */
async function loadOrderBatch(
  supabase: SupabaseClient,
  retailerId: string,
  filters: OrderFilters,
  cursor: ListCursor | null
) {
  let query = supabase
    .from('orders')
    .select(
      'id, order_number, status, subtotal, gst_total, grand_total, placed_at, order_items(quantity, quantity_unit, quantity_pieces)',
      cursor === null ? { count: 'exact' } : {}
    )
    .eq('retailer_id', retailerId);

  if (filters.status) query = query.eq('status', filters.status);
  if (filters.q) query = query.ilike('order_number', `%${filters.q}%`);
  // Date filters are Asia/Kolkata calendar days; convert to UTC instants.
  if (filters.from) query = query.gte('placed_at', indiaDayStartIso(filters.from)!);
  if (filters.to) query = query.lte('placed_at', indiaDayEndIso(filters.to)!);

  const { data, count } = await applyCursor(applyKeysetOrder(query, ORDER), cursor, ORDER, PAGE_SIZE);
  const rows = (data ?? []) as OrderRow[];
  const batch = toListBatch(rows, PAGE_SIZE, (row) => keysetCursorFor(row, ORDER));
  return { ...batch, total: count ?? rows.length };
}

function renderOrderCards(rows: OrderRow[]) {
  return rows.map((order) => {
    const meta = STATUS_META[order.status];
    const StatusIcon = meta.icon;
    const canInvoice = ['confirmed', 'processing', 'packed', 'dispatched', 'delivered'].includes(order.status);
    const canTrack = ['pending', 'confirmed', 'processing', 'packed', 'dispatched'].includes(order.status);
    const totals = describeOrderTotals(order.order_items ?? []);
    return (
      <article
        key={order.id}
        className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:border-slate-300 hover:shadow-md"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ${meta.style}`}>
              <StatusIcon className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <Link
                href={`/retailer/orders/${order.id}`}
                className="truncate font-mono text-xs font-bold text-slate-900 hover:text-primary-600"
              >
                {order.order_number}
              </Link>
              <p className="mt-0.5 text-[9px] text-slate-500">
                Placed {formatIndiaRelativeDateTime(order.placed_at)}
              </p>
            </div>
          </div>
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-[9px] font-bold ring-1 ring-inset ${meta.style}`}>
            {meta.label}
          </span>
        </div>

        <div className="p-4">
          <p className="text-[10px] font-medium text-slate-500">{meta.message}</p>
          <div className="mt-4 flex items-end justify-between gap-3">
            <div>
              <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Order total</p>
              <p className="mt-1 text-xl font-bold tracking-tight text-slate-950">{formatInr(order.grand_total)}</p>
              <p className="text-[9px] text-slate-500">
                {totals.lineCount} line{totals.lineCount === 1 ? '' : 's'} · {totals.totalPieces} pc
                {totals.totalPieces === 1 ? '' : 's'} · incl. GST
              </p>
            </div>
            <Link
              href={`/retailer/orders/${order.id}`}
              className="flex h-9 items-center gap-1 rounded-lg bg-slate-950 px-3 text-[10px] font-bold text-white transition hover:bg-primary-700"
            >
              {canTrack ? 'Track order' : 'View details'} <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
        </div>

        <div className="flex items-center gap-4 border-t border-slate-100 bg-slate-50/60 px-4 py-2.5">
          <Link
            href={`/retailer/orders/${order.id}/reorder`}
            className="flex items-center gap-1.5 text-[9px] font-bold text-slate-600 hover:text-primary-600"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Reorder
          </Link>
          {canInvoice ? (
            <Link
              href={`/retailer/orders/${order.id}/invoice`}
              className="flex items-center gap-1.5 text-[9px] font-bold text-slate-600 hover:text-primary-600"
            >
              <FileText className="h-3.5 w-3.5" aria-hidden="true" /> Invoice
            </Link>
          ) : null}
        </div>
      </article>
    );
  });
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: { status?: string; q?: string; from?: string; to?: string };
}) {
  const user = await requireUser();
  const supabase = createClient();
  const allowedStatuses = STATUS_TABS.map((tab) => tab.value);
  const status = allowedStatuses.includes(searchParams.status as OrderStatus) ? searchParams.status ?? '' : '';
  const q = searchParams.q?.trim() ?? '';
  const dateFrom = searchParams.from?.trim() ?? '';
  const dateTo = searchParams.to?.trim() ?? '';

  const filters: OrderFilters = { status, q, from: dateFrom, to: dateTo };
  const firstBatch = await loadOrderBatch(supabase, user.id, filters, null);
  const orders = firstBatch.items;
  const count = firstBatch.total;

  /** Server Action for batches 2..n; the retailer id is re-derived server-side. */
  async function loadMoreOrders(cursor: string | null): Promise<InfiniteScrollBatch> {
    'use server';
    const caller = await requireUser();
    const batch = await loadOrderBatch(createClient(), caller.id, filters, readCursor(cursor));
    return { rows: renderOrderCards(batch.items), nextCursor: batch.nextCursor };
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 sm:text-xs">
        <Link href="/retailer/home" className="hover:text-primary-600">
          Home
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-slate-800">My orders</span>
      </div>

      <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-primary-50 via-white to-rose-50/50 px-4 py-5 shadow-sm sm:px-7 sm:py-7">
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-600">Purchase history</p>
            <h1 className="mt-2 text-xl font-bold tracking-tight text-slate-950 sm:text-2xl">My orders</h1>
            <p className="mt-2 text-xs text-slate-600 sm:text-sm">
              Track deliveries, view invoices and reorder essentials.
            </p>
          </div>
          <Link
            href="/retailer/quick-order"
            className="flex h-10 items-center gap-2 rounded-xl bg-primary-600 px-4 text-xs font-bold text-white transition hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" /> Start a new order
          </Link>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
        <form method="get" className="space-y-3">
          {status ? <input type="hidden" name="status" value={status} /> : null}
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              name="q"
              defaultValue={q}
              placeholder="Search by order number"
              aria-label="Search by order number"
              className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-20 text-xs text-slate-900 outline-none focus:border-primary-300 focus:bg-white focus:ring-2 focus:ring-primary-100"
            />
            <button
              type="submit"
              className="absolute right-1.5 top-1.5 h-7 rounded-lg bg-primary-600 px-4 text-[10px] font-bold text-white hover:bg-primary-700"
            >
              Search
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-end">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              From
              <input
                type="date"
                name="from"
                defaultValue={dateFrom}
                aria-label="From date"
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-xs text-slate-700"
              />
            </label>
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              To
              <input
                type="date"
                name="to"
                defaultValue={dateTo}
                aria-label="To date"
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-xs text-slate-700"
              />
            </label>
            <button
              type="submit"
              className="col-span-2 h-9 rounded-lg bg-slate-900 px-3 text-[10px] font-bold text-white hover:bg-slate-800 sm:mb-0.5"
            >
              Apply dates
            </button>
          </div>
        </form>

        <div className="scrollbar-none mt-3 flex gap-2 overflow-x-auto">
          {STATUS_TABS.map((tab) => {
            const active = status === tab.value;
            return (
              <Link
                key={tab.value}
                href={ordersHref({ status: tab.value, q, from: dateFrom, to: dateTo })}
                aria-current={active ? 'page' : undefined}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-[10px] font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 sm:text-[11px] ${
                  active
                    ? 'border-primary-600 bg-primary-600 text-white shadow-sm'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-primary-200 hover:text-primary-600'
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>
      </section>

      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-600">
            {status ? STATUS_META[status as OrderStatus].label : 'All activity'}
          </p>
          <h2 className="mt-0.5 text-base font-bold text-slate-900 sm:text-lg">
            {count ?? 0} order{count === 1 ? '' : 's'} found
          </h2>
        </div>
        {status || q || dateFrom || dateTo ? (
          <Link href="/retailer/orders" className="text-[10px] font-bold text-primary-600 hover:text-primary-700">
            Clear filters
          </Link>
        ) : null}
      </div>

      {orders.length === 0 ? (
        <section className="flex min-h-[360px] flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 text-center shadow-sm">
          <ClipboardList className="h-11 w-11 text-slate-300" aria-hidden="true" />
          <h2 className="mt-4 text-lg font-bold text-slate-800">
            {q ? 'No matching order found' : status ? `No ${STATUS_META[status as OrderStatus].label.toLowerCase()} orders` : 'No orders yet'}
          </h2>
          <p className="mt-2 max-w-sm text-xs leading-5 text-slate-500">
            {q
              ? 'Try the full order number or clear your filters.'
              : 'Orders you place will appear here with live fulfillment updates.'}
          </p>
          {!status && !q && !dateFrom && !dateTo ? (
            <Link
              href="/retailer/catalog"
              className="mt-5 flex h-10 items-center gap-2 rounded-xl bg-primary-600 px-5 text-xs font-bold text-white hover:bg-primary-700"
            >
              Browse products <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          ) : null}
        </section>
      ) : (
        <InfiniteScrollProvider
          loader={loadMoreOrders}
          initialCursor={firstBatch.nextCursor}
          initialHasMore={Boolean(firstBatch.nextCursor)}
          resetKey={ordersHref(filters)}
        >
          <div className="grid gap-3 md:grid-cols-2">
            <InfiniteScrollRows
              skeleton={
                <>
                  {[0, 1].map((index) => (
                    <div
                      key={index}
                      aria-hidden="true"
                      className="h-56 animate-pulse rounded-2xl border border-slate-200 bg-slate-50"
                    />
                  ))}
                </>
              }
            >
              {renderOrderCards(orders)}
            </InfiniteScrollRows>
          </div>

          <InfiniteScrollStatus endLabel="No more orders" loadingLabel="Loading more orders…" />
        </InfiniteScrollProvider>
      )}
    </div>
  );
}
