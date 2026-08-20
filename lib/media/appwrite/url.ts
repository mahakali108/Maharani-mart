import 'server-only';

/**
 * Server-side URL/bytes helpers for Appwrite files.
 *
 * Public delivery URLs are built by `lib/media/refs.ts` (isomorphic, no
 * secrets). This module only covers the server-side concerns: streaming
 * private file bytes through an authorised route handler.
 */

import { parseMediaRef } from '../refs';
import { getAppwriteStorage } from './server';

export interface PrivateFileBytes {
  bytes: Buffer;
  mimeType: string;
  fileName: string;
}

/**
 * Fetch the raw bytes of an Appwrite file using the server API key.
 *
 * The caller MUST have already authorised the request — this function performs
 * no permission checking of its own. Used by `/api/media/private`, which
 * re-validates the Supabase session and role first.
 */
export async function readAppwriteFile(refValue: string): Promise<PrivateFileBytes | null> {
  const ref = parseMediaRef(refValue);
  if (!ref || ref.provider !== 'appwrite') return null;

  const storage = getAppwriteStorage();
  if (!storage) return null;

  try {
    const [metadata, buffer] = await Promise.all([
      storage.getFile(ref.bucketId, ref.fileId),
      storage.getFileDownload(ref.bucketId, ref.fileId),
    ]);

    return {
      bytes: Buffer.from(buffer),
      mimeType: metadata.mimeType || 'application/octet-stream',
      fileName: metadata.name || 'document',
    };
  } catch {
    return null;
  }
}
