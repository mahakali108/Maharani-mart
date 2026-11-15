-- ============================================================================
-- 0100 — Atomic dispatch, failed delivery and return to warehouse
--
-- REVIEW-ONLY. Do not apply to production without the owner's approval.
-- Requires 0094, 0096 and 0099. Rollback: supabase/rollbacks/0100_….down.sql
--
-- Before this migration three server actions changed several tables with
-- separate requests, so a failure in the middle left a half-finished state:
--
--   dispatch            stock consumed -> order "dispatched" -> delivery task
--                       -> line snapshot.   (failure => dispatched order with
--                       no delivery task, or a task with no lines)
--   failed delivery     delivery "failed" -> order back to "processing".
--                       (failure => failed task on a still-dispatched order)
--   return to warehouse stock returned -> delivery "returned_to_warehouse"
--                       -> order "returned" -> wallet refund -> shortfall
--                       reversal.           (failure => returned order whose
--                       Coins were never refunded)
--
-- Each is now ONE database transaction. Either every row changes or none.
--
-- Lock order (same as 0096 / 0099, parent first):
--   orders -> order_deliveries -> order_delivery_items
--          -> retailer_credit_accounts / wallet ledger -> retailers (loyalty)
--
-- Execution: service_role only. Each function re-checks auth.role() and does
-- NOT trust the caller about who is acting: p_actor_id must be an active
-- profile whose role holds the permission, inside the same warehouse / area
-- scope that row-level security applies to the orders table.
--
-- Section 1 also closes the direct route: an API role can no longer set an
-- order to "dispatched" or "returned", or re-open a dispatched order, with a
-- plain UPDATE that skips stock, the delivery task and the refund.
--
-- Idempotent: safe to re-run. No table is dropped, no row is deleted by the
-- migration itself.
-- ============================================================================

do $$
begin
  if to_regprocedure('public.complete_delivery_atomic(uuid, uuid, text, text, text, text, text, text, jsonb)') is null
     or to_regprocedure('public.guard_order_delivery_item_snapshot()') is null
     or to_regprocedure('public.is_untrusted_api_caller()') is null then
    raise exception 'MIGRATION ORDER VIOLATION: 0100 requires 0094, 0096 and 0099.' using errcode = 'undefined_function';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 1. No fulfilment transition by direct UPDATE from an API role.
--
-- The atomic functions below are SECURITY DEFINER, so inside them current_user
-- is the owner and this guard lets them through. A browser session or the
-- service key writing orders.status directly is refused. Sub-order roll-ups
-- (0066 / 0097) also run as SECURITY DEFINER and are unaffected.
-- ----------------------------------------------------------------------------
create or replace function public.guard_direct_order_fulfilment_transition()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status is distinct from old.status
     and current_user in ('anon', 'authenticated', 'service_role') then
    if new.status::text = 'dispatched' then
      raise exception 'FULFILMENT_GUARD: orders are dispatched only through dispatch_order_atomic, which deducts stock and creates the delivery task in the same transaction.'
        using errcode = '42501';
    elsif new.status::text = 'returned' then
      raise exception 'FULFILMENT_GUARD: orders are returned only through return_delivery_to_warehouse_atomic, which returns stock and Coins in the same transaction.'
        using errcode = '42501';
    elsif old.status::text = 'dispatched' and new.status::text = 'processing' then
      raise exception 'FULFILMENT_GUARD: a dispatched order is re-opened only through fail_delivery_atomic.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_direct_order_fulfilment_transition() from public, anon, authenticated, service_role;

drop trigger if exists trg_guard_direct_order_fulfilment_transition on public.orders;
create trigger trg_guard_direct_order_fulfilment_transition
  before update of status on public.orders
  for each row execute function public.guard_direct_order_fulfilment_transition();

-- The same for the delivery task itself: "failed", the re-attempt reset
-- (failed -> assigned) and "returned_to_warehouse" each belong to one of the
-- atomic functions. (in_progress, and an Admin's deliberate "mark delivered"
-- of 0094, are untouched.)
create or replace function public.guard_direct_delivery_fulfilment_transition()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.delivery_status is distinct from old.delivery_status
     and current_user in ('anon', 'authenticated', 'service_role') then
    if new.delivery_status::text = 'failed' then
      raise exception 'FULFILMENT_GUARD: a delivery is marked failed only through fail_delivery_atomic, which re-opens the order in the same transaction.'
        using errcode = '42501';
    elsif new.delivery_status::text = 'returned_to_warehouse' then
      raise exception 'FULFILMENT_GUARD: a delivery is returned only through return_delivery_to_warehouse_atomic.'
        using errcode = '42501';
    elsif old.delivery_status::text = 'failed' then
      raise exception 'FULFILMENT_GUARD: a failed delivery is re-opened only through dispatch_order_atomic.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_direct_delivery_fulfilment_transition() from public, anon, authenticated, service_role;

