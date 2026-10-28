-- ============================================================================
-- 0082 — Product-wise retailer category (tier) pricing, enforced server-side
--
-- Adds
--   1. product_tier_prices — per pack, per retailer category, GST-INCLUSIVE
--      per-piece price. Three categories: general (highest), silver (medium),
--      gold (lowest).
--   2. Validation triggers: gold <= silver <= general is enforced on every
--      write (and on activation/deletion), currency precision is numeric(12,2)
--      and prices must be > 0.
--   3. Write guard: only an administrator (or the function owner inside a
--      sanctioned SECURITY DEFINER body) can write these prices. A retailer
--      cannot create, alter or delete a category price; RLS also hides other
--      categories' prices from a retailer.
--   4. public.pack_category_price_per_piece(pack, retailer) — the single
--      authoritative resolution: the retailer's own category price, else the
--      general price, else NULL (no category pricing configured).
--   5. Re-stated create_order_atomic (0056) and create_order_atomic_v2 (0065)
--      whose per-line Maharani price check consults that helper FIRST. The
--      rest of both functions is byte-identical to the deployed bodies; the
--      only behavioural difference is the added block, which is a no-op for
--      every pack that has no category price.
--
-- WHY THIS IS THE AUTHORITATIVE PRICE
--   Checkout already refuses any browser-supplied price that differs from the
--   price the database resolves, so adding the category price to that same
--   resolution makes it authoritative for: catalog/quote (TypeScript re-reads
--   the same table), cart validation, checkout quote, order creation, order
--   totals, invoices (they read the stored order rows) and seller settlement
--   (seller lines are never repriced here at all).
--
-- SELLER (THIRD-PARTY) LINES
--   Category pricing applies to Maharani own-stock lines ONLY. A seller offer
--   keeps its approved offer price and its admin floor check, so a retailer
--   category can never silently reduce a seller's settlement. Seller floors
--   and seller cost data are never exposed to retailers.
--
-- NOTHING IS APPLIED TO ANY PROJECT BY THIS FILE.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------
create table if not exists public.product_tier_prices (
  id uuid primary key default uuid_generate_v4(),
  product_pack_id uuid not null references public.product_packs(id) on delete cascade,
  retailer_category public.retailer_category not null,
  price_per_piece numeric(12,2) not null check (price_per_piece > 0),
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_pack_id, retailer_category)
);

comment on table public.product_tier_prices is
  'Per-pack, per-retailer-category GST-INCLUSIVE piece price. Constraint: gold <= silver <= general. Assigned only by an administrator; never by a retailer, and never a paid subscription.';
comment on column public.product_tier_prices.price_per_piece is
  'GST-INCLUSIVE selling price per piece for the given retailer category (same unit as product_pricing_tiers.price_per_piece).';

create index if not exists idx_product_tier_prices_pack
  on public.product_tier_prices(product_pack_id);

alter table public.product_tier_prices enable row level security;

-- Retailers see ONLY the price row for their own category (never the lower
-- Silver/Gold prices they are not entitled to). Admins see everything.
drop policy if exists "product_tier_prices_read" on public.product_tier_prices;
create policy "product_tier_prices_read" on public.product_tier_prices
  for select to authenticated
  using (
    is_admin_or_above()
    -- An ACTIVE APPROVED retailer may see the GENERAL (standard, highest)
    -- price plus the price for its own category. Silver/Gold prices are never
    -- disclosed to a retailer who does not hold that category, and an
    -- unapproved/suspended retailer sees nothing at all (it is also blocked by
    -- middleware before any pricing surface renders).
    or (
      public.is_active_account()
      and (
        retailer_category = 'general'
        or retailer_category = (
          select r.retailer_category
            from public.retailers r
           where r.id = auth.uid()
             and r.status = 'active'
        )
      )
    )
    -- Salesmen and staff create orders for a retailer, so they need the same
    -- per-category numbers the checkout RPC will charge; otherwise the quote
    -- would fail with ORDER_PRICE_CHANGED. These rows are RETAILER selling
    -- prices — never seller cost, floor or margin data.
    or public.is_staff_or_above()
  );

drop policy if exists "product_tier_prices_admin_insert" on public.product_tier_prices;
create policy "product_tier_prices_admin_insert" on public.product_tier_prices
  for insert to authenticated with check (is_admin_or_above());

drop policy if exists "product_tier_prices_admin_update" on public.product_tier_prices;
create policy "product_tier_prices_admin_update" on public.product_tier_prices
  for update to authenticated using (is_admin_or_above()) with check (is_admin_or_above());

drop policy if exists "product_tier_prices_admin_delete" on public.product_tier_prices;
create policy "product_tier_prices_admin_delete" on public.product_tier_prices
  for delete to authenticated using (is_admin_or_above());

revoke all on public.product_tier_prices from anon;

-- ---------------------------------------------------------------------------
-- 2. Ordering validation — gold <= silver <= general (per pack)
-- ---------------------------------------------------------------------------
create or replace function public.validate_product_tier_prices()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_pack uuid := coalesce(new.product_pack_id, old.product_pack_id);
  v_general numeric;
  v_silver numeric;
  v_gold numeric;
begin
  select
    max(case when retailer_category = 'general' then price_per_piece end),
    max(case when retailer_category = 'silver' then price_per_piece end),
    max(case when retailer_category = 'gold' then price_per_piece end)
    into v_general, v_silver, v_gold
    from public.product_tier_prices
   where product_pack_id = v_pack and is_active;

  if v_gold is not null and v_silver is not null and v_gold > v_silver then
    raise exception 'CATEGORY_PRICE_ORDER_INVALID: the gold price cannot be higher than the silver price.' using errcode = '23514';
  end if;
  if v_gold is not null and v_general is not null and v_gold > v_general then
    raise exception 'CATEGORY_PRICE_ORDER_INVALID: the gold price cannot be higher than the general price.' using errcode = '23514';
  end if;
  if v_silver is not null and v_general is not null and v_silver > v_general then
    raise exception 'CATEGORY_PRICE_ORDER_INVALID: the silver price cannot be higher than the general price.' using errcode = '23514';
  end if;
  return null;
end;
$$;

revoke all on function public.validate_product_tier_prices() from public, anon, authenticated;

drop trigger if exists trg_validate_product_tier_prices on public.product_tier_prices;
create trigger trg_validate_product_tier_prices
  after insert or update or delete on public.product_tier_prices
  for each row execute function public.validate_product_tier_prices();

-- ---------------------------------------------------------------------------
-- 3. Write guard — administrators only (depth 2 behind RLS)
-- ---------------------------------------------------------------------------
create or replace function public.guard_product_tier_prices_write()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- The function owner (migrations) and the trusted server-side service role
  -- may write; every API caller must be a real administrator. A retailer
  -- session is stopped here even if an RLS policy regressed, and RLS already
  -- denies the write one layer above.
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return coalesce(new, old);
  end if;
  if not is_admin_or_above() then
    raise exception 'Retailer category prices can only be changed by an administrator.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function public.guard_product_tier_prices_write() from public, anon, authenticated;

drop trigger if exists trg_guard_product_tier_prices_write on public.product_tier_prices;
create trigger trg_guard_product_tier_prices_write
  before insert or update or delete on public.product_tier_prices
  for each row execute function public.guard_product_tier_prices_write();

-- ---------------------------------------------------------------------------
-- 4. Authoritative resolution helper
-- ---------------------------------------------------------------------------
create or replace function public.pack_category_price_per_piece(
  p_pack_id uuid,
  p_retailer_id uuid
) returns numeric
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_category public.retailer_category := 'general';
  v_price numeric(12,2);
begin
  if p_pack_id is null or p_retailer_id is null then
    return null;
  end if;
  if auth.uid() is not null and auth.uid() <> p_retailer_id and not is_admin_or_above() then
    raise exception 'Access denied: cannot resolve another retailer''s price.' using errcode = '42501';
  end if;

  select coalesce(r.retailer_category, 'general')
    into v_category
    from public.retailers r
   where r.id = p_retailer_id;

  if v_category is null then
    v_category := 'general';
  end if;

  select ptp.price_per_piece
    into v_price
    from public.product_tier_prices ptp
   where ptp.product_pack_id = p_pack_id
     and ptp.retailer_category = v_category
     and ptp.is_active;

  if v_price is null and v_category <> 'general' then
    select ptp.price_per_piece
      into v_price
      from public.product_tier_prices ptp
     where ptp.product_pack_id = p_pack_id
       and ptp.retailer_category = 'general'
       and ptp.is_active;
  end if;

  return v_price;
end;
$$;

comment on function public.pack_category_price_per_piece(uuid, uuid) is
  'Authoritative retailer category price for one pack (GST-inclusive per piece). Own-category row wins; the general row is the fallback; NULL means no category pricing is configured for the pack. Never exposes another category''s price.';

-- Called only from SECURITY DEFINER checkout/quote bodies (which run as the
-- owner); no API role may call it directly.
revoke all on function public.pack_category_price_per_piece(uuid, uuid) from public, anon, authenticated;

