import 'server-only';

import type { createClient } from '@/lib/supabase/server';
import { deleteMedia } from '@/lib/media';

/**
 * Product-media safety helpers (Phase 4).
 *
 * Product media lives in three columns, all holding the same reference
 * format (a Supabase Storage public URL for the `product-images` bucket, or a
 * legacy absolute URL):
 *
 *   product_images.image_url       — the product gallery (0001)
 *   product_pack_images.image_url  — the per-variant gallery (0028)
 *   product_packs.image_url        — denormalised primary, kept in sync by
 *                                    trg_sync_product_pack_primary_image (0028)
 *
 * Three rules live here so every writer/deletor in
 * lib/admin/products-actions.ts applies them identically:
 *
 *   1. A file must not be deleted while ANY of the three columns still
 *      references it. `duplicatePackAction` copies gallery rows, so the same
 *      object is routinely referenced by more than one row; deleting the file
 *      on the first removal breaks every other row that shares it.
 *   2. Deleting a product or a pack cascades the child rows (FKs 0001/0004/
 *      0028) but Postgres cannot delete Storage objects — the refs must be
 *      collected BEFORE the row delete and cleaned up after it.
 *   3. Cleanup is best-effort, exactly like deleteMedia(): a Storage failure
 *      must never abort or roll back the operator's DB change. The audit
 *      trail is unaffected — the 0050 row triggers log every cascaded delete
 *      with the old ref in old_data.
 */

type SupabaseClient = ReturnType<typeof createClient>;

/** Tables scanned by isMediaRefStillReferenced, with their ref column. */
const REFERENCE_SOURCES = [
  { table: 'product_images', column: 'image_url' },
  { table: 'product_pack_images', column: 'image_url' },
  { table: 'product_packs', column: 'image_url' },
] as const;

/**
 * True when any product-media row still holds `ref`.
 *
 * Callers run this AFTER the row delete/update, so the scan already reflects
 * the post-change state and no row exclusion is needed. One bounded head
 * query per source table, so the cost stays constant regardless of size.
 */
export async function isMediaRefStillReferenced(
  supabase: SupabaseClient,
  ref: string
): Promise<boolean> {
  for (const source of REFERENCE_SOURCES) {
    const { count, error } = await supabase
      .from(source.table)
      .select('id', { count: 'exact', head: true })
      .eq(source.column, ref);
    if (error) throw new Error(error.message);
    if ((count ?? 0) > 0) return true;
  }
  return false;
}

/**
 * Delete the stored file for `ref` unless another product-media row still
 * references it. Returns the outcome for callers that want to surface it.
 */
export async function deleteMediaIfUnreferenced(
  supabase: SupabaseClient,
  ref: string | null | undefined
): Promise<'deleted' | 'still-referenced' | 'unrecognized' | 'not-supabase' | 'failed'> {
  if (!ref) return 'unrecognized';
  const stillReferenced = await isMediaRefStillReferenced(supabase, ref);
  if (stillReferenced) return 'still-referenced';
  return deleteMedia(ref);
}

/**
 * Collect every media ref a product owns: its gallery, every pack gallery,
 * and every pack's denormalised primary. Used by deleteProductAction so the
 * files can be cleaned up after the rows cascade away.
 */
export async function collectProductMediaRefs(
  supabase: SupabaseClient,
  productId: string
): Promise<string[]> {
  const [gallery, packs] = await Promise.all([
    supabase
      .from('product_images')
      .select('image_url')
      .eq('product_id', productId)
      .returns<{ image_url: string }[]>(),
    supabase
      .from('product_packs')
      .select('id, image_url')
      .eq('product_id', productId)
      .returns<{ id: string; image_url: string | null }[]>(),
  ]);
  if (gallery.error) throw new Error(gallery.error.message);
  if (packs.error) throw new Error(packs.error.message);

  const refs = new Set<string>();
  for (const row of gallery.data ?? []) {
    if (row.image_url) refs.add(row.image_url);
  }
  const packIds: string[] = [];
  for (const pack of packs.data ?? []) {
    packIds.push(pack.id);
    if (pack.image_url) refs.add(pack.image_url);
  }

  if (packIds.length > 0) {
    const { data: packGallery, error } = await supabase
      .from('product_pack_images')
      .select('image_url')
      .in('product_pack_id', packIds)
      .returns<{ image_url: string }[]>();
    if (error) throw new Error(error.message);
    for (const row of packGallery ?? []) {
      if (row.image_url) refs.add(row.image_url);
    }
  }

  return [...refs];
}

/**
 * Collect every media ref one pack owns: its gallery plus its denormalised
 * primary. Used by deleteProductPackAction.
 */
export async function collectPackMediaRefs(
  supabase: SupabaseClient,
  packId: string
): Promise<string[]> {
  const { data: pack, error: packError } = await supabase
    .from('product_packs')
    .select('image_url')
    .eq('id', packId)
    .maybeSingle<{ image_url: string | null }>();
  if (packError) throw new Error(packError.message);

  const { data: gallery, error: galleryError } = await supabase
    .from('product_pack_images')
    .select('image_url')
    .eq('product_pack_id', packId)
    .returns<{ image_url: string }[]>();
  if (galleryError) throw new Error(galleryError.message);

  const refs = new Set<string>();
  if (pack?.image_url) refs.add(pack.image_url);
  for (const row of gallery ?? []) {
    if (row.image_url) refs.add(row.image_url);
  }
  return [...refs];
}

/**
 * Best-effort cleanup of a list of refs after their owning rows are gone.
 * The rows are already deleted at this point, so nothing here may throw:
 * a Storage outage must not turn a successful delete into an error page.
 * The still-referenced guard still applies per ref — a duplicated pack can
 * legitimately keep a shared file alive on rows this delete did not touch.
 */
export async function cleanupMediaRefsBestEffort(supabase: SupabaseClient, refs: string[]): Promise<void> {
  for (const ref of refs) {
    try {
      await deleteMediaIfUnreferenced(supabase, ref);
    } catch {
      // Best-effort by contract: the file may remain, the rows are gone.
    }
  }
}
