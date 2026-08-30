-- ============================================================================
-- 0021: ensure `category-images` bucket exists (idempotent fix)
--
-- ROOT CAUSE of "Upload failed: Bucket not found": the category-image upload
-- path (MEDIA_KIND_CONFIG['category-image'] → lib/media/supabase.ts) targets
-- the `category-images` bucket created by 0016_storage_paths_category_bucket.sql,
-- but 0016 is not guaranteed to have run: README §1 and docs/deployment_guide.md §1
-- instruct operators to apply only 0001–0003, and the deploy pipeline explicitly
-- does NOT apply later migrations automatically. Supabase Storage rejects an
-- upload to a missing bucket with "Bucket not found" before RLS even runs — so
-- the app code, the bucket name and the API call are all correct; only the
-- bucket row is missing in that project.
--
-- This migration is SAFE IN EVERY STATE and never creates a second bucket:
--   * 0016 already applied → every statement below is a no-op (same bucket id,
--     same policy names, `on conflict do nothing`, `drop policy if exists`);
--   * 0016 never applied (this bug) → creates exactly the same `category-images`
--     bucket, limits, visibility and policies that 0016 defines.
--
-- Intentional access model (identical to 0016 — no permission is widened):
--   * public read   → retailers' <img> display of category thumbnails (anon);
--   * insert/update  → is_staff_or_above() only (Admin/staff upload & replace);
--   * delete         → is_admin_or_above() only (image cleanup).
-- No service-role key is involved anywhere in the upload flow (`lib/media/
-- supabase.ts` writes with the caller's own session so RLS stays the final
-- authority), and no other bucket or policy is touched.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Bucket — same id/name/settings as 0016. `on conflict (id) do nothing`
--    guarantees that a project which already ran 0016 is left untouched
--    instead of receiving a duplicate bucket.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('category-images', 'category-images', true, 2097152, array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 1b. Reconcile visibility only. If a partial 0016 run left a non-public
--     `category-images` bucket, uploads would succeed but the public URL the
--     retailer app renders would 400. Align it to the documented public-read
--     model. This never disables public access for any other bucket and never
--     changes size/MIME limits on an already-public bucket.
-- ----------------------------------------------------------------------------
update storage.buckets
  set public = true
  where id = 'category-images' and public is distinct from true;

-- ----------------------------------------------------------------------------
-- 2. Storage RLS policies — drop-then-create with the SAME names 0016 uses, so
--    re-applying after a partially applied 0016 converges instead of erroring.
-- ----------------------------------------------------------------------------
drop policy if exists "public_read_category_images" on storage.objects;
create policy "public_read_category_images" on storage.objects
  for select using (bucket_id = 'category-images');

drop policy if exists "staff_write_category_images" on storage.objects;
create policy "staff_write_category_images" on storage.objects
  for insert with check (bucket_id = 'category-images' and is_staff_or_above());

drop policy if exists "staff_update_category_images" on storage.objects;
create policy "staff_update_category_images" on storage.objects
  for update using (bucket_id = 'category-images' and is_staff_or_above());

drop policy if exists "staff_delete_category_images" on storage.objects;
create policy "staff_delete_category_images" on storage.objects
  for delete using (bucket_id = 'category-images' and is_admin_or_above());

-- ============================================================================
-- END OF MIGRATION — bucket configuration only; no business data is inserted,
-- moved or deleted.
-- ============================================================================
