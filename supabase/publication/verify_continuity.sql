-- ============================================================================
-- Public page continuity — READ ONLY.
--
-- Answers the question the deploy must never get wrong:
--   "Is every page that is live today still reachable after this release?"
--
-- Run it after stage 1, after the deploy and after stage 2. It changes nothing:
-- every statement is a SELECT over the published state.
--
-- Why 19 is the number: before this change the public site served 19 policy /
-- information URLs — /about, /contact, and /legal/{terms, privacy, returns,
-- shipping, grievance, business-disclosure, product-safety} rendered from their
-- own page files, plus /legal/{damaged-goods, seller-agreement, retailer-terms,
-- marketplace-disclaimer, gst-pricing-invoice, prohibited-products,
-- ip-complaints, suspension-termination, cookies, coins-loyalty} rendered by
-- app/legal/[slug]/page.tsx from lib/legal/content.ts. Stage 1 publishes the
-- first nine; stage 2 publishes nine more.
--
-- Stage 0 is `/legal/seller-agreement`. It is DELIBERATELY never published: the
-- seller / marketplace programme it governed was discontinued by migration 0110,
-- so a live page describing it would be untrue. The page and its wording are
-- preserved (unpublished) for the owner to archive or repurpose. It is therefore
-- EXCLUDED from the expected set below rather than counted as missing.
--
-- EXPECTED RESULTS
--   after stage 1 : missing = 9 (the stage-2 pages — this IS the deploy gap)
--   after stage 2 : missing = 0 (and seller-agreement still not published)
--   any time      : the four legacy redirect targets must be published, because
--                   /terms, /privacy, /returns and /shipping permanently redirect
--                   to them (app/*/page.tsx → permanentCanonicalLegalRedirect)
-- ============================================================================

with expected(slug, stage) as (
  values
    ('about', 1), ('contact', 1), ('terms', 1), ('privacy', 1), ('returns', 1),
    ('shipping', 1), ('grievance', 1), ('business-disclosure', 1), ('product-safety', 1),
    ('damaged-goods', 2), ('retailer-terms', 2),
    ('marketplace-disclaimer', 2), ('gst-pricing-invoice', 2), ('prohibited-products', 2),
    ('ip-complaints', 2), ('suspension-termination', 2), ('cookies', 2), ('coins-loyalty', 2)
),
state as (
  select e.slug,
         e.stage,
         coalesce(p.status = 'published', false)                       as published,
         (p.published_snapshot is not null)                            as has_snapshot,
         (public.published_page(e.slug) ->> 'state')                   as anonymous_state,
         p.published_at
    from expected e
    left join public.site_pages p on p.slug = e.slug
)
select 'summary' as check,
       count(*) filter (where published)::text                    as published,
       count(*) filter (where not published)::text                as missing,
       count(*) filter (where published and not has_snapshot)::text as published_without_snapshot,
       count(*)::text                                             as expected_total
  from state
union all
select 'MISSING: ' || slug || ' (stage ' || stage || ')',
       '', '', '', ''
  from state
 where not published
 order by 1;

-- The same check, restricted to the four legacy redirect targets. A row here
-- means /terms, /privacy, /returns or /shipping redirects a visitor to a page
-- that says "This page is not available right now."
select e.slug as legacy_redirect_target,
       coalesce(p.status = 'published', false) as published
  from (values ('terms'), ('privacy'), ('returns'), ('shipping')) as e(slug)
  left join public.site_pages p on p.slug = e.slug
 order by 1;

-- What the navigation reads: the footer and the /legal index list only published
-- pages, so this number drops from 19 to 9 for the duration of the stage-1-only
-- window. It is the same number the Android app shows.
select jsonb_array_length(public.published_pages()) as published_index_size;
