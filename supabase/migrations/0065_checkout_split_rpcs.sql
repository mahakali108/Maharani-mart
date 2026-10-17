-- ============================================================================
-- 0065: Seller Marketplace — checkout behaviour switch (deploy DB-first).
--
-- WHAT THIS ADDS
--   * `mutate_retailer_cart_line_ex(p_pack_id, p_seller_offer_id, ...)` — the
--     source-aware twin of the 4-arg cart RPC (0056), which stays
--     byte-identical. Offer lines validate offer state, seller state, seller
--     MOQ and the admin floor at every mutation.
--   * `create_order_atomic_v2` — split-aware twin of `create_order_atomic`
--     (which stays byte-identical). Every invariant of the v1 function is
--     mirrored: request-key idempotency + fingerprint, retailer/salesman
--     eligibility, structural/arithmetic reconciliation (unit × qty = line
--     total, GST extraction sums), coupon revalidation with GST-exclusive
--     eligibility, wallet coin computation (payment layer), optional exact
--     cart clearing. New in v2:
--       · lines carry `seller_offer_id`; identity is (pack_id, line_key);
--       · seller lines revalidate offer/seller state, seller MOQ, admin floor
--         and the offer price at commit (stale quotes fail closed);
--       · children (`sub_orders`) are created with immutable money snapshots;
--         coupon and coin shares use largest-remainder allocation over stable
--         sort_index order and sum EXACTLY to the parent amounts;
--       · per-child coin debits use keys 'order:<parent>:<child>' with
--         reference_id = parent id, so legacy order-level replays (0056:577)
--         still sum correctly;
--       · a seller-only order needs no warehouse; a mixed order fails
--         atomically if the Maharani portion is unfulfillable;
--       · one PACK-STOCK child ('maharani') per parent plus at most one child
--         per seller.
--   * Source-aware stock deduction (replaces the 0054 function body; legacy
--     behaviour for source='maharani'/sub_order_id IS NULL is preserved
--     line-for-line): seller lines conditionally update
--     `seller_offers.stock_quantity` (UPDATE … WHERE stock >= n AND is_active
--     AND moderation='approved' AND seller active — the row lock is the
--     oversell guard), pack-stock lines keep the exact 0054 UPDATE. The
--     "pack already present" check becomes line-identity aware (same pack in
--     different sub-orders is legal).
--   * Profile-conditional warehouse resolution (the 0054:339 F-2 blocker):
--     orders with fulfilment_profile 'all_seller' skip the single-warehouse
--     rule and carry no warehouse; legacy/NULL-profile inserts behave exactly
--     as before.
--   * `enforce_split_restorable_bound` — DB-level fail-closed bound
--     restorable = deducted − shipped + returned_received − restored ≥ 0 for
--     split lines (in-transit units are never restorable).
--
-- CONCURRENCY: price/stock serialisation keeps the v1 advisory product locks
-- ('retailer-pricing:<product>' ASC). Offer rows are read FOR SHARE (with
-- their sellers) during validation, exactly like packs/products are in v1, so
-- offer/floor/seller-status UPDATEs block on the same row locks for the whole
-- checkout transaction. No additional advisory layer (an advisory + row lock
-- pair would introduce ABBA deadlocks against single-row admin updates).
--
-- DEPLOYMENT: deploy this schema BEFORE app code that calls these RPCs (there
-- is no safe window for new app + old DB). Old app + this schema stays safe:
-- v1 is untouched and behaviour-neutral defaults apply.
--
-- SAFETY: NOT executed against any database.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Largest-remainder allocation helper (integer paise, sums EXACTLY).
-- ---------------------------------------------------------------------------
create or replace function public.allocate_largest_remainder(
  p_total_paise bigint,
  p_base_weights bigint[]
) returns bigint[]
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_n integer := coalesce(array_length(p_base_weights, 1), 0);
  v_weight_sum bigint := 0;
  v_shares bigint[] := array_fill(0::bigint, array[v_n]);
  v_quotas numeric[] := array_fill(0::numeric, array[v_n]);
  v_remainders numeric[] := array_fill(0::numeric, array[v_n]);
  v_order integer[];
  v_i integer;
  v_left bigint;
  v_q numeric;
