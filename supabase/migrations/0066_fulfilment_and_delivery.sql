-- ============================================================================
-- 0066: Seller Marketplace — fulfilment: seller shipments, delivery link,
--       child↔parent status aggregation, child-scoped stock restores.
--
-- WHAT THIS ADDS
--   * `seller_shipments` — one fulfilment record per seller sub-order
--     (UNIQUE(sub_order_id)). The Maharani child keeps using the existing
--     single `order_deliveries` row per order (UNIQUE(order_id) from 0043 is
--     deliberately NOT relaxed — the prompt's constraint).
--   * `order_deliveries.sub_order_id` — nullable LINK-ONLY column pointing a
--     delivery record at the sub-order it delivers. No behaviour change for
--     legacy rows (NULL).
--   * `set_sub_order_status(p_sub_order_id, p_status, p_reason)` — admin/
--     service child transition with the child machine (0064) as the gate,
--     plus the admin-review closure for stuck 'failed' children (failed →
--     shipped | cancelled | returned, with reason). Never fabricates a
--     parent 'delivered': a cancelled child cannot produce a delivered parent
--     (F-3 rule: parent 'delivered' only when all children are resolved AND
--     at least one is delivered).
--   * `apply_parent_order_status(p_parent_order_id)` — derives the only
--     parent statuses the terminal rules allow and walks the parent along
--     EXISTING 0042 edges (pending→confirmed→processing→packed→dispatched→
--     delivered, early-state →cancelled, dispatched/delivered→returned). No
--     new parent transitions. Rules:
--       · cancelled iff ALL children cancelled AND parent ≤ packed;
--       · returned iff parent ≥ dispatched AND no delivered goods remain;
--       · delivered iff all children resolved AND ≥1 delivered.
--   * `restore_sub_order_stock(p_sub_order_id)` — child-scoped stock restore
--     bound by restorable = deducted − shipped + returned_received − restored
--     (pre-fulfilment cancel restores everything unshipped; in-transit units
--     are never restored; returned units restore only after physical receipt
--     is recorded on the line). Seller lines return stock to
--     `seller_offers.stock_quantity`; pack-stock lines to `product_packs`.
--     Legacy `restore_simple_order_stock` (0054) is NOT touched.
--
-- SAFETY: additive. NOT executed against any database.
-- ============================================================================

create table if not exists public.seller_shipments (
  id uuid primary key default uuid_generate_v4(),
  sub_order_id uuid not null unique references public.sub_orders(id) on delete cascade,
  seller_id uuid not null references public.sellers(id) on delete restrict,
  status text not null default 'pending'
    check (status in ('pending', 'packed', 'shipped', 'delivered', 'cancelled', 'returned', 'failed')),
  shipment_number text check (shipment_number is null or char_length(btrim(shipment_number)) <= 64),
  courier text check (courier is null or char_length(btrim(courier)) <= 120),
  awb text check (awb is null or char_length(btrim(awb)) <= 64),
  packed_at timestamptz,
  dispatched_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  failure_reason text check (failure_reason is null or char_length(btrim(failure_reason)) between 3 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_seller_shipments_seller on public.seller_shipments (seller_id, status);

drop trigger if exists trg_audit_seller_shipments on public.seller_shipments;
create trigger trg_audit_seller_shipments
  after insert or update or delete on public.seller_shipments
  for each row execute function log_audit();

-- Link-only: the one-delivery-per-order model (0043 UNIQUE(order_id)) stays.
alter table public.order_deliveries
  add column if not exists sub_order_id uuid references public.sub_orders(id) on delete set null;

comment on column public.order_deliveries.sub_order_id is
  'Link-only reference to the sub-order this delivery fulfils (NULL for legacy/parent-level deliveries). UNIQUE(order_id) from 0043 is intentionally unchanged.';

-- ---------------------------------------------------------------------------
-- Child-scoped stock restore (never touches in-transit or already-restored
-- units; never double-restores).
-- ---------------------------------------------------------------------------
create or replace function public.restore_sub_order_stock(p_sub_order_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sub public.sub_orders%rowtype;
  v_item record;
  v_restore integer;
  v_restored_total integer := 0;
begin
  if auth.role() is distinct from 'service_role'
     and (auth.uid() is null or not public.is_admin_or_above()) then
    raise exception 'Stock restores are server/admin only.' using errcode = '42501';
  end if;
  if p_sub_order_id is null then
    raise exception 'A sub-order is required.' using errcode = '22023';
  end if;

  select * into v_sub
    from public.sub_orders
   where id = p_sub_order_id
   for update;
  if not found then
    raise exception 'Sub-order not found.' using errcode = 'P0002';
  end if;
  if v_sub.status not in ('cancelled', 'returned') then
    raise exception 'Stock can only be restored for a cancelled or returned sub-order.' using errcode = 'check_violation';
  end if;

  for v_item in
    select oi.*
      from public.order_items oi
     where oi.sub_order_id = p_sub_order_id
       and oi.stock_deducted_quantity - oi.shipped_quantity + oi.returned_received_quantity
           > oi.stock_restored_quantity
     order by oi.id
     for update of oi
  loop
    v_restore := v_item.stock_deducted_quantity
               - v_item.shipped_quantity
               + v_item.returned_received_quantity
               - v_item.stock_restored_quantity;
    if v_restore <= 0 then
      continue;
    end if;

    if v_item.fulfilment_type = 'seller' then
      update public.seller_offers so
         set stock_quantity = so.stock_quantity + v_restore,
             updated_at = now()
       where so.id = v_item.seller_offer_id
         and so.stock_quantity <= 2000000000 - v_restore;
      if not found then
        raise exception 'Seller offer not found while restoring sub-order stock.' using errcode = 'P0002';
      end if;
    else
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
        raise exception 'Pack not found while restoring sub-order stock.' using errcode = 'P0002';
      end if;
    end if;

    update public.order_items
       set stock_restored_quantity = stock_restored_quantity + v_restore
     where id = v_item.id;
    v_restored_total := v_restored_total + v_restore;
  end loop;

  return v_restored_total;
end;
$$;
revoke all on function public.restore_sub_order_stock(uuid) from public, anon, authenticated;
grant execute on function public.restore_sub_order_stock(uuid) to service_role;

comment on function public.restore_sub_order_stock(uuid) is
  'Child-scoped, retry-safe stock restore. Restores only restorable = deducted − shipped + returned_received − restored, to seller offers or packs per line fulfilment. Legacy restore_simple_order_stock is untouched.';

-- ---------------------------------------------------------------------------
-- Child transitions with admin-review closure + parent aggregation.
-- ---------------------------------------------------------------------------
create or replace function public.apply_parent_order_status(p_parent_order_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_total integer;
  v_cancelled integer;
  v_delivered integer;
  v_returned integer;
  v_resolved integer;
  v_target text;
  v_next text;
begin
  select * into v_order from public.orders where id = p_parent_order_id for update;
  if not found then
    raise exception 'Parent order not found.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.sub_orders where parent_order_id = p_parent_order_id) then
    return v_order.status::text; -- legacy order: aggregation does not apply
  end if;

  select count(*),
         count(*) filter (where so.status = 'cancelled'),
         count(*) filter (where so.status = 'delivered'),
         count(*) filter (where so.status = 'returned'),
         count(*) filter (where so.status in ('delivered', 'cancelled', 'returned'))
    into v_total, v_cancelled, v_delivered, v_returned, v_resolved
    from public.sub_orders so
   where so.parent_order_id = p_parent_order_id;

  v_target := null;
  if v_cancelled = v_total and v_order.status::text in ('pending', 'confirmed', 'processing', 'packed') then
    v_target := 'cancelled';
  elsif v_resolved = v_total and v_delivered >= 1 then
    v_target := 'delivered';
  elsif v_order.status::text in ('dispatched', 'delivered')
        and v_delivered = 0
        and v_resolved = v_total then
    v_target := 'returned';
  end if;

  if v_target is null or v_target = v_order.status::text then
    return v_order.status::text;
  end if;

  -- Walk only along existing 0042 edges. Each step is one legal transition.
  while v_order.status::text <> v_target loop
    case v_order.status::text
      when 'pending'    then v_next := case when v_target = 'cancelled' then 'cancelled' else 'confirmed' end;
      when 'confirmed'  then v_next := case when v_target = 'cancelled' then 'cancelled' else 'processing' end;
      when 'processing' then v_next := case when v_target = 'cancelled' then 'cancelled'
                                            when v_target = 'delivered' then 'packed' else 'packed' end;
      when 'packed'     then v_next := case when v_target = 'cancelled' then 'cancelled' else 'dispatched' end;
      when 'dispatched' then v_next := case when v_target = 'returned' then 'returned' else 'delivered' end;
      when 'delivered'  then v_next := case when v_target = 'returned' then 'returned' else v_target end;
      else raise exception 'INVALID_ORDER_TRANSITION: parent % cannot move toward %.', v_order.status, v_target
             using errcode = 'check_violation';
    end case;

    if v_next = v_order.status::text then
      raise exception 'INVALID_ORDER_TRANSITION: parent stuck at % for target %.', v_order.status, v_target
        using errcode = 'check_violation';
    end if;

    update public.orders
       set status = v_next::public.order_status
     where id = p_parent_order_id
    returning * into v_order;
  end loop;

  return v_order.status::text;
end;
$$;
revoke all on function public.apply_parent_order_status(uuid) from public, anon, authenticated;
grant execute on function public.apply_parent_order_status(uuid) to service_role;

comment on function public.apply_parent_order_status(uuid) is
  'Derives the terminal parent status allowed by the F-3 rules (cancelled iff all children cancelled and parent ≤ packed; delivered iff all resolved and ≥1 delivered; returned iff parent ≥ dispatched and nothing delivered) and walks it along existing 0042 edges only.';

create or replace function public.set_sub_order_status(
  p_sub_order_id uuid,
  p_status text,
  p_reason text default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sub public.sub_orders%rowtype;
  v_parent_id uuid;
begin
  if auth.role() is distinct from 'service_role'
     and (auth.uid() is null or not public.is_admin_or_above()) then
    raise exception 'Sub-order transitions are admin/server only.' using errcode = '42501';
  end if;
  if p_status is null or p_status not in
       ('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned', 'failed') then
    raise exception 'Unknown sub-order status.' using errcode = '22023';
  end if;

  select * into v_sub from public.sub_orders where id = p_sub_order_id for update;
  if not found then
    raise exception 'Sub-order not found.' using errcode = 'P0002';
  end if;

  -- Admin-review closure: moving OUT of 'failed' requires an explicit reason.
  if v_sub.status = 'failed' and p_status <> 'failed'
     and (p_reason is null or char_length(btrim(p_reason)) < 3) then
    raise exception 'Closing a failed sub-order needs a reason of at least 3 characters.' using errcode = '22023';
  end if;

  -- The 0064 trigger enforces the child edge set; this write goes through it.
  update public.sub_orders
     set status = p_status::text,
         needs_admin_review = case
           when p_status = 'failed' then true
           when p_status in ('shipped', 'cancelled', 'returned') then false
           else needs_admin_review
         end
   where id = p_sub_order_id;

  -- Mirror the fulfilment record when one exists (never fabricated here).
  update public.seller_shipments
     set status = case
           when p_status in ('pending', 'confirmed', 'processing') then 'pending'
           when p_status = 'shipped' then 'shipped'
           when p_status = 'delivered' then 'delivered'
           when p_status = 'cancelled' then 'cancelled'
           when p_status = 'returned' then 'returned'
           when p_status = 'failed' then 'failed'
           else status
         end,
         dispatched_at = case when p_status = 'shipped' then coalesce(dispatched_at, now()) else dispatched_at end,
         delivered_at = case when p_status = 'delivered' then coalesce(delivered_at, now()) else delivered_at end,
         cancelled_at = case when p_status = 'cancelled' then coalesce(cancelled_at, now()) else cancelled_at end,
         failure_reason = case when p_status = 'failed' then nullif(btrim(coalesce(p_reason, '')), '') else failure_reason end,
         updated_at = now()
   where sub_order_id = p_sub_order_id;

  v_parent_id := v_sub.parent_order_id;
  perform public.apply_parent_order_status(v_parent_id);
  return p_status;
end;
$$;
revoke all on function public.set_sub_order_status(uuid, text, text) from public, anon, authenticated;
grant execute on function public.set_sub_order_status(uuid, text, text) to service_role;

comment on function public.set_sub_order_status(uuid, text, text) is
  'Admin/server child transition through the 0064 child machine, with reason-required admin-review closure for failed children, seller_shipments mirroring, and F-3 parent aggregation.';

-- ---------------------------------------------------------------------------
-- Fulfilment counters are database-owned (mirrors the 0054 counter guard).
-- ---------------------------------------------------------------------------
create or replace function public.guard_order_item_fulfilment_counters()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.shipped_quantity is distinct from old.shipped_quantity
     or new.accepted_quantity is distinct from old.accepted_quantity
     or new.missing_damaged_quantity is distinct from old.missing_damaged_quantity
     or new.returned_received_quantity is distinct from old.returned_received_quantity then
    if current_user in ('authenticated', 'anon') then
      raise exception 'Fulfilment counters are maintained by the database only.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_order_item_fulfilment_counters on public.order_items;
create trigger trg_guard_order_item_fulfilment_counters
  before update of shipped_quantity, accepted_quantity, missing_damaged_quantity, returned_received_quantity
  on public.order_items
  for each row execute function public.guard_order_item_fulfilment_counters();

-- ---------------------------------------------------------------------------
-- RLS + grants.
-- ---------------------------------------------------------------------------
alter table public.seller_shipments enable row level security;

revoke all on public.seller_shipments from anon, authenticated;
grant select on public.seller_shipments to authenticated;

drop policy if exists "seller_shipments_select" on public.seller_shipments;
create policy "seller_shipments_select" on public.seller_shipments
  for select using (
    is_admin_or_above()
    or public.is_member_of_seller(seller_id)
  );

-- Writes go through server functions (service role); no client write policies.

comment on table public.seller_shipments is
  'One fulfilment record per seller sub-order (UNIQUE(sub_order_id)). Maharani children keep the existing one-delivery-per-order model.';

-- ============================================================================
-- END OF MIGRATION.
-- ============================================================================
