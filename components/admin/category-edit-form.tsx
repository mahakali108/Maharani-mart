'use client';

import { useState } from 'react';
import { useFormState } from 'react-dom';
import { updateCategoryAction, type MasterDataFormState } from '@/lib/admin/master-data-actions';
import { MediaUploadField } from '@/components/media/media-upload-field';
import { StoredImage } from '@/components/media/stored-image';
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
  imageUrl = null,
}: {
  categoryId: string;
  name: string;
  parentId: string | null;
  categories: CategoryOption[];
  /** Existing `categories.image_url` — a Supabase public URL (or a legacy absolute URL). */
  imageUrl?: string | null;
}) {
  const boundAction = updateCategoryAction.bind(null, categoryId);
  const [state, formAction] = useFormState(boundAction, initialState);
  const otherCategories = categories.filter((c) => c.id !== categoryId);

  const [imageRef, setImageRef] = useState(imageUrl ?? '');

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

      <div className="space-y-2">
        <Label>Category image</Label>
        <input type="hidden" name="imageUrl" value={imageRef} />
        {imageRef ? (
          <div className="relative h-20 w-20 overflow-hidden rounded-xl border border-ink-200 bg-white">
            <StoredImage src={imageRef} alt={name} size="thumb" fill className="object-cover" />
          </div>
        ) : (
          <p className="text-sm text-ink-500">No image uploaded yet.</p>
        )}
        <div className="flex items-center gap-3">
          <MediaUploadField
            kind="category-image"
            ownerId={categoryId}
            label="Upload image"
            replaceLabel="Replace image"
            hasExisting={imageRef !== ''}
            onUploaded={(media) => setImageRef(media.ref)}
          />
          {imageRef ? (
            <button
              type="button"
              onClick={() => setImageRef('')}
              className="text-sm font-medium text-ink-500 hover:text-primary-600"
            >
              Remove
            </button>
          ) : null}
        </div>
        <p className="text-xs text-ink-400">PNG, JPG or WebP up to 2 MB.</p>
      </div>

      <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
    </form>
  );
}
