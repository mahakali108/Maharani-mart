'use client';

import { useState, useTransition } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { cancelFollowUpAction, completeFollowUpAction } from '@/lib/salesman/followup-actions';

/** Complete / cancel controls for one open follow-up row. */
export function FollowUpButtons({ followUpId }: { followUpId: string }) {
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
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1.5">
        <button
          type="button"
          disabled={isPending}
          onClick={() => run(() => completeFollowUpAction(followUpId))}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-50"
        >
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Done
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            if (!window.confirm('Cancel this reminder?')) return;
            run(() => cancelFollowUpAction(followUpId));
          }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-ink-100 px-2.5 py-1 text-xs font-medium text-ink-500 transition-colors hover:bg-ink-200 disabled:opacity-50"
        >
          <X className="h-3.5 w-3.5" />
          Cancel
        </button>
      </div>
      {error ? <p className="text-xs text-primary-600">{error}</p> : null}
    </div>
  );
}
