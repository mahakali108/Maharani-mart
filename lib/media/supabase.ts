import 'server-only';

/**
 * Supabase Storage write/delete primitives.
 *
 * This is the ONLY place in the codebase that writes to or deletes from
 * Supabase Storage. It never decides *whether* an upload is allowed —
 * `lib/media/index.ts` does the Supabase session + permission + ownership
 * checks first (`lib/media/access.ts`), and Postgres/storage RLS remains the
 * final authority on the write.
 *
 * All operations run through the **server client bound to the caller's own
 * session** (`lib/supabase/server.ts`), never the service-role key, so the
 * storage RLS policies from supabase/migrations/0003, 0006 and 0013 apply.
 */

import { createClient } from '@/lib/supabase/server';

import { buildMediaPath, newFileId } from './paths';
import { MEDIA_KIND_CONFIG, type MediaKind, type UploadedMedia } from './types';
import type { ValidatedFile } from './validate';

export interface SupabaseUploadInput {
  kind: MediaKind;
  /** Entity the file belongs to (product id, retailer id, …). Server-resolved. */
  ownerId: string | null;
  file: ValidatedFile;
}

export type SupabaseUploadResult =
  | { ok: true; media: UploadedMedia }
  | { ok: false; error: string };

/**
 * Store one validated file. The object name is a server-generated UUID; the
 * caller can never influence the bucket, the id, or the path.
 */
export async function uploadToSupabaseStorage(
  input: SupabaseUploadInput,
): Promise<SupabaseUploadResult> {
  const config = MEDIA_KIND_CONFIG[input.kind];
  const supabase = createClient();

  const fileId = newFileId();
  const path = buildMediaPath(input.kind, input.ownerId, fileId, input.file.mimeType);

  const { error } = await supabase.storage.from(config.bucket).upload(
    path,
    new Uint8Array(input.file.bytes),
    {
      // Never upsert: the path contains a fresh UUID, so an overwrite would
      // only ever happen through a collision that must not be silently clobbered.
      upsert: false,
      contentType: input.file.mimeType,
      cacheControl: '3600',
    },
  );

  if (error) {
    return { ok: false, error: `Upload failed: ${error.message}` };
  }

  let url: string | null = null;
  if (!config.private) {
    const { data } = supabase.storage.from(config.bucket).getPublicUrl(path);
    url = data.publicUrl;
  }

  return {
    ok: true,
    media: {
      // Public media persist their public URL; private media persist the
      // object path (resolved to a signed URL at read time).
      ref: config.private ? path : (url ?? path),
      bucket: config.bucket,
      path,
      url,
      fileName: input.file.fileName,
      mimeType: input.file.mimeType,
      size: input.file.size,
    },
  };
}

export type DeleteOutcome = 'deleted' | 'not-supabase' | 'failed' | 'unrecognized';

/**
 * Best-effort, non-throwing delete of a single Supabase Storage object.
 * Losing a file is never allowed to abort the surrounding DB operation, and
 * legacy files the code cannot confidently identify are left untouched.
 */
export async function deleteFromSupabaseStorage(
  bucket: string,
  path: string,
): Promise<DeleteOutcome> {
  const supabase = createClient();
  try {
    const { error } = await supabase.storage.from(bucket).remove([path]);
    // Supabase reports no error for a missing object; either way this is safe.
    return error ? 'failed' : 'deleted';
  } catch {
    return 'failed';
  }
}
