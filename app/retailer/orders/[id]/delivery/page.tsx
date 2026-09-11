import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ImageOff, KeyRound, MapPin, PackageCheck, RefreshCcw } from 'lucide-react';
import { requireUser } from '@/lib/auth/session';
import { fetchDeliveryDetail } from '@/lib/delivery/queries';
import { resolveProofUrl } from '@/lib/delivery/proof-url';
import { isReturnWindowOpen } from '@/lib/delivery/return-window';
import { DeliveryStatusBadge } from '@/components/delivery/delivery-status-badge';
import { Card } from '@/components/ui/card';
import { formatIndiaDate, formatIndiaDateTime } from '@/lib/datetime/india';

/**
 * Retailer-facing delivery record (Phase 4): who delivered, when, who
 * received it, whether the OTP was verified, what was actually handed over,
 * the return window, and reorder. Read-only — retailers can never edit
 * delivery data (RLS: order_deliveries_read only).
 */
export default async function RetailerDeliveryPage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user.role !== 'retailer') notFound();

  const detail = await fetchDeliveryDetail(params.id);
  if (!detail || detail.order.retailer_id !== user.id) notFound();

  const { delivery, order, items } = detail;
  const [signatureUrl, photoUrl] = await Promise.all([
    resolveProofUrl(delivery.signature_url),
    resolveProofUrl(delivery.photo_url),
  ]);
  const windowOpen = delivery.return_deadline ? isReturnWindowOpen(delivery.return_deadline) : null;
  const isOpen = delivery.delivery_status === 'assigned' || delivery.delivery_status === 'in_progress';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={`/retailer/orders/${order.id}`}
          className="rounded-xl border border-ink-200 p-2 text-ink-500 hover:text-ink-900"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0">
          <h1 className="font-mono text-xl font-semibold text-ink-950">{order.order_number}</h1>
          <p className="text-sm text-ink-500">Delivery record</p>
        </div>
        <DeliveryStatusBadge status={delivery.delivery_status} />
      </div>

      {isOpen ? (
        <Card className="space-y-2 border-cyan-200 bg-cyan-50/60 p-5">
          <p className="flex items-center gap-2 text-sm font-medium text-cyan-800">
            <KeyRound className="h-4 w-4" /> Your delivery OTP
          </p>
          <p className="text-sm text-cyan-800">
            The one-time password was sent to your notifications when the order was dispatched. Share it with the
            delivery person <strong>only after</strong> you have received your goods — it confirms the delivery.
          </p>
          <p className="text-xs text-cyan-700">
            Lost it? Check your notification centre or ask the delivery person to have the office resend it.
          </p>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="space-y-3 p-5">
          <h2 className="text-base font-semibold text-ink-950">Delivery summary</h2>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-500">Delivery person</dt>
              <dd className="text-right text-ink-800">{delivery.assigned_name ?? 'Being assigned'}</dd>
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
              <dt className="text-ink-500">OTP verification</dt>
              <dd className={`text-right font-medium ${delivery.otp_verified_at ? 'text-green-700' : 'text-ink-800'}`}>
                {delivery.otp_verified_at ? 'Verified at handover' : 'Not yet verified'}
              </dd>
            </div>
          </dl>
          {delivery.failure_reason ? (
            <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">
              <p className="font-medium">Last attempt could not be completed</p>
              <p>{delivery.failure_reason}</p>
              <p className="mt-1 text-xs">Your order is back in the warehouse queue and will be re-attempted.</p>
            </div>
          ) : null}
        </Card>

        <Card className="space-y-3 p-5">
          <h2 className="text-base font-semibold text-ink-950">Address &amp; return window</h2>
          <p className="flex items-start gap-2 text-sm text-ink-600">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
            {order.shipping_address?.line ?? 'No address snapshot on this order.'}
          </p>
          {delivery.return_deadline ? (
            <div className="border-t border-ink-100 pt-2 text-sm">
              <p className={windowOpen ? 'font-medium text-green-700' : 'font-medium text-primary-700'}>
                {windowOpen
                  ? `You can request a return until ${formatIndiaDate(delivery.return_deadline)} (inclusive).`
                  : `The return window closed on ${formatIndiaDate(delivery.return_deadline)}.`}
              </p>
              {windowOpen ? (
                <Link
                  href={`/retailer/orders/${order.id}`}
                  className="mt-1 inline-block text-xs text-primary-600 hover:underline"
                >
                  Request a return from the order page →
                </Link>
              ) : null}
            </div>
          ) : null}
          {delivery.delivery_status === 'delivered' || delivery.delivery_status === 'partially_delivered' ? (
            <div className="border-t border-ink-100 pt-2">
              <Link
                href={`/retailer/orders/${order.id}/reorder`}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:underline"
              >
                <RefreshCcw className="h-3.5 w-3.5" /> Reorder these items
              </Link>
            </div>
          ) : null}
        </Card>
      </div>

      <Card className="space-y-3 p-5">
        <h2 className="text-base font-semibold text-ink-950">What was delivered</h2>
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
        {items.some((item) => item.quantity_missing > 0 || item.quantity_damaged > 0) ? (
          <p className="rounded-xl bg-amber-50 px-4 py-3 text-xs text-amber-700">
            Missing or damaged items are automatically credited back to your wallet — you never pay for goods you did
            not receive. Check your ledger for the shortfall credit.
          </p>
        ) : null}
      </Card>

      {delivery.delivery_notes ? (
        <Card className="p-5">
          <h2 className="text-base font-semibold text-ink-950">Delivery notes</h2>
          <p className="mt-2 whitespace-pre-line text-sm text-ink-600">{delivery.delivery_notes}</p>
        </Card>
      ) : null}

      <Card className="space-y-3 p-5">
        <h2 className="flex items-center gap-2 text-base font-semibold text-ink-950">
          <PackageCheck className="h-4 w-4" /> Proof of delivery
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
                <figcaption className="text-xs text-ink-400">Signature at handover</figcaption>
              </figure>
            ) : null}
            {photoUrl ? (
              <figure className="space-y-1.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photoUrl} alt="Delivery photo" className="w-full rounded-xl border border-ink-100 bg-white object-contain" />
                <figcaption className="text-xs text-ink-400">Delivery photo</figcaption>
              </figure>
            ) : null}
          </div>
        ) : (
          <p className="flex items-center gap-2 text-sm text-ink-400">
            <ImageOff className="h-4 w-4" /> No signature or photo was recorded for this delivery.
          </p>
        )}
      </Card>
    </div>
  );
}
