import 'server-only';

/**
 * Resolve a delivery/payment proof column value (an object path in a private
 * bucket, by construction of the Phase 4 flows) to a short-lived signed URL.
 * Falls back to null for empty/foreign values so pages render a placeholder
 * instead of crashing. RLS on storage.objects (migration 0045) decides
 * whether the caller may actually receive the URL.
 */

import { getSignedUrl, type PrivateBucket } from '@/lib/storage/signed-url';

import { parseMediaRef } from '@/lib/media/refs';

const BUCKET_BY_PREFIX: { prefix: string; bucket: PrivateBucket }[] = [
  { prefix: 'deliveries/', bucket: 'delivery-proofs' },
  { prefix: 'payments/', bucket: 'payment-proofs' },
];

export async function resolveProofUrl(ref: string | null | undefined): Promise<string | null> {
  if (!ref || ref.trim() === '') return null;

  const parsed = parseMediaRef(ref);
  if (parsed?.provider === 'supabase-url') return parsed.url;
  if (parsed?.provider === 'external-url') return parsed.value;
  if (parsed?.provider === 'object-path') {
    const match = BUCKET_BY_PREFIX.find((b) => parsed.value.startsWith(b.prefix));
    if (!match) return null;
    return getSignedUrl(match.bucket, parsed.value);
  }
  return null;
}
