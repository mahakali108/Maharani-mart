-- ============================================================================
-- Rollback 0074: restore the original banner SELECT policy and remove the
-- additive lifecycle/art-direction columns.
--
-- Run only after the application has been rolled back. Draft banners would
-- become publicly readable again (matching the 0001 behaviour), so pause or
-- delete them from the admin UI first if that is not acceptable.
-- No banner row is deleted by this rollback.
-- ============================================================================

drop policy if exists "banners_read" on public.banners;
create policy "banners_read" on public.banners
  for select using (is_active or is_staff_or_above());

-- Restore the original 0001 write policy exactly (staff included again).
drop policy if exists "banners_write" on public.banners;
create policy "banners_write" on public.banners
  for all using (is_staff_or_above());

drop index if exists public.banners_public_feed_idx;

alter table public.banners
  drop constraint if exists banners_status_check,
  drop column if exists status,
  drop column if exists image_url_mobile;
