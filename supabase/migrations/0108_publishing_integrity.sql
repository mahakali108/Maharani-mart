-- ============================================================================
-- 0108: Attribute integrity for website-content approvals, and a guard that
--       stops the draft from being published by a plain UPDATE.
--
-- NOT APPLIED TO ANY REMOTE PROJECT BY THIS CHANGE.
--
-- Two defects found while auditing 0104/0105 (Phase 2). Neither is exploitable
-- by a retailer or a seller — both require an authenticated Super Admin — but
-- both falsify evidence, which is exactly what the content module exists to
-- protect.
--
-- ---------------------------------------------------------------------------
-- DEFECT 1 — `reviewed_by` is caller-supplied, so a review is attributable to
--            somebody who did not give it.
--
-- `site_page_admin_notes` has an INSERT/UPDATE policy for super admins and a
-- constraint that requires `reviewed_by` + `reviewed_at` whenever
-- `review_status` is `owner_approved` or `legal_reviewed`. NOTHING ties
-- `reviewed_by` to `auth.uid()`. Reproduced against a migrated database:
--
--     -- signed in as Super Admin A
--     update public.site_page_admin_notes
--        set review_status = 'owner_approved',
--            reviewed_by  = '<Super Admin B>',   -- never signed in
--            reviewed_at  = now()
--      where page_id = '<terms>';
--     -- succeeds; the record now says B approved the legal wording
--
-- That is a false record of a legal/owner approval. The application always
-- writes auth.uid() today, but an application guarantee is not an
-- authorization control: the same table is reachable over PostgREST by any
-- super-admin session.
--
-- FIX: a BEFORE INSERT/UPDATE trigger pins `reviewed_by` to `auth.uid()` for
-- API callers (non-API callers — owner-run SQL, service scripts — keep the
-- ability to record a historical attribution deliberately). `reviewed_at` is
-- stamped by the database so it cannot be back-dated.
--
-- ---------------------------------------------------------------------------
-- DEFECT 2 — `status = 'published'` could be set by a plain table UPDATE,
--            producing a published row with no snapshot and no history.
--
-- `publish_site_page()` writes the snapshot, stamps `published_by`, appends a
-- `site_page_revisions` row and optionally registers the acceptance version —
-- atomically. But `site_pages_super_admin_update` (0104) is a plain FOR UPDATE
-- policy for super admins, so this also worked:
--
--     -- signed in as any Super Admin, straight over PostgREST
--     update public.site_pages set status = 'published' where slug = 'terms';
--     -- published_at / published_by stamped by the before-trigger,
--     -- published_snapshot still NULL  → published_pages() omits the page and
--     -- the revision history has NO record of the publication.
--
-- The row was then in a state no function can reach: published with no
-- snapshot. It reads "Published" in /admin/content while customers are shown
-- "not available", and the history holds no evidence of what (if anything) went
-- live.
--
-- FIX (below, §2): the transition is bound to the invariant instead of to a
-- caller list. A row cannot BECOME published unless it carries a non-null
-- snapshot equal to `site_page_snapshot()` for that same page, and cannot LEAVE
-- published unless the snapshot is cleared. The RPCs and the documented
-- owner-run publication scripts in supabase/publication/ already satisfy this,
-- so the guard is invisible to them and closes the bypass.
--
-- Depends on: 0104 (site_pages, site_page_admin_notes, publish functions).
-- Rollback:   supabase/rollbacks/0108_publishing_integrity.down.sql
-- ============================================================================

