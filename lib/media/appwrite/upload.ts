import 'server-only';

/**
 * Appwrite upload primitive.
 *
 * This is the ONLY place in the codebase that writes a file to Appwrite.
 * It never decides *whether* an upload is allowed — `lib/media/index.ts`
 * does the Supabase session + permission + ownership checks first.
 */

import { ID, Permission, Role } from 'node-appwrite';

import { buildMediaPath, newFileId } from '../paths';
import { appwritePublicUrl, buildAppwriteRef } from '../refs';
import { MEDIA_KIND_CONFIG, type MediaKind, type UploadedMedia } from '../types';
import type { ValidatedFile } from '../validate';
import { bucketFor, getAppwriteStorage } from './server';

export interface AppwriteUploadInput {
  kind: MediaKind;
  /** Entity the file belongs to (product id, retailer id, …). Server-resolved. */
  ownerId: string | null;
  file: ValidatedFile;
}

export type AppwriteUploadResult =
  | { ok: true; media: UploadedMedia }
  | { ok: false; error: string };

/**
 * Store one validated file. The file id is a server-generated UUID; the
 * caller can never influence the bucket, the id, or the logical path.
 */
export async function uploadToAppwrite(
  input: AppwriteUploadInput,
): Promise<AppwriteUploadResult> {
  const config = MEDIA_KIND_CONFIG[input.kind];
  const storage = getAppwriteStorage();
  const bucketId = bucketFor(config.private);

  if (!storage || !bucketId) {
    return { ok: false, error: 'File storage is not configured on this deployment.' };
  }

  const fileId = newFileId();
  const path = buildMediaPath(input.kind, input.ownerId, fileId, input.file.mimeType);

  // Appwrite requires a Web File. We build it directly rather than using the
  // SDK's `InputFile.fromBuffer()` helper because that helper leaves `type`
  // empty, which would store the file with an unknown content type; here we
  // pass the MIME type we *sniffed from the bytes* (never the browser's claim).
  // The stored name carries the UUID so that a guessed filename can never
  // collide with, or reveal, another entity's file.
  const storedName = path.split('/').pop() ?? `${fileId}.bin`;
  const payload = new File([new Uint8Array(input.file.bytes)], storedName, {
    type: input.file.mimeType,
  });

  // Private files get NO role permissions at all: only the server API key can
  // read them, and only through the authorised /api/media/private route.
  // Public files are readable by anyone, which is what a CDN-delivered
  // product image needs. Writes are always API-key-only in both cases.
  const permissions = config.private ? [] : [Permission.read(Role.any())];

  try {
    await storage.createFile(bucketId, ID.custom(fileId), payload, permissions);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown storage error.';
    return { ok: false, error: `Upload failed: ${message}` };
  }

  const ref = buildAppwriteRef(bucketId, fileId);

  return {
    ok: true,
    media: {
      ref,
      fileId,
      bucketId,
      path,
      url: config.private ? null : appwritePublicUrl({ provider: 'appwrite', bucketId, fileId }),
      fileName: input.file.fileName,
      mimeType: input.file.mimeType,
      size: input.file.size,
    },
  };
}
