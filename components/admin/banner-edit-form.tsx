'use client';

import { useRef, useState } from 'react';
import { useFormState } from 'react-dom';
import Image from 'next/image';
import { Upload, Loader2 } from 'lucide-react';
import { uploadFile, buildPath } from '@/lib/storage/upload';
import { updateBannerAction, type BannerFormState } from '@/lib/admin/banners-actions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { SubmitButton } from '@/components/ui/submit-button';

const initialState: BannerFormState = null;

interface Option {
  id: string;
  name: string;
}

export function BannerEditForm({
  bannerId,
  title,
  imageUrl: initialImageUrl,
  linkUrl,
  areaId,
  startsAt,
  endsAt,
  areas,
}: {
  bannerId: string;
  title: string;
  imageUrl: string;
  linkUrl: string | null;
  areaId: string | null;
  startsAt: string | null;
  endsAt: string | null;
  areas: Option[];
}) {
  const boundAction = updateBannerAction.bind(null, bannerId);
  const [state, formAction] = useFormState(boundAction, initialState);
  const [imageUrl, setImageUrl] = useState(initialImageUrl);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError(null);
    setIsUploading(true);
    try {
      const path = buildPath('banners', file);
      const { publicUrl } = await uploadFile('banners', file, path);
      if (!publicUrl) throw new Error('Upload succeeded but no public URL was returned.');
      setImageUrl(publicUrl);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <form action={formAction} className="space-y-4">
      {state?.error ? (
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">
          {state.error}
        </div>
      ) : null}
      {uploadError ? (
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">
          {uploadError}
        </div>
      ) : null}

      <input type="hidden" name="imageUrl" value={imageUrl} />

      <div>
        <Label>Banner image</Label>
        <div className="relative mb-2 aspect-[3/1] w-full max-w-md overflow-hidden rounded-xl border border-ink-100">
          <Image src={imageUrl} alt="" fill className="object-cover" unoptimized />
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-ink-300 px-4 py-2.5 text-sm font-medium text-ink-600 hover:border-primary-400 hover:text-primary-600">
          {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {isUploading ? 'Uploading…' : 'Replace image'}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={handleFileChange}
            disabled={isUploading}
          />
        </label>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="title">Title</Label>
          <Input id="title" name="title" defaultValue={title} required />
        </div>
        <div>
          <Label htmlFor="linkUrl">Link URL</Label>
          <Input id="linkUrl" name="linkUrl" defaultValue={linkUrl ?? ''} placeholder="Optional" />
        </div>
        <div>
          <Label htmlFor="areaId">Area</Label>
          <Select id="areaId" name="areaId" defaultValue={areaId ?? ''}>
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
            <Input id="startsAt" name="startsAt" type="date" defaultValue={startsAt ? startsAt.slice(0, 10) : ''} />
          </div>
          <div>
            <Label htmlFor="endsAt">Ends</Label>
            <Input id="endsAt" name="endsAt" type="date" defaultValue={endsAt ? endsAt.slice(0, 10) : ''} />
          </div>
        </div>
      </div>

      <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
    </form>
  );
}
