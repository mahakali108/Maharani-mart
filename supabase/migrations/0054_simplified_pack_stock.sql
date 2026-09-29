-- ============================================================================
-- 0054 — SIMPLIFIED PACK STOCK + SERVER-AUTHORITATIVE ORDER DEDUCTION
-- ============================================================================
-- Historical warehouse, batch, reservation and movement data is retained.
-- New order lines use one on-hand quantity on their product pack. Existing
-- orders are explicitly left in legacy mode so approval/dispatch/return keeps
-- using its original warehouse and FEFO allocation path.
--
-- No legacy stock is copied into pack rows: inventory_stock is product-level,
-- while orders identify a particular size/pack. Splitting an aggregate across
-- variants would invent stock. New pack quantities start at zero until an
-- Admin enters a count on the product screen.
-- ============================================================================

-- One authoritative count per sellable pack. The existing products.unit is
-- used for display, avoiding a second, conflicting unit field.
alter table public.product_packs
  add column if not exists stock_quantity integer not null default 0;

alter table public.product_packs
  drop constraint if exists product_packs_stock_quantity_non_negative;
alter table public.product_packs
  add constraint product_packs_stock_quantity_non_negative
  check (stock_quantity >= 0 and stock_quantity <= 2000000000);

-- Existing Supabase defaults grant API roles table-wide SELECT. Column-level
-- REVOKEs cannot override those grants, so the cost_price revocation in 0025
-- was not effective on either catalog table. Replace each broad grant with an
-- explicit safe-column allowlist. This makes product/pack cost and pack stock
-- private while keeping catalog, legacy inventory thresholds, and pricing
-- reads intact. Admin costs and exact pack counts use role-checked accessors;
-- service_role/table owners retain backend access.
revoke select on table public.products from public, anon, authenticated;
grant select (
  id, sku_code, name, brand_id, category_id, unit, units_per_case,
  base_price, gst_percent, hsn_code, lead_time_days, is_new_launch, is_active,
  created_by, created_at, updated_at, barcode, min_stock, reorder_level, max_stock
) on table public.products to anon, authenticated;
revoke select (cost_price) on public.products from public, anon, authenticated;

revoke select on table public.product_packs from public, anon, authenticated;
grant select (
  id, product_id, pack_name, pack_sku_code, units_per_case, base_price,
  is_active, sort_order, created_by, created_at, updated_at,
  mrp, ptr, wholesale_price, barcode, moq, case_price, image_url,
  allow_loose_pieces
) on table public.product_packs to anon, authenticated;
revoke select (stock_quantity) on public.product_packs from public, anon, authenticated;

comment on column public.product_packs.stock_quantity is
  'Server-authoritative on-hand stock for this sellable pack. New simple-stock orders deduct atomically at order-line insert; only Admins may edit the count. No legacy product/warehouse aggregate is copied because it cannot be safely split across pack variants.';

-- Historical rows remain false; the default and BEFORE INSERT trigger make
-- every new order use simple pack stock. request_key closes retry duplicates
-- for internal salesman order capture; retailer cart checkout already claims
-- its cart rows atomically.
alter table public.orders
  add column if not exists simple_stock_mode boolean not null default false,
  add column if not exists request_key uuid,
  add column if not exists request_completed_at timestamptz;

alter table public.orders
  alter column simple_stock_mode set default true;

create unique index if not exists orders_request_key_unique
  on public.orders (request_key)
  where request_key is not null;

comment on column public.orders.simple_stock_mode is
  'True only for orders created after simplified pack stock is enabled. Existing false rows keep legacy warehouse reservation, FEFO dispatch and return behavior.';
comment on column public.orders.request_key is
  'Optional per-form idempotency key for retry-safe salesman order creation; NULL for other order sources.';
comment on column public.orders.request_completed_at is
  'Set only after order lines, coupon redemption and Coins processing all succeed. An incomplete request-key row is never replayed as a successful order.';

