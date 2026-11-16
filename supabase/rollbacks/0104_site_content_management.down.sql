-- ============================================================================
-- Rollback of 0104: removes the website content management objects.
--
-- DESTRUCTIVE: this drops every page, its sections, its internal notes and its
-- publishing history. It is provided for a review environment only. If any page
-- row exists, the rollback refuses unless `set local maharani.allow_data_loss =
-- 'true'` is set in the same transaction (the same guard used by 0095/0098).
-- ============================================================================

do $$
begin
  if to_regclass('public.site_pages') is not null
     and coalesce(current_setting('maharani.allow_data_loss', true), 'false') <> 'true'
     and exists (select 1 from public.site_pages) then
    raise exception 'Rollback refused: site_pages holds %. Back up the content and set maharani.allow_data_loss = ''true'' to drop it.',
      (select count(*) from public.site_pages);
  end if;
end
$$;

-- Order matters, and it is the reverse of the migration:
--   1. functions whose body declares a %ROWTYPE of a table below (they depend on
--      the tables, so they must go first);
--   2. the tables — this takes their triggers with them;
--   3. the trigger functions (a trigger function cannot be dropped while a trigger
--      that uses it still exists);
--   4. the super-admin helper.
-- Dropping these in the naive order fails on 2 and 3, which is why this file is now
-- executed by a test rather than only read.

-- 1. Functions that depend on the tables.
drop function if exists public.publish_site_page(uuid, boolean);
drop function if exists public.publish_site_page(uuid);
drop function if exists public.unpublish_site_page(uuid);
drop function if exists public.site_page_snapshot(uuid);
drop function if exists public.published_pages();
drop function if exists public.published_page(text);

-- 2. Tables (their triggers and policies go with them).
drop table if exists public.site_page_revisions;
drop table if exists public.site_page_admin_notes;
drop table if exists public.site_page_sections;
drop table if exists public.site_pages;

-- 3. Trigger functions, now unreferenced.
drop function if exists public.site_page_admin_notes_touch();
drop function if exists public.site_pages_record_revision();
drop function if exists public.site_page_sections_touch();
drop function if exists public.site_pages_block_system_delete();
drop function if exists public.site_pages_before_write();

-- 4. The helper 0104 created.
drop function if exists public.is_super_admin();
