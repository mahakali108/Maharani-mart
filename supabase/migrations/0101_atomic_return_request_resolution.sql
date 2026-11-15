-- ============================================================================
-- 0101 — Atomic approval / rejection of return requests
--
-- REVIEW-ONLY. Do not apply to production without the owner's approval.
-- Requires 0100 (which requires 0094, 0096, 0099).
-- Rollback: supabase/rollbacks/0101_atomic_return_request_resolution.down.sql
--
-- Forward-only: this migration changes nothing inside 0094-0100.
--
-- Before this migration, approving a return request was two separate requests
-- from the server: return_order_stock (stock back), then an UPDATE of the
-- request status. Consequences:
--
--   * a failure between the two left stock restored and the request pending;
--   * for orders that predate simple pack stock (0054) and have no batch
--     allocations, return_order_stock was NOT idempotent - every call booked
--     the whole line again, so a retry or a second request restored the same
--     goods twice;
--   * return_order_stock was executable by any signed-in staff session, so
--     stock could be restored with no return request at all;
--   * a retailer could insert a request that was already "approved", and any
--     staff session in scope could flip the status with a plain UPDATE.
--
-- Now:
--   approve_return_request_atomic  - one transaction: locks, authorisation,
--       validation, stock restored once, request status, history row.
--   reject_return_request_atomic   - one transaction: status + history row.
--       Never touches stock or money.
--   return_request_events          - append-only history of every resolution.
--   order_item_legacy_stock_returns - which ORDER LINE of a pre-pack-stock
--       order has had its stock booked back. The legacy return movement
--       (0017) records only the product, and one order can hold the same
--       product on two lines; without this record the second line would be
--       mistaken for the first.
--   guards                         - no API role can resolve a request, edit
--       one, or restore order stock, except through the two functions.
--
-- MONEY: approving a return request issues NO Coins refund and reverses NO
-- loyalty points. That is the behaviour of the application before this
-- migration and it is kept, because the owner has not decided the refund rule
-- for approved returns (see docs/readiness-2026-11-14/05_OWNER_CHECKLIST.md).
-- The history row records refund_paise = 0 explicitly. The existing full
-- "return to warehouse" flow (0100) is the only path that refunds Coins.
--
-- Lock order (extends 0100; parent first):
--   orders -> return_requests -> order_items -> stock rows
--
-- Idempotent: safe to re-run. No table is dropped and no row is deleted.
-- ============================================================================

do $$
begin
  if to_regprocedure('public._fulfilment_actor_role(uuid, text[], text)') is null
     or to_regprocedure('public.return_delivery_to_warehouse_atomic(uuid, uuid, text)') is null
     or to_regprocedure('public.return_order_stock(uuid, uuid)') is null
     or to_regprocedure('public.restore_simple_order_stock(uuid, uuid)') is null then
    raise exception 'MIGRATION ORDER VIOLATION: 0101 requires 0054, 0089 and 0100.' using errcode = 'undefined_function';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 1. Append-only history of return-request resolutions.
--    No foreign keys on purpose: the retention job (0055) may delete an old
--    request and its order; the history row must neither block that nor vanish.
-- ----------------------------------------------------------------------------
create table if not exists public.return_request_events (
  id uuid primary key default gen_random_uuid(),
  return_request_id uuid not null,
  order_id uuid not null,
  order_item_id uuid,
  retailer_id uuid not null,
  action text not null check (action in ('approved', 'rejected')),
  from_status text not null,
  to_status text not null,
  actor_id uuid not null,
  actor_role text not null,
  note text,
  units_restored integer not null default 0 check (units_restored >= 0),
  lines jsonb not null default '[]'::jsonb,
  refund_paise bigint not null default 0 check (refund_paise = 0),
  created_at timestamptz not null default now(),
  constraint return_request_events_rejection_moves_nothing
    check (action <> 'rejected' or (units_restored = 0 and lines = '[]'::jsonb)),
  constraint return_request_events_approval_restores
    check (action <> 'approved' or units_restored > 0)
);

comment on table public.return_request_events is
  '0101: append-only history of return-request approvals and rejections. Written only by approve_/reject_return_request_atomic.';
comment on column public.return_request_events.refund_paise is
  '0101: always 0. Approving a return request moves no Coins; the refund rule for approved returns is an open owner decision.';

-- One resolution per request, enforced by the database itself.
create unique index if not exists return_request_events_one_resolution
  on public.return_request_events (return_request_id);
