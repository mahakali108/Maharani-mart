'use client';

import { useState } from 'react';
import { useFormState } from 'react-dom';
import { updateBrandAction, type MasterDataFormState } from '@/lib/admin/master-data-actions';
import { uploadBrandLogoAction } from '@/lib/storage/actions';
import { StorageImageField } from '@/components/admin/storage-image-field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SubmitButton } from '@/components/ui/submit-button';

const initialState: MasterDataFormState = null;

export function BrandEditForm({
  brandId,
  name,
  logoUrl,
}: {
  brandId: string;
  name: string;
  logoUrl?: string | null;
}) {
  const boundAction = updateBrandAction.bind(null, brandId);
  const [state, formAction] = useFormState(boundAction, initialState);
  const [logo, setLogo] = useState(logoUrl ?? '');

  return (
    <form action={formAction} className="space-y-4">
      {state?.error ? (
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">
          {state.error}
        </div>
      ) : null}
      <input type="hidden" name="logoUrl" value={logo} />
      <div>
        <Label htmlFor="name">Brand name</Label>
        <Input id="name" name="name" defaultValue={name} required />
      </div>
      <StorageImageField
        kind="brand"
        label="Brand logo"
        value={logo}
        upload={(formData) => uploadBrandLogoAction(brandId, formData)}
        onUploaded={({ path }) => setLogo(path)}
      />
      <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
    </form>
  );
}
