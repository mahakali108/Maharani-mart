import { createClient } from '@/lib/supabase/client';

export type StorageBucket = 'product-images' | 'banners' | 'avatars' | 'brand-logos' | 'retailer-documents';

const PRIVATE_BUCKETS: StorageBucket[] = ['retailer-documents'];

export interface UploadResult {
  path: string;
  /** Null for private buckets (e.g. retailer-documents) — use getSignedUrl() to view/download instead. */
  publicUrl: string | null;
}

/**
 * Uploads a single file to a Supabase Storage bucket and returns its
 * path (+ public URL, for public buckets only). Bucket-level RLS (see
 * supabase/migrations/0003_storage_buckets.sql and
 * supabase/migrations/0006_retailer_documents.sql) enforces who may
 * write to which bucket — this helper does not bypass that.
 *
 * Used by Admin Panel screens for product images, banners, brand
 * logos, retailer KYC documents, and by the retailer/staff profile
 * screen for avatars.
 */
export async function uploadFile(
  bucket: StorageBucket,
  file: File,
  path: string
): Promise<UploadResult> {
  const supabase = createClient();

  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    cacheControl: '3600',
    upsert: true,
  });

  if (error) {
    throw new Error(`Upload failed: ${error.message}`);
  }

  if (PRIVATE_BUCKETS.includes(bucket)) {
    return { path, publicUrl: null };
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return { path, publicUrl: data.publicUrl };
}

export async function removeFile(bucket: StorageBucket, path: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) {
    throw new Error(`Delete failed: ${error.message}`);
  }
}

/**
 * Builds a collision-safe storage path, e.g.
 * buildPath('sku-123', file) -> "sku-123/1721000000000-photo.jpg"
 */
export function buildPath(prefix: string, file: File): string {
  const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '-');
  return `${prefix}/${Date.now()}-${safeName}`;
}
