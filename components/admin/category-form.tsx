'use client';

import { useFormState } from 'react-dom';
import { createCategoryAction, type MasterDataFormState } from '@/lib/admin/master-data-actions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { SubmitButton } from '@/components/ui/submit-button';

const initialState: MasterDataFormState = null;

interface CategoryOption {
  id: string;
  name: string;
}

/**
 * The "add a category" form.
 *
 * Every outcome is rendered where the operator is looking: a validation or
 * database error, and a SUCCESS confirmation naming the category that was
 * saved. The success line is not decoration — without it a create that worked
 * is indistinguishable from a click that did nothing, which is exactly how the
 * broken build reported "admin cannot add categories".
 *
 * The error/success region is `aria-live="polite"` so a screen reader announces
 * the result of the submission.
 */
export function CategoryForm({ categories }: { categories: CategoryOption[] }) {
  const [state, formAction] = useFormState(createCategoryAction, initialState);

  return (
    <form action={formAction} className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Label htmlFor="categoryName">Category name</Label>
          <Input
            id="categoryName"
            name="name"
            placeholder="e.g. Beverages, Snacks"
            minLength={2}
            maxLength={80}
            required
          />
        </div>
        <div className="flex-1">
          <Label htmlFor="parentId">Parent category</Label>
          <Select id="parentId" name="parentId" defaultValue="">
            <option value="">— Top level —</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </Select>
        </div>
        <SubmitButton pendingLabel="Adding…" className="w-full sm:w-auto">
          Add category
        </SubmitButton>
      </div>

      <div aria-live="polite">
        {state?.error ? (
          <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {state.error}
          </p>
        ) : null}
        {state?.success ? (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {state.success} It is already live in the retailer catalog.
          </p>
        ) : null}
      </div>
    </form>
  );
}
