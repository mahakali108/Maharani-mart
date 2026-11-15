-- ============================================================================
-- 0096: delivery line snapshot integrity.
--
-- REVIEW ONLY. NOT APPLIED TO PRODUCTION. Apply after 0094.
-- See docs/readiness-2026-11-14/04_MIGRATIONS.md.
--
-- Finding closed (independent review of PR #126):
--   SEC-16 (High)  0094 locked order_delivery_items only AFTER completion.
--           While a delivery was assigned / in progress, the assigned delivery
--           person could, through the Data API:
--             * raise or lower quantity_ordered (the denominator of the
--               shortfall refund and of the loyalty calculation);
--             * re-point order_item_id at a line of ANOTHER order, so the
--               refund was valued on someone else's goods;
--             * move a line to another delivery (delivery_id);
--             * delete lines, or insert extra ones.
--           delivery_shortfall_paise() (0094) trusted all of those columns.
--
-- What this migration guarantees, for EVERY caller including service role:
--   1. A delivery line always belongs to the order (and sub-order) of its
--      delivery.
--   2. quantity_ordered always equals the ORIGINAL ordered quantity on the
--      order line, and never changes.
--   3. delivery_id, order_item_id, quantity_ordered, id and created_at are
--      immutable. Correcting a snapshot means delete + re-insert by a trusted
--      path (re-dispatch), which re-runs rules 1 and 2.
-- And for delivery staff (non-admin Data API sessions):
--   4. Only quantity_delivered / quantity_missing / quantity_damaged can be
--      written, only by the assigned person, only while the delivery is
--      assigned or in progress.
--   5. Lines cannot be deleted. Inserted lines must start at 0 / 0 / 0.
-- At completion (every caller):
--   6. A delivery can be completed only when it has exactly one fully
--      accounted line per order line, and the status matches the quantities
--      ("delivered" = no shortfall, "partially_delivered" = some shortfall).
-- Money:
--   7. delivery_shortfall_paise() values the shortfall from order_items (the
--      immutable original quantity and line total), never from the snapshot's
--      own quantity_ordered. order_shortfall_coins() and the loyalty trigger
--      (0094) call this function, so both inherit the fix.
--
-- Depends on: 0043 (order_delivery_items), 0066 (order_deliveries.sub_order_id,
-- order_items.sub_order_id), 0094 (is_untrusted_api_caller,
-- delivery_shortfall_paise). No data is changed.
-- ============================================================================

-- SECURITY INVOKER on purpose: is_untrusted_api_caller() must see the real
-- caller role. An API caller who cannot read the delivery or the order line
-- through RLS gets "not found" below and is refused (fail closed).
create or replace function public.guard_order_delivery_item_snapshot()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_untrusted boolean := public.is_untrusted_api_caller();
  v_delivery_order uuid;
  v_delivery_sub_order uuid;
  v_delivery_status text;
  v_assignee uuid;
  v_line_order uuid;
  v_line_sub_order uuid;
  v_original_quantity integer;
begin
  if tg_op = 'DELETE' then
    if v_untrusted then
      raise exception 'DELIVERY_GUARD: delivery lines cannot be removed.' using errcode = '42501';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
       or new.delivery_id is distinct from old.delivery_id
       or new.order_item_id is distinct from old.order_item_id
       or new.quantity_ordered is distinct from old.quantity_ordered
       or new.created_at is distinct from old.created_at then
      raise exception 'DELIVERY_GUARD: the delivery line snapshot (delivery, order line, ordered quantity) is immutable.'
        using errcode = '42501';
    end if;
  end if;

  -- Lock order (corrected 15 Nov 2026, before this migration was ever applied).
  -- Every delivery write path locks  order_deliveries  BEFORE
  -- order_delivery_items  (see 0099 / 0100). A direct line write cannot do
  -- that: on UPDATE PostgreSQL has already locked the line row before this
  -- trigger runs, and on INSERT the same transaction may hold other line
  -- locks. WAITING for the delivery row here would therefore be a
  -- child -> parent wait, the inverse of the canonical order, and could
  -- deadlock against a completion that holds the delivery and wants the lines.
  --
  -- So the share lock is taken with NOWAIT. If a completion, dispatch, failure
  -- or return currently holds the delivery row, this write is refused at once
  -- with a retryable error and nothing changes. A session that holds a line
  -- lock never waits for the delivery row, so no lock cycle can form.
  --
  -- A line write that does get the share lock makes a later completion wait at
  -- the delivery row (while it holds no line lock) and then re-check the
  -- committed quantities. The atomic functions hold FOR UPDATE on the delivery
  -- themselves, so their own line writes pass straight through.
  begin
    select od.order_id, od.sub_order_id, od.delivery_status::text, od.assigned_staff_id
      into v_delivery_order, v_delivery_sub_order, v_delivery_status, v_assignee
      from public.order_deliveries od
     where od.id = new.delivery_id
       for share of od nowait;
  exception when lock_not_available then
    raise exception 'DELIVERY_GUARD:BUSY: this delivery is being completed or updated by another request. Nothing was changed; refresh and try again.'
      using errcode = '55P03';
  end;
  if not found then
    raise exception 'DELIVERY_GUARD: delivery not found for this line.' using errcode = '42501';
  end if;

  select oi.order_id, oi.sub_order_id, coalesce(oi.quantity_pieces, oi.quantity)
    into v_line_order, v_line_sub_order, v_original_quantity
    from public.order_items oi
   where oi.id = new.order_item_id;
  if not found then
    raise exception 'DELIVERY_GUARD: order line not found for this delivery line.' using errcode = '42501';
  end if;

  if v_line_order is distinct from v_delivery_order then
    raise exception 'DELIVERY_GUARD: the order line does not belong to this delivery''s order.' using errcode = '42501';
  end if;
  if v_delivery_sub_order is not null and v_line_sub_order is distinct from v_delivery_sub_order then
    raise exception 'DELIVERY_GUARD: the order line does not belong to this delivery''s sub-order.' using errcode = '42501';
  end if;
  if new.quantity_ordered is distinct from v_original_quantity then
    raise exception 'DELIVERY_GUARD: quantity_ordered must equal the original ordered quantity (%).', v_original_quantity
      using errcode = '42501';
  end if;

  if new.quantity_delivered < 0 or new.quantity_missing < 0 or new.quantity_damaged < 0
     or new.quantity_delivered + new.quantity_missing + new.quantity_damaged > new.quantity_ordered then
    raise exception 'DELIVERY_GUARD: delivered + missing + damaged cannot exceed the ordered quantity.' using errcode = '23514';
  end if;

  if v_untrusted then
    if v_delivery_status not in ('assigned', 'in_progress') then
      raise exception 'DELIVERY_GUARD: delivered quantities are locked after completion.' using errcode = '42501';
    end if;
    if tg_op = 'INSERT'
       and (new.quantity_delivered <> 0 or new.quantity_missing <> 0 or new.quantity_damaged <> 0) then
      raise exception 'DELIVERY_GUARD: a new delivery line starts with no quantities recorded.' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and v_assignee is distinct from auth.uid() then
      raise exception 'DELIVERY_GUARD: only the assigned delivery person can record quantities.' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;
revoke all on function public.guard_order_delivery_item_snapshot() from public, anon, authenticated;

-- Supersedes the narrower 0094 trigger (kept in 0094 unchanged for history).
drop trigger if exists trg_guard_order_delivery_items_after_completion on public.order_delivery_items;
drop trigger if exists trg_guard_order_delivery_item_snapshot on public.order_delivery_items;
create trigger trg_guard_order_delivery_item_snapshot
  before insert or update or delete on public.order_delivery_items
  for each row execute function public.guard_order_delivery_item_snapshot();

-- ----------------------------------------------------------------------------
-- Completion requires a complete, consistent set of lines. SECURITY DEFINER so
-- the check counts every line regardless of the caller's RLS view.
-- ----------------------------------------------------------------------------
create or replace function public.guard_order_delivery_completion_lines()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_expected integer;
  v_recorded integer;
  v_incomplete integer;
  v_shortfall bigint;
begin
  if new.delivery_status::text not in ('delivered', 'partially_delivered')
     or new.delivery_status is not distinct from old.delivery_status then
    return new;
  end if;

  select count(*) into v_expected
    from public.order_items oi
   where oi.order_id = new.order_id
     and (new.sub_order_id is null or oi.sub_order_id = new.sub_order_id);

  select count(*),
         count(*) filter (where di.quantity_delivered + di.quantity_missing + di.quantity_damaged
                                 <> coalesce(oi.quantity_pieces, oi.quantity)),
         coalesce(sum(di.quantity_missing + di.quantity_damaged), 0)
    into v_recorded, v_incomplete, v_shortfall
    from public.order_delivery_items di
    join public.order_items oi on oi.id = di.order_item_id and oi.order_id = new.order_id
   where di.delivery_id = new.id;

  if v_recorded = 0 or v_recorded <> v_expected then
    raise exception 'DELIVERY_GUARD: a delivery needs exactly one line per order line before it can be completed (% of %).',
      v_recorded, v_expected using errcode = '23514';
  end if;
  if v_incomplete > 0 then
    raise exception 'DELIVERY_GUARD: every line must account for its full ordered quantity before completion.'
      using errcode = '23514';
  end if;
  if new.delivery_status::text = 'delivered' and v_shortfall > 0 then
    raise exception 'DELIVERY_GUARD: a delivery with missing or damaged goods must be recorded as partially delivered.'
      using errcode = '23514';
  end if;
  if new.delivery_status::text = 'partially_delivered' and v_shortfall = 0 then
    raise exception 'DELIVERY_GUARD: a delivery with no missing or damaged goods must be recorded as delivered.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_order_delivery_completion_lines() from public, anon, authenticated;

drop trigger if exists trg_guard_order_delivery_completion_lines on public.order_deliveries;
create trigger trg_guard_order_delivery_completion_lines
  before update of delivery_status on public.order_deliveries
  for each row execute function public.guard_order_delivery_completion_lines();

-- ----------------------------------------------------------------------------
-- Shortfall value from the immutable order line. Same signature and grants as
-- 0094; only the source of the ordered quantity and the order check change.
-- ----------------------------------------------------------------------------
create or replace function public.delivery_shortfall_paise(p_delivery_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(
    least(
      round(oi.line_total * 100)::bigint,
      floor(
        (round(oi.line_total * 100)
          * least(di.quantity_missing + di.quantity_damaged, coalesce(oi.quantity_pieces, oi.quantity)))::numeric
        / coalesce(oi.quantity_pieces, oi.quantity) + 0.5
      )::bigint
    )
  ), 0)::bigint
  from public.order_deliveries od
  join public.order_delivery_items di on di.delivery_id = od.id
  join public.order_items oi on oi.id = di.order_item_id and oi.order_id = od.order_id
  where od.id = p_delivery_id
    and coalesce(oi.quantity_pieces, oi.quantity) > 0
    and (di.quantity_missing + di.quantity_damaged) > 0
    and oi.line_total > 0
$$;
revoke all on function public.delivery_shortfall_paise(uuid) from public, anon, authenticated;
grant execute on function public.delivery_shortfall_paise(uuid) to service_role;
