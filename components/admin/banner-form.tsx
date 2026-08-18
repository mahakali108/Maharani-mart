'use client';

import { useState } from 'react';
import { useFormState } from 'react-dom';
import { uploadBannerImageAction } from '@/lib/storage/actions';
import { createBannerAction, type BannerFormState } from '@/lib/admin/banners-actions';
import { StorageImageField } from '@/components/admin/storage-image-field';
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
  const [imageUrl, setImageUrl] = useState('');
  const [bannerObjectId, setBannerObjectId] = useState('');

  return (
    <form action={formAction} className="space-y-4">
      {state?.error ? (
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">
          {state.error}
        </div>
      ) : null}

      <input type="hidden" name="imageUrl" value={imageUrl} />
      <input type="hidden" name="bannerId" value={bannerObjectId} />

      <StorageImageField
        kind="banner"
        label="Banner image"
        value={imageUrl}
        previewClassName="relative mb-2 aspect-[3/1] w-full max-w-md overflow-hidden rounded-xl border border-ink-100"
        upload={async (formData) => {
          if (bannerObjectId) formData.set('ownerId', bannerObjectId);
          return uploadBannerImageAction(formData);
        }}
        onUploaded={({ path, ownerId }) => {
          setImageUrl(path);
          if (ownerId) setBannerObjectId(ownerId);
        }}
      />

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