create index if not exists idx_return_request_events_order on public.return_request_events (order_id);

alter table public.return_request_events enable row level security;

revoke all on table public.return_request_events from public, anon, authenticated, service_role;
grant select on table public.return_request_events to authenticated, service_role;

drop policy if exists "return_request_events_select" on public.return_request_events;
create policy "return_request_events_select" on public.return_request_events
  for select to authenticated
  using (retailer_id = auth.uid() or public.is_admin_or_above());

-- ----------------------------------------------------------------------------
-- 1b. Legacy orders (no pack stock, no batch allocations): one row per ORDER
--     LINE whose stock has been booked back. The primary key is the order
--     line, so the same line can never be booked twice, and two lines of the
--     same product are told apart. Written only by return_order_stock.
--     No foreign keys, for the same retention reason as above.
-- ----------------------------------------------------------------------------
create table if not exists public.order_item_legacy_stock_returns (
  order_item_id uuid primary key,
  order_id uuid not null,
  product_id uuid not null,
  units integer not null check (units > 0),
  created_at timestamptz not null default now()
);
comment on table public.order_item_legacy_stock_returns is
  '0101: which line of a legacy (pre pack-stock, no batch allocation) order has had its stock booked back. One row per order line, ever. Written only by return_order_stock.';
create index if not exists idx_order_item_legacy_stock_returns_order
  on public.order_item_legacy_stock_returns (order_id, product_id);

alter table public.order_item_legacy_stock_returns enable row level security;
revoke all on table public.order_item_legacy_stock_returns from public, anon, authenticated, service_role;
grant select on table public.order_item_legacy_stock_returns to authenticated, service_role;

drop policy if exists "order_item_legacy_stock_returns_select" on public.order_item_legacy_stock_returns;
create policy "order_item_legacy_stock_returns_select" on public.order_item_legacy_stock_returns
  for select to authenticated
  using (public.is_admin_or_above());

create or replace function public.guard_return_request_events_append_only()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'RETURN_GUARD: % is append-only.', tg_table_name using errcode = '42501';
end;
$$;
revoke all on function public.guard_return_request_events_append_only() from public, anon, authenticated, service_role;

drop trigger if exists trg_guard_return_request_events_append_only on public.return_request_events;
create trigger trg_guard_return_request_events_append_only
  before update or delete on public.return_request_events
  for each row execute function public.guard_return_request_events_append_only();

drop trigger if exists trg_guard_order_item_legacy_stock_returns_append_only on public.order_item_legacy_stock_returns;
create trigger trg_guard_order_item_legacy_stock_returns_append_only
  before update or delete on public.order_item_legacy_stock_returns
  for each row execute function public.guard_return_request_events_append_only();

-- ----------------------------------------------------------------------------
-- 2. A return request is created "requested" and resolved only by the two
--    functions below (SECURITY DEFINER: inside them current_user is the owner,
--    so this guard lets them through). The retention job (0055) is also
--    SECURITY DEFINER and is unaffected.
-- ----------------------------------------------------------------------------
create or replace function public.guard_return_request_write()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.order_item_id is not null and not exists (
      select 1 from public.order_items oi where oi.id = new.order_item_id and oi.order_id = new.order_id
    ) then
      raise exception 'RETURN_GUARD: that item does not belong to this order.' using errcode = '23514';
    end if;
    if current_user in ('anon', 'authenticated', 'service_role')
       and (new.status::text <> 'requested' or new.resolved_by is not null
            or new.resolved_at is not null or new.resolution_note is not null) then
      raise exception 'RETURN_GUARD: a return request starts as "requested"; it is resolved only by an Admin through the server.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if current_user in ('anon', 'authenticated', 'service_role') then
    raise exception 'RETURN_GUARD: return requests are resolved only through approve_return_request_atomic / reject_return_request_atomic.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_return_request_write() from public, anon, authenticated, service_role;

drop trigger if exists trg_guard_return_request_write on public.return_requests;
create trigger trg_guard_return_request_write
  before insert or update on public.return_requests
  for each row execute function public.guard_return_request_write();

