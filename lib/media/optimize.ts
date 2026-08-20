/**
 * Lightweight image optimisation.
 *
 * Two dependency-free layers, deliberately chosen over adding a native image
 * pipeline (sharp) which would bloat the serverless bundle:
 *
 *  1. UPLOAD-TIME (browser, best effort): downscale oversized photos on a
 *     canvas before they are sent. A 12 MP phone photo becomes a ~200 KB WebP,
 *     which keeps the request inside the size limit and speeds up the upload.
 *     If anything fails we fall back to the original file — the server-side
 *     validator is still the authority on what is accepted.
 *
 *  2. DELIVERY-TIME (Appwrite): `resolveMediaUrl()` requests the preview
 *     endpoint with a width + quality + WebP output, so each surface pulls an
 *     appropriately sized render instead of the full-resolution original.
 *
 * This module is isomorphic and contains no secrets.
 */

import { MEDIA_KIND_CONFIG, type MediaKind } from './types';

/** Recommended render widths per surface, used by `StoredImage`. */
export const RENDER_WIDTHS = {
  thumb: 160,
  card: 400,
  detail: 900,
  banner: 1400,
} as const;

export type RenderSize = keyof typeof RENDER_WIDTHS;

/**
 * Downscale + re-encode an image in the browser before upload.
 * Returns the original file unchanged when optimisation is not applicable
 * (PDFs, already-small images, unsupported browsers, or any failure).
 */
export async function optimizeImageForUpload(kind: MediaKind, file: File): Promise<File> {
  const config = MEDIA_KIND_CONFIG[kind];
  const maxEdge = config.maxEdge;

  if (maxEdge === null) return file;
  if (!file.type.startsWith('image/')) return file;
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') return file;

  try {
    const bitmap = await createImageBitmap(file);
    const longest = Math.max(bitmap.width, bitmap.height);

    // Small enough already, and not oversized on disk — leave it alone so we
    // never re-encode (and degrade) an image that did not need it.
    if (longest <= maxEdge && file.size <= config.maxBytes / 2) {
      bitmap.close();
      return file;
    }

    const scale = Math.min(1, maxEdge / longest);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) {
      bitmap.close();
      return file;
    }

    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((result) => resolve(result), 'image/webp', 0.85);
    });

    if (!blob || blob.size === 0 || blob.size >= file.size) return file;

    const baseName = file.name.replace(/\.[^.]+$/, '');
    return new File([blob], `${baseName}.webp`, { type: 'image/webp' });
  } catch {
    return file;
  }
}
