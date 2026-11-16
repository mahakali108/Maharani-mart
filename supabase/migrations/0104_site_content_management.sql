-- ============================================================================
-- 0104: Super Admin website content management (About Us, Contact, policies)
--
-- FOR REVIEW ONLY. NOT APPLIED TO ANY REMOTE PROJECT BY THIS CHANGE.
--
-- Why this migration exists
-- -------------------------
-- Every public information page was hardcoded in the Next.js tree:
-- `app/about/page.tsx`, the `app/legal/*/page.tsx` files and
-- `lib/legal/content.ts`. The owner could not correct a phone number, a
-- delivery promise or a grievance timeline without a code change and a deploy,
-- and the same pages rendered an operator warning ("Publication review
-- required") to customers.
--
-- What this migration adds
-- ------------------------
--   1. `site_pages`            - the working draft of each public page.
--   2. `site_page_sections`    - ordered content blocks of that draft.
--   3. `site_page_admin_notes` - internal review notes and the open owner
--                                decisions. NEVER readable by a customer
--                                (super_admin-only RLS + no anon grant).
--   4. `site_page_revisions`   - append-only publishing history, written by a
--                                trigger, with a full snapshot of what was
--                                live at that moment.
--   5. `site_pages.published_snapshot` - the text customers actually see.
--                                Editing a draft can never change a live page:
--                                publishing copies the draft into this column.
--   6. `public.published_page(slug)` / `public.published_pages()` - read-only
--                                SECURITY DEFINER functions so an anonymous
--                                visitor can read published content (and be
--                                told "not published yet" for a page that
--                                exists) without any draft or internal field
--                                being reachable.
--
-- Security posture
-- ----------------
--   * RLS on every table. NO API role reads these tables on behalf of a
--     customer: `anon` has no privilege at all, and `authenticated` is limited
--     to a super admin (the editor). A signed-in retailer or admin gets zero
--     rows.
--   * Draft columns have no anon grant at all: a published page cannot leak the
--     draft title/intro/sections through the Data API (see §6).
--   * Writes are super_admin-only (`public.is_super_admin()`), enforced in the
--     database, not only in the UI.
--   * Internal notes live in a separate table with no anonymous or
--     non-super-admin grant at all, so a column-level leak is impossible.
--   * `site_page_revisions` is insert-only from a trigger; there is no
--     INSERT/UPDATE/DELETE policy for any API role.
--   * The publishing functions expose snapshot content only. They never return
--     `site_page_admin_notes` or a draft row.
--
-- Depends on: 0001_init (profiles), 0052 (current_user_role), 0098
-- (publish_legal_document_version is called by publish_site_page ONLY when the
-- operator explicitly registers a version — see the note above that function).
-- Rollback: supabase/rollbacks/0104_site_content_management.down.sql
-- ============================================================================

do $$
begin
  if to_regclass('public.profiles') is null
     or to_regprocedure('public.current_user_role()') is null then
    raise exception '0104 requires migrations 0001 and 0052 (profiles, current_user_role).';
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- 1. Super Admin helper. `is_admin_or_above()` deliberately includes `admin`;
--    website content is restricted to `super_admin` only.
-- ----------------------------------------------------------------------------
create or replace function public.is_super_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.current_user_role() = 'super_admin', false)
$$;
revoke all on function public.is_super_admin() from public, anon;
grant execute on function public.is_super_admin() to authenticated;

