-- ============================================================================
-- Stage 1 — publish the pages whose wording is ALREADY live today.
--
-- NOT a migration. Run deliberately, by a human, after 0104 and 0105 are applied
-- and BEFORE the application deploy that reads these pages from the database.
-- See supabase/publication/README.md.
--
-- Why this stage exists: until this deploy, /about, /contact and every policy are
-- static JSX. The new routes read the database. If nothing is published at the
-- moment of the deploy, those pages answer "This page is not available right
-- now." to every visitor. This stage publishes exactly the pages that already
-- exist publicly, with the wording already public, so a customer sees no change.
--
-- Approved text: unchanged from app/about/page.tsx, app/contact/page.tsx and
-- app/legal/{terms,privacy,returns,shipping,grievance,business-disclosure,product-safety}.
-- Nothing new becomes public in this stage.
--
-- Timestamps: published_at = now() — the real time of this action. There is no
-- backdated date anywhere in this file.
--
-- Does NOT touch legal_document_current_versions (the acceptance registry).
-- ============================================================================

do $$
declare
  v_slugs text[] := array[
    'about',                -- About us
    'contact',              -- Contact us
    'terms',                -- Terms and Conditions
    'privacy',              -- Privacy Policy
    'returns',              -- Cancellation, returns and refunds
    'shipping',             -- Shipping and delivery
    'grievance',            -- Grievance redressal
    'business-disclosure',  -- Business and legal disclosure
    'product-safety'        -- Product safety and usage
  ];
  v_slug text;
  v_id uuid;
  v_snapshot jsonb;
  v_published integer := 0;
  v_missing text[] := array[]::text[];
begin
  if to_regclass('public.site_pages') is null then
    raise exception 'Apply 0104 and 0105 first: public.site_pages does not exist.';
  end if;

  foreach v_slug in array v_slugs loop
    select id into v_id from public.site_pages where slug = v_slug;
    if v_id is null then
      v_missing := array_append(v_missing, v_slug);
      continue;
    end if;

    -- Already published (a second run, or published from /admin/content): leave
    -- it alone, including its timestamp and snapshot.
    if exists (select 1 from public.site_pages where id = v_id and status = 'published') then
      continue;
    end if;

    v_snapshot := public.site_page_snapshot(v_id);
    if v_snapshot is null or coalesce(jsonb_array_length(v_snapshot -> 'sections'), 0) = 0 then
      raise exception 'Page % has no visible section; refusing to publish it.', v_slug;
    end if;

    update public.site_pages p
       set status = 'published',
           published_at = now(),
           published_by = null,
           published_snapshot = v_snapshot
     where p.id = v_id;

    v_published := v_published + 1;
  end loop;

  if cardinality(v_missing) > 0 then
    raise exception 'Stage 1 expected these seeded pages and did not find them: %', array_to_string(v_missing, ', ');
  end if;

  raise notice 'Stage 1 published % page(s); the other seeded pages stay drafts.', v_published;
end
$$;

-- Post-check: exactly the nine stage-1 slugs are public, and an anonymous caller
-- can read them through the published-content function only.
select p.slug,
       p.status,
       p.published_at,
       (public.published_page(p.slug) ->> 'state') as anonymous_state
  from public.site_pages p
 where p.slug in ('about', 'contact', 'terms', 'privacy', 'returns',
                  'shipping', 'grievance', 'business-disclosure', 'product-safety')
 order by p.sort_order, p.slug;
