'use client';

import { useState } from 'react';
import { useFormState } from 'react-dom';
import { recordBatchLossAction, type StockAdjustmentFormState } from '@/lib/admin/inventory-actions';
import { Input } from '@/components/ui/input';
import { SubmitButton } from '@/components/ui/submit-button';
import { Button } from '@/components/ui/button';

const initialState: StockAdjustmentFormState = null;

/**
 * Writes damaged or expired units off a batch. Rendered inside a
 * <details> disclosure in batch tables so the row stays compact.
 * The RPC enforces that reserved stock can never be written off.
 */
export function BatchLossForm({
  batchId,
  lossType,
  maxQuantity,
}: {
  batchId: string;
  lossType: 'damage' | 'expiry';
  maxQuantity: number;
}) {
  const action = recordBatchLossAction.bind(null, lossType);
  const [state, formAction] = useFormState(action, initialState);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        {lossType === 'damage' ? 'Record damage' : 'Write off expired'}
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="batchId" value={batchId} />
      <Input
        name="quantity"
        type="number"
        min={1}
        max={maxQuantity}
        step={1}
        required
        placeholder={`Qty (≤ ${maxQuantity})`}
        className="w-28"
      />
      <Input name="reason" required placeholder={lossType === 'damage' ? 'Damage reason' : 'Expiry write-off reason'} className="min-w-[160px]" />
      <SubmitButton className="h-9 w-auto rounded-lg px-3 text-sm">Confirm</SubmitButton>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      {state?.error ? <span className="text-xs text-primary-600">{state.error}</span> : null}
    </form>
  );
}