drop trigger if exists trg_guard_direct_delivery_fulfilment_transition on public.order_deliveries;
create trigger trg_guard_direct_delivery_fulfilment_transition
  before update of delivery_status on public.order_deliveries
  for each row execute function public.guard_direct_delivery_fulfilment_transition();

-- Settled quantities are final for EVERY API role. 0094 froze them for
-- non-admin callers only; an Admin session or the service key could still
-- rewrite a line after the shortfall credit and the points had been computed
-- from it, leaving the ledger and the delivery record in disagreement (found
-- by the multi-session race test). A correction after completion needs its own
-- audited adjustment, not a silent line edit.
create or replace function public.guard_settled_delivery_lines()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  if current_user not in ('anon', 'authenticated', 'service_role') then
    return coalesce(new, old);
  end if;
  select d.delivery_status::text into v_status
    from public.order_deliveries d
   where d.id = coalesce(new.delivery_id, old.delivery_id);
  if v_status in ('delivered', 'partially_delivered', 'returned_to_warehouse') then
    raise exception 'DELIVERY_GUARD: delivered quantities are final once the delivery is completed.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function public.guard_settled_delivery_lines() from public, anon, authenticated, service_role;

drop trigger if exists trg_guard_settled_delivery_lines on public.order_delivery_items;
create trigger trg_guard_settled_delivery_lines
  before insert or update or delete on public.order_delivery_items
  for each row execute function public.guard_settled_delivery_lines();

-- ----------------------------------------------------------------------------
-- 2. Shared actor check. Private: no API role may call it.
--    Returns the actor's role, or raises '<prefix>:NO_PERMISSION'.
-- ----------------------------------------------------------------------------
create or replace function public._fulfilment_actor_role(
  p_actor_id uuid,
  p_allowed text[],
  p_prefix text
) returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_active boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception '%:FORBIDDEN: this operation runs only on the server.', p_prefix using errcode = '42501';
  end if;
  select p.role::text, coalesce(p.is_active, false) into v_role, v_active
    from public.profiles p where p.id = p_actor_id;
  if v_role is null or not v_active or not (v_role = any (p_allowed)) then
    raise exception '%:NO_PERMISSION: this account may not perform this operation.', p_prefix using errcode = '42501';
  end if;
  return v_role;
