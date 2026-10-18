'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { sellerUpdateSubOrderAction } from '@/lib/seller/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function SellerSubOrderActions({
  subOrderId,
  status,
  fulfilmentType,
  initialCourier,
  initialAwb,
}: {
  subOrderId: string;
  status: string;
  fulfilmentType: 'seller' | 'maharani';
  initialCourier?: string | null;
  initialAwb?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [courier, setCourier] = useState(initialCourier ?? '');
  const [awb, setAwb] = useState(initialAwb ?? '');
  const [error, setError] = useState<string | null>(null);

  if (fulfilmentType !== 'seller') {
    return (
      <p className="text-xs text-slate-500">
        Maharani-fulfilled sub-order — warehouse &amp; delivery managed by Maharani Traders.
      </p>
    );
  }

  const canConfirm = status === 'pending';
  const canProcess = status === 'confirmed';
  const canShip = status === 'confirmed' || status === 'processing';
  const canCancel = status === 'pending' || status === 'confirmed' || status === 'processing';

  if (!canConfirm && !canProcess && !canShip && !canCancel) {
    return null;
  }

  function runTransition(nextStatus: 'confirmed' | 'processing' | 'shipped' | 'cancelled') {
    setError(null);
    startTransition(async () => {
      const result = await sellerUpdateSubOrderAction(subOrderId, nextStatus, courier, awb);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-3 border-t border-slate-100 pt-3">
      {error ? (
        <p role="alert" className="rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-xs text-primary-700">
          {error}
        </p>
      ) : null}

      {canShip ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            placeholder="Courier / transport name"
            value={courier}
            onChange={(e) => setCourier(e.target.value)}
            disabled={pending}
          />
          <Input
            placeholder="AWB / LR / tracking number"
            value={awb}
            onChange={(e) => setAwb(e.target.value)}
            disabled={pending}
          />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {canConfirm ? (
          <Button type="button" size="sm" disabled={pending} onClick={() => runTransition('confirmed')}>
            Confirm sub-order
          </Button>
        ) : null}
        {canProcess ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => runTransition('processing')}
          >
            Mark packed / processing
          </Button>
        ) : null}
        {canShip ? (
          <Button type="button" size="sm" disabled={pending} onClick={() => runTransition('shipped')}>
            Mark shipped
          </Button>
        ) : null}
        {canCancel ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => runTransition('cancelled')}
          >
            Cancel &amp; restore stock
          </Button>
        ) : null}
      </div>
    </div>
  );
}
