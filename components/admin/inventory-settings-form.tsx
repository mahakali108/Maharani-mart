'use client';

import { useFormState } from 'react-dom';
import { updateInventorySettingsAction, type StockAdjustmentFormState } from '@/lib/admin/inventory-actions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SubmitButton } from '@/components/ui/submit-button';

const initialState: StockAdjustmentFormState = null;

export function InventorySettingsForm({
  expiryCriticalDays,
  expiryWarningDays,
  cooldownHours,
}: {
  expiryCriticalDays: number;
  expiryWarningDays: number;
  cooldownHours: number;
}) {
  const [state, formAction] = useFormState(updateInventorySettingsAction, initialState);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <div>
        <Label htmlFor="expiryCriticalDays">Critical window (days)</Label>
        <Input id="expiryCriticalDays" name="expiryCriticalDays" type="number" min={0} max={365} defaultValue={expiryCriticalDays} className="w-28" />
      </div>
      <div>
        <Label htmlFor="expiryWarningDays">Warning window (days)</Label>
        <Input id="expiryWarningDays" name="expiryWarningDays" type="number" min={0} max={730} defaultValue={expiryWarningDays} className="w-28" />
      </div>
      <div>
        <Label htmlFor="cooldownHours">Alert cooldown (hours)</Label>
        <Input id="cooldownHours" name="cooldownHours" type="number" min={0} max={720} defaultValue={cooldownHours} className="w-28" />
      </div>
      <SubmitButton className="h-11 w-auto rounded-xl px-4 text-sm">Save settings</SubmitButton>
      {state?.error ? <span className="text-sm text-primary-600">{state.error}</span> : null}
    </form>
  );
}