-- A retry key identifies an attempt, not a completed order. Keep this marker
-- null on INSERT and write it only through the owner-checked finalization RPC
-- after every side effect has succeeded.
create or replace function public.guard_order_request_completion_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.request_completed_at is distinct from old.request_completed_at
     and current_user in ('authenticated', 'anon') then
    raise exception 'Order request completion can only be written through the finalization RPC.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_order_request_completion_update on public.orders;
create trigger trg_guard_order_request_completion_update
  before update of request_completed_at on public.orders
  for each row execute function public.guard_order_request_completion_update();
revoke all on function public.guard_order_request_completion_update() from public, anon, authenticated, service_role;

create or replace function public.complete_order_request(p_order_id uuid, p_request_key uuid, p_actor_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request_key uuid;
  v_collected_by uuid;
  v_status public.order_status;
begin
  -- Completion is a trusted server-only write: an authenticated browser must
  -- not be able to mark its own unfinished order as safe to replay.
  if auth.role() is distinct from 'service_role' then
    raise exception 'Order request completion is server-only.' using errcode = '42501';
  end if;
  select request_key, collected_by, status
    into v_request_key, v_collected_by, v_status
    from public.orders
   where id = p_order_id
   for update;
  if not found then raise exception 'Order not found.' using errcode = 'P0002'; end if;
  if p_request_key is null or v_request_key is distinct from p_request_key then
    raise exception 'Order request key does not match.' using errcode = '42501';
  end if;
  if p_actor_id is null or v_collected_by is distinct from p_actor_id then
    raise exception 'Capturing salesman does not match this order.' using errcode = '42501';
  end if;
  if v_status = 'cancelled' then
    raise exception 'A cancelled order request cannot be finalized.' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.order_items where order_id = p_order_id) then
    raise exception 'An order request without lines cannot be finalized.' using errcode = 'check_violation';
  end if;

  update public.orders
     set request_completed_at = coalesce(request_completed_at, now())
   where id = p_order_id;
  return true;
