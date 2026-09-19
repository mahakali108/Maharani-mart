-- ============================================================================
-- 0051: B2B coupon / promo code system
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- Additive, re-runnable, no seed data, no business rows inserted.
--
-- There is NO existing coupon table in this schema: `schemes` (0001) is a
-- price-list SCOPE (scheme-scoped price rows change product prices for a
-- period) and `orders.discount_total` has always been 0. This migration adds
-- the missing code-based discount layer without touching schemes or price
-- lists:
--
--   1. `coupons` — one row per promo code. Codes are matched case-insensitively
--      through the expression unique index on upper(code); the application
--      normalizes input to uppercase before every read/write.
--   2. `coupon_redemptions` — one row per (coupon, order). It is the source
--      of truth for per-retailer limits and audit history. NO direct insert/
--      update/delete RLS policy exists: rows only move through the
--      security-definer `redeem_coupon` / `release_coupon` RPCs, exactly the
--      hardened pattern established for the wallet ledger in 0029/0030.
--   3. `retailer_active_coupons` — the coupon a retailer has applied to their
--      cart right now (at most one per retailer). Owner-scoped RLS, same
--      shape as `cart_owner` (0001).
--   4. `orders` gains three ADDITIVE columns (coupon_id, coupon_code,
--      coupon_discount) so the applied coupon is frozen onto the order. The
--      existing `discount_total` column finally carries the coupon discount.
--      Nothing existing is renamed, dropped or re-typed.
--   5. RLS mirroring the established patterns:
--        - coupons: retailers read active rows, staff+ write, admin deletes
--          (same shape as `schemes` in 0013 and `banners` in 0001).
--        - coupon_redemptions: own-row or staff+ read; writes ONLY via RPC.
--        - retailer_active_coupons: owner-scoped all-operations + staff read.
--   6. Audit: every new table uses the SAME generic `log_audit()` function
--      (0001) through per-table triggers, like schemes (0040) and the
--      catalog tables (0050). Orders were already audited (0001); the new
--      columns ride along in the existing full-row audit.
--
-- RACE SAFETY
-- -----------
-- `redeem_coupon` takes `for update` on the coupon row, so concurrent
-- redemptions of the same coupon are serialized: the usage limit, the
-- per-retailer limit and the first-order check are all re-verified under the
-- lock at the moment the redemption is committed. The application revalidates
-- the coupon before order creation anyway; the RPC is the database-level
-- backstop for concurrent checkouts.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ENUM + COUPON TABLE
-- ----------------------------------------------------------------------------

do $$ begin
  create type coupon_discount_type as enum ('percentage', 'fixed');
exception when duplicate_object then null;
end $$;

create table if not exists coupons (
  id uuid primary key default uuid_generate_v4(),
  -- Normalized to UPPERCASE by the application before every read/write; the
  -- unique index below makes 'save10' and 'SAVE10' the same code.
  code text not null check (code <> ''),
  title text not null,
  description text,
  discount_type coupon_discount_type not null,
  discount_value numeric(12,2) not null check (discount_value > 0),
  minimum_order_value numeric(12,2) not null default 0 check (minimum_order_value >= 0),
  -- Cap for percentage coupons (e.g. 10% off up to 500). NULL = no cap.
  maximum_discount numeric(12,2) check (maximum_discount is null or maximum_discount > 0),
  -- NULL = unlimited global redemptions.
  usage_limit int check (usage_limit is null or usage_limit >= 1),
  -- Per-retailer redemptions. Defaults to 1 (each retailer may use it once).
  per_retailer_limit int not null default 1 check (per_retailer_limit >= 1),
  used_count int not null default 0 check (used_count >= 0),
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  is_active boolean not null default true,
  first_order_only boolean not null default false,
  -- Eligibility scoping: NULL = all. retailer_id = customer-specific coupon;
  -- category_id / brand_id / product_id restrict which cart lines qualify.
  retailer_id uuid references retailers(id) on delete set null,
  category_id uuid references categories(id) on delete set null,
  brand_id uuid references brands(id) on delete set null,
  product_id uuid references products(id) on delete set null,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coupons_percentage_range check (
    discount_type = 'fixed' or (discount_type = 'percentage' and discount_value <= 100)
  )
);

-- Case-insensitive duplicate prevention (SAVE10 == save10).
create unique index if not exists uq_coupons_code on coupons (upper(code));
create index if not exists idx_coupons_window on coupons (is_active, starts_at, expires_at);
create index if not exists idx_coupons_retailer on coupons (retailer_id);
create index if not exists idx_coupons_category on coupons (category_id);
create index if not exists idx_coupons_brand on coupons (brand_id);
create index if not exists idx_coupons_product on coupons (product_id);

