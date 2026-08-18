import 'server-only';

import { getSignedUrl as getSupabaseSignedUrl } from '@/lib/storage/signed-url';
import { getSignedDownloadUrl, isFirebaseAdminConfigured } from '@/lib/storage';
import { isFirebaseObjectPath, isHttpUrl, resolveMediaUrl } from '@/lib/storage/urls';

/**
 * Resolves a private document reference to a short-lived URL.
 * New Firebase paths use Admin signed URLs. Legacy Supabase object
 * paths keep using the existing Supabase helper so old files still open.
 */
export async function getPrivateFileUrl(stored: string | null | undefined): Promise<string | null> {
  if (!stored) return null;
  const value = stored.trim();
  if (!value) return null;
  if (isHttpUrl(value)) return value;

  if (isFirebaseObjectPath(value)) {
    if (!isFirebaseAdminConfigured()) return null;
    return getSignedDownloadUrl(value);
  }

  return getSupabaseSignedUrl('retailer-documents', value);
}

/** Public marketplace image: Firebase path, or a leftover full URL. */
export function getPublicMediaUrl(stored: string | null | undefined): string | null {
  return resolveMediaUrl(stored);
}