end;
$$;
revoke all on function public.complete_order_request(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.complete_order_request(uuid, uuid, uuid) to service_role;

alter table public.order_items
  add column if not exists stock_deducted_quantity integer not null default 0,
  add column if not exists stock_restored_quantity integer not null default 0;

alter table public.order_items
  drop constraint if exists order_items_stock_deducted_non_negative,
  drop constraint if exists order_items_stock_restored_non_negative,
  drop constraint if exists order_items_stock_restored_not_over_deducted;
alter table public.order_items
  add constraint order_items_stock_deducted_non_negative check (stock_deducted_quantity >= 0),
  add constraint order_items_stock_restored_non_negative check (stock_restored_quantity >= 0),
  add constraint order_items_stock_restored_not_over_deducted check (stock_restored_quantity <= stock_deducted_quantity);

comment on column public.order_items.stock_deducted_quantity is
  'Server-written quantity deducted from product_packs for a simple-stock order line; immutable after insert.';
comment on column public.order_items.stock_restored_quantity is
  'Server-written quantity restored by cancellation or return. The per-line counter makes every restoration retry-safe.';

-- The 0052 pricing guard already blocks staff from changing pack prices. Add
-- stock_quantity to the same Admin-only boundary; server-side SECURITY DEFINER
-- deduction/restoration and the Admin stock RPC run as the function owner.
drop trigger if exists trg_guard_product_packs_pricing on public.product_packs;
create trigger trg_guard_product_packs_pricing
  before update on public.product_packs
  for each row execute function public.guard_admin_only_columns(
    'product_id', 'pack_sku_code', 'units_per_case', 'base_price', 'cost_price',
    'mrp', 'ptr', 'wholesale_price', 'case_price', 'stock_quantity'
  );

-- New variants always begin at zero, even if an authenticated insert posts a
-- forged count. The only path that can establish sellable quantity is the
-- role-checked Admin stock RPC below; later deductions/restorations are DB-owned.
create or replace function public.default_new_product_pack_stock()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.stock_quantity := 0;
  return new;
end;
$$;

drop trigger if exists trg_default_new_product_pack_stock on public.product_packs;
create trigger trg_default_new_product_pack_stock
  before insert on public.product_packs
  for each row execute function public.default_new_product_pack_stock();
revoke all on function public.default_new_product_pack_stock() from public, anon, authenticated, service_role;

-- Admin-only stock editor. The action supplies a pack id and an integer count;
-- the RPC re-checks role and bounds in the database.
create or replace function public.admin_set_product_pack_stock(
  p_pack_id uuid,
  p_quantity integer
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_quantity integer;
begin
  if auth.uid() is null or not public.is_admin_or_above() then
    raise exception 'Only an Admin can change pack stock.' using errcode = '42501';
  end if;
  if p_pack_id is null or p_quantity is null or p_quantity < 0 or p_quantity > 2000000000 then
    raise exception 'Enter a whole stock quantity from 0 to 2,000,000,000.' using errcode = '22023';
  end if;

  update public.product_packs
     set stock_quantity = p_quantity,
         updated_at = now()
   where id = p_pack_id
  returning stock_quantity into v_quantity;

  if not found then
    raise exception 'Pack not found.' using errcode = 'P0002';
  end if;
  return v_quantity;
end;
$$;
revoke all on function public.admin_set_product_pack_stock(uuid, integer) from public, anon;
grant execute on function public.admin_set_product_pack_stock(uuid, integer) to authenticated;

-- Admin list/detail pages may read exact counts through this bounded accessor;
-- the stock column itself remains unavailable to authenticated PostgREST reads.
create or replace function public.admin_product_pack_stock(p_product_ids uuid[])
returns table(product_id uuid, pack_id uuid, stock_quantity integer)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.is_admin_or_above() then
    raise exception 'Only an Admin can view exact pack stock.' using errcode = '42501';
  end if;
  if coalesce(array_length(p_product_ids, 1), 0) > 1000 then
    raise exception 'Too many products.' using errcode = '22023';
  end if;

  return query
  select pp.product_id, pp.id, pp.stock_quantity
    from public.product_packs pp
   where pp.product_id = any(coalesce(p_product_ids, '{}'::uuid[]));
end;
$$;
revoke all on function public.admin_product_pack_stock(uuid[]) from public, anon;
grant execute on function public.admin_product_pack_stock(uuid[]) to authenticated;

-- Customer-facing stock is deliberately narrow: per active pack, one of two
-- status strings only. Exact counts, unit, warehouse and batch data stay hidden.
create or replace function public.get_retailer_pack_availability(p_pack_ids uuid[])
returns table(pack_id uuid, stock_status text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role public.user_role;
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  if coalesce(array_length(p_pack_ids, 1), 0) > 200 then raise exception 'Too many packs.'; end if;

  v_role := public.current_user_role();
  if v_role = 'retailer' and not exists (
    select 1 from public.retailers r where r.id = auth.uid() and r.status = 'active'
  ) then raise exception 'Active retailer required.';
  end if;
  if v_role not in ('retailer', 'salesman', 'staff', 'admin', 'super_admin') then
    raise exception 'Not authorized for pack availability.';
  end if;

  return query
  select pp.id,
         case when pp.stock_quantity > 0 then 'in_stock' else 'out_of_stock' end
    from public.product_packs pp
    join public.products p on p.id = pp.product_id
   where pp.id = any(coalesce(p_pack_ids, '{}'::uuid[]))
     and pp.is_active
     and p.is_active;
end;
$$;
revoke all on function public.get_retailer_pack_availability(uuid[]) from public, anon;
grant execute on function public.get_retailer_pack_availability(uuid[]) to authenticated;
comment on function public.get_retailer_pack_availability(uuid[]) is
  'Returns only Available/Out of stock status per active product pack. Exact counts and all warehouse, batch, reservation and movement fields stay private.';

-- Compatibility status-only lookup for callers that still have product ids.
-- It summarizes the first active pack only; stock is never aggregated across
-- differently sized packs and no exact count leaves the server.
drop function if exists public.get_retailer_product_availability(uuid[]);
create function public.get_retailer_product_availability(p_product_ids uuid[])
returns table(product_id uuid, stock_status text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role public.user_role;
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  if coalesce(array_length(p_product_ids, 1), 0) > 100 then raise exception 'Too many products.'; end if;

  v_role := public.current_user_role();
  if v_role = 'retailer' and not exists (
    select 1 from public.retailers r where r.id = auth.uid() and r.status = 'active'
  ) then raise exception 'Active retailer required.';
  end if;
  if v_role not in ('retailer', 'salesman', 'staff', 'admin', 'super_admin') then
    raise exception 'Not authorized for product availability.';
  end if;

  return query
  select p.id,
         case when coalesce(pp.stock_quantity, 0) > 0 then 'in_stock' else 'out_of_stock' end
    from public.products p
    left join lateral (
      select pack.stock_quantity
        from public.product_packs pack
       where pack.product_id = p.id and pack.is_active
       order by pack.sort_order, pack.id
       limit 1
    ) pp on true
   where p.id = any(coalesce(p_product_ids, '{}'::uuid[]))
     and p.is_active;
end;
$$;
revoke all on function public.get_retailer_product_availability(uuid[]) from public, anon;
grant execute on function public.get_retailer_product_availability(uuid[]) to authenticated;

-- New orders cannot select legacy mode or post a warehouse id. The active
-- warehouse is resolved inside Postgres and a configuration error is raised
-- unless exactly one is active. Existing orders remain untouched.
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

drop trigger if exists trg_prepare_simple_stock_order_insert on public.orders;
create trigger trg_prepare_simple_stock_order_insert
  before insert on public.orders
  for each row execute function public.prepare_simple_stock_order_insert();
revoke all on function public.prepare_simple_stock_order_insert() from public, anon, authenticated, service_role;

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

drop trigger if exists trg_keep_simple_stock_order_warehouse_server_resolved on public.orders;
create trigger trg_keep_simple_stock_order_warehouse_server_resolved
  before update of warehouse_id on public.orders
  for each row execute function public.keep_simple_stock_order_warehouse_server_resolved();
revoke all on function public.keep_simple_stock_order_warehouse_server_resolved() from public, anon, authenticated, service_role;

create or replace function public.keep_order_stock_mode_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.simple_stock_mode is distinct from old.simple_stock_mode then
    raise exception 'Order stock mode cannot be changed after creation.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_keep_order_stock_mode_immutable on public.orders;
create trigger trg_keep_order_stock_mode_immutable
  before update of simple_stock_mode on public.orders
  for each row execute function public.keep_order_stock_mode_immutable();
revoke all on function public.keep_order_stock_mode_immutable() from public, anon, authenticated, service_role;

-- Stock is deducted before the order line is accepted. An UPDATE ... WHERE
-- stock_quantity >= requested line amount is atomic under concurrency: a
-- competing checkout waits, then re-checks the predicate against the new
-- quantity. Any later failure in the INSERT statement rolls the deduction
-- back with the line.
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
  if exists (
    select 1 from public.order_items oi
     where oi.order_id = new.order_id and oi.pack_id = new.pack_id
  ) then
    raise exception 'This pack is already present in the order.' using errcode = 'unique_violation';
  end if;
  if new.quantity_unit <> 'pieces' then
    raise exception 'New simple-stock order lines must be recorded in pieces.' using errcode = 'check_violation';
  end if;

  v_requested := new.quantity;
  -- quantity is the server-quoted piece count; overwrite the optional snapshot
  -- rather than trusting a second, potentially inconsistent client value.
  new.quantity_pieces := v_requested;

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

  new.stock_deducted_quantity := v_requested;
  new.stock_restored_quantity := 0;
  return new;
end;
$$;

drop trigger if exists trg_deduct_simple_pack_stock on public.order_items;
create trigger trg_deduct_simple_pack_stock
  before insert on public.order_items
  for each row execute function public.deduct_simple_pack_stock_for_order_item();
revoke all on function public.deduct_simple_pack_stock_for_order_item() from public, anon, authenticated, service_role;

-- Deduction/restoration counters are internal bookkeeping. Changing a line's
-- pack or quantity after it has affected stock is rejected, and callers cannot
-- forge the counters directly through the authenticated API.
create or replace function public.guard_simple_stock_order_item_update()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_simple boolean;
begin
  select o.simple_stock_mode into v_simple from public.orders o where o.id = old.order_id;
  if not coalesce(v_simple, false) then return new; end if;

  if new.stock_deducted_quantity is distinct from old.stock_deducted_quantity
     or new.stock_restored_quantity is distinct from old.stock_restored_quantity then
    if current_user in ('authenticated', 'anon') then
      raise exception 'Simple-stock counters are maintained by the database only.' using errcode = '42501';
    end if;
  end if;
  if old.stock_deducted_quantity > 0 and (
       new.order_id is distinct from old.order_id
       or new.product_id is distinct from old.product_id
       or new.pack_id is distinct from old.pack_id
       or new.quantity is distinct from old.quantity
       or new.quantity_unit is distinct from old.quantity_unit
       or new.quantity_pieces is distinct from old.quantity_pieces
     ) then
    raise exception 'A stock-deducted order line cannot be changed.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_simple_stock_order_item_update on public.order_items;
create trigger trg_guard_simple_stock_order_item_update
  before update on public.order_items
  for each row execute function public.guard_simple_stock_order_item_update();
revoke all on function public.guard_simple_stock_order_item_update() from public, anon, authenticated, service_role;

-- The line-level counters make cancellation safe from retries and concurrent
-- cancellation paths. Legacy reservations still release through the existing
-- 0017 trigger unchanged.
create or replace function public.restore_simple_order_stock(
  p_order_id uuid,
  p_order_item_id uuid default null
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item public.order_items%rowtype;
  v_restore integer;
  v_restored_total integer := 0;
  v_status public.order_status;
begin
  select status into v_status
    from public.orders
   where id = p_order_id
   for update;
  if not found then raise exception 'Order not found.' using errcode = 'P0002'; end if;
  if v_status not in ('cancelled', 'delivered', 'returned') then
    raise exception 'Stock can only be restored for a cancelled or delivered/returned order.' using errcode = 'check_violation';
  end if;

  for v_item in
    select oi.*
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
     where oi.order_id = p_order_id
       and o.simple_stock_mode
       and (p_order_item_id is null or oi.id = p_order_item_id)
       and oi.stock_deducted_quantity > oi.stock_restored_quantity
     order by oi.id
     for update of oi
  loop
    v_restore := v_item.stock_deducted_quantity - v_item.stock_restored_quantity;
    if v_item.pack_id is null then
      raise exception 'The returned order line no longer has a pack reference.' using errcode = 'check_violation';
    end if;

    update public.product_packs pp
       set stock_quantity = pp.stock_quantity + v_restore,
           updated_at = now()
     where pp.id = v_item.pack_id
       and pp.product_id = v_item.product_id
       and pp.stock_quantity <= 2000000000 - v_restore;
    if not found then
      if exists (select 1 from public.product_packs where id = v_item.pack_id and product_id = v_item.product_id) then
        raise exception 'Restoring this return would exceed the maximum pack stock.' using errcode = '22003';
      end if;
      raise exception 'Pack not found while restoring order stock.' using errcode = 'P0002';
    end if;

    update public.order_items
       set stock_restored_quantity = stock_deducted_quantity
     where id = v_item.id;
    v_restored_total := v_restored_total + v_restore;
  end loop;
  return v_restored_total;
end;
$$;
revoke all on function public.restore_simple_order_stock(uuid, uuid) from public, anon, authenticated, service_role;

create or replace function public.restore_simple_stock_on_cancel()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.simple_stock_mode then
    perform public.restore_simple_order_stock(new.id, null);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_restore_simple_stock_on_cancel on public.orders;
create trigger trg_restore_simple_stock_on_cancel
  after update of status on public.orders
  for each row
  when (new.status = 'cancelled' and old.status is distinct from new.status)
  execute function public.restore_simple_stock_on_cancel();
revoke all on function public.restore_simple_stock_on_cancel() from public, anon, authenticated, service_role;

-- Preserve the original 0017 dispatch RPC under a private legacy name. New
-- orders already deducted product_packs at line insert, so dispatch must not
-- consume the same sale from legacy batches/stock_movements a second time.
do $$
begin
  if to_regprocedure('public.consume_legacy_order_stock(uuid)') is null then
    execute 'alter function public.consume_order_stock(uuid) rename to consume_legacy_order_stock';
  end if;
end;
$$;
revoke all on function public.consume_legacy_order_stock(uuid) from public, anon, authenticated, service_role;

create or replace function public.consume_order_stock(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_simple boolean;
  v_status public.order_status;
begin
  perform public.require_inventory_role();
  select simple_stock_mode, status into v_simple, v_status
    from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found.' using errcode = 'P0002'; end if;
  if v_status not in ('confirmed', 'processing', 'packed') then
    raise exception 'Only confirmed, processing or packed orders can be dispatched.' using errcode = 'check_violation';
  end if;
  if v_simple then
    return jsonb_build_object('status', 'simple_stock_already_deducted', 'order_id', p_order_id);
  end if;
  return public.consume_legacy_order_stock(p_order_id);
end;
$$;
revoke all on function public.consume_order_stock(uuid) from public, anon;
grant execute on function public.consume_order_stock(uuid) to authenticated, service_role;

-- Preserve the original 0017 return RPC verbatim under a private legacy name.
-- The wrapper routes old orders there and restores pack counts for simple
-- orders, so historical allocations and movements remain untouched.
do $$
begin
  if to_regprocedure('public.return_legacy_order_stock(uuid,uuid)') is null then
    execute 'alter function public.return_order_stock(uuid, uuid) rename to return_legacy_order_stock';
  end if;
end;
$$;

revoke all on function public.return_legacy_order_stock(uuid, uuid) from public, anon, authenticated;

drop function if exists public.return_order_stock(uuid, uuid);
create function public.return_order_stock(p_order_id uuid, p_order_item_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_simple boolean;
  v_status public.order_status;
  v_units integer;
begin
  perform public.require_inventory_role();

  select simple_stock_mode, status into v_simple, v_status
    from public.orders
   where id = p_order_id
   for update;
  if not found then raise exception 'Order not found.' using errcode = 'P0002'; end if;

  if v_simple then
    if v_status not in ('delivered', 'returned') then
      raise exception 'Stock can only be returned for a delivered or returned order.' using errcode = 'check_violation';
    end if;
    v_units := public.restore_simple_order_stock(p_order_id, p_order_item_id);
    return jsonb_build_object('status', 'returned', 'order_id', p_order_id, 'units', v_units);
  end if;

  return public.return_legacy_order_stock(p_order_id, p_order_item_id);
end;
$$;
revoke all on function public.return_order_stock(uuid, uuid) from public, anon;
grant execute on function public.return_order_stock(uuid, uuid) to authenticated, service_role;

-- ============================================================================
-- END OF MIGRATION 0054
-- ============================================================================
