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
export type PrivateBucket = 'retailer-documents' | 'supplier-documents' | 'delivery-proofs' | 'payment-proofs';

/**
 * `client` lets a caller that is NOT cookie-authenticated (the mobile API,
 * which authenticates with a bearer token) sign with its own RLS-scoped
 * client. Signing with the default cookie client from a bearer-token request
 * would use an ANONYMOUS session, and RLS would (correctly) refuse the URL —
 * the retailer would see "no proof" for proof they are entitled to.
 */
export async function getSignedUrl(
  bucket: PrivateBucket,
  path: string,
  expiresInSeconds = 3600,
  client?: ReturnType<typeof createClient>
): Promise<string | null> {
  const supabase = client ?? createClient();
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresInSeconds);
  if (error || !data) return null;
  return data.signedUrl;
}