-- ----------------------------------------------------------------------------
-- 2. Pages: the working draft plus the last published snapshot.
-- ----------------------------------------------------------------------------
create table if not exists public.site_pages (
  id uuid primary key default gen_random_uuid(),
  -- Stable public address (/legal/<slug> or /<slug>) and the legal-document key
  -- used by acceptance records (0095). Never rename a system page.
  slug text not null,
  kind text not null default 'page',
  audience text not null default 'everyone',
  nav_label text not null,
  short_label text,
  eyebrow text,
  title text not null,
  intro text,
  meta_description text,
  hero_image_url text,
  status text not null default 'draft',
  version text not null default '1.0',
  effective_date date,
  published_at timestamptz,
  published_by uuid references auth.users(id) on delete set null,
  -- The exact content customers see. Written only by publish_site_page().
  published_snapshot jsonb,
  sort_order integer not null default 0,
  show_in_footer boolean not null default true,
  show_in_index boolean not null default true,
  show_contact_details boolean not null default false,
  related_slugs text[] not null default '{}'::text[],
  -- A required page (About, Contact, Terms, ...) cannot be deleted and its slug
  -- cannot be changed, because routes, acceptance records and the footer point
  -- at it. Its CONTENT is fully editable.
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint site_pages_slug_key unique (slug),
  constraint site_pages_slug_format check (slug ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'),
  constraint site_pages_slug_len check (char_length(slug) between 2 and 64),
  constraint site_pages_kind_check check (kind in ('page', 'legal')),
  constraint site_pages_audience_check check (audience in ('everyone', 'buyers', 'sellers')),
  constraint site_pages_status_check check (status in ('draft', 'published')),
  constraint site_pages_version_format check (version ~ '^[0-9]+\.[0-9]+$'),
  constraint site_pages_nav_label_len check (char_length(btrim(nav_label)) between 1 and 60),
  constraint site_pages_title_len check (char_length(btrim(title)) between 1 and 160),
  constraint site_pages_intro_len check (intro is null or char_length(intro) <= 1200),
  constraint site_pages_meta_len check (meta_description is null or char_length(meta_description) <= 320),
  constraint site_pages_related_len check (coalesce(array_length(related_slugs, 1), 0) <= 12),
  -- A page can be marked published only when a customer could actually read a
  -- complete page. published_snapshot is written by the trigger/function below.
  constraint site_pages_publish_complete check (
    status <> 'published'
    or (
      published_at is not null
      and published_snapshot is not null
      and effective_date is not null
      and btrim(title) <> ''
      and btrim(nav_label) <> ''
      and intro is not null
      and btrim(intro) <> ''
    )
  )
);

comment on table public.site_pages is
  'Super Admin managed public pages. The draft columns are edited in /admin/content; customers only ever read published_snapshot through public.published_page().';
comment on column public.site_pages.published_snapshot is
  'Immutable copy of the published page (fields + sections). Editing the draft never changes it.';
comment on column public.site_pages.is_system is
  'Required page: route, footer link and legal-acceptance key depend on it. Delete is blocked; content is editable.';

create index if not exists idx_site_pages_status_sort on public.site_pages (status, sort_order, slug);
create index if not exists idx_site_pages_footer on public.site_pages (show_in_footer) where status = 'published';

-- ----------------------------------------------------------------------------
-- 3. Sections: ordered content blocks.
-- ----------------------------------------------------------------------------
create table if not exists public.site_page_sections (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.site_pages(id) on delete cascade,
  heading text not null,
  body text[] not null default '{}'::text[],
  bullets text[] not null default '{}'::text[],
  tone text not null default 'standard',
  image_url text,
  link_label text,
  link_href text,
  sort_order integer not null default 0,
  is_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_page_sections_heading_len check (char_length(btrim(heading)) between 1 and 200),
  constraint site_page_sections_body_len check (coalesce(array_length(body, 1), 0) <= 40),
  constraint site_page_sections_bullets_len check (coalesce(array_length(bullets, 1), 0) <= 40),
  constraint site_page_sections_tone_check check (tone in ('standard', 'highlight')),
  constraint site_page_sections_link_pair check (
    (link_label is null and link_href is null)
    or (link_label is not null and link_href is not null)
  ),
  constraint site_page_sections_link_len check (
    link_label is null or char_length(btrim(link_label)) between 1 and 80
  )
);

comment on table public.site_page_sections is
  'Ordered content blocks of a website page draft. Publishing copies the visible ones into site_pages.published_snapshot.';

create index if not exists idx_site_page_sections_page on public.site_page_sections (page_id, sort_order, id);

-- ----------------------------------------------------------------------------
-- 4. Internal notes: super_admin only. No anon/authenticated grant at all, so
--    even a published page cannot leak its review notes through the Data API.
-- ----------------------------------------------------------------------------
create table if not exists public.site_page_admin_notes (
  page_id uuid primary key references public.site_pages(id) on delete cascade,
  internal_notes text,
  owner_decisions text[] not null default '{}'::text[],
  review_status text not null default 'owner_review_pending',
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint site_page_admin_notes_review_check check (
    review_status in ('owner_review_pending', 'owner_approved', 'legal_reviewed', 'not_required')
  ),
  constraint site_page_admin_notes_decisions_len check (coalesce(array_length(owner_decisions, 1), 0) <= 40),
  constraint site_page_admin_notes_notes_len check (internal_notes is null or char_length(internal_notes) <= 8000),
  -- An approval must say who recorded it and when. A bare flag cannot be stored.
  constraint site_page_admin_notes_reviewed_pair check (
    (review_status in ('owner_review_pending', 'not_required'))
    or (reviewed_by is not null and reviewed_at is not null)
  )
);

comment on table public.site_page_admin_notes is
  'INTERNAL. Review status, open owner decisions and operator notes for a page. Never exposed on a public page and never returned by published_page().';

-- ----------------------------------------------------------------------------
-- 5. Publishing history: append-only.
-- ----------------------------------------------------------------------------
create table if not exists public.site_page_revisions (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.site_pages(id) on delete cascade,
  version text not null,
  event text not null,
  snapshot jsonb not null,
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint site_page_revisions_event_check check (event in ('published', 'unpublished', 'version_changed')),
  constraint site_page_revisions_version_format check (version ~ '^[0-9]+\.[0-9]+$')
);

comment on table public.site_page_revisions is
  'Append-only publishing history. Written only by site_pages_record_revision(); no API role may insert, update or delete.';

create index if not exists idx_site_page_revisions_page on public.site_page_revisions (page_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 6. Grants.
--
-- Draft columns deliberately have NO anon grant. A row-level policy can only
-- answer "may this row be read", not "which columns", so granting anon SELECT on
-- site_pages would expose the DRAFT title/intro of a page that is currently
-- published (and, via the sections table, section text that has not been
-- published and blocks marked invisible). The public reads the published
-- snapshot through published_page()/published_pages(), which are SECURITY
-- DEFINER and return the snapshot only; authenticated users get these tables
-- only through a super-admin policy (the editor). Guests therefore have no
-- column of the draft at all, and a bug cannot turn "published" into "draft is
-- readable". Regression: tests/site-content-db.test.ts (“no API role can read a
-- draft column of a published page”).
-- ----------------------------------------------------------------------------
revoke all on table public.site_pages from public, anon, authenticated;
grant select, insert, update, delete on table public.site_pages to authenticated;
grant all on table public.site_pages to service_role;

revoke all on table public.site_page_sections from public, anon, authenticated;
grant select, insert, update, delete on table public.site_page_sections to authenticated;
grant all on table public.site_page_sections to service_role;

revoke all on table public.site_page_admin_notes from public, anon, authenticated;
grant select, insert, update, delete on table public.site_page_admin_notes to authenticated;
grant all on table public.site_page_admin_notes to service_role;

revoke all on table public.site_page_revisions from public, anon, authenticated;
grant select on table public.site_page_revisions to authenticated;
grant all on table public.site_page_revisions to service_role;

-- ----------------------------------------------------------------------------
-- 7. Row level security.
-- ----------------------------------------------------------------------------
alter table public.site_pages enable row level security;
alter table public.site_page_sections enable row level security;
alter table public.site_page_admin_notes enable row level security;
alter table public.site_page_revisions enable row level security;

-- No anon SELECT policy exists, by design (see §6). If an older revision of this
-- file created one, it is dropped here so re-applying the migration closes the
-- hole instead of leaving it behind.
drop policy if exists "site_pages_public_read" on public.site_pages;

-- The editor is the only authenticated reader of the draft table.
drop policy if exists "site_pages_authenticated_read" on public.site_pages;
create policy "site_pages_super_admin_read" on public.site_pages
  for select to authenticated
  using (public.is_super_admin());

drop policy if exists "site_pages_super_admin_insert" on public.site_pages;
create policy "site_pages_super_admin_insert" on public.site_pages
  for insert to authenticated with check (public.is_super_admin());

drop policy if exists "site_pages_super_admin_update" on public.site_pages;
create policy "site_pages_super_admin_update" on public.site_pages
  for update to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists "site_pages_super_admin_delete" on public.site_pages;
create policy "site_pages_super_admin_delete" on public.site_pages
  for delete to authenticated using (public.is_super_admin());

drop policy if exists "site_page_sections_public_read" on public.site_page_sections;

drop policy if exists "site_page_sections_authenticated_read" on public.site_page_sections;
create policy "site_page_sections_super_admin_read" on public.site_page_sections
  for select to authenticated
  using (public.is_super_admin());

drop policy if exists "site_page_sections_super_admin_write" on public.site_page_sections;
create policy "site_page_sections_super_admin_write" on public.site_page_sections
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists "site_page_admin_notes_super_admin_all" on public.site_page_admin_notes;
create policy "site_page_admin_notes_super_admin_all" on public.site_page_admin_notes
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists "site_page_revisions_super_admin_read" on public.site_page_revisions;
create policy "site_page_revisions_super_admin_read" on public.site_page_revisions
  for select to authenticated using (public.is_super_admin());
-- Deliberately NO insert/update/delete policy: the history is written by the
-- SECURITY DEFINER trigger below and is immutable to every API role.

-- ----------------------------------------------------------------------------
-- 8. Triggers: timestamps, publish defaults, system-page protection, history.
-- ----------------------------------------------------------------------------
create or replace function public.site_pages_before_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);

  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := coalesce(new.created_at, now());
    if new.status = 'published' and new.published_at is null then
      new.published_at := now();
    end if;
    if new.status = 'published' then
      new.published_by := coalesce(new.published_by, auth.uid());
    end if;
    return new;
  end if;

  -- A system page keeps its address and its required status.
  if old.is_system then
    if new.slug is distinct from old.slug then
      raise exception 'The address of a required page cannot be changed (%).', old.slug
        using errcode = '23514';
    end if;
    if new.is_system is distinct from old.is_system then
      raise exception 'A required page cannot be unmarked as required.'
        using errcode = '23514';
    end if;
  end if;

  if new.status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;
  if new.status = 'published' and new.published_by is null then
    new.published_by := coalesce(auth.uid(), old.published_by);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_site_pages_before_write on public.site_pages;
