'use client';

import { useTransition } from 'react';
import { Check, Ban, RotateCcw, X, Loader2 } from 'lucide-react';
import {
  approveRetailerAction,
  suspendRetailerAction,
  reactivateRetailerAction,
  rejectRetailerAction,
} from '@/lib/admin/retailers-actions';
import { Button } from '@/components/ui/button';

export function RetailerRowActions({
  retailerId,
  status,
}: {
  retailerId: string;
  status: 'pending_approval' | 'active' | 'suspended';
}) {
  const [isPending, startTransition] = useTransition();

  if (status === 'pending_approval') {
    return (
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={isPending}
          onClick={() => startTransition(() => approveRetailerAction(retailerId))}
        >
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={() => {
            if (confirm('Reject this registration? The applicant will not be able to place orders.')) {
              startTransition(() => rejectRetailerAction(retailerId));
            }
          }}
        >
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
          Reject
        </Button>
      </div>
    );
  }

  if (status === 'active') {
    return (
      <Button
        size="sm"
        variant="outline"
        disabled={isPending}
        onClick={() => {
          if (confirm('Suspend this retailer? They will lose access immediately.')) {
            startTransition(() => suspendRetailerAction(retailerId));
          }
        }}
      >
        {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
        Suspend
      </Button>
    );
  }

  return (
    <Button size="sm" variant="outline" disabled={isPending} onClick={() => startTransition(() => reactivateRetailerAction(retailerId))}>
      {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
      Reactivate
    </Button>
  );
}
