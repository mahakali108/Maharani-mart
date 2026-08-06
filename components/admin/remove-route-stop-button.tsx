'use client';

import { useTransition } from 'react';
import { X, Loader2 } from 'lucide-react';
import { removeRetailerFromRouteAction } from '@/lib/admin/routes-actions';

export function RemoveRouteStopButton({ routeCustomerId, routeId }: { routeCustomerId: string; routeId: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => {
        if (confirm('Remove this retailer from the route?')) {
          startTransition(() =>
            removeRetailerFromRouteAction(routeCustomerId, routeId).catch((err) =>
              alert(err instanceof Error ? err.message : 'Failed to remove.')
            )
          );
        }
      }}
      className="rounded-lg p-1.5 text-ink-400 hover:bg-primary-50 hover:text-primary-600 disabled:opacity-50"
      aria-label="Remove from route"
    >
      {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
    </button>
  );
}
