'use client';

import { useFormState } from 'react-dom';
import { createBrandAction, type MasterDataFormState } from '@/lib/admin/master-data-actions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SubmitButton } from '@/components/ui/submit-button';

const initialState: MasterDataFormState = null;

/**
 * The "add a brand" form — the brand counterpart of `CategoryForm`, with the
 * same rule: the result of the submission (error, duplicate, or the name of the
 * brand that was actually saved) is rendered next to the button.
 */
export function BrandForm() {
  const [state, formAction] = useFormState(createBrandAction, initialState);

  return (
    <form action={formAction} className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Label htmlFor="brandName">Brand name</Label>
          <Input
            id="brandName"
            name="name"
            placeholder="e.g. Tata, Amul, Parle"
            minLength={2}
            maxLength={80}
            required
          />
        </div>
        <SubmitButton pendingLabel="Adding…" className="w-full sm:w-auto">
          Add brand
        </SubmitButton>
      </div>

      <div aria-live="polite">
        {state?.error ? (
          <p className="rounded-xl border border-error-200 bg-error-50 px-3 py-2 text-sm text-error-700">
            {state.error}
          </p>
        ) : null}
        {state?.success ? (
          <p className="rounded-xl border border-mint-200 bg-mint-50 px-3 py-2 text-sm text-mint-800">
            {state.success} It is already live in the retailer catalog.
          </p>
        ) : null}
      </div>
    </form>
  );
}
