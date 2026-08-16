'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { XCircle, RotateCcw, Undo2 } from 'lucide-react';
import { cancelOrderAction, requestReturnAction } from '@/lib/retailer/order-actions';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export function RetailerOrderActions({ orderId, status }: { orderId: string; status: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [showCancelForm, setShowCancelForm] = useState(false);
  const [showReturnForm, setShowReturnForm] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [returnReason, setReturnReason] = useState('');

  const canCancel = status === 'pending';
  const canReturn = status === 'delivered';

  function handleCancel() {
    setError(null);
    startTransition(async () => {
      const result = await cancelOrderAction(orderId, cancelReason);
      if ('error' in result && result.error) {
        setError(result.error);
      } else {
        setShowCancelForm(false);
        router.refresh();
      }
    });
  }

  function handleReturnRequest() {
    setError(null);
    startTransition(async () => {
      const result = await requestReturnAction(orderId, null, returnReason);
      if ('error' in result && result.error) {
        setError(result.error);
      } else {
        setShowReturnForm(false);
        setNotice('Return request submitted. Your distributor will review it.');
        router.refresh();
      }
    });
  }

  return (
    <Card className="space-y-3">
      <CardHeader>
        <CardTitle>Order actions</CardTitle>
      </CardHeader>

      {error ? (
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">{error}</div>
      ) : null}
      {notice ? (
        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{notice}</div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Link href={`/retailer/orders/${orderId}/reorder`}>
          <Button variant="outline" size="sm">
            <RotateCcw className="h-4 w-4" />
            Reorder
          </Button>
        </Link>

        {canCancel ? (
          <Button variant="outline" size="sm" disabled={isPending} onClick={() => setShowCancelForm((s) => !s)}>
            <XCircle className="h-4 w-4" />
            Cancel order
          </Button>
        ) : null}

        {canReturn ? (
          <Button variant="outline" size="sm" disabled={isPending} onClick={() => setShowReturnForm((s) => !s)}>
            <Undo2 className="h-4 w-4" />
            Request return
          </Button>
        ) : null}
      </div>

      {showCancelForm ? (
        <div className="space-y-2 rounded-xl border border-dashed border-ink-200 p-3">
          <textarea
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            rows={2}
            placeholder="Why are you cancelling this order? (optional)"
            className="w-full rounded-xl border border-ink-200 bg-white px-3.5 py-2.5 text-sm text-ink-900 placeholder:text-ink-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary-600"
          />
          <Button size="sm" disabled={isPending} onClick={handleCancel}>
            Confirm cancellation
          </Button>
        </div>
      ) : null}

      {showReturnForm ? (
        <div className="space-y-2 rounded-xl border border-dashed border-ink-200 p-3">
          <textarea
            value={returnReason}
            onChange={(e) => setReturnReason(e.target.value)}
            rows={2}
            placeholder="Describe the issue with this order…"
            className="w-full rounded-xl border border-ink-200 bg-white px-3.5 py-2.5 text-sm text-ink-900 placeholder:text-ink-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary-600"
          />
          <Button size="sm" disabled={isPending || !returnReason.trim()} onClick={handleReturnRequest}>
            Submit return request
          </Button>
        </div>
      ) : null}
    </Card>
  );
      }
