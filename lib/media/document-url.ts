import 'server-only';

/**
 * Resolve a `retailer_documents.file_url` value to a viewable link, whichever
 * storage generation it belongs to.
 *
 *  - `appwrite://<bucket>/<fileId>` → `/api/media/private?ref=…`, which
 *    re-checks the Supabase session and the document's owner before streaming.
 *  - a bare Supabase object path (legacy) → a short-lived Supabase signed URL,
 *    exactly as before. Existing documents keep working with no migration.
 */

import { getSignedUrl } from '@/lib/storage/signed-url';

import { parseMediaRef, privateMediaUrl } from './refs';

export async function resolveDocumentUrl(fileUrl: string): Promise<string | null> {
  const ref = parseMediaRef(fileUrl);
  if (!ref) return null;

  if (ref.provider === 'appwrite') return privateMediaUrl(fileUrl);

  // Legacy: absolute URLs are used directly, object paths get signed.
  if (/^https?:\/\//i.test(ref.value)) return ref.value;
  return getSignedUrl('retailer-documents', ref.value);
}
