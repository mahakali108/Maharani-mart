'use client';

/**
 * Admin finance controls for a pending payment collection: verify (credits
 * the retailer's wallet through the ledger) or reject (credits nothing).
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';

import { rejectCollectionAction, verifyCollectionAction } from '@/lib/admin/collections-actions';
import { Button } from '@/components/ui/button';

export function CollectionReviewButtons({ collectionId }: { collectionId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState('');

  function verify() {
    setError(null);
    startTransition(async () => {
      const result = await verifyCollectionAction(collectionId);
      if ('error' in result) setError(result.error);
      else router.refresh();
    });
  }

  function reject() {
    setError(null);
    startTransition(async () => {
      const result = await rejectCollectionAction(collectionId, reason);
      if ('error' in result) setError(result.error);
      else {
        setShowReject(false);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-2">
      {error ? <p className="text-xs text-primary-700">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={isPending} onClick={verify}>
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          Verify &amp; credit wallet
        </Button>
        <Button size="sm" variant="outline" disabled={isPending} onClick={() => setShowReject((v) => !v)}>
          <XCircle className="h-4 w-4" />
          Reject
        </Button>
      </div>
      {showReject ? (
        <div className="space-y-2 rounded-xl border border-primary-200 bg-primary-50/50 p-2">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Reason (3–500 characters) — e.g. cash not received at office"
            className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <Button size="sm" variant="secondary" disabled={isPending || reason.trim().length < 3} onClick={reject}>
            Confirm rejection
          </Button>
        </div>
      ) : null}
    </div>
  );
}
