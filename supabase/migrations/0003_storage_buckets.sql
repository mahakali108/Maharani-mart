-- ============================================================================
-- 0003: Storage buckets + policies for images/files
-- No files are uploaded by this migration — buckets only. All actual
-- images (products, banners, avatars) are uploaded later via the
-- Admin Panel / Retailer profile screens.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('product-images', 'product-images', true, 5242880, array['image/png','image/jpeg','image/webp']),
  ('banners', 'banners', true, 5242880, array['image/png','image/jpeg','image/webp']),
  ('avatars', 'avatars', true, 2097152, array['image/png','image/jpeg','image/webp']),
  ('brand-logos', 'brand-logos', true, 2097152, array['image/png','image/jpeg','image/webp','image/svg+xml'])
on conflict (id) do nothing;

-- Public read for all four buckets (product/banner/logo images and
-- avatars are shown across the retailer app without auth).
create policy "public_read_product_images" on storage.objects
  for select using (bucket_id = 'product-images');
create policy "public_read_banners" on storage.objects
  for select using (bucket_id = 'banners');
create policy "public_read_avatars" on storage.objects
  for select using (bucket_id = 'avatars');
create policy "public_read_brand_logos" on storage.objects
  for select using (bucket_id = 'brand-logos');

-- Only staff+ can upload/modify catalog imagery.
create policy "staff_write_product_images" on storage.objects
  for insert with check (bucket_id = 'product-images' and is_staff_or_above());
create policy "staff_update_product_images" on storage.objects
  for update using (bucket_id = 'product-images' and is_staff_or_above());
create policy "staff_delete_product_images" on storage.objects
  for delete using (bucket_id = 'product-images' and is_admin_or_above());

create policy "staff_write_banners" on storage.objects
  for insert with check (bucket_id = 'banners' and is_staff_or_above());
create policy "staff_update_banners" on storage.objects
  for update using (bucket_id = 'banners' and is_staff_or_above());
create policy "staff_delete_banners" on storage.objects
  for delete using (bucket_id = 'banners' and is_admin_or_above());

create policy "staff_write_brand_logos" on storage.objects
  for insert with check (bucket_id = 'brand-logos' and is_staff_or_above());

-- Any authenticated user can upload/replace their OWN avatar, named
-- with their user id as the path prefix, e.g. `avatars/<user_id>/photo.jpg`.
create policy "self_write_avatar" on storage.objects
  for insert with check (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "self_update_avatar" on storage.objects
  for update using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
