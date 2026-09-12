import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, FileText, ImageOff, KeyRound, MapPin, PackageCheck } from 'lucide-react';
import { requirePermission } from '@/lib/admin/guard';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions/permissions';
import { fetchDeliveryDetail } from '@/lib/delivery/queries';
import { resolveProofUrl } from '@/lib/delivery/proof-url';
import { computePartialSettlement } from '@/lib/delivery/settlement';
import { isReturnWindowOpen } from '@/lib/delivery/return-window';
import { DeliveryStatusBadge } from '@/components/delivery/delivery-status-badge';
import { DeliveryAssignmentPanel } from '@/components/admin/delivery-assignment-panel';
import { Card } from '@/components/ui/card';
import { formatIndiaDate, formatIndiaDateTime } from '@/lib/datetime/india';

export default async function AdminDeliveredDetailPage({ params }: { params: { orderId: string } }) {
  const user = await requirePermission('orders.view.all');
  const detail = await fetchDeliveryDetail(params.orderId);
  if (!detail) notFound();

  const { delivery, order, items } = detail;
  const supabase = createClient();

  // Assignment options for the control panel.
  const { data: staffProfiles } = await supabase
    .from('profiles')
    .select('id, full_name, role')
    .in('role', ['staff', 'salesman'])
    .eq('is_active', true)
    .order('full_name');
  const staffOptions = (staffProfiles ?? []) as { id: string; full_name: string; role: string }[];

  const [signatureUrl, photoUrl] = await Promise.all([
    resolveProofUrl(delivery.signature_url),
    resolveProofUrl(delivery.photo_url),
  ]);

  const settlement = computePartialSettlement(
    items.map((item) => ({
      lineTotalPaise: item.line_total,
      quantityOrdered: item.quantity_ordered,
      quantityMissing: item.quantity_missing,
      quantityDamaged: item.quantity_damaged,
    }))
  );

  const windowOpen = delivery.return_deadline ? isReturnWindowOpen(delivery.return_deadline) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/admin/delivered" className="rounded-xl border border-ink-200 p-2 text-ink-500 hover:text-ink-900">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0">
          <h1 className="font-mono text-xl font-semibold text-ink-950">{order.order_number}</h1>
          <p className="text-sm text-ink-500">
            {order.shop_name ?? '—'} · placed {order.placed_at ? formatIndiaDateTime(order.placed_at) : '—'}
          </p>
        </div>
        <DeliveryStatusBadge status={delivery.delivery_status} />
        <Link
          href={`/admin/orders/${order.id}`}
          className="ml-auto inline-flex items-center gap-1.5 rounded-xl border border-ink-200 px-3 py-1.5 text-xs font-medium text-ink-600 hover:text-ink-900"
        >
          <FileText className="h-3.5 w-3.5" /> Open order
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="space-y-3 p-5">
          <h2 className="text-base font-semibold text-ink-950">Delivery record</h2>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-500">Delivery person</dt>
              <dd className="text-right text-ink-800">{delivery.assigned_name ?? 'Unassigned'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-500">Dispatched</dt>
              <dd className="text-right text-ink-800">
                {delivery.dispatched_at ? formatIndiaDateTime(delivery.dispatched_at) : '—'}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-500">Delivered</dt>
              <dd className="text-right text-ink-800">
                {delivery.delivered_at ? formatIndiaDateTime(delivery.delivered_at) : '—'}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-500">Received by</dt>
              <dd className="text-right text-ink-800">{delivery.receiver_name ?? '—'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-500">Completed by</dt>
              <dd className="text-right text-ink-800">{delivery.completed_by_name ?? '—'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-500">OTP verification</dt>
              <dd className={`text-right font-medium ${delivery.otp_verified_at ? 'text-green-700' : 'text-amber-700'}`}>
                {delivery.otp_verified_at ? 'Verified' : `Not verified (${delivery.otp_attempts} wrong attempts)`}
              </dd>
            </div>
          </dl>
        </Card>

        <Card className="space-y-3 p-5">
          <h2 className="text-base font-semibold text-ink-950">Address &amp; return window</h2>
          <div className="space-y-2 text-sm">
            {order.shipping_address?.receiverName ? (
              <p className="font-medium text-ink-800">{order.shipping_address.receiverName}</p>
            ) : null}
            <p className="flex items-start gap-2 text-ink-600">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
              {order.shipping_address?.line ?? 'No address snapshot on this order.'}
            </p>
            {order.shipping_address?.phone ? (
              <p className="text-ink-600">{order.shipping_address.phone}</p>
            ) : null}
            <div className="border-t border-ink-100 pt-2">
              {delivery.return_deadline ? (
                <p className={`text-sm font-medium ${windowOpen ? 'text-green-700' : 'text-primary-700'}`}>
                  {windowOpen
                    ? `Return window open until ${formatIndiaDate(delivery.return_deadline)} (inclusive)`
                    : `Return window closed on ${formatIndiaDate(delivery.return_deadline)}`}
                </p>
              ) : (
                <p className="text-sm text-ink-500">No return window recorded (order predates the deliveries module).</p>
              )}
            </div>
          </div>
        </Card>

        <Card className="space-y-3 p-5">
          <h2 className="text-base font-semibold text-ink-950">Financials</h2>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-500">Order value</dt>
              <dd className="text-ink-800">₹{(order.grand_total ?? 0).toFixed(2)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-500">Delivered value</dt>
              <dd className="text-ink-800">₹{(settlement.deliveredValuePaise / 100).toFixed(2)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-500">Shortfall credited back</dt>
              <dd className={settlement.creditBackPaise > 0 ? 'font-medium text-amber-700' : 'text-ink-800'}>
                ₹{(settlement.creditBackPaise / 100).toFixed(2)}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-500">Shortfall pieces</dt>
              <dd className="text-ink-800">{settlement.shortfallPieces}</dd>
            </div>
          </dl>
          {delivery.delivery_notes ? (
            <div className="border-t border-ink-100 pt-2">
              <p className="text-xs font-medium text-ink-600">Delivery notes</p>
              <p className="mt-1 whitespace-pre-line text-sm text-ink-600">{delivery.delivery_notes}</p>
            </div>
          ) : null}
          {delivery.failure_reason ? (
            <div className="border-t border-ink-100 pt-2">
              <p className="text-xs font-medium text-primary-700">Last failure reason</p>
              <p className="mt-1 text-sm text-primary-700">{delivery.failure_reason}</p>
            </div>
          ) : null}
        </Card>
      </div>

      <DeliveryAssignmentPanel
        orderId={order.id}
        deliveryStatus={delivery.delivery_status}
        currentAssigneeId={delivery.assigned_staff_id}
        staffOptions={staffOptions.map((s) => ({ id: s.id, fullName: s.full_name, role: s.role }))}
        canAssign={can(user.role, 'deliveries.assign')}
        canReturnToWarehouse={can(user.role, 'orders.return.manage')}
      />

      <Card className="space-y-3 p-5">
        <h2 className="text-base font-semibold text-ink-950">Delivered quantities</h2>
        <div className="table-scroll">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-ink-100 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="py-2 pr-4 font-medium">Product</th>
                <th className="py-2 pr-4 font-medium">Ordered</th>
                <th className="py-2 pr-4 font-medium">Delivered</th>
                <th className="py-2 pr-4 font-medium">Missing</th>
                <th className="py-2 pr-4 font-medium">Damaged</th>
                <th className="py-2 font-medium">Line value</th>
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
                  <td className="py-2 pr-4 text-ink-600">{item.quantity_damaged}</td>
                  <td className="py-2 text-ink-600">₹{(item.line_total / 100).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="space-y-3 p-5">
        <h2 className="flex items-center gap-2 text-base font-semibold text-ink-950">
          <KeyRound className="h-4 w-4" /> Proof of delivery
        </h2>
        {signatureUrl || photoUrl ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {signatureUrl ? (
              <figure className="space-y-1.5">
                {/* Signed URL — short-lived, so a plain img element is intentional. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={signatureUrl}
                  alt="Receiver's signature"
                  className="w-full rounded-xl border border-ink-100 bg-white object-contain"
                />
                <figcaption className="text-xs text-ink-400">Signature</figcaption>
              </figure>
            ) : null}
            {photoUrl ? (
              <figure className="space-y-1.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photoUrl}
                  alt="Delivery photo"
                  className="w-full rounded-xl border border-ink-100 bg-white object-contain"
                />
                <figcaption className="text-xs text-ink-400">Delivery photo</figcaption>
              </figure>
            ) : null}
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            <ImageOff className="h-4 w-4" />
            No signature or photo proof was attached to this delivery.
          </div>
        )}
        {!delivery.otp_verified_at ? (
          <p className="flex items-center gap-2 text-xs text-amber-700">
            <PackageCheck className="h-3.5 w-3.5" />
            This delivery was completed without OTP verification — review with the delivery person.
          </p>
        ) : null}
      </Card>
    </div>
  );
}