begin
  if p_total_paise is null or p_total_paise < 0 or v_n = 0 then
    raise exception 'Invalid allocation request.' using errcode = '22023';
  end if;
  for v_i in 1 .. v_n loop
    if p_base_weights[v_i] is null or p_base_weights[v_i] < 0 then
      raise exception 'Invalid allocation weights.' using errcode = '22023';
    end if;
    v_weight_sum := v_weight_sum + p_base_weights[v_i];
  end loop;
  if p_total_paise > v_weight_sum then
    raise exception 'Allocation exceeds its base.' using errcode = '22023';
  end if;
  if p_total_paise = 0 or v_weight_sum = 0 then
    return v_shares;
  end if;

  v_left := p_total_paise;
  for v_i in 1 .. v_n loop
    v_q := (p_total_paise::numeric * p_base_weights[v_i]) / v_weight_sum;
    v_shares[v_i] := floor(v_q)::bigint;
    v_quotas[v_i] := v_q;
    v_remainders[v_i] := v_q - floor(v_q);
    v_left := v_left - v_shares[v_i];
  end loop;

  -- Distribute the rounding remainder by descending fraction, stable on index.
  select array_agg(idx order by v_remainders[idx] desc, idx)
    into v_order
    from generate_subscripts(p_base_weights, 1) as idx;

  for v_i in 1 .. v_n loop
    exit when v_left <= 0;
    if v_shares[v_order[v_i]] < p_base_weights[v_order[v_i]] then
      v_shares[v_order[v_i]] := v_shares[v_order[v_i]] + 1;
      v_left := v_left - 1;
    end if;
  end loop;
  if v_left > 0 then
    raise exception 'Allocation left unassigned value.' using errcode = '22023';
  end if;
  return v_shares;
