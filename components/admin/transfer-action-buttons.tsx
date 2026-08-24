'use client';

import { useState, useTransition } from 'react';
import { ArrowRightCircle, XCircle } from 'lucide-react';
import { executeTransferAction, cancelTransferAction } from '@/lib/admin/transfer-actions';
import { Button } from '@/components/ui/button';

export function TransferActionButtons({ transferId }: { transferId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onExecute() {
    setError(null);
    startTransition(async () => {
      const result = await executeTransferAction(transferId);
      if (result?.error) setError(result.error);
    });
  }

  function onCancel() {
    setError(null);
    startTransition(async () => {
      const result = await cancelTransferAction(transferId, '');
      if (result?.error) setError(result.error);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {error ? <span className="text-xs text-primary-600">{error}</span> : null}
      <Button size="sm" onClick={onExecute} disabled={isPending}>
        <ArrowRightCircle className="h-4 w-4" /> Execute
      </Button>
      <Button size="sm" variant="outline" onClick={onCancel} disabled={isPending}>
        <XCircle className="h-4 w-4" /> Cancel
      </Button>
    </div>
  );
}
