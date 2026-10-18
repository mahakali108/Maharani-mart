-- Rollback for 0065_checkout_split_rpcs.sql — FAIL-SAFE.
--
-- Restores the 0054/0056 function bodies that 0065 replaced and drops the new
-- split RPCs. Runs ONLY after 0066+ are rolled back and only on an environment
-- with NO split-order rows (rollback 0064 guards that). Orders created through
-- create_order_atomic_v2 must be exported first: reverting the deduction
-- function while split lines exist would strand their stock accounting.
--
-- DO NOT run against any configured or remote project. NOT executed.

do $$
begin
  if (select count(*) from sub_orders) > 0 then
    raise exception
      'ROLLBACK ABORTED: sub-order rows exist. Export split-order history and roll back 0064 first, then re-run.';
  end if;
end $$;

drop function if exists public.create_order_atomic_v2(
  uuid, uuid, uuid, text, text, jsonb, numeric, numeric, numeric, numeric,
  uuid, text, numeric, bigint, jsonb, boolean
);
drop function if exists public.mutate_retailer_cart_line_ex(uuid, uuid, uuid, integer, integer);
drop function if exists public.allocate_largest_remainder(bigint, bigint[]);

drop trigger if exists trg_enforce_split_restorable_bound on public.order_items;
drop function if exists public.enforce_split_restorable_bound();

-- Revert the replaced 0054 bodies to their pre-0065 definitions (legacy
-- behaviour only; split lines cannot exist after the guard above).
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
