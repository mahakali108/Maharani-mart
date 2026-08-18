'use client';

import { STORAGE_PROFILES, type StorageKind } from '@/lib/storage/types';

function fitWithin(width: number, height: number, maxWidth: number, maxHeight: number): { width: number; height: number } {
  if (width <= maxWidth && height <= maxHeight) return { width, height };
  const ratio = Math.min(maxWidth / width, maxHeight / height);
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

function supportsWebp(canvas: HTMLCanvasElement): boolean {
  try {
    return canvas.toDataURL('image/webp').startsWith('data:image/webp');
  } catch {
    return false;
  }
}

/**
 * Client-side resize + compress. Server-side validation still runs on
 * the resulting bytes — this only shrinks oversized marketplace photos.
 * PDFs and SVGs are returned unchanged.
 */
export async function optimizeImageFile(file: File, kind: StorageKind): Promise<File> {
  const profile = STORAGE_PROFILES[kind];
  if (file.type === 'application/pdf' || file.type === 'image/svg+xml') {
    return file;
  }
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    return file;
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }

  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, profile.maxWidth, profile.maxHeight);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);

    const mime = supportsWebp(canvas) ? 'image/webp' : 'image/jpeg';
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, profile.quality));
    if (!blob) return file;

    const stem = file.name.replace(/\.[^.]+$/, '') || 'image';
    const ext = mime === 'image/webp' ? 'webp' : 'jpg';
    return new File([blob], `${stem}.${ext}`, { type: mime, lastModified: Date.now() });
  } finally {
    bitmap.close();
  }
}
