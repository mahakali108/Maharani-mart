'use client';

/**
 * Reusable file picker that routes every upload through the
 * `uploadMediaAction` Server Action.
 *
 * The browser only ever states *what kind* of media it is uploading and which
 * record it belongs to; the server re-derives the bucket, the file id, the
 * path and the permission check. No storage SDK is loaded in the browser.
 */

import { useRef, useState } from 'react';
import { Upload, Loader2 } from 'lucide-react';

import { uploadMediaAction } from '@/lib/media/actions';
import { optimizeImageForUpload } from '@/lib/media/optimize';
import { MEDIA_KIND_CONFIG, type MediaKind } from '@/lib/media/types';
import type { UploadedMedia } from '@/lib/media/types';
import { cn } from '@/lib/utils/cn';

export interface MediaUploadFieldProps {
  kind: MediaKind;
  /** Owning record id. `null` is only valid for kinds that allow drafts. */
  ownerId: string | null;
  onUploaded: (media: UploadedMedia) => void | Promise<void>;
  label?: string;
  replaceLabel?: string;
  hasExisting?: boolean;
  disabled?: boolean;
  className?: string;
}

export function MediaUploadField({
  kind,
  ownerId,
  onUploaded,
  label = 'Upload image',
  replaceLabel = 'Replace image',
  hasExisting = false,
  disabled = false,
  className,
}: MediaUploadFieldProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const accept = MEDIA_KIND_CONFIG[kind].mimeTypes.join(',');

  async function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0];
    if (!picked) return;

    setError(null);
    setIsUploading(true);

    try {
      // Best-effort client-side downscale. The server still validates.
      const file = await optimizeImageForUpload(kind, picked);

      const formData = new FormData();
      formData.set('kind', kind);
      if (ownerId) formData.set('ownerId', ownerId);
      formData.set('file', file);

      const result = await uploadMediaAction(formData);

      if (!result.ok) {
        setError(result.error);
        return;
      }

      await onUploaded({
        ref: result.ref,
        fileId: result.fileId,
        bucketId: result.bucketId,
        path: result.path,
        url: result.url,
        fileName: result.fileName,
        mimeType: result.mimeType,
        size: result.size,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setIsUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className={cn('space-y-2', className)}>
      {error ? (
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">
          {error}
        </div>
      ) : null}

      <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-ink-300 px-4 py-2.5 text-sm font-medium text-ink-600 hover:border-primary-400 hover:text-primary-600">
        {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        {isUploading ? 'Uploading…' : hasExisting ? replaceLabel : label}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={handleChange}
          disabled={disabled || isUploading}
        />
      </label>
    </div>
  );
}
