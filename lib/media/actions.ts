'use server';

/**
 * The single Server Action every uploader UI calls.
 *
 * Client components hand over a FormData containing `kind`, an optional
 * `ownerId`, and `file`. Everything security-relevant (session, permission,
 * ownership, MIME sniffing, size, dimensions, bucket, file id, path) is
 * decided on the server inside `uploadMedia()`.
 */

import { uploadMedia } from '@/lib/media';
import type { UploadMediaResult } from '@/lib/media/types';

export async function uploadMediaAction(formData: FormData): Promise<UploadMediaResult> {
  const kind = formData.get('kind');
  const ownerId = formData.get('ownerId');
  const file = formData.get('file');

  if (!(file instanceof File)) {
    return { ok: false, error: 'No file was received.' };
  }

  return uploadMedia(kind, ownerId, file);
}