create trigger trg_site_pages_before_write
  before insert or update on public.site_pages
  for each row execute function public.site_pages_before_write();

create or replace function public.site_pages_block_system_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- A required page cannot be deleted from the admin UI or the API. The only
  -- exception is an explicit, session-scoped opt-in by whoever is running a
  -- rollback by hand (supabase/rollbacks/0105_seed_site_content.down.sql sets this
  -- GUC and the same one guards the 0104 rollback). Without it a rollback of the
  -- seed cannot run at all, because every seeded page is a system page.
  if old.is_system
     and coalesce(current_setting('maharani.allow_data_loss', true), 'false') <> 'true' then
    raise exception 'This page is required by the website and cannot be deleted. Unpublish or edit it instead.'
      using errcode = '23514';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_site_pages_block_system_delete on public.site_pages;
create trigger trg_site_pages_block_system_delete
  before delete on public.site_pages
  for each row execute function public.site_pages_block_system_delete();

create or replace function public.site_page_sections_touch()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_site_page_sections_touch on public.site_page_sections;
create trigger trg_site_page_sections_touch
  before insert or update on public.site_page_sections
  for each row execute function public.site_page_sections_touch();

-- ----------------------------------------------------------------------------
-- 9. Publishing history recorder. Runs only when a customer-visible event
--    happens; ordinary draft saves are not recorded, so the history stays a
--    publishing log rather than a keystroke log.
-- ----------------------------------------------------------------------------
create or replace function public.site_pages_record_revision()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event text;
  v_sections jsonb;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'published' then
      return new;
    end if;
    v_event := 'published';
  else
    if old.status is distinct from new.status then
      v_event := case when new.status = 'published' then 'published' else 'unpublished' end;
    elsif new.status = 'published'
          and (
            old.version is distinct from new.version
            or old.effective_date is distinct from new.effective_date
            or old.published_snapshot is distinct from new.published_snapshot
          ) then
      v_event := 'version_changed';
    else
      return new;
    end if;
  end if;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'heading', s.heading,
               'body', s.body,
               'bullets', s.bullets,
               'tone', s.tone,
               'image_url', s.image_url,
               'link_label', s.link_label,
               'link_href', s.link_href,
               'sort_order', s.sort_order
             ) order by s.sort_order, s.id
           ),
           '[]'::jsonb
         )
    into v_sections
    from public.site_page_sections s
   where s.page_id = new.id;

  insert into public.site_page_revisions (page_id, version, event, snapshot, actor_id)
  values (
    new.id,
    new.version,
    v_event,
    jsonb_build_object(
      'page', to_jsonb(new) - 'published_snapshot',
      'sections', v_sections,
      'published_snapshot', new.published_snapshot
    ),
    auth.uid()
  );
  return new;
