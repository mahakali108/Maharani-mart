-- ============================================================================
-- 0077 — private storage for UNPUBLISHED banner artwork.
--
-- REVIEW ONLY. This migration is NOT applied to any Supabase project. No
-- bucket exists and no storage policy has been changed anywhere.
--
-- Scope:
--   * a new PRIVATE bucket `banner-drafts`, admin-only (matching the
--     `banners.manage` permission), holding artwork for banners that are not
--     published yet;
--   * two nullable columns on `banners` that point at those private objects.
--
-- Explicitly NOT in scope:
--   * the existing public `banners` bucket is untouched — same `public = true`,
--     same four storage policies, same object paths, same URLs;
--   * no existing object is moved, copied, rewritten or deleted;
--   * no published URL changes, so the storefront, the admin list and the
--     mobile home payload render exactly as they do today.
--
-- Migration numbering: 0075 is reserved for the data-retention archive (on
-- hold pending accountant/legal review) and 0076 for banner `alt_text`
-- (deferred). This file is 0077 so those numbers are not taken.
--
-- Safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The private bucket
-- ---------------------------------------------------------------------------
-- `on conflict (id) do nothing` never rewrites an existing bucket row: if the
-- bucket already exists with different settings this migration must NOT
-- silently "fix" it, because changing visibility under live objects is an
-- operator decision, not a migration side effect. The check below turns that
-- situation into a loud failure instead of a quiet misconfiguration.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'banner-drafts',
  'banner-drafts',
  false,                                  -- private: unreachable without a signed URL
  5242880,                                -- 5 MB, the same ceiling as `banners`
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1
      from storage.buckets
     where id = 'banner-drafts'
       and public = false
  ) then
    raise exception 'banner-drafts exists but is not private. Refusing to continue: review the bucket configuration before re-running this migration.';
  end if;
end;
$$;

comment on table storage.buckets is
  'Supabase-managed. banner-drafts (0077) is private and holds unpublished banner artwork.';

-- ---------------------------------------------------------------------------
-- 2. Storage policies — admin only, mirroring `banners.manage`
-- ---------------------------------------------------------------------------
-- Permission matrix reference (lib/permissions/permissions.ts): `banners.manage`
-- is granted to admin + super_admin. Staff keep their existing rights on the
-- public `banners` bucket and gain nothing here.
drop policy if exists "admin_read_banner_drafts" on storage.objects;
create policy "admin_read_banner_drafts" on storage.objects
  for select using (bucket_id = 'banner-drafts' and is_admin_or_above());

drop policy if exists "admin_write_banner_drafts" on storage.objects;
create policy "admin_write_banner_drafts" on storage.objects
  for insert with check (bucket_id = 'banner-drafts' and is_admin_or_above());

drop policy if exists "admin_update_banner_drafts" on storage.objects;
create policy "admin_update_banner_drafts" on storage.objects
  for update using (bucket_id = 'banner-drafts' and is_admin_or_above())
  with check (bucket_id = 'banner-drafts' and is_admin_or_above());

drop policy if exists "admin_delete_banner_drafts" on storage.objects;
create policy "admin_delete_banner_drafts" on storage.objects
  for delete using (bucket_id = 'banner-drafts' and is_admin_or_above());

-- ---------------------------------------------------------------------------
-- 3. Columns pointing at private draft objects
-- ---------------------------------------------------------------------------
-- These hold an OBJECT PATH, never a URL. An absolute URL in either column
-- would mean private artwork had already been exposed, so the constraints
-- below reject one outright.
alter table public.banners
  add column if not exists draft_image_path text,
  add column if not exists draft_image_mobile_path text;

comment on column public.banners.draft_image_path is
  'Private object path in banner-drafts (banners/{bannerId|_draft}/{uuid}.{jpg|png|webp}). Visible only to admins via a short-lived signed URL. Cleared after a successful publish.';

comment on column public.banners.draft_image_mobile_path is
  'Optional 4:3 mobile draft rendition. Same rules as draft_image_path.';

-- ---------------------------------------------------------------------------
-- 4. Path constraints
-- ---------------------------------------------------------------------------
-- The pattern is the exact SQL twin of DRAFT_BANNER_PATH_RE in
-- lib/media/refs.ts, which is generated from the same conventions as
-- lib/media/paths.buildMediaPath():
--
--   folder    = MEDIA_KIND_CONFIG['banner-draft'].folder(ownerId)
--             = banners/{ownerId ?? '_draft'}
--   file name = crypto.randomUUID() + '.' + EXTENSION_BY_MIME[mime]
--             = lower-case UUID + jpg|png|webp
--
-- Deliberately:
--   * case-sensitive (`~`, not `~*`) — Storage object paths are case-sensitive,
--     and a mixed-case path would name a different object than the one written;
--   * `[.]` instead of `\.` so the literal needs no backslash escaping;
--   * the second path segment must be THIS row's id (or `_draft`), so a row
--     can never point at another banner's artwork.
do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.banners'::regclass
       and conname = 'banners_draft_image_path_check'
  ) then
    alter table public.banners
      add constraint banners_draft_image_path_check
      check (
        draft_image_path is null
        or (
          draft_image_path ~ '^banners/(_draft|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|png|webp)$'
          and split_part(draft_image_path, '/', 2) in ('_draft', id::text)
        )
      );
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.banners'::regclass
       and conname = 'banners_draft_image_mobile_path_check'
  ) then
    alter table public.banners
      add constraint banners_draft_image_mobile_path_check
      check (
        draft_image_mobile_path is null
        or (
          draft_image_mobile_path ~ '^banners/(_draft|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|png|webp)$'
          and split_part(draft_image_mobile_path, '/', 2) in ('_draft', id::text)
        )
      );
  end if;
end;
$$;
