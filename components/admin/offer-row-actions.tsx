'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, EyeOff, Eye, ShieldAlert, XCircle } from 'lucide-react';
import {
  moderateOfferAction,
  removeProhibitedOfferAction,
  setOfferActiveAction,
} from '@/lib/admin/offer-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Offer moderation/activation controls (Admin + Super Admin — server actions
 * re-check `sellers.offers.manage`, and prohibited removal requires Super Admin).
 * Offers are rejected/deactivated, never hard-deleted so order history stays intact.
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
  const [reasonMode, setReasonMode] = useState<'none' | 'reject' | 'prohibited'>('none');
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const moderate = (decision: 'approved' | 'rejected') => {
    if (decision === 'rejected' && reasonMode !== 'reject') {
      setReasonMode('reject');
      setMessage('Enter a short rejection reason below and click Confirm Reject.');
      return;
    }
    startTransition(async () => {
      const result = await moderateOfferAction(offerId, decision, reason);
      if (result.ok) {
        setReason('');
        setReasonMode('none');
        setMessage(decision === 'approved' ? 'Offer approved.' : 'Offer rejected.');
        router.refresh();
      } else {
        setMessage(result.error);
      }
    });
  };

  const removeProhibited = () => {
    if (reasonMode !== 'prohibited') {
      setReasonMode('prohibited');
      setMessage('Enter the policy or compliance reason (min 8 chars) and click Confirm Prohibited Removal.');
      return;
    }
    startTransition(async () => {
      const result = await removeProhibitedOfferAction(offerId, reason);
      if (result.ok) {
        setReason('');
        setReasonMode('none');
        setMessage('Prohibited listing removed and logged in moderation history.');
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
            <XCircle className="h-4 w-4" aria-hidden />
            {reasonMode === 'reject' ? 'Confirm Reject' : 'Reject'}
          </Button>
        ) : null}
        <Button size="sm" variant="outline" disabled={isPending} onClick={removeProhibited}>
          <ShieldAlert className="h-4 w-4" aria-hidden />
          {reasonMode === 'prohibited' ? 'Confirm Prohibited Removal' : 'Remove Prohibited'}
        </Button>
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
      {reasonMode !== 'none' ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={
              reasonMode === 'prohibited'
                ? 'Prohibited / non-compliant policy reason (min 8 chars)'
                : 'Rejection reason (required, min 3 chars)'
            }
            maxLength={480}
            className="max-w-md"
          />
          <Button
            size="sm"
            variant="ghost"
            disabled={isPending}
            onClick={() => {
              setReasonMode('none');
              setReason('');
              setMessage(null);
            }}
          >
            Cancel
          </Button>
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
