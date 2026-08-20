import 'server-only';

/**
 * Media facade — the ONLY module application code should import for
 * uploading or deleting files.
 *
 * The rest of the app never imports `node-appwrite`, never sees a bucket id,
 * and never builds a storage path. Swapping the storage provider means
 * changing `lib/media/appwrite/*` and nothing else.
 *
 * Flow enforced here:
 *   browser  →  Supabase session (requireUser)
 *            →  role/permission + ownership check (lib/media/access)
 *            →  server-side validation (lib/media/validate)
 *            →  Appwrite write (lib/media/appwrite/upload)
 *            →  caller persists `result.ref` in the existing Supabase column
 */

import { authorizeMediaWrite } from './access';
import { deleteFromAppwrite, type DeleteOutcome } from './appwrite/delete';
import { uploadToAppwrite } from './appwrite/upload';
import { isAppwriteConfigured } from './appwrite/server';
import { validateUpload } from './validate';
import { isMediaKind, type MediaKind, type UploadMediaResult } from './types';

export { isAppwriteConfigured, hasDedicatedPrivateBucket } from './appwrite/server';
export { deleteFromAppwrite } from './appwrite/delete';
export { readAppwriteFile } from './appwrite/url';
export { authorizeMediaWrite, authorizePrivateMediaRead } from './access';
export {
  parseMediaRef,
  buildAppwriteRef,
  isAppwriteRef,
  isLegacyObjectPath,
  resolveMediaUrl,
  appwritePublicUrl,
  privateMediaUrl,
} from './refs';
export { MEDIA_KINDS, MEDIA_KIND_CONFIG, isMediaKind } from './types';
export type { MediaKind, MediaRef, UploadedMedia, UploadMediaResult } from './types';

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

  if (!isAppwriteConfigured()) {
    return {
      ok: false,
      error:
        'File storage is not configured on this deployment. Ask an administrator to set the Appwrite environment variables.',
    };
  }

  // 1. Supabase session + role + ownership. Throws only via requireUser()'s
  //    redirect when there is no session at all.
  const access = await authorizeMediaWrite(kind, rawOwnerId);
  if (!access.ok) return { ok: false, error: access.error };

  // 2. Content-based validation — browser-supplied MIME is ignored.
  const validated = await validateUpload(kind, file);
  if (!validated.ok) return { ok: false, error: validated.error };

  // 3. Write. Bucket, file id and path are all server-derived.
  const stored = await uploadToAppwrite({ kind, ownerId: access.ownerId, file: validated.file });
  if (!stored.ok) return { ok: false, error: stored.error };

  return { ok: true, ...stored.media };
}

/**
 * Best-effort cleanup of a stored reference.
 *
 * Legacy Supabase Storage values are intentionally ignored — old files are
 * never auto-deleted by this codebase.
 */
export async function deleteMedia(refValue: string | null | undefined): Promise<DeleteOutcome> {
  return deleteFromAppwrite(refValue);
}