end;
$$;
revoke all on function public.allocate_largest_remainder(bigint, bigint[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Source-aware cart mutation (4-arg legacy RPC stays byte-identical).
-- ---------------------------------------------------------------------------
create or replace function public.mutate_retailer_cart_line_ex(
  p_pack_id uuid,
  p_seller_offer_id uuid,
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
  v_actual_offer_id uuid;
  v_current_quantity integer;
  v_moq integer;
  v_pack_active boolean;
  v_product_active boolean;
  v_offer_price_paise bigint;
  v_offer_moq integer;
  v_offer_stock integer;
  v_offer_active boolean;
  v_offer_moderation text;
  v_offer_pack uuid;
  v_seller_status text;
  v_floor bigint;
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
  if p_seller_offer_id is not null and p_expected_quantity = 0 then
    raise exception 'Invalid cart quantity for an offer line.' using errcode = '22023';
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

  if p_seller_offer_id is null then
    if p_quantity < v_moq then
      raise exception 'MINIMUM_ORDER_QUANTITY: minimum is % pieces for this pack.', v_moq using errcode = '23514';
    end if;
  else
    select so.unit_price_paise, so.moq, so.stock_quantity, so.is_active,
           so.moderation_status, so.pack_id, s.status
      into v_offer_price_paise, v_offer_moq, v_offer_stock, v_offer_active,
           v_offer_moderation, v_offer_pack, v_seller_status
      from public.seller_offers so
      join public.sellers s on s.id = so.seller_id
     where so.id = p_seller_offer_id
       for share of so, s;
    if not found or not v_offer_active or v_offer_moderation <> 'approved'
       or v_seller_status <> 'active' or v_offer_pack is distinct from p_pack_id then
      raise exception 'OFFER_UNAVAILABLE: this seller offer is no longer available.' using errcode = '23514';
    end if;
    if v_offer_price_paise is null or v_offer_price_paise <= 0 then
      raise exception 'OFFER_UNAVAILABLE: this seller offer has no valid price.' using errcode = '23514';
    end if;
    v_floor := public.current_offer_floor_paise(p_pack_id);
    if v_floor is not null and v_offer_price_paise < v_floor then
      raise exception 'PRICE_BELOW_FLOOR: the offer price is below the admin minimum for this pack.' using errcode = '23514';
    end if;
    if p_quantity < greatest(v_offer_moq, 1) then
      raise exception 'MINIMUM_ORDER_QUANTITY: minimum is % pieces for this offer.', greatest(v_offer_moq, 1) using errcode = '23514';
    end if;
    if v_offer_stock is not null and p_quantity > v_offer_stock then
      raise exception 'INSUFFICIENT_STOCK: only % available for this offer.', v_offer_stock using errcode = '23514';
    end if;
  end if;

  if p_cart_item_id is not null then
    select ci.pack_id, ci.seller_offer_id, ci.quantity
      into v_actual_pack_id, v_actual_offer_id, v_current_quantity
      from public.cart_items ci
     where ci.id = p_cart_item_id and ci.retailer_id = v_retailer_id
     for update;
    if not found or v_actual_pack_id is distinct from p_pack_id
       or v_actual_offer_id is distinct from p_seller_offer_id
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
   where ci.retailer_id = v_retailer_id
     and ci.pack_id = p_pack_id
     and ci.seller_offer_id is not distinct from p_seller_offer_id
   for update;
  if not found then
    v_cart_item_id := null;
    v_current_quantity := 0;
  end if;
  if v_current_quantity is distinct from p_expected_quantity then
    raise exception 'CART_CHANGED: refresh the cart before adding this item.' using errcode = '40001';
  end if;

  if v_cart_item_id is null then
    insert into public.cart_items (retailer_id, pack_id, seller_offer_id, source_type, quantity)
    values (
      v_retailer_id,
      p_pack_id,
      p_seller_offer_id,
      case when p_seller_offer_id is null then 'maharani' else 'seller' end,
      p_quantity
    );
  else
    update public.cart_items ci
       set quantity = p_quantity, updated_at = now()
     where ci.id = v_cart_item_id and ci.retailer_id = v_retailer_id;
  end if;
  return p_quantity;
end;
$$;
revoke all on function public.mutate_retailer_cart_line_ex(uuid, uuid, uuid, integer, integer) from public, anon;
grant execute on function public.mutate_retailer_cart_line_ex(uuid, uuid, uuid, integer, integer) to authenticated;

comment on function public.mutate_retailer_cart_line_ex(uuid, uuid, uuid, integer, integer) is
  'Source-aware cart mutation (maharani pack line when p_seller_offer_id is null, seller offer line otherwise) with compare-and-set semantics, offer/seller/floor revalidation and seller MOQ/stock checks. The legacy 4-arg RPC is unchanged.';

-- ---------------------------------------------------------------------------
-- 3. Source-aware stock deduction (replaces 0054 function body; legacy
--    behaviour preserved for pack-stock lines).
-- ---------------------------------------------------------------------------
create or replace function public.deduct_simple_pack_stock_for_order_item()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_simple boolean;
  v_status public.order_status;
  v_available integer;
  v_name text;
  v_pack_name text;
  v_unit text;
  v_requested integer;
  v_offer_stock integer;
  v_offer_pack uuid;
  v_offer_product uuid;
  v_offer_fulfilment text;
  v_seller_name text;
begin
  select o.simple_stock_mode, o.status
    into v_simple, v_status
    from public.orders o
   where o.id = new.order_id
   for update;

  if not found then raise exception 'Order not found.' using errcode = 'P0002'; end if;
  if not v_simple then return new; end if;
  if v_status <> 'pending' then
    raise exception 'Stock can only be deducted while an order is pending.' using errcode = 'check_violation';
  end if;
  if new.pack_id is null then
    raise exception 'A sellable pack is required for a new order line.' using errcode = 'check_violation';
  end if;

  -- Line-identity-aware duplicate guard: the same pack may appear once per
  -- sub-order (split) and once for unsplit lines, but never twice in the same
  -- container. Legacy rows (sub_order_id IS NULL) keep the exact old rule.
  if exists (
    select 1 from public.order_items oi
     where oi.order_id = new.order_id
       and oi.pack_id = new.pack_id
       and oi.sub_order_id is not distinct from new.sub_order_id
  ) then
    raise exception 'This pack is already present in the order.' using errcode = 'unique_violation';
  end if;
  if new.quantity_unit <> 'pieces' then
    raise exception 'New simple-stock order lines must be recorded in pieces.' using errcode = 'check_violation';
  end if;

  v_requested := new.quantity;
  new.quantity_pieces := v_requested;

  if new.source_type = 'seller' and new.fulfilment_type = 'seller' then
    -- Seller-owned stock: conditional UPDATE is the oversell guard. The row
    -- lock serialises competing checkouts; no advisory lock is sufficient here.
    if new.seller_offer_id is null then
      raise exception 'A seller line requires a seller offer.' using errcode = 'check_violation';
    end if;

    update public.seller_offers so
       set stock_quantity = so.stock_quantity - v_requested,
           updated_at = now()
      from public.sellers s
     where so.id = new.seller_offer_id
       and so.pack_id = new.pack_id
       and so.product_id = new.product_id
       and so.is_active
       and so.moderation_status = 'approved'
       and so.fulfilment_type = 'seller'
       and s.id = so.seller_id
       and s.status = 'active'
       and so.stock_quantity >= v_requested
    returning so.stock_quantity, s.business_name
         into v_offer_stock, v_seller_name;

    if not found then
      select so.stock_quantity, so.pack_id, so.product_id, so.fulfilment_type
        into v_offer_stock, v_offer_pack, v_offer_product, v_offer_fulfilment
        from public.seller_offers so
       where so.id = new.seller_offer_id
       for update;
      if not found or v_offer_pack is distinct from new.pack_id
         or v_offer_product is distinct from new.product_id
         or v_offer_fulfilment is distinct from 'seller' then
        raise exception 'This seller offer is no longer available.' using errcode = 'check_violation';
      end if;
      raise exception 'INSUFFICIENT_STOCK: Only % available for this seller offer.', coalesce(v_offer_stock, 0)
        using errcode = 'check_violation';
    end if;
  else
    -- Maharani pack stock (pure maharani lines AND maharani-fulfilled offers):
    -- exact legacy UPDATE (0054), unchanged.
    update public.product_packs pp
       set stock_quantity = pp.stock_quantity - v_requested,
           updated_at = now()
      from public.products p
     where pp.id = new.pack_id
       and pp.product_id = new.product_id
       and pp.is_active
       and p.id = pp.product_id
       and p.is_active
       and pp.stock_quantity >= v_requested
    returning pp.stock_quantity, p.name, pp.pack_name, coalesce(nullif(upper(trim(p.unit)), ''), 'PCS')
         into v_available, v_name, v_pack_name, v_unit;

    if not found then
      select pp.stock_quantity, p.name, pp.pack_name, coalesce(nullif(upper(trim(p.unit)), ''), 'PCS')
        into v_available, v_name, v_pack_name, v_unit
        from public.product_packs pp
        join public.products p on p.id = pp.product_id
       where pp.id = new.pack_id and pp.product_id = new.product_id
         and pp.is_active and p.is_active
       for update of pp;
      if not found then
        raise exception 'This product pack is no longer available.' using errcode = 'check_violation';
      end if;
      raise exception 'INSUFFICIENT_STOCK: Only % available for % (%).',
        v_available, v_name, v_pack_name using errcode = 'check_violation';
    end if;
  end if;

  new.stock_deducted_quantity := v_requested;
  new.stock_restored_quantity := 0;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Fail-closed restorable bound for split lines.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_split_restorable_bound()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.sub_order_id is null then
    return new;
  end if;
  if new.stock_restored_quantity
       > new.stock_deducted_quantity - new.shipped_quantity + new.returned_received_quantity then
    raise exception 'RESTORABLE_EXCEEDED: stock cannot be restored for units still in transit or already restored.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_split_restorable_bound on public.order_items;
create trigger trg_enforce_split_restorable_bound
  before update of stock_restored_quantity, shipped_quantity, accepted_quantity,
                   missing_damaged_quantity, returned_received_quantity
  on public.order_items
  for each row execute function public.enforce_split_restorable_bound();

-- ---------------------------------------------------------------------------
-- 5. Profile-conditional warehouse resolution (0054:339/366 replaced bodies;
--    legacy/NULL-profile inserts behave exactly as before).
-- ---------------------------------------------------------------------------
create or replace function public.prepare_simple_stock_order_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
  v_warehouse_id uuid;
begin
  new.simple_stock_mode := true;
  new.request_completed_at := null;
  if new.fulfilment_profile = 'all_seller' then
    -- Seller-stock-only orders never touch Maharani warehouse stock.
    new.warehouse_id := null;
    return new;
  end if;
  select count(*) into v_count from public.warehouses where is_active;
  if v_count <> 1 then
    raise exception 'Warehouse configuration error: exactly one active warehouse is required (found %).', v_count
      using errcode = '22023';
  end if;
  select id into v_warehouse_id from public.warehouses where is_active limit 1;
  new.warehouse_id := v_warehouse_id;
  return new;
end;
$$;

create or replace function public.keep_simple_stock_order_warehouse_server_resolved()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
  v_warehouse_id uuid;
begin
  if old.fulfilment_profile = 'all_seller' then
    new.warehouse_id := null;
    return new;
  end if;
  if old.simple_stock_mode then
    select count(*) into v_count from public.warehouses where is_active;
    if v_count <> 1 then
      raise exception 'Warehouse configuration error: exactly one active warehouse is required (found %).', v_count
        using errcode = '22023';
    end if;
    select id into v_warehouse_id from public.warehouses where is_active limit 1;
    new.warehouse_id := v_warehouse_id;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. create_order_atomic_v2.
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

revoke all on function public.create_order_atomic_v2(
  uuid, uuid, uuid, text, text, jsonb, numeric, numeric, numeric, numeric,
  uuid, text, numeric, bigint, jsonb, boolean
) from public, anon, authenticated;
grant execute on function public.create_order_atomic_v2(
  uuid, uuid, uuid, text, text, jsonb, numeric, numeric, numeric, numeric,
  uuid, text, numeric, bigint, jsonb, boolean
) to service_role;

comment on function public.create_order_atomic_v2(
  uuid, uuid, uuid, text, text, jsonb, numeric, numeric, numeric, numeric,
  uuid, text, numeric, bigint, jsonb, boolean
) is
  'Split-order atomic checkout: everything create_order_atomic enforces, plus per-line seller offer revalidation (state, floor, price, seller MOQ/stock), sub-order snapshots with exact largest-remainder coupon/coin allocation, per-child coin debits scoped by child key, profile-conditional warehouse resolution and line-identity cart claiming. Legacy create_order_atomic is unchanged.';

-- ============================================================================
-- END OF MIGRATION. Deploy DB-first, together with the app switch to the _ex /
-- _v2 entry points. v1 entry points remain byte-identical.
-- ============================================================================
