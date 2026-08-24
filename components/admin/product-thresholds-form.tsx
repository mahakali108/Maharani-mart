'use client';

import { useFormState } from 'react-dom';
import { updateProductThresholdsAction, type StockAdjustmentFormState } from '@/lib/admin/inventory-actions';
import { Input } from '@/components/ui/input';
import { SubmitButton } from '@/components/ui/submit-button';

const initialState: StockAdjustmentFormState = null;

export function ProductThresholdsForm({
  productId,
  minStock,
  reorderLevel,
  maxStock,
}: {
  productId: string;
  minStock: number;
  reorderLevel: number;
  maxStock: number;
}) {
  const action = updateProductThresholdsAction.bind(null, productId);
  const [state, formAction] = useFormState(action, initialState);

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-1 text-xs text-ink-500">
        Min
        <Input name="minStock" type="number" min={0} step={1} defaultValue={minStock} className="w-20" />
      </label>
      <label className="flex items-center gap-1 text-xs text-ink-500">
        Reorder
        <Input name="reorderLevel" type="number" min={0} step={1} defaultValue={reorderLevel} className="w-20" />
      </label>
      <label className="flex items-center gap-1 text-xs text-ink-500">
        Max
        <Input name="maxStock" type="number" min={0} step={1} defaultValue={maxStock} className="w-20" />
      </label>
      <SubmitButton className="h-9 w-auto rounded-lg px-3 text-sm">
        Save
      </SubmitButton>
      {state?.error ? <span className="text-xs text-primary-600">{state.error}</span> : null}
    </form>
  );
}
