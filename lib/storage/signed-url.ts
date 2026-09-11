import 'server-only';
import { createClient } from '@/lib/supabase/server';

/**
 * Generates a time-limited signed URL for an object in a PRIVATE
 * bucket. Must run server-side — relies on the caller's own session,
 * so RLS on storage.objects still applies:
 *
 *  - retailer-documents (0006): a retailer can only get a signed URL
 *    for their own documents; staff+ for any retailer's documents.
 *  - delivery-proofs (0045): a retailer only for proofs linked to their
 *    own delivery; staff/salesman only when assigned to it.
 *  - payment-proofs (0045): a retailer only for their own folder; the
 *    collecting salesman for rows they recorded; admin+ for anything.
 */
export type PrivateBucket = 'retailer-documents' | 'delivery-proofs' | 'payment-proofs';

export async function getSignedUrl(
  bucket: PrivateBucket,
  path: string,
  expiresInSeconds = 3600
): Promise<string | null> {
  const supabase = createClient();
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresInSeconds);
  if (error || !data) return null;
  return data.signedUrl;
}
