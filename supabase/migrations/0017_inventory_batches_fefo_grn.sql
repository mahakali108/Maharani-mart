-- ============================================================================
-- 0017: Inventory Management System — Batches, Expiry, FEFO, GRN, Transfers
-- ============================================================================
-- What already existed before this migration (and is REUSED, not duplicated):
--   * warehouses                     — warehouse master data
--   * inventory_stock                — product x warehouse on-hand + reserved
--   * stock_movements                — movement ledger (6 types) + trigger
--   * apply_stock_movement() trigger — keeps inventory_stock in sync
--   * orders / order_items           — order capture incl. pricing/GST/MOQ
--   * audit_logs / notifications     — audit + notification infrastructure
--
-- What this migration ADDS (purely additive; no existing column is dropped,
-- no existing row is modified or deleted, no existing policy is weakened):
--   * inventory_batches              — batch-level stock with expiry
--   * grns / grn_items               — Goods Received Notes
--   * stock_transfers / items        — inter-warehouse transfers
--   * order_stock_allocations        — FEFO reservation records
--   * inventory_settings             — configurable expiry/alert windows
--   * products.min/reorder/max stock — per-product thresholds
--   * new stock_movement_type values — OPENING_STOCK, GRN_RECEIPT, SALE,
--     SALE_RESERVATION, SALE_RELEASE, EXPIRY, STOCK_ADJUSTMENT,
--     TRANSFER_OUT, TRANSFER_IN, MANUAL_CORRECTION (old values kept)
--   * richer ledger columns          — batch_id, reference_type/id,
--     previous/new quantity, direction, releases_reserved
--   * append-only ledger enforcement — UPDATE/DELETE blocked by trigger
--   * atomic RPCs                    — reserve/release/consume order stock
--     (server-side FEFO), confirm/cancel GRN, execute transfer, record
--     batch loss, adjust stock, accept returns
--   * auto-release trigger           — cancelled orders free reservations
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Helper: safely read the caller's JWT role claim (used to allow
--    service-role corrections on the otherwise append-only ledger).
-- ----------------------------------------------------------------------------
create or replace function public.current_jwt_role()
returns text
language plpgsql
stable
as $$
declare
  v_claims text;
begin
  v_claims := coalesce(
    nullif(current_setting('request.jwt.claims', true), ''),
    nullif(current_setting('request.jwt.claim.role', true), '')
  );
  if v_claims is null then return null; end if;
  begin
    if left(v_claims, 1) = '{' then
      return v_claims::jsonb ->> 'role';
    end if;
    return v_claims; -- request.jwt.claim.role already holds the role text
  exception when others then
    return null;
  end;
end;
$$;

-- ----------------------------------------------------------------------------
-- 1. Extend the movement type enum. Old values remain valid; existing
--    rows and code paths ('inward','outward','damage','return',
--    'transfer','adjustment') are untouched.
-- ----------------------------------------------------------------------------
alter type stock_movement_type add value if not exists 'opening_stock';
alter type stock_movement_type add value if not exists 'grn_receipt';
alter type stock_movement_type add value if not exists 'sale';
alter type stock_movement_type add value if not exists 'sale_reservation';
alter type stock_movement_type add value if not exists 'sale_release';
alter type stock_movement_type add value if not exists 'expiry';
alter type stock_movement_type add value if not exists 'stock_adjustment';
alter type stock_movement_type add value if not exists 'transfer_out';
alter type stock_movement_type add value if not exists 'transfer_in';
alter type stock_movement_type add value if not exists 'manual_correction';

-- ----------------------------------------------------------------------------
-- 2. GRNs (created before inventory_batches because batches reference them)
-- ----------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'grn_status') then
    create type grn_status as enum ('draft', 'confirmed', 'cancelled');
  end if;
end $$;

create sequence if not exists grn_number_seq;

create or replace function generate_grn_number() returns text as $$
  select 'GRN-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('grn_number_seq')::text, 5, '0');
$$ language sql;

