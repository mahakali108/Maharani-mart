'use client';

import { useFormState } from 'react-dom';
import { createAreaAction, type MasterDataFormState } from '@/lib/admin/master-data-actions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SubmitButton } from '@/components/ui/submit-button';

const initialState: MasterDataFormState = null;

export function AreaForm() {
  const [state, formAction] = useFormState(createAreaAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="flex-1">
        <Label htmlFor="name">Area name</Label>
        <Input id="name" name="name" placeholder="e.g. Khagaria Town" required />
      </div>
      <div className="flex-1">
        <Label htmlFor="district">District</Label>
        <Input id="district" name="district" defaultValue="Khagaria" required />
      </div>
      <SubmitButton pendingLabel="Adding…" className="w-full sm:w-auto">
        Add area
      </SubmitButton>
      {state?.error ? <p className="text-sm text-primary-600 sm:ml-3">{state.error}</p> : null}
    </form>
  );
}
