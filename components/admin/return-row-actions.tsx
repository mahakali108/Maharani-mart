'use client';

import { useState, useTransition } from 'react';
import { Loader2, Check, X } from 'lucide-react';
import { approveReturnAction, rejectReturnAction } from '@/lib/admin/returns-actions';
import { Button } from '@/components/ui/button';

export function ReturnRowActions({ returnId }: { returnId: string }) {
  const [note, setNote] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleApprove() {
    setError(null);
    startTransition(async () => {
      const result = await approveReturnAction(returnId, note);
      if ('error' in result && result.error) setError(result.error);
    });
  }

  function handleReject() {
    setError(null);
    startTransition(async () => {
      const result = await rejectReturnAction(returnId, note);
      if ('error' in result && result.error) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      {error ? <p className="text-xs text-primary-600">{error}</p> : null}
      {showReject ? (
        <div className="flex flex-col items-end gap-1.5">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Reason for rejection"
            className="w-48 rounded-lg border border-ink-200 px-2 py-1.5 text-xs focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary-600"
          />
          <Button size="sm" variant="outline" disabled={isPending || !note.trim()} onClick={handleReject}>
            Confirm reject
          </Button>
        </div>
      ) : (
        <div className="flex gap-1.5">
          <Button size="sm" disabled={isPending} onClick={handleApprove}>
            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Approve
          </Button>
          <Button size="sm" variant="outline" disabled={isPending} onClick={() => setShowReject(true)}>
            <X className="h-3.5 w-3.5" />
            Reject
          </Button>
        </div>
      )}
    </div>
  );
}