create table if not exists grns (
  id uuid primary key default uuid_generate_v4(),
  grn_number text not null unique default generate_grn_number(),
  warehouse_id uuid not null references warehouses(id),
  status grn_status not null default 'draft',
  supplier_reference text,              -- free text: no supplier master table exists yet
  invoice_reference text,
  notes text,
  created_by uuid references profiles(id),
  confirmed_by uuid references profiles(id),
  confirmed_at timestamptz,
  cancelled_by uuid references profiles(id),
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_grns_warehouse on grns(warehouse_id);
create index if not exists idx_grns_status on grns(status);
create index if not exists idx_grns_created_at on grns(created_at desc);

-- ----------------------------------------------------------------------------
-- 3. inventory_batches — batch-level stock with expiry tracking.
--    available = current_quantity - reserved_quantity (never negative:
--    enforced by the check constraints below).
-- ----------------------------------------------------------------------------
create table if not exists inventory_batches (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid not null references products(id) on delete cascade,
  warehouse_id uuid not null references warehouses(id) on delete cascade,
  batch_number text not null,
  manufacturing_date date,
  expiry_date date,                     -- null = non-expiring product
  received_quantity int not null default 0 check (received_quantity >= 0),
  current_quantity int not null default 0 check (current_quantity >= 0),
  reserved_quantity int not null default 0 check (reserved_quantity >= 0),
  damaged_quantity int not null default 0 check (damaged_quantity >= 0),
  expired_quantity int not null default 0 check (expired_quantity >= 0),
  unit_cost numeric(12,2),
  supplier_reference text,
  grn_id uuid references grns(id),
  is_active boolean not null default true,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A batch can never have more reserved than physically present.
  constraint inventory_batches_current_ge_reserved check (current_quantity >= reserved_quantity)
);

-- Batch numbers are compared case-insensitively; normalise on write.
create or replace function normalize_batch_number() returns trigger as $$
begin
  new.batch_number := upper(trim(new.batch_number));
  if new.batch_number = '' then
    raise exception 'Batch number cannot be empty.';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_normalize_batch_number on inventory_batches;
create trigger trg_normalize_batch_number
  before insert or update of batch_number on inventory_batches
  for each row execute function normalize_batch_number();

-- Same batch number cannot exist twice for one product in one warehouse.
create unique index if not exists uq_inventory_batches_product_warehouse_number
  on inventory_batches(product_id, warehouse_id, batch_number);
create index if not exists idx_inventory_batches_fefo
  on inventory_batches(product_id, warehouse_id, expiry_date asc nulls last);
create index if not exists idx_inventory_batches_expiry on inventory_batches(expiry_date);
create index if not exists idx_inventory_batches_grn on inventory_batches(grn_id);
create index if not exists idx_inventory_batches_warehouse on inventory_batches(warehouse_id);

-- ----------------------------------------------------------------------------
-- 4. GRN items (may point at the batch created/updated on confirmation)
-- ----------------------------------------------------------------------------
create table if not exists grn_items (
  id uuid primary key default uuid_generate_v4(),
  grn_id uuid not null references grns(id) on delete cascade,
  product_id uuid not null references products(id),
  batch_number text not null,
  manufacturing_date date,
  expiry_date date,
  received_quantity int not null check (received_quantity > 0),
  unit_cost numeric(12,2),
  batch_id uuid references inventory_batches(id),
  created_at timestamptz not null default now(),
  constraint grn_items_dates_valid check (
    expiry_date is null or manufacturing_date is null or expiry_date > manufacturing_date
  )
);

create index if not exists idx_grn_items_grn on grn_items(grn_id);
create index if not exists idx_grn_items_product on grn_items(product_id);

-- ----------------------------------------------------------------------------
-- 5. Enrich the stock movement ledger (additive columns only).
-- ----------------------------------------------------------------------------
alter table stock_movements
  add column if not exists batch_id uuid references inventory_batches(id),
  add column if not exists reference_type text,
  add column if not exists reference_id uuid,
  add column if not exists previous_quantity int,
  add column if not exists new_quantity int,
  add column if not exists direction text check (direction in ('in', 'out')),
  -- For 'sale' movements: how much of the quantity was previously reserved
  -- (that much reserved_quantity is released alongside the physical out).
  add column if not exists releases_reserved int not null default 0 check (releases_reserved >= 0);

-- Monotonic insertion order (uuid pks are random; created_at ties within
-- a transaction). Backfills existing rows arbitrarily, which is fine —
-- the ledger was effectively append-ordered by created_at before.
create sequence if not exists stock_movements_seq_seq;
alter table stock_movements
  add column if not exists seq bigint not null default nextval('stock_movements_seq_seq');
create index if not exists idx_stock_movements_seq on stock_movements(seq desc);

create index if not exists idx_stock_movements_batch on stock_movements(batch_id);
create index if not exists idx_stock_movements_reference on stock_movements(reference_type, reference_id);
create index if not exists idx_stock_movements_created_at on stock_movements(created_at desc);
create index if not exists idx_stock_movements_type on stock_movements(movement_type);

-- Append-only ledger: no UPDATE or DELETE through any application role.
-- Only a service-role caller (e.g. a vetted data correction performed
-- server-side with SUPABASE_SERVICE_ROLE_KEY) may amend history.
create or replace function prevent_ledger_mutation() returns trigger as $$
begin
  if public.current_jwt_role() = 'service_role' then
    return coalesce(new, old);
  end if;
  raise exception 'stock_movements is an append-only ledger: % operations are not allowed.', lower(tg_op);
end;
$$ language plpgsql;

drop trigger if exists trg_stock_movements_immutable on stock_movements;
create trigger trg_stock_movements_immutable
  before update or delete on stock_movements
  for each row execute function prevent_ledger_mutation();

-- ----------------------------------------------------------------------------
-- 6. Replace the stock application trigger.
--    The original AFTER INSERT trigger only synced inventory_stock.quantity.
--    The new BEFORE INSERT trigger additionally:
--      * maintains batch-level quantities when batch_id is set
--      * maintains reserved_quantity (sale_reservation / sale_release /
--        sale-with-releases_reserved)
--      * stamps previous/new quantity and direction onto the ledger row
--    Every stock change in the system still flows through stock_movements —
--    this remains the single bookkeeping path.
-- ----------------------------------------------------------------------------
drop trigger if exists trg_apply_stock_movement on stock_movements;

create or replace function apply_stock_movement() returns trigger as $$
declare
  v_physical_delta int := 0;
  v_reserved_delta int := 0;
  v_direction text;
  v_batch inventory_batches%rowtype;
  v_stock inventory_stock%rowtype;
begin
  -- Classify the movement.
  case new.movement_type
    when 'opening_stock', 'grn_receipt', 'inward', 'return', 'transfer_in' then
      v_physical_delta := new.quantity;
      v_direction := 'in';
    when 'outward', 'sale', 'damage', 'expiry', 'transfer', 'transfer_out' then
      v_physical_delta := -new.quantity;
      v_direction := 'out';
    when 'adjustment', 'stock_adjustment', 'manual_correction' then
      -- Signed convention (pre-existing): positive increases, negative decreases.
      v_physical_delta := new.quantity;
      v_direction := case when new.quantity >= 0 then 'in' else 'out' end;
    when 'sale_reservation' then
      v_reserved_delta := new.quantity;
      v_direction := 'out';
    when 'sale_release' then
      v_reserved_delta := -new.quantity;
      v_direction := 'in';
    else
      raise exception 'Unknown stock movement type: %', new.movement_type;
  end case;

  if new.movement_type not in ('adjustment', 'stock_adjustment', 'manual_correction')
     and new.quantity <= 0 then
    raise exception 'Movement quantity must be positive for type %.', new.movement_type;
  end if;

  if new.movement_type = 'sale' then
    -- A sale consumes physical stock and releases whatever part of it
    -- had been reserved (0 for unreserved/legacy dispatches).
    v_reserved_delta := -least(new.releases_reserved, new.quantity);
  end if;

  -- Batch-level bookkeeping first (row is already locked by the calling RPC).
  if new.batch_id is not null then
    select * into v_batch from inventory_batches where id = new.batch_id;
    if not found then
      raise exception 'Batch % does not exist.', new.batch_id;
    end if;

    update inventory_batches
    set current_quantity  = current_quantity + v_physical_delta,
        reserved_quantity = reserved_quantity + v_reserved_delta,
        damaged_quantity  = damaged_quantity + case when new.movement_type = 'damage' then new.quantity else 0 end,
        expired_quantity  = expired_quantity + case when new.movement_type = 'expiry' then new.quantity else 0 end,
        updated_at        = now()
    where id = new.batch_id;

    new.previous_quantity := v_batch.current_quantity;
    new.new_quantity := v_batch.current_quantity + v_physical_delta;
  end if;

  -- Product x warehouse bookkeeping (upsert keeps legacy behaviour).
  select * into v_stock
  from inventory_stock
  where product_id = new.product_id and warehouse_id = new.warehouse_id;

  if found then
    update inventory_stock
    set quantity          = quantity + v_physical_delta,
        reserved_quantity = reserved_quantity + v_reserved_delta,
        updated_at        = now()
    where id = v_stock.id;
  else
    insert into inventory_stock (product_id, warehouse_id, quantity, reserved_quantity, updated_at)
    values (new.product_id, new.warehouse_id, v_physical_delta, greatest(v_reserved_delta, 0), now());
  end if;

  if new.batch_id is null then
    new.previous_quantity := coalesce(v_stock.quantity, 0);
    new.new_quantity := coalesce(v_stock.quantity, 0) + v_physical_delta;
  end if;
  new.direction := v_direction;

  return new;
end;
$$ language plpgsql;

create trigger trg_apply_stock_movement
  before insert on stock_movements
  for each row execute function apply_stock_movement();

-- Hard floor: on-hand stock can never be negative.
alter table inventory_stock
  drop constraint if exists inventory_stock_quantity_non_negative;
alter table inventory_stock
  add constraint inventory_stock_quantity_non_negative check (quantity >= 0);

-- ----------------------------------------------------------------------------
-- 7. FEFO reservation records (order_item -> batch)
-- ----------------------------------------------------------------------------
create table if not exists order_stock_allocations (
  id uuid primary key default uuid_generate_v4(),
  order_id uuid not null references orders(id) on delete cascade,
  order_item_id uuid not null references order_items(id) on delete cascade,
  product_id uuid not null references products(id),
  warehouse_id uuid not null references warehouses(id),
  batch_id uuid not null references inventory_batches(id),
  quantity_reserved int not null check (quantity_reserved > 0),
  quantity_dispatched int not null default 0 check (quantity_dispatched >= 0),
  quantity_returned int not null default 0 check (quantity_returned >= 0),
  status text not null default 'reserved' check (status in ('reserved', 'released', 'dispatched', 'returned')),
  created_at timestamptz not null default now(),
  unique (order_item_id, batch_id),
  constraint osa_dispatched_le_reserved check (quantity_dispatched <= quantity_reserved),
  constraint osa_returned_le_dispatched check (quantity_returned <= quantity_dispatched)
);

create index if not exists idx_osa_order on order_stock_allocations(order_id);
create index if not exists idx_osa_batch on order_stock_allocations(batch_id);
create index if not exists idx_osa_product_warehouse on order_stock_allocations(product_id, warehouse_id);

-- ----------------------------------------------------------------------------
-- 8. Inter-warehouse transfers
-- ----------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'transfer_status') then
    create type transfer_status as enum ('pending', 'completed', 'cancelled');
  end if;
