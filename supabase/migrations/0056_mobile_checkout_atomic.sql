-- ============================================================================
-- 0056: Native checkout foundation — one server-only order transaction
--
-- The native client sends intent (pack ids, piece quantities, notes, address
-- id and a request key). TypeScript re-prices through quoteOrderForRetailer;
-- this RPC validates the reconciled quote and atomically writes the order,
-- order lines, pack stock, coupon redemption, wallet debit, request completion,
-- and (for retailer self-checkout) the exact cart snapshot.
--
-- No client may insert an order/line or call the underlying coupon/debit RPCs.
-- Existing read/status/fulfilment policies and the simplified-stock model stay
-- in place. No existing rows are rewritten or deleted by this migration.
-- ============================================================================

alter table public.orders
  add column if not exists request_fingerprint text;

-- Keep the wallet position immediately after this order's Coins debit as a
-- server snapshot. It is distinct from the unpaid amount (grand total minus
-- Coins used) and lets an idempotent recovery report the same transaction fact.
alter table public.orders
  add column if not exists coins_balance_after_paise bigint;

comment on column public.orders.coins_balance_after_paise is
  '0056: retailer wallet/Coins balance in integer paise immediately after this order debit; NULL for historical orders without a verifiable snapshot.';

alter table public.orders
  drop constraint if exists orders_request_fingerprint_sha256;
alter table public.orders
  add constraint orders_request_fingerprint_sha256
    check (request_fingerprint is null or request_fingerprint ~ '^[0-9a-f]{64}$');

comment on column public.orders.request_fingerprint is
  'SHA-256 of the canonical server-validated order intent associated with request_key. Used to reject key reuse with different lines/notes/address context; never contains raw address or notes.';

comment on column public.orders.request_key is
  'Optional UUID idempotency key. New mobile retailer and salesman submissions store a request_fingerprint and are finalized in the same create_order_atomic transaction.';

-- ---------------------------------------------------------------------------
-- Lock all cart writes by retailer. The order transaction takes this same
-- advisory lock before comparing the persisted basket, so a concurrent add,
-- update or remove cannot slip between the snapshot check and cart clearing.
-- ---------------------------------------------------------------------------
create or replace function public.serialize_retailer_cart_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_retailer_id uuid;
begin
  if tg_op = 'DELETE' then
    v_retailer_id := old.retailer_id;
  else
    v_retailer_id := new.retailer_id;
  end if;

  if v_retailer_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('retailer-cart:' || v_retailer_id::text, 0)
    );
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_serialize_retailer_cart_mutation on public.cart_items;
create trigger trg_serialize_retailer_cart_mutation
  before insert or update or delete on public.cart_items
  for each row execute function public.serialize_retailer_cart_mutation();
revoke all on function public.serialize_retailer_cart_mutation() from public, anon, authenticated, service_role;

-- Pricing data can change after TypeScript quotes but before the atomic order
-- RPC runs. A product-scoped advisory lock serializes those edits with the
-- final quote comparison without globally locking the catalog tables.
create or replace function public.lock_retailer_pricing_product()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_product_ids uuid[] := array[]::uuid[];
  v_pack_ids uuid[] := array[]::uuid[];
  v_product_id uuid;
begin
  if tg_table_name in ('product_packs', 'price_lists') then
    if tg_op <> 'INSERT' then
      v_product_ids := array_append(v_product_ids, old.product_id);
    end if;
    if tg_op <> 'DELETE' then
      v_product_ids := array_append(v_product_ids, new.product_id);
    end if;
  elsif tg_table_name = 'products' then
    if tg_op <> 'INSERT' then
      v_product_ids := array_append(v_product_ids, old.id);
    end if;
    if tg_op <> 'DELETE' then
      v_product_ids := array_append(v_product_ids, new.id);
    end if;
  elsif tg_table_name = 'product_pricing_tiers' then
    if tg_op <> 'INSERT' then
      v_pack_ids := array_append(v_pack_ids, old.product_pack_id);
    end if;
    if tg_op <> 'DELETE' then
      v_pack_ids := array_append(v_pack_ids, new.product_pack_id);
    end if;
    for v_product_id in
      select distinct pp.product_id
        from public.product_packs pp
       where pp.id = any(v_pack_ids)
       order by pp.product_id
    loop
      perform pg_advisory_xact_lock(
        hashtextextended('retailer-pricing:' || v_product_id::text, 0)
      );
    end loop;
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  for v_product_id in
    select distinct ids.product_id
      from unnest(v_product_ids) as ids(product_id)
     where ids.product_id is not null
     order by ids.product_id
  loop
    perform pg_advisory_xact_lock(
      hashtextextended('retailer-pricing:' || v_product_id::text, 0)
    );
  end loop;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_lock_product_pack_pricing on public.product_packs;
