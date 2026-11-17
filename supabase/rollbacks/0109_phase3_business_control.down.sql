-- ============================================================================
-- ROLLBACK 0109: Phase 3 — Super Admin Business Control
--
-- LOCAL / REVIEW ONLY — DO NOT APPLY TO PRODUCTION WITHOUT OWNER APPROVAL
-- AND A VERIFIED DATABASE BACKUP.
--
-- DATA-LOSS PROTECTION & OVERRIDE CONTRACT:
--   1. Runs atomically inside a single DO block so any failure rolls back the
--      entire script and cannot leave a partially rolled-back schema.
--   2. Inspects EVERY Phase 3 data surface before executing any DDL:
--        - public.products.description (non-empty product descriptions)
--        - public.product_moderation_history (all rows)
--        - public.wholesale_pricing_rules (any non-default / edited config row)
--        - public.seller_pricing_permissions (all rows)
--        - public.product_wholesale_limits (all rows)
--        - public.membership_plans (any customized Phase 3 config column)
--        - public.membership_program_settings (any non-default / edited config row)
--        - public.membership_upgrade_requests (all rows)
--        - public.ad_program_settings (any non-default / edited config row)
--        - public.seller_ad_campaigns (all rows)
--        - public.seller_ad_campaign_audit (all rows)
--   3. If ANY protected surface holds meaningful Phase 3 data, the rollback
--      REFUSES (SQLSTATE 23514) with an itemized list of every affected
--      source and exact row count.
--   4. To authorize a destructive rollback, run inside an explicit transaction:
--        BEGIN;
--        SET LOCAL maharani.allow_data_loss = 'true';
--        -- execute this rollback script
--        COMMIT;
--      When authorized, the script emits a WARNING detailing every record
--      count that will be permanently deleted, executes all teardowns without
--      CASCADE, and immediately resets `maharani.allow_data_loss` on completion
--      so the override cannot linger across statements.
--   5. Safe to retry: every existence check guards tables and columns before
--      querying, altering, or dropping.
--   6. Preserves all pre-existing business data and migrations (0001–0108),
--      including products (and 0107 cost_price lockdown), sellers, offers,
--      orders, membership_plans base columns & 0083 retirement, retailer
--      membership history, loyalty_ledger, banners, audit_logs, and
--      super_admin_audit_logs rows (retaining anon/UPDATE/DELETE revocations
--      on super_admin_audit_logs so rollback never re-opens audit tampering).
--
-- COMPLETE INVENTORY OF REMOVED / RESTORED 0109 OBJECTS:
--   Tables dropped (9, no CASCADE):
--     seller_ad_campaign_audit, seller_ad_campaigns, ad_program_settings,
--     membership_upgrade_requests, membership_program_settings,
--     product_wholesale_limits, seller_pricing_permissions,
--     wholesale_pricing_rules, product_moderation_history
--   Columns & constraints dropped (9 columns, 7 constraints, no CASCADE):
--     membership_plans: product_discount_percent, order_value_discount_percent,
--       min_order_value_paise, max_discount_paise, eligibility_rules,
--       expiry_behavior, grace_period_days, renewal_mode (+ 6 check constraints)
--     products: description (+ products_description_length_check & column grant)
--   Policies dropped (19 on dropped tables) & restored (2 on membership_plans):
--     membership_plans_admin_insert, membership_plans_admin_update (restored to 0080)
--   Indexes dropped (8):
--     idx_saca_campaign, idx_sac_placement_active, idx_sac_seller,
--     idx_mur_status, idx_mur_retailer, idx_pmh_seller, idx_pmh_offer, idx_pmh_product
--   Triggers dropped (24):
--     trg_audit_banners, trg_prevent_sa_audit_mutation,
--     trg_guard_super_admin_audit_insert, trg_audit_ad_program_settings,
--     trg_log_seller_ad_campaign_audit, trg_enforce_seller_ad_campaign_rules,
--     trg_prevent_saca_mutation, trg_audit_membership_upgrade_requests,
--     trg_enforce_membership_upgrade_request, trg_audit_membership_program_settings,
--     trg_audit_membership_plans, trg_guard_membership_plan_changes,
--     trg_enforce_product_tier_wholesale_limits,
--     trg_enforce_seller_tier_wholesale_limits,
--     trg_enforce_seller_offer_wholesale_limits,
--     trg_audit_product_wholesale_limits, trg_audit_seller_pricing_permissions,
--     trg_audit_wholesale_pricing_rules, trg_stamp_product_wholesale_limits,
--     trg_stamp_seller_pricing_permissions, trg_stamp_wholesale_pricing_rules,
--     trg_log_seller_offer_moderation_event, trg_prevent_pmh_mutation,
--     trg_stamp_product_moderation_actor
--   Functions dropped (15, no CASCADE):
--     guard_super_admin_audit_insert(), log_seller_ad_campaign_audit(),
--     enforce_seller_ad_campaign_rules(),
--     super_admin_assign_membership(uuid, text, text, text),
--     get_retailer_membership_overview(uuid),
--     enforce_membership_upgrade_request(), guard_membership_plan_changes(),
--     enforce_product_tier_wholesale_limits(),
--     enforce_seller_tier_wholesale_limits(),
--     enforce_seller_offer_wholesale_limits(), stamp_wholesale_rule_editor(),
--     log_seller_offer_moderation_event(), stamp_product_moderation_actor(),
--     log_phase3_governance_audit(), prevent_append_only_audit_mutation()
-- ============================================================================

