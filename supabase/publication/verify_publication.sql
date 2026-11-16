-- ============================================================================
-- Read-only verification for the managed website pages.
--
-- Safe to run at any time, before or after a stage. It changes nothing: every
-- statement is a SELECT. Run it after 0105, after stage 1, after the deploy and
-- after stage 2, and compare with the expectations in
-- supabase/publication/README.md.
-- ============================================================================

-- 1. Census: how many pages are drafts, how many are public, and does every
--    published row actually carry a snapshot (a published row without one would
--    answer "not available" to a customer while looking live in the admin list).
select count(*) filter (where status = 'draft')      as drafts,
       count(*) filter (where status = 'published')  as published,
       count(*) filter (where status = 'published'
                          and published_snapshot is null) as published_without_snapshot,
       count(*) filter (where published_at > now())  as published_in_the_future,
       count(*)                                      as total
  from public.site_pages;

-- 2. Every page, its state, and what an anonymous caller gets for it. `state`
--    must be 'published' for a published page and 'unpublished' for a draft —
--    never 'published' for a draft, and never a row with draft text in it.
select p.slug,
       p.kind,
       p.status,
       p.published_at,
       (public.published_page(p.slug) ->> 'state')        as anonymous_state,
       (public.published_page(p.slug) ->> 'version')      as anonymous_version,
       (public.published_page(p.slug) ->> 'effective_date') as anonymous_effective_date
  from public.site_pages p
 order by p.status, p.sort_order, p.slug;

-- 3. The footer/index list the website and the mobile app read: it must contain
--    published pages only.
select (public.published_pages()) as published_index;

-- 4. No draft text can leak from the public function. This searches the whole
--    published document for an internal marker that only exists in notes.
select count(*) as published_documents_containing_internal_markers
  from public.site_pages p
 where p.status = 'published'
   and (public.published_page(p.slug)::text ilike '%internal_notes%'
        or public.published_page(p.slug)::text ilike '%owner_decisions%'
        or public.published_page(p.slug)::text ilike '%review_status%');

-- 5. Acceptance registry: which documents the database currently enforces a
--    version for. Publishing a page does not add a row here; only an explicit
--    publish_legal_document_version() call does.
select document_key, document_version, published_at
  from public.legal_document_current_versions
 order by document_key;
