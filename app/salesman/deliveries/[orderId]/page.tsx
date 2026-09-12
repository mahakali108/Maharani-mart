import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, MapPin, Phone } from 'lucide-react';
import { requirePermission } from '@/lib/admin/guard';
import { fetchDeliveryDetail } from '@/lib/delivery/queries';
import { DeliveryStatusBadge } from '@/components/delivery/delivery-status-badge';
import { DeliveryExecutionForm } from '@/components/delivery/delivery-execution-form';
import { Card } from '@/components/ui/card';
import { formatIndiaDateTime } from '@/lib/datetime/india';

export default async function SalesmanDeliveryDetailPage({ params }: { params: { orderId: string } }) {
  const user = await requirePermission('deliveries.view.assigned');
  const detail = await fetchDeliveryDetail(params.orderId);
  if (!detail) notFound();

  const { delivery, order, items } = detail;
  const canExecute =
    delivery.assigned_staff_id === user.id || user.role === 'admin' || user.role === 'super_admin';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/salesman/deliveries" className="rounded-xl border border-ink-200 p-2 text-ink-500 hover:text-ink-900">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0">
          <h1 className="font-mono text-xl font-semibold text-ink-950">{order.order_number}</h1>
          <p className="text-sm text-ink-500">{order.shop_name ?? '—'}</p>
        </div>
        <DeliveryStatusBadge status={delivery.delivery_status} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="space-y-3 p-5">
          <h2 className="text-base font-semibold text-ink-950">Delivery address</h2>
          <div className="space-y-1.5 text-sm">
            {order.shipping_address?.receiverName ? (
              <p className="font-medium text-ink-800">{order.shipping_address.receiverName}</p>
            ) : null}
            <p className="flex items-start gap-2 text-ink-600">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
              {order.shipping_address?.line ?? 'No address snapshot on this order — check the shop profile.'}
            </p>
            {order.shipping_address?.phone ? (
              <p className="flex items-center gap-2 text-ink-600">
                <Phone className="h-4 w-4 text-ink-400" />
                {order.shipping_address.phone}
              </p>
            ) : null}
          </div>
        </Card>

        <Card className="space-y-3 p-5">
          <h2 className="text-base font-semibold text-ink-950">Task timeline</h2>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-500">Dispatched</dt>
              <dd className="text-ink-800">{delivery.dispatched_at ? formatIndiaDateTime(delivery.dispatched_at) : '—'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-500">Started</dt>
              <dd className="text-ink-800">{delivery.in_progress_at ? formatIndiaDateTime(delivery.in_progress_at) : '—'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-500">Delivered</dt>
              <dd className="text-ink-800">{delivery.delivered_at ? formatIndiaDateTime(delivery.delivered_at) : '—'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-500">Receiver</dt>
              <dd className="text-ink-800">{delivery.receiver_name ?? '—'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-500">OTP verified</dt>
              <dd className={delivery.otp_verified_at ? 'font-medium text-green-700' : 'text-ink-800'}>
                {delivery.otp_verified_at ? `Yes (${formatIndiaDateTime(delivery.otp_verified_at)})` : 'Not yet'}
              </dd>
            </div>
          </dl>
          {delivery.failure_reason ? (
            <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">
              <p className="font-medium">Last failure reason</p>
              <p>{delivery.failure_reason}</p>
            </div>
          ) : null}
        </Card>
      </div>

      <Card className="space-y-3 p-5">
        <h2 className="text-base font-semibold text-ink-950">Order lines</h2>
        <div className="table-scroll">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="border-b border-ink-100 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="py-2 pr-4 font-medium">Product</th>
                <th className="py-2 pr-4 font-medium">Ordered</th>
                <th className="py-2 pr-4 font-medium">Delivered</th>
                <th className="py-2 pr-4 font-medium">Missing</th>
                <th className="py-2 font-medium">Damaged</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {items.map((item) => (
                <tr key={item.delivery_item_id}>
                  <td className="py-2 pr-4 text-ink-800">
                    {item.product_name ?? 'Unknown product'}
                    {item.pack_name ? <span className="text-ink-400"> ({item.pack_name})</span> : null}
                  </td>
                  <td className="py-2 pr-4 text-ink-600">{item.quantity_ordered}</td>
                  <td className="py-2 pr-4 text-ink-600">{item.quantity_delivered}</td>
                  <td className="py-2 pr-4 text-ink-600">{item.quantity_missing}</td>
                  <td className="py-2 text-ink-600">{item.quantity_damaged}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <DeliveryExecutionForm
        orderId={order.id}
        orderNumber={order.order_number}
        items={items.map((item) => ({
          orderItemId: item.order_item_id,
          productName: item.product_name ?? 'Unknown product',
          packName: item.pack_name,
          quantityOrdered: item.quantity_ordered,
          lineTotal: item.line_total,
        }))}
        status={delivery.delivery_status}
        canExecute={canExecute}
        basePath="/salesman/deliveries"
      />

      {delivery.delivery_notes ? (
        <Card className="p-5">
          <h2 className="text-base font-semibold text-ink-950">Delivery notes</h2>
          <p className="mt-2 whitespace-pre-line text-sm text-ink-600">{delivery.delivery_notes}</p>
        </Card>
      ) : null}
    </div>
  );
}