end $$;

create sequence if not exists transfer_number_seq;

create or replace function generate_transfer_number() returns text as $$
  select 'TRF-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('transfer_number_seq')::text, 5, '0');
$$ language sql;

create table if not exists stock_transfers (
  id uuid primary key default uuid_generate_v4(),
  transfer_number text not null unique default generate_transfer_number(),
  source_warehouse_id uuid not null references warehouses(id),
  destination_warehouse_id uuid not null references warehouses(id),
  status transfer_status not null default 'pending',
  notes text,
  created_by uuid references profiles(id),
  completed_by uuid references profiles(id),
  completed_at timestamptz,
  cancelled_by uuid references profiles(id),
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stock_transfers_distinct_warehouses check (source_warehouse_id <> destination_warehouse_id)
);

create table if not exists stock_transfer_items (
  id uuid primary key default uuid_generate_v4(),
  transfer_id uuid not null references stock_transfers(id) on delete cascade,
  product_id uuid not null references products(id),
  batch_id uuid not null references inventory_batches(id),
  quantity int not null check (quantity > 0),
  unique (transfer_id, batch_id)
);

create index if not exists idx_sti_transfer on stock_transfer_items(transfer_id);
create index if not exists idx_stock_transfers_status on stock_transfers(status);
create index if not exists idx_stock_transfers_created_at on stock_transfers(created_at desc);

-- ----------------------------------------------------------------------------
-- 9. Configurable thresholds + expiry windows
-- ----------------------------------------------------------------------------
alter table products
  add column if not exists min_stock int not null default 0 check (min_stock >= 0),
  add column if not exists reorder_level int not null default 0 check (reorder_level >= 0),
  add column if not exists max_stock int not null default 0 check (max_stock >= 0);

comment on column products.reorder_level is 'At-or-below this available quantity the product is flagged LOW STOCK. 0 = not configured.';

create table if not exists inventory_settings (
  id boolean primary key default true check (id = true),
  expiry_critical_days int not null default 7 check (expiry_critical_days >= 0),
  expiry_warning_days int not null default 30 check (expiry_warning_days >= 0),
  low_stock_alert_cooldown_hours int not null default 24 check (low_stock_alert_cooldown_hours >= 0),
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now()
);

insert into inventory_settings (id) values (true) on conflict (id) do nothing;

-- ============================================================================
-- 10. RPCs — atomic stock operations (server-side FEFO, no read-calc-write)
-- ============================================================================
-- All functions are SECURITY DEFINER with a pinned search_path and refuse
-- to run for roles below staff. Retailers and salesmen can never mutate
-- inventory through them; RLS additionally hides the tables themselves.

create or replace function require_inventory_role()
returns void
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;
  if public.current_user_role() not in ('super_admin', 'admin', 'staff') then
    raise exception 'You do not have permission to manage inventory.';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 10a. FEFO allocation helper. Locks the eligible batches of one product in
--      a stable order (by id) and returns the allocation plan as a table.
--      Expired batches and zero-available batches are never considered.
-- ----------------------------------------------------------------------------
create or replace function fefo_plan_for_product(
  p_product_id uuid,
  p_warehouse_id uuid,
  p_required int
)
returns table (batch_id uuid, allocate int)
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare
  v_remaining int := p_required;
  v_rec record;
begin
  for v_rec in
    select b.id, b.current_quantity - b.reserved_quantity as available
    from inventory_batches b
    where b.product_id = p_product_id
      and b.warehouse_id = p_warehouse_id
      and b.is_active
      and b.current_quantity - b.reserved_quantity > 0
      and (b.expiry_date is null or b.expiry_date >= current_date)
    order by b.expiry_date asc nulls last, b.created_at asc, b.id asc
    for update
  loop
    exit when v_remaining <= 0;
    batch_id := v_rec.id;
    allocate := least(v_rec.available, v_remaining);
    v_remaining := v_remaining - allocate;
    return next;
  end loop;

  if v_remaining > 0 then
    raise exception 'INSUFFICIENT_STOCK: short by % unit(s) for product %', v_remaining, p_product_id;
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 10a-2. Backwards-compatibility bridge.
--        inventory_stock rows created BEFORE batches existed (via the old
--        adjustment/inward flows) still represent real sellable stock. This
--        function verifies the product-level available quantity can cover
--        the requirement, and folds any un-batched remainder into an
--        auto-created OPENING batch (no expiry) so FEFO can allocate it.
--        Must run inside the caller's transaction, after locking.
-- ----------------------------------------------------------------------------
create or replace function ensure_fefo_coverage(
  p_product_id uuid,
  p_warehouse_id uuid,
  p_required int
)
returns void
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare
  v_stock inventory_stock%rowtype;
  v_product products%rowtype;
  v_product_available int;
  v_batch_available int;
  v_shortfall int;
  v_batch inventory_batches%rowtype;