comment on table coupons is
  'B2B promo codes. Application-normalized uppercase codes; scheme pricing is separate (schemes/price_lists).';
comment on column coupons.discount_type is 'percentage: discount_value is 0-100 percent; fixed: discount_value is rupees.';
comment on column coupons.used_count is 'Cache of redemption rows, incremented atomically by redeem_coupon().';

-- ----------------------------------------------------------------------------
-- 2. REDEMPTION HISTORY
-- ----------------------------------------------------------------------------

create table if not exists coupon_redemptions (
  id uuid primary key default uuid_generate_v4(),
  coupon_id uuid not null references coupons(id) on delete cascade,
  retailer_id uuid not null references retailers(id) on delete cascade,
  order_id uuid not null references orders(id) on delete cascade,
  discount_amount numeric(12,2) not null check (discount_amount >= 0),
  redeemed_at timestamptz not null default now(),
  unique (coupon_id, order_id)   -- one coupon per order, one redemption row
);

create index if not exists idx_coupon_redemptions_coupon_retailer on coupon_redemptions (coupon_id, retailer_id);
create index if not exists idx_coupon_redemptions_retailer on coupon_redemptions (retailer_id);
create index if not exists idx_coupon_redemptions_order on coupon_redemptions (order_id);

-- ----------------------------------------------------------------------------
-- 3. ACTIVE (CART) COUPON PER RETAILER
-- ----------------------------------------------------------------------------

create table if not exists retailer_active_coupons (
  id uuid primary key default uuid_generate_v4(),
  retailer_id uuid not null unique references retailers(id) on delete cascade,
  coupon_id uuid not null references coupons(id) on delete cascade,
  applied_at timestamptz not null default now()
);

create index if not exists idx_retailer_active_coupons_coupon on retailer_active_coupons (coupon_id);

-- ----------------------------------------------------------------------------
-- 4. ORDERS: additive coupon snapshot columns
-- ----------------------------------------------------------------------------

alter table orders
  add column if not exists coupon_id uuid references coupons(id) on delete set null,
  add column if not exists coupon_code text,
  add column if not exists coupon_discount numeric(12,2) not null default 0 check (coupon_discount >= 0);

create index if not exists idx_orders_coupon_id on orders (coupon_id);

comment on column orders.coupon_id is 'Coupon frozen onto the order at placement (0051).';
comment on column orders.coupon_code is 'Code text snapshot; survives coupon deletion.';
comment on column orders.coupon_discount is 'Rupees discounted by the coupon; equals discount_total when a coupon was applied.';

-- ----------------------------------------------------------------------------
-- 5. RPC SECURITY (0030 pattern: auth check inside, no public execute)
-- ----------------------------------------------------------------------------

create or replace function _can_use_coupon_for_retailer(p_retailer_id uuid)
returns boolean as $$
begin
  -- No auth (service role or internal call): allow — server actions that run
  -- with the service role after their own role/permission checks.
  if auth.uid() is null then
    return true;
  end if;
  if auth.uid() = p_retailer_id then
    return true;
  end if;
  if is_staff_or_above() then
    return true;
  end if;
  return false;
end;
$$ language plpgsql stable security definer set search_path = public;

