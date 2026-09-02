import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Clock3,
  CreditCard,
  FileText,
  ImageOff,
  PackageCheck,
  ReceiptText,
  ShieldCheck,
  Truck,
  XCircle,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { RetailerOrderActions } from '@/components/retailer/order-actions-panel';
import { DeliveryAddressCard } from '@/components/retailer/delivery-address-card';
import { formatInr } from '@/lib/retailer/format';
import { calculateCreditPosition } from '@/lib/orders/credit';
import { OrderStatusTimeline, type TrackedStatus, type StatusHistoryEntry } from '@/components/retailer/order-status-timeline';

type OrderStatus = 'pending' | 'confirmed' | 'processing' | 'packed' | 'dispatched' | 'delivered' | 'cancelled' | 'returned';

const STATUS_META: Record<OrderStatus, { label: string; style: string; icon: typeof Clock3 }> = {
  pending: { label: 'Pending confirmation', style: 'bg-amber-50 text-amber-700 ring-amber-200', icon: Clock3 },
  confirmed: { label: 'Confirmed', style: 'bg-blue-50 text-blue-700 ring-blue-200', icon: CheckCircle2 },
  processing: { label: 'Processing', style: 'bg-blue-50 text-blue-700 ring-blue-200', icon: Clock3 },
  packed: { label: 'Packed', style: 'bg-violet-50 text-violet-700 ring-violet-200', icon: PackageCheck },
  dispatched: { label: 'On the way', style: 'bg-cyan-50 text-cyan-700 ring-cyan-200', icon: Truck },
  delivered: { label: 'Delivered', style: 'bg-emerald-50 text-emerald-700 ring-emerald-200', icon: CheckCircle2 },
  cancelled: { label: 'Cancelled', style: 'bg-primary-50 text-primary-700 ring-primary-200', icon: XCircle },
  returned: { label: 'Returned', style: 'bg-primary-50 text-primary-700 ring-primary-200', icon: XCircle },
};

interface OrderDetailRow {
  id: string;
  order_number: string;
  status: OrderStatus;
  subtotal: number;
  gst_total: number;
  discount_total: number;
  grand_total: number;
  notes: string | null;
  placed_at: string;
}

interface OrderItemRow {
  id: string;
  quantity: number;
  unit_price: number;
  gst_percent: number;
  line_total: number;
  products: { name: string; product_images: { image_url: string; sort_order: number }[] } | null;
  product_packs: { pack_name: string; units_per_case: number } | null;
}

interface HistoryRow {
  id: string;
  status: OrderStatus;
  note: string | null;
  created_at: string;
}

interface OrderRetailerRow {
  shop_name: string;
  address: string | null;
  credit_limit: number;
  outstanding_balance: number;
  areas: { name: string; district: string | null } | null;
}

interface OrderProfileRow {
  full_name: string;
  phone: string | null;
}

