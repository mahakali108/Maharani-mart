'use client';

import { useRef, useState } from 'react';
import { Loader2, Upload } from 'lucide-react';
import { StoredImage } from '@/components/media/stored-image';
import { optimizeImageFile } from '@/lib/storage/optimize';
import type { StorageKind } from '@/lib/storage/types';
import { Label } from '@/components/ui/label';

const ACCEPT: Record<StorageKind, string> = {
  product: 'image/png,image/jpeg,image/webp',
  brand: 'image/png,image/jpeg,image/webp,image/svg+xml',
  category: 'image/png,image/jpeg,image/webp',
  banner: 'image/png,image/jpeg,image/webp',
  retailer_profile: 'image/png,image/jpeg,image/webp',
  retailer_document: 'image/png,image/jpeg,image/webp,application/pdf',
};

export function StorageImageField({
  kind,
  label,
  value,
  previewClassName,
  onUploaded,
  upload,
}: {
  kind: StorageKind;
  label: string;
  value: string;
  previewClassName?: string;
  onUploaded: (result: { path: string; url?: string | null; ownerId?: string }) => void;
  upload: (formData: FormData) => Promise<{ error?: string; path?: string; url?: string | null; ownerId?: string }>;
}) {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setIsUploading(true);
    try {
      const optimized = await optimizeImageFile(file, kind);
      const formData = new FormData();
      formData.set('file', optimized);
      if (value) formData.set('previousPath', value);
      const result = await upload(formData);
      if (result.error || !result.path) throw new Error(result.error ?? 'Upload failed.');
      onUploaded({ path: result.path, url: result.url, ownerId: result.ownerId });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  return (
    <div>
      <Label>{label}</Label>
      {error ? (
        <div className="mb-2 rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">{error}</div>
      ) : null}
      {value ? (
        <div className={previewClassName ?? 'relative mb-2 aspect-square w-28 overflow-hidden rounded-xl border border-ink-100'}>
          <StoredImage src={value} alt="" fill className="object-cover" />
        </div>
      ) : null}
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-ink-300 px-4 py-2.5 text-sm font-medium text-ink-600 hover:border-primary-400 hover:text-primary-600">
        {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        {isUploading ? 'Uploading…' : value ? 'Replace image' : 'Upload image'}
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT[kind]}
          className="hidden"
          onChange={handleFileChange}
          disabled={isUploading}
        />
      </label>
    </div>
  );
}
