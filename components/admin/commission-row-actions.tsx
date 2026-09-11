'use client';

import { useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { approveCommissionAction, markCommissionPaidAction } from '@/lib/admin/commissions-actions';

/**
 * Lifecycle buttons: draft → approved → paid. Each button only renders for
 * its valid predecessor state; the server re-checks the transition.
 */
export function CommissionRowActions({ commissionId, status }: { commissionId: string; status: string }) {
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
        {status === 'draft' ? (
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => approveCommissionAction(commissionId))}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-50 px-2.5 py-1 text-xs font-medium text-primary-700 transition-colors hover:bg-primary-100 disabled:opacity-50"
          >
            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Approve
          </button>
        ) : null}
        {status === 'approved' ? (
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => markCommissionPaidAction(commissionId))}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-50"
          >
            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Mark paid
          </button>
        ) : null}
        {status === 'paid' ? <span className="text-xs text-ink-400">Settled</span> : null}
      </div>
      {error ? <p className="text-xs text-primary-600">{error}</p> : null}
    </div>
  );
}