end;
$$;

drop trigger if exists trg_site_pages_record_revision on public.site_pages;
create trigger trg_site_pages_record_revision
  after insert or update on public.site_pages
  for each row execute function public.site_pages_record_revision();

-- ----------------------------------------------------------------------------
-- 10. Public read functions.
--
--     A SECURITY DEFINER function is used rather than a direct table read so
--     that (a) one request returns the whole page, and (b) an unpublished page
--     can answer "not published yet" without exposing the draft row or telling
--     the caller anything about internal review state.
-- ----------------------------------------------------------------------------
create or replace function public.published_page(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_page public.site_pages;
begin
  if p_slug is null or btrim(p_slug) = '' then
    return jsonb_build_object('state', 'missing');
  end if;

  select * into v_page from public.site_pages p where p.slug = p_slug;
  if not found then
    return jsonb_build_object('state', 'missing');
  end if;

  if v_page.status <> 'published'
     or v_page.published_snapshot is null
     or v_page.published_at is null
     or v_page.published_at > now() then
    return jsonb_build_object(
      'state', 'unpublished',
      'slug', v_page.slug,
      'nav_label', v_page.nav_label,
      'message', 'This page is not available right now.'
    );
  end if;

  return jsonb_build_object(
    'state', 'published',
    'slug', v_page.slug,
    'kind', v_page.kind,
    'audience', v_page.audience,
    'nav_label', v_page.nav_label,
    'short_label', v_page.short_label,
    'show_contact_details', v_page.show_contact_details,
    'related_slugs', v_page.related_slugs,
    'version', v_page.version,
    'effective_date', v_page.effective_date,
    'published_at', v_page.published_at,
    'page', v_page.published_snapshot
  );
end;
$$;
revoke all on function public.published_page(text) from public;
grant execute on function public.published_page(text) to anon, authenticated, service_role;

create or replace function public.published_pages()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'slug', p.slug,
               'kind', p.kind,
               'audience', p.audience,
               'nav_label', p.nav_label,
               'short_label', p.short_label,
               'title', p.published_snapshot ->> 'title',
               'summary', p.published_snapshot ->> 'intro',
               'version', p.version,
               'effective_date', p.effective_date,
               'sort_order', p.sort_order,
               'show_in_footer', p.show_in_footer,
               'show_in_index', p.show_in_index
             ) order by p.sort_order, p.slug
           ),
           '[]'::jsonb
         )
    from public.site_pages p
   where p.status = 'published'
     and p.published_snapshot is not null
     and p.published_at is not null
     and p.published_at <= now()