drop trigger if exists trg_lock_product_pricing on public.products;
drop trigger if exists trg_lock_price_list_pricing on public.price_lists;
drop trigger if exists trg_lock_pricing_tier_mutation on public.product_pricing_tiers;

create trigger trg_lock_product_pack_pricing
  before insert or update or delete on public.product_packs
  for each row execute function public.lock_retailer_pricing_product();
create trigger trg_lock_product_pricing
  before insert or update or delete on public.products
  for each row execute function public.lock_retailer_pricing_product();
create trigger trg_lock_price_list_pricing
  before insert or update or delete on public.price_lists
  for each row execute function public.lock_retailer_pricing_product();
create trigger trg_lock_pricing_tier_mutation
  before insert or update or delete on public.product_pricing_tiers
  for each row execute function public.lock_retailer_pricing_product();
revoke all on function public.lock_retailer_pricing_product() from public, anon, authenticated, service_role;

-- Limited historical cart identity is needed when a product/pack becomes
-- inactive: its owner must still be able to identify and remove that saved
-- line. This SECURITY DEFINER read returns no price, stock count, or other
-- retailer's data, and derives the owner exclusively from auth.uid().
create or replace function public.get_retailer_cart_lines()
returns table(
  cart_item_id uuid,
  pack_id uuid,
  quantity integer,
  product_id uuid,
  product_name text,
  pack_name text,
  units_per_case integer,
  moq integer,
  pack_active boolean,
  product_active boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null
     or public.current_user_role() is distinct from 'retailer'
     or not exists (
       select 1 from public.profiles pr
        where pr.id = auth.uid() and pr.role = 'retailer' and pr.is_active
     )
     or not exists (
       select 1 from public.retailers r
        where r.id = auth.uid() and r.status = 'active'
     ) then
    raise exception 'An active retailer session is required.' using errcode = '42501';
  end if;

  return query
  select ci.id,
         ci.pack_id,
         ci.quantity,
         pp.product_id,
         p.name,
         pp.pack_name,
         pp.units_per_case,
         pp.moq,
         pp.is_active,
         p.is_active
    from public.cart_items ci
    left join public.product_packs pp on pp.id = ci.pack_id
    left join public.products p on p.id = pp.product_id
   where ci.retailer_id = auth.uid()
   order by ci.id;
end;
$$;
revoke all on function public.get_retailer_cart_lines() from public, anon;
grant execute on function public.get_retailer_cart_lines() to authenticated;

-- Add/update exactly one saved piece quantity with compare-and-set semantics.
-- The TypeScript service validates the FINAL quantity using the canonical
-- retailer quote/pricing engine; this database boundary repeats identity,
-- active-pack and MOQ checks and prevents lost updates under concurrent taps.
create or replace function public.mutate_retailer_cart_line(
  p_pack_id uuid,
  p_cart_item_id uuid,
  p_expected_quantity integer,
  p_quantity integer
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_retailer_id uuid := auth.uid();
  v_cart_item_id uuid;
  v_actual_pack_id uuid;
  v_current_quantity integer;
  v_moq integer;
  v_pack_active boolean;
  v_product_active boolean;
begin
  if v_retailer_id is null
     or public.current_user_role() is distinct from 'retailer'
     or not exists (
       select 1 from public.profiles pr
        where pr.id = v_retailer_id and pr.role = 'retailer' and pr.is_active
     )
     or not exists (
       select 1 from public.retailers r
        where r.id = v_retailer_id and r.status = 'active'
     ) then
    raise exception 'An active retailer session is required.' using errcode = '42501';
  end if;
  if p_pack_id is null
     or p_expected_quantity is null or p_expected_quantity < 0 or p_expected_quantity > 100000
     or p_quantity is null or p_quantity < 1 or p_quantity > 100000 then
    raise exception 'Cart quantity must be a whole number between 1 and 100000 pieces.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('retailer-cart:' || v_retailer_id::text, 0)
  );

  select pp.moq, pp.is_active, p.is_active
    into v_moq, v_pack_active, v_product_active
    from public.product_packs pp
    join public.products p on p.id = pp.product_id
   where pp.id = p_pack_id
   for share of pp, p;
  if not found or not v_pack_active or not v_product_active then
    raise exception 'PACK_UNAVAILABLE: this pack is no longer available.' using errcode = '23514';
  end if;
  if p_quantity < v_moq then
    raise exception 'MINIMUM_ORDER_QUANTITY: minimum is % pieces for this pack.', v_moq using errcode = '23514';
  end if;

  if p_cart_item_id is not null then
    select ci.pack_id, ci.quantity
      into v_actual_pack_id, v_current_quantity
      from public.cart_items ci
     where ci.id = p_cart_item_id and ci.retailer_id = v_retailer_id
     for update;
    if not found or v_actual_pack_id is distinct from p_pack_id
       or v_current_quantity is distinct from p_expected_quantity then
      raise exception 'CART_CHANGED: refresh the cart before applying this quantity.' using errcode = '40001';
    end if;
    update public.cart_items ci
       set quantity = p_quantity, updated_at = now()
     where ci.id = p_cart_item_id and ci.retailer_id = v_retailer_id;
    return p_quantity;
  end if;

  select ci.id, ci.quantity
    into v_cart_item_id, v_current_quantity
    from public.cart_items ci
   where ci.retailer_id = v_retailer_id and ci.pack_id = p_pack_id
   for update;
  if not found then
    v_cart_item_id := null;
    v_current_quantity := 0;
  end if;
  if v_current_quantity is distinct from p_expected_quantity then
    raise exception 'CART_CHANGED: refresh the cart before adding this item.' using errcode = '40001';
  end if;

  if v_cart_item_id is null then
    insert into public.cart_items (retailer_id, pack_id, quantity)
    values (v_retailer_id, p_pack_id, p_quantity);
  else
    update public.cart_items ci
       set quantity = p_quantity, updated_at = now()
     where ci.id = v_cart_item_id and ci.retailer_id = v_retailer_id;
  end if;
  return p_quantity;
end;
$$;
revoke all on function public.mutate_retailer_cart_line(uuid, uuid, integer, integer) from public, anon;
grant execute on function public.mutate_retailer_cart_line(uuid, uuid, integer, integer) to authenticated;

-- All authenticated reads/deletes remain retailer-scoped by RLS. Insert/update
-- writes now go through the compare-and-set RPC above instead of allowing a
-- direct table write to skip MOQ and lost-update checks.
revoke insert, update on table public.cart_items from public, anon, authenticated;
grant select, delete on table public.cart_items to authenticated;


-- Serialize the applied-coupon pointer with self-checkout. This closes the
-- otherwise possible race where a coupon is applied/removed between quote and
-- the atomic order's pointer check (including the no-coupon case).
create or replace function public.serialize_retailer_active_coupon_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_retailer_id uuid;
begin
  if tg_op = 'UPDATE' and old.retailer_id is distinct from new.retailer_id then
    for v_retailer_id in
      select distinct ids.retailer_id
        from (values (old.retailer_id), (new.retailer_id)) as ids(retailer_id)
       where ids.retailer_id is not null
       order by ids.retailer_id
    loop
      perform pg_advisory_xact_lock(
        hashtextextended('retailer-coupon:' || v_retailer_id::text, 0)
      );
    end loop;
  else
    v_retailer_id := case when tg_op = 'DELETE' then old.retailer_id else new.retailer_id end;
    if v_retailer_id is not null then
      perform pg_advisory_xact_lock(
        hashtextextended('retailer-coupon:' || v_retailer_id::text, 0)
      );
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_serialize_retailer_active_coupon_mutation on public.retailer_active_coupons;
create trigger trg_serialize_retailer_active_coupon_mutation
  before insert or update or delete on public.retailer_active_coupons
  for each row execute function public.serialize_retailer_active_coupon_mutation();
revoke all on function public.serialize_retailer_active_coupon_mutation() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- After creation, a client may change workflow/status fields only. The quote,
-- ownership, actor, shipping snapshot, coupon snapshot, request key/fingerprint
-- are immutable. This closes broad legacy update policies without changing
-- cancellation, warehouse assignment, or status transitions.
-- ---------------------------------------------------------------------------
create or replace function public.guard_order_creation_snapshot_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') and (
       new.retailer_id is distinct from old.retailer_id
    or new.collected_by is distinct from old.collected_by
    or new.subtotal is distinct from old.subtotal
    or new.gst_total is distinct from old.gst_total
    or new.discount_total is distinct from old.discount_total
    or new.grand_total is distinct from old.grand_total
    or new.notes is distinct from old.notes
    or new.shipping_address is distinct from old.shipping_address
    or new.coupon_id is distinct from old.coupon_id
    or new.coupon_code is distinct from old.coupon_code
    or new.coupon_discount is distinct from old.coupon_discount
    or new.request_key is distinct from old.request_key
    or new.request_fingerprint is distinct from old.request_fingerprint
    or new.coins_balance_after_paise is distinct from old.coins_balance_after_paise
  ) then
    raise exception 'Order creation details are immutable.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_order_creation_snapshot_update on public.orders;