-- ============================================================================
-- 5. Checkout price enforcement (restated functions — see the header note)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 5a. create_order_atomic (v1, from 0056) with the category-price gate.
-- ---------------------------------------------------------------------------
create or replace function public.create_order_atomic(
  p_retailer_id uuid,
  p_collected_by uuid,
  p_request_key uuid,
  p_request_fingerprint text,
  p_notes text,
  p_shipping_address jsonb,
  p_subtotal numeric,
  p_gst_total numeric,
  p_discount_total numeric,
  p_grand_total numeric,
  p_coupon_id uuid,
  p_coupon_code text,
  p_coupon_discount numeric,
  p_expected_coins_used_paise bigint,
  p_order_items jsonb,
  p_clear_cart_after_order boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.orders%rowtype;
  v_order public.orders%rowtype;
  v_item record;
  v_product_id uuid;
  v_units_per_case integer;
  v_moq integer;
  v_pack_active boolean;
  v_product_active boolean;
  v_gst_percent numeric;
  v_pack_case_price numeric;
  v_pack_ptr numeric;
  v_pack_base_price numeric;
  v_retailer_area_id uuid;
  v_product_override numeric;
  v_current_case_price numeric;
  v_current_tier_price numeric;
  v_expected_unit_price numeric;
  v_category_piece_price numeric;
  v_has_explicit_loose_tier boolean;
  v_retailer_status text;
  v_assigned_salesman_id uuid;
  v_item_count bigint;
  v_unique_count bigint;
  v_line_total numeric;
  v_expected_gst numeric;
  v_order_total_paise bigint;
  v_available_coins_paise bigint;
  v_coins_used_paise bigint;
  v_coins_balance_after_paise bigint;
  v_active_coupon_id uuid;
  v_coupon public.coupons%rowtype;
  v_coupon_eligible_subtotal numeric;
  v_expected_coupon_discount numeric;
  v_ledger_coins_paise bigint;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Order creation is server-only.' using errcode = '42501';
  end if;

  if p_retailer_id is null
     or p_request_key is null
     or p_request_fingerprint is null
     or p_request_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'Order request identity is invalid.' using errcode = '22023';
  end if;
  if p_notes is not null and char_length(p_notes) > 1000 then
    raise exception 'Order notes are too long.' using errcode = '22023';
  end if;
  if p_shipping_address is not null and (
       jsonb_typeof(p_shipping_address) <> 'object'
       or nullif(btrim(p_shipping_address ->> 'line'), '') is null
  ) then
    raise exception 'The delivery address is invalid.' using errcode = '22023';
  end if;
  if p_order_items is null
     or jsonb_typeof(p_order_items) <> 'array'
     or jsonb_array_length(p_order_items) < 1
     or jsonb_array_length(p_order_items) > 200 then
    raise exception 'Order lines are invalid.' using errcode = '22023';
  end if;
  if p_subtotal is null or p_gst_total is null or p_discount_total is null
     or p_grand_total is null or p_expected_coins_used_paise is null
     or p_subtotal < 0 or p_gst_total < 0 or p_discount_total < 0
     or p_grand_total < 0 or p_expected_coins_used_paise < 0 then
    raise exception 'Order totals are invalid.' using errcode = '22023';
  end if;

  -- Serialize duplicate submissions before any write. A key is bound to one
  -- retailer/actor and one canonical fingerprint; different payload reuse is a
  -- 409-class conflict, never a second order.
  perform pg_advisory_xact_lock(
    hashtextextended('order-request:' || p_request_key::text, 0)
  );
  select * into v_existing
    from public.orders o
   where o.request_key = p_request_key
   for update;
  if found then
    if v_existing.retailer_id is distinct from p_retailer_id
       or v_existing.collected_by is distinct from p_collected_by then
      raise exception 'IDEMPOTENCY_CONFLICT: request key belongs to a different order owner.' using errcode = '23505';
    end if;
    -- Legacy salesman keys created before this migration have no fingerprint.
    -- They may be replayed only by the same assigned salesman; a retailer
    -- checkout with an un-verifiable old key fails closed.
    if v_existing.request_fingerprint is not null
       and v_existing.request_fingerprint is distinct from p_request_fingerprint then
      raise exception 'IDEMPOTENCY_CONFLICT: request key was reused with different order details.' using errcode = '23505';
    end if;
    if v_existing.request_fingerprint is null and p_collected_by is null then
      raise exception 'IDEMPOTENCY_CONFLICT: this legacy request cannot be verified safely.' using errcode = '23505';
    end if;
    if v_existing.status = 'cancelled' then
      raise exception 'ORDER_REQUEST_CANCELLED: this request was already cancelled.' using errcode = 'P0001';
    end if;
    if v_existing.request_completed_at is null
       or not exists (select 1 from public.order_items oi where oi.order_id = v_existing.id) then
      raise exception 'ORDER_REQUEST_INCOMPLETE: this request is not finalized.' using errcode = 'P0001';
    end if;

    select coalesce(sum(w.amount_paise), 0)
      into v_ledger_coins_paise
      from public.retailer_wallet_ledger w
     where w.retailer_id = p_retailer_id
       and w.reference_type = 'order'
       and w.reference_id = v_existing.id
       and w.transaction_type = 'ORDER_DEBIT'
       and not w.is_reversed;

    return jsonb_build_object(
      'id', v_existing.id,
      'orderNumber', v_existing.order_number,
      'status', v_existing.status::text,
      'grandTotalPaise', round(v_existing.grand_total * 100)::bigint,
      'coinsUsedPaise', coalesce(v_ledger_coins_paise, 0),
      'coinsBalanceAfterPaise', v_existing.coins_balance_after_paise,
      'placedAt', v_existing.placed_at,
      'replayed', true
    );
  end if;

  -- Lock the retailer first. Besides serializing same-retailer credit use, this
  -- makes retailer status/assignment stable through the transaction.
  select r.status::text, r.assigned_salesman_id
    into v_retailer_status, v_assigned_salesman_id
    from public.retailers r
   where r.id = p_retailer_id
   for update;
  if not found or v_retailer_status <> 'active' then
    raise exception 'RETAILER_NOT_ACTIVE: orders require an active retailer.' using errcode = '42501';
  end if;
  if p_collected_by is null then
    if not exists (
      select 1 from public.profiles pr
       where pr.id = p_retailer_id and pr.role = 'retailer' and pr.is_active
    ) then
      raise exception 'RETAILER_NOT_ACTIVE: retailer profile is not eligible to order.' using errcode = '42501';
    end if;
  else
    if not exists (
      select 1 from public.profiles pr
       where pr.id = p_collected_by and pr.role = 'salesman' and pr.is_active
    ) or v_assigned_salesman_id is distinct from p_collected_by then
      raise exception 'RETAILER_ASSIGNMENT_REQUIRED: only the assigned active salesman may capture this order.' using errcode = '42501';
    end if;
  end if;

  -- One server-resolved active warehouse is mandatory; the 0054 BEFORE INSERT
  -- trigger independently enforces and snapshots it, so no caller value is used.
  if (select count(*) from public.warehouses w where w.is_active) <> 1 then
    raise exception 'WAREHOUSE_CONFIGURATION_ERROR: exactly one active warehouse is required.' using errcode = '22023';
  end if;

  if p_clear_cart_after_order then
    perform pg_advisory_xact_lock(
      hashtextextended('retailer-cart:' || p_retailer_id::text, 0)
    );
    perform 1 from public.cart_items ci
     where ci.retailer_id = p_retailer_id
     order by ci.id
     for update;

    select count(*), count(distinct r.pack_id)
      into v_item_count, v_unique_count
      from jsonb_to_recordset(p_order_items) as r(pack_id uuid, quantity integer);
    if v_item_count <> v_unique_count
       or (select count(*) from public.cart_items ci where ci.retailer_id = p_retailer_id) <> v_item_count
       or exists (
         select ci.pack_id, ci.quantity from public.cart_items ci where ci.retailer_id = p_retailer_id
         except
         select r.pack_id, r.quantity from jsonb_to_recordset(p_order_items) as r(pack_id uuid, quantity integer)
       )
       or exists (
         select r.pack_id, r.quantity from jsonb_to_recordset(p_order_items) as r(pack_id uuid, quantity integer)
         except
         select ci.pack_id, ci.quantity from public.cart_items ci where ci.retailer_id = p_retailer_id
       ) then
      raise exception 'CART_CHANGED: the saved cart changed after it was reviewed.' using errcode = '40001';
    end if;
  end if;

  -- Structural and arithmetic reconciliation: every pack is unique, quantity
  -- is a whole piece count, unit_price × quantity = line_total, and the sum of
  -- GST-inclusive lines equals subtotal + extracted GST.
  select count(*), count(distinct r.pack_id), round(coalesce(sum(r.line_total), 0), 2)
    into v_item_count, v_unique_count, v_line_total
    from jsonb_to_recordset(p_order_items) as r(
      pack_id uuid, quantity integer, unit_price numeric,
      gst_percent numeric, line_total numeric
    );
  if v_item_count <> v_unique_count or v_item_count < 1 then
    raise exception 'ORDER_QUOTE_INVALID: order lines contain duplicate or missing packs.' using errcode = '22023';
  end if;
  if exists (
    select 1
      from jsonb_to_recordset(p_order_items) as r(
        pack_id uuid, quantity integer, unit_price numeric,
        gst_percent numeric, line_total numeric
      )
     where r.pack_id is null or r.quantity is null or r.quantity < 1 or r.quantity > 100000
        or r.unit_price is null or r.unit_price <= 0
        or r.gst_percent is null or r.gst_percent < 0 or r.gst_percent > 100
        or r.line_total is null or r.line_total <= 0
        or round(r.unit_price * r.quantity, 2) <> round(r.line_total, 2)
  ) then
    raise exception 'ORDER_QUOTE_INVALID: an order line is not a valid server-priced piece line.' using errcode = '22023';
  end if;
  select round(coalesce(sum(
           case when r.gst_percent = 0 then 0
                else round((r.line_total * r.gst_percent) / (100 + r.gst_percent), 2)
           end
         ), 0), 2)
    into v_expected_gst
    from jsonb_to_recordset(p_order_items) as r(
      pack_id uuid, quantity integer, unit_price numeric,
      gst_percent numeric, line_total numeric
    );
  if round(v_line_total, 2) <> round(p_subtotal + p_gst_total, 2)
     or round(v_expected_gst, 2) <> round(p_gst_total, 2)
     or round(p_subtotal + p_gst_total - p_discount_total, 2) <> round(p_grand_total, 2) then
    raise exception 'ORDER_QUOTE_INVALID: order totals do not reconcile with the quoted lines.' using errcode = '22023';
  end if;

  if p_clear_cart_after_order then
    perform pg_advisory_xact_lock(
      hashtextextended('retailer-coupon:' || p_retailer_id::text, 0)
    );
  end if;

  if p_coupon_id is null then
    if coalesce(p_coupon_code, '') <> ''
       or coalesce(p_coupon_discount, 0) <> 0
       or p_discount_total <> 0 then
      raise exception 'COUPON_INVALID: coupon snapshot does not match the quote.' using errcode = '22023';
    end if;
    if p_clear_cart_after_order and exists (
      select 1 from public.retailer_active_coupons rac where rac.retailer_id = p_retailer_id
    ) then
      raise exception 'COUPON_INVALID: the active coupon changed after the quote.' using errcode = '40001';
    end if;
  else
    if nullif(btrim(p_coupon_code), '') is null
       or p_coupon_discount is null
       or round(p_coupon_discount, 2) <> round(p_discount_total, 2) then
      raise exception 'COUPON_INVALID: coupon snapshot does not match the quote.' using errcode = '22023';
    end if;
    select rac.coupon_id into v_active_coupon_id
      from public.retailer_active_coupons rac
     where rac.retailer_id = p_retailer_id
     for update;
    if v_active_coupon_id is distinct from p_coupon_id then
      raise exception 'COUPON_INVALID: the active coupon changed after the quote.' using errcode = '40001';
    end if;

    -- Lock the exact coupon terms through commit. The lower-level redemption
    -- RPC also checks use limits under this same row lock.
    select * into v_coupon
      from public.coupons c
     where c.id = p_coupon_id
     for update;
    if not found
       or v_coupon.is_active is not true
       or now() < v_coupon.starts_at
       or now() > v_coupon.expires_at
       or (v_coupon.retailer_id is not null and v_coupon.retailer_id <> p_retailer_id)
       or upper(btrim(v_coupon.code)) <> upper(btrim(p_coupon_code)) then
      raise exception 'COUPON_INVALID: this coupon is no longer eligible.' using errcode = '23514';
    end if;
  end if;

  -- Serialize on the affected products in a stable order. Price-list, tier,
  -- pack and GST mutations use this same product lock, so a quote cannot go
  -- stale between this comparison and the stock/order commit.
  for v_item in
    select distinct pp.product_id
      from jsonb_to_recordset(p_order_items) as r(pack_id uuid)
      join public.product_packs pp on pp.id = r.pack_id
     order by pp.product_id
  loop
    perform pg_advisory_xact_lock(
      hashtextextended('retailer-pricing:' || v_item.product_id::text, 0)
    );
  end loop;

  -- Revalidate active state, MOQ, current GST and the exact piece rate used by
  -- quoteOrderForRetailer. The quote service remains the canonical arithmetic
  -- engine; this DB check rejects a quote made stale by a price/tax edit before
  -- the atomic write. Existing 0054 stock triggers check exact on-hand quantity.
  for v_item in
    select r.pack_id, r.quantity, r.unit_price, r.gst_percent, r.line_total
      from jsonb_to_recordset(p_order_items) as r(
        pack_id uuid, quantity integer, unit_price numeric,
        gst_percent numeric, line_total numeric
      )
     order by r.pack_id
  loop
    select pp.product_id, pp.units_per_case, pp.moq, pp.is_active, p.is_active,
           p.gst_percent, pp.case_price, pp.ptr, pp.base_price, r.area_id
      into v_product_id, v_units_per_case, v_moq, v_pack_active, v_product_active,
           v_gst_percent, v_pack_case_price, v_pack_ptr, v_pack_base_price, v_retailer_area_id
      from public.product_packs pp
      join public.products p on p.id = pp.product_id
      join public.retailers r on r.id = p_retailer_id
     where pp.id = v_item.pack_id
     for share of pp, p;
    if not found or not v_pack_active or not v_product_active then
      raise exception 'PACK_UNAVAILABLE: a selected pack is no longer active.' using errcode = '23514';
    end if;
    if v_item.quantity < v_moq then
      raise exception 'MINIMUM_ORDER_QUANTITY: minimum is % pieces for this pack.', v_moq using errcode = '23514';
    end if;
    if round(v_item.gst_percent, 2) is distinct from round(v_gst_percent, 2) then
      raise exception 'ORDER_PRICE_CHANGED: the GST rate changed after the quote.' using errcode = '40001';
    end if;

    select pl.price
      into v_product_override
      from public.price_lists pl
     where pl.product_id = v_product_id
       and pl.scope = 'retailer'
       and pl.retailer_id = p_retailer_id
       and pl.is_active
       and pl.valid_from <= now()
     order by pl.priority desc
     limit 1;
    if v_product_override is null and v_retailer_area_id is not null then
      select pl.price
        into v_product_override
        from public.price_lists pl
       where pl.product_id = v_product_id
         and pl.scope = 'area'
         and pl.area_id = v_retailer_area_id
         and pl.is_active
         and pl.valid_from <= now()
       order by pl.priority desc
       limit 1;
    end if;
    v_current_case_price := coalesce(v_product_override, v_pack_case_price, v_pack_ptr, v_pack_base_price);

    -- 0082 — retailer category tier pricing is authoritative. When a category
    -- price is configured for this pack + the retailer's category, it prices
    -- the line and no slab/override/case fallback applies. The helper returns
    -- NULL when no category price is configured, so every pre-existing
    -- pricing rule is byte-for-byte unchanged for those packs.
    v_category_piece_price := public.pack_category_price_per_piece(v_item.pack_id, p_retailer_id);
    if v_category_piece_price is not null then
      if round(v_item.unit_price, 2) is distinct from round(v_category_piece_price, 2) then
        raise exception 'ORDER_PRICE_CHANGED: the retailer category price changed after the quote.' using errcode = '40001';
      end if;
      continue;
    end if;

    select exists (
      select 1 from public.product_pricing_tiers ppt
       where ppt.product_pack_id = v_item.pack_id
         and ppt.is_active and ppt.rule_type = 'loose'
    ) into v_has_explicit_loose_tier;

    select ppt.price_per_piece
      into v_current_tier_price
      from public.product_pricing_tiers ppt
     where ppt.product_pack_id = v_item.pack_id
       and ppt.is_active
       and ((v_has_explicit_loose_tier and ppt.rule_type = 'loose')
         or (not v_has_explicit_loose_tier and ppt.rule_type <> 'case'))
       and ppt.min_quantity >= 1
       and ppt.min_quantity < v_units_per_case
       and (ppt.max_quantity is null or ppt.max_quantity > ppt.min_quantity)
       and ppt.min_quantity <= v_item.quantity
       and (ppt.max_quantity is null or v_item.quantity < ppt.max_quantity)
     order by ppt.min_quantity asc
     limit 1;
    if not found then
      select ppt.price_per_piece
        into v_current_tier_price
        from public.product_pricing_tiers ppt
       where ppt.product_pack_id = v_item.pack_id
         and ppt.is_active
         and ((v_has_explicit_loose_tier and ppt.rule_type = 'loose')
           or (not v_has_explicit_loose_tier and ppt.rule_type <> 'case'))
         and ppt.min_quantity >= 1
         and ppt.min_quantity < v_units_per_case
         and (ppt.max_quantity is null or ppt.max_quantity > ppt.min_quantity)
       order by ppt.min_quantity desc
       limit 1;
    end if;

    if v_current_tier_price is null then
      v_expected_unit_price := round(v_current_case_price / greatest(v_units_per_case, 1), 2);
    else
      v_expected_unit_price := v_current_tier_price;
    end if;
    if round(v_item.unit_price, 2) is distinct from round(v_expected_unit_price, 2) then
      raise exception 'ORDER_PRICE_CHANGED: the selling price changed after the quote.' using errcode = '40001';
    end if;
  end loop;

  if p_coupon_id is not null then
    if p_subtotal < v_coupon.minimum_order_value then
      raise exception 'COUPON_INVALID: the order no longer meets the coupon minimum.' using errcode = '23514';
    end if;

    -- Recompute eligible GST-exclusive value from the same current product
    -- identities and reconciled lines the order will persist. This duplicates
    -- only the coupon eligibility math at the transaction boundary; TypeScript
    -- remains the quote engine, and stale coupon terms/discounts fail closed.
    select round(coalesce(sum(
             r.line_total - case when r.gst_percent = 0 then 0
                                 else round((r.line_total * r.gst_percent) / (100 + r.gst_percent), 2)
                            end
           ), 0), 2)
      into v_coupon_eligible_subtotal
      from jsonb_to_recordset(p_order_items) as r(
        pack_id uuid, quantity integer, unit_price numeric,
        gst_percent numeric, line_total numeric
      )
      join public.product_packs pp on pp.id = r.pack_id
      join public.products p on p.id = pp.product_id
     where r.line_total > 0
       and (v_coupon.category_id is null or p.category_id = v_coupon.category_id)
       and (v_coupon.brand_id is null or p.brand_id = v_coupon.brand_id)
       and (v_coupon.product_id is null or p.id = v_coupon.product_id)
       and r.line_total - case when r.gst_percent = 0 then 0
                               else round((r.line_total * r.gst_percent) / (100 + r.gst_percent), 2)
                          end > 0;

    if (v_coupon.category_id is not null or v_coupon.brand_id is not null or v_coupon.product_id is not null)
       and coalesce(v_coupon_eligible_subtotal, 0) <= 0 then
      raise exception 'COUPON_INVALID: the coupon no longer applies to these products.' using errcode = '23514';
    end if;

    if v_coupon.discount_type = 'percentage' then
      v_expected_coupon_discount := round(v_coupon_eligible_subtotal * v_coupon.discount_value / 100, 2);
      if v_coupon.maximum_discount is not null and v_coupon.maximum_discount > 0 then
        v_expected_coupon_discount := least(v_expected_coupon_discount, v_coupon.maximum_discount);
      end if;
    else
      v_expected_coupon_discount := v_coupon.discount_value;
    end if;
    v_expected_coupon_discount := round(
      least(greatest(coalesce(v_expected_coupon_discount, 0), 0), coalesce(v_coupon_eligible_subtotal, 0)),
      2
    );

    if v_expected_coupon_discount <= 0
       or round(p_coupon_discount, 2) is distinct from v_expected_coupon_discount
       or round(p_discount_total, 2) is distinct from v_expected_coupon_discount then
      raise exception 'COUPON_INVALID: the coupon discount changed after the quote.' using errcode = '40001';
    end if;
  end if;

  insert into public.orders (
    retailer_id, collected_by, status, subtotal, gst_total, discount_total,
    grand_total, notes, shipping_address, coupon_id, coupon_code,
    coupon_discount, request_key, request_fingerprint
  ) values (
    p_retailer_id, p_collected_by, 'pending', p_subtotal, p_gst_total,
    p_discount_total, p_grand_total, nullif(btrim(p_notes), ''),
    p_shipping_address, p_coupon_id, nullif(upper(btrim(p_coupon_code)), ''),
    coalesce(p_coupon_discount, 0), p_request_key, p_request_fingerprint
  ) returning * into v_order;

  -- The 0054 order_items trigger deducts exact pack stock in this same
  -- transaction, rejecting stale/out-of-stock quotes. It overwrites the piece
  -- snapshot from quantity and records its own reversible stock counters.
  for v_item in
    select r.pack_id, r.quantity, r.unit_price, r.gst_percent, r.line_total
      from jsonb_to_recordset(p_order_items) as r(
        pack_id uuid, quantity integer, unit_price numeric,
        gst_percent numeric, line_total numeric
      )
     order by r.pack_id
  loop
    -- Read the current product/pack snapshot for THIS row (the validation loop
    -- above may have finished on a different pack).
    select pp.product_id, pp.units_per_case
      into v_product_id, v_units_per_case
      from public.product_packs pp
     where pp.id = v_item.pack_id;

    insert into public.order_items (
      order_id, product_id, pack_id, quantity, quantity_unit,
      quantity_pieces, units_per_case, unit_price, gst_percent, line_total
    ) values (
      v_order.id, v_product_id, v_item.pack_id, v_item.quantity, 'pieces',
      v_item.quantity, v_units_per_case, v_item.unit_price,
      v_item.gst_percent, v_item.line_total
    );
  end loop;

  if p_coupon_id is not null then
    if not public.redeem_coupon(
      p_coupon_id, p_retailer_id, v_order.id, p_coupon_discount
    ) then
      raise exception 'COUPON_INVALID: this coupon is no longer eligible.' using errcode = '23514';
    end if;
    delete from public.retailer_active_coupons rac
     where rac.retailer_id = p_retailer_id and rac.coupon_id = p_coupon_id;
  end if;

  v_order_total_paise := round(p_grand_total * 100)::bigint;
  v_available_coins_paise := greatest(
    0,
    public.get_retailer_available_credit_paise(p_retailer_id)
  );
  v_coins_used_paise := least(v_available_coins_paise, v_order_total_paise);
  if p_expected_coins_used_paise <> v_coins_used_paise then
    raise exception 'COIN_BALANCE_CHANGED: the available coin balance changed after the quote.' using errcode = '40001';
  end if;

  if v_coins_used_paise > 0 then
    perform public.check_and_debit_retailer_wallet(
      p_retailer_id,
      v_order.id,
      v_coins_used_paise,
      'order:' || v_order.id::text,
      coalesce(p_collected_by, p_retailer_id),
      'Order ' || v_order.order_number || ' — ₹' || to_char(p_grand_total, 'FM999999990.00')
    );
  end if;

  -- Unlike grandTotal - coinsUsed (the amount left on the order), this is the
  -- retailer's remaining wallet/Coins balance, read after the atomic debit.
  v_coins_balance_after_paise := greatest(
    0,
    public.get_retailer_available_credit_paise(p_retailer_id)
  );
  update public.orders
     set coins_balance_after_paise = v_coins_balance_after_paise
   where id = v_order.id;

  if p_request_key is not null then
    update public.orders
       set request_completed_at = now()
     where id = v_order.id;
  end if;

  if p_clear_cart_after_order then
    delete from public.cart_items ci where ci.retailer_id = p_retailer_id;
  end if;

  return jsonb_build_object(
    'id', v_order.id,
    'orderNumber', v_order.order_number,
    'status', v_order.status::text,
    'grandTotalPaise', v_order_total_paise,
    'coinsUsedPaise', v_coins_used_paise,
    'coinsBalanceAfterPaise', v_coins_balance_after_paise,
    'placedAt', v_order.placed_at,
    'replayed', false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5b. create_order_atomic_v2 (from 0065) with the category-price gate.
-- ---------------------------------------------------------------------------
create or replace function public.create_order_atomic_v2(
  p_retailer_id uuid,
  p_collected_by uuid,
  p_request_key uuid,
  p_request_fingerprint text,
  p_notes text,
  p_shipping_address jsonb,
  p_subtotal numeric,
  p_gst_total numeric,
  p_discount_total numeric,
  p_grand_total numeric,
  p_coupon_id uuid,
  p_coupon_code text,
  p_coupon_discount numeric,
  p_expected_coins_used_paise bigint,
  p_order_items jsonb,
  p_clear_cart_after_order boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.orders%rowtype;
  v_order public.orders%rowtype;
  v_item record;
  v_child record;
  v_product_id uuid;
  v_units_per_case integer;
  v_moq integer;
  v_pack_active boolean;
  v_product_active boolean;
  v_gst_percent numeric;
  v_pack_case_price numeric;
  v_pack_ptr numeric;
  v_pack_base_price numeric;
  v_retailer_area_id uuid;
  v_product_override numeric;
  v_current_case_price numeric;
  v_current_tier_price numeric;
  v_expected_unit_price numeric;
  v_category_piece_price numeric;
  v_has_explicit_loose_tier boolean;
  v_retailer_status text;
  v_assigned_salesman_id uuid;
  v_item_count bigint;
  v_line_identity_count bigint;
  v_line_total numeric;
  v_expected_gst numeric;
  v_order_total_paise bigint;
  v_available_coins_paise bigint;
  v_coins_used_paise bigint;
  v_coins_balance_after_paise bigint;
  v_active_coupon_id uuid;
  v_coupon public.coupons%rowtype;
  v_coupon_eligible_subtotal numeric;
  v_expected_coupon_discount numeric;
  v_ledger_coins_paise bigint;
  v_offer_price_paise bigint;
  v_offer_moq integer;
  v_offer_stock integer;
  v_offer_active boolean;
  v_offer_moderation text;
  v_offer_pack uuid;
  v_offer_product uuid;
  v_offer_fulfilment text;
  v_offer_seller uuid;
  v_seller_status text;
  v_floor bigint;
  v_profile text;
  v_maharani_count integer := 0;
  v_seller_line_count integer := 0;
  v_child_ids uuid[];
  v_child_sort integer[] := '{}';
  v_child_gross bigint[] := '{}';
  v_child_gst bigint[] := '{}';
  v_child_coupon_base bigint[] := '{}';
  v_child_payable_before_coins bigint[] := '{}';
  v_coupon_shares bigint[];
  v_coins_shares bigint[];
  v_children_json jsonb := '[]'::jsonb;
  v_sub public.sub_orders%rowtype;
  v_line_gst numeric;
  v_line_gst_paise bigint;
  v_child_coupon_total bigint := 0;
  v_child_coins_total bigint := 0;
  v_parent_gross_paise bigint;
  v_parent_gst_paise bigint;
  v_coupon_discount_paise bigint;
  v_maharani_child_id uuid;
  v_child_counter integer := 0;
  v_all_pack_stock boolean := true;
  v_all_seller_stock boolean := true;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Order creation is server-only.' using errcode = '42501';
  end if;

  if p_retailer_id is null
     or p_request_key is null
     or p_request_fingerprint is null
     or p_request_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'Order request identity is invalid.' using errcode = '22023';
  end if;
  if p_notes is not null and char_length(p_notes) > 1000 then
    raise exception 'Order notes are too long.' using errcode = '22023';
  end if;
  if p_shipping_address is not null and (
       jsonb_typeof(p_shipping_address) <> 'object'
       or nullif(btrim(p_shipping_address ->> 'line'), '') is null
  ) then
    raise exception 'The delivery address is invalid.' using errcode = '22023';
  end if;
  if p_order_items is null
     or jsonb_typeof(p_order_items) <> 'array'
     or jsonb_array_length(p_order_items) < 1
     or jsonb_array_length(p_order_items) > 200 then
    raise exception 'Order lines are invalid.' using errcode = '22023';
  end if;
  if p_subtotal is null or p_gst_total is null or p_discount_total is null
     or p_grand_total is null or p_expected_coins_used_paise is null
     or p_subtotal < 0 or p_gst_total < 0 or p_discount_total < 0
     or p_grand_total < 0 or p_expected_coins_used_paise < 0 then
    raise exception 'Order totals are invalid.' using errcode = '22023';
  end if;

  -- === Lock order (global): request-key → retailer → cart → coupon →
  --     product pricing (ASC) → offer rows (shared) → stock → wallet. ===

  perform pg_advisory_xact_lock(
    hashtextextended('order-request:' || p_request_key::text, 0)
  );
  select * into v_existing
    from public.orders o
   where o.request_key = p_request_key
   for update;
  if found then
    if v_existing.retailer_id is distinct from p_retailer_id
       or v_existing.collected_by is distinct from p_collected_by then
      raise exception 'IDEMPOTENCY_CONFLICT: request key belongs to a different order owner.' using errcode = '23505';
    end if;
    if v_existing.request_fingerprint is not null
       and v_existing.request_fingerprint is distinct from p_request_fingerprint then
      raise exception 'IDEMPOTENCY_CONFLICT: request key was reused with different order details.' using errcode = '23505';
    end if;
    if v_existing.request_fingerprint is null and p_collected_by is null then
      raise exception 'IDEMPOTENCY_CONFLICT: this legacy request cannot be verified safely.' using errcode = '23505';
    end if;
    if v_existing.status = 'cancelled' then
      raise exception 'ORDER_REQUEST_CANCELLED: this request was already cancelled.' using errcode = 'P0001';
    end if;
    if v_existing.request_completed_at is null
       or not exists (select 1 from public.order_items oi where oi.order_id = v_existing.id) then
      raise exception 'ORDER_REQUEST_INCOMPLETE: this request is not finalized.' using errcode = 'P0001';
    end if;

    select coalesce(sum(w.amount_paise), 0)
      into v_ledger_coins_paise
      from public.retailer_wallet_ledger w
     where w.retailer_id = p_retailer_id
       and w.reference_type = 'order'
       and w.reference_id = v_existing.id
       and w.transaction_type = 'ORDER_DEBIT'
       and not w.is_reversed;

    return jsonb_build_object(
      'id', v_existing.id,
      'orderNumber', v_existing.order_number,
      'status', v_existing.status::text,
      'grandTotalPaise', round(v_existing.grand_total * 100)::bigint,
      'coinsUsedPaise', coalesce(v_ledger_coins_paise, 0),
      'coinsBalanceAfterPaise', v_existing.coins_balance_after_paise,
      'placedAt', v_existing.placed_at,
      'replayed', true
    );
  end if;

  select r.status::text, r.assigned_salesman_id
    into v_retailer_status, v_assigned_salesman_id
    from public.retailers r
   where r.id = p_retailer_id
   for update;
  if not found or v_retailer_status <> 'active' then
    raise exception 'RETAILER_NOT_ACTIVE: orders require an active retailer.' using errcode = '42501';
  end if;
  if p_collected_by is null then
    if not exists (
      select 1 from public.profiles pr
       where pr.id = p_retailer_id and pr.role = 'retailer' and pr.is_active
    ) then
      raise exception 'RETAILER_NOT_ACTIVE: retailer profile is not eligible to order.' using errcode = '42501';
    end if;
  else
    if not exists (
      select 1 from public.profiles pr
       where pr.id = p_collected_by and pr.role = 'salesman' and pr.is_active
    ) or v_assigned_salesman_id is distinct from p_collected_by then
      raise exception 'RETAILER_ASSIGNMENT_REQUIRED: only the assigned active salesman may capture this order.' using errcode = '42501';
    end if;
  end if;

  -- Structural reconciliation on LINE IDENTITY (pack + offer), not pack alone.
  select count(*),
         count(distinct (r.pack_id::text || '|' || coalesce(r.seller_offer_id::text, 'm'))),
         round(coalesce(sum(r.line_total), 0), 2)
    into v_item_count, v_line_identity_count, v_line_total
    from jsonb_to_recordset(p_order_items) as r(
      pack_id uuid, seller_offer_id uuid, quantity integer, unit_price numeric,
      gst_percent numeric, line_total numeric
    );
  if v_item_count <> v_line_identity_count or v_item_count < 1 then
    raise exception 'ORDER_QUOTE_INVALID: order lines contain duplicate or missing line identities.' using errcode = '22023';
  end if;
  if exists (
    select 1
      from jsonb_to_recordset(p_order_items) as r(
        pack_id uuid, seller_offer_id uuid, quantity integer, unit_price numeric,
        gst_percent numeric, line_total numeric
      )
     where r.pack_id is null or r.quantity is null or r.quantity < 1 or r.quantity > 100000
        or r.unit_price is null or r.unit_price <= 0
        or r.gst_percent is null or r.gst_percent < 0 or r.gst_percent > 100
        or r.line_total is null or r.line_total <= 0
        or round(r.unit_price * r.quantity, 2) <> round(r.line_total, 2)
  ) then
    raise exception 'ORDER_QUOTE_INVALID: an order line is not a valid server-priced piece line.' using errcode = '22023';
  end if;
  select round(coalesce(sum(
           case when r.gst_percent = 0 then 0
                else round((r.line_total * r.gst_percent) / (100 + r.gst_percent), 2)
           end
         ), 0), 2)
    into v_expected_gst
    from jsonb_to_recordset(p_order_items) as r(
      pack_id uuid, seller_offer_id uuid, quantity integer, unit_price numeric,
      gst_percent numeric, line_total numeric
    );
  if round(v_line_total, 2) <> round(p_subtotal + p_gst_total, 2)
     or round(v_expected_gst, 2) <> round(p_gst_total, 2)
     or round(p_subtotal + p_gst_total - p_discount_total, 2) <> round(p_grand_total, 2) then
    raise exception 'ORDER_QUOTE_INVALID: order totals do not reconcile with the quoted lines.' using errcode = '22023';
  end if;

  -- Fulfilment profile from the quoted lines (pack stock vs seller stock).
  select count(*) filter (where r.seller_offer_id is null or
           exists (select 1 from public.seller_offers so
                    where so.id = r.seller_offer_id and so.fulfilment_type = 'maharani')),
         count(*) filter (where r.seller_offer_id is not null),
         count(*) filter (where r.seller_offer_id is not null and
           exists (select 1 from public.seller_offers so
                    where so.id = r.seller_offer_id and so.fulfilment_type = 'seller'))
    into v_maharani_count, v_seller_line_count, v_item_count
    from jsonb_to_recordset(p_order_items) as r(pack_id uuid, seller_offer_id uuid);
  if v_maharani_count > 0 and v_item_count > 0 then
    v_profile := 'mixed';
  elsif v_item_count > 0 then
    v_profile := 'all_seller';
  else
    v_profile := 'all_maharani';
  end if;

  -- Warehouse rule (0054 trigger re-enforces profile-conditional): seller-only
  -- orders need no warehouse; anything touching pack stock needs exactly one.
  if v_profile <> 'all_seller' then
    if (select count(*) from public.warehouses w where w.is_active) <> 1 then
      raise exception 'WAREHOUSE_CONFIGURATION_ERROR: exactly one active warehouse is required.' using errcode = '22023';
    end if;
  end if;

  if p_clear_cart_after_order then
    perform pg_advisory_xact_lock(
      hashtextextended('retailer-cart:' || p_retailer_id::text, 0)
    );
    perform 1 from public.cart_items ci
     where ci.retailer_id = p_retailer_id
     order by ci.id
     for update;

    select count(*),
           count(distinct (r.pack_id::text || '|' || coalesce(r.seller_offer_id::text, 'm')))
      into v_item_count, v_line_identity_count
      from jsonb_to_recordset(p_order_items) as r(pack_id uuid, seller_offer_id uuid, quantity integer);
    if v_item_count <> v_line_identity_count
       or (select count(*) from public.cart_items ci where ci.retailer_id = p_retailer_id) <> v_item_count
       or exists (
         select ci.pack_id, ci.seller_offer_id, ci.quantity from public.cart_items ci where ci.retailer_id = p_retailer_id
         except
         select r.pack_id, r.seller_offer_id, r.quantity from jsonb_to_recordset(p_order_items) as r(pack_id uuid, seller_offer_id uuid, quantity integer)
       )
       or exists (
         select r.pack_id, r.seller_offer_id, r.quantity from jsonb_to_recordset(p_order_items) as r(pack_id uuid, seller_offer_id uuid, quantity integer)
         except
         select ci.pack_id, ci.seller_offer_id, ci.quantity from public.cart_items ci where ci.retailer_id = p_retailer_id
       ) then
      raise exception 'CART_CHANGED: the saved cart changed after it was reviewed.' using errcode = '40001';
    end if;
  end if;

  if p_clear_cart_after_order then
    perform pg_advisory_xact_lock(
      hashtextextended('retailer-coupon:' || p_retailer_id::text, 0)
    );
  end if;

  -- Coupon snapshot checks — exact mirror of the v1 block.
  if p_coupon_id is null then
    if coalesce(p_coupon_code, '') <> ''
       or coalesce(p_coupon_discount, 0) <> 0
       or p_discount_total <> 0 then
      raise exception 'COUPON_INVALID: coupon snapshot does not match the quote.' using errcode = '22023';
    end if;
    if p_clear_cart_after_order and exists (
      select 1 from public.retailer_active_coupons rac where rac.retailer_id = p_retailer_id
    ) then
      raise exception 'COUPON_INVALID: the active coupon changed after the quote.' using errcode = '40001';
    end if;
  else
    if nullif(btrim(p_coupon_code), '') is null
       or p_coupon_discount is null
       or round(p_coupon_discount, 2) <> round(p_discount_total, 2) then
      raise exception 'COUPON_INVALID: coupon snapshot does not match the quote.' using errcode = '22023';
    end if;
    select rac.coupon_id into v_active_coupon_id
      from public.retailer_active_coupons rac
     where rac.retailer_id = p_retailer_id
     for update;
    if v_active_coupon_id is distinct from p_coupon_id then
      raise exception 'COUPON_INVALID: the active coupon changed after the quote.' using errcode = '40001';
    end if;

    select * into v_coupon
      from public.coupons c
     where c.id = p_coupon_id
     for update;
    if not found
       or v_coupon.is_active is not true
       or now() < v_coupon.starts_at
       or now() > v_coupon.expires_at
       or (v_coupon.retailer_id is not null and v_coupon.retailer_id <> p_retailer_id)
       or upper(btrim(v_coupon.code)) <> upper(btrim(p_coupon_code)) then
      raise exception 'COUPON_INVALID: this coupon is no longer eligible.' using errcode = '23514';
    end if;
  end if;

  -- Product pricing locks (same as v1), stable ASC order.
  for v_item in
    select distinct pp.product_id
      from jsonb_to_recordset(p_order_items) as r(pack_id uuid)
      join public.product_packs pp on pp.id = r.pack_id
     order by pp.product_id
  loop
    perform pg_advisory_xact_lock(
      hashtextextended('retailer-pricing:' || v_item.product_id::text, 0)
    );
  end loop;

  -- Per-line revalidation: Maharani lines mirror v1 exactly; seller lines
  -- revalidate offer + seller + floor + offer price under a shared row lock.
  for v_item in
    select r.pack_id, r.seller_offer_id, r.quantity, r.unit_price, r.gst_percent, r.line_total
      from jsonb_to_recordset(p_order_items) as r(
        pack_id uuid, seller_offer_id uuid, quantity integer, unit_price numeric,
        gst_percent numeric, line_total numeric
      )
     order by r.pack_id, r.seller_offer_id nulls first
  loop
    if v_item.seller_offer_id is null then
      select pp.product_id, pp.units_per_case, pp.moq, pp.is_active, p.is_active,
             p.gst_percent, pp.case_price, pp.ptr, pp.base_price, r.area_id
        into v_product_id, v_units_per_case, v_moq, v_pack_active, v_product_active,
             v_gst_percent, v_pack_case_price, v_pack_ptr, v_pack_base_price, v_retailer_area_id
        from public.product_packs pp
        join public.products p on p.id = pp.product_id
        join public.retailers r on r.id = p_retailer_id
       where pp.id = v_item.pack_id
       for share of pp, p;
      if not found or not v_pack_active or not v_product_active then
        raise exception 'PACK_UNAVAILABLE: a selected pack is no longer active.' using errcode = '23514';
      end if;
      if v_item.quantity < v_moq then
        raise exception 'MINIMUM_ORDER_QUANTITY: minimum is % pieces for this pack.', v_moq using errcode = '23514';
      end if;
      if round(v_item.gst_percent, 2) is distinct from round(v_gst_percent, 2) then
        raise exception 'ORDER_PRICE_CHANGED: the GST rate changed after the quote.' using errcode = '40001';
      end if;

      select pl.price
        into v_product_override
        from public.price_lists pl
       where pl.product_id = v_product_id
         and pl.scope = 'retailer'
         and pl.retailer_id = p_retailer_id
         and pl.is_active
         and pl.valid_from <= now()
       order by pl.priority desc
       limit 1;
      if v_product_override is null and v_retailer_area_id is not null then
        select pl.price
          into v_product_override
          from public.price_lists pl
         where pl.product_id = v_product_id
           and pl.scope = 'area'
           and pl.area_id = v_retailer_area_id
           and pl.is_active
           and pl.valid_from <= now()
         order by pl.priority desc
         limit 1;
      end if;
      v_current_case_price := coalesce(v_product_override, v_pack_case_price, v_pack_ptr, v_pack_base_price);

      -- 0082 — retailer category tier pricing is authoritative. When a category
      -- price is configured for this pack + the retailer's category, it prices
      -- the line and no slab/override/case fallback applies. The helper returns
      -- NULL when no category price is configured, so every pre-existing
      -- pricing rule is byte-for-byte unchanged for those packs.
      v_category_piece_price := public.pack_category_price_per_piece(v_item.pack_id, p_retailer_id);
      if v_category_piece_price is not null then
        if round(v_item.unit_price, 2) is distinct from round(v_category_piece_price, 2) then
          raise exception 'ORDER_PRICE_CHANGED: the retailer category price changed after the quote.' using errcode = '40001';
        end if;
        continue;
      end if;

      select exists (
        select 1 from public.product_pricing_tiers ppt
         where ppt.product_pack_id = v_item.pack_id
           and ppt.is_active and ppt.rule_type = 'loose'
      ) into v_has_explicit_loose_tier;

      select ppt.price_per_piece
        into v_current_tier_price
        from public.product_pricing_tiers ppt
       where ppt.product_pack_id = v_item.pack_id
         and ppt.is_active
         and ((v_has_explicit_loose_tier and ppt.rule_type = 'loose')
           or (not v_has_explicit_loose_tier and ppt.rule_type <> 'case'))
         and ppt.min_quantity >= 1
         and ppt.min_quantity < v_units_per_case
         and (ppt.max_quantity is null or ppt.max_quantity > ppt.min_quantity)
         and ppt.min_quantity <= v_item.quantity
         and (ppt.max_quantity is null or v_item.quantity < ppt.max_quantity)
       order by ppt.min_quantity asc
       limit 1;
      if not found then
        select ppt.price_per_piece
          into v_current_tier_price
          from public.product_pricing_tiers ppt
         where ppt.product_pack_id = v_item.pack_id
           and ppt.is_active
           and ((v_has_explicit_loose_tier and ppt.rule_type = 'loose')
             or (not v_has_explicit_loose_tier and ppt.rule_type <> 'case'))
           and ppt.min_quantity >= 1
           and ppt.min_quantity < v_units_per_case
           and (ppt.max_quantity is null or ppt.max_quantity > ppt.min_quantity)
         order by ppt.min_quantity desc
         limit 1;
      end if;

      if v_current_tier_price is null then
        v_expected_unit_price := round(v_current_case_price / greatest(v_units_per_case, 1), 2);
      else
        v_expected_unit_price := v_current_tier_price;
      end if;
      if round(v_item.unit_price, 2) is distinct from round(v_expected_unit_price, 2) then
        raise exception 'ORDER_PRICE_CHANGED: the selling price changed after the quote.' using errcode = '40001';
      end if;
    else
      -- Seller offer line.
      select so.product_id, so.pack_id, so.fulfilment_type, so.unit_price_paise,
             so.moq, so.stock_quantity, so.is_active, so.moderation_status,
             so.seller_id, p.gst_percent, s.status
        into v_offer_product, v_offer_pack, v_offer_fulfilment, v_offer_price_paise,
             v_offer_moq, v_offer_stock, v_offer_active, v_offer_moderation,
             v_offer_seller, v_gst_percent, v_seller_status
        from public.seller_offers so
        join public.products p on p.id = so.product_id
        join public.sellers s on s.id = so.seller_id
       where so.id = v_item.seller_offer_id
       for share of so, s;
      if not found or not v_offer_active or v_offer_moderation <> 'approved'
         or v_seller_status <> 'active'
         or v_offer_pack is distinct from v_item.pack_id then
        raise exception 'OFFER_UNAVAILABLE: a selected seller offer is no longer available.' using errcode = '23514';
      end if;
      v_floor := public.current_offer_floor_paise(v_item.pack_id);
      if v_floor is not null and v_offer_price_paise < v_floor then
        raise exception 'PRICE_BELOW_FLOOR: the offer price is below the admin minimum for this pack.' using errcode = '23514';
      end if;
      if v_item.quantity < greatest(v_offer_moq, 1) then
        raise exception 'MINIMUM_ORDER_QUANTITY: minimum is % pieces for this seller offer.', greatest(v_offer_moq, 1) using errcode = '23514';
      end if;
      if round(v_item.gst_percent, 2) is distinct from round(v_gst_percent, 2) then
        raise exception 'ORDER_PRICE_CHANGED: the GST rate changed after the quote.' using errcode = '40001';
      end if;
      v_expected_unit_price := round(v_offer_price_paise::numeric / 100, 2);
      if round(v_item.unit_price, 2) is distinct from round(v_expected_unit_price, 2) then
        raise exception 'ORDER_PRICE_CHANGED: the seller offer price changed after the quote.' using errcode = '40001';
      end if;
      if v_offer_fulfilment = 'seller' and v_offer_stock is not null and v_item.quantity > v_offer_stock then
        raise exception 'INSUFFICIENT_STOCK: only % available for this seller offer.', v_offer_stock using errcode = '23514';
      end if;
    end if;
  end loop;

  -- Coupon eligibility: exact mirror of v1 (GST-exclusive, product filters),
  -- now over the split line set (seller lines eligible by their product too).
  if p_coupon_id is not null then
    if p_subtotal < v_coupon.minimum_order_value then
      raise exception 'COUPON_INVALID: the order no longer meets the coupon minimum.' using errcode = '23514';
    end if;

    select round(coalesce(sum(
             r.line_total - case when r.gst_percent = 0 then 0
                                 else round((r.line_total * r.gst_percent) / (100 + r.gst_percent), 2)
                            end
           ), 0), 2)
      into v_coupon_eligible_subtotal
      from jsonb_to_recordset(p_order_items) as r(
        pack_id uuid, seller_offer_id uuid, quantity integer, unit_price numeric,
        gst_percent numeric, line_total numeric
      )
      join public.product_packs pp on pp.id = r.pack_id
      join public.products p on p.id = pp.product_id
     where r.line_total > 0
       and (v_coupon.category_id is null or p.category_id = v_coupon.category_id)
       and (v_coupon.brand_id is null or p.brand_id = v_coupon.brand_id)
       and (v_coupon.product_id is null or p.id = v_coupon.product_id)
       and r.line_total - case when r.gst_percent = 0 then 0
                               else round((r.line_total * r.gst_percent) / (100 + r.gst_percent), 2)
                          end > 0;

    if (v_coupon.category_id is not null or v_coupon.brand_id is not null or v_coupon.product_id is not null)
       and coalesce(v_coupon_eligible_subtotal, 0) <= 0 then
      raise exception 'COUPON_INVALID: the coupon no longer applies to these products.' using errcode = '23514';
    end if;

    if v_coupon.discount_type = 'percentage' then
      v_expected_coupon_discount := round(v_coupon_eligible_subtotal * v_coupon.discount_value / 100, 2);
      if v_coupon.maximum_discount is not null and v_coupon.maximum_discount > 0 then
        v_expected_coupon_discount := least(v_expected_coupon_discount, v_coupon.maximum_discount);
      end if;
    else
      v_expected_coupon_discount := v_coupon.discount_value;
    end if;
    v_expected_coupon_discount := round(
      least(greatest(coalesce(v_expected_coupon_discount, 0), 0), coalesce(v_coupon_eligible_subtotal, 0)),
      2
    );

    if v_expected_coupon_discount <= 0
       or round(p_coupon_discount, 2) is distinct from v_expected_coupon_discount
       or round(p_discount_total, 2) is distinct from v_expected_coupon_discount then
      raise exception 'COUPON_INVALID: the coupon discount changed after the quote.' using errcode = '40001';
    end if;
  end if;

  -- === Commit phase: parent → children → lines → coupon → coins → finalize. ===

  v_parent_gross_paise := round((p_subtotal + p_gst_total) * 100)::bigint;
  v_parent_gst_paise := round(p_gst_total * 100)::bigint;
  v_coupon_discount_paise := round(coalesce(p_coupon_discount, 0) * 100)::bigint;

  insert into public.orders (
    retailer_id, collected_by, status, subtotal, gst_total, discount_total,
    grand_total, notes, shipping_address, coupon_id, coupon_code,
    coupon_discount, request_key, request_fingerprint, fulfilment_profile
  ) values (
    p_retailer_id, p_collected_by, 'pending', p_subtotal, p_gst_total,
    p_discount_total, p_grand_total, nullif(btrim(p_notes), ''),
    p_shipping_address, p_coupon_id, nullif(upper(btrim(p_coupon_code)), ''),
    coalesce(p_coupon_discount, 0), p_request_key, p_request_fingerprint, v_profile
  ) returning * into v_order;

  -- Build children: one maharani pack-stock child (if any pack-stock lines)
  -- plus one child per seller, in stable sort order (maharani first, then
  -- seller id ASC). sort_index is the largest-remainder tie-break base.
  create temp table if not exists tmp_v2_children (
    sort_index integer primary key,
    child_id uuid,
    seller_id uuid,
    fulfilment_type text,
    gross_paise bigint default 0,
    gst_paise bigint default 0,
    coupon_base_paise bigint default 0,
    payable_before_coins bigint default 0
  ) on commit drop;
  delete from tmp_v2_children;

  v_child_counter := 0;
  if v_maharani_count > 0 then
    insert into tmp_v2_children (sort_index, seller_id, fulfilment_type)
    values (v_child_counter, null, 'maharani');
    v_child_counter := v_child_counter + 1;
  end if;
  for v_child in
    select distinct so.seller_id,
           min(case when so.fulfilment_type = 'seller' then 'seller' else 'maharani' end) as any_seller,
           max(case when so.fulfilment_type = 'seller' then 1 else 0 end) as has_seller_stock
      from jsonb_to_recordset(p_order_items) as r(seller_offer_id uuid)
      join public.seller_offers so on so.id = r.seller_offer_id
     where r.seller_offer_id is not null
     group by so.seller_id
     order by so.seller_id
  loop
    insert into tmp_v2_children (sort_index, seller_id, fulfilment_type)
    values (
      v_child_counter,
      v_child.seller_id,
      case when v_child.has_seller_stock = 1 then 'seller' else 'maharani' end
    );
    v_child_counter := v_child_counter + 1;
  end loop;

  -- Per-child money accumulation from the reconciled lines.
  for v_item in
    select r.pack_id, r.seller_offer_id, r.quantity, r.unit_price, r.gst_percent, r.line_total
      from jsonb_to_recordset(p_order_items) as r(
        pack_id uuid, seller_offer_id uuid, quantity integer, unit_price numeric,
        gst_percent numeric, line_total numeric
      )
  loop
    select so.seller_id, so.fulfilment_type
      into v_offer_seller, v_offer_fulfilment
      from public.seller_offers so
     where so.id = v_item.seller_offer_id;

    v_line_gst := case when v_item.gst_percent = 0 then 0
                       else round((v_item.line_total * v_item.gst_percent) / (100 + v_item.gst_percent), 2)
                  end;
    v_line_gst_paise := round(v_line_gst * 100)::bigint;

    if v_item.seller_offer_id is null then
      update tmp_v2_children
         set gross_paise = gross_paise + round(v_item.line_total * 100)::bigint,
             gst_paise = gst_paise + v_line_gst_paise
       where seller_id is null;
    else
      update tmp_v2_children
         set gross_paise = gross_paise + round(v_item.line_total * 100)::bigint,
             gst_paise = gst_paise + v_line_gst_paise
       where seller_id = v_offer_seller;
    end if;

    -- Coupon eligibility base (GST-exclusive) per child — ineligible stays 0.
    if p_coupon_id is not null
       and v_item.line_total > 0
       and (v_coupon.category_id is null
            or exists (select 1 from public.product_packs pp join public.products p on p.id = pp.product_id
                        where pp.id = v_item.pack_id and p.category_id = v_coupon.category_id))
       and (v_coupon.brand_id is null
            or exists (select 1 from public.product_packs pp join public.products p on p.id = pp.product_id
                        where pp.id = v_item.pack_id and p.brand_id = v_coupon.brand_id))
       and (v_coupon.product_id is null
            or exists (select 1 from public.product_packs pp
                        where pp.id = v_item.pack_id and pp.product_id = v_coupon.product_id)) then
      update tmp_v2_children
         set coupon_base_paise = coupon_base_paise
             + greatest(0, round(v_item.line_total * 100)::bigint - v_line_gst_paise)
       where seller_id is not distinct from
             case when v_item.seller_offer_id is null then null else v_offer_seller end;
    end if;
  end loop;

  -- Largest-remainder shares (stable sort_index order): coupon over eligible
  -- GST-exclusive bases (ineligible children get 0), coins over post-coupon
  -- payable. Shares sum EXACTLY to the parent amounts.
  select array_agg(sort_index order by sort_index),
         array_agg(gross_paise order by sort_index),
         array_agg(gst_paise order by sort_index),
         array_agg(coupon_base_paise order by sort_index)
    into v_child_sort, v_child_gross, v_child_gst, v_child_coupon_base
    from tmp_v2_children;

  v_coupon_shares := public.allocate_largest_remainder(v_coupon_discount_paise, v_child_coupon_base);

  update tmp_v2_children
     set payable_before_coins = gross_paise - v_coupon_shares[sort_index + 1];

  select array_agg(payable_before_coins order by sort_index)
    into v_child_payable_before_coins
    from tmp_v2_children;

  v_order_total_paise := round(p_grand_total * 100)::bigint;
  v_coins_used_paise := least(
    greatest(0, public.get_retailer_available_credit_paise(p_retailer_id)),
    v_order_total_paise
  );
  if p_expected_coins_used_paise <> v_coins_used_paise then
    raise exception 'COIN_BALANCE_CHANGED: the available coin balance changed after the quote.' using errcode = '40001';
  end if;

  v_coins_shares := public.allocate_largest_remainder(
    least(v_coins_used_paise, (select coalesce(sum(payable_before_coins), 0) from tmp_v2_children)),
    v_child_payable_before_coins
  );

  -- Persist children with immutable snapshots.
  for v_child in
    select * from tmp_v2_children order by sort_index
  loop
    insert into public.sub_orders (
      parent_order_id, seller_id, fulfilment_type, status, sort_index,
      gross_paise, gst_paise, coupon_share_paise, coins_share_paise, payable_paise,
      commission_basis
    ) values (
      v_order.id,
      v_child.seller_id,
      v_child.fulfilment_type,
      'pending',
      v_child.sort_index,
      v_child.gross_paise,
      v_child.gst_paise,
      v_coupon_shares[v_child.sort_index + 1],
      v_coins_shares[v_child.sort_index + 1],
      v_child.gross_paise - v_coupon_shares[v_child.sort_index + 1] - v_coins_shares[v_child.sort_index + 1],
      'undecided'
    ) returning * into v_sub;

    v_child_ids := array_append(v_child_ids, v_sub.id);
    v_child_coupon_total := v_child_coupon_total + v_coupon_shares[v_child.sort_index + 1];
    v_child_coins_total := v_child_coins_total + v_coins_shares[v_child.sort_index + 1];
    v_children_json := v_children_json || jsonb_build_array(jsonb_build_object(
      'id', v_sub.id,
      'sellerId', v_sub.seller_id,
      'fulfilmentType', v_sub.fulfilment_type,
      'sortIndex', v_sub.sort_index,
      'grossPaise', v_sub.gross_paise,
      'gstPaise', v_sub.gst_paise,
      'couponSharePaise', v_sub.coupon_share_paise,
      'coinsSharePaise', v_sub.coins_share_paise,
      'payablePaise', v_sub.payable_paise
    ));

    if v_sub.seller_id is null then
      v_maharani_child_id := v_sub.id;
    end if;
  end loop;

  if v_child_coupon_total <> v_coupon_discount_paise
     or v_child_coins_total <> v_coins_used_paise then
    raise exception 'ALLOCATION_MISMATCH: child shares must sum exactly to the parent amounts.' using errcode = '22023';
  end if;
  if exists (select 1 from public.sub_orders where parent_order_id = v_order.id and payable_paise < 0) then
    raise exception 'ALLOCATION_MISMATCH: a child cannot carry a negative payable.' using errcode = '22023';
  end if;

  -- Lines: route to children, with the source-aware 0054/0065 deduction
  -- trigger firing per line (atomic; any failure rolls back everything).
  for v_item in
    select r.pack_id, r.seller_offer_id, r.quantity, r.unit_price, r.gst_percent, r.line_total
      from jsonb_to_recordset(p_order_items) as r(
        pack_id uuid, seller_offer_id uuid, quantity integer, unit_price numeric,
        gst_percent numeric, line_total numeric
      )
     order by r.pack_id, r.seller_offer_id nulls first
  loop
    select pp.product_id, pp.units_per_case
      into v_product_id, v_units_per_case
      from public.product_packs pp
     where pp.id = v_item.pack_id;

    if v_item.seller_offer_id is null then
      insert into public.order_items (
        order_id, product_id, pack_id, quantity, quantity_unit,
        quantity_pieces, units_per_case, unit_price, gst_percent, line_total,
        sub_order_id, seller_offer_id, source_type, fulfilment_type
      ) values (
        v_order.id, v_product_id, v_item.pack_id, v_item.quantity, 'pieces',
        v_item.quantity, v_units_per_case, v_item.unit_price,
        v_item.gst_percent, v_item.line_total,
        v_maharani_child_id, null, 'maharani', 'maharani'
      );
    else
      select so.seller_id, so.fulfilment_type
        into v_offer_seller, v_offer_fulfilment
        from public.seller_offers so
       where so.id = v_item.seller_offer_id;

      insert into public.order_items (
        order_id, product_id, pack_id, quantity, quantity_unit,
        quantity_pieces, units_per_case, unit_price, gst_percent, line_total,
        sub_order_id, seller_offer_id, source_type, fulfilment_type
      ) values (
        v_order.id, v_product_id, v_item.pack_id, v_item.quantity, 'pieces',
        v_item.quantity, v_units_per_case, v_item.unit_price,
        v_item.gst_percent, v_item.line_total,
        (select id from public.sub_orders
          where parent_order_id = v_order.id and seller_id = v_offer_seller),
        v_item.seller_offer_id,
        'seller',
        v_offer_fulfilment
      );
    end if;
  end loop;

  if p_coupon_id is not null then
    if not public.redeem_coupon(
      p_coupon_id, p_retailer_id, v_order.id, p_coupon_discount
    ) then
      raise exception 'COUPON_INVALID: this coupon is no longer eligible.' using errcode = '23514';
    end if;
    delete from public.retailer_active_coupons rac
     where rac.retailer_id = p_retailer_id and rac.coupon_id = p_coupon_id;
  end if;

  -- Coins are the payment layer: one ORDER_DEBIT per child, keys scoped to the
  -- child ('order:<parent>:<child>') with reference_id = parent id so legacy
  -- order-level replay sums stay exact.
  if v_coins_used_paise > 0 then
    for v_child in
      select * from public.sub_orders where parent_order_id = v_order.id order by sort_index
    loop
      if v_coins_shares[v_child.sort_index + 1] > 0 then
        perform public.check_and_debit_retailer_wallet(
          p_retailer_id,
          v_order.id,
          v_coins_shares[v_child.sort_index + 1],
          'order:' || v_order.id::text || ':' || v_child.id::text,
          coalesce(p_collected_by, p_retailer_id),
          'Order ' || v_order.order_number || ' — ₹' || to_char(p_grand_total, 'FM999999990.00')
        );
      end if;
    end loop;
  end if;

  v_coins_balance_after_paise := greatest(
    0,
    public.get_retailer_available_credit_paise(p_retailer_id)
  );
  update public.orders
     set coins_balance_after_paise = v_coins_balance_after_paise
   where id = v_order.id;

  if p_request_key is not null then
    update public.orders
       set request_completed_at = now()
     where id = v_order.id;
  end if;

  if p_clear_cart_after_order then
    delete from public.cart_items ci where ci.retailer_id = p_retailer_id;
  end if;

  return jsonb_build_object(
    'id', v_order.id,
    'orderNumber', v_order.order_number,
    'status', v_order.status::text,
    'grandTotalPaise', v_order_total_paise,
    'coinsUsedPaise', v_coins_used_paise,
    'coinsBalanceAfterPaise', v_coins_balance_after_paise,
    'placedAt', v_order.placed_at,
    'replayed', false,
    'fulfilmentProfile', v_profile,
    'subOrders', v_children_json
  );
end;
$$;

-- ============================================================================
-- END OF MIGRATION 0082
-- ============================================================================