do $$
begin
  if to_regclass('public.site_pages') is null
     or to_regclass('public.site_page_admin_notes') is null then
    raise exception '0108 requires migration 0104 (site_pages, site_page_admin_notes).';
  end if;
  if to_regprocedure('public.publish_site_page(uuid, boolean)') is null
     or to_regprocedure('public.unpublish_site_page(uuid)') is null then
    raise exception '0108 requires the publishing functions created by 0104.';
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- 1. A review is attributable only to the account that recorded it.
-- ----------------------------------------------------------------------------
create or replace function public.guard_site_page_admin_notes_author()
returns trigger
language plpgsql
-- Deliberately NOT security definer. Inside a SECURITY DEFINER function
-- `current_user` is the function's owner (postgres), so the API-role test below
-- would never match and the guard would silently do nothing — the same trap
-- 0106 documents for bootstrap_super_admin(). A trigger function is not subject
-- to an EXECUTE check, so running as the caller costs nothing here. auth.uid()
-- is already granted to anon/authenticated (0001).
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
begin
  -- Owner-run SQL (migrations, backfills, a support script connected as
  -- postgres) may record a historical attribution on purpose. API callers
  -- (PostgREST -> anon/authenticated) may not name anybody but themselves.
  if current_user in ('authenticated', 'anon') then
    if coalesce(new.reviewed_by, v_actor) is distinct from v_actor then
      raise exception 'A review is recorded against the signed-in Super Admin, not another account.'
        using errcode = '42501';
    end if;
    if new.reviewed_by is not null then
      new.reviewed_by := v_actor;
    end if;
    -- Any change that (re)states an approval stamps the moment it happened.
    -- new.updated_at is handled by site_page_admin_notes_touch() (0104).
    if new.review_status in ('owner_approved', 'legal_reviewed') then
      if tg_op = 'UPDATE'
         and old.review_status = new.review_status
         and old.reviewed_at is not null then
        -- Re-saving notes on an already-approved page keeps the original
        -- approval time instead of silently re-dating the evidence.
        new.reviewed_at := old.reviewed_at;
      else
        new.reviewed_at := now();
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_site_page_admin_notes_author()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_guard_site_page_admin_notes_author on public.site_page_admin_notes;
create trigger trg_guard_site_page_admin_notes_author
  before insert or update on public.site_page_admin_notes
  for each row execute function public.guard_site_page_admin_notes_author();

-- ----------------------------------------------------------------------------
-- 2. A publication must carry the snapshot customers read, and an unpublish
--    must clear it. No publication may happen silently.
--
-- The defect was not "a Super Admin bypassed the function" — it was that the
-- transition had no invariant attached to it, so a row could be left at
-- `status = 'published'` with `published_snapshot IS NULL`. In that state
-- published_pages() omits the page, published_page() finds nothing, and the
-- revision history holds no record of the publication, while the admin list
-- says "Published".
--
-- The rule below is stated as a property of the resulting row rather than as a
-- list of allowed callers, so it holds for the function, for the documented
-- owner-run publication scripts in supabase/publication/, and for any future
-- path somebody adds:
--
--   * a row may not BECOME published unless it carries a non-null snapshot
--     produced by site_page_snapshot() for that same page;
--   * a row may not LEAVE published unless that snapshot is cleared.
--
-- Both the RPCs and the owner-run scripts already satisfy this, so the guard is
-- invisible to them; the plain `set status = 'published'` bypass does not.
-- ----------------------------------------------------------------------------
create or replace function public.guard_site_pages_publish_path()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_expected jsonb;
begin
  -- A page is created as a draft. Nothing can publish a row that does not exist
  -- yet, because site_page_snapshot() would have nothing to read.
  if tg_op = 'INSERT' then
    if new.status = 'published' then
      raise exception 'A page is created as a draft and published with public.publish_site_page().'
        using errcode = '23514';
    end if;
    if new.published_snapshot is not null and new.status <> 'published' then
      raise exception 'A draft cannot carry a published snapshot.' using errcode = '23514';
    end if;
    return new;
  end if;

  -- No state change: an ordinary draft save. The 0104 before-trigger still owns
  -- timestamps and the revision recorder still fires for version changes.
  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.status = 'published' then
    if new.published_snapshot is null then
      raise exception 'Publish through public.publish_site_page(): a published page must carry its published snapshot.'
        using errcode = '23514';
    end if;
    -- The snapshot must be the one this draft produces, so a caller cannot pair
    -- "published" with stale or hand-written text that no draft matches.
    v_expected := public.site_page_snapshot(new.id);
    if v_expected is not null and new.published_snapshot is distinct from v_expected then
      raise exception 'The published snapshot does not match this draft. Publish through public.publish_site_page().'
        using errcode = '23514';
    end if;
    if new.published_at is null then
      raise exception 'A published page needs a publication timestamp.' using errcode = '23514';
    end if;
  elsif new.status = 'draft' then
    if new.published_snapshot is not null then
      raise exception 'Unpublish through public.unpublish_site_page(): the published snapshot must be cleared.'
        using errcode = '23514';
    end if;
  else
    raise exception 'Unknown page status %.', new.status using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_site_pages_publish_path()
  from public, anon, authenticated, service_role;

-- Fires BEFORE the existing site_pages_before_write() so a refused transition
-- never reaches the timestamp/revision triggers.
drop trigger if exists trg_guard_site_pages_publish_path on public.site_pages;
create trigger trg_guard_site_pages_publish_path
  before insert or update on public.site_pages
  for each row execute function public.guard_site_pages_publish_path();

-- ============================================================================
-- END 0108
-- ============================================================================