export default async function OrderDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { placed?: string };
}) {
  const user = await requireUser();
  const supabase = createClient();

  const [{ data: order }, { data: itemData }, { data: historyData }, { data: retailer }, { data: profile }] = await Promise.all([
    supabase
      .from('orders')
      .select('id, order_number, status, subtotal, gst_total, discount_total, grand_total, notes, placed_at')
      .eq('id', params.id)
      .eq('retailer_id', user.id)
      .maybeSingle<OrderDetailRow>(),
    supabase
      .from('order_items')
      .select('id, quantity, unit_price, gst_percent, line_total, products ( name, product_images ( image_url, sort_order ) ), product_packs ( pack_name, units_per_case )')
      .eq('order_id', params.id),
    supabase
      .from('order_status_history')
      .select('id, status, note, created_at')
      .eq('order_id', params.id)
      .order('created_at', { ascending: true }),
    // The retailer's own account row and contact profile — RLS scopes both to
    // the caller, so this can never render another retailer's address or credit.
    supabase
      .from('retailers')
      .select('shop_name, address, credit_limit, outstanding_balance, areas ( name, district )')
      .eq('id', user.id)
      .maybeSingle<OrderRetailerRow>(),
    supabase.from('profiles').select('full_name, phone').eq('id', user.id).maybeSingle<OrderProfileRow>(),
  ]);

  if (!order) notFound();

  const items = (itemData ?? []) as unknown as OrderItemRow[];
  const history = (historyData ?? []) as HistoryRow[];
  const meta = STATUS_META[order.status];
  const StatusIcon = meta.icon;
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div className="space-y-5 sm:space-y-6">
      {searchParams.placed === '1' ? (
        <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-bold">Order placed successfully</p>
            <p className="mt-0.5 text-xs">Your order is awaiting confirmation. Pricing, GST and credit were validated server-side.</p>
          </div>
        </div>
      ) : null}
      <nav className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 sm:text-xs" aria-label="Breadcrumb">
        <Link href="/retailer/orders" className="flex items-center gap-1 hover:text-primary-600"><ArrowLeft className="h-3.5 w-3.5" /> My orders</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="font-mono text-slate-800">{order.order_number}</span>
      </nav>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ring-1 ring-inset sm:h-14 sm:w-14 ${meta.style}`}><StatusIcon className="h-5 w-5 sm:h-6 sm:w-6" /></span>
            <div className="min-w-0">
              <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400">Order details</p>
              <h1 className="mt-1 truncate font-mono text-base font-bold text-slate-950 sm:text-2xl">{order.order_number}</h1>
              <p className="mt-1 text-[10px] text-slate-500">Placed {new Date(order.placed_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 sm:justify-end">
            <span className={`rounded-full px-3 py-1.5 text-[10px] font-bold ring-1 ring-inset ${meta.style}`}>{meta.label}</span>
            <Link href={`/retailer/orders/${order.id}/invoice`} className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-[10px] font-bold text-slate-700 transition hover:border-primary-200 hover:text-primary-600"><FileText className="h-4 w-4" /> Invoice</Link>
          </div>
        </div>
        <div className="grid grid-cols-3 border-t border-slate-100 bg-slate-50/70">
          <div className="border-r border-slate-100 px-4 py-3 text-center"><p className="text-[8px] font-bold uppercase tracking-wider text-slate-400">Products</p><p className="mt-1 text-xs font-bold text-slate-800">{items.length} line{items.length === 1 ? '' : 's'}</p></div>
          <div className="border-r border-slate-100 px-4 py-3 text-center"><p className="text-[8px] font-bold uppercase tracking-wider text-slate-400">Quantity</p><p className="mt-1 text-xs font-bold text-slate-800">{totalQuantity} pack{totalQuantity === 1 ? '' : 's'}</p></div>
          <div className="px-4 py-3 text-center"><p className="text-[8px] font-bold uppercase tracking-wider text-slate-400">Order value</p><p className="mt-1 text-xs font-bold text-slate-800">₹{order.grand_total.toFixed(2)}</p></div>
        </div>
      </section>

      {history.length > 0 ? <OrderStatusTimeline status={order.status as TrackedStatus} history={history as StatusHistoryEntry[]} /> : null}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_350px] lg:gap-7">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3.5 sm:px-5"><div><h2 className="text-sm font-bold text-slate-900">Items in this order</h2><p className="mt-0.5 text-[10px] text-slate-500">Prices captured when the order was placed</p></div><PackageCheck className="h-5 w-5 text-primary-600" /></div>
          <div className="divide-y divide-slate-100 px-3 sm:px-5">
            {items.map((item) => {
              const images = [...(item.products?.product_images ?? [])].sort((a, b) => a.sort_order - b.sort_order);
              const unitsPerCase = item.product_packs?.units_per_case ?? 1;
              const totalPieces = item.quantity * unitsPerCase;
              return (
                <div key={item.id} className="flex items-center gap-3 py-4 sm:gap-4">
                  <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-slate-50 sm:h-20 sm:w-20">
                    {images[0]?.image_url ? <Image src={images[0].image_url} alt={item.products?.name ?? ''} fill className="object-contain p-1.5" unoptimized /> : <div className="flex h-full items-center justify-center text-slate-300"><ImageOff className="h-5 w-5" /></div>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-xs font-bold leading-4 text-slate-900 sm:text-sm">{item.products?.name ?? 'Unknown product'}</p>
                    <p className="mt-1 text-[10px] font-medium text-slate-500">{item.product_packs?.pack_name ?? 'Pack'} · Qty {item.quantity} case{item.quantity === 1 ? '' : 's'} ({totalPieces} pcs)</p>
                    <p className="mt-1 text-[9px] text-slate-400">₹{item.unit_price.toFixed(2)} / case · GST {item.gst_percent}%</p>
                  </div>
                  <div className="shrink-0 text-right"><p className="text-sm font-bold text-slate-950">₹{item.line_total.toFixed(2)}</p><p className="mt-0.5 text-[8px] text-slate-400">Line total</p></div>
                </div>
              );
            })}
          </div>
        </section>

        <aside className="space-y-4 lg:sticky lg:top-36">
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3.5"><ReceiptText className="h-4 w-4 text-primary-600" /><h2 className="text-sm font-bold text-slate-900">Payment summary</h2></div>
            <div className="space-y-3 p-4">
              <div className="flex justify-between text-xs text-slate-600"><span>Subtotal</span><span className="font-semibold text-slate-800">₹{order.subtotal.toFixed(2)}</span></div>
              <div className="flex justify-between text-xs text-slate-600"><span>GST</span><span className="font-semibold text-slate-800">₹{order.gst_total.toFixed(2)}</span></div>
              {order.discount_total > 0 ? <div className="flex justify-between text-xs text-emerald-700"><span>Discount</span><span className="font-bold">−₹{order.discount_total.toFixed(2)}</span></div> : null}
              <div className="flex items-end justify-between border-t border-dashed border-slate-200 pt-4"><span className="text-sm font-bold text-slate-900">Total</span><span className="text-xl font-bold tracking-tight text-slate-950">₹{order.grand_total.toFixed(2)}</span></div>
              <div className="flex items-center justify-center gap-1.5 pt-1 text-[9px] text-slate-400"><ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> Tax and totals recorded securely</div>
            </div>
          </section>

          {retailer ? (
            <DeliveryAddressCard
              address={{
                shopName: retailer.shop_name ?? null,
                contactName: profile?.full_name ?? user.fullName,
                address: retailer.address ?? null,
                area: retailer.areas
                  ? `${retailer.areas.name}${retailer.areas.district ? `, ${retailer.areas.district}` : ''}`
                  : null,
                phone: profile?.phone ?? null,
              }}
              note="This is the registered shop address on your account. Orders do not store their own address snapshot, so an update to your profile is reflected here too."
            />
          ) : null}

          {/*
            Settlement for this order, from real data only. `orders` has no
            payment_method column and no credit-terms model, so this reports the
            order's own recorded GST-inclusive total and the account's CURRENT
            credit position (clearly labelled as current, not as at order time).
          */}
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3.5">
              <CreditCard className="h-4 w-4 text-primary-600" aria-hidden="true" />
              <h2 className="text-sm font-bold text-slate-900">Settlement</h2>
            </div>
            <div className="space-y-2 p-4 text-xs">
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-600">Order total (incl. GST)</span>
                <span className="font-bold text-slate-900">{formatInr(order.grand_total)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-600">Method</span>
                <span className="font-bold text-slate-900">
                  {retailer && retailer.credit_limit > 0 ? 'Business credit account' : 'No credit facility configured'}
                </span>
              </div>
              {retailer ? (() => {
                const position = calculateCreditPosition(retailer.credit_limit, retailer.outstanding_balance);
                return position.hasConfiguredLimit ? (
                  <>
                    <div className="flex items-center justify-between gap-3 border-t border-dashed border-slate-200 pt-2">
                      <span className="text-slate-500">Outstanding on your account now</span>
                      <span className="font-semibold text-slate-800">{formatInr(position.outstandingBalance)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-slate-500">Available credit now</span>
                      <span className="font-semibold text-slate-800">{formatInr(position.availableCredit ?? 0)}</span>
                    </div>
                  </>
                ) : null;
              })() : null}
              <Link
                href="/retailer/account/ledger"
                className="flex h-9 items-center justify-center rounded-lg border border-slate-200 text-[10px] font-bold text-slate-700 transition hover:border-primary-200 hover:text-primary-600"
              >
                View credit &amp; ledger
              </Link>
            </div>
          </section>

          {order.notes ? <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Delivery notes</p><p className="mt-2 text-xs leading-5 text-slate-600">{order.notes}</p></section> : null}

          <RetailerOrderActions orderId={order.id} status={order.status} />
          <Link href={`/retailer/help?topic=order&order=${order.order_number}`} className="flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 shadow-sm hover:border-primary-200 hover:text-primary-600">
            Contact support about this order
          </Link>
        </aside>
      </div>
    </div>
  );
}
