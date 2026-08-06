import 'server-only';
import { createClient } from '@/lib/supabase/server';

/**
 * Generates a time-limited signed URL for an object in a PRIVATE
 * bucket (currently only `retailer-documents`). Must run server-side
 * — relies on the caller's own session, so RLS on storage.objects
 * (see supabase/migrations/0006_retailer_documents.sql) still applies:
 * a retailer can only get a signed URL for their own documents, staff+
 * can get one for any retailer's documents.
 */
export async function getSignedUrl(
  bucket: 'retailer-documents',
  path: string,
  expiresInSeconds = 3600
): Promise<string | null> {
  const supabase = createClient();
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresInSeconds);
  if (error || !data) return null;
  return data.signedUrl;
}
