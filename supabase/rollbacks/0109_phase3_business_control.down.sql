-- ============================================================================
-- ROLLBACK 0109: Phase 3 — Super Admin Business Control
--
-- Safe, explicit rollback. Refuses to drop non-empty audit/moderation tables
-- unless the operator sets `set local maharani.allow_data_loss = 'true';`.
-- Does not touch existing products, sellers, orders, or membership history.
-- ============================================================================

do $$
declare
  v_allow_loss boolean := coalesce(current_setting('maharani.allow_data_loss', true), '') = 'true';
  v_pmh bigint := 0;
  v_saca bigint := 0;
  v_sac bigint := 0;
  v_mur bigint := 0;
begin
  if to_regclass('public.product_moderation_history') is not null then
    select count(*) into v_pmh from public.product_moderation_history;
  end if;
  if to_regclass('public.seller_ad_campaign_audit') is not null then
    select count(*) into v_saca from public.seller_ad_campaign_audit;
  end if;
  if to_regclass('public.seller_ad_campaigns') is not null then
    select count(*) into v_sac from public.seller_ad_campaigns;
  end if;
  if to_regclass('public.membership_upgrade_requests') is not null then
    select count(*) into v_mur from public.membership_upgrade_requests;
  end if;

  if not v_allow_loss and (v_pmh > 0 or v_saca > 0 or v_sac > 0 or v_mur > 0) then
    raise exception 'Refusing to drop non-empty Phase 3 records (moderation=%, ad_campaigns=%, ad_audit=%, upgrade_requests=%). Set maharani.allow_data_loss = true to force.',
      v_pmh, v_sac, v_saca, v_mur
      using errcode = '23514';
  end if;
end;
$$;

-- 5. Restore audit triggers
drop trigger if exists trg_audit_banners on public.banners;
drop trigger if exists trg_prevent_sa_audit_mutation on public.super_admin_audit_logs;
drop trigger if exists trg_guard_super_admin_audit_insert on public.super_admin_audit_logs;
drop function if exists public.guard_super_admin_audit_insert();

-- 4. Drop seller ad campaigns & settings
drop trigger if exists trg_audit_ad_program_settings on public.ad_program_settings;
drop trigger if exists trg_log_seller_ad_campaign_audit on public.seller_ad_campaigns;
drop trigger if exists trg_enforce_seller_ad_campaign_rules on public.seller_ad_campaigns;
drop trigger if exists trg_prevent_saca_mutation on public.seller_ad_campaign_audit;
drop table if exists public.seller_ad_campaign_audit;
drop table if exists public.seller_ad_campaigns;
drop table if exists public.ad_program_settings;
drop function if exists public.log_seller_ad_campaign_audit();
drop function if exists public.enforce_seller_ad_campaign_rules();

-- 3. Restore membership objects
drop function if exists public.super_admin_assign_membership(uuid, text, text, text);
drop function if exists public.get_retailer_membership_overview(uuid);
drop trigger if exists trg_audit_membership_upgrade_requests on public.membership_upgrade_requests;
drop trigger if exists trg_enforce_membership_upgrade_request on public.membership_upgrade_requests;
drop table if exists public.membership_upgrade_requests;
drop function if exists public.enforce_membership_upgrade_request();
drop trigger if exists trg_audit_membership_program_settings on public.membership_program_settings;
drop trigger if exists trg_audit_membership_plans on public.membership_plans;
drop trigger if exists trg_guard_membership_plan_changes on public.membership_plans;
drop table if exists public.membership_program_settings;
drop function if exists public.guard_membership_plan_changes();

drop policy if exists "membership_plans_admin_insert" on public.membership_plans;
create policy "membership_plans_admin_insert" on public.membership_plans
  for insert with check (is_admin_or_above());
drop policy if exists "membership_plans_admin_update" on public.membership_plans;
create policy "membership_plans_admin_update" on public.membership_plans
  for update using (is_admin_or_above());

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

-- 2. Drop wholesale pricing control
drop trigger if exists trg_enforce_product_tier_wholesale_limits on public.product_pricing_tiers;
drop trigger if exists trg_enforce_seller_tier_wholesale_limits on public.seller_offer_tiers;
drop trigger if exists trg_enforce_seller_offer_wholesale_limits on public.seller_offers;
drop trigger if exists trg_audit_product_wholesale_limits on public.product_wholesale_limits;
drop trigger if exists trg_audit_seller_pricing_permissions on public.seller_pricing_permissions;
drop trigger if exists trg_audit_wholesale_pricing_rules on public.wholesale_pricing_rules;
drop trigger if exists trg_stamp_product_wholesale_limits on public.product_wholesale_limits;
drop trigger if exists trg_stamp_seller_pricing_permissions on public.seller_pricing_permissions;
drop trigger if exists trg_stamp_wholesale_pricing_rules on public.wholesale_pricing_rules;
drop table if exists public.product_wholesale_limits;
drop table if exists public.seller_pricing_permissions;
drop table if exists public.wholesale_pricing_rules;
drop function if exists public.enforce_product_tier_wholesale_limits();
drop function if exists public.enforce_seller_tier_wholesale_limits();
drop function if exists public.enforce_seller_offer_wholesale_limits();
drop function if exists public.stamp_wholesale_rule_editor();

-- 1. Drop product moderation history & description column
drop trigger if exists trg_log_seller_offer_moderation_event on public.seller_offers;
drop trigger if exists trg_prevent_pmh_mutation on public.product_moderation_history;
drop trigger if exists trg_stamp_product_moderation_actor on public.product_moderation_history;
drop table if exists public.product_moderation_history;
drop function if exists public.log_seller_offer_moderation_event();
drop function if exists public.stamp_product_moderation_actor();
drop function if exists public.log_phase3_governance_audit();
drop function if exists public.prevent_append_only_audit_mutation();

alter table public.products
  drop constraint if exists products_description_length_check,
  drop column if exists description;
