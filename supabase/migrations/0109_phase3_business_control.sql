-- ============================================================================
-- 0109: Phase 3 — Super Admin Business Control, Wholesale Pricing Governance,
--       Owner-Gated Retailer Membership Config, Controlled Seller Ad Campaigns
--       & Audit Integrity Hardening.
--
-- LOCAL / REVIEW ONLY — DO NOT APPLY TO PRODUCTION WITHOUT OWNER APPROVAL.
--
-- DEPENDENCIES (enforced by the §0 pre-flight guard, which aborts before DDL):
--   relations (12)
--     public.products                            <- 0001_init
--     public.banners                             <- 0001_init
--     public.super_admin_audit_logs              <- 0020_super_admin_control_center
--     public.product_pricing_tiers               <- 0022_case_based_pricing
--     public.product_packs                       <- 0004_product_packs
--     public.suppliers                           <- 0059_supplier_applications
--     public.supplier_application_rate_limits    <- 0060_supplier_application_rate_limit
--     public.sellers                             <- 0062_seller_identity
--     public.seller_offers                       <- 0063_seller_offers
--     public.seller_offer_tiers                  <- 0069_seller_portal_access
--     public.membership_plans                    <- 0080_retailer_memberships_and_loyalty
--     public.retailer_memberships                <- 0080_retailer_memberships_and_loyalty
--   helper functions (7, exact signatures)
--     public.is_admin_or_above()                 <- 0001_init, hardened by 0052_phase0_security_hardening
--     public.is_staff_or_above()                 <- 0001_init, hardened by 0052_phase0_security_hardening
--     public.current_user_role()                 <- 0001_init, hardened by 0052_phase0_security_hardening
--     public.is_retailer_area_assigned_to_current_staff(uuid) <- 0037_staff_scope_policies
--     public.is_active_seller_member(uuid)       <- 0072_super_admin_seller_invitations
--     public.consume_supplier_application_rate_limit(text,text,integer,integer)
--                                                <- 0060_supplier_application_rate_limit
--     public.log_audit()                         <- 0001_init, hardened by 0057_security_definer_hardening
--   ordering
--     0109 §1 grants column-level SELECT on the NEW `products.description`
--     column. 0107_restore_cost_price_column_lockdown revoked table-level
--     SELECT on `products` and re-granted every column except `cost_price`, so
--     0109 MUST run after 0107. The guard enforces that ordering.
--
-- Required order on the current production baseline (0001..0103 applied):
--     0104 -> 0105 -> 0106 -> 0107 -> 0108 -> 0109
-- See docs/repair/MIGRATION_0109_DEPENDENCY_REPORT.md for the read-only
-- production evidence behind this list and the owner-run verification script.
--
-- WHAT THIS MIGRATION ADDS (additive & idempotent):
--   1. Products description + append-only `product_moderation_history` (with
--      column-level SELECT grant on `products.description` preserving 0107's
--      `cost_price` lockdown).
--   2. Wholesale Pricing Control:
--      - `wholesale_pricing_rules` (singleton global rules, Super Admin write)
--      - `seller_pricing_permissions` (per-seller discount/slab/MOQ limits)
--      - `product_wholesale_limits` (per-pack discount/MOQ/slab limits)
--      - Server-side DB triggers enforcing discount ceilings, MOQ minimums,
--        and seller slab permissions on `seller_offers`, `seller_offer_tiers`,
--        and `product_pricing_tiers`.
--   3. Owner-Gated Retailer Membership Configuration (Free / Silver / Gold):
--      - Additive config columns on `membership_plans` (product discount %,
--        order-value discount %, min order value, max discount cap, eligibility
--        rules, immediate-stop expiry behavior, renewal settings).
--      - All plans REMAIN INACTIVE (`is_active = false`, matching 0083) and
--        live payment collection is hard-constrained to `false`.
--      - `membership_program_settings` (owner launch gate, OFF by default).
--      - `membership_upgrade_requests` (controlled non-payment request queue).
--      - `get_retailer_membership_overview(uuid)` RPC enforcing immediate stop
--        of benefits on `expires_at <= now()`.
--      - `super_admin_assign_membership(...)` RPC (Super Admin only, gated on
--        `program_enabled = true` + `owner_approval_reference`). Legacy
--        `admin_set_retailer_membership` stays REVOKED from all API roles.
--   4. Controlled Paid Seller Advertisement Campaigns:
--      - `ad_program_settings` (owner launch gate, `seller_ads_enabled = false`,
--        `live_payment_collection_enabled = false`).
--      - `seller_ad_campaigns` + immutable `seller_ad_campaign_audit`.
--      - Sellers submit draft/pending proposals only; cannot self-approve,
--        activate, or alter payment status. Super Admin cannot approve/activate
--        while `seller_ads_enabled = false`.
--   5. Audit Integrity Hardening:
--      - `super_admin_audit_logs` made append-only (no UPDATE/DELETE) and
--        `actor_id` pinned to `auth.uid()` for API callers.
--      - `banners` attached to `log_audit()`.
--   6. Function-by-Function Security Hardening (Audited & Individually Justified):
--      - `can_current_staff_read_profile(uuid)`: adds caller-role check
--        (`public.is_staff_or_above()`) + `pg_catalog, public, pg_temp`
--        `search_path`, closing anonymous/non-staff UUID role probing while
--        preserving `profiles_self_select` RLS evaluation.
--      - `submit_supplier_application(...)`: adds durable DB-level anti-abuse
--        rate limiting (per-phone SHA-256 hash + anonymous burst ceiling via
--        `0060`'s `supplier_application_rate_limits`), closing direct-PostgREST
--        rate-limit bypass while preserving public submission and signature.
--      - Explicitly revokes `EXECUTE` from `public, anon, authenticated` on
--        all 13 new `0109` trigger functions.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Pre-flight prerequisite check (fails fast before any DDL)
--
-- Every dependency is still REQUIRED and still blocks the migration; what
-- changed is only the REPORTING: each unmet object is now named together with
-- the migration that creates it, instead of collapsing twelve relations and
-- seven functions into one opaque sentence. The object -> migration matrix is
-- derived from `supabase/migrations/0001..0108` (see
-- docs/repair/MIGRATION_0109_DEPENDENCY_REPORT.md).
--
-- It also verifies the 0107 dependency explicitly: 0109 §1 writes a
-- column-level SELECT grant on the new `products.description` column precisely
-- so that 0107's `products.cost_price` lockdown keeps holding. That only works
-- when 0107 has actually run, so a database still at the pre-0107 shape (live
-- production: `authenticated` can still SELECT `products.cost_price`) is
-- reported as a migration-order problem instead of silently staying exposed.
--
-- That 0107 check is BOTH-ROLES and SEQUENTIAL:
--   step 1  public.products exists            (else 42P01, actionable)
--   step 2  products.cost_price exists, via pg_catalog metadata ONLY
--                                            (else 42703, actionable — no
--                                             privilege function is called
--                                             while the column is unknown)
--   step 3  has_column_privilege('anon', …) and
--           has_column_privilege('authenticated', …) must BOTH be false
--                                            (else 42501, naming the role(s))
-- The three checks are separate statements on purpose: a single boolean
-- expression would leave the 42703 protection depending on AND short-circuit
-- evaluation order instead of being a guarantee.
-- ---------------------------------------------------------------------------
do $$
declare
  v_missing              text;
  v_products_exists      boolean;
  v_cost_price_exists    boolean;
  v_cost_price_readable  text[];
begin
  -- Required relations: object -> creating migration.
  with required(obj, migration) as (
    values
      ('public.products',                           '0001_init'),
      ('public.banners',                            '0001_init'),
      ('public.super_admin_audit_logs',             '0020_super_admin_control_center'),
      ('public.product_pricing_tiers',              '0022_case_based_pricing'),
      ('public.product_packs',                      '0004_product_packs'),
      ('public.suppliers',                          '0059_supplier_applications'),
      ('public.supplier_application_rate_limits',   '0060_supplier_application_rate_limit'),
      ('public.sellers',                            '0062_seller_identity'),
      ('public.seller_offers',                      '0063_seller_offers'),
      ('public.seller_offer_tiers',                 '0069_seller_portal_access'),
      ('public.membership_plans',                   '0080_retailer_memberships_and_loyalty'),
      ('public.retailer_memberships',               '0080_retailer_memberships_and_loyalty')
  )
  select string_agg(format('%s (from %s)', required.obj, required.migration), ', ' order by required.migration)
    into v_missing
    from required
   where to_regclass(required.obj) is null;

  if v_missing is not null then
    raise exception 'MIGRATION ORDER VIOLATION: 0109 requires base catalog, seller, supplier, membership, banner and control-center tables (0001–0108). Missing relation(s): %.', v_missing
      using errcode = 'undefined_table';
  end if;

  -- Required helper functions with their EXACT signatures: object -> migration.
  with required(obj, migration) as (
    values
      ('public.is_admin_or_above()',                                          '0052_phase0_security_hardening'),
      ('public.is_staff_or_above()',                                          '0052_phase0_security_hardening'),
      ('public.current_user_role()',                                          '0052_phase0_security_hardening'),
      ('public.is_retailer_area_assigned_to_current_staff(uuid)',              '0037_staff_scope_policies'),
      ('public.is_active_seller_member(uuid)',                                 '0072_super_admin_seller_invitations'),
      ('public.consume_supplier_application_rate_limit(text,text,integer,integer)', '0060_supplier_application_rate_limit'),
      ('public.log_audit()',                                                  '0057_security_definer_hardening')
  )
  select string_agg(format('%s (from %s)', required.obj, required.migration), ', ' order by required.migration)
    into v_missing
    from required
   where to_regprocedure(required.obj) is null;

  if v_missing is not null then
    raise exception 'MIGRATION ORDER VIOLATION: 0109 requires helper functions from 0001, 0037, 0052, 0057, 0060, and 0072. Missing or wrong-signature function(s): %.', v_missing
      using errcode = 'undefined_function';
  end if;

  -- ---------------------------------------------------------------------------
  -- 0107 dependency: the cost_price lockdown must already be in force for EVERY
  -- API role, not just `authenticated`.
  --
  -- 0107 revokes table-level SELECT on public.products from PUBLIC, anon and
  -- authenticated, then re-grants column-level SELECT to anon AND authenticated
  -- for every column except cost_price. Checking only `authenticated` would miss
  -- a database where `anon` alone can still read purchase cost.
  --
  -- These steps are deliberately SEQUENTIAL PL/pgSQL statements, not one boolean
  -- expression: `has_column_privilege()` raises 42703 (undefined_column) when the
  -- column is absent, and relying on AND short-circuit evaluation order would
  -- make that protection an implementation accident rather than a guarantee.
  -- ---------------------------------------------------------------------------

  -- Step 1: the relation must exist.
  v_products_exists := to_regclass('public.products') is not null;

  if not v_products_exists then
    raise exception 'MIGRATION ORDER VIOLATION: 0109 cannot verify the 0107_restore_cost_price_column_lockdown dependency because public.products does not exist. Apply 0001_init (and 0004, 0022, 0025) before 0109.'
      using errcode = 'undefined_table';
  end if;

  -- Step 2: the column must exist, read from pg_catalog metadata only.
  -- No privilege function is called while this is still unknown.
  select exists (
           select 1
             from pg_catalog.pg_attribute a
            where a.attrelid = 'public.products'::regclass
              and a.attname = 'cost_price'
              and a.attnum > 0
              and not a.attisdropped
         )
    into v_cost_price_exists;

  if not v_cost_price_exists then
    raise exception 'MIGRATION ORDER VIOLATION: 0109 cannot verify the 0107_restore_cost_price_column_lockdown dependency because public.products.cost_price is missing. A catalog migration that should have created it has not been applied, or it was dropped after 0001_init/0025. Restore the column (0001_init -> 0025_cost_price_column_lockdown) before 0109; do not add cost_price back by hand outside a migration.'
      using errcode = 'undefined_column';
  end if;

  -- Step 3: only now is it safe to ask about effective privileges, and we ask
  -- about BOTH API roles.
  select array_agg(role_name order by role_name)
    into v_cost_price_readable
    from unnest(array['anon', 'authenticated']) as role_name
   where has_column_privilege(role_name, 'public.products', 'cost_price', 'SELECT');

  if v_cost_price_readable is not null then
    raise exception 'MIGRATION ORDER VIOLATION: 0109 must run AFTER 0107_restore_cost_price_column_lockdown. In this database the API role(s) % can still SELECT public.products.cost_price, which means the 0107 column-privilege lockdown is not in force. Apply 0104 -> 0105 -> 0106 -> 0107 -> 0108 first (0107 revokes table-level SELECT on products from PUBLIC, anon and authenticated, then grants every column except cost_price), then re-run 0109.',
      array_to_string(v_cost_price_readable, ' and ')
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Product description & append-only product/offer moderation history
-- ---------------------------------------------------------------------------
alter table public.products
  add column if not exists description text;

alter table public.products
  drop constraint if exists products_description_length_check;
alter table public.products
  add constraint products_description_length_check
  check (description is null or char_length(btrim(description)) <= 2000);

comment on column public.products.description is
  'Optional plain-text product description (max 2000 chars). Granted column-level SELECT to preserve 0107 cost_price lockdown.';

-- 0107 revoked table-level SELECT on products and re-granted column-level
-- SELECT on every column except cost_price. Grant ONLY the new description
-- column so catalog reads keep working while cost_price remains locked down.
grant select (description) on public.products to anon, authenticated;

create table if not exists public.product_moderation_history (
  id uuid primary key default uuid_generate_v4(),
  entity_type text not null check (entity_type in ('product', 'seller_offer')),
  product_id uuid references public.products(id) on delete cascade,
  seller_offer_id uuid references public.seller_offers(id) on delete cascade,
  seller_id uuid references public.sellers(id) on delete set null,
  action text not null check (
    action in (
      'submitted',
      'approved',
      'rejected',
      'removed_prohibited',
      'deactivated',
      'reactivated',
      'marked_out_of_stock',
      'restocked',
      'compliance_updated'
    )
  ),
  previous_status text,
  new_status text,
  reason text check (reason is null or char_length(btrim(reason)) <= 1000),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  acted_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint product_moderation_history_target_check check (
    (entity_type = 'product' and product_id is not null)
    or (entity_type = 'seller_offer' and seller_offer_id is not null)
  )
);

comment on table public.product_moderation_history is
  'Append-only moderation and availability history for own-stock products and seller offers.';

create index if not exists idx_pmh_product on public.product_moderation_history (product_id, created_at desc) where product_id is not null;
create index if not exists idx_pmh_offer on public.product_moderation_history (seller_offer_id, created_at desc) where seller_offer_id is not null;
create index if not exists idx_pmh_seller on public.product_moderation_history (seller_id, created_at desc) where seller_id is not null;

-- Non-SECURITY DEFINER so current_user reflects the real API role (0108 pattern).
create or replace function public.stamp_product_moderation_actor()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if auth.uid() is null then
      raise exception 'Authenticated reviewer required for moderation history.' using errcode = '42501';
    end if;
    if new.acted_by is not null and new.acted_by is distinct from auth.uid() then
      raise exception 'Moderation actor cannot be attributed to another account.' using errcode = '42501';
    end if;
    new.acted_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_stamp_product_moderation_actor on public.product_moderation_history;
create trigger trg_stamp_product_moderation_actor
  before insert on public.product_moderation_history
  for each row execute function public.stamp_product_moderation_actor();

create or replace function public.prevent_append_only_audit_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'Audit and moderation history tables are append-only and cannot be modified or deleted.'
    using errcode = '42501';
end;
$$;

-- Safe audit trigger for governance tables whose primary key is smallint, text,
-- seller_id, or pack_id (standard `log_audit()` assumes a UUID `id` column).
create or replace function public.log_phase3_governance_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row jsonb;
  v_record_id uuid;
begin
  v_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  if tg_table_name = 'seller_pricing_permissions' and v_row ? 'seller_id' then
    v_record_id := (v_row->>'seller_id')::uuid;
  elsif tg_table_name = 'product_wholesale_limits' and v_row ? 'pack_id' then
    v_record_id := (v_row->>'pack_id')::uuid;
  else
    v_record_id := md5(tg_table_name || ':' || coalesce(v_row->>'id', 'singleton'))::uuid;
  end if;

  insert into public.audit_logs (table_name, record_id, action, changed_by, old_data, new_data)
  values (
    tg_table_name,
    v_record_id,
    lower(tg_op),
    auth.uid(),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_prevent_pmh_mutation on public.product_moderation_history;
create trigger trg_prevent_pmh_mutation
  before update or delete on public.product_moderation_history
  for each row execute function public.prevent_append_only_audit_mutation();

-- Automatic offer moderation history capture whenever moderation_status or is_active changes.
create or replace function public.log_seller_offer_moderation_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_action text;
  v_prev text;
  v_next text;
begin
  if new.moderation_status is distinct from old.moderation_status then
    v_prev := old.moderation_status;
    v_next := new.moderation_status;
    v_action := case
      when new.moderation_status = 'approved' then 'approved'
      when new.moderation_status = 'rejected' and coalesce(new.moderation_reason, '') like '[PROHIBITED%' then 'removed_prohibited'
      when new.moderation_status = 'rejected' then 'rejected'
      else 'submitted'
    end;
    insert into public.product_moderation_history (
      entity_type, product_id, seller_offer_id, seller_id,
      action, previous_status, new_status, reason, acted_by
    ) values (
      'seller_offer', new.product_id, new.id, new.seller_id,
      v_action, v_prev, v_next, new.moderation_reason, coalesce(new.moderation_by, auth.uid())
    );
  elsif new.is_active is distinct from old.is_active then
    insert into public.product_moderation_history (
      entity_type, product_id, seller_offer_id, seller_id,
      action, previous_status, new_status, reason, acted_by
    ) values (
      'seller_offer', new.product_id, new.id, new.seller_id,
      case when new.is_active then 'reactivated' else 'deactivated' end,
      case when old.is_active then 'active' else 'inactive' end,
      case when new.is_active then 'active' else 'inactive' end,
      new.moderation_reason,
      auth.uid()
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_log_seller_offer_moderation_event on public.seller_offers;
create trigger trg_log_seller_offer_moderation_event
  after update of moderation_status, is_active on public.seller_offers
  for each row execute function public.log_seller_offer_moderation_event();

alter table public.product_moderation_history enable row level security;
revoke all on public.product_moderation_history from public, anon, authenticated;
grant select, insert on public.product_moderation_history to authenticated;

drop policy if exists "pmh_select" on public.product_moderation_history;
create policy "pmh_select" on public.product_moderation_history
  for select to authenticated
  using (
    public.is_admin_or_above()
    or (seller_id is not null and public.is_active_seller_member(seller_id))
  );

drop policy if exists "pmh_admin_insert" on public.product_moderation_history;
create policy "pmh_admin_insert" on public.product_moderation_history
  for insert to authenticated
  with check (public.is_admin_or_above());

-- ---------------------------------------------------------------------------
-- 2. Wholesale Pricing Control (Global Rules, Seller Permissions, Pack Limits)
-- ---------------------------------------------------------------------------
create table if not exists public.wholesale_pricing_rules (
  id smallint primary key default 1 check (id = 1),
  default_min_order_qty integer not null default 1 check (default_min_order_qty between 1 and 100000),
  max_discount_percent numeric(5, 2) not null default 25.00 check (max_discount_percent >= 0 and max_discount_percent <= 80),
  allow_seller_custom_slabs boolean not null default true,
  allow_seller_price_override boolean not null default false,
  enforce_pack_floor boolean not null default true,
  min_order_value_paise bigint not null default 0 check (min_order_value_paise >= 0 and min_order_value_paise <= 1000000000),
  notes text check (notes is null or char_length(btrim(notes)) <= 1000),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

comment on table public.wholesale_pricing_rules is
  'Singleton Super Admin global wholesale pricing rules, MOQ defaults, and maximum discount ceiling.';

insert into public.wholesale_pricing_rules (
  id, default_min_order_qty, max_discount_percent, allow_seller_custom_slabs,
  allow_seller_price_override, enforce_pack_floor, min_order_value_paise, notes
) values (
  1, 1, 25.00, true, false, true, 0,
  'Default conservative wholesale guardrails seeded by migration 0109.'
) on conflict (id) do nothing;

create table if not exists public.seller_pricing_permissions (
  seller_id uuid primary key references public.sellers(id) on delete cascade,
  can_set_custom_slabs boolean not null default true,
  can_apply_discounts boolean not null default true,
  max_discount_percent numeric(5, 2) not null default 15.00 check (max_discount_percent >= 0 and max_discount_percent <= 80),
  min_moq_override integer check (min_moq_override is null or min_moq_override between 1 and 100000),
  notes text check (notes is null or char_length(btrim(notes)) <= 500),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

comment on table public.seller_pricing_permissions is
  'Super Admin per-seller wholesale pricing permissions and maximum discount caps.';

create table if not exists public.product_wholesale_limits (
  pack_id uuid primary key references public.product_packs(id) on delete cascade,
  min_order_qty integer not null default 1 check (min_order_qty between 1 and 100000),
  max_discount_percent numeric(5, 2) not null default 25.00 check (max_discount_percent >= 0 and max_discount_percent <= 80),
  allow_seller_slabs boolean not null default true,
  notes text check (notes is null or char_length(btrim(notes)) <= 500),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

comment on table public.product_wholesale_limits is
  'Super Admin per-pack wholesale MOQ floor and maximum discount cap.';

create or replace function public.stamp_wholesale_rule_editor()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_global_max numeric(5, 2);
begin
  if current_user in ('authenticated', 'anon') then
    if not (public.current_user_role() = 'super_admin') then
      raise exception 'Only a Super Admin can modify wholesale pricing rules and limits.'
        using errcode = '42501';
    end if;
    new.updated_by := auth.uid();
  end if;
  new.updated_at := now();

  if tg_table_name in ('seller_pricing_permissions', 'product_wholesale_limits') then
    select max_discount_percent into v_global_max from public.wholesale_pricing_rules where id = 1;
    if v_global_max is not null and new.max_discount_percent > v_global_max then
      raise exception 'DISCOUNT_EXCEEDS_GLOBAL_LIMIT: configured discount cap (% %%) exceeds the global Super Admin limit (% %%).',
        new.max_discount_percent, v_global_max
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_stamp_wholesale_pricing_rules on public.wholesale_pricing_rules;
create trigger trg_stamp_wholesale_pricing_rules
  before insert or update on public.wholesale_pricing_rules
  for each row execute function public.stamp_wholesale_rule_editor();

drop trigger if exists trg_stamp_seller_pricing_permissions on public.seller_pricing_permissions;
create trigger trg_stamp_seller_pricing_permissions
  before insert or update on public.seller_pricing_permissions
  for each row execute function public.stamp_wholesale_rule_editor();

drop trigger if exists trg_stamp_product_wholesale_limits on public.product_wholesale_limits;
create trigger trg_stamp_product_wholesale_limits
  before insert or update on public.product_wholesale_limits
  for each row execute function public.stamp_wholesale_rule_editor();

drop trigger if exists trg_audit_wholesale_pricing_rules on public.wholesale_pricing_rules;
create trigger trg_audit_wholesale_pricing_rules
  after insert or update or delete on public.wholesale_pricing_rules
  for each row execute function public.log_phase3_governance_audit();

drop trigger if exists trg_audit_seller_pricing_permissions on public.seller_pricing_permissions;
create trigger trg_audit_seller_pricing_permissions
  after insert or update or delete on public.seller_pricing_permissions
  for each row execute function public.log_phase3_governance_audit();

drop trigger if exists trg_audit_product_wholesale_limits on public.product_wholesale_limits;
create trigger trg_audit_product_wholesale_limits
  after insert or update or delete on public.product_wholesale_limits
  for each row execute function public.log_phase3_governance_audit();

-- Server-side enforcement: sellers cannot bypass Super Admin MOQ or discount limits.
create or replace function public.enforce_seller_offer_wholesale_limits()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_global public.wholesale_pricing_rules%rowtype;
  v_seller_perm public.seller_pricing_permissions%rowtype;
  v_pack_limit public.product_wholesale_limits%rowtype;
  v_has_seller_perm boolean := false;
  v_has_pack_limit boolean := false;
  v_effective_min_moq integer := 1;
  v_effective_max_discount numeric(5, 2) := 25.00;
  v_pack_base_paise bigint;
  v_discount_pct numeric(7, 2);
begin
  select * into v_global from public.wholesale_pricing_rules where id = 1;
  if found then
    v_effective_min_moq := greatest(1, v_global.default_min_order_qty);
    v_effective_max_discount := v_global.max_discount_percent;
  end if;

  select * into v_seller_perm from public.seller_pricing_permissions where seller_id = new.seller_id;
  v_has_seller_perm := found;
  if v_has_seller_perm then
    if v_seller_perm.min_moq_override is not null then
      v_effective_min_moq := greatest(v_effective_min_moq, v_seller_perm.min_moq_override);
    end if;
    if not v_seller_perm.can_apply_discounts then
      v_effective_max_discount := 0.00;
    else
      v_effective_max_discount := least(v_effective_max_discount, v_seller_perm.max_discount_percent);
    end if;
  end if;

  select * into v_pack_limit from public.product_wholesale_limits where pack_id = new.pack_id;
  v_has_pack_limit := found;
  if v_has_pack_limit then
    v_effective_min_moq := greatest(v_effective_min_moq, v_pack_limit.min_order_qty);
    v_effective_max_discount := least(v_effective_max_discount, v_pack_limit.max_discount_percent);
  end if;

  if new.moq < v_effective_min_moq then
    raise exception 'MOQ_BELOW_SUPER_ADMIN_MINIMUM: minimum order quantity for this offer is % pieces.', v_effective_min_moq
      using errcode = '23514';
  end if;

  -- Check base discount relative to pack base price using exact rational comparison
  -- so sub-basis-point rounding never allows off-by-one paise bypasses.
  select round(base_price * 100)::bigint into v_pack_base_paise
    from public.product_packs
   where id = new.pack_id;

  if v_pack_base_paise is not null and v_pack_base_paise > 0 and new.unit_price_paise < v_pack_base_paise then
    if ((v_pack_base_paise - new.unit_price_paise)::numeric * 100.0)
       > (v_pack_base_paise::numeric * v_effective_max_discount) then
      v_discount_pct := round(((v_pack_base_paise - new.unit_price_paise)::numeric * 100.0) / v_pack_base_paise::numeric, 2);
      raise exception 'DISCOUNT_EXCEEDS_MAX_LIMIT: offer discount (% %%) exceeds Super Admin limit (% %%).',
        v_discount_pct, v_effective_max_discount
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_seller_offer_wholesale_limits on public.seller_offers;
create trigger trg_enforce_seller_offer_wholesale_limits
  after insert or update of unit_price_paise, moq, pack_id on public.seller_offers
  for each row execute function public.enforce_seller_offer_wholesale_limits();

create or replace function public.enforce_seller_tier_wholesale_limits()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_offer public.seller_offers%rowtype;
  v_global public.wholesale_pricing_rules%rowtype;
  v_seller_perm public.seller_pricing_permissions%rowtype;
  v_pack_limit public.product_wholesale_limits%rowtype;
  v_allow_slabs boolean := true;
  v_effective_max_discount numeric(5, 2) := 25.00;
  v_effective_min_moq integer := 1;
  v_pack_base_paise bigint;
  v_discount_pct numeric(7, 2);
begin
  select * into v_offer from public.seller_offers where id = new.seller_offer_id;
  if not found then
    return new;
  end if;

  select * into v_global from public.wholesale_pricing_rules where id = 1;
  if found then
    v_allow_slabs := v_allow_slabs and v_global.allow_seller_custom_slabs;
    v_effective_max_discount := v_global.max_discount_percent;
    v_effective_min_moq := greatest(v_effective_min_moq, v_global.default_min_order_qty);
  end if;

  select * into v_seller_perm from public.seller_pricing_permissions where seller_id = v_offer.seller_id;
  if found then
    v_allow_slabs := v_allow_slabs and v_seller_perm.can_set_custom_slabs;
    if v_seller_perm.min_moq_override is not null then
      v_effective_min_moq := greatest(v_effective_min_moq, v_seller_perm.min_moq_override);
    end if;
    if not v_seller_perm.can_apply_discounts then
      v_effective_max_discount := 0.00;
    else
      v_effective_max_discount := least(v_effective_max_discount, v_seller_perm.max_discount_percent);
    end if;
  end if;

  select * into v_pack_limit from public.product_wholesale_limits where pack_id = v_offer.pack_id;
  if found then
    v_allow_slabs := v_allow_slabs and v_pack_limit.allow_seller_slabs;
    v_effective_min_moq := greatest(v_effective_min_moq, v_pack_limit.min_order_qty);
    v_effective_max_discount := least(v_effective_max_discount, v_pack_limit.max_discount_percent);
  end if;

  if not v_allow_slabs then
    raise exception 'SELLER_CUSTOM_SLABS_NOT_ALLOWED: Super Admin pricing rules disable custom wholesale slabs for this seller or pack.'
      using errcode = '42501';
  end if;

  if new.min_quantity < greatest(v_offer.moq, v_effective_min_moq) then
    raise exception 'MOQ_BELOW_SUPER_ADMIN_MINIMUM: slab quantity must be at least % pieces.',
      greatest(v_offer.moq, v_effective_min_moq)
      using errcode = '23514';
  end if;

  -- Check slab discount relative to the seller offer base price (exact comparison)
  if v_offer.unit_price_paise > 0 and new.unit_price_paise < v_offer.unit_price_paise then
    if ((v_offer.unit_price_paise - new.unit_price_paise)::numeric * 100.0)
       > (v_offer.unit_price_paise::numeric * v_effective_max_discount) then
      v_discount_pct := round(((v_offer.unit_price_paise - new.unit_price_paise)::numeric * 100.0) / v_offer.unit_price_paise::numeric, 2);
      raise exception 'DISCOUNT_EXCEEDS_MAX_LIMIT: slab discount (% %%) exceeds Super Admin limit (% %%).',
        v_discount_pct, v_effective_max_discount
        using errcode = '23514';
    end if;
  end if;

  -- Also enforce total effective discount relative to pack base price to block
  -- compounded discount stacking (offer discount + slab discount exceeding cap).
  select round(base_price * 100)::bigint into v_pack_base_paise
    from public.product_packs
   where id = v_offer.pack_id;

  if v_pack_base_paise is not null and v_pack_base_paise > 0 and new.unit_price_paise < v_pack_base_paise then
    if ((v_pack_base_paise - new.unit_price_paise)::numeric * 100.0)
       > (v_pack_base_paise::numeric * v_effective_max_discount) then
      v_discount_pct := round(((v_pack_base_paise - new.unit_price_paise)::numeric * 100.0) / v_pack_base_paise::numeric, 2);
      raise exception 'DISCOUNT_EXCEEDS_MAX_LIMIT: combined offer and slab discount (% %%) relative to pack base price exceeds Super Admin limit (% %%).',
        v_discount_pct, v_effective_max_discount
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_seller_tier_wholesale_limits on public.seller_offer_tiers;
create trigger trg_enforce_seller_tier_wholesale_limits
  after insert or update on public.seller_offer_tiers
  for each row execute function public.enforce_seller_tier_wholesale_limits();

create or replace function public.enforce_product_tier_wholesale_limits()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pack_base numeric(12, 2);
  v_global public.wholesale_pricing_rules%rowtype;
  v_pack_limit public.product_wholesale_limits%rowtype;
  v_effective_max_discount numeric(5, 2) := 25.00;
  v_discount_pct numeric(7, 2);
begin
  if not new.is_active then
    return new;
  end if;

  select base_price into v_pack_base from public.product_packs where id = new.product_pack_id;
  select * into v_global from public.wholesale_pricing_rules where id = 1;
  if found then
    v_effective_max_discount := v_global.max_discount_percent;
  end if;

  select * into v_pack_limit from public.product_wholesale_limits where pack_id = new.product_pack_id;
  if found then
    v_effective_max_discount := least(v_effective_max_discount, v_pack_limit.max_discount_percent);
    if new.min_quantity < v_pack_limit.min_order_qty then
      raise exception 'MOQ_BELOW_SUPER_ADMIN_MINIMUM: slab quantity must be at least % pieces.', v_pack_limit.min_order_qty
        using errcode = '23514';
    end if;
  end if;

  if v_pack_base is not null and v_pack_base > 0 and new.price_per_piece < v_pack_base then
    if ((v_pack_base - new.price_per_piece) * 100.0) > (v_pack_base * v_effective_max_discount) then
      v_discount_pct := round(((v_pack_base - new.price_per_piece) * 100.0) / v_pack_base, 2);
      raise exception 'DISCOUNT_EXCEEDS_MAX_LIMIT: slab discount (% %%) exceeds Super Admin limit (% %%).',
        v_discount_pct, v_effective_max_discount
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_product_tier_wholesale_limits on public.product_pricing_tiers;
create trigger trg_enforce_product_tier_wholesale_limits
  after insert or update on public.product_pricing_tiers
  for each row execute function public.enforce_product_tier_wholesale_limits();

alter table public.wholesale_pricing_rules enable row level security;
alter table public.seller_pricing_permissions enable row level security;
alter table public.product_wholesale_limits enable row level security;

revoke all on public.wholesale_pricing_rules from public, anon, authenticated;
revoke all on public.seller_pricing_permissions from public, anon, authenticated;
revoke all on public.product_wholesale_limits from public, anon, authenticated;

grant select, insert, update on public.wholesale_pricing_rules to authenticated;
grant select, insert, update, delete on public.seller_pricing_permissions to authenticated;
grant select, insert, update, delete on public.product_wholesale_limits to authenticated;

drop policy if exists "wpr_select" on public.wholesale_pricing_rules;
create policy "wpr_select" on public.wholesale_pricing_rules
  for select to authenticated using (public.is_admin_or_above());
drop policy if exists "wpr_super_admin_write" on public.wholesale_pricing_rules;
create policy "wpr_super_admin_write" on public.wholesale_pricing_rules
  for all to authenticated using ((public.current_user_role() = 'super_admin')) with check ((public.current_user_role() = 'super_admin'));

drop policy if exists "spp_select" on public.seller_pricing_permissions;
create policy "spp_select" on public.seller_pricing_permissions
  for select to authenticated using (public.is_admin_or_above() or public.is_active_seller_member(seller_id));
drop policy if exists "spp_super_admin_write" on public.seller_pricing_permissions;
create policy "spp_super_admin_write" on public.seller_pricing_permissions
  for all to authenticated using ((public.current_user_role() = 'super_admin')) with check ((public.current_user_role() = 'super_admin'));

drop policy if exists "pwl_select" on public.product_wholesale_limits;
create policy "pwl_select" on public.product_wholesale_limits
  for select to authenticated using (public.is_admin_or_above());
drop policy if exists "pwl_super_admin_write" on public.product_wholesale_limits;
create policy "pwl_super_admin_write" on public.product_wholesale_limits
  for all to authenticated using ((public.current_user_role() = 'super_admin')) with check ((public.current_user_role() = 'super_admin'));

-- ---------------------------------------------------------------------------
-- 3. Owner-Gated Retailer Membership Management (Free / Silver / Gold)
--    NOTE: Preserves 0083 retirement (all plans stay is_active = false,
--    admin_set_retailer_membership stays revoked, live payment = false).
-- ---------------------------------------------------------------------------
alter table public.membership_plans
  add column if not exists product_discount_percent numeric(5, 2) not null default 0.00,
  add column if not exists order_value_discount_percent numeric(5, 2) not null default 0.00,
  add column if not exists min_order_value_paise bigint not null default 0,
  add column if not exists max_discount_paise bigint not null default 500000,
  add column if not exists eligibility_rules jsonb not null default '{"requireApprovedRetailer": true, "allowedCategories": ["general", "silver", "gold"]}'::jsonb,
  add column if not exists expiry_behavior text not null default 'immediate_stop',
  add column if not exists grace_period_days integer not null default 0,
  add column if not exists renewal_mode text not null default 'manual_owner_approval';

alter table public.membership_plans
  drop constraint if exists membership_plans_product_discount_check;
alter table public.membership_plans
  add constraint membership_plans_product_discount_check
  check (product_discount_percent >= 0 and product_discount_percent <= 50);

alter table public.membership_plans
  drop constraint if exists membership_plans_order_discount_check;
alter table public.membership_plans
  add constraint membership_plans_order_discount_check
  check (order_value_discount_percent >= 0 and order_value_discount_percent <= 50);

alter table public.membership_plans
  drop constraint if exists membership_plans_min_order_value_check;
alter table public.membership_plans
  add constraint membership_plans_min_order_value_check
  check (min_order_value_paise >= 0 and max_discount_paise >= 0);

alter table public.membership_plans
  drop constraint if exists membership_plans_eligibility_object_check;
alter table public.membership_plans
  add constraint membership_plans_eligibility_object_check
  check (jsonb_typeof(eligibility_rules) = 'object');

alter table public.membership_plans
  drop constraint if exists membership_plans_expiry_behavior_check;
alter table public.membership_plans
  add constraint membership_plans_expiry_behavior_check
  check (expiry_behavior = 'immediate_stop' and grace_period_days = 0);

alter table public.membership_plans
  drop constraint if exists membership_plans_renewal_mode_check;
alter table public.membership_plans
  add constraint membership_plans_renewal_mode_check
  check (renewal_mode in ('disabled', 'manual_owner_approval'));

-- Populate planned order_value_discount_percent from baseline discount_percent without activating any plan.
update public.membership_plans
   set order_value_discount_percent = discount_percent
 where order_value_discount_percent = 0 and discount_percent > 0;

create table if not exists public.membership_program_settings (
  id smallint primary key default 1 check (id = 1),
  program_enabled boolean not null default false,
  live_payment_collection_enabled boolean not null default false check (live_payment_collection_enabled = false),
  owner_approval_reference text check (owner_approval_reference is null or char_length(btrim(owner_approval_reference)) between 3 and 200),
  notes text check (notes is null or char_length(btrim(notes)) <= 1000),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  constraint membership_program_approval_required check (not program_enabled or owner_approval_reference is not null)
);

comment on table public.membership_program_settings is
  'Owner launch gate for retailer membership plans. Remains disabled until explicit owner approval; live payment collection is disabled.';

insert into public.membership_program_settings (id, program_enabled, live_payment_collection_enabled, notes)
values (1, false, false, 'Membership activation requires explicit owner approval. Live payment collection is disabled.')
on conflict (id) do nothing;

-- Tighten membership_plans writes to Super Admin only and enforce owner launch gate on activation.
drop policy if exists "membership_plans_admin_insert" on public.membership_plans;
create policy "membership_plans_admin_insert" on public.membership_plans
  for insert to authenticated with check ((public.current_user_role() = 'super_admin'));

drop policy if exists "membership_plans_admin_update" on public.membership_plans;
create policy "membership_plans_admin_update" on public.membership_plans
  for update to authenticated using ((public.current_user_role() = 'super_admin')) with check ((public.current_user_role() = 'super_admin'));

create or replace function public.guard_membership_plan_changes()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_enabled boolean := false;
begin
  if new.is_active then
    select program_enabled into v_enabled from public.membership_program_settings where id = 1;
    if not coalesce(v_enabled, false) then
      raise exception 'MEMBERSHIP_PROGRAM_DISABLED: Plans cannot be activated while the membership program is disabled pending owner approval.'
        using errcode = '23514';
    end if;
  end if;
  if new.expiry_behavior is distinct from 'immediate_stop' or new.grace_period_days is distinct from 0 then
    raise exception 'MEMBERSHIP_EXPIRY_IMMEDIATE_ONLY: Membership benefits must stop immediately upon expiry (grace_period_days = 0).'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_membership_plan_changes on public.membership_plans;
create trigger trg_guard_membership_plan_changes
  after insert or update on public.membership_plans
  for each row execute function public.guard_membership_plan_changes();

drop trigger if exists trg_audit_membership_plans on public.membership_plans;
create trigger trg_audit_membership_plans
  after insert or update or delete on public.membership_plans
  for each row execute function public.log_phase3_governance_audit();

alter table public.membership_program_settings enable row level security;
revoke all on public.membership_program_settings from public, anon, authenticated;
grant select, insert, update on public.membership_program_settings to authenticated;

drop policy if exists "mps_select" on public.membership_program_settings;
create policy "mps_select" on public.membership_program_settings
  for select to authenticated using (true);
drop policy if exists "mps_super_admin_write" on public.membership_program_settings;
create policy "mps_super_admin_write" on public.membership_program_settings
  for all to authenticated using ((public.current_user_role() = 'super_admin')) with check ((public.current_user_role() = 'super_admin'));

drop trigger if exists trg_audit_membership_program_settings on public.membership_program_settings;
create trigger trg_audit_membership_program_settings
  after insert or update or delete on public.membership_program_settings
  for each row execute function public.log_phase3_governance_audit();

-- Controlled non-payment membership upgrade request queue.
create table if not exists public.membership_upgrade_requests (
  id uuid primary key default uuid_generate_v4(),
  retailer_id uuid not null references public.retailers(id) on delete cascade,
  requested_plan_id text not null references public.membership_plans(id),
  status text not null default 'pending_review'
    check (status in ('pending_review', 'approved_pending_launch', 'rejected', 'cancelled')),
  notes text check (notes is null or char_length(btrim(notes)) <= 500),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text check (review_note is null or char_length(btrim(review_note)) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_mur_retailer on public.membership_upgrade_requests (retailer_id, created_at desc);
create index if not exists idx_mur_status on public.membership_upgrade_requests (status, created_at desc);

create or replace function public.enforce_membership_upgrade_request()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_enabled boolean := false;
begin
  select program_enabled into v_enabled from public.membership_program_settings where id = 1;

  if tg_op = 'INSERT' then
    if not coalesce(v_enabled, false) and not (public.current_user_role() = 'super_admin') then
      raise exception 'MEMBERSHIP_PROGRAM_DISABLED: Membership upgrade requests are disabled pending owner approval.'
        using errcode = '23514';
    end if;
    if not (public.current_user_role() = 'super_admin') then
      if new.retailer_id is distinct from auth.uid() then
        raise exception 'Cannot submit a membership request for another retailer.' using errcode = '42501';
      end if;
      if new.status <> 'pending_review' or new.reviewed_by is not null or new.reviewed_at is not null then
        raise exception 'Retailer upgrade requests must start in pending_review.' using errcode = '42501';
      end if;
    end if;
  elsif tg_op = 'UPDATE' then
    if not (public.current_user_role() = 'super_admin') then
      if old.retailer_id is distinct from auth.uid() or new.retailer_id is distinct from old.retailer_id then
        raise exception 'Access denied on membership request.' using errcode = '42501';
      end if;
      if not (old.status = 'pending_review' and new.status = 'cancelled') then
        raise exception 'Retailers can only cancel their own pending upgrade requests.' using errcode = '42501';
      end if;
      new.reviewed_by := old.reviewed_by;
      new.reviewed_at := old.reviewed_at;
      new.review_note := old.review_note;
    else
      if new.status is distinct from old.status and new.status in ('approved_pending_launch', 'rejected') then
        if new.status = 'rejected' and (new.review_note is null or char_length(btrim(new.review_note)) < 3) then
          raise exception 'Provide a rejection reason (at least 3 characters).' using errcode = '22023';
        end if;
        new.reviewed_by := auth.uid();
        new.reviewed_at := now();
      end if;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_enforce_membership_upgrade_request on public.membership_upgrade_requests;
create trigger trg_enforce_membership_upgrade_request
  before insert or update on public.membership_upgrade_requests
  for each row execute function public.enforce_membership_upgrade_request();

drop trigger if exists trg_audit_membership_upgrade_requests on public.membership_upgrade_requests;
create trigger trg_audit_membership_upgrade_requests
  after insert or update or delete on public.membership_upgrade_requests
  for each row execute function public.log_audit();

alter table public.membership_upgrade_requests enable row level security;
revoke all on public.membership_upgrade_requests from public, anon, authenticated;
grant select, insert, update on public.membership_upgrade_requests to authenticated;

drop policy if exists "mur_select" on public.membership_upgrade_requests;
create policy "mur_select" on public.membership_upgrade_requests
  for select to authenticated using (retailer_id = auth.uid() or (public.current_user_role() = 'super_admin'));
drop policy if exists "mur_insert" on public.membership_upgrade_requests;
create policy "mur_insert" on public.membership_upgrade_requests
  for insert to authenticated with check (retailer_id = auth.uid() or (public.current_user_role() = 'super_admin'));
drop policy if exists "mur_update" on public.membership_upgrade_requests;
create policy "mur_update" on public.membership_upgrade_requests
  for update to authenticated using (retailer_id = auth.uid() or (public.current_user_role() = 'super_admin'))
  with check (retailer_id = auth.uid() or (public.current_user_role() = 'super_admin'));

-- Authoritative membership overview RPC with strict immediate expiry stop.
create or replace function public.get_retailer_membership_overview(p_retailer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_program_enabled boolean := false;
  v_latest record;
  v_is_expired boolean := false;
  v_remaining_seconds bigint := null;
  v_current jsonb;
  v_plans jsonb;
  v_history jsonb;
begin
  if auth.uid() is null or (auth.uid() <> p_retailer_id and not public.is_admin_or_above()) then
    raise exception 'Access denied: cannot read membership overview for retailer %', p_retailer_id
      using errcode = '42501';
  end if;

  select program_enabled into v_program_enabled
    from public.membership_program_settings
   where id = 1;

  select
    rm.id as membership_id,
    rm.plan_id,
    rm.tier,
    rm.status,
    rm.starts_at,
    rm.expires_at,
    mp.name as plan_name,
    mp.is_active as plan_is_active,
    mp.features,
    mp.product_discount_percent,
    mp.order_value_discount_percent,
    mp.min_order_value_paise,
    mp.max_discount_paise,
    mp.expiry_behavior,
    mp.renewal_mode
  into v_latest
  from public.retailer_memberships rm
  join public.membership_plans mp on mp.id = rm.plan_id
  where rm.retailer_id = p_retailer_id
  order by
    case when rm.status = 'active' and (rm.expires_at is null or rm.expires_at > now()) then 0 else 1 end asc,
    rm.created_at desc
  limit 1;

  if not found then
    v_current := jsonb_build_object(
      'membership_id', null,
      'plan_id', 'free',
      'plan_name', 'Free Tier',
      'tier', 'free',
      'status', 'active',
      'starts_at', null,
      'expires_at', null,
      'is_expired', false,
      'remaining_seconds', null,
      'benefits_active', true,
      'effective_product_discount_percent', 0,
      'effective_order_discount_percent', 0,
      'expiry_behavior', 'immediate_stop',
      'renewal_mode', 'manual_owner_approval',
      'features', coalesce((select features from public.membership_plans where id = 'free'), '[]'::jsonb)
    );
  else
    -- Immediate stop on expiry: if expires_at <= now() or status <> 'active',
    -- ALL paid benefits cease immediately (0% discounts, remaining_seconds = 0).
    -- Paid tier discounts also remain 0% whenever the membership program is
    -- disabled or the underlying plan is inactive.
    v_is_expired := (v_latest.status = 'expired')
      or (v_latest.expires_at is not null and v_latest.expires_at <= now());

    if v_latest.expires_at is null then
      v_remaining_seconds := null;
    elsif v_is_expired then
      v_remaining_seconds := 0;
    else
      v_remaining_seconds := greatest(0, floor(extract(epoch from (v_latest.expires_at - now())))::bigint);
    end if;

    v_current := jsonb_build_object(
      'membership_id', v_latest.membership_id,
      'plan_id', case when v_is_expired or v_latest.status <> 'active' then 'free' else v_latest.plan_id end,
      'plan_name', case when v_is_expired or v_latest.status <> 'active' then 'Free Tier (Previous plan expired)' else v_latest.plan_name end,
      'tier', case when v_is_expired or v_latest.status <> 'active' then 'free' else v_latest.tier::text end,
      'status', case when v_is_expired then 'expired' else v_latest.status::text end,
      'starts_at', v_latest.starts_at,
      'expires_at', v_latest.expires_at,
      'is_expired', v_is_expired,
      'remaining_seconds', v_remaining_seconds,
      'benefits_active', (
        v_latest.status = 'active'
        and not v_is_expired
        and (v_latest.tier = 'free' or (coalesce(v_program_enabled, false) and coalesce(v_latest.plan_is_active, false)))
      ),
      'effective_product_discount_percent', case
        when v_latest.status = 'active'
             and not v_is_expired
             and coalesce(v_program_enabled, false)
             and coalesce(v_latest.plan_is_active, false)
        then v_latest.product_discount_percent else 0 end,
      'effective_order_discount_percent', case
        when v_latest.status = 'active'
             and not v_is_expired
             and coalesce(v_program_enabled, false)
             and coalesce(v_latest.plan_is_active, false)
        then v_latest.order_value_discount_percent else 0 end,
      'expiry_behavior', v_latest.expiry_behavior,
      'renewal_mode', v_latest.renewal_mode,
      'features', case
        when v_latest.status = 'active'
             and not v_is_expired
             and (v_latest.tier = 'free' or (coalesce(v_program_enabled, false) and coalesce(v_latest.plan_is_active, false)))
        then v_latest.features
        else coalesce((select features from public.membership_plans where id = 'free'), '[]'::jsonb) end
    );
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', mp.id,
      'tier', mp.tier::text,
      'name', mp.name,
      'description', mp.description,
      'price_paise', mp.price_paise,
      'duration_days', mp.duration_days,
      'product_discount_percent', mp.product_discount_percent,
      'order_value_discount_percent', mp.order_value_discount_percent,
      'min_order_value_paise', mp.min_order_value_paise,
      'max_discount_paise', mp.max_discount_paise,
      'features', mp.features,
      'eligibility_rules', mp.eligibility_rules,
      'expiry_behavior', mp.expiry_behavior,
      'renewal_mode', mp.renewal_mode,
      'is_active', mp.is_active
    ) order by mp.price_paise asc
  ), '[]'::jsonb)
  into v_plans
  from public.membership_plans mp;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', rm.id,
      'plan_id', rm.plan_id,
      'tier', rm.tier::text,
      'status', case when rm.status = 'active' and rm.expires_at is not null and rm.expires_at <= now() then 'expired' else rm.status::text end,
      'starts_at', rm.starts_at,
      'expires_at', rm.expires_at,
      'notes', rm.notes,
      'created_at', rm.created_at
    ) order by rm.created_at desc
  ), '[]'::jsonb)
  into v_history
  from public.retailer_memberships rm
  where rm.retailer_id = p_retailer_id;

  return jsonb_build_object(
    'program_enabled', coalesce(v_program_enabled, false),
    'live_payment_collection_enabled', false,
    'current', v_current,
    'plans', v_plans,
    'history', v_history
  );
end;
$$;

revoke all on function public.get_retailer_membership_overview(uuid) from public, anon;
grant execute on function public.get_retailer_membership_overview(uuid) to authenticated;

-- Owner-gated Super Admin assignment RPC (legacy admin_set_retailer_membership remains REVOKED).
create or replace function public.super_admin_assign_membership(
  p_retailer_id uuid,
  p_plan_id text,
  p_notes text default null,
  p_payment_ref text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_program public.membership_program_settings%rowtype;
  v_plan public.membership_plans%rowtype;
  v_retailer record;
  v_require_approved boolean := true;
  v_allowed_categories text[];
  v_membership_id uuid;
  v_expires_at timestamptz;
begin
  if not (public.current_user_role() = 'super_admin') then
    raise exception 'Super Admin authorization required to assign retailer memberships.' using errcode = '42501';
  end if;

  select * into v_program from public.membership_program_settings where id = 1;
  if not found or not v_program.program_enabled or v_program.owner_approval_reference is null then
    raise exception 'MEMBERSHIP_PROGRAM_DISABLED: Owner approval is required before assigning memberships.' using errcode = '23514';
  end if;

  select * into v_plan from public.membership_plans where id = p_plan_id and is_active = true;
  if not found then
    raise exception 'Active membership plan % not found.', p_plan_id using errcode = '22023';
  end if;

  select r.id, r.status, r.retailer_category::text as retailer_category
    into v_retailer
    from public.retailers r
   where r.id = p_retailer_id;
  if not found then
    raise exception 'Retailer account % not found.', p_retailer_id using errcode = '22023';
  end if;

  if v_plan.tier <> 'free' then
    v_require_approved := coalesce((v_plan.eligibility_rules->>'requireApprovedRetailer')::boolean, true);
    if v_require_approved and v_retailer.status <> 'active' then
      raise exception 'MEMBERSHIP_ELIGIBILITY_FAILED: Retailer must be approved and active for plan %.', p_plan_id
        using errcode = '23514';
    end if;

    if jsonb_typeof(v_plan.eligibility_rules->'allowedCategories') = 'array' then
      select array_agg(elem) into v_allowed_categories
        from jsonb_array_elements_text(v_plan.eligibility_rules->'allowedCategories') elem;
      if v_allowed_categories is not null
         and array_length(v_allowed_categories, 1) > 0
         and not (v_retailer.retailer_category = any(v_allowed_categories)) then
        raise exception 'MEMBERSHIP_ELIGIBILITY_FAILED: Retailer category "%" is not eligible for plan %.',
          v_retailer.retailer_category, p_plan_id
          using errcode = '23514';
      end if;
    end if;
  end if;

  if v_plan.tier = 'free' then
    v_expires_at := null;
  else
    v_expires_at := now() + make_interval(days => v_plan.duration_days);
  end if;

  update public.retailer_memberships
     set status = 'cancelled',
         updated_at = now()
   where retailer_id = p_retailer_id
     and status = 'active';

  insert into public.retailer_memberships (
    retailer_id, plan_id, tier, status, starts_at, expires_at,
    amount_paid_paise, payment_reference, notes, activated_by
  ) values (
    p_retailer_id, v_plan.id, v_plan.tier, 'active', now(), v_expires_at,
    v_plan.price_paise, p_payment_ref, p_notes, auth.uid()
  ) returning id into v_membership_id;

  insert into public.super_admin_audit_logs (
    actor_id, target_id, action, before_data, after_data, reason
  ) values (
    auth.uid(),
    p_retailer_id,
    'MEMBERSHIP_ASSIGNED',
    null,
    jsonb_build_object('membership_id', v_membership_id, 'plan_id', v_plan.id, 'tier', v_plan.tier::text, 'expires_at', v_expires_at),
    coalesce(p_notes, 'Super Admin membership assignment')
  );

  return v_membership_id;
end;
$$;

revoke all on function public.super_admin_assign_membership(uuid, text, text, text) from public, anon;
grant execute on function public.super_admin_assign_membership(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Controlled Paid Seller Advertisement Campaigns (Owner-Gated)
-- ---------------------------------------------------------------------------
create table if not exists public.ad_program_settings (
  id smallint primary key default 1 check (id = 1),
  seller_ads_enabled boolean not null default false,
  live_payment_collection_enabled boolean not null default false check (live_payment_collection_enabled = false),
  max_active_campaigns_per_placement integer not null default 3 check (max_active_campaigns_per_placement between 1 and 20),
  allowed_placements text[] not null default array['homepage_hero', 'homepage_strip', 'category_banner', 'catalog_spotlight'],
  owner_approval_reference text check (owner_approval_reference is null or char_length(btrim(owner_approval_reference)) between 3 and 200),
  notes text check (notes is null or char_length(btrim(notes)) <= 1000),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  constraint ad_program_approval_required check (not seller_ads_enabled or owner_approval_reference is not null)
);

comment on table public.ad_program_settings is
  'Owner launch gate and placement rules for paid seller advertisement campaigns. Disabled by default; live payment collection disabled.';

insert into public.ad_program_settings (id, seller_ads_enabled, live_payment_collection_enabled, notes)
values (1, false, false, 'Paid seller advertising remains disabled pending explicit owner approval.')
on conflict (id) do nothing;

create table if not exists public.seller_ad_campaigns (
  id uuid primary key default uuid_generate_v4(),
  seller_id uuid not null references public.sellers(id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 2 and 140 and title !~ '[<>]'),
  headline text check (headline is null or (char_length(btrim(headline)) <= 240 and headline !~ '[<>]')),
  artwork_url text not null check (
    char_length(btrim(artwork_url)) between 5 and 1000
    and artwork_url not like '//%'
    and artwork_url !~ '(\.\.|\\|[[:cntrl:][:space:]<>"])'
    and (artwork_url ~ '^https://[A-Za-z0-9.-]+/' or artwork_url ~ '^/[A-Za-z0-9._-]+/')
  ),
  destination_url text check (
    destination_url is null
    or (
      char_length(btrim(destination_url)) between 9 and 500
      and destination_url ~ '^/retailer($|/|\?)'
      and destination_url !~ '(//|\.\.|\\|[[:cntrl:][:space:]<>"])'
    )
  ),
  placement text not null check (placement in ('homepage_hero', 'homepage_strip', 'category_banner', 'catalog_spotlight')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  budget_paise bigint not null default 0 check (budget_paise >= 0 and budget_paise <= 1000000000),
  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'pending_verification', 'verified_offline', 'waived', 'refunded')),
  payment_reference text check (payment_reference is null or char_length(btrim(payment_reference)) <= 160),
  approval_status text not null default 'pending_approval'
    check (approval_status in ('draft', 'pending_approval', 'approved', 'rejected', 'paused', 'ended')),
  is_active boolean not null default false,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  rejection_reason text check (rejection_reason is null or char_length(btrim(rejection_reason)) between 3 and 500),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seller_ad_campaigns_window_check check (ends_at > starts_at),
  constraint seller_ad_campaigns_active_requires_approved check (not is_active or approval_status = 'approved')
);

-- Named URL & copy safety constraints (idempotent across replays)
alter table public.seller_ad_campaigns
  drop constraint if exists seller_ad_campaigns_artwork_url_safe_check,
  add constraint seller_ad_campaigns_artwork_url_safe_check check (
    char_length(btrim(artwork_url)) between 5 and 1000
    and artwork_url not like '//%'
    and artwork_url !~ '(\.\.|\\|[[:cntrl:][:space:]<>"])'
    and (artwork_url ~ '^https://[A-Za-z0-9.-]+/' or artwork_url ~ '^/[A-Za-z0-9._-]+/')
  );

alter table public.seller_ad_campaigns
  drop constraint if exists seller_ad_campaigns_destination_internal_check,
  add constraint seller_ad_campaigns_destination_internal_check check (
    destination_url is null
    or (
      char_length(btrim(destination_url)) between 9 and 500
      and destination_url ~ '^/retailer($|/|\?)'
      and destination_url !~ '(//|\.\.|\\|[[:cntrl:][:space:]<>"])'
    )
  );

alter table public.seller_ad_campaigns
  drop constraint if exists seller_ad_campaigns_copy_no_html_check,
  add constraint seller_ad_campaigns_copy_no_html_check check (
    title !~ '[<>]' and (headline is null or headline !~ '[<>]')
  );

create index if not exists idx_sac_seller on public.seller_ad_campaigns (seller_id, approval_status);
create index if not exists idx_sac_placement_active on public.seller_ad_campaigns (placement, approval_status, is_active);

create table if not exists public.seller_ad_campaign_audit (
  id uuid primary key default uuid_generate_v4(),
  campaign_id uuid not null references public.seller_ad_campaigns(id) on delete cascade,
  seller_id uuid not null references public.sellers(id) on delete restrict,
  action text not null check (action in ('submitted', 'updated', 'approved', 'rejected', 'paused', 'ended', 'payment_updated')),
  previous_status text,
  new_status text,
  previous_payment_status text,
  new_payment_status text,
  reason text,
  acted_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_saca_campaign on public.seller_ad_campaign_audit (campaign_id, created_at desc);

drop trigger if exists trg_prevent_saca_mutation on public.seller_ad_campaign_audit;
create trigger trg_prevent_saca_mutation
  before update or delete on public.seller_ad_campaign_audit
  for each row execute function public.prevent_append_only_audit_mutation();

create or replace function public.enforce_seller_ad_campaign_rules()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_settings public.ad_program_settings%rowtype;
  v_is_super boolean := (public.current_user_role() = 'super_admin');
  v_active_count integer := 0;
begin
  select * into v_settings from public.ad_program_settings where id = 1;

  if not (new.placement = any(coalesce(v_settings.allowed_placements, array['homepage_hero','homepage_strip','category_banner','catalog_spotlight']))) then
    raise exception 'AD_PLACEMENT_NOT_ALLOWED: placement "%" is not enabled.', new.placement
      using errcode = '23514';
  end if;

  -- Inside a SECURITY DEFINER trigger, `current_user` is the function owner,
  -- NOT the caller role. Check session role + auth.uid() so non-Super Admin
  -- API callers can NEVER enter the Super Admin / DB-owner branch.
  if (current_setting('role', true) in ('authenticated', 'anon') or auth.uid() is not null)
     and not v_is_super then
    if not public.is_active_seller_member(new.seller_id) then
      raise exception 'Only an active seller member or Super Admin can manage this campaign.'
        using errcode = '42501';
    end if;

    if tg_op = 'INSERT' then
      if new.approval_status not in ('draft', 'pending_approval')
         or new.is_active
         or new.payment_status <> 'unpaid'
         or new.payment_reference is not null
         or new.reviewed_by is not null
         or new.reviewed_at is not null
         or new.rejection_reason is not null then
        raise exception 'Sellers can only submit unapproved draft/pending campaigns with unpaid status.'
          using errcode = '42501';
      end if;
      new.created_by := auth.uid();
    elsif tg_op = 'UPDATE' then
      if new.seller_id is distinct from old.seller_id
         or new.created_by is distinct from old.created_by then
        raise exception 'Campaign ownership cannot be transferred.' using errcode = '42501';
      end if;
      if new.payment_status is distinct from old.payment_status
         or new.payment_reference is distinct from old.payment_reference
         or new.reviewed_by is distinct from old.reviewed_by
         or new.reviewed_at is distinct from old.reviewed_at
         or new.rejection_reason is distinct from old.rejection_reason then
        raise exception 'Only a Super Admin can update campaign review or payment tracking fields.'
          using errcode = '42501';
      end if;
      if new.is_active then
        raise exception 'Sellers cannot activate advertisement campaigns.' using errcode = '42501';
      end if;
      if new.approval_status in ('approved', 'rejected') and new.approval_status is distinct from old.approval_status then
        raise exception 'Sellers cannot self-approve or reject campaigns.' using errcode = '42501';
      end if;
      if old.approval_status = 'approved' and new.approval_status <> 'paused' then
        raise exception 'Approved campaigns can only be paused by the seller or updated by a Super Admin.'
          using errcode = '42501';
      end if;
      if old.approval_status = 'rejected' and new.approval_status = 'rejected' then
        new.approval_status := 'pending_approval';
      end if;
    end if;
  else
    -- Super Admin or DB owner path.
    if (new.approval_status = 'approved' or new.is_active) and not coalesce(v_settings.seller_ads_enabled, false) then
      raise exception 'SELLER_ADS_DISABLED: Paid seller advertisements remain disabled pending owner approval.'
        using errcode = '23514';
    end if;

    if new.approval_status = 'rejected'
       and (new.rejection_reason is null or char_length(btrim(new.rejection_reason)) < 3) then
      raise exception 'Provide a rejection reason (at least 3 characters).' using errcode = '22023';
    end if;

    if tg_op = 'UPDATE' and new.approval_status is distinct from old.approval_status
       and new.approval_status in ('approved', 'rejected', 'paused', 'ended') then
      new.reviewed_by := coalesce(auth.uid(), new.reviewed_by);
      new.reviewed_at := now();
      if new.approval_status in ('rejected', 'paused', 'ended') then
        new.is_active := false;
      end if;
    end if;

    if new.is_active then
      select count(*) into v_active_count
        from public.seller_ad_campaigns c
       where c.placement = new.placement
         and c.is_active = true
         and c.approval_status = 'approved'
         and c.id is distinct from new.id;
      if v_active_count >= coalesce(v_settings.max_active_campaigns_per_placement, 3) then
        raise exception 'AD_PLACEMENT_CAP_EXCEEDED: placement "%" already has the maximum active campaigns.', new.placement
          using errcode = '23514';
      end if;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_enforce_seller_ad_campaign_rules on public.seller_ad_campaigns;
create trigger trg_enforce_seller_ad_campaign_rules
  before insert or update on public.seller_ad_campaigns
  for each row execute function public.enforce_seller_ad_campaign_rules();

create or replace function public.log_seller_ad_campaign_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_action text;
begin
  if tg_op = 'INSERT' then
    v_action := 'submitted';
    insert into public.seller_ad_campaign_audit (
      campaign_id, seller_id, action, previous_status, new_status,
      previous_payment_status, new_payment_status, reason, acted_by
    ) values (
      new.id, new.seller_id, v_action, null, new.approval_status,
      null, new.payment_status, null, coalesce(auth.uid(), new.created_by)
    );
  elsif tg_op = 'UPDATE' then
    if new.approval_status is distinct from old.approval_status then
      v_action := case new.approval_status
        when 'approved' then 'approved'
        when 'rejected' then 'rejected'
        when 'paused' then 'paused'
        when 'ended' then 'ended'
        else 'updated'
      end;
    elsif new.payment_status is distinct from old.payment_status then
      v_action := 'payment_updated';
    else
      v_action := 'updated';
    end if;
    insert into public.seller_ad_campaign_audit (
      campaign_id, seller_id, action, previous_status, new_status,
      previous_payment_status, new_payment_status, reason, acted_by
    ) values (
      new.id, new.seller_id, v_action, old.approval_status, new.approval_status,
      old.payment_status, new.payment_status, new.rejection_reason, auth.uid()
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_log_seller_ad_campaign_audit on public.seller_ad_campaigns;
create trigger trg_log_seller_ad_campaign_audit
  after insert or update on public.seller_ad_campaigns
  for each row execute function public.log_seller_ad_campaign_audit();

alter table public.ad_program_settings enable row level security;
alter table public.seller_ad_campaigns enable row level security;
alter table public.seller_ad_campaign_audit enable row level security;

revoke all on public.ad_program_settings from public, anon, authenticated;
revoke all on public.seller_ad_campaigns from public, anon, authenticated;
revoke all on public.seller_ad_campaign_audit from public, anon, authenticated;

grant select, insert, update on public.ad_program_settings to authenticated;
grant select, insert, update on public.seller_ad_campaigns to authenticated;
grant select on public.seller_ad_campaign_audit to authenticated;

drop policy if exists "aps_select" on public.ad_program_settings;
create policy "aps_select" on public.ad_program_settings
  for select to authenticated
  using (public.is_admin_or_above() or public.current_user_role() = 'seller');

drop policy if exists "aps_super_admin_write" on public.ad_program_settings;
create policy "aps_super_admin_write" on public.ad_program_settings
  for all to authenticated using ((public.current_user_role() = 'super_admin')) with check ((public.current_user_role() = 'super_admin'));

drop policy if exists "sac_select" on public.seller_ad_campaigns;
create policy "sac_select" on public.seller_ad_campaigns
  for select to authenticated
  using (
    public.is_admin_or_above()
    or public.is_active_seller_member(seller_id)
    or (
      approval_status = 'approved'
      and is_active = true
      and starts_at <= now()
      and ends_at > now()
      and exists (
        select 1 from public.ad_program_settings aps
         where aps.id = 1 and aps.seller_ads_enabled = true
      )
    )
  );

drop policy if exists "sac_insert" on public.seller_ad_campaigns;
create policy "sac_insert" on public.seller_ad_campaigns
  for insert to authenticated
  with check ((public.current_user_role() = 'super_admin') or public.is_active_seller_member(seller_id));

drop policy if exists "sac_update" on public.seller_ad_campaigns;
create policy "sac_update" on public.seller_ad_campaigns
  for update to authenticated
  using ((public.current_user_role() = 'super_admin') or public.is_active_seller_member(seller_id))
  with check ((public.current_user_role() = 'super_admin') or public.is_active_seller_member(seller_id));

drop policy if exists "saca_select" on public.seller_ad_campaign_audit;
create policy "saca_select" on public.seller_ad_campaign_audit
  for select to authenticated
  using ((public.current_user_role() = 'super_admin') or public.is_active_seller_member(seller_id));

drop trigger if exists trg_audit_ad_program_settings on public.ad_program_settings;
create trigger trg_audit_ad_program_settings
  after insert or update or delete on public.ad_program_settings
  for each row execute function public.log_phase3_governance_audit();

-- ---------------------------------------------------------------------------
-- 5. Audit Integrity Hardening (super_admin_audit_logs & banners)
-- ---------------------------------------------------------------------------
revoke all on public.super_admin_audit_logs from public, anon;
revoke update, delete on public.super_admin_audit_logs from authenticated;

-- Non-SECURITY DEFINER so API role attribution cannot be forged.
create or replace function public.guard_super_admin_audit_insert()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if auth.uid() is null or not (public.current_user_role() = 'super_admin') then
      raise exception 'Only an authenticated Super Admin can write Super Admin audit logs.'
        using errcode = '42501';
    end if;
    if new.actor_id is distinct from auth.uid() then
      raise exception 'Audit actor_id must match the signed-in Super Admin.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_super_admin_audit_insert on public.super_admin_audit_logs;
create trigger trg_guard_super_admin_audit_insert
  before insert on public.super_admin_audit_logs
  for each row execute function public.guard_super_admin_audit_insert();

drop trigger if exists trg_prevent_sa_audit_mutation on public.super_admin_audit_logs;
create trigger trg_prevent_sa_audit_mutation
  before update or delete on public.super_admin_audit_logs
  for each row execute function public.prevent_append_only_audit_mutation();

drop trigger if exists trg_audit_banners on public.banners;
create trigger trg_audit_banners
  after insert or update or delete on public.banners
  for each row execute function public.log_audit();

-- ---------------------------------------------------------------------------
-- 6. Function-by-Function Security Hardening (Audited & Individually Justified)
-- ---------------------------------------------------------------------------

-- 6.1 Revoke unnecessary PUBLIC / anon / authenticated EXECUTE on all 13
--     internal trigger functions introduced by migration 0109. Triggers invoke
--     their handler directly regardless of caller EXECUTE privilege.
revoke all on function public.stamp_product_moderation_actor() from public, anon, authenticated;
revoke all on function public.prevent_append_only_audit_mutation() from public, anon, authenticated;
revoke all on function public.log_phase3_governance_audit() from public, anon, authenticated;
revoke all on function public.log_seller_offer_moderation_event() from public, anon, authenticated;
revoke all on function public.stamp_wholesale_rule_editor() from public, anon, authenticated;
revoke all on function public.enforce_seller_offer_wholesale_limits() from public, anon, authenticated;
revoke all on function public.enforce_seller_tier_wholesale_limits() from public, anon, authenticated;
revoke all on function public.enforce_product_tier_wholesale_limits() from public, anon, authenticated;
revoke all on function public.guard_membership_plan_changes() from public, anon, authenticated;
revoke all on function public.enforce_membership_upgrade_request() from public, anon, authenticated;
revoke all on function public.enforce_seller_ad_campaign_rules() from public, anon, authenticated;
revoke all on function public.log_seller_ad_campaign_audit() from public, anon, authenticated;
revoke all on function public.guard_super_admin_audit_insert() from public, anon, authenticated;

-- 6.2 Harden can_current_staff_read_profile(uuid) (0037) with a caller-role
--     guard so anon / retailer / seller / salesman callers can NEVER probe
--     whether an arbitrary UUID belongs to super_admin / admin / staff / salesman
--     via direct PostgREST RPC. Keeps EXECUTE compatible with PUBLIC RLS policy
--     evaluation on `profiles` (returns FALSE cleanly instead of 42501).
create or replace function public.can_current_staff_read_profile(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select p_profile_id is not null
    and public.is_staff_or_above()
    and exists (
      select 1
        from public.profiles p
       where p.id = p_profile_id
         and (
           p.role in ('super_admin', 'admin', 'staff', 'salesman')
           or public.is_retailer_area_assigned_to_current_staff(p.id)
         )
    );
$$;

-- 6.3 Harden submit_supplier_application(...) (0059) with durable DB-level
--     rate limiting backed by 0060's `supplier_application_rate_limits` so
--     direct PostgREST calls cannot bypass the Next.js server action limiter
--     and flood `public.suppliers`. Keeps the exact 11-parameter signature,
--     `search_path = public, pg_temp`, and anon/authenticated EXECUTE contract
--     (no PUBLIC execute).
create or replace function public.submit_supplier_application(
  p_business_name text,
  p_legal_name text,
  p_contact_name text,
  p_phone text,
  p_email text,
  p_address_line text,
  p_city text,
  p_state text,
  p_pincode text,
  p_gstin text,
  p_product_categories text
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_phone text := btrim(coalesce(p_phone, ''));
  v_phone_hash text;
  v_burst_hash text;
  v_phone_limit jsonb;
  v_burst_limit jsonb;
begin
  -- Enforce DB-level anti-abuse rate limits for direct API callers (anon /
  -- authenticated) using SHA-256 hashes (never storing raw phone numbers).
  if current_setting('role', true) in ('anon', 'authenticated') then
    v_phone_hash := encode(pg_catalog.sha256(convert_to('supplier-rpc-phone:' || v_phone, 'UTF8')), 'hex');
    v_phone_limit := public.consume_supplier_application_rate_limit(
      v_phone_hash,
      'supplier-rpc-phone',
      5,
      600
    );
    if not coalesce((v_phone_limit->>'allowed')::boolean, false) then
      raise exception 'SUPPLIER_RATE_LIMITED: Too many applications submitted for this phone number. Please try again later.'
        using errcode = 'P0001';
    end if;

    v_burst_hash := encode(pg_catalog.sha256(convert_to('supplier-rpc-burst:global', 'UTF8')), 'hex');
    v_burst_limit := public.consume_supplier_application_rate_limit(
      v_burst_hash,
      'supplier-rpc-burst',
      30,
      600
    );
    if not coalesce((v_burst_limit->>'allowed')::boolean, false) then
      raise exception 'SUPPLIER_RATE_LIMITED: Supplier application submission rate limit reached. Please try again shortly.'
        using errcode = 'P0001';
    end if;
  end if;

  insert into public.suppliers (
    business_name, legal_name, contact_name, phone, email,
    address_line, city, state, pincode, gstin, product_categories, status
  ) values (
    btrim(p_business_name),
    nullif(btrim(coalesce(p_legal_name, '')), ''),
    btrim(p_contact_name),
    v_phone,
    nullif(lower(btrim(coalesce(p_email, ''))), ''),
    nullif(btrim(coalesce(p_address_line, '')), ''),
    nullif(btrim(coalesce(p_city, '')), ''),
    nullif(btrim(coalesce(p_state, '')), ''),
    nullif(btrim(coalesce(p_pincode, '')), ''),
    nullif(upper(btrim(coalesce(p_gstin, ''))), ''),
    nullif(btrim(coalesce(p_product_categories, '')), ''),
    'pending'
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.submit_supplier_application(text, text, text, text, text, text, text, text, text, text, text) from public;
grant execute on function public.submit_supplier_application(text, text, text, text, text, text, text, text, text, text, text) to anon, authenticated;

-- ============================================================================
-- END OF MIGRATION 0109
-- ============================================================================
