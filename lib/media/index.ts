import 'server-only';

/**
 * Media facade — the ONLY module application code should import for
 * uploading or deleting files. Storage is Supabase Storage, full stop.
 *
 * Flow enforced here:
 *   browser  →  Supabase session (requireUser)
 *            →  role/permission + ownership check (lib/media/access)
 *            →  server-side validation (lib/media/validate)
 *            →  Supabase Storage write (lib/media/supabase)
 *            →  caller persists `result.ref` in the existing Supabase column
 *
 * The browser never picks a bucket, an object path, or a file id. It names a
 * `MediaKind` (plus an owner id), and the server derives everything else.
 */

import { authorizeMediaWrite } from './access';
import { isMediaKind, type MediaKind, type UploadMediaResult } from './types';
import { validateUpload } from './validate';
import { deleteFromSupabaseStorage, uploadToSupabaseStorage } from './supabase';
import type { DeleteOutcome } from './supabase';
import { isSafeObjectPath, parseMediaRef } from './refs';

export { authorizeMediaWrite } from './access';
export {
  parseMediaRef,
  parseSupabasePublicUrl,
  resolveMediaUrl,
  isLegacyObjectPath,
  isRenderableMediaRef,
  isDraftBannerPath,
  isSignedStorageUrl,
  isSafeObjectPath,
} from './refs';
export { MEDIA_KINDS, MEDIA_KIND_CONFIG, isMediaKind } from './types';
export type { MediaKind, UploadedMedia, UploadMediaResult } from './types';
export type { DeleteOutcome } from './supabase';

/**
 * Authorise, validate and store one file.
 *
 * Returns a discriminated result rather than throwing, so form actions can
 * surface a friendly message. Never throws for an ordinary rejection.
 */
export async function uploadMedia(
  rawKind: unknown,
  rawOwnerId: unknown,
  file: File,
): Promise<UploadMediaResult> {
  if (!isMediaKind(rawKind)) {
    return { ok: false, error: 'Unknown upload type.' };
  }
  const kind: MediaKind = rawKind;

  // 1. Supabase session + role + ownership. Throws only via requireUser()'s
  //    redirect when there is no session at all.
  const access = await authorizeMediaWrite(kind, rawOwnerId);
  if (!access.ok) return { ok: false, error: access.error };

  // 2. Content-based validation — browser-supplied MIME is ignored.
  const validated = await validateUpload(kind, file);
  if (!validated.ok) return { ok: false, error: validated.error };

  // 3. Write. Bucket, object name and path are all server-derived; RLS applies.
  const stored = await uploadToSupabaseStorage({
    kind,
    ownerId: access.ownerId,
    file: validated.file,
  });
  if (!stored.ok) return { ok: false, error: stored.error };

  return { ok: true, ...stored.media };
}

/**
 * Buckets `deleteMedia()` is permitted to remove objects from.
 *
 * A stored value is caller-influenced data, so the bucket it names is treated
 * as untrusted: anything outside this list is refused outright rather than
 * handed to the Storage API. This is what stops a bare object path from being
 * deleted out of the WRONG bucket.
 */
const DELETABLE_BUCKETS: ReadonlySet<string> = new Set([
  'product-images',
  'brand-logos',
  'category-images',
  'banners',
  'banner-drafts',
  'avatars',
  'retailer-documents',
  'supplier-documents',
  'delivery-proofs',
  'payment-proofs',
]);

/** Legacy default for a bare object path: the first private bucket that used them. */
const LEGACY_OBJECT_PATH_BUCKET = 'retailer-documents';

export interface DeleteMediaOptions {
  /**
   * Bucket for a bare object path. REQUIRED whenever the path does not belong
   * to the legacy `retailer-documents` bucket — e.g. `banner-drafts`.
   *
   * Omitting it keeps the historical behaviour (retailer-documents) so every
   * existing caller is unaffected.
   */
  bucket?: string;
}

/**
 * Best-effort cleanup of a stored reference.
 *
 * Only Supabase objects that can be confidently identified are removed:
 *
 *   - a Supabase public URL  → its own bucket + path (must be allowlisted),
 *   - a bare object path     → `options.bucket`, or `retailer-documents`.
 *
 * The bucket is always checked against `DELETABLE_BUCKETS` and the path is
 * checked for traversal before any Storage call. Old files are never
 * auto-deleted en masse, and a failure here never aborts the caller's DB change.
 */
export async function deleteMedia(
  refValue: string | null | undefined,
  options: DeleteMediaOptions = {},
): Promise<DeleteOutcome> {
  const ref = parseMediaRef(refValue);
  if (!ref) return 'unrecognized';

  if (ref.provider === 'supabase-url') {
    if (!DELETABLE_BUCKETS.has(ref.bucket)) return 'unrecognized';
    if (!isSafeObjectPath(ref.path)) return 'unrecognized';
    return deleteFromSupabaseStorage(ref.bucket, ref.path);
  }

  if (ref.provider === 'object-path') {
    const bucket = options.bucket ?? LEGACY_OBJECT_PATH_BUCKET;
    if (!DELETABLE_BUCKETS.has(bucket)) return 'unrecognized';
    if (!isSafeObjectPath(ref.value)) return 'unrecognized';
    return deleteFromSupabaseStorage(bucket, ref.value);
  }

  return 'not-supabase';
}
