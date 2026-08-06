'use client';

import { useTransition } from 'react';
import { Loader2, XCircle } from 'lucide-react';
import { deactivatePriceListAction } from '@/lib/admin/pricing-actions';

export function DeactivatePriceButton({ priceListId }: { priceListId: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => {
        if (confirm('Deactivate this price? It will no longer apply to new orders.')) {
          startTransition(() =>
            deactivatePriceListAction(priceListId).catch((err) =>
              alert(err instanceof Error ? err.message : 'Failed to deactivate.')
            )
          );
        }
      }}
      className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-ink-500 hover:bg-primary-50 hover:text-primary-600 disabled:opacity-50"
    >
      {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
      Deactivate
    </button>
  );
}