-- Atomically claims one redemption of the coupon for this order.
-- Serialized per-coupon via `for update`, so the limits below are checked
-- against the state that actually commits.
create or replace function redeem_coupon(
  p_coupon_id uuid,
  p_retailer_id uuid,
  p_order_id uuid,
  p_discount numeric
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coupon coupons%rowtype;
  v_retailer_used int;
  v_other_orders int;
begin
  if not _can_use_coupon_for_retailer(p_retailer_id) then
    raise exception 'Access denied: cannot redeem a coupon for retailer %', p_retailer_id;
  end if;

  select * into v_coupon from coupons where id = p_coupon_id for update;
  if not found then
    return false;
  end if;

  if not v_coupon.is_active
     or now() < v_coupon.starts_at
     or now() > v_coupon.expires_at then
    return false;
  end if;

  if v_coupon.retailer_id is not null and v_coupon.retailer_id <> p_retailer_id then
    return false;
  end if;

  if v_coupon.usage_limit is not null and v_coupon.used_count >= v_coupon.usage_limit then
    return false;
  end if;

  select count(*) into v_retailer_used
  from coupon_redemptions
  where coupon_id = p_coupon_id and retailer_id = p_retailer_id;
  if v_retailer_used >= v_coupon.per_retailer_limit then
    return false;
  end if;

  if v_coupon.first_order_only then
    select count(*) into v_other_orders
    from orders
    where retailer_id = p_retailer_id and id <> p_order_id;
    if v_other_orders > 0 then
      return false;
    end if;
  end if;

  insert into coupon_redemptions (coupon_id, retailer_id, order_id, discount_amount)
  values (p_coupon_id, p_retailer_id, p_order_id, p_discount);

  update coupons
  set used_count = used_count + 1,
      updated_at = now()
  where id = p_coupon_id;

  return true;
end;
$$;

-- Reverses the redemption when the order is cancelled/reversed.
create or replace function release_coupon(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coupon_id uuid;
begin
  if p_order_id is not null then
    if auth.uid() is null then
      null; -- service role: allowed (order cancel flow)
    elsif is_staff_or_above() then
      null;
    else
      -- A retailer may release only a redemption belonging to their own order.
      if not exists (
        select 1 from coupon_redemptions cr
        join orders o on o.id = cr.order_id
        where cr.order_id = p_order_id and o.retailer_id = auth.uid()
      ) then
        raise exception 'Access denied: cannot release coupon for order %', p_order_id;
      end if;
    end if;

    delete from coupon_redemptions
    where order_id = p_order_id
    returning coupon_id into v_coupon_id;

    if v_coupon_id is not null then
      update coupons
      set used_count = greatest(used_count - 1, 0),
          updated_at = now()
      where id = v_coupon_id;
    end if;
  end if;
end;
$$;

-- Only authenticated sessions may execute; anon/public cannot.
revoke execute on function redeem_coupon(uuid, uuid, uuid, numeric) from public, anon;
grant execute on function redeem_coupon(uuid, uuid, uuid, numeric) to authenticated;
revoke execute on function release_coupon(uuid) from public, anon;
grant execute on function release_coupon(uuid) to authenticated;
revoke execute on function _can_use_coupon_for_retailer(uuid) from public, anon;

-- ----------------------------------------------------------------------------
-- 6. ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------

alter table coupons enable row level security;

-- Retailers can see active coupons (window + eligibility are enforced by the
-- server-side validator, never client-side); staff+ manage.
drop policy if exists "coupons_read" on coupons;
create policy "coupons_read" on coupons
  for select using (is_active or is_staff_or_above());
drop policy if exists "coupons_staff_insert" on coupons;
create policy "coupons_staff_insert" on coupons
  for insert with check (is_staff_or_above());
drop policy if exists "coupons_staff_update" on coupons;
create policy "coupons_staff_update" on coupons
  for update using (is_staff_or_above());
drop policy if exists "coupons_admin_delete" on coupons;
create policy "coupons_admin_delete" on coupons
  for delete using (is_admin_or_above());

alter table coupon_redemptions enable row level security;

-- Read: own redemptions or staff+. NO insert/update/delete policy — writes
-- happen exclusively inside the security-definer RPCs above (0030 pattern).
drop policy if exists "coupon_redemptions_read" on coupon_redemptions;
create policy "coupon_redemptions_read" on coupon_redemptions
  for select using (retailer_id = auth.uid() or is_staff_or_above());

alter table retailer_active_coupons enable row level security;

-- Owner manages their own applied coupon; staff+ can read (support context).
drop policy if exists "active_coupon_owner" on retailer_active_coupons;
create policy "active_coupon_owner" on retailer_active_coupons
  for all using (retailer_id = auth.uid()) with check (retailer_id = auth.uid());
drop policy if exists "active_coupon_staff_read" on retailer_active_coupons;
create policy "active_coupon_staff_read" on retailer_active_coupons
  for select using (is_staff_or_above());

-- ----------------------------------------------------------------------------
-- 7. AUDIT (same generic log_audit() as every other audited table)
-- ----------------------------------------------------------------------------

drop trigger if exists trg_audit_coupons on coupons;
create trigger trg_audit_coupons after insert or update or delete on coupons
  for each row execute function log_audit();

drop trigger if exists trg_audit_coupon_redemptions on coupon_redemptions;
create trigger trg_audit_coupon_redemptions after insert or update or delete on coupon_redemptions
  for each row execute function log_audit();

drop trigger if exists trg_audit_retailer_active_coupons on retailer_active_coupons;
create trigger trg_audit_retailer_active_coupons after insert or update or delete on retailer_active_coupons
  for each row execute function log_audit();

-- ============================================================================
-- END OF MIGRATION — no business data inserted.
-- ============================================================================
