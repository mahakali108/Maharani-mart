'use client';

import { useState, useTransition } from 'react';
import { Loader2, PackageCheck, Boxes } from 'lucide-react';
import { markProcessingAction, markPackedAction } from '@/lib/staff/pick-pack-actions';

/**
 * Pick/pack controls for the staff order detail. Only the button for the
 * valid NEXT state renders; the server re-validates the transition.
 */
export function PickPackButtons({ orderId, status }: { orderId: string; status: string }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function run(action: () => Promise<{ error?: string } | { success: true }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if ('error' in result && result.error) setError(result.error);
    });
  }

  return (
    <div className="space-y-2">
      {error ? (
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">{error}</div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {status === 'confirmed' ? (
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => markProcessingAction(orderId))}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Boxes className="h-4 w-4" />}
            Start picking
          </button>
        ) : null}
        {status === 'processing' ? (
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => markPackedAction(orderId))}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
            Mark packed
          </button>
        ) : null}
      </div>
    </div>
  );
}
