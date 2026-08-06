'use client';

import { useState, useTransition } from 'react';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { markDeliveredAction } from '@/lib/salesman/orders-actions';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

export function MarkDeliveredButton({ orderId }: { orderId: string }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="space-y-2">
      {error ? (
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">{error}</div>
      ) : null}

      <div>
        <Label htmlFor="deliveryNote">Delivery note (optional)</Label>
        <textarea
          id="deliveryNote"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="e.g. received by shop staff, left at counter"
          className="w-full rounded-xl border border-ink-200 bg-white px-3.5 py-2.5 text-sm text-ink-900 placeholder:text-ink-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary-600"
        />
      </div>

      <Button
        className="w-full"
        disabled={isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await markDeliveredAction(orderId, note);
            if ('error' in result && result.error) setError(result.error);
          });
        }}
      >
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
        {isPending ? 'Updating…' : 'Mark as delivered'}
      </Button>
    </div>
  );
}
