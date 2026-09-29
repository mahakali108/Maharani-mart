'use client';

import { useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { approveOrderAction, cancelOrderAction, updateOrderStatusAction } from '@/lib/admin/orders-actions';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

const NEXT_STATUS: Record<string, string | null> = {
  confirmed: 'processing',
  processing: 'packed',
};

export function AdminOrderActions({
  orderId,
  status,
}: {
  orderId: string;
  status: string;
}) {
  const [cancelReason, setCancelReason] = useState('');
  const [showCancelForm, setShowCancelForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function run(action: () => Promise<{ error?: string } | { success: true }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if ('error' in result && result.error) setError(result.error);
    });
  }

  const canCancel = status !== 'dispatched' && status !== 'delivered' && status !== 'cancelled' && status !== 'returned';
  const nextStatus = NEXT_STATUS[status];

  return (
    <Card className="space-y-4">
      {error ? (
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">{error}</div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {status === 'pending' ? (
          <Button size="sm" disabled={isPending} onClick={() => run(() => approveOrderAction(orderId))}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Approve order
          </Button>
        ) : null}

        {nextStatus ? (
          <Button
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => run(() => updateOrderStatusAction(orderId, nextStatus as never))}
          >
            Mark as {nextStatus}
          </Button>
        ) : null}

        {canCancel ? (
          <Button size="sm" variant="outline" disabled={isPending} onClick={() => setShowCancelForm((s) => !s)}>
            Cancel order
          </Button>
        ) : null}
      </div>

      {showCancelForm ? (
        <div className="space-y-2 rounded-xl border border-dashed border-ink-200 p-3">
          <Label htmlFor="cancelReason">Cancellation reason</Label>
          <textarea
            id="cancelReason"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            rows={2}
            className="w-full rounded-xl border border-ink-200 bg-white px-3.5 py-2.5 text-sm text-ink-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary-600"
          />
          <Button
            size="sm"
            disabled={isPending || !cancelReason.trim()}
            onClick={() => run(() => cancelOrderAction(orderId, cancelReason))}
          >
            Confirm cancellation
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
