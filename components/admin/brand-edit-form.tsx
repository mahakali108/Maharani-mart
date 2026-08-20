'use client';

import { useState } from 'react';
import { useFormState } from 'react-dom';
import { updateBrandAction, type MasterDataFormState } from '@/lib/admin/master-data-actions';
import { MediaUploadField } from '@/components/media/media-upload-field';
import { StoredImage } from '@/components/media/stored-image';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SubmitButton } from '@/components/ui/submit-button';

const initialState: MasterDataFormState = null;

export function BrandEditForm({
  brandId,
  name,
  logoUrl = null,
}: {
  brandId: string;
  name: string;
  /** Existing `brands.logo_url` — an Appwrite ref or a legacy Supabase URL. */
  logoUrl?: string | null;
}) {
  const boundAction = updateBrandAction.bind(null, brandId);
  const [state, formAction] = useFormState(boundAction, initialState);

  // The upload happens immediately; the resulting reference travels with the
  // form through this hidden field so the column is only written on save.
  const [logoRef, setLogoRef] = useState(logoUrl ?? '');

  return (
    <form action={formAction} className="space-y-4">
      {state?.error ? (
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">
          {state.error}
        </div>
      ) : null}
      <div>
        <Label htmlFor="name">Brand name</Label>
        <Input id="name" name="name" defaultValue={name} required />
      </div>

      <div className="space-y-2">
        <Label>Brand logo</Label>
        <input type="hidden" name="logoUrl" value={logoRef} />
        {logoRef ? (
          <div className="relative h-20 w-20 overflow-hidden rounded-xl border border-ink-200 bg-white">
            <StoredImage src={logoRef} alt={name} size="thumb" fill className="object-contain" />
          </div>
        ) : (
          <p className="text-sm text-ink-500">No logo uploaded yet.</p>
        )}
        <div className="flex items-center gap-3">
          <MediaUploadField
            kind="brand-logo"
            ownerId={brandId}
            label="Upload logo"
            replaceLabel="Replace logo"
            hasExisting={logoRef !== ''}
            onUploaded={(media) => setLogoRef(media.ref)}
          />
          {logoRef ? (
            <button
              type="button"
              onClick={() => setLogoRef('')}
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
