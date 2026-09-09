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
  /** Allow selecting multiple files at once (admin galleries). */
  multiple?: boolean;
  /** Max files when multiple (defense against huge selections). */
  maxFiles?: number;
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
  multiple = false,
  maxFiles = 10,
}: MediaUploadFieldProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const accept = MEDIA_KIND_CONFIG[kind].mimeTypes.join(',');

  async function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files;
    if (!picked || picked.length === 0) return;

    const files = Array.from(picked).slice(0, multiple ? maxFiles : 1);
    if (picked.length > maxFiles && multiple) {
      setError(`You can upload up to ${maxFiles} images at once. Only the first ${maxFiles} were taken.`);
    } else {
      setError(null);
    }
    setIsUploading(true);
    setProgress(multiple && files.length > 1 ? `Uploading 1/${files.length}…` : null);

    try {
      for (let idx = 0; idx < files.length; idx += 1) {
        const original = files[idx]!;
        if (multiple && files.length > 1) setProgress(`Uploading ${idx + 1}/${files.length}…`);
        // Best-effort client-side downscale. The server still validates.
        const file = await optimizeImageForUpload(kind, original);

        const formData = new FormData();
        formData.set('kind', kind);
        if (ownerId) formData.set('ownerId', ownerId);
        formData.set('file', file);

        const result = await uploadMediaAction(formData);

        if (!result.ok) {
          setError(result.error);
          // Don't abort the whole batch on one bad file — report and continue
          // so the admin sees which file failed and can retry just that one.
          if (!multiple) return;
          continue;
        }

        await onUploaded({
          ref: result.ref,
          bucket: result.bucket,
          path: result.path,
          url: result.url,
          fileName: result.fileName,
          mimeType: result.mimeType,
          size: result.size,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setIsUploading(false);
      setProgress(null);
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
      {progress ? <p className="text-xs font-medium text-ink-500">{progress}</p> : null}

      <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-ink-300 px-4 py-2.5 text-sm font-medium text-ink-600 hover:border-primary-400 hover:text-primary-600">
        {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        {isUploading ? (progress ?? 'Uploading…') : hasExisting ? replaceLabel : label}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          className="hidden"
          onChange={handleChange}
          disabled={disabled || isUploading}
        />
      </label>
      {multiple ? <p className="text-[11px] text-ink-400">PNG, JPEG or WebP, up to 5 MB each. You can select several at once.</p> : null}
    </div>
  );
}
