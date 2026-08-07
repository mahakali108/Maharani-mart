-- ============================================================================
-- 0013: RLS + storage policy hardening
-- ============================================================================

-- staff_assignments, schemes, and notification_logs were created in
-- 0001_init.sql but never had Row Level Security enabled anywhere in
-- this migration history. With RLS off, Postgres applies no
-- restriction at all — any authenticated user (e.g. a retailer signed
-- in on the browser client, which uses the public anon key) could
-- read or write these tables directly via PostgREST, bypassing every
-- app-level permission check. notification_logs is the most pressing
-- of the three: it's written by lib/notifications/notify.ts using the
-- regular (anon-key, RLS-subject) server client, so it needs an
-- explicit insert policy to keep working once RLS is turned on.

alter table staff_assignments enable row level security;

create policy "staff_assignments_staff_read" on staff_assignments
  for select using (staff_id = auth.uid() or is_staff_or_above());
create policy "staff_assignments_admin_write" on staff_assignments
  for insert with check (is_admin_or_above());
create policy "staff_assignments_admin_update" on staff_assignments
  for update using (is_admin_or_above());
create policy "staff_assignments_admin_delete" on staff_assignments
  for delete using (is_admin_or_above());

alter table schemes enable row level security;

create policy "schemes_read" on schemes
  for select using (is_active or is_staff_or_above());
create policy "schemes_staff_insert" on schemes
  for insert with check (is_staff_or_above());
create policy "schemes_staff_update" on schemes
  for update using (is_staff_or_above());
create policy "schemes_admin_delete" on schemes
  for delete using (is_admin_or_above());

alter table notification_logs enable row level security;

create policy "notification_logs_owner_or_staff_read" on notification_logs
  for select using (recipient_id = auth.uid() or is_staff_or_above());
create policy "notification_logs_insert" on notification_logs
  for insert with check (recipient_id = auth.uid() or is_staff_or_above());
create policy "notification_logs_staff_update" on notification_logs
  for update using (is_staff_or_above());

-- storage.objects: brand-logos bucket has an insert policy
-- (0003_storage_buckets.sql) but, unlike product-images and banners,
-- no update or delete policy. lib/storage/upload.ts always uploads
-- with upsert: true, which Supabase Storage treats as an UPDATE when
-- the path already exists — so re-uploading or deleting a brand logo
-- would fail with an RLS violation the moment that UI is wired up.
create policy "staff_update_brand_logos" on storage.objects
  for update using (bucket_id = 'brand-logos' and is_staff_or_above());
create policy "staff_delete_brand_logos" on storage.objects
  for delete using (bucket_id = 'brand-logos' and is_admin_or_above());

-- The product-images bucket's own delete policy required
-- is_admin_or_above(), but the matching product_images TABLE row can
-- already be deleted by is_staff_or_above() (see
-- "product_images_staff_delete" in 0005_master_data_delete_and_pricing.sql),
-- and that is also the permission level lib/admin/products-actions.ts's
-- removeProductImageAction is gated on ('products.edit', which staff
-- holds). Realigning the storage object policy so a staff user's
-- image removal actually deletes the file, not just the row.
drop policy if exists "staff_delete_product_images" on storage.objects;
create policy "staff_delete_product_images" on storage.objects
  for delete using (bucket_id = 'product-images' and is_staff_or_above());

-- ============================================================================
-- END OF MIGRATION — no business data inserted or modified.
-- ============================================================================
