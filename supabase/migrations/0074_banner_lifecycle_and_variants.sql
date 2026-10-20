-- ============================================================================
-- Banner lifecycle and responsive artwork.
--
--   * `status` separates a private draft from a published banner instead of
--     overloading `is_active` (which stays the merchant's pause switch).
--   * `image_url_mobile` adds an optional 4:3 mobile rendition; when it is
--     null the desktop artwork is used, so existing banners are unchanged.
--
-- Purely additive: no row is deleted, no existing column is rewritten, and
-- every pre-existing banner becomes 'published'. The SELECT policy is narrowed
-- so drafts can never leak to retailers while is_active is true, and the WRITE
-- policy is aligned with the `banners.manage` permission (admin and super_admin
-- only — staff never held that permission in the application).
-- Safe to re-run, including after a partially applied earlier attempt.
-- ============================================================================

alter table public.banners
  add column if not exists image_url_mobile text,
  add column if not exists status text not null default 'published';

-- Converge a partially applied earlier attempt: `add column if not exists`
-- would leave a nullable `status` untouched, and a CHECK constraint passes for
-- NULL, so a NULL row could escape the approved status set.
do $$
begin
  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'banners'
       and column_name = 'status'
       and is_nullable = 'YES'
  ) then
    update public.banners set status = 'published' where status is null;
    alter table public.banners alter column status set default 'published';
    alter table public.banners alter column status set not null;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.banners'::regclass
       and conname = 'banners_status_check'
  ) then
    alter table public.banners
      add constraint banners_status_check check (status in ('draft', 'published'));
  end if;
end;
$$;

comment on column public.banners.image_url_mobile is
  'Optional mobile art-directed rendition (4:3). Falls back to image_url when null.';
comment on column public.banners.status is
  'draft = hidden from every non-staff reader; published = eligible when is_active and the schedule window is open.';

create index if not exists banners_public_feed_idx
  on public.banners (status, is_active, sort_order, id)
  where is_active;

-- 0001 created `banners_read` as `(is_active or is_staff_or_above())`, which
-- would expose a draft whenever is_active stayed true. Replace it with the
-- same staff escape hatch plus a published requirement for everyone else.
drop policy if exists "banners_read" on public.banners;
create policy "banners_read" on public.banners
  for select using ((is_active and status = 'published') or is_staff_or_above());

-- 0001 granted `banners_write` to every staff member, which is broader than the
-- application's `banners.manage` permission (admin + super_admin only, see
-- lib/permissions/permissions.ts). A staff session talking straight to
-- PostgREST could therefore write banners the UI would never offer it.
drop policy if exists "banners_write" on public.banners;
create policy "banners_write" on public.banners
  for all
  using (is_admin_or_above())
  with check (is_admin_or_above());
