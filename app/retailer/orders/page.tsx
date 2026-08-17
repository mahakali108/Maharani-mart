import Link from 'next/link';
import {
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
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

const PAGE_SIZE = 15;

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
  cancelled: { label: 'Cancelled', style: 'bg-primary-50 text-primary-700 ring-primary-200', icon: XCircle, message: 'This order was cancelled' },
  returned: { label: 'Returned', style: 'bg-primary-50 text-primary-700 ring-primary-200', icon: RotateCcw, message: 'This order was returned' },
};

interface OrderRow {
  id: string;
  order_number: string;
  status: OrderStatus;
  subtotal: number;
  gst_total: number;
  grand_total: number;
  placed_at: string;
  order_items: { count: number }[] | null;
}

function ordersHref({ status, q, page, from, to }: { status?: string; q?: string; page?: number; from?: string; to?: string }) {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (q) params.set('q', q);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (page && page > 1) params.set('page', String(page));
  const query = params.toString();
  return `/retailer/orders${query ? `?${query}` : ''}`;
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: { status?: string; page?: string; q?: string; from?: string; to?: string };
}) {
  const user = await requireUser();
  const supabase = createClient();
  const allowedStatuses = STATUS_TABS.map((tab) => tab.value);
  const status = allowedStatuses.includes(searchParams.status as OrderStatus) ? searchParams.status ?? '' : '';
  const q = searchParams.q?.trim() ?? '';
  const dateFrom = searchParams.from?.trim() ?? '';
  const dateTo = searchParams.to?.trim() ?? '';
  const page = Math.max(1, Number(searchParams.page) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = supabase
    .from('orders')
    .select('id, order_number, status, subtotal, gst_total, grand_total, placed_at, order_items(count)', { count: 'exact' })
    .eq('retailer_id', user.id)
    .order('placed_at', { ascending: false })
    .range(from, to);

  if (status) query = query.eq('status', status);
  if (q) query = query.ilike('order_number', `%${q}%`);
  if (dateFrom) query = query.gte('placed_at', `${dateFrom}T00:00:00.000Z`);
  if (dateTo) query = query.lte('placed_at', `${dateTo}T23:59:59.999Z`);

  const { data, count } = await query;
  const orders = (data ?? []) as OrderRow[];
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 sm:text-xs"><Link href="/retailer/home" className="hover:text-primary-600">Home</Link><ChevronRight className="h-3 w-3" /><span className="text-slate-800">My orders</span></div>

      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-950 via-slate-900 to-primary-950 px-5 py-6 text-white shadow-lg sm:px-8 sm:py-8">
        <ClipboardList className="absolute -bottom-8 -right-5 h-40 w-40 rotate-[-8deg] text-white/5 sm:h-52 sm:w-52" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-300">Purchase history</p><h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-4xl">My Orders</h1><p className="mt-2 text-xs text-slate-300 sm:text-sm">Track deliveries, view invoices and quickly reorder essentials.</p></div>
          <Link href="/retailer/quick-order" className="flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-xs font-bold text-slate-900 transition hover:bg-amber-50"><RotateCcw className="h-4 w-4" /> Start new order</Link>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
        <form method="get" className="space-y-3">
          {status ? <input type="hidden" name="status" value={status} /> : null}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input name="q" defaultValue={q} placeholder="Search by order number" className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-20 text-xs text-slate-900 outline-none focus:border-primary-300 focus:bg-white focus:ring-2 focus:ring-primary-50" />
            <button type="submit" className="absolute right-1.5 top-1.5 h-7 rounded-lg bg-primary-600 px-4 text-[10px] font-bold text-white">Search</button>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-end">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              From
              <input type="date" name="from" defaultValue={dateFrom} className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-xs text-slate-700" />
            </label>
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              To
              <input type="date" name="to" defaultValue={dateTo} className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-xs text-slate-700" />
            </label>
            <button type="submit" className="col-span-2 h-9 rounded-lg bg-slate-900 px-3 text-[10px] font-bold text-white sm:mb-0.5">Apply dates</button>
          </div>
        </form>

        <div className="scrollbar-none mt-3 flex gap-2 overflow-x-auto">
          {STATUS_TABS.map((tab) => {
            const active = status === tab.value;
            return (
              <Link key={tab.value} href={ordersHref({ status: tab.value, q, from: dateFrom, to: dateTo })} className={`shrink-0 rounded-full border px-3 py-1.5 text-[10px] font-bold transition sm:text-[11px] ${active ? 'border-primary-600 bg-primary-600 text-white shadow-sm' : 'border-slate-200 bg-white text-slate-600 hover:border-primary-200 hover:text-primary-600'}`}>{tab.label}</Link>
            );
          })}
        </div>
      </section>

      <div className="flex items-end justify-between gap-3">
        <div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-600">{status ? STATUS_META[status as OrderStatus].label : 'All activity'}</p><h2 className="mt-0.5 text-base font-bold text-slate-900 sm:text-xl">{count ?? 0} order{count === 1 ? '' : 's'} found</h2></div>
        {(status || q || dateFrom || dateTo) ? <Link href="/retailer/orders" className="text-[10px] font-bold text-primary-600">Clear filters</Link> : null}
      </div>

      {orders.length === 0 ? (
        <section className="flex min-h-[360px] flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 text-center shadow-sm">
          <ClipboardList className="h-11 w-11 text-slate-300" />
          <h2 className="mt-4 text-lg font-bold text-slate-800">{q ? 'No matching order found' : status ? `No ${STATUS_META[status as OrderStatus].label.toLowerCase()} orders` : 'No orders yet'}</h2>
          <p className="mt-2 max-w-sm text-xs leading-5 text-slate-500">{q ? 'Try the full order number or clear your filters.' : 'Orders you place will appear here with live fulfillment updates.'}</p>
          {!status && !q && !dateFrom && !dateTo ? <Link href="/retailer/catalog" className="mt-5 flex h-10 items-center gap-2 rounded-xl bg-primary-600 px-5 text-xs font-bold text-white">Browse products <ArrowRight className="h-4 w-4" /></Link> : null}
        </section>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {orders.map((order) => {
            const meta = STATUS_META[order.status];
            const StatusIcon = meta.icon;
            const canInvoice = ['confirmed', 'processing', 'packed', 'dispatched', 'delivered'].includes(order.status);
            const canTrack = ['pending', 'confirmed', 'processing', 'packed', 'dispatched'].includes(order.status);
            const itemCount = order.order_items?.[0]?.count ?? 0;
            return (
              <article key={order.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:border-slate-300 hover:shadow-md">
                <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ${meta.style}`}><StatusIcon className="h-4 w-4" /></span>
                    <div className="min-w-0"><Link href={`/retailer/orders/${order.id}`} className="truncate font-mono text-xs font-bold text-slate-900 hover:text-primary-600">{order.order_number}</Link><p className="mt-0.5 text-[9px] text-slate-400">Placed {new Date(order.placed_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</p></div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[9px] font-bold ring-1 ring-inset ${meta.style}`}>{meta.label}</span>
                </div>

                <div className="p-4">
                  <p className="text-[10px] font-medium text-slate-500">{meta.message}</p>
                  <div className="mt-4 flex items-end justify-between gap-3">
                    <div><p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Order total</p><p className="mt-1 text-xl font-bold tracking-tight text-slate-950">₹{order.grand_total.toFixed(2)}</p><p className="text-[9px] text-slate-400">{itemCount} item{itemCount === 1 ? '' : 's'} · GST ₹{order.gst_total.toFixed(2)}</p></div>
                    <Link href={`/retailer/orders/${order.id}`} className="flex h-9 items-center gap-1 rounded-lg bg-slate-950 px-3 text-[10px] font-bold text-white transition hover:bg-primary-700">{canTrack ? 'Track order' : 'View details'} <ChevronRight className="h-3.5 w-3.5" /></Link>
                  </div>
                </div>

                <div className="flex items-center gap-4 border-t border-slate-100 bg-slate-50/60 px-4 py-2.5">
                  <Link href={`/retailer/orders/${order.id}/reorder`} className="flex items-center gap-1.5 text-[9px] font-bold text-slate-600 hover:text-primary-600"><RotateCcw className="h-3.5 w-3.5" /> Reorder</Link>
                  {canInvoice ? <Link href={`/retailer/orders/${order.id}/invoice`} className="flex items-center gap-1.5 text-[9px] font-bold text-slate-600 hover:text-primary-600"><FileText className="h-3.5 w-3.5" /> Invoice</Link> : null}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {totalPages > 1 ? (
        <nav className="flex items-center justify-center gap-3 pt-2" aria-label="Order pages">
          {page > 1 ? <Link href={ordersHref({ status, q, from: dateFrom, to: dateTo, page: page - 1 })} className="flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-[10px] font-bold text-slate-700"><ChevronLeft className="h-3.5 w-3.5" /> Previous</Link> : <span />}
          <span className="text-[10px] font-semibold text-slate-500">Page {page} of {totalPages}</span>
          {page < totalPages ? <Link href={ordersHref({ status, q, from: dateFrom, to: dateTo, page: page + 1 })} className="flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-[10px] font-bold text-slate-700">Next <ChevronRight className="h-3.5 w-3.5" /></Link> : <span />}
        </nav>
      ) : null}
    </div>
  );
}
