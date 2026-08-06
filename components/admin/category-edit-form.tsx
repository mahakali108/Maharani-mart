'use client';

import { useFormState } from 'react-dom';
import { updateCategoryAction, type MasterDataFormState } from '@/lib/admin/master-data-actions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { SubmitButton } from '@/components/ui/submit-button';

const initialState: MasterDataFormState = null;

interface CategoryOption {
  id: string;
  name: string;
}

export function CategoryEditForm({
  categoryId,
  name,
  parentId,
  categories,
}: {
  categoryId: string;
  name: string;
  parentId: string | null;
  categories: CategoryOption[];
}) {
  const boundAction = updateCategoryAction.bind(null, categoryId);
  const [state, formAction] = useFormState(boundAction, initialState);
  const otherCategories = categories.filter((c) => c.id !== categoryId);

  return (
    <form action={formAction} className="space-y-4">
      {state?.error ? (
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">
          {state.error}
        </div>
      ) : null}
      <div>
        <Label htmlFor="name">Category name</Label>
        <Input id="name" name="name" defaultValue={name} required />
      </div>
      <div>
        <Label htmlFor="parentId">Parent category</Label>
        <Select id="parentId" name="parentId" defaultValue={parentId ?? ''}>
          <option value="">— Top level —</option>
          {otherCategories.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.name}
            </option>
          ))}
        </Select>
      </div>
      <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
    </form>
  );
}