create trigger trg_guard_order_creation_snapshot_update
  before update on public.orders
  for each row execute function public.guard_order_creation_snapshot_update();
revoke all on function public.guard_order_creation_snapshot_update() from public, anon, authenticated, service_role;

-- Retailer/salesman order creation is now exclusively through the server-only
-- atomic RPC. Service role bypasses RLS; the existing application paths have
-- been migrated to the same RPC. No other application path inserts these rows.
drop policy if exists "orders_insert" on public.orders;
drop policy if exists "order_items_authorized_insert" on public.order_items;
revoke insert on public.orders, public.order_items from anon, authenticated;

-- Keep first-order eligibility identical to the server quote: cancelled orders
-- do not count as prior purchases. The original 0051 function counted every
-- order row, which could reject a coupon after an order had been cancelled.
create or replace function public.redeem_coupon(
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
  v_coupon public.coupons%rowtype;
  v_retailer_used integer;
  v_other_orders integer;
begin
  if not public._can_use_coupon_for_retailer(p_retailer_id) then
    raise exception 'Access denied: cannot redeem a coupon for retailer %', p_retailer_id;
  end if;

  select * into v_coupon from public.coupons where id = p_coupon_id for update;
  if not found then return false; end if;
  if not v_coupon.is_active or now() < v_coupon.starts_at or now() > v_coupon.expires_at then return false; end if;
  if v_coupon.retailer_id is not null and v_coupon.retailer_id <> p_retailer_id then return false; end if;
  if v_coupon.usage_limit is not null and v_coupon.used_count >= v_coupon.usage_limit then return false; end if;

  select count(*) into v_retailer_used
    from public.coupon_redemptions
   where coupon_id = p_coupon_id and retailer_id = p_retailer_id;
  if v_retailer_used >= v_coupon.per_retailer_limit then return false; end if;

  if v_coupon.first_order_only then
    select count(*) into v_other_orders
      from public.orders
     where retailer_id = p_retailer_id
       and id <> p_order_id
       and status <> 'cancelled';
    if v_other_orders > 0 then return false; end if;
  end if;

  insert into public.coupon_redemptions (coupon_id, retailer_id, order_id, discount_amount)
  values (p_coupon_id, p_retailer_id, p_order_id, p_discount);
  update public.coupons
     set used_count = used_count + 1, updated_at = now()
   where id = p_coupon_id;
  return true;
end;
$$;

-- Coupon redemption and coin debit must not be callable as standalone
-- authenticated RPCs: doing so could consume a coupon or create a wallet debit
-- without an order transaction. The atomic order RPC calls them internally.
revoke all on function public.redeem_coupon(uuid, uuid, uuid, numeric) from public, anon, authenticated;
grant execute on function public.redeem_coupon(uuid, uuid, uuid, numeric) to service_role;
revoke all on function public.check_and_debit_retailer_wallet(uuid, uuid, bigint, text, uuid, text) from public, anon, authenticated;
grant execute on function public.check_and_debit_retailer_wallet(uuid, uuid, bigint, text, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Server-only atomic order creation. Amounts are supplied only by the trusted
-- TypeScript quote service, then reconciled here against every persisted line.
-- A failure at any point rolls back all order, stock, coupon, coin, completion
-- and cart effects because PostgreSQL executes this function as one transaction.
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

revoke all on function public.create_order_atomic(
  uuid, uuid, uuid, text, text, jsonb, numeric, numeric, numeric, numeric,
  uuid, text, numeric, bigint, jsonb, boolean
) from public, anon, authenticated;
grant execute on function public.create_order_atomic(
  uuid, uuid, uuid, text, text, jsonb, numeric, numeric, numeric, numeric,
  uuid, text, numeric, bigint, jsonb, boolean
) to service_role;

comment on function public.create_order_atomic(
  uuid, uuid, uuid, text, text, jsonb, numeric, numeric, numeric, numeric,
  uuid, text, numeric, bigint, jsonb, boolean
) is
  'Server-only atomic order creation. Accepts only a TypeScript-authored, server-repriced quote; enforces request-key idempotency, order/line reconciliation, active retailer/salesman assignment, MOQ, coupon/wallet consistency, 0054 simple-pack stock, request completion and optional exact cart clearing in one transaction.';

-- ==========================================================================
-- END 0056. Existing rows remain untouched; all new commerce writes are atomic.
-- ==========================================================================
