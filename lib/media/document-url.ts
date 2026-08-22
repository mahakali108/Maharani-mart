import 'server-only';

/**
 * Resolve a `retailer_documents.file_url` value to a viewable link.
 *
 *  - a bare object path (current) → a short-lived Supabase signed URL. RLS on
 *    `retailer-documents` (supabase/migrations/0006) still applies: a retailer
 *    can only get a signed URL for their own documents, staff+ for anyone's.
 *  - a full Supabase public URL (legacy) → used directly.
 *  - an absolute external URL (legacy) → used directly.
 */

import { getSignedUrl } from '@/lib/storage/signed-url';

import { parseMediaRef } from './refs';

export async function resolveDocumentUrl(fileUrl: string): Promise<string | null> {
  const ref = parseMediaRef(fileUrl);
  if (!ref) return null;

  if (ref.provider === 'supabase-url') return ref.url;
  if (ref.provider === 'external-url') return ref.value;
  return getSignedUrl('retailer-documents', ref.value);
}