do $rollback_0109$
declare
  v_allow_loss boolean := coalesce(current_setting('maharani.allow_data_loss', true), '') = 'true';
  v_cnt bigint := 0;
  v_total_records bigint := 0;
  v_findings text[] := array[]::text[];
  v_mp_predicates text[] := array[]::text[];
  v_mp_sql text;
  v_report text;
begin
  -- -------------------------------------------------------------------------
  -- 0. Preflight data-loss inventory across EVERY Phase 3 table and column
  -- -------------------------------------------------------------------------

  -- 0.1 products.description (non-empty values)
  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'products'
       and column_name = 'description'
  ) then
    execute 'select count(*) from public.products where description is not null and btrim(description) <> '''''
      into v_cnt;
    if v_cnt > 0 then
      v_findings := array_append(
        v_findings,
        format('products.description (non-empty product descriptions): %s', v_cnt)
      );
      v_total_records := v_total_records + v_cnt;
    end if;
  end if;

  -- 0.2 product_moderation_history (all rows)
  if to_regclass('public.product_moderation_history') is not null then
    execute 'select count(*) from public.product_moderation_history' into v_cnt;
    if v_cnt > 0 then
      v_findings := array_append(
        v_findings,
        format('product_moderation_history (moderation & availability history rows): %s', v_cnt)
      );
      v_total_records := v_total_records + v_cnt;
    end if;
  end if;

  -- 0.3 wholesale_pricing_rules (any non-default or operator-modified row)
  if to_regclass('public.wholesale_pricing_rules') is not null then
    execute $q$
      select count(*)
        from public.wholesale_pricing_rules
       where id <> 1
          or default_min_order_qty is distinct from 1
          or max_discount_percent is distinct from 25.00
          or allow_seller_custom_slabs is distinct from true
          or allow_seller_price_override is distinct from false
          or enforce_pack_floor is distinct from true
          or min_order_value_paise is distinct from 0
          or notes is distinct from 'Default conservative wholesale guardrails seeded by migration 0109.'
          or updated_by is not null
    $q$ into v_cnt;
    if v_cnt > 0 then
      v_findings := array_append(
        v_findings,
        format('wholesale_pricing_rules (non-default wholesale pricing rules): %s', v_cnt)
      );
      v_total_records := v_total_records + v_cnt;
    end if;
  end if;

  -- 0.4 seller_pricing_permissions (all rows)
  if to_regclass('public.seller_pricing_permissions') is not null then
    execute 'select count(*) from public.seller_pricing_permissions' into v_cnt;
    if v_cnt > 0 then
      v_findings := array_append(
        v_findings,
        format('seller_pricing_permissions (per-seller pricing permission rows): %s', v_cnt)
      );
      v_total_records := v_total_records + v_cnt;
    end if;
  end if;

  -- 0.5 product_wholesale_limits (all rows)
  if to_regclass('public.product_wholesale_limits') is not null then
    execute 'select count(*) from public.product_wholesale_limits' into v_cnt;
    if v_cnt > 0 then
      v_findings := array_append(
        v_findings,
        format('product_wholesale_limits (per-pack wholesale limit rows): %s', v_cnt)
      );
      v_total_records := v_total_records + v_cnt;
    end if;
  end if;

  -- 0.6 membership_plans additional Phase 3 configuration columns (all 8 checked dynamically)
  if to_regclass('public.membership_plans') is not null then
    if exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'membership_plans' and column_name = 'product_discount_percent'
    ) then
      v_mp_predicates := array_append(v_mp_predicates, 'product_discount_percent is distinct from 0.00');
    end if;

    if exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'membership_plans' and column_name = 'order_value_discount_percent'
    ) then
      v_mp_predicates := array_append(
        v_mp_predicates,
        'order_value_discount_percent is distinct from coalesce(discount_percent, 0.00)'
      );
    end if;

    if exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'membership_plans' and column_name = 'min_order_value_paise'
    ) then
      v_mp_predicates := array_append(v_mp_predicates, 'min_order_value_paise is distinct from 0');
    end if;

    if exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'membership_plans' and column_name = 'max_discount_paise'
    ) then
      v_mp_predicates := array_append(v_mp_predicates, 'max_discount_paise is distinct from 500000');
    end if;

    if exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'membership_plans' and column_name = 'eligibility_rules'
    ) then
      v_mp_predicates := array_append(
        v_mp_predicates,
        $p$eligibility_rules is distinct from '{"requireApprovedRetailer": true, "allowedCategories": ["general", "silver", "gold"]}'::jsonb$p$
      );
    end if;

    if exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'membership_plans' and column_name = 'expiry_behavior'
    ) then
      v_mp_predicates := array_append(v_mp_predicates, $p$expiry_behavior is distinct from 'immediate_stop'$p$);
    end if;

    if exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'membership_plans' and column_name = 'grace_period_days'
    ) then
      v_mp_predicates := array_append(v_mp_predicates, 'grace_period_days is distinct from 0');
    end if;

    if exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'membership_plans' and column_name = 'renewal_mode'
    ) then
      v_mp_predicates := array_append(v_mp_predicates, $p$renewal_mode is distinct from 'manual_owner_approval'$p$);
    end if;

    if array_length(v_mp_predicates, 1) is not null then
      v_mp_sql := 'select count(*) from public.membership_plans where '
        || array_to_string(v_mp_predicates, ' or ');
      execute v_mp_sql into v_cnt;
      if v_cnt > 0 then
        v_findings := array_append(
          v_findings,
          format('membership_plans (customized Phase 3 plan configuration rows): %s', v_cnt)
        );
        v_total_records := v_total_records + v_cnt;
      end if;
    end if;
  end if;

  -- 0.7 membership_program_settings (any non-default or operator-modified row)
  if to_regclass('public.membership_program_settings') is not null then
    execute $q$
      select count(*)
        from public.membership_program_settings
       where id <> 1
          or program_enabled is distinct from false
          or live_payment_collection_enabled is distinct from false
          or owner_approval_reference is not null
          or notes is distinct from 'Membership activation requires explicit owner approval. Live payment collection is disabled.'
          or updated_by is not null
    $q$ into v_cnt;
    if v_cnt > 0 then
      v_findings := array_append(
        v_findings,
        format('membership_program_settings (non-default membership program settings): %s', v_cnt)
      );
      v_total_records := v_total_records + v_cnt;
    end if;
  end if;

  -- 0.8 membership_upgrade_requests (all rows)
  if to_regclass('public.membership_upgrade_requests') is not null then
    execute 'select count(*) from public.membership_upgrade_requests' into v_cnt;
    if v_cnt > 0 then
      v_findings := array_append(
        v_findings,
        format('membership_upgrade_requests (retailer upgrade request rows): %s', v_cnt)
      );
      v_total_records := v_total_records + v_cnt;
    end if;
  end if;

  -- 0.9 ad_program_settings (any non-default or operator-modified row)
  if to_regclass('public.ad_program_settings') is not null then
    execute $q$
      select count(*)
        from public.ad_program_settings
       where id <> 1
          or seller_ads_enabled is distinct from false
          or live_payment_collection_enabled is distinct from false
          or max_active_campaigns_per_placement is distinct from 3
          or allowed_placements is distinct from array['homepage_hero', 'homepage_strip', 'category_banner', 'catalog_spotlight']::text[]
          or owner_approval_reference is not null
          or notes is distinct from 'Paid seller advertising remains disabled pending explicit owner approval.'
          or updated_by is not null
    $q$ into v_cnt;
    if v_cnt > 0 then
      v_findings := array_append(
        v_findings,
        format('ad_program_settings (non-default ad program settings): %s', v_cnt)
      );
      v_total_records := v_total_records + v_cnt;
    end if;
  end if;

  -- 0.10 seller_ad_campaigns (all rows)
  if to_regclass('public.seller_ad_campaigns') is not null then
    execute 'select count(*) from public.seller_ad_campaigns' into v_cnt;
    if v_cnt > 0 then
      v_findings := array_append(
        v_findings,
        format('seller_ad_campaigns (seller ad campaign rows): %s', v_cnt)
      );
      v_total_records := v_total_records + v_cnt;
    end if;
  end if;

  -- 0.11 seller_ad_campaign_audit (all rows)
  if to_regclass('public.seller_ad_campaign_audit') is not null then
    execute 'select count(*) from public.seller_ad_campaign_audit' into v_cnt;
    if v_cnt > 0 then
      v_findings := array_append(
        v_findings,
        format('seller_ad_campaign_audit (campaign audit history rows): %s', v_cnt)
      );
      v_total_records := v_total_records + v_cnt;
    end if;
  end if;

  -- Refuse unless explicitly authorized; when authorized, clearly report every loss
  if array_length(v_findings, 1) is not null then
    v_report := array_to_string(v_findings, '; ');
    if not v_allow_loss then
      raise exception 'Refusing to drop non-empty Phase 3 records (% record(s) across % protected source(s)): %. Back up these records first, then run inside an explicit transaction with SET LOCAL maharani.allow_data_loss = ''true''.',
        v_total_records,
        array_length(v_findings, 1),
        v_report
        using errcode = '23514';
    else
      raise warning 'AUTHORIZED DESTRUCTIVE ROLLBACK 0109 (maharani.allow_data_loss = ''true''): permanently deleting % Phase 3 record(s) across % source(s): %.',
        v_total_records,
        array_length(v_findings, 1),
        v_report;
    end if;
  end if;

  -- -------------------------------------------------------------------------
  -- 5. Remove Phase 3 audit triggers on pre-existing tables (no CASCADE)
  --    Note: super_admin_audit_logs anon/UPDATE/DELETE revocations stay intact
  --    so rollback never re-opens audit log tampering.
  -- -------------------------------------------------------------------------
  if to_regclass('public.banners') is not null then
    drop trigger if exists trg_audit_banners on public.banners;
  end if;

  if to_regclass('public.super_admin_audit_logs') is not null then
    drop trigger if exists trg_prevent_sa_audit_mutation on public.super_admin_audit_logs;
    drop trigger if exists trg_guard_super_admin_audit_insert on public.super_admin_audit_logs;
  end if;
  drop function if exists public.guard_super_admin_audit_insert();

  -- -------------------------------------------------------------------------
  -- 4. Remove paid seller ad campaigns & ad program settings (no CASCADE)
  -- -------------------------------------------------------------------------
  if to_regclass('public.ad_program_settings') is not null then
    drop trigger if exists trg_audit_ad_program_settings on public.ad_program_settings;
    drop policy if exists "aps_super_admin_write" on public.ad_program_settings;
    drop policy if exists "aps_select" on public.ad_program_settings;
  end if;

  if to_regclass('public.seller_ad_campaigns') is not null then
    drop trigger if exists trg_log_seller_ad_campaign_audit on public.seller_ad_campaigns;
    drop trigger if exists trg_enforce_seller_ad_campaign_rules on public.seller_ad_campaigns;
    drop policy if exists "sac_update" on public.seller_ad_campaigns;
    drop policy if exists "sac_insert" on public.seller_ad_campaigns;
    drop policy if exists "sac_select" on public.seller_ad_campaigns;
  end if;

  if to_regclass('public.seller_ad_campaign_audit') is not null then
    drop trigger if exists trg_prevent_saca_mutation on public.seller_ad_campaign_audit;
    drop policy if exists "saca_select" on public.seller_ad_campaign_audit;
  end if;

  drop function if exists public.log_seller_ad_campaign_audit();
  drop function if exists public.enforce_seller_ad_campaign_rules();

  drop index if exists public.idx_saca_campaign;
  drop index if exists public.idx_sac_placement_active;
  drop index if exists public.idx_sac_seller;

  drop table if exists public.seller_ad_campaign_audit;
  drop table if exists public.seller_ad_campaigns;
  drop table if exists public.ad_program_settings;

  -- -------------------------------------------------------------------------
  -- 3. Remove Phase 3 membership objects & restore 0080 policies (no CASCADE)
  -- -------------------------------------------------------------------------
  drop function if exists public.super_admin_assign_membership(uuid, text, text, text);
  drop function if exists public.get_retailer_membership_overview(uuid);

  if to_regclass('public.membership_upgrade_requests') is not null then
    drop trigger if exists trg_audit_membership_upgrade_requests on public.membership_upgrade_requests;
    drop trigger if exists trg_enforce_membership_upgrade_request on public.membership_upgrade_requests;
    drop policy if exists "mur_update" on public.membership_upgrade_requests;
    drop policy if exists "mur_insert" on public.membership_upgrade_requests;
    drop policy if exists "mur_select" on public.membership_upgrade_requests;
  end if;
  drop function if exists public.enforce_membership_upgrade_request();
  drop index if exists public.idx_mur_status;
  drop index if exists public.idx_mur_retailer;
  drop table if exists public.membership_upgrade_requests;

  if to_regclass('public.membership_program_settings') is not null then
    drop trigger if exists trg_audit_membership_program_settings on public.membership_program_settings;
    drop policy if exists "mps_super_admin_write" on public.membership_program_settings;
    drop policy if exists "mps_select" on public.membership_program_settings;
  end if;
  drop table if exists public.membership_program_settings;

  if to_regclass('public.membership_plans') is not null then
    drop trigger if exists trg_audit_membership_plans on public.membership_plans;
    drop trigger if exists trg_guard_membership_plan_changes on public.membership_plans;
    drop function if exists public.guard_membership_plan_changes();

    drop policy if exists "membership_plans_admin_insert" on public.membership_plans;
    create policy "membership_plans_admin_insert" on public.membership_plans
      for insert with check (public.is_admin_or_above());

    drop policy if exists "membership_plans_admin_update" on public.membership_plans;
    create policy "membership_plans_admin_update" on public.membership_plans
      for update using (public.is_admin_or_above());

    alter table public.membership_plans
      drop constraint if exists membership_plans_product_discount_check,
      drop constraint if exists membership_plans_order_discount_check,
      drop constraint if exists membership_plans_min_order_value_check,
      drop constraint if exists membership_plans_eligibility_object_check,
      drop constraint if exists membership_plans_expiry_behavior_check,
      drop constraint if exists membership_plans_renewal_mode_check,
      drop column if exists product_discount_percent,
      drop column if exists order_value_discount_percent,
      drop column if exists min_order_value_paise,
      drop column if exists max_discount_paise,
      drop column if exists eligibility_rules,
      drop column if exists expiry_behavior,
      drop column if exists grace_period_days,
      drop column if exists renewal_mode;
  else
    drop function if exists public.guard_membership_plan_changes();
  end if;

  -- -------------------------------------------------------------------------
  -- 2. Remove wholesale pricing control tables, triggers & functions (no CASCADE)
  -- -------------------------------------------------------------------------
  if to_regclass('public.product_pricing_tiers') is not null then
    drop trigger if exists trg_enforce_product_tier_wholesale_limits on public.product_pricing_tiers;
  end if;
  if to_regclass('public.seller_offer_tiers') is not null then
    drop trigger if exists trg_enforce_seller_tier_wholesale_limits on public.seller_offer_tiers;
  end if;
  if to_regclass('public.seller_offers') is not null then
    drop trigger if exists trg_enforce_seller_offer_wholesale_limits on public.seller_offers;
  end if;

  drop function if exists public.enforce_product_tier_wholesale_limits();
  drop function if exists public.enforce_seller_tier_wholesale_limits();
  drop function if exists public.enforce_seller_offer_wholesale_limits();

  if to_regclass('public.product_wholesale_limits') is not null then
    drop trigger if exists trg_audit_product_wholesale_limits on public.product_wholesale_limits;
    drop trigger if exists trg_stamp_product_wholesale_limits on public.product_wholesale_limits;
    drop policy if exists "pwl_super_admin_write" on public.product_wholesale_limits;
    drop policy if exists "pwl_select" on public.product_wholesale_limits;
  end if;

  if to_regclass('public.seller_pricing_permissions') is not null then
    drop trigger if exists trg_audit_seller_pricing_permissions on public.seller_pricing_permissions;
    drop trigger if exists trg_stamp_seller_pricing_permissions on public.seller_pricing_permissions;
    drop policy if exists "spp_super_admin_write" on public.seller_pricing_permissions;
    drop policy if exists "spp_select" on public.seller_pricing_permissions;
  end if;

  if to_regclass('public.wholesale_pricing_rules') is not null then
    drop trigger if exists trg_audit_wholesale_pricing_rules on public.wholesale_pricing_rules;
    drop trigger if exists trg_stamp_wholesale_pricing_rules on public.wholesale_pricing_rules;
    drop policy if exists "wpr_super_admin_write" on public.wholesale_pricing_rules;
    drop policy if exists "wpr_select" on public.wholesale_pricing_rules;
  end if;

  drop function if exists public.stamp_wholesale_rule_editor();

  drop table if exists public.product_wholesale_limits;
  drop table if exists public.seller_pricing_permissions;
  drop table if exists public.wholesale_pricing_rules;

  -- -------------------------------------------------------------------------
  -- 1. Remove product moderation history, shared helpers & products.description
  --    (no CASCADE; preserves 0107 products.cost_price column lockdown)
  -- -------------------------------------------------------------------------
  if to_regclass('public.seller_offers') is not null then
    drop trigger if exists trg_log_seller_offer_moderation_event on public.seller_offers;
  end if;
  drop function if exists public.log_seller_offer_moderation_event();

  if to_regclass('public.product_moderation_history') is not null then
    drop trigger if exists trg_prevent_pmh_mutation on public.product_moderation_history;
    drop trigger if exists trg_stamp_product_moderation_actor on public.product_moderation_history;
    drop policy if exists "pmh_admin_insert" on public.product_moderation_history;
    drop policy if exists "pmh_select" on public.product_moderation_history;
  end if;

  drop index if exists public.idx_pmh_seller;
  drop index if exists public.idx_pmh_offer;
  drop index if exists public.idx_pmh_product;
  drop table if exists public.product_moderation_history;

  drop function if exists public.stamp_product_moderation_actor();
  drop function if exists public.log_phase3_governance_audit();
  drop function if exists public.prevent_append_only_audit_mutation();

  if to_regclass('public.products') is not null then
    alter table public.products
      drop constraint if exists products_description_length_check,
      drop column if exists description;
  end if;

  -- Disarm the data-loss override immediately after completion so it cannot
  -- linger into subsequent operations.
  if v_allow_loss then
    reset maharani.allow_data_loss;
  end if;
end;
$rollback_0109$;
