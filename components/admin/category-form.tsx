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

export function CategoryForm({ categories }: { categories: CategoryOption[] }) {
  const [state, formAction] = useFormState(createCategoryAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="flex-1">
        <Label htmlFor="categoryName">Category name</Label>
        <Input id="categoryName" name="name" placeholder="e.g. Beverages, Snacks" required />
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
      {state?.error ? <p className="text-sm text-primary-600 sm:ml-3">{state.error}</p> : null}
    </form>
  );
}
