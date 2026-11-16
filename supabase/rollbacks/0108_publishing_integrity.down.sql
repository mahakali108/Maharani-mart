-- ============================================================================
-- Rollback of 0108: removes the attribution guard and the publish-path guard.
--
-- It does NOT revert 0104's data and it does NOT republish or unpublish
-- anything: dropping a trigger must never change what a customer can read.
--
-- After this runs, a direct UPDATE can again leave a row at
-- `status = 'published'` with a NULL snapshot, or clear a snapshot without
-- changing the status, and an approval can again be attributed to an account
-- that did not record it. Run it only to return to the 0104 behaviour while
-- investigating a problem, never as a fix.
-- ============================================================================

do $$
begin
  if to_regclass('public.site_pages') is null then
    raise exception '0108 rollback: public.site_pages does not exist (0104 already rolled back?).';
  end if;
end
$$;

drop trigger if exists trg_guard_site_pages_publish_path on public.site_pages;
drop function if exists public.guard_site_pages_publish_path();

drop trigger if exists trg_guard_site_page_admin_notes_author on public.site_page_admin_notes;
drop function if exists public.guard_site_page_admin_notes_author();

-- 0108 does not redefine publish_site_page()/unpublish_site_page(): the guard
-- is expressed as a property of the resulting row, so the 0104 functions work
-- unchanged and there is nothing to restore here.

-- ============================================================================
-- END 0108 rollback
-- ============================================================================