$$;
revoke all on function public.published_pages() from public;
grant execute on function public.published_pages() to anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 11. Publish / unpublish. One function each so the snapshot, the status flag,
--     the timestamp, the database-side document version (0098) and the history
--     row can never disagree.
-- ----------------------------------------------------------------------------
-- Builds the customer-visible copy of a page from its current draft. Not
-- granted to any API role: publish_site_page() and the seed migration call it
-- internally under the definer's ownership.
create or replace function public.site_page_snapshot(p_page_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'title', p.title,
    'nav_label', p.nav_label,
    'short_label', p.short_label,
    'eyebrow', p.eyebrow,
    'intro', p.intro,
    'meta_description', p.meta_description,
    'hero_image_url', p.hero_image_url,
    'version', p.version,
    'effective_date', p.effective_date,
    'sections', coalesce(
      (
        select jsonb_agg(
                 jsonb_build_object(
                   'heading', s.heading,
                   'body', s.body,
                   'bullets', s.bullets,
                   'tone', s.tone,
                   'image_url', s.image_url,
                   'link_label', s.link_label,
                   'link_href', s.link_href,
                   'sort_order', s.sort_order
                 ) order by s.sort_order, s.id
               )
          from public.site_page_sections s
         where s.page_id = p.id and s.is_visible
      ),
      '[]'::jsonb
    )
  )
  from public.site_pages p
  where p.id = p_page_id
