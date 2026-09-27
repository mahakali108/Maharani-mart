-- ============================================================================
-- 0052 — PHASE 0 EMERGENCY SECURITY HARDENING
-- ============================================================================
-- Closes the privilege-escalation and protected-data gaps confirmed by the
-- read-only production audit (docs: FULL_PRODUCTION_AUDIT, SEC-1/2/5/6/8/10/
-- 11/12). Schema/policy/function changes ONLY — no existing row is updated,
-- deleted or demoted. Every statement is re-runnable (drop-if-exists /
-- create-or-replace / if-not-exists).
--
--   P0-1  SEC-1  handle_new_user() no longer reads the role from
--                raw_user_meta_data (client-controlled via signUp()/updateUser()).
--                Self-signup is always 'retailer'; staff/salesman accounts are
--                pre-authorised server-side through staff_account_invites.
--         SEC-2  profiles: role / is_active / id / created_at can only be
--                changed by a Super Admin (or server-side/service code).
--   P0-2  SEC-5  retailers_self_insert dropped (the signup trigger is the only
--                creation path) and signup rejects a missing/invalid/inactive
--                area instead of silently skipping the retailers row.
--   P0-3  SEC-6  price / GST / HSN / SKU / cost / pack-size columns, pricing
--                tiers, coupons and schemes are writable by Admin+ only.
--   P0-4  SEC-8  notification_logs readable by the recipient or Admin+ only
--                (plaintext OTPs were readable by every staff user).
--   P0-5  SEC-10 deactivated profiles lose every role-based privilege
--                (current_user_role() requires is_active) and no inactive /
--                suspended / unapproved account can write through the API
--                (RESTRICTIVE write policies on every RLS table).
--   P0-6  SEC-11 mv_top_products no longer readable by anon/authenticated
--                (admin RPC instead). SEC-12 retailer-targeted coupons are
--                visible only to that retailer (and its salesman / staff+).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- P0-5 (first, because later policies rely on it)
-- current_user_role(): a deactivated profile has NO role. Every
-- is_staff_or_above() / is_admin_or_above() / current_user_role() = '...'
-- check in RLS and in SECURITY DEFINER RPCs therefore fails for it.
-- search_path pinned (SEC-19) on the helpers touched here.
-- ----------------------------------------------------------------------------
create or replace function public.current_user_role() returns user_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.is_staff_or_above() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_user_role() in ('super_admin','admin','staff'), false)
$$;

create or replace function public.is_admin_or_above() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_user_role() in ('super_admin','admin'), false)
$$;

-- True only for an active profile; a retailer must additionally have an
-- APPROVED (status = 'active') retailers row. Pending, suspended and
-- row-less retailer accounts are not active accounts.
create or replace function public.is_active_account() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_active
      and (
        p.role <> 'retailer'
        or exists (select 1 from public.retailers r where r.id = p.id and r.status = 'active')
      )
  )
$$;
revoke all on function public.is_active_account() from public, anon;
grant execute on function public.is_active_account() to authenticated;

-- 0017's guard for every inventory RPC used `current_user_role() not in (...)`,
-- which is NULL (i.e. does NOT raise) when the caller has no active profile.
-- Same body, now fail-closed.
create or replace function public.require_inventory_role()
returns void
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;
  if coalesce(public.current_user_role() not in ('super_admin', 'admin', 'staff'), true) then
    raise exception 'You do not have permission to manage inventory.';
  end if;
end;
$$;


