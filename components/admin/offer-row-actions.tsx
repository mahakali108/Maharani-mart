'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, EyeOff, Eye, XCircle } from 'lucide-react';
import { moderateOfferAction, setOfferActiveAction } from '@/lib/admin/offer-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Offer moderation/activation controls (Admin + Super Admin — the server
 * actions re-check `sellers.offers.manage`). Offers are DEACTIVATED, never deleted.
 */
export function OfferRowActions({
  offerId,
  moderationStatus,
  isActive,
}: {
  offerId: string;
  moderationStatus: 'pending' | 'approved' | 'rejected';
  isActive: boolean;
}) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const moderate = (decision: 'approved' | 'rejected') => {
    startTransition(async () => {
      const result = await moderateOfferAction(offerId, decision, reason);
      if (result.ok) {
        setMessage(decision === 'approved' ? 'Offer approved.' : 'Offer rejected.');
        router.refresh();
      } else {
        setMessage(result.error);
      }
    });
  };

  const toggleActive = () => {
    startTransition(async () => {
      const result = await setOfferActiveAction(offerId, !isActive);
      if (result.ok) {
        setMessage(isActive ? 'Offer deactivated (history preserved).' : 'Offer reactivated.');
        router.refresh();
      } else {
        setMessage(result.error);
      }
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {moderationStatus !== 'approved' ? (
          <Button size="sm" disabled={isPending} onClick={() => moderate('approved')}>
            <CheckCircle2 className="h-4 w-4" aria-hidden /> Approve
          </Button>
        ) : null}
        {moderationStatus !== 'rejected' ? (
          <Button size="sm" variant="outline" disabled={isPending} onClick={() => moderate('rejected')}>
            <XCircle className="h-4 w-4" aria-hidden /> Reject
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" disabled={isPending} onClick={toggleActive}>
          {isActive ? (
            <>
              <EyeOff className="h-4 w-4" aria-hidden /> Deactivate
            </>
          ) : (
            <>
              <Eye className="h-4 w-4" aria-hidden /> Activate
            </>
          )}
        </Button>
      </div>
      {moderationStatus === 'rejected' ? (
        <Input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Rejection reason (required)"
          maxLength={500}
        />
      ) : null}
      {message ? (
        <p role="status" className="text-sm text-ink-600">
          {message}
        </p>
      ) : null}
    </div>
  );
}