$$;
revoke all on function public.site_page_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.site_page_snapshot(uuid) to service_role;

--
-- `p_register_acceptance` is FALSE by default, and that default is the point:
-- publishing a page makes it READABLE; it does not make it something a customer
-- must ACCEPT. The acceptance registry (0098) is a short list of documents whose
-- version the database enforces (today: `seller-agreement`, plus the terms and
-- privacy entries in `lib/legal/documents.ts` when a row exists). Registering
-- every informational policy there would pin a version for it and, from that
-- moment, reject an acceptance of any other version (record_legal_acceptance
-- raises LEGAL_VERSION_NOT_CURRENT) — a consent change that a copy edit must not
-- make by accident. A Super Admin registers a version only by ticking the box
-- that passes TRUE for the one document that needs it.
create or replace function public.publish_site_page(
  p_page_id uuid,
  p_register_acceptance boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_page public.site_pages;
  v_snapshot jsonb;
begin
  if v_actor is null or not public.is_super_admin() then
    raise exception 'Only a Super Admin can publish a website page.' using errcode = '42501';
  end if;

  select * into v_page from public.site_pages p where p.id = p_page_id for update;
  if not found then
    raise exception 'Page not found.' using errcode = 'P0002';
  end if;
  if v_page.effective_date is null then
    raise exception 'Set an effective date before publishing.' using errcode = '23514';
  end if;
  if v_page.intro is null or btrim(v_page.intro) = '' then
    raise exception 'Write an introduction before publishing.' using errcode = '23514';
  end if;

  v_snapshot := public.site_page_snapshot(p_page_id);
  if jsonb_array_length(v_snapshot -> 'sections') = 0 then
    raise exception 'Add at least one visible section before publishing.' using errcode = '23514';
  end if;

  update public.site_pages
     set status = 'published',
         published_at = now(),
         published_by = v_actor,
         published_snapshot = v_snapshot
   where id = p_page_id;

  -- Acceptance registration is OPT-IN (see the note above the function).
  if coalesce(p_register_acceptance, false)
     and v_page.kind = 'legal'
     and to_regprocedure('public.publish_legal_document_version(text, text)') is not null then
    perform public.publish_legal_document_version(v_page.slug, v_page.version);
  end if;
end;
$$;
revoke all on function public.publish_site_page(uuid, boolean) from public, anon;
grant execute on function public.publish_site_page(uuid, boolean) to authenticated, service_role;

create or replace function public.unpublish_site_page(p_page_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or not public.is_super_admin() then
    raise exception 'Only a Super Admin can unpublish a website page.' using errcode = '42501';
  end if;
  update public.site_pages
     set status = 'draft',
         published_snapshot = null
   where id = p_page_id and status = 'published';
  if not found then
    raise exception 'That page is not published.' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.unpublish_site_page(uuid) from public, anon;
grant execute on function public.unpublish_site_page(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 12. Keep `updated_at` honest on the internal-notes table (written by the
--     application, so a trigger is enough).
-- ----------------------------------------------------------------------------
create or replace function public.site_page_admin_notes_touch()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_site_page_admin_notes_touch on public.site_page_admin_notes;
create trigger trg_site_page_admin_notes_touch
  before insert or update on public.site_page_admin_notes
  for each row execute function public.site_page_admin_notes_touch();

-- ============================================================================
-- END 0104
-- ============================================================================
