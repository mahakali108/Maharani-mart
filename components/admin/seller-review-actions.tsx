'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, PauseCircle, RotateCcw, XCircle } from 'lucide-react';
import {
  reinstateSellerAction,
  reviewSellerAction,
  suspendSellerAction,
} from '@/lib/admin/seller-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Seller review controls (Super Admin only — the server actions re-check
 * `sellers.review`; hiding these buttons is not authorization).
 *
 * - `pending`   → Approve / Reject (reason required for rejection).
 * - `active`    → Suspend with reason (drain mode deactivates offers).
 * - `suspended` → Reinstate (offers stay deactivated until reviewed again).
 */
export function SellerReviewActions({
  sellerId,
  status,
  canApprove = true,
}: {
  sellerId: string;
  canApprove?: boolean;
  status: 'pending' | 'active' | 'suspended';
}) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const review = (decision: 'active' | 'rejected') => {
    if (!window.confirm(decision === 'active' ? 'Approve and activate this seller account?' : 'Reject this pending seller account?')) return;
    startTransition(async () => {
      const result = await reviewSellerAction(sellerId, decision, reason);
      if (result.ok) {
        setMessage(decision === 'active' ? 'Seller approved and activated.' : 'Seller application rejected.');
        router.refresh();
      } else {
        setMessage(result.error);
      }
    });
  };

  const suspend = () => {
    if (!window.confirm('Suspend this seller and deactivate its offers? Existing sub-orders remain in history.')) return;
    startTransition(async () => {
      const result = await suspendSellerAction(sellerId, reason);
      if (result.ok) {
        setMessage('Seller suspended. Their offers were deactivated; placed sub-orders are unaffected.');
        router.refresh();
      } else {
        setMessage(result.error);
      }
    });
  };

  const reinstate = () => {
    if (!window.confirm('Reactivate this seller? Offers will remain deactivated.')) return;
    startTransition(async () => {
      const result = await reinstateSellerAction(sellerId);
      if (result.ok) {
        setMessage('Seller reinstated. Offers stay deactivated until re-approved individually.');
        router.refresh();
      } else {
        setMessage(result.error);
      }
    });
  };

  return (
    <div className="space-y-3">
      {status === 'pending' ? (
        <>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={isPending || !canApprove} onClick={() => review('active')}>
              <CheckCircle2 className="h-4 w-4" aria-hidden /> Approve
            </Button>
            <Button size="sm" variant="outline" disabled={isPending} onClick={() => review('rejected')}>
              <XCircle className="h-4 w-4" aria-hidden /> Reject
            </Button>
          </div>
          {!canApprove ? <p className="text-xs text-amber-800">Link a seller login before approval.</p> : null}
          <label htmlFor="seller-review-reason" className="mb-1 block text-xs font-medium text-ink-600">
            Reason (required for rejection)
          </label>
          <Input
            id="seller-review-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why is this application being rejected?"
            maxLength={500}
          />
        </>
      ) : null}

      {status === 'active' ? (
        <>
          <label htmlFor="seller-suspend-reason" className="mb-1 block text-xs font-medium text-ink-600">
            Suspension reason (required)
          </label>
          <Input
            id="seller-suspend-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why is this seller being suspended?"
            maxLength={500}
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={isPending} onClick={suspend}>
              <PauseCircle className="h-4 w-4" aria-hidden /> Suspend seller
            </Button>
          </div>
        </>
      ) : null}

      {status === 'suspended' ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={isPending} onClick={reinstate}>
            <RotateCcw className="h-4 w-4" aria-hidden /> Reinstate seller
          </Button>
          <p className="text-xs text-ink-500">
            Reinstating does not reactivate offers — each offer needs its own review.
          </p>
        </div>
      ) : null}

      {message ? (
        <p role="status" className="text-sm text-ink-600">
          {message}
        </p>
      ) : null}
    </div>
  );
}
