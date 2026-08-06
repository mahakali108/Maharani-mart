'use client';

import { useState, useTransition } from 'react';
import { Loader2, Truck } from 'lucide-react';
import { dispatchOrderAction } from '@/lib/staff/dispatch-actions';
import { Button } from '@/components/ui/button';

export function DispatchButton({ orderId }: { orderId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="space-y-2">
      {error ? (
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">{error}</div>
      ) : null}
      <Button
        className="w-full"
        disabled={isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await dispatchOrderAction(orderId);
            if ('error' in result && result.error) setError(result.error);
          });
        }}
      >
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />}
        {isPending ? 'Dispatching…' : 'Mark as dispatched'}
      </Button>
    </div>
  );
}
