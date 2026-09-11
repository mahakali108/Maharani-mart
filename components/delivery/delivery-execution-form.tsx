'use client';

/**
 * Delivery execution form (Phase 4) — used by both the staff and salesman
 * delivery workspaces.
 *
 * The staff member must obtain the 6-digit OTP FROM THE RETAILER (it is
 * never shown in this UI) and record exactly what was handed over per
 * order line. Missing/damaged quantities are credited back to the
 * retailer's wallet automatically on submit. Signature and photo proofs
 * are uploaded through the media pipeline into the PRIVATE
 * `delivery-proofs` bucket.
 */

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Loader2, PackageX, Signature, Upload, X } from 'lucide-react';

import {
  completeDeliveryAction,
  recordFailedDeliveryAction,
  startDeliveryAction,
} from '@/lib/delivery/delivery-actions';
import { MediaUploadField } from '@/components/media/media-upload-field';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export interface ExecutionItem {
  orderItemId: string;
  productName: string;
  packName: string | null;
  quantityOrdered: number;
  lineTotal: number;
}

interface ItemQuantities {
  delivered: string;
  missing: string;
  damaged: string;
}

export function DeliveryExecutionForm({
  orderId,
  orderNumber,
  items,
  status,
  canExecute,
  basePath,
}: {
  orderId: string;
  orderNumber: string;
  items: ExecutionItem[];
  status: string;
  canExecute: boolean;
  basePath: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [otp, setOtp] = useState('');
  const [receiverName, setReceiverName] = useState('');
  const [notes, setNotes] = useState('');
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [showFailure, setShowFailure] = useState(false);
  const [failureReason, setFailureReason] = useState('');

  const [quantities, setQuantities] = useState<Record<string, ItemQuantities>>(() =>
    Object.fromEntries(
      items.map((item) => [
        item.orderItemId,
        { delivered: String(item.quantityOrdered), missing: '0', damaged: '0' },
      ])
    )
  );

  const isFailed = status === 'failed';
  const canStart = canExecute && status === 'assigned';
  const canComplete = canExecute && (status === 'assigned' || status === 'in_progress');

  const { allLinesValid, hasShortfall } = useMemo(() => {
    let valid = true;
    let shortfall = false;
    for (const item of items) {
      const q = quantities[item.orderItemId];
      const delivered = Number(q?.delivered ?? '');
      const missing = Number(q?.missing ?? '');
      const damaged = Number(q?.damaged ?? '');
      const total = delivered + missing + damaged;
      if (
        !Number.isInteger(delivered) || !Number.isInteger(missing) || !Number.isInteger(damaged) ||
        delivered < 0 || missing < 0 || damaged < 0 ||
        total !== item.quantityOrdered
      ) {
        valid = false;
      }
      if (Number.isInteger(missing) && Number.isInteger(damaged) && missing + damaged > 0) shortfall = true;
    }
    return { allLinesValid: valid, hasShortfall: shortfall };
  }, [items, quantities]);

  function updateQuantity(orderItemId: string, field: keyof ItemQuantities, value: string) {
    if (!/^\d*$/.test(value)) return;
    setQuantities((prev) => ({ ...prev, [orderItemId]: { ...prev[orderItemId]!, [field]: value } }));
  }

  function runAction(action: () => Promise<{ error: string } | { success: true; message?: string }>, redirectToBase: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if ('error' in result) {
        setError(result.error);
        return;
      }
      if (redirectToBase) {
        router.push(basePath);
      } else {
        router.refresh();
      }
    });
  }

  if (!canExecute && !isFailed) return null;

  return (
    <Card className="space-y-5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-ink-950">Complete delivery</h2>
        {hasShortfall ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
            <AlertTriangle className="h-3.5 w-3.5" />
            Shortfall will be credited back to the retailer
          </span>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">{error}</div>
      ) : null}

      {canStart ? (
        <Button
          disabled={isPending}
          onClick={() =>
            runAction(() => startDeliveryAction(orderId), false)
          }
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          Start delivery
        </Button>
      ) : null}

      {canComplete ? (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="receiver" className="text-xs font-medium text-ink-600">
                Received by (name at the shop) *
              </label>
              <Input
                id="receiver"
                value={receiverName}
                onChange={(e) => setReceiverName(e.target.value)}
                placeholder="e.g. Ramesh (owner)"
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="otp" className="text-xs font-medium text-ink-600">
                OTP from the retailer (6 digits) *
              </label>
              <Input
                id="otp"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="Ask the retailer for their OTP"
                inputMode="numeric"
                className="font-mono tracking-widest"
              />
              <p className="text-[11px] text-ink-400">
                The OTP was sent to the retailer when the order was dispatched. Never accept it before handing over the goods.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-ink-600">Delivered / missing / damaged per line *</p>
            <div className="space-y-2">
              {items.map((item) => {
                const q = quantities[item.orderItemId] ?? { delivered: '0', missing: '0', damaged: '0' };
                const total = Number(q.delivered) + Number(q.missing) + Number(q.damaged);
                const lineOk = total === item.quantityOrdered;
                return (
                  <div
                    key={item.orderItemId}
                    className={`rounded-xl border p-3 ${lineOk ? 'border-ink-100' : 'border-amber-300 bg-amber-50/50'}`}
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-1">
                      <p className="min-w-0 break-words text-sm font-medium text-ink-800">
                        {item.productName}
                        {item.packName ? <span className="text-ink-400"> ({item.packName})</span> : null}
                      </p>
                      <p className="text-xs text-ink-500">Ordered: {item.quantityOrdered}</p>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      <div>
                        <label className="text-[11px] text-green-700">Delivered</label>
                        <Input
                          value={q.delivered}
                          onChange={(e) => updateQuantity(item.orderItemId, 'delivered', e.target.value)}
                          inputMode="numeric"
                          className="h-9"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] text-amber-700">Missing</label>
                        <Input
                          value={q.missing}
                          onChange={(e) => updateQuantity(item.orderItemId, 'missing', e.target.value)}
                          inputMode="numeric"
                          className="h-9"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] text-primary-700">Damaged</label>
                        <Input
                          value={q.damaged}
                          onChange={(e) => updateQuantity(item.orderItemId, 'damaged', e.target.value)}
                          inputMode="numeric"
                          className="h-9"
                        />
                      </div>
                    </div>
                    {!lineOk ? (
                      <p className="mt-1.5 text-[11px] text-amber-700">
                        Delivered + missing + damaged must equal {item.quantityOrdered} (currently {total}).
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="notes" className="text-xs font-medium text-ink-600">
              Delivery notes (optional)
            </label>
            <textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              maxLength={1000}
              className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="Anything worth recording about this delivery…"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 rounded-xl border border-ink-100 p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-ink-600">
                <Signature className="h-3.5 w-3.5" /> Receiver&apos;s signature (optional)
              </p>
              {signatureUrl ? (
                <div className="flex items-center justify-between gap-2 text-xs text-green-700">
                  <span>Signature captured</span>
                  <button type="button" onClick={() => setSignatureUrl(null)} className="text-primary-600 hover:underline">
                    Remove
                  </button>
                </div>
              ) : (
                <MediaUploadField
                  kind="delivery-proof"
                  ownerId={orderId}
                  onUploaded={(media) => setSignatureUrl(media.ref)}
                  label="Capture signature"
                  replaceLabel="Retake"
                />
              )}
            </div>
            <div className="space-y-1.5 rounded-xl border border-ink-100 p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-ink-600">
                <Upload className="h-3.5 w-3.5" /> Delivery photo (optional)
              </p>
              {photoUrl ? (
                <div className="flex items-center justify-between gap-2 text-xs text-green-700">
                  <span>Photo attached</span>
                  <button type="button" onClick={() => setPhotoUrl(null)} className="text-primary-600 hover:underline">
                    Remove
                  </button>
                </div>
              ) : (
                <MediaUploadField
                  kind="delivery-proof"
                  ownerId={orderId}
                  onUploaded={(media) => setPhotoUrl(media.ref)}
                  label="Attach photo"
                  replaceLabel="Replace photo"
                />
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              disabled={isPending || !allLinesValid || otp.length !== 6 || receiverName.trim().length < 2}
              onClick={() =>
                runAction(
                  () =>
                    completeDeliveryAction(orderId, {
                      otp,
                      receiverName,
                      notes,
                      signatureUrl,
                      photoUrl,
                      items: items.map((item) => ({
                        orderItemId: item.orderItemId,
                        delivered: Number(quantities[item.orderItemId]?.delivered ?? '0'),
                        missing: Number(quantities[item.orderItemId]?.missing ?? '0'),
                        damaged: Number(quantities[item.orderItemId]?.damaged ?? '0'),
                      })),
                    }),
                  true
                )
              }
            >
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Record delivery of {orderNumber}
            </Button>
            <Button
              variant="outline"
              disabled={isPending}
              onClick={() => {
                setShowFailure((v) => !v);
                setError(null);
              }}
            >
              <PackageX className="h-4 w-4" />
              Could not deliver
            </Button>
          </div>

          {showFailure ? (
            <div className="space-y-2 rounded-xl border border-primary-200 bg-primary-50/50 p-3">
              <label htmlFor="failure" className="text-xs font-medium text-primary-800">
                Why could this delivery not be completed? (3–500 characters)
              </label>
              <textarea
                id="failure"
                value={failureReason}
                onChange={(e) => setFailureReason(e.target.value)}
                rows={2}
                maxLength={500}
                className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="e.g. Shop closed, retailer refused, address not found…"
              />
              <p className="text-[11px] text-primary-700">
                The order will go back to the warehouse queue and be re-attempted after a fresh dispatch.
              </p>
              <Button
                variant="secondary"
                disabled={isPending || failureReason.trim().length < 3}
                onClick={() => runAction(() => recordFailedDeliveryAction(orderId, failureReason), true)}
              >
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                Mark delivery as failed
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {isFailed ? (
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">
          This delivery attempt failed. The order has been returned to the warehouse queue — a new dispatch will
          re-assign this task.
        </div>
      ) : null}
    </Card>
  );
}