end;
$$;
revoke all on function public._fulfilment_actor_role(uuid, text[], text) from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. Dispatch.
--    Returns { status:'dispatched', order_id, order_number, retailer_id,
--              delivery_id, redispatch, product_ids }.
--    Raises 'DISPATCH:<CODE>: text'. A second call for an order that is
--    already dispatched raises DISPATCH:ALREADY_DISPATCHED and changes nothing
--    (stock is never deducted twice, the OTP is not replaced).
-- ----------------------------------------------------------------------------
create or replace function public.dispatch_order_atomic(
  p_order_id uuid,
  p_actor_id uuid,
  p_otp_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_order public.orders%rowtype;
  v_delivery public.order_deliveries%rowtype;
  v_has_delivery boolean := false;
  v_delivery_id uuid;
  v_now timestamptz := clock_timestamp();
  v_previous_sub text := current_setting('request.jwt.claim.sub', true);
  v_lines integer;
  v_products jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'DISPATCH:FORBIDDEN: dispatch runs only on the server.' using errcode = '42501';
  end if;
  if p_order_id is null or p_actor_id is null then
    raise exception 'DISPATCH:INVALID_INPUT: order and actor are required.' using errcode = '22023';
  end if;
  if p_otp_hash is null or p_otp_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'DISPATCH:INVALID_INPUT: the OTP digest is malformed.' using errcode = '22023';
  end if;
  v_role := public._fulfilment_actor_role(p_actor_id, array['super_admin', 'admin', 'staff'], 'DISPATCH');

  -- ---- Locks: order -> delivery -> lines ----------------------------------
  select * into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'DISPATCH:NOT_FOUND: order not found.' using errcode = 'P0002';
  end if;
  select * into v_delivery from public.order_deliveries d where d.order_id = p_order_id for update;
  v_has_delivery := found;
  if v_has_delivery then
    perform 1 from public.order_delivery_items di where di.delivery_id = v_delivery.id order by di.id for update;
  end if;

  -- Stock, scope and audit helpers read auth.uid(): act as the verified actor
  -- for the rest of this transaction only.
  perform set_config('request.jwt.claim.sub', p_actor_id::text, true);

  -- Same scope row-level security gives staff on the orders table (0037).
  if v_role = 'staff'
     and not (public.is_warehouse_assigned_to_current_staff(v_order.warehouse_id)
              or public.is_retailer_area_assigned_to_current_staff(v_order.retailer_id)) then
    raise exception 'DISPATCH:SCOPE: this order is outside your warehouse or area.' using errcode = '42501';
  end if;
  if v_order.status::text = 'dispatched' then
    raise exception 'DISPATCH:ALREADY_DISPATCHED: this order is already dispatched.' using errcode = '22023';
  end if;
  if v_order.status::text not in ('confirmed', 'processing', 'packed') then
    raise exception 'DISPATCH:ORDER_STATE:%', v_order.status::text using errcode = '22023';
  end if;
  if v_order.warehouse_id is null then
    raise exception 'DISPATCH:NO_WAREHOUSE: this order has no warehouse assigned.' using errcode = '22023';
  end if;
  if v_has_delivery and v_delivery.delivery_status::text <> 'failed' then
    raise exception 'DISPATCH:DELIVERY_EXISTS: a delivery task already exists for this order and is not in a failed state.' using errcode = '22023';
  end if;
  select count(*) into v_lines from public.order_items oi where oi.order_id = p_order_id;
  if v_lines = 0 then
    raise exception 'DISPATCH:NO_ITEMS: this order has no items.' using errcode = '22023';
  end if;

  -- ---- Writes -------------------------------------------------------------
  -- Stock first: INSUFFICIENT_STOCK aborts the whole transaction.
  perform public.consume_order_stock(p_order_id);

  update public.orders
     set status = 'dispatched', dispatched_by = p_actor_id, dispatched_at = v_now
   where id = p_order_id;

  if v_has_delivery then
    -- Re-attempt after a failed delivery: same task, fresh OTP, fresh lines.
    update public.order_deliveries
       set delivery_status = 'assigned',
           assigned_staff_id = p_actor_id, assigned_at = v_now, assigned_by = p_actor_id,
           dispatched_at = v_now, in_progress_at = null, delivered_at = null,
           receiver_name = null, otp_hash = p_otp_hash, otp_verified_at = null, otp_attempts = 0,
           signature_url = null, photo_url = null, delivery_notes = null, failure_reason = null,
           return_window_days = null, return_deadline = null, completed_by = null
     where id = v_delivery.id;
    delete from public.order_delivery_items where delivery_id = v_delivery.id;
    v_delivery_id := v_delivery.id;
  else
    insert into public.order_deliveries (
      order_id, delivery_status, assigned_staff_id, assigned_at, assigned_by, dispatched_at, otp_hash
    ) values (
      p_order_id, 'assigned', p_actor_id, v_now, p_actor_id, v_now, p_otp_hash
    ) returning id into v_delivery_id;
  end if;

  -- The snapshot is taken from the order lines by the database, never from
  -- the request.
  insert into public.order_delivery_items (delivery_id, order_item_id, quantity_ordered)
  select v_delivery_id, oi.id, coalesce(oi.quantity_pieces, oi.quantity)
    from public.order_items oi
   where oi.order_id = p_order_id
   order by oi.id;

  select coalesce(jsonb_agg(distinct oi.product_id), '[]'::jsonb) into v_products
    from public.order_items oi where oi.order_id = p_order_id;

  perform set_config('request.jwt.claim.sub', coalesce(v_previous_sub, ''), true);
  return jsonb_build_object(
    'status', 'dispatched',
    'order_id', p_order_id,
    'order_number', v_order.order_number,
    'retailer_id', v_order.retailer_id,
    'delivery_id', v_delivery_id,
    'redispatch', v_has_delivery,
    'product_ids', v_products
  );
end;
$$;
revoke all on function public.dispatch_order_atomic(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.dispatch_order_atomic(uuid, uuid, text) to service_role;
comment on function public.dispatch_order_atomic(uuid, uuid, text) is
  '0100: stock deduction, order status, delivery task and line snapshot in one transaction. service_role only.';

-- ----------------------------------------------------------------------------
-- 4. Failed delivery.
--    Returns { status:'failed', replayed, order_id, order_number, retailer_id,
--              delivery_id, order_reopened }.
--    A repeat for a delivery that is already failed returns replayed = true
--    and writes nothing. Raises 'DELIVERY_FAIL:<CODE>: text'.
-- ----------------------------------------------------------------------------
create or replace function public.fail_delivery_atomic(
  p_order_id uuid,
  p_actor_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_order public.orders%rowtype;
  v_delivery public.order_deliveries%rowtype;
  v_previous_sub text := current_setting('request.jwt.claim.sub', true);
  v_reopened boolean := false;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'DELIVERY_FAIL:FORBIDDEN: this operation runs only on the server.' using errcode = '42501';
  end if;
  if p_order_id is null or p_actor_id is null then
    raise exception 'DELIVERY_FAIL:INVALID_INPUT: order and actor are required.' using errcode = '22023';
  end if;
  if char_length(v_reason) not between 3 and 500 then
    raise exception 'DELIVERY_FAIL:REASON: describe the failure in 3-500 characters.' using errcode = '22023';
  end if;
  v_role := public._fulfilment_actor_role(p_actor_id, array['super_admin', 'admin', 'staff', 'salesman'], 'DELIVERY_FAIL');

  select * into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'DELIVERY_FAIL:NOT_FOUND: order not found.' using errcode = 'P0002';
  end if;
  select * into v_delivery from public.order_deliveries d where d.order_id = p_order_id for update;
  if not found then
    raise exception 'DELIVERY_FAIL:NO_DELIVERY: no delivery task exists for this order.' using errcode = 'P0002';
  end if;

  if v_delivery.assigned_staff_id is distinct from p_actor_id and v_role not in ('super_admin', 'admin') then
    raise exception 'DELIVERY_FAIL:NOT_ASSIGNED: only the assigned delivery person can fail this delivery.' using errcode = '42501';
  end if;

  if v_delivery.delivery_status::text = 'failed' then
    return jsonb_build_object(
      'status', 'failed', 'replayed', true, 'order_id', p_order_id,
      'order_number', v_order.order_number, 'retailer_id', v_order.retailer_id,
      'delivery_id', v_delivery.id, 'order_reopened', false
    );
  end if;
  if v_delivery.delivery_status::text not in ('assigned', 'in_progress') then
    raise exception 'DELIVERY_FAIL:NOT_OPEN:%', v_delivery.delivery_status::text using errcode = '22023';
  end if;
  if v_order.status::text not in ('dispatched', 'processing') then
    raise exception 'DELIVERY_FAIL:ORDER_STATE:%', v_order.status::text using errcode = '22023';
  end if;

  perform set_config('request.jwt.claim.sub', p_actor_id::text, true);

  update public.order_deliveries
     set delivery_status = 'failed', failure_reason = v_reason
   where id = v_delivery.id;

  if v_order.status::text = 'dispatched' then
    update public.orders set status = 'processing' where id = p_order_id;
    v_reopened := true;
  end if;

  perform set_config('request.jwt.claim.sub', coalesce(v_previous_sub, ''), true);
  return jsonb_build_object(
    'status', 'failed', 'replayed', false, 'order_id', p_order_id,
    'order_number', v_order.order_number, 'retailer_id', v_order.retailer_id,
    'delivery_id', v_delivery.id, 'order_reopened', v_reopened
  );
end;
$$;
revoke all on function public.fail_delivery_atomic(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.fail_delivery_atomic(uuid, uuid, text) to service_role;
comment on function public.fail_delivery_atomic(uuid, uuid, text) is
  '0100: marks a delivery failed and re-opens the order in one transaction. service_role only.';

-- ----------------------------------------------------------------------------
-- 5. Return to warehouse (terminal).
--    One transaction: stock back, delivery -> returned_to_warehouse,
--    order -> returned (the 0094/0099 loyalty trigger reverses earned points),
--    Coins refunded through refund_order_coins (0088).
--
--    Returns { status:'returned', replayed, order_id, order_number,
--              retailer_id, delivery_id, refunded_paise }.
--    A repeat after success returns replayed = true and writes nothing: no
--    second stock movement, no second refund, no second loyalty reversal.
--    Raises 'DELIVERY_RETURN:<CODE>: text'.
--
--    RECONCILE: refund_order_coins (0088) deliberately refuses an order that
--    already carries a delivery shortfall credit, because the two credits
--    would overlap. That refusal used to arrive AFTER the order had been
--    marked returned. It is now checked first, so such an order is left
--    completely unchanged for an Admin to reconcile.
-- ----------------------------------------------------------------------------
create or replace function public.return_delivery_to_warehouse_atomic(
  p_order_id uuid,
  p_actor_id uuid,
  p_notes text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_order public.orders%rowtype;
  v_delivery public.order_deliveries%rowtype;
  v_previous_sub text := current_setting('request.jwt.claim.sub', true);
  v_refunded bigint := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'DELIVERY_RETURN:FORBIDDEN: this operation runs only on the server.' using errcode = '42501';
  end if;
  if p_order_id is null or p_actor_id is null then
    raise exception 'DELIVERY_RETURN:INVALID_INPUT: order and actor are required.' using errcode = '22023';
  end if;
  if v_notes is not null and char_length(v_notes) > 1000 then
    raise exception 'DELIVERY_RETURN:NOTES: notes must be 1000 characters or fewer.' using errcode = '22023';
  end if;
  v_role := public._fulfilment_actor_role(p_actor_id, array['super_admin', 'admin', 'staff'], 'DELIVERY_RETURN');

  -- ---- Locks: order -> delivery -> lines ----------------------------------
  select * into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'DELIVERY_RETURN:NOT_FOUND: order not found.' using errcode = 'P0002';
  end if;
  select * into v_delivery from public.order_deliveries d where d.order_id = p_order_id for update;
  if not found then
    raise exception 'DELIVERY_RETURN:NO_DELIVERY: no delivery task exists for this order.' using errcode = 'P0002';
  end if;
  perform 1 from public.order_delivery_items di where di.delivery_id = v_delivery.id order by di.id for update;

  perform set_config('request.jwt.claim.sub', p_actor_id::text, true);

  if v_role = 'staff'
     and not (public.is_warehouse_assigned_to_current_staff(v_order.warehouse_id)
              or public.is_retailer_area_assigned_to_current_staff(v_order.retailer_id)) then
    raise exception 'DELIVERY_RETURN:SCOPE: this order is outside your warehouse or area.' using errcode = '42501';
  end if;

  -- Safe retry: everything already happened in an earlier transaction.
  if v_delivery.delivery_status::text = 'returned_to_warehouse' and v_order.status::text = 'returned' then
    perform set_config('request.jwt.claim.sub', coalesce(v_previous_sub, ''), true);
    return jsonb_build_object(
      'status', 'returned', 'replayed', true, 'order_id', p_order_id,
      'order_number', v_order.order_number, 'retailer_id', v_order.retailer_id,
      'delivery_id', v_delivery.id, 'refunded_paise', 0
    );
  end if;
  if v_delivery.delivery_status::text not in ('delivered', 'partially_delivered') then
    raise exception 'DELIVERY_RETURN:NOT_RETURNABLE:%', v_delivery.delivery_status::text using errcode = '22023';
  end if;
  if v_order.status::text <> 'delivered' then
    raise exception 'DELIVERY_RETURN:ORDER_STATE:%', v_order.status::text using errcode = '22023';
  end if;
  if exists (
    select 1 from public.retailer_wallet_ledger l
     where l.retailer_id = v_order.retailer_id
       and l.transaction_type = 'REFUND_CREDIT'
       and l.reference_type = 'delivery'
       and l.reference_id = v_delivery.id
  ) then
    raise exception 'DELIVERY_RETURN:RECONCILE: this delivery already has a shortfall credit; an Admin must reconcile the wallet before the order can be returned.'
      using errcode = '22023';
  end if;

  -- ---- Writes -------------------------------------------------------------
  perform public.return_order_stock(p_order_id, null);

  update public.order_deliveries
     set delivery_status = 'returned_to_warehouse',
         delivery_notes = coalesce(v_notes, delivery_notes)
   where id = v_delivery.id;

  update public.orders set status = 'returned' where id = p_order_id;

  v_refunded := coalesce(public.refund_order_coins(p_order_id, 'returned to warehouse', p_actor_id), 0);

  perform set_config('request.jwt.claim.sub', coalesce(v_previous_sub, ''), true);
  return jsonb_build_object(
    'status', 'returned', 'replayed', false, 'order_id', p_order_id,
    'order_number', v_order.order_number, 'retailer_id', v_order.retailer_id,
    'delivery_id', v_delivery.id, 'refunded_paise', v_refunded
  );
end;
$$;
revoke all on function public.return_delivery_to_warehouse_atomic(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.return_delivery_to_warehouse_atomic(uuid, uuid, text) to service_role;
comment on function public.return_delivery_to_warehouse_atomic(uuid, uuid, text) is
  '0100: stock return, delivery + order status, loyalty reversal and Coins refund in one transaction. service_role only.';

-- ============================================================================
-- END OF MIGRATION 0100
-- ============================================================================
