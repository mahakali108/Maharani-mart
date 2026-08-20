'use client';

import { useState } from 'react';
import { useFormState } from 'react-dom';
import { MediaUploadField } from '@/components/media/media-upload-field';
import { StoredImage } from '@/components/media/stored-image';
import { createBannerAction, type BannerFormState } from '@/lib/admin/banners-actions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { SubmitButton } from '@/components/ui/submit-button';

const initialState: BannerFormState = null;

interface Option {
  id: string;
  name: string;
}

export function BannerForm({ areas }: { areas: Option[] }) {
  const [state, formAction] = useFormState(createBannerAction, initialState);
  // Holds the storage reference returned by the upload Server Action; it is
  // submitted with the form and persisted to `banners.image_url`.
  const [imageRef, setImageRef] = useState('');

  return (
    <form action={formAction} className="space-y-4">
      {state?.error ? (
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">
          {state.error}
        </div>
      ) : null}
      <input type="hidden" name="imageUrl" value={imageRef} />

      <div>
        <Label>Banner image</Label>
        {imageRef ? (
          <div className="relative mb-2 aspect-[3/1] w-full max-w-md overflow-hidden rounded-xl border border-ink-100">
            <StoredImage src={imageRef} alt="" size="banner" fill className="object-cover" />
          </div>
        ) : null}
        <MediaUploadField
          kind="banner"
          ownerId={null}
          hasExisting={imageRef !== ''}
          onUploaded={(media) => setImageRef(media.ref)}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="title">Title</Label>
          <Input id="title" name="title" placeholder="e.g. Diwali Offer" required />
        </div>
        <div>
          <Label htmlFor="linkUrl">Link URL</Label>
          <Input id="linkUrl" name="linkUrl" placeholder="Optional" />
        </div>
        <div>
          <Label htmlFor="areaId">Area</Label>
          <Select id="areaId" name="areaId" defaultValue="">
            <option value="">— All areas —</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor="startsAt">Starts</Label>
            <Input id="startsAt" name="startsAt" type="date" />
          </div>
          <div>
            <Label htmlFor="endsAt">Ends</Label>
            <Input id="endsAt" name="endsAt" type="date" />
          </div>
        </div>
      </div>

      <SubmitButton pendingLabel="Creating…">Create banner</SubmitButton>
    </form>
  );
}
