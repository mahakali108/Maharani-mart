import 'server-only';

/**
 * Appwrite delete primitive.
 *
 * Deliberately best-effort and non-throwing: losing a file is never allowed to
 * abort the surrounding Supabase transaction (deleting a banner row must
 * succeed even if the object is already gone).
 *
 * NOTE: this only ever touches Appwrite. Files that still live in Supabase
 * Storage are never deleted by this codebase — see docs/storage.md §Rollback.
 */

import { parseMediaRef } from '../refs';
import { getAppwriteStorage } from './server';

export type DeleteOutcome = 'deleted' | 'not-appwrite' | 'not-configured' | 'failed';

export async function deleteFromAppwrite(
  refValue: string | null | undefined,
): Promise<DeleteOutcome> {
  const ref = parseMediaRef(refValue);

  // Legacy Supabase URLs/paths are intentionally left untouched.
  if (!ref || ref.provider !== 'appwrite') return 'not-appwrite';

  const storage = getAppwriteStorage();
  if (!storage) return 'not-configured';

  try {
    await storage.deleteFile(ref.bucketId, ref.fileId);
    return 'deleted';
  } catch {
    // Already deleted, or transient failure — the DB row removal still stands.
    return 'failed';
  }
}
