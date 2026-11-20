-- ============================================================================
-- Stage 2 — publish the pages that did NOT exist publicly before 15 Nov 2026.
--
-- NOT a migration. Run only AFTER the owner and an Indian legal/CA reviewer have
-- read each page below and approved it, and after stage 1 is live and verified.
-- See supabase/publication/README.md.
--
-- These are new public statements, not carried-over wording. Publishing them
-- says, to customers and to a regulator, that Maharani Traders stands behind:
--   damaged-goods          what happens to a damaged delivery
--   retailer-terms         additional terms for retail buyers
--   marketplace-disclaimer the boundary between own-stock sales and the marketplace
--   gst-pricing-invoice    GST, pricing and invoicing statements
--   prohibited-products    what may not be sold through the platform
--   ip-complaints          the intellectual-property complaint route
--   suspension-termination grounds for suspending or terminating an account
--   cookies                cookie usage
--   coins-loyalty          the Maharani Coins programme
--
-- If you want only some of them, delete the other slugs from v_slugs — the script
-- publishes exactly the list it is given and refuses anything else.
--
-- Timestamps: published_at = now() — the real time of this action.
-- Does NOT touch legal_document_current_versions (the acceptance registry): a
-- published page is not the same thing as an acceptance requirement. Registering a
-- version for the seller agreement stays an explicit, separate decision.
-- ============================================================================

do $$
declare
  -- `seller-agreement` is DELIBERATELY ABSENT. The seller / marketplace
  -- programme was discontinued (migration 0110), so this page is no longer a
  -- public statement: it is the historical contract with a class of seller that
  -- no longer exists. Publishing it would put a live legal document in front of
  -- customers describing a programme we do not operate. The page, its wording
  -- and its acceptance registry row are all kept — it simply stays unpublished,
  -- and the owner can archive or repurpose it from Super Admin -> Website
  -- content. Do not add it back to this list without a new business decision.
  v_slugs text[] := array[
    'damaged-goods',
    'retailer-terms',
    'marketplace-disclaimer',
    'gst-pricing-invoice',
    'prohibited-products',
    'ip-complaints',
    'suspension-termination',
    'cookies',
    'coins-loyalty'
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

  -- Stage 1 must already be live: publishing new statements while the site cannot
  -- serve the pages that existed before is a worse state than either alone.
  if not exists (select 1 from public.site_pages where slug = 'terms' and status = 'published') then
    raise exception 'Run stage1_publish_live_text.sql and deploy first.';
  end if;

  foreach v_slug in array v_slugs loop
    select id into v_id from public.site_pages where slug = v_slug;
    if v_id is null then
      v_missing := array_append(v_missing, v_slug);
      continue;
    end if;

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
    raise exception 'Stage 2 expected these seeded pages and did not find them: %', array_to_string(v_missing, ', ');
  end if;

  raise notice 'Stage 2 published % page(s).', v_published;
end
$$;

-- Post-check: what is now public, and what is still a draft.
select p.slug, p.kind, p.status, p.published_at
  from public.site_pages p
 order by p.status, p.sort_order, p.slug;