begin
  select * into v_stock
  from inventory_stock
  where product_id = p_product_id and warehouse_id = p_warehouse_id
  for update;

  v_product_available := coalesce(v_stock.quantity, 0) - coalesce(v_stock.reserved_quantity, 0);
  if v_product_available < p_required then
    select * into v_product from products where id = p_product_id;
    raise exception 'INSUFFICIENT_STOCK: only % unit(s) of % available (requested %).',
      greatest(v_product_available, 0), coalesce(v_product.name, p_product_id::text), p_required;
  end if;

  select coalesce(sum(current_quantity - reserved_quantity), 0) into v_batch_available
  from inventory_batches
  where product_id = p_product_id
    and warehouse_id = p_warehouse_id
    and is_active
    and current_quantity - reserved_quantity > 0
    and (expiry_date is null or expiry_date >= current_date);

  -- Bridge ONLY when this product/warehouse has no batches at all (the
  -- true pre-migration legacy state). If batches exist but don't cover
  -- the requirement, the gap is expired/damaged/not-yet-written-off stock
  -- and must NOT become sellable through a synthetic OPENING batch —
  -- the FEFO planner will (correctly) report insufficient stock instead.
  if v_batch_available < p_required
     and not exists (select 1 from inventory_batches
                     where product_id = p_product_id and warehouse_id = p_warehouse_id) then
    -- Fold the ENTIRE un-batched balance into one OPENING batch (not just
    -- this order's requirement), so subsequent orders see the same pool.
    v_shortfall := v_product_available;
    if v_shortfall > 0 then
      select * into v_product from products where id = p_product_id;

      -- Direct batch insert, deliberately WITHOUT a stock movement: the
      -- units already exist in inventory_stock (recorded by pre-batch
      -- movements), so a movement here would double-count them. The
      -- audit_logs trigger on inventory_batches records who/when.
      insert into inventory_batches
        (product_id, warehouse_id, batch_number, received_quantity, current_quantity, created_by)
      values
        (p_product_id, p_warehouse_id,
         'OPENING-' || upper(v_product.sku_code) || '-' || substr(gen_random_uuid()::text, 1, 8),
         v_shortfall, v_shortfall, auth.uid())
      returning * into v_batch;
    end if;
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 10b. Reserve stock for an order (called when an order is approved).
--      FEFO across that warehouse's batches; idempotent per order; safe
--      under concurrent approvals/orders via row locks + check constraints.
-- ----------------------------------------------------------------------------
create or replace function reserve_order_stock(p_order_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_order orders%rowtype;
  v_item record;
  v_plan record;
  v_allocated int;
  v_summary jsonb := '[]'::jsonb;
begin
  perform public.require_inventory_role();

  -- Lock the order row: concurrent approvals of the SAME order serialise here.
  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found.';
  end if;
  if v_order.warehouse_id is null then
    raise exception 'Assign a warehouse to this order before approving it.';
  end if;

  -- Idempotency: an order that already has live allocations is not re-reserved.
  if exists (select 1 from order_stock_allocations where order_id = p_order_id and status = 'reserved') then
    return jsonb_build_object('status', 'already_reserved', 'order_id', p_order_id);
  end if;

  for v_item in
    select oi.id as order_item_id, oi.product_id, oi.quantity
    from order_items oi
    where oi.order_id = p_order_id
    order by oi.id
  loop
    -- Product-level availability check + legacy un-batched stock bridge.
    perform public.ensure_fefo_coverage(v_item.product_id, v_order.warehouse_id, v_item.quantity);

    v_allocated := 0;

    for v_plan in
      select * from public.fefo_plan_for_product(v_item.product_id, v_order.warehouse_id, v_item.quantity)
    loop
      insert into order_stock_allocations
        (order_id, order_item_id, product_id, warehouse_id, batch_id, quantity_reserved, status)
      values
        (p_order_id, v_item.order_item_id, v_item.product_id, v_order.warehouse_id, v_plan.batch_id, v_plan.allocate, 'reserved')
      on conflict (order_item_id, batch_id) do nothing;

      insert into stock_movements
        (product_id, warehouse_id, batch_id, movement_type, quantity,
         reference_type, reference_id, reference_order_id, reason, performed_by)
      values
        (v_item.product_id, v_order.warehouse_id, v_plan.batch_id, 'sale_reservation', v_plan.allocate,
         'order', p_order_id, p_order_id, 'FEFO reservation for order ' || v_order.order_number, auth.uid());

      v_allocated := v_allocated + v_plan.allocate;
    end loop;

    if v_allocated < v_item.quantity then
      raise exception 'INSUFFICIENT_STOCK: could only allocate % of % units for product %',
        v_allocated, v_item.quantity, v_item.product_id;
    end if;

    v_summary := v_summary || jsonb_build_array(jsonb_build_object(
      'order_item_id', v_item.order_item_id,
      'product_id', v_item.product_id,
      'quantity', v_item.quantity
    ));
  end loop;

  return jsonb_build_object('status', 'reserved', 'order_id', p_order_id, 'items', v_summary);
end;
$$;

-- ----------------------------------------------------------------------------
-- 10c. Release reservations for an order (cancel/reject/expire).
--      Idempotent: only allocations still in 'reserved' state are released.
-- ----------------------------------------------------------------------------
create or replace function release_order_stock(p_order_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_alloc record;
  v_order orders%rowtype;
  v_released int := 0;
begin
  -- NOTE: no role check on purpose — this is invoked from the orders
  -- cancel trigger (which may fire for a retailer's own cancel). It only
  -- ever RELEASES stock back to inventory and is idempotent.

  select * into v_order from orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('status', 'order_not_found');
  end if;

  for v_alloc in
    select * from order_stock_allocations
    where order_id = p_order_id and status = 'reserved'
    order by id
    for update
  loop
    insert into stock_movements
      (product_id, warehouse_id, batch_id, movement_type, quantity,
       reference_type, reference_id, reference_order_id, reason, performed_by)
    values
      (v_alloc.product_id, v_alloc.warehouse_id, v_alloc.batch_id, 'sale_release',
       v_alloc.quantity_reserved - v_alloc.quantity_dispatched,
       'order', p_order_id, p_order_id,
       'Reservation released for order ' || v_order.order_number, auth.uid());

    update order_stock_allocations
    set status = 'released'
    where id = v_alloc.id;

    v_released := v_released + (v_alloc.quantity_reserved - v_alloc.quantity_dispatched);
  end loop;

  return jsonb_build_object('status', 'released', 'order_id', p_order_id, 'units_released', v_released);
end;
$$;

-- ----------------------------------------------------------------------------
-- 10d. Consume stock for dispatch. Uses the FEFO allocations recorded at
--      approval time; orders without allocations (legacy / pre-migration)
--      fall back to a direct FEFO deduction so they can still ship.
-- ----------------------------------------------------------------------------
create or replace function consume_order_stock(p_order_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_order orders%rowtype;
  v_item record;
  v_alloc record;
  v_remaining int;
  v_plan record;
  v_consumed int := 0;
begin
  perform public.require_inventory_role();

  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found.';
  end if;
  if v_order.warehouse_id is null then
    raise exception 'Order has no warehouse assigned.';
  end if;
  if v_order.status not in ('confirmed', 'processing', 'packed') then
    raise exception 'Only confirmed, processing or packed orders can be dispatched.';
  end if;

  for v_item in
    select oi.id as order_item_id, oi.product_id, oi.quantity,
           coalesce((select sum(a.quantity_dispatched) from order_stock_allocations a
                     where a.order_item_id = oi.id), 0) as already_dispatched,
           exists (select 1 from order_stock_allocations a where a.order_item_id = oi.id) as has_allocations
    from order_items oi
    where oi.order_id = p_order_id
    order by oi.id
  loop
    -- Idempotency: quantity already dispatched on a previous attempt is skipped.
    v_remaining := v_item.quantity - v_item.already_dispatched;
    if v_remaining <= 0 then
      continue;
    end if;

    -- 1) Consume whatever was reserved for this line (FEFO chosen at approval).
    if v_item.has_allocations then
      for v_alloc in
        select * from order_stock_allocations
        where order_item_id = v_item.order_item_id and status = 'reserved'
        order by id
        for update
      loop
        exit when v_remaining <= 0;
        declare
          v_take int := least(v_alloc.quantity_reserved - v_alloc.quantity_dispatched, v_remaining);
        begin
          insert into stock_movements
            (product_id, warehouse_id, batch_id, movement_type, quantity, releases_reserved,
             reference_type, reference_id, reference_order_id, reason, performed_by)
          values
            (v_item.product_id, v_order.warehouse_id, v_alloc.batch_id, 'sale', v_take, v_take,
             'order', p_order_id, p_order_id, 'Dispatch of order ' || v_order.order_number, auth.uid());

          update order_stock_allocations
          set quantity_dispatched = quantity_dispatched + v_take,
              status = case when quantity_dispatched + v_take >= quantity_reserved then 'dispatched' else status end
          where id = v_alloc.id;

          v_remaining := v_remaining - v_take;
          v_consumed := v_consumed + v_take;
        end;
      end loop;
      if v_remaining > 0 then
        raise exception 'Cannot dispatch order %: reservations no longer cover line % (missing % unit(s)).',
          v_order.order_number, v_item.order_item_id, v_remaining;
      end if;
    else
      -- 2) Legacy fallback (pre-migration orders): deduct via FEFO now.
      perform public.ensure_fefo_coverage(v_item.product_id, v_order.warehouse_id, v_remaining);
      for v_plan in
        select * from public.fefo_plan_for_product(v_item.product_id, v_order.warehouse_id, v_remaining)
      loop
        insert into stock_movements
          (product_id, warehouse_id, batch_id, movement_type, quantity, releases_reserved,
           reference_type, reference_id, reference_order_id, reason, performed_by)
        values
          (v_item.product_id, v_order.warehouse_id, v_plan.batch_id, 'sale', v_plan.allocate, 0,
           'order', p_order_id, p_order_id, 'Dispatch of order ' || v_order.order_number, auth.uid());
        v_remaining := v_remaining - v_plan.allocate;
        v_consumed := v_consumed + v_plan.allocate;
      end loop;
    end if;
  end loop;

  return jsonb_build_object('status', 'consumed', 'order_id', p_order_id, 'units_consumed', v_consumed);
end;
$$;

-- ----------------------------------------------------------------------------
-- 10e. Confirm a GRN — idempotent: a repeat call on an already-confirmed
--      GRN returns without increasing stock a second time.
-- ----------------------------------------------------------------------------
create or replace function confirm_grn(p_grn_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_grn grns%rowtype;
  v_item grn_items%rowtype;
  v_batch inventory_batches%rowtype;
  v_items int := 0;
  v_units int := 0;
begin
  perform public.require_inventory_role();

  select * into v_grn from grns where id = p_grn_id for update;
  if not found then
    raise exception 'GRN not found.';
  end if;

  if v_grn.status = 'confirmed' then
    return jsonb_build_object('status', 'already_confirmed', 'grn_id', p_grn_id, 'grn_number', v_grn.grn_number);
  end if;
  if v_grn.status = 'cancelled' then
    raise exception 'A cancelled GRN cannot be confirmed.';
  end if;

  for v_item in select * from grn_items where grn_id = p_grn_id order by id
  loop
    select * into v_batch
    from inventory_batches
    where product_id = v_item.product_id
      and warehouse_id = v_grn.warehouse_id
      and batch_number = upper(trim(v_item.batch_number))
    for update;

    if found then
      -- Same batch number already exists here: merge the receipt into it,
      -- but never silently overwrite conflicting expiry data.
      -- NOTE: only metadata is updated here — the current_quantity effect
      -- is applied by the grn_receipt movement's trigger below (single
      -- bookkeeping path; touching both would double-count).
      if v_batch.expiry_date is distinct from v_item.expiry_date then
        raise exception 'Batch % already exists with expiry % — GRN line says %. Resolve the conflict before confirming.',
          v_batch.batch_number, coalesce(v_batch.expiry_date::text, 'none'), coalesce(v_item.expiry_date::text, 'none');
      end if;
      update inventory_batches
      set received_quantity = received_quantity + v_item.received_quantity,
          unit_cost         = coalesce(v_item.unit_cost, unit_cost),
          supplier_reference = coalesce(v_grn.supplier_reference, supplier_reference),
          grn_id            = v_grn.id,
          updated_at        = now()
      where id = v_batch.id;
    else
      insert into inventory_batches
        (product_id, warehouse_id, batch_number, manufacturing_date, expiry_date,
         received_quantity, current_quantity, unit_cost, supplier_reference, grn_id, created_by)
      values
        (v_item.product_id, v_grn.warehouse_id, upper(trim(v_item.batch_number)),
         v_item.manufacturing_date, v_item.expiry_date,
         v_item.received_quantity, 0, v_item.unit_cost,
         v_grn.supplier_reference, v_grn.id, auth.uid())
      returning * into v_batch;
    end if;

    update grn_items set batch_id = v_batch.id where id = v_item.id;

    insert into stock_movements
      (product_id, warehouse_id, batch_id, movement_type, quantity,
       reference_type, reference_id, reason, performed_by)
    values
      (v_item.product_id, v_grn.warehouse_id, v_batch.id, 'grn_receipt', v_item.received_quantity,
       'grn', v_grn.id, 'GRN ' || v_grn.grn_number || ' received', auth.uid());

    v_items := v_items + 1;
    v_units := v_units + v_item.received_quantity;
  end loop;

  if v_items = 0 then
    raise exception 'GRN % has no items — add at least one product line before confirming.', v_grn.grn_number;
  end if;

  update grns
  set status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now(), updated_at = now()
  where id = p_grn_id;

  return jsonb_build_object('status', 'confirmed', 'grn_id', p_grn_id, 'grn_number', v_grn.grn_number,
                            'items', v_items, 'units', v_units);
end;
$$;

-- ----------------------------------------------------------------------------
-- 10f. Cancel a GRN — only while it is still a draft (safe: no stock moved).
-- ----------------------------------------------------------------------------
create or replace function cancel_grn(p_grn_id uuid, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_grn grns%rowtype;
begin
  perform public.require_inventory_role();

  select * into v_grn from grns where id = p_grn_id for update;
  if not found then
    raise exception 'GRN not found.';
  end if;
  if v_grn.status = 'cancelled' then
    return jsonb_build_object('status', 'already_cancelled');
  end if;
  if v_grn.status = 'confirmed' then
    raise exception 'A confirmed GRN cannot be cancelled — record a damage/expiry write-off or manual correction instead.';
  end if;

  update grns
  set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(),
      cancellation_reason = p_reason, updated_at = now()
  where id = p_grn_id;

  return jsonb_build_object('status', 'cancelled', 'grn_id', p_grn_id);
end;
$$;

-- ----------------------------------------------------------------------------
-- 10g. Execute a warehouse transfer atomically.
--      TRANSFER_OUT (source) and TRANSFER_IN (destination) share the same
--      reference (the transfer id). Never moves more than available stock.
-- ----------------------------------------------------------------------------
create or replace function execute_stock_transfer(p_transfer_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_transfer stock_transfers%rowtype;
  v_item stock_transfer_items%rowtype;
  v_src inventory_batches%rowtype;
  v_dst inventory_batches%rowtype;
  v_available int;
  v_units int := 0;
begin
  perform public.require_inventory_role();

  select * into v_transfer from stock_transfers where id = p_transfer_id for update;
  if not found then
    raise exception 'Transfer not found.';
  end if;
  if v_transfer.status = 'completed' then
    return jsonb_build_object('status', 'already_completed');
  end if;
  if v_transfer.status = 'cancelled' then
    raise exception 'A cancelled transfer cannot be executed.';
  end if;

  for v_item in select * from stock_transfer_items where transfer_id = p_transfer_id order by id
  loop
    select * into v_src from inventory_batches where id = v_item.batch_id for update;
    if not found then
      raise exception 'Source batch no longer exists.';
    end if;
    if v_src.product_id <> v_item.product_id or v_src.warehouse_id <> v_transfer.source_warehouse_id then
      raise exception 'Batch % does not belong to the source warehouse of this transfer.', v_src.batch_number;
    end if;

    v_available := v_src.current_quantity - v_src.reserved_quantity;
    if v_available < v_item.quantity then
      raise exception 'INSUFFICIENT_STOCK: batch % has only % available unit(s); transfer asks for %.',
        v_src.batch_number, v_available, v_item.quantity;
    end if;

    -- Destination batch: merge into an existing row with the same batch
    -- number, or create the mirror batch (same mfg/expiry/cost) there.
    select * into v_dst
    from inventory_batches
    where product_id = v_item.product_id
      and warehouse_id = v_transfer.destination_warehouse_id
      and batch_number = v_src.batch_number
    for update;

    if found then
      if v_dst.expiry_date is distinct from v_src.expiry_date then
        raise exception 'Destination already holds batch % with a different expiry date; resolve before transferring.',
          v_src.batch_number;
      end if;
      -- Metadata only: the physical effect is applied by the transfer
      -- movements' trigger (single bookkeeping path).
      update inventory_batches
      set received_quantity = received_quantity + v_item.quantity,
          updated_at        = now()
      where id = v_dst.id;
    else
      insert into inventory_batches
        (product_id, warehouse_id, batch_number, manufacturing_date, expiry_date,
         received_quantity, current_quantity, unit_cost, supplier_reference, created_by)
      values
        (v_item.product_id, v_transfer.destination_warehouse_id, v_src.batch_number,
         v_src.manufacturing_date, v_src.expiry_date,
         v_item.quantity, 0, v_src.unit_cost, v_src.supplier_reference, auth.uid())
      returning * into v_dst;
    end if;

    insert into stock_movements
      (product_id, warehouse_id, batch_id, movement_type, quantity,
       reference_type, reference_id, reason, performed_by)
    values
      (v_item.product_id, v_transfer.source_warehouse_id, v_src.id, 'transfer_out', v_item.quantity,
       'transfer', v_transfer.id, 'Transfer ' || v_transfer.transfer_number, auth.uid()),
      (v_item.product_id, v_transfer.destination_warehouse_id, v_dst.id, 'transfer_in', v_item.quantity,
       'transfer', v_transfer.id, 'Transfer ' || v_transfer.transfer_number, auth.uid());

    v_units := v_units + v_item.quantity;
  end loop;

  update stock_transfers
  set status = 'completed', completed_by = auth.uid(), completed_at = now(), updated_at = now()
  where id = p_transfer_id;

  return jsonb_build_object('status', 'completed', 'transfer_id', p_transfer_id, 'units', v_units);
end;
$$;

-- ----------------------------------------------------------------------------
-- 10h. Cancel a pending transfer (no stock has moved yet).
-- ----------------------------------------------------------------------------
create or replace function cancel_stock_transfer(p_transfer_id uuid, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_transfer stock_transfers%rowtype;
begin
  perform public.require_inventory_role();

  select * into v_transfer from stock_transfers where id = p_transfer_id for update;
  if not found then
    raise exception 'Transfer not found.';
  end if;
  if v_transfer.status = 'cancelled' then
    return jsonb_build_object('status', 'already_cancelled');
  end if;
  if v_transfer.status = 'completed' then
    raise exception 'A completed transfer cannot be cancelled — create a reverse transfer instead.';
  end if;

  update stock_transfers
  set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(),
      cancellation_reason = p_reason, updated_at = now()
  where id = p_transfer_id;

  return jsonb_build_object('status', 'cancelled', 'transfer_id', p_transfer_id);
end;
$$;

-- ----------------------------------------------------------------------------
-- 10i. Record damaged or expired stock against a batch. Reserved stock can
--      never be written off — release/cancel the holding order first.
-- ----------------------------------------------------------------------------
create or replace function record_batch_loss(
  p_batch_id uuid,
  p_quantity int,
  p_loss_type text,                    -- 'damage' | 'expiry'
  p_reason text
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_batch inventory_batches%rowtype;
  v_available int;
  v_movement_type stock_movement_type;
begin
  perform public.require_inventory_role();

  if p_loss_type not in ('damage', 'expiry') then
    raise exception 'Loss type must be damage or expiry.';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be a positive whole number.';
  end if;
  v_movement_type := p_loss_type::stock_movement_type;

  select * into v_batch from inventory_batches where id = p_batch_id for update;
  if not found then
    raise exception 'Batch not found.';
  end if;

  v_available := v_batch.current_quantity - v_batch.reserved_quantity;
  if p_quantity > v_available then
    raise exception 'Only % unit(s) of batch % are available to write off (% reserved for orders).',
      v_available, v_batch.batch_number, v_batch.reserved_quantity;
  end if;

  insert into stock_movements
    (product_id, warehouse_id, batch_id, movement_type, quantity,
     reference_type, reference_id, reason, performed_by)
  values
    (v_batch.product_id, v_batch.warehouse_id, v_batch.id, v_movement_type, p_quantity,
     'manual', null, coalesce(nullif(trim(p_reason), ''), p_loss_type || ' write-off'), auth.uid());

  return jsonb_build_object('status', 'recorded', 'batch_id', p_batch_id, 'quantity', p_quantity, 'type', p_loss_type);
end;
$$;

-- ----------------------------------------------------------------------------
-- 10j. Manual stock adjustment (replaces direct movement inserts).
--      With p_batch_id: corrects that batch (never below its reservations).
--      Without: product x warehouse correction at the aggregate level.
-- ----------------------------------------------------------------------------
create or replace function adjust_product_stock(
  p_product_id uuid,
  p_warehouse_id uuid,
  p_quantity int,                      -- signed: + increase, - decrease
  p_reason text,
  p_batch_id uuid default null
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_batch inventory_batches%rowtype;
  v_stock inventory_stock%rowtype;
begin
  perform public.require_inventory_role();

  if p_quantity is null or p_quantity = 0 then
    raise exception 'Adjustment quantity cannot be zero.';
  end if;
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'Provide a reason for this adjustment.';
  end if;

  if p_batch_id is not null then
    select * into v_batch from inventory_batches where id = p_batch_id for update;
    if not found then
      raise exception 'Batch not found.';
    end if;
    if v_batch.product_id <> p_product_id or v_batch.warehouse_id <> p_warehouse_id then
      raise exception 'Batch does not belong to this product/warehouse.';
    end if;
    if v_batch.current_quantity + p_quantity < v_batch.reserved_quantity then
      raise exception 'Adjustment would leave batch % below its % reserved unit(s).',
        v_batch.batch_number, v_batch.reserved_quantity;
    end if;
  else
    select * into v_stock
    from inventory_stock
    where product_id = p_product_id and warehouse_id = p_warehouse_id
    for update;
    if found and v_stock.quantity + p_quantity < 0 then
      raise exception 'Adjustment would make on-hand stock negative (currently %).', v_stock.quantity;
    end if;
  end if;

  insert into stock_movements
    (product_id, warehouse_id, batch_id, movement_type, quantity,
     reference_type, reference_id, reason, performed_by)
  values
    (p_product_id, p_warehouse_id, p_batch_id, 'manual_correction', p_quantity,
     'manual', null, trim(p_reason), auth.uid());

  return jsonb_build_object('status', 'adjusted', 'product_id', p_product_id,
                            'warehouse_id', p_warehouse_id, 'quantity', p_quantity);
end;
$$;

-- ----------------------------------------------------------------------------
-- 10k. Accept returned goods back into stock (approved return requests).
--      Returns land in the batches they were dispatched from when known,
--      otherwise at the aggregate product level.
-- ----------------------------------------------------------------------------
create or replace function return_order_stock(p_order_id uuid, p_order_item_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_order orders%rowtype;
  v_alloc record;
  v_item record;
  v_returnable int;
  v_units int := 0;
begin
  perform public.require_inventory_role();

  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found.';
  end if;
  if v_order.warehouse_id is null then
    raise exception 'Order has no warehouse — cannot book returned stock.';
  end if;

  for v_alloc in
    select * from order_stock_allocations
    where order_id = p_order_id
      and (p_order_item_id is null or order_item_id = p_order_item_id)
      and quantity_dispatched > quantity_returned
    order by id
    for update
  loop
    v_returnable := v_alloc.quantity_dispatched - v_alloc.quantity_returned;

    insert into stock_movements
      (product_id, warehouse_id, batch_id, movement_type, quantity,
       reference_type, reference_id, reference_order_id, reason, performed_by)
    values
      (v_alloc.product_id, v_order.warehouse_id, v_alloc.batch_id, 'return', v_returnable,
       'order', p_order_id, p_order_id, 'Goods returned against order ' || v_order.order_number, auth.uid());

    update order_stock_allocations
    set quantity_returned = quantity_dispatched,
        status = 'returned'
    where id = v_alloc.id;

    v_units := v_units + v_returnable;
  end loop;

  -- Fallback for orders dispatched before allocations existed: return at
  -- the aggregate level for any item not fully covered above.
  for v_item in
    select oi.id as order_item_id, oi.product_id, oi.quantity
    from order_items oi
    where oi.order_id = p_order_id
      and (p_order_item_id is null or oi.id = p_order_item_id)
      and not exists (
        select 1 from order_stock_allocations a
        where a.order_item_id = oi.id and a.quantity_dispatched > 0
      )
  loop
    insert into stock_movements
      (product_id, warehouse_id, movement_type, quantity,
       reference_type, reference_id, reference_order_id, reason, performed_by)
    values
      (v_item.product_id, v_order.warehouse_id, 'return', v_item.quantity,
       'order', p_order_id, p_order_id, 'Goods returned against order ' || v_order.order_number, auth.uid());
    v_units := v_units + v_item.quantity;
  end loop;

  return jsonb_build_object('status', 'returned', 'order_id', p_order_id, 'units', v_units);
end;
$$;

-- ----------------------------------------------------------------------------
-- 10l. Auto-release reservations when an order is cancelled — no matter
--      WHO cancels it (admin action or retailer self-cancel of a pending
--      order). Runs as definer so retailer-initiated cancels can write
--      the release movements.
-- ----------------------------------------------------------------------------
create or replace function release_stock_on_order_cancel()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  -- Release whatever live reservations exist, regardless of the status
  -- the order is cancelled from: release_order_stock is idempotent and
  -- only touches allocations still in 'reserved' state, so this is a
  -- no-op for orders that never reserved anything (e.g. plain pending).
  perform public.release_order_stock(new.id);
  return new;
end;
$$;

drop trigger if exists trg_release_stock_on_order_cancel on orders;
create trigger trg_release_stock_on_order_cancel
  after update of status on orders
  for each row
  when (new.status = 'cancelled' and old.status is distinct from new.status)
  execute function release_stock_on_order_cancel();

-- ============================================================================
-- 11. Reporting views (RLS on the underlying tables still applies — a
--     retailer simply sees zero rows, exactly as before).
-- ============================================================================

-- Per-product totals across all warehouses, with batch-aware valuation.
-- The is_staff_or_above() gate keeps inventory internals invisible to
-- retailer/salesman sessions even though `products` itself is readable.
create or replace view inventory_product_totals as
select
  p.id as product_id,
  p.name as product_name,
  p.sku_code,
  coalesce(s.quantity, 0) as quantity_on_hand,
  coalesce(s.reserved_quantity, 0) as reserved_quantity,
  coalesce(s.quantity, 0) - coalesce(s.reserved_quantity, 0) as available_quantity,
  coalesce(b.batch_quantity, 0) as batch_quantity,
  coalesce(b.batch_value, 0)
    + greatest(coalesce(s.quantity, 0) - coalesce(b.batch_quantity, 0), 0) * coalesce(p.cost_price, 0)
    as estimated_value,
  p.min_stock,
  p.reorder_level,
  p.max_stock,
  case
    when coalesce(s.quantity, 0) - coalesce(s.reserved_quantity, 0) <= 0 then 'out_of_stock'
    when p.reorder_level > 0
      and coalesce(s.quantity, 0) - coalesce(s.reserved_quantity, 0) <= p.reorder_level then 'low_stock'
    else 'healthy'
  end as stock_status,
  s.warehouse_count
from products p
left join (
  select product_id, sum(quantity) as quantity, sum(reserved_quantity) as reserved_quantity,
         count(*) as warehouse_count
  from inventory_stock group by product_id
) s on s.product_id = p.id
left join (
  select product_id, sum(current_quantity) as batch_quantity,
         sum(current_quantity * coalesce(unit_cost, 0)) as batch_value
  from inventory_batches group by product_id
) b on b.product_id = p.id
where is_staff_or_above();

-- Expiry report: every batch still holding stock, bucketed by urgency.
create or replace view inventory_expiry_report as
select
  b.id as batch_id,
  b.product_id,
  p.name as product_name,
  p.sku_code,
  b.warehouse_id,
  w.name as warehouse_name,
  b.batch_number,
  b.manufacturing_date,
  b.expiry_date,
  b.current_quantity,
  b.reserved_quantity,
  b.current_quantity - b.reserved_quantity as available_quantity,
  b.current_quantity * coalesce(b.unit_cost, 0) as estimated_value,
  case
    when b.expiry_date is null then null
    else b.expiry_date - current_date
  end as days_remaining,
  case
    when b.expiry_date is null then 'healthy'
    when b.expiry_date < current_date then 'expired'
    when b.expiry_date <= current_date + coalesce((select expiry_critical_days from inventory_settings limit 1), 7) then 'critical'
    when b.expiry_date <= current_date + coalesce((select expiry_warning_days from inventory_settings limit 1), 30) then 'warning'
    else 'healthy'
  end as expiry_status
from inventory_batches b
join products p on p.id = b.product_id
join warehouses w on w.id = b.warehouse_id
where b.current_quantity > 0
  and is_staff_or_above();

-- ============================================================================
-- 12. Row Level Security for every new table.
--     Pattern matches the existing schema: staff+ read, staff+ write,
--     delete reserved for admins where it exists at all. Retailers and
--     salesmen get NO direct access to inventory internals; all mutations
--     happen through the SECURITY DEFINER RPCs above (which re-check the
--     caller's role) or through existing order flows.
-- ============================================================================

alter table inventory_batches enable row level security;
alter table grns enable row level security;
alter table grn_items enable row level security;
alter table order_stock_allocations enable row level security;
alter table stock_transfers enable row level security;
alter table stock_transfer_items enable row level security;
alter table inventory_settings enable row level security;

-- inventory_stock: staff read existed since 0001, but the ledger trigger's
-- upsert and the existing reservation code also need INSERT/UPDATE through
-- staff sessions (the old schema shipped with no write policies here at
-- all, which silently broke staff-initiated movement flows under RLS).
-- Still staff+ only; still no DELETE; new flows should prefer the RPCs.
drop policy if exists "inventory_staff_insert" on inventory_stock;
create policy "inventory_staff_insert" on inventory_stock
  for insert with check (is_staff_or_above());
drop policy if exists "inventory_staff_update" on inventory_stock;
create policy "inventory_staff_update" on inventory_stock
  for update using (is_staff_or_above());

-- inventory_batches
drop policy if exists "inventory_batches_staff_read" on inventory_batches;
create policy "inventory_batches_staff_read" on inventory_batches
  for select using (is_staff_or_above());
drop policy if exists "inventory_batches_staff_insert" on inventory_batches;
create policy "inventory_batches_staff_insert" on inventory_batches
  for insert with check (is_staff_or_above());
drop policy if exists "inventory_batches_staff_update" on inventory_batches;
create policy "inventory_batches_staff_update" on inventory_batches
  for update using (is_staff_or_above());
-- No DELETE policy: batches are corrected via movements, never deleted.

-- grns
drop policy if exists "grns_staff_read" on grns;
create policy "grns_staff_read" on grns for select using (is_staff_or_above());
drop policy if exists "grns_staff_insert" on grns;
create policy "grns_staff_insert" on grns for insert with check (is_staff_or_above());
drop policy if exists "grns_staff_update" on grns;
create policy "grns_staff_update" on grns for update using (is_staff_or_above());

-- grn_items
drop policy if exists "grn_items_staff_read" on grn_items;
create policy "grn_items_staff_read" on grn_items for select using (is_staff_or_above());
drop policy if exists "grn_items_staff_insert" on grn_items;
create policy "grn_items_staff_insert" on grn_items for insert with check (is_staff_or_above());
drop policy if exists "grn_items_staff_update" on grn_items;
create policy "grn_items_staff_update" on grn_items for update using (is_staff_or_above());
drop policy if exists "grn_items_staff_delete" on grn_items;
create policy "grn_items_staff_delete" on grn_items for delete using (is_staff_or_above());

-- order_stock_allocations (staff visibility only — retailers must never see
-- batch internals; the order itself remains visible to them as before)
drop policy if exists "osa_staff_read" on order_stock_allocations;
create policy "osa_staff_read" on order_stock_allocations
  for select using (is_staff_or_above());

-- stock_transfers
drop policy if exists "stock_transfers_staff_read" on stock_transfers;
create policy "stock_transfers_staff_read" on stock_transfers
  for select using (is_staff_or_above());
drop policy if exists "stock_transfers_staff_insert" on stock_transfers;
create policy "stock_transfers_staff_insert" on stock_transfers
  for insert with check (is_staff_or_above());
drop policy if exists "stock_transfers_staff_update" on stock_transfers;
create policy "stock_transfers_staff_update" on stock_transfers
  for update using (is_staff_or_above());

drop policy if exists "stock_transfer_items_staff_read" on stock_transfer_items;
create policy "stock_transfer_items_staff_read" on stock_transfer_items
  for select using (is_staff_or_above());
drop policy if exists "stock_transfer_items_staff_insert" on stock_transfer_items;
create policy "stock_transfer_items_staff_insert" on stock_transfer_items
  for insert with check (is_staff_or_above());
drop policy if exists "stock_transfer_items_staff_delete" on stock_transfer_items;
create policy "stock_transfer_items_staff_delete" on stock_transfer_items
  for delete using (is_staff_or_above());

-- inventory_settings: readable by staff+, writable by admins only
drop policy if exists "inventory_settings_staff_read" on inventory_settings;
create policy "inventory_settings_staff_read" on inventory_settings
  for select using (is_staff_or_above());
drop policy if exists "inventory_settings_admin_update" on inventory_settings;
create policy "inventory_settings_admin_update" on inventory_settings
  for update using (is_admin_or_above());

-- Audit-trail parity with the rest of the schema.
drop trigger if exists trg_audit_grns on grns;
create trigger trg_audit_grns after insert or update or delete on grns
  for each row execute function log_audit();
drop trigger if exists trg_audit_stock_transfers on stock_transfers;
create trigger trg_audit_stock_transfers after insert or update or delete on stock_transfers
  for each row execute function log_audit();
drop trigger if exists trg_audit_inventory_batches on inventory_batches;
create trigger trg_audit_inventory_batches after insert or update or delete on inventory_batches
  for each row execute function log_audit();

-- ============================================================================
-- END OF MIGRATION — no business data inserted; no existing data modified.
-- ============================================================================
