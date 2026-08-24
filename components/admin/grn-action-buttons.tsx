'use client';

import { useState, useTransition } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { confirmGrnAction, cancelGrnAction } from '@/lib/admin/grn-actions';
import { Button } from '@/components/ui/button';

/**
 * Confirm / cancel controls for a DRAFT GRN. Confirmation runs the
 * idempotent confirm_grn RPC — clicking twice can never double-receive.
 */
export function GrnActionButtons({ grnId }: { grnId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  function onConfirm() {
    setError(null);
    startTransition(async () => {
      const result = await confirmGrnAction(grnId);
      if (result?.error) setError(result.error);
    });
  }

  function onCancel() {
    setError(null);
    startTransition(async () => {
      const result = await cancelGrnAction(grnId, cancelReason);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <div className="space-y-3">
      {error ? (
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">{error}</div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button onClick={onConfirm} disabled={isPending || confirmingCancel}>
          <CheckCircle2 className="h-4 w-4" />
          {isPending ? 'Working…' : 'Confirm GRN (adds stock)'}
        </Button>
        {!confirmingCancel ? (
          <Button variant="outline" onClick={() => setConfirmingCancel(true)} disabled={isPending}>
            <XCircle className="h-4 w-4" /> Cancel GRN
          </Button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Reason (optional)"
              className="h-11 w-56 rounded-xl border border-ink-200 bg-white px-3 text-sm"
            />
            <Button variant="outline" onClick={onCancel} disabled={isPending}>
              Confirm cancel
            </Button>
            <Button variant="ghost" onClick={() => setConfirmingCancel(false)} disabled={isPending}>
              Keep draft
            </Button>
          </div>
        )}
      </div>
      <p className="text-xs text-ink-400">
        Confirming creates/updates batches and books GRN_RECEIPT movements. It is safe to retry — a repeated
        confirmation never adds stock twice. Cancelled GRNs cannot be confirmed.
      </p>
    </div>
  );
}
