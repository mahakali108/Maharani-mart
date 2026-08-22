-- ============================================================================
-- 0016: Supabase Storage — category bucket + object-path alignment
--
-- Reverts file storage to Supabase-only and completes the bucket set so every
-- logical upload kind has a home:
--
--   product-gallery  → product-images      products/{productId}/gallery/{uuid}.{ext}
--   brand-logo       → brand-logos         brands/{brandId}/{uuid}.{ext}
--   category-image   → category-images     categories/{categoryId}/{uuid}.{ext}   (NEW bucket)
--   banner           → banners             banners/{bannerId}/{uuid}.{ext}
--   retailer-avatar  → avatars             avatars/{userId}/{uuid}.{ext}
--   retailer-document→ retailer-documents  retailers/{retailerId}/documents/{uuid}.{ext}
--
-- Additive only: no existing bucket is renamed, no data is moved, and no
-- legacy object path stops working. The `category-images` bucket is new.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. NEW bucket: category-images (public, 2 MB, png/jpeg/webp).
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('category-images', 'category-images', true, 2097152, array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;

create policy "public_read_category_images" on storage.objects
  for select using (bucket_id = 'category-images');

create policy "staff_write_category_images" on storage.objects
  for insert with check (bucket_id = 'category-images' and is_staff_or_above());
create policy "staff_update_category_images" on storage.objects
  for update using (bucket_id = 'category-images' and is_staff_or_above());
create policy "staff_delete_category_images" on storage.objects
  for delete using (bucket_id = 'category-images' and is_admin_or_above());

-- ----------------------------------------------------------------------------
-- 2. retailer-documents: accept the new `retailers/<retailerId>/documents/…`
--    layout for self-read, in addition to the legacy `<retailerId>/…` layout.
--    Staff and above are unchanged.
-- ----------------------------------------------------------------------------
drop policy if exists "retailer_documents_bucket_read" on storage.objects;
create policy "retailer_documents_bucket_read" on storage.objects
  for select using (
    bucket_id = 'retailer-documents'
    and (
      is_staff_or_above()
      -- legacy layout: <retailerId>/<timestamp>-<name>
      or (storage.foldername(name))[1] = auth.uid()::text
      -- current layout: retailers/<retailerId>/documents/<uuid>.<ext>
      or (
        (storage.foldername(name))[1] = 'retailers'
        and (storage.foldername(name))[2] = auth.uid()::text
      )
    )
  );

-- ----------------------------------------------------------------------------
-- 3. avatars: accept the new `avatars/<userId>/…` layout for self write/update,
--    in addition to the legacy `<userId>/…` layout. No delete policy exists
--    today and none is added here (avatar replacement is an upsert-over-write
--    avoided at the application layer via unique object names).
-- ----------------------------------------------------------------------------
drop policy if exists "self_write_avatar" on storage.objects;
create policy "self_write_avatar" on storage.objects
  for insert with check (
    bucket_id = 'avatars'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or (
        (storage.foldername(name))[1] = 'avatars'
        and (storage.foldername(name))[2] = auth.uid()::text
      )
    )
  );

drop policy if exists "self_update_avatar" on storage.objects;
create policy "self_update_avatar" on storage.objects
  for update using (
    bucket_id = 'avatars'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or (
        (storage.foldername(name))[1] = 'avatars'
        and (storage.foldername(name))[2] = auth.uid()::text
      )
    )
  );

-- ============================================================================
-- END OF MIGRATION — no business data inserted or modified.
-- ============================================================================