-- ----------------------------------------------------------------------------
-- 3. What is still restorable, per ORDER LINE. Private. Writes nothing.
--
--    Pack stock (0054/0089): the per-line counters on order_items.
--    Batch allocations (0017): what was dispatched and not yet returned.
--    Legacy fallback (0017, no allocation): the whole line, once.
--      "Once" is decided per order line (order_item_legacy_stock_returns).
--      A return movement written BEFORE this migration names the product but
--      not the line, so there is a second, product-level limit: across all
--      fallback lines of one product in the order, never more is booked back
--      than those lines hold. A line that does not fit under what is left
--      is not restorable (refused, never part-booked). A whole-order request
--      takes the open lines in line order while they fit.
-- ----------------------------------------------------------------------------
create or replace function public._return_request_restorable_lines(
  p_order_id uuid,
  p_order_item_id uuid
) returns table (order_item_id uuid, units integer, seller_fulfilled boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with lines as (
    select oi.id, oi.product_id, oi.quantity, oi.sub_order_id,
           oi.stock_deducted_quantity, oi.stock_restored_quantity, oi.shipped_quantity, oi.returned_received_quantity,
           oi.source_type, oi.fulfilment_type,
           o.simple_stock_mode as simple,
           exists (select 1 from public.order_stock_allocations a
                    where a.order_item_id = oi.id and a.quantity_dispatched > 0) as allocated
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
     where oi.order_id = p_order_id
  ),
  -- Legacy fallback lines, per product: what the lines hold in total, and what
  -- has already been booked back for that product against this order.
  legacy_room as (
    select l.product_id,
           sum(l.quantity)
             - coalesce((select sum(m.quantity) from public.stock_movements m
                          where m.reference_order_id = p_order_id and m.product_id = l.product_id
                            and m.movement_type = 'return' and m.batch_id is null), 0) as room
      from lines l
     where not l.simple and not l.allocated
     group by l.product_id
  ),
  -- Fallback lines in scope that are not booked yet, with a running total per
  -- product (in line order), so a request covering several lines of one
  -- product is held to the same product-level limit as the lines one by one.
  legacy_open as (
    select l.id, sum(l.quantity) over (partition by l.product_id order by l.id) as running
      from lines l
     where not l.simple and not l.allocated
       and (p_order_item_id is null or l.id = p_order_item_id)
       and not exists (select 1 from public.order_item_legacy_stock_returns r where r.order_item_id = l.id)
  )
  select l.id,
         greatest(0, case
           when l.simple and l.sub_order_id is null
             then l.stock_deducted_quantity - l.stock_restored_quantity
           when l.simple
             then l.stock_deducted_quantity - l.shipped_quantity
                  + l.returned_received_quantity - l.stock_restored_quantity
           when l.allocated
             then (select coalesce(sum(a.quantity_dispatched - a.quantity_returned), 0)
                     from public.order_stock_allocations a
                    where a.order_item_id = l.id and a.quantity_dispatched > a.quantity_returned)
           when (select lo.running from legacy_open lo where lo.id = l.id)
                  <= (select r.room from legacy_room r where r.product_id = l.product_id)
             then l.quantity
           else 0
         end)::integer,
         coalesce(l.source_type::text = 'seller' and l.fulfilment_type::text = 'seller', false)
    from lines l
   where p_order_item_id is null or l.id = p_order_item_id
   order by l.id;
$$;
revoke all on function public._return_request_restorable_lines(uuid, uuid) from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. return_order_stock: (a) no API role may call it - stock comes back only
--    inside a function that also commits the return state; (b) for orders
--    without pack stock it now works line by line: a line with batch
--    allocations is returned by the 0017 function (already idempotent); a
--    line without them is booked back once, recorded against the ORDER LINE.
--    A line with nothing left is skipped and nothing is written for it.
--    The pack-stock branch (0054) is unchanged.
-- ----------------------------------------------------------------------------
create or replace function public.return_order_stock(p_order_id uuid, p_order_item_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_simple boolean;
  v_status public.order_status;
  v_units integer := 0;
  v_line record;
  v_got integer;
  v_product uuid;
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

  -- Legacy order. The order row is locked above, so two calls for the same
  -- order run one after the other; each line is re-read inside the loop, after
  -- the lines before it have been booked.
  for v_line in
    select oi.id from public.order_items oi
     where oi.order_id = p_order_id and (p_order_item_id is null or oi.id = p_order_item_id)
     order by oi.id
     for update
  loop
    select r.units into v_got from public._return_request_restorable_lines(p_order_id, v_line.id) r;
    continue when coalesce(v_got, 0) = 0;

    v_got := coalesce((public.return_legacy_order_stock(p_order_id, v_line.id) ->> 'units')::integer, 0);
    if not exists (select 1 from public.order_stock_allocations a
                    where a.order_item_id = v_line.id and a.quantity_dispatched > 0) then
      select oi.product_id into v_product from public.order_items oi where oi.id = v_line.id;
      -- Primary key = the order line: a second booking of the same line fails here.
      insert into public.order_item_legacy_stock_returns (order_item_id, order_id, product_id, units)
      values (v_line.id, p_order_id, v_product, v_got);
    end if;
    v_units := v_units + v_got;
  end loop;

  return jsonb_build_object('status', 'returned', 'order_id', p_order_id, 'units', v_units);
end;
$$;
revoke all on function public.return_order_stock(uuid, uuid) from public, anon, authenticated, service_role;
comment on function public.return_order_stock(uuid, uuid) is
  '0101: internal. Called only by return_delivery_to_warehouse_atomic and approve_return_request_atomic; no API role may execute it.';

-- ----------------------------------------------------------------------------
-- 5. Approve.
--    Returns { status:'approved', replayed, return_request_id, order_id,
--              order_number, retailer_id, order_item_id, units_restored,
--              refund_paise:0 }.
--    Raises 'RETURN_APPROVE:<CODE>: text'. In every refusal nothing is written.
--    A second call for a request that is already approved is a replay: it
--    returns the first result and writes nothing.
-- ----------------------------------------------------------------------------
create or replace function public.approve_return_request_atomic(
  p_return_request_id uuid,
  p_actor_id uuid,
  p_note text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_order_id uuid;
  v_order public.orders%rowtype;
  v_request public.return_requests%rowtype;
  v_event public.return_request_events%rowtype;
  v_previous_sub text := current_setting('request.jwt.claim.sub', true);
  v_line record;
  v_delivery_id uuid;
  v_result jsonb;
  v_units integer;
  v_total integer := 0;
  v_lines jsonb := '[]'::jsonb;
  v_now timestamptz := clock_timestamp();
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'RETURN_APPROVE:FORBIDDEN: this operation runs only on the server.' using errcode = '42501';
  end if;
  if p_return_request_id is null or p_actor_id is null then
    raise exception 'RETURN_APPROVE:INVALID_INPUT: request and actor are required.' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'RETURN_APPROVE:NOTE: the note must be 1000 characters or fewer.' using errcode = '22023';
  end if;
  v_role := public._fulfilment_actor_role(p_actor_id, array['super_admin', 'admin'], 'RETURN_APPROVE');

  -- ---- Locks: order first, then the request --------------------------------
  select r.order_id into v_order_id from public.return_requests r where r.id = p_return_request_id;
  if v_order_id is null then
    raise exception 'RETURN_APPROVE:NOT_FOUND: return request not found.' using errcode = 'P0002';
  end if;
  select * into v_order from public.orders o where o.id = v_order_id for update;
  if not found then
    raise exception 'RETURN_APPROVE:NOT_FOUND: order not found.' using errcode = 'P0002';
  end if;
  select * into v_request from public.return_requests r where r.id = p_return_request_id for update;
  if not found or v_request.order_id <> v_order.id then
    raise exception 'RETURN_APPROVE:NOT_FOUND: return request not found.' using errcode = 'P0002';
  end if;

  -- ---- Replay / state -------------------------------------------------------
  if v_request.status::text = 'approved' then
    select * into v_event from public.return_request_events e where e.return_request_id = v_request.id;
    return jsonb_build_object(
      'status', 'approved', 'replayed', true, 'return_request_id', v_request.id,
      'order_id', v_order.id, 'order_number', v_order.order_number, 'retailer_id', v_request.retailer_id,
      'order_item_id', v_request.order_item_id,
      'units_restored', coalesce(v_event.units_restored, 0), 'refund_paise', 0
    );
  end if;
  if v_request.status::text <> 'requested' then
    raise exception 'RETURN_APPROVE:ALREADY_RESOLVED:%', v_request.status::text using errcode = '22023';
  end if;
  if v_request.retailer_id <> v_order.retailer_id then
    raise exception 'RETURN_APPROVE:INVALID_REQUEST: the request does not belong to the retailer of this order.' using errcode = '22023';
  end if;
  if v_order.status::text <> 'delivered' then
    -- "returned" = the whole order already went back through return-to-warehouse.
    raise exception 'RETURN_APPROVE:ORDER_STATE:%', v_order.status::text using errcode = '22023';
  end if;
  if v_request.order_item_id is not null and not exists (
    select 1 from public.order_items oi where oi.id = v_request.order_item_id and oi.order_id = v_order.id
  ) then
    raise exception 'RETURN_APPROVE:INVALID_ITEM: the requested item is not part of this order.' using errcode = '22023';
  end if;

  -- ---- Lock the lines in scope, then validate --------------------------------
  perform 1 from public.order_items oi
    where oi.order_id = v_order.id
      and (v_request.order_item_id is null or oi.id = v_request.order_item_id)
    order by oi.id for update;

  select d.id into v_delivery_id from public.order_deliveries d where d.order_id = v_order.id;

  -- A shortfall (missing / damaged pieces) was already settled in Coins at
  -- delivery. Returning such a line needs a reconciliation rule that the owner
  -- has not defined; refuse instead of guessing.
  if v_delivery_id is not null then
    if exists (
      select 1 from public.order_delivery_items di
       where di.delivery_id = v_delivery_id
         and (v_request.order_item_id is null or di.order_item_id = v_request.order_item_id)
         and di.quantity_delivered < di.quantity_ordered
    ) or (
      v_request.order_item_id is null and exists (
        select 1 from public.retailer_wallet_ledger l
         where l.retailer_id = v_order.retailer_id
           and l.transaction_type = 'REFUND_CREDIT'
           and l.reference_type = 'delivery'
           and l.reference_id = v_delivery_id)
    ) then
      raise exception 'RETURN_APPROVE:RECONCILE: this return covers goods that were short or damaged at delivery and already settled in Coins; an Admin must reconcile it by hand.'
        using errcode = '22023';
    end if;
  end if;

  for v_line in select * from public._return_request_restorable_lines(v_order.id, v_request.order_item_id) loop
    if v_line.units = 0 and v_line.seller_fulfilled then
      raise exception 'RETURN_APPROVE:SELLER_RETURN: a seller-fulfilled line can be returned only after the goods are recorded as received back; that step is not available.'
        using errcode = '22023';
    end if;
    if v_line.units > 0 and v_delivery_id is not null and exists (
      select 1 from public.order_delivery_items di
       where di.delivery_id = v_delivery_id and di.order_item_id = v_line.order_item_id
         and v_line.units > di.quantity_delivered
    ) then
      raise exception 'RETURN_APPROVE:QUANTITY: more would be restored than was delivered for a line of this order.' using errcode = '22023';
    end if;
    v_total := v_total + v_line.units;
  end loop;
  if v_total = 0 then
    raise exception 'RETURN_APPROVE:ALREADY_RESTORED: the stock for this return is already back in inventory.' using errcode = '22023';
  end if;

  -- ---- Writes ----------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', p_actor_id::text, true);
  v_total := 0;
  for v_line in select * from public._return_request_restorable_lines(v_order.id, v_request.order_item_id) loop
    continue when v_line.units = 0;
    v_result := public.return_order_stock(v_order.id, v_line.order_item_id);
    v_units := coalesce((v_result ->> 'units')::integer, 0);
    if v_units <> v_line.units then
      raise exception 'RETURN_APPROVE:STOCK_MISMATCH: expected to restore % units for a line, the stock function restored %.', v_line.units, v_units
        using errcode = 'P0001';
    end if;
    v_total := v_total + v_units;
    v_lines := v_lines || jsonb_build_object('order_item_id', v_line.order_item_id, 'units', v_units);
  end loop;

  update public.return_requests
     set status = 'approved', resolved_by = p_actor_id, resolved_at = v_now, resolution_note = v_note
   where id = v_request.id;

  insert into public.return_request_events
    (return_request_id, order_id, order_item_id, retailer_id, action, from_status, to_status,
     actor_id, actor_role, note, units_restored, lines, refund_paise, created_at)
  values
    (v_request.id, v_order.id, v_request.order_item_id, v_request.retailer_id, 'approved', 'requested', 'approved',
     p_actor_id, v_role, v_note, v_total, v_lines, 0, v_now);

  perform set_config('request.jwt.claim.sub', coalesce(v_previous_sub, ''), true);
  return jsonb_build_object(
    'status', 'approved', 'replayed', false, 'return_request_id', v_request.id,
    'order_id', v_order.id, 'order_number', v_order.order_number, 'retailer_id', v_request.retailer_id,
    'order_item_id', v_request.order_item_id, 'units_restored', v_total, 'refund_paise', 0
  );
end;
$$;
revoke all on function public.approve_return_request_atomic(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.approve_return_request_atomic(uuid, uuid, text) to service_role;
comment on function public.approve_return_request_atomic(uuid, uuid, text) is
  '0101: stock restored once, request approved and history written in one transaction. Moves no Coins. service_role only.';

-- ----------------------------------------------------------------------------
-- 6. Reject. Never touches stock or money.
--    Returns { status:'rejected', replayed, return_request_id, order_id,
--              order_number, retailer_id }.  Raises 'RETURN_REJECT:<CODE>: text'.
-- ----------------------------------------------------------------------------
create or replace function public.reject_return_request_atomic(
  p_return_request_id uuid,
  p_actor_id uuid,
  p_note text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_order_id uuid;
  v_order public.orders%rowtype;
  v_request public.return_requests%rowtype;
  v_previous_sub text := current_setting('request.jwt.claim.sub', true);
  v_now timestamptz := clock_timestamp();
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'RETURN_REJECT:FORBIDDEN: this operation runs only on the server.' using errcode = '42501';
  end if;
  if p_return_request_id is null or p_actor_id is null then
    raise exception 'RETURN_REJECT:INVALID_INPUT: request and actor are required.' using errcode = '22023';
  end if;
  if v_note is null or char_length(v_note) < 3 or char_length(v_note) > 1000 then
    raise exception 'RETURN_REJECT:NOTE: a reason of 3 to 1000 characters is required.' using errcode = '22023';
  end if;
  v_role := public._fulfilment_actor_role(p_actor_id, array['super_admin', 'admin'], 'RETURN_REJECT');

  select r.order_id into v_order_id from public.return_requests r where r.id = p_return_request_id;
  if v_order_id is null then
    raise exception 'RETURN_REJECT:NOT_FOUND: return request not found.' using errcode = 'P0002';
  end if;
  select * into v_order from public.orders o where o.id = v_order_id for update;
  if not found then
    raise exception 'RETURN_REJECT:NOT_FOUND: order not found.' using errcode = 'P0002';
  end if;
  select * into v_request from public.return_requests r where r.id = p_return_request_id for update;
  if not found or v_request.order_id <> v_order.id then
    raise exception 'RETURN_REJECT:NOT_FOUND: return request not found.' using errcode = 'P0002';
  end if;

  if v_request.status::text = 'rejected' then
    return jsonb_build_object(
      'status', 'rejected', 'replayed', true, 'return_request_id', v_request.id,
      'order_id', v_order.id, 'order_number', v_order.order_number, 'retailer_id', v_request.retailer_id
    );
  end if;
  if v_request.status::text <> 'requested' then
    raise exception 'RETURN_REJECT:ALREADY_RESOLVED:%', v_request.status::text using errcode = '22023';
  end if;

  -- The audit trigger on return_requests records auth.uid() as the author.
  perform set_config('request.jwt.claim.sub', p_actor_id::text, true);
  update public.return_requests
     set status = 'rejected', resolved_by = p_actor_id, resolved_at = v_now, resolution_note = v_note
   where id = v_request.id;

  insert into public.return_request_events
    (return_request_id, order_id, order_item_id, retailer_id, action, from_status, to_status,
     actor_id, actor_role, note, units_restored, lines, refund_paise, created_at)
  values
    (v_request.id, v_order.id, v_request.order_item_id, v_request.retailer_id, 'rejected', 'requested', 'rejected',
     p_actor_id, v_role, v_note, 0, '[]'::jsonb, 0, v_now);
  perform set_config('request.jwt.claim.sub', coalesce(v_previous_sub, ''), true);

  return jsonb_build_object(
    'status', 'rejected', 'replayed', false, 'return_request_id', v_request.id,
    'order_id', v_order.id, 'order_number', v_order.order_number, 'retailer_id', v_request.retailer_id
  );
end;
$$;
revoke all on function public.reject_return_request_atomic(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.reject_return_request_atomic(uuid, uuid, text) to service_role;
comment on function public.reject_return_request_atomic(uuid, uuid, text) is
  '0101: request rejected and history written in one transaction. Never touches stock or Coins. service_role only.';

-- ============================================================================
-- END OF MIGRATION 0101
-- ============================================================================
