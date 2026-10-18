import { PackageCheck, Truck } from 'lucide-react';
import { requireSellerPage } from '@/lib/seller/guard';
import { listSellerOrders } from '@/lib/seller/queries';
import { SellerSubOrderActions } from '@/components/seller/seller-sub-order-actions';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/admin/status-badge';
import { formatIndiaDateTime } from '@/lib/datetime/india';

export const dynamic = 'force-dynamic';

const inr = (paise: number) =>
  `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default async function SellerOrdersPage() {
  const { seller } = await requireSellerPage();
  const orders = await listSellerOrders(seller.id, seller.status === 'active');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
          <PackageCheck className="h-6 w-6 text-primary-600" /> Sub-Orders &amp; Fulfilment
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Each sub-order contains only your seller lines from a retailer checkout. Confirm, pack, and dispatch
          seller-fulfilled sub-orders with courier and AWB tracking.
        </p>
      </div>

      {seller.status !== 'active' ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
          Your seller account status is <strong>{seller.status}</strong>. Active seller membership is required to
          manage sub-orders.
        </div>
      ) : orders.length === 0 ? (
        <Card className="p-6 text-center text-xs text-slate-500">
          No sub-orders have been placed for your offers yet.
        </Card>
      ) : (
        <div className="space-y-4">
          {orders.map((order) => (
            <Card key={order.sub_order_id} className="p-5 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold text-slate-900">{order.order_number}</span>
                    <StatusBadge status={order.status} />
                    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-700">
                      {order.fulfilment_type === 'seller' ? 'Seller-fulfilled' : 'Maharani-fulfilled'}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    Placed {formatIndiaDateTime(order.placed_at)} · Sub-order ID{' '}
                    <span className="font-mono">{order.sub_order_id.slice(0, 8)}</span>
                  </p>
                </div>

                <div className="text-right text-xs">
                  <p className="font-bold text-slate-900">Payable: {inr(order.payable_paise)}</p>
                  <p className="text-slate-500">
                    Gross {inr(order.gross_paise)} (incl. GST {inr(order.gst_paise)}) · COD / Coins settlement
                  </p>
                </div>
              </div>

              {order.items.length > 0 ? (
                <div className="rounded-xl bg-slate-50 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Items in your sub-order
                  </p>
                  <ul className="mt-2 divide-y divide-slate-200/70 text-xs">
                    {order.items.map((item) => (
                      <li key={item.id} className="flex items-center justify-between py-1.5">
                        <span className="text-slate-800">
                          {item.product_name} ({item.pack_name}) × <strong>{item.quantity} pcs</strong> @ ₹
                          {item.unit_price.toFixed(2)}
                        </span>
                        <span className="font-semibold text-slate-900">₹{item.line_total.toFixed(2)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {order.fulfilment_type === 'seller' && order.shipping_address?.line ? (
                <div className="rounded-xl border border-slate-200 p-3 text-xs text-slate-700">
                  <p className="font-semibold text-slate-900">
                    Dispatch to: {order.shipping_address.label ?? order.shipping_address.receiverName ?? 'Retailer shop'}
                  </p>
                  <p className="mt-0.5">{order.shipping_address.line}</p>
                  {order.shipping_address.phone ? (
                    <p className="mt-0.5 text-slate-500">Phone: {order.shipping_address.phone}</p>
                  ) : null}
                </div>
              ) : null}

              {order.shipment ? (
                <div className="flex flex-wrap items-center gap-3 rounded-xl bg-sky-50/70 px-3 py-2 text-xs text-sky-900">
                  <Truck className="h-4 w-4 text-sky-600" />
                  <span>
                    Shipment status: <strong>{order.shipment.status}</strong>
                  </span>
                  {order.shipment.courier ? <span>· Courier: {order.shipment.courier}</span> : null}
                  {order.shipment.awb ? <span>· AWB/Tracking: {order.shipment.awb}</span> : null}
                </div>
              ) : null}

              <SellerSubOrderActions
                subOrderId={order.sub_order_id}
                status={order.status}
                fulfilmentType={order.fulfilment_type}
                initialCourier={order.shipment?.courier}
                initialAwb={order.shipment?.awb}
              />
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
