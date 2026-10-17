'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, XCircle } from 'lucide-react';
import { reviewSupplierApplicationAction } from '@/lib/admin/supplier-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function SupplierReviewActions({ supplierId }: { supplierId: string }) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const review = (decision: 'approved' | 'rejected') => {
    startTransition(async () => {
      const result = await reviewSupplierApplicationAction(supplierId, decision, reason);
      if (result.ok) {
        setMessage(decision === 'approved' ? 'Application approved.' : 'Application rejected.');
        router.refresh();
      } else {
        setMessage(result.error);
      }
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={isPending} onClick={() => review('approved')}>
          <CheckCircle2 className="h-4 w-4" aria-hidden /> Approve
        </Button>
        <Button size="sm" variant="outline" disabled={isPending} onClick={() => review('rejected')}>
          <XCircle className="h-4 w-4" aria-hidden /> Reject
        </Button>
      </div>
      <div>
        <label htmlFor="rejection-reason" className="mb-1 block text-xs font-medium text-ink-600">
          Rejection reason (required to reject)
        </label>
        <Input
          id="rejection-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Incomplete business details — asked to re-apply"
        />
      </div>
      {message ? (
        <p role="status" className="text-sm text-ink-600">
          {message}
        </p>
      ) : null}
    </div>
  );
}
