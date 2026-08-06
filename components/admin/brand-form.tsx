'use client';

import { useFormState } from 'react-dom';
import { createBrandAction, type MasterDataFormState } from '@/lib/admin/master-data-actions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SubmitButton } from '@/components/ui/submit-button';

const initialState: MasterDataFormState = null;

export function BrandForm() {
  const [state, formAction] = useFormState(createBrandAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="flex-1">
        <Label htmlFor="brandName">Brand name</Label>
        <Input id="brandName" name="name" placeholder="e.g. Tata, Amul, Parle" required />
      </div>
      <SubmitButton pendingLabel="Adding…" className="w-full sm:w-auto">
        Add brand
      </SubmitButton>
      {state?.error ? <p className="text-sm text-primary-600 sm:ml-3">{state.error}</p> : null}
    </form>
  );
}