-- ----------------------------------------------------------------------------
-- P0-1 / SEC-1 — server-side staff pre-authorisation + safe signup trigger
-- ----------------------------------------------------------------------------
-- A row here is the ONLY way an auth.users insert produces a non-retailer
-- profile. RLS on + no policies + privileges revoked: only the service role
-- (server-only createStaffAction) and the SECURITY DEFINER trigger touch it.
create table if not exists public.staff_account_invites (
  email text primary key check (email = lower(email)),
  role user_role not null check (role in ('staff', 'salesman')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes')
);
alter table public.staff_account_invites enable row level security;
revoke all on public.staff_account_invites from anon, authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_role user_role := 'retailer';
  v_invite_role user_role;
  v_area_text text := nullif(trim(coalesce(new.raw_user_meta_data->>'area_id', '')), '');
  v_area_id uuid;
begin
  -- The role is NEVER taken from raw_user_meta_data: any visitor controls it
  -- through supabase.auth.signUp({ options: { data } }) with the public anon
  -- key. A staff/salesman role comes only from a live, server-created invite
  -- for this exact email, consumed here so it can never be reused.
  if new.email is not null then
    delete from public.staff_account_invites
     where email = lower(new.email)
       and expires_at > now()
    returning role into v_invite_role;
  end if;
  if v_invite_role is not null then
    v_role := v_invite_role;
  end if;

  begin
    insert into public.profiles (id, role, full_name, phone)
    values (
      new.id,
      v_role,
      coalesce(new.raw_user_meta_data->>'full_name', ''),
      coalesce(new.raw_user_meta_data->>'phone', '')
    );
  exception
    when unique_violation then
      raise exception 'phone_already_registered';
  end;

  if v_role = 'retailer' then
    -- Area must be a real, active area (retailers.area_id is NOT NULL). The
    -- old trigger swallowed this failure and left a retailer profile with no
    -- retailers row, which the (now dropped) self-insert policy let the user
    -- fill in as an ACTIVE shop with any credit limit.
    if v_area_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      select a.id into v_area_id from public.areas a where a.id = v_area_text::uuid and a.is_active;
    end if;
    if v_area_id is null then
      raise exception 'invalid_area';
    end if;

    insert into public.retailers (id, shop_name, area_id, address, status)
    values (
      new.id,
      coalesce(new.raw_user_meta_data->>'shop_name', ''),
      v_area_id,
      new.raw_user_meta_data->>'address',
      'pending_approval'
    );
  end if;

  return new;
end;
$$;


-- ----------------------------------------------------------------------------
-- P0-1 / SEC-2 — profiles: privileged columns
-- ----------------------------------------------------------------------------
-- Applies to API callers only (PostgREST roles). SECURITY DEFINER functions,
-- the service role and migrations run as other roles and are unaffected.
create or replace function public.guard_profile_privileged_columns()
returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.id is distinct from old.id or new.created_at is distinct from old.created_at then
    raise exception 'Profile identity fields cannot be changed.' using errcode = '42501';
  end if;
  if (new.role is distinct from old.role or new.is_active is distinct from old.is_active)
     and public.current_user_role() is distinct from 'super_admin' then
    raise exception 'Only a Super Admin can change an account role or active status.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_profile_privileged_columns on public.profiles;
create trigger trg_guard_profile_privileged_columns
  before update on public.profiles
  for each row execute function public.guard_profile_privileged_columns();

drop policy if exists "profiles_self_update" on public.profiles;
create policy "profiles_self_update" on public.profiles
  for update
  using (id = auth.uid() or is_admin_or_above())
  with check (id = auth.uid() or is_admin_or_above());


-- ----------------------------------------------------------------------------
-- P0-2 / SEC-5 — no self-created retailer rows
-- ----------------------------------------------------------------------------
-- handle_new_user() (SECURITY DEFINER) creates the row; admins keep
-- retailers_admin_write / retailers_admin_update (0001).
drop policy if exists "retailers_self_insert" on public.retailers;


-- ----------------------------------------------------------------------------
-- P0-3 / SEC-6 — catalogue pricing is Admin+ only
-- ----------------------------------------------------------------------------
-- Staff keep operational edits (name, brand, category, images, barcode,
-- stock levels, active flags, MOQ, sort order) but not money/tax/identity.
create or replace function public.guard_admin_only_columns()
returns trigger
language plpgsql set search_path = public as $$
declare
  v_col text;
  v_new jsonb;
  v_old jsonb;
begin
  if current_user not in ('authenticated', 'anon') or public.is_admin_or_above() then
    return new;
  end if;
  v_new := to_jsonb(new);
  v_old := to_jsonb(old);
  foreach v_col in array tg_argv loop
    if (v_new -> v_col) is distinct from (v_old -> v_col) then
      raise exception 'Only an Admin can change % on %.', v_col, tg_table_name using errcode = '42501';
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_guard_products_pricing on public.products;
create trigger trg_guard_products_pricing
  before update on public.products
  for each row execute function public.guard_admin_only_columns(
    'sku_code', 'base_price', 'cost_price', 'gst_percent', 'hsn_code', 'units_per_case'
  );

drop trigger if exists trg_guard_product_packs_pricing on public.product_packs;
create trigger trg_guard_product_packs_pricing
  before update on public.product_packs
  for each row execute function public.guard_admin_only_columns(
    'product_id', 'pack_sku_code', 'units_per_case', 'base_price', 'cost_price',
    'mrp', 'ptr', 'wholesale_price', 'case_price'
  );

-- New products/packs carry a price, so creating them is an Admin decision.
drop policy if exists "products_write" on public.products;
create policy "products_write" on public.products
  for insert with check (is_admin_or_above());
drop policy if exists "products_update" on public.products;
create policy "products_update" on public.products
  for update using (is_staff_or_above()) with check (is_staff_or_above());

drop policy if exists "product_packs_write" on public.product_packs;
create policy "product_packs_write" on public.product_packs
  for insert with check (is_admin_or_above());
drop policy if exists "product_packs_update" on public.product_packs;
create policy "product_packs_update" on public.product_packs
  for update using (is_staff_or_above()) with check (is_staff_or_above());

-- Pricing tiers, coupons and schemes are money rules in their entirety.
drop policy if exists "product_pricing_tiers_insert" on public.product_pricing_tiers;
create policy "product_pricing_tiers_insert" on public.product_pricing_tiers
  for insert with check (is_admin_or_above());
drop policy if exists "product_pricing_tiers_update" on public.product_pricing_tiers;
create policy "product_pricing_tiers_update" on public.product_pricing_tiers
  for update using (is_admin_or_above()) with check (is_admin_or_above());

drop policy if exists "coupons_staff_insert" on public.coupons;
drop policy if exists "coupons_admin_insert" on public.coupons;
create policy "coupons_admin_insert" on public.coupons
  for insert with check (is_admin_or_above());
drop policy if exists "coupons_staff_update" on public.coupons;
drop policy if exists "coupons_admin_update" on public.coupons;
create policy "coupons_admin_update" on public.coupons
  for update using (is_admin_or_above()) with check (is_admin_or_above());

drop policy if exists "schemes_staff_insert" on public.schemes;
drop policy if exists "schemes_admin_insert" on public.schemes;
create policy "schemes_admin_insert" on public.schemes
  for insert with check (is_admin_or_above());
drop policy if exists "schemes_staff_update" on public.schemes;
drop policy if exists "schemes_admin_update" on public.schemes;
create policy "schemes_admin_update" on public.schemes
  for update using (is_admin_or_above()) with check (is_admin_or_above());


-- ----------------------------------------------------------------------------
-- P0-4 / SEC-8 — notification_logs: recipient or Admin+ only
-- ----------------------------------------------------------------------------
-- Staff/salesman flows still INSERT (queueing does not read the row back).
-- Existing rows are NOT modified; historical OTP text is simply no longer
-- readable by staff. The application stops persisting OTPs (lib/notifications).
drop policy if exists "notification_logs_owner_or_staff_read" on public.notification_logs;
drop policy if exists "notification_logs_owner_or_admin_read" on public.notification_logs;
create policy "notification_logs_owner_or_admin_read" on public.notification_logs
  for select using (recipient_id = auth.uid() or is_admin_or_above());
drop policy if exists "notification_logs_staff_update" on public.notification_logs;
drop policy if exists "notification_logs_admin_update" on public.notification_logs;
create policy "notification_logs_admin_update" on public.notification_logs
  for update using (is_admin_or_above()) with check (is_admin_or_above());


-- ----------------------------------------------------------------------------
-- P0-6 / SEC-11 — 30-day revenue per product is not public
-- ----------------------------------------------------------------------------
-- Materialized views cannot carry RLS; Supabase's default privileges made
-- this readable with the public anon key. The admin page reads it through
-- an Admin-gated SECURITY DEFINER function instead.
revoke all on public.mv_top_products from anon, authenticated;

create or replace function public.admin_top_products(p_limit integer default 10)
returns setof public.mv_top_products
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin_or_above() then
    raise exception 'Access denied: Admin authorization required.' using errcode = '42501';
  end if;
  return query
    select * from public.mv_top_products
    order by qty_sold desc nulls last
    limit least(greatest(coalesce(p_limit, 10), 1), 100);
end;
$$;
revoke all on function public.admin_top_products(integer) from public, anon;
grant execute on function public.admin_top_products(integer) to authenticated;


-- ----------------------------------------------------------------------------
-- P0-6 / SEC-12 — retailer-targeted coupons are private to that retailer
-- ----------------------------------------------------------------------------
drop policy if exists "coupons_read" on public.coupons;
create policy "coupons_read" on public.coupons
  for select using (
    is_staff_or_above()
    or (
      is_active
      and (
        retailer_id is null
        or retailer_id = auth.uid()
        or (current_user_role() = 'salesman' and is_retailer_assigned_to_current_salesman(retailer_id))
      )
    )
  );


-- ----------------------------------------------------------------------------
-- P0-5 / SEC-10 — inactive, suspended or unapproved accounts cannot write
-- ----------------------------------------------------------------------------
-- RESTRICTIVE policies are AND-ed with every existing permissive policy, so
-- no existing grant is widened; they only remove writes for accounts that
-- are not active. Scoped to the `authenticated` API role: the service role,
-- SECURITY DEFINER functions and triggers running as the owner are
-- unaffected, and anon's (already minimal) policies are untouched.
-- `(select ...)` makes Postgres evaluate the check once per statement.
do $$
declare
  t record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relrowsecurity
  loop
    execute format('drop policy if exists %I on public.%I', 'active_account_insert', t.relname);
    execute format('drop policy if exists %I on public.%I', 'active_account_update', t.relname);
    execute format('drop policy if exists %I on public.%I', 'active_account_delete', t.relname);
    execute format(
      'create policy %I on public.%I as restrictive for insert to authenticated with check ((select public.is_active_account()))',
      'active_account_insert', t.relname);
    execute format(
      'create policy %I on public.%I as restrictive for update to authenticated using ((select public.is_active_account())) with check ((select public.is_active_account()))',
      'active_account_update', t.relname);
    execute format(
      'create policy %I on public.%I as restrictive for delete to authenticated using ((select public.is_active_account()))',
      'active_account_delete', t.relname);
  end loop;
end;
$$;

-- ============================================================================
-- END OF MIGRATION 0052
-- ============================================================================
