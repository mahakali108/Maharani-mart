-- ============================================================================
-- 0097: atomic cancellation for split (multi sub-order) orders.
--
-- REVIEW ONLY. NOT APPLIED TO PRODUCTION. Apply after 0096.
-- See docs/readiness-2026-11-14/04_MIGRATIONS.md.
--
-- Findings closed (independent review of PR #126):
--   SEC-06 (High, was "mitigated only")
--     * cancel_order_coins_atomic (0088) refused every split order, so the
--       retailer, admin and mobile paths fell back to "set status, then refund
--       in a second request". A failure between the two left an order
--       cancelled with Coins not returned.
--     * The admin sub-order action issued three separate RPCs
--       (set_sub_order_status, restore_sub_order_stock, refund_sub_order_coins)
--       and could leave a child cancelled with stock or Coins not restored.
--     * A retailer (policy orders_retailer_cancel) or any admin session could
--       set orders.status = 'cancelled' directly through the Data API and skip
--       the refund entirely.
--
-- Guarantees after this migration:
--   1. One call, one transaction: status of the parent and of every child,
--      stock release, every per-child wallet debit reversal and the coupon
--      release either all commit or none do.
--   2. A cancelled order can only be produced by a database function. Direct
--      Data API writes of status = 'cancelled' (orders) and 'cancelled' /
--      'returned' (sub_orders) are refused for anon, authenticated and
--      service_role.
--   3. The function verifies its own result before returning (every debit
--      fully reversed, no unreleased stock) and raises otherwise, which rolls
--      everything back.
--   4. Lock order is the same in every function that touches these rows:
--        orders row -> retailer_credit_accounts row -> sub_orders (by id)
--        -> order_items (by id) -> retailer_wallet_ledger debits (by id).
--   5. Idempotency: refunds are keyed per debit
--        order-refund-v1:<debit id>:full         (whole-order cancellation)
--        order-refund-v1:<debit id>:child-close  (one child cancelled/returned)
--      and every function first computes "debit minus linked reversals", so a
--      retry or a concurrent second caller credits nothing further.
--
-- No tax, TCS/TDS or settlement behaviour is changed. Children that already
-- have collections or seller-ledger entries are refused (administrator
-- reconciliation), exactly as 0091 does for sellers.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Private helper: refund whatever is still owed on ONE child's checkout debit.
-- Caller must already hold the order row and the credit account row.
-- ----------------------------------------------------------------------------
create or replace function public._refund_child_share_remaining(
  p_parent_order_id uuid, p_sub_order_id uuid, p_event_key text, p_reason text, p_actor uuid
) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_sub public.sub_orders%rowtype;
  v_retailer uuid;
  v_debit public.retailer_wallet_ledger%rowtype;
  v_paid bigint;
  v_bad bigint;
begin
  select retailer_id into v_retailer from public.orders where id = p_parent_order_id;
  select * into v_sub from public.sub_orders where id = p_sub_order_id and parent_order_id = p_parent_order_id;
  if not found then raise exception 'Sub-order not found for this order.' using errcode = 'P0002'; end if;

  select * into v_debit from public.retailer_wallet_ledger
   where retailer_id = v_retailer and reference_type = 'order'
     and reference_id = p_parent_order_id and transaction_type = 'ORDER_DEBIT'
     and idempotency_key = 'order:' || p_parent_order_id::text || ':' || p_sub_order_id::text
   for update;
  if v_sub.coins_share_paise = 0 then
    if found then raise exception 'Unexpected child debit requires reconciliation.' using errcode = '22023'; end if;
    return 0;
  end if;
  if not found or v_debit.is_reversed or v_debit.direction <> 'debit'
     or v_debit.amount_paise <> v_sub.coins_share_paise then
    raise exception 'Child debit does not match checkout share; reconciliation required.' using errcode = '22023';
  end if;
  select coalesce(sum(amount_paise) filter (where direction = 'credit' and transaction_type = 'ORDER_REVERSAL' and not is_reversed), 0),
         count(*) filter (where direction <> 'credit' or transaction_type <> 'ORDER_REVERSAL' or is_reversed
           or retailer_id is distinct from v_retailer or reference_type is distinct from 'order'
           or reference_id is distinct from p_parent_order_id)
    into v_paid, v_bad from public.retailer_wallet_ledger where reversal_of = v_debit.id;
  if v_bad > 0 or v_paid > v_sub.coins_share_paise then
    raise exception 'Existing child refunds require reconciliation.' using errcode = '22023';
  end if;
  if v_paid = v_sub.coins_share_paise then return 0; end if;
  return public._append_order_refund(p_parent_order_id, v_debit.id, v_sub.coins_share_paise - v_paid,
    p_event_key, p_reason, p_actor);
end;
$$;
revoke all on function public._refund_child_share_remaining(uuid, uuid, text, text, uuid) from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Private helper: the 0066 body of set_sub_order_status without the caller
-- check (status write through the 0064 state machine, shipment mirror, parent
-- aggregation). Not executable by any API role.
-- ----------------------------------------------------------------------------
create or replace function public._set_sub_order_status_plain(
  p_sub_order_id uuid, p_status text, p_reason text
) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_sub public.sub_orders%rowtype;
begin
  if p_status is null or p_status not in
       ('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned', 'failed') then
    raise exception 'Unknown sub-order status.' using errcode = '22023';
  end if;
  select * into v_sub from public.sub_orders where id = p_sub_order_id for update;
  if not found then raise exception 'Sub-order not found.' using errcode = 'P0002'; end if;
  if v_sub.status = 'failed' and p_status <> 'failed'
     and (p_reason is null or char_length(btrim(p_reason)) < 3) then
    raise exception 'Closing a failed sub-order needs a reason of at least 3 characters.' using errcode = '22023';
  end if;

  update public.sub_orders
     set status = p_status::text,
         needs_admin_review = case
           when p_status = 'failed' then true
           when p_status in ('shipped', 'cancelled', 'returned') then false
           else needs_admin_review
         end
   where id = p_sub_order_id;

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

  perform public.apply_parent_order_status(v_sub.parent_order_id);
  return p_status;
end;
$$;
revoke all on function public._set_sub_order_status_plain(uuid, text, text) from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Private core: close ONE child (cancelled or returned) with its stock and
-- Coins in the same transaction. Safe to repeat.
-- ----------------------------------------------------------------------------
create or replace function public._close_sub_order_core(
  p_sub_order_id uuid, p_status text, p_reason text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_parent_id uuid;
  v_order public.orders%rowtype;
  v_sub public.sub_orders%rowtype;
  v_stock integer;
  v_refunded bigint;
  v_coupon_id uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if p_status not in ('cancelled', 'returned') then
    raise exception 'Only cancellation or return closes a sub-order.' using errcode = '22023';
  end if;
  if length(coalesce(p_reason, '')) > 500 then raise exception 'Reason is too long.' using errcode = '22023'; end if;

  select parent_order_id into v_parent_id from public.sub_orders where id = p_sub_order_id;
  if not found then raise exception 'Sub-order not found.' using errcode = 'P0002'; end if;

  -- Lock order: order -> credit account -> child.
  select * into v_order from public.orders where id = v_parent_id for update;
  if not found then raise exception 'Parent order not found.' using errcode = 'P0002'; end if;
  perform 1 from public.retailer_credit_accounts where retailer_id = v_order.retailer_id for update;
  select * into v_sub from public.sub_orders where id = p_sub_order_id for update;
  if v_sub.coins_share_paise > 0 and not exists (
       select 1 from public.retailer_credit_accounts where retailer_id = v_order.retailer_id) then
    raise exception 'Wallet account missing; reconciliation required.' using errcode = '22023';
  end if;

  if v_sub.status is distinct from p_status then
    -- Money already collected or posted to the seller needs a reviewed
    -- compensation workflow; refuse and change nothing.
    if exists (select 1 from public.collection_allocations where sub_order_id = p_sub_order_id)
       or exists (select 1 from public.seller_ledger where sub_order_id = p_sub_order_id) then
      raise exception 'Settled child requires administrator reconciliation.' using errcode = '22023';
    end if;
    perform public._set_sub_order_status_plain(p_sub_order_id, p_status, p_reason);
  end if;

  -- Stock: same rule as restore_sub_order_stock (0066), which is idempotent
  -- through order_items.stock_restored_quantity. If the parent itself just
  -- became cancelled, its trigger has already restored these lines and this
  -- returns 0.
  v_stock := public.restore_sub_order_stock(p_sub_order_id);

  v_refunded := public._refund_child_share_remaining(
    v_parent_id, p_sub_order_id, 'child-close',
    coalesce(v_reason, 'Sub-order ' || p_status), coalesce(auth.uid(), v_order.retailer_id));

  -- The coupon is released only when the whole order ended up cancelled.
  if (select status = 'cancelled' from public.orders where id = v_parent_id)
     and not exists (select 1 from public.sub_orders where parent_order_id = v_parent_id and status <> 'cancelled') then
    for v_coupon_id in delete from public.coupon_redemptions where order_id = v_parent_id returning coupon_id loop
      update public.coupons set used_count = greatest(used_count - 1, 0), updated_at = now() where id = v_coupon_id;
    end loop;
  end if;

  -- Post-conditions. Any failure here rolls the whole call back.
  if exists (
    select 1 from public.order_items oi
     where oi.sub_order_id = p_sub_order_id
       and oi.stock_deducted_quantity - oi.shipped_quantity + oi.returned_received_quantity > oi.stock_restored_quantity
  ) then
    raise exception 'ATOMIC_CLOSE: stock was not fully released for this sub-order.' using errcode = '22023';
  end if;
  if public._refund_child_share_remaining(v_parent_id, p_sub_order_id, 'child-close',
       coalesce(v_reason, 'Sub-order ' || p_status), coalesce(auth.uid(), v_order.retailer_id)) <> 0 then
    raise exception 'ATOMIC_CLOSE: Coins were not fully returned for this sub-order.' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'atomic', true,
    'sub_order_id', p_sub_order_id,
    'status', p_status,
    'parent_status', (select status::text from public.orders where id = v_parent_id),
    'stock_restored', v_stock,
    'coins_refunded_paise', v_refunded
  );
end;
$$;
revoke all on function public._close_sub_order_core(uuid, text, text) from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Admin / server entry point used by the application.
-- ----------------------------------------------------------------------------
create or replace function public.close_sub_order_atomic(
  p_parent_order_id uuid, p_sub_order_id uuid, p_status text, p_reason text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.role() is distinct from 'service_role'
     and (auth.uid() is null or not public.is_active_account() or not public.is_admin_or_above()) then
    raise exception 'Sub-order closure is admin/server only.' using errcode = '42501';
  end if;
  if p_parent_order_id is null or p_sub_order_id is null or not exists (
    select 1 from public.sub_orders where id = p_sub_order_id and parent_order_id = p_parent_order_id
  ) then
    raise exception 'Sub-order does not belong to this order.' using errcode = '22023';
  end if;
  return public._close_sub_order_core(p_sub_order_id, p_status, p_reason);
end;
$$;
revoke all on function public.close_sub_order_atomic(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.close_sub_order_atomic(uuid, uuid, text, text) to authenticated, service_role;

-- set_sub_order_status keeps its signature and callers. Cancellation and
-- return now run the atomic core, so no caller can produce a half-closed child.
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
begin
  if auth.role() is distinct from 'service_role'
     and (auth.uid() is null or not public.is_admin_or_above()) then
    raise exception 'Sub-order transitions are admin/server only.' using errcode = '42501';
  end if;
  if p_status in ('cancelled', 'returned') then
    perform public._close_sub_order_core(p_sub_order_id, p_status, p_reason);
    return p_status;
  end if;
  return public._set_sub_order_status_plain(p_sub_order_id, p_status, p_reason);
end;
$$;

-- ----------------------------------------------------------------------------
-- Whole-order cancellation, now including split orders.
-- Same signature, grants and single-order behaviour as 0088.
-- ----------------------------------------------------------------------------
create or replace function public.cancel_order_coins_atomic(p_order_id uuid, p_reason text default null)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order public.orders%rowtype;
  v_refunded bigint;
  v_admin boolean;
  v_split boolean;
  v_child public.sub_orders%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found.' using errcode = 'P0002'; end if;
  if auth.uid() is null and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if auth.uid() is not null and not public.is_active_account() then
    raise exception 'Active account required.' using errcode = '42501';
  end if;
  v_admin := coalesce(auth.role() = 'service_role', false) or public.is_admin_or_above();
  if not v_admin and auth.uid() is distinct from v_order.retailer_id then
    raise exception 'Access denied.' using errcode = '42501';
  end if;
  if v_order.status <> 'cancelled' and (
    (not v_admin and v_order.status <> 'pending') or
    (v_admin and v_order.status not in ('pending', 'confirmed', 'processing', 'packed'))
  ) then raise exception 'Order cannot be cancelled in its current status.' using errcode = '22023'; end if;
  if length(coalesce(p_reason, '')) > 500 then raise exception 'Reason is too long.' using errcode = '22023'; end if;

  v_split := exists (select 1 from public.sub_orders where parent_order_id = p_order_id);

  if v_split then
    -- Lock order: order (held) -> credit account -> children by id.
    perform 1 from public.retailer_credit_accounts where retailer_id = v_order.retailer_id for update;
    -- Checkout (0065) writes exactly one debit per child that used Coins, keyed
    -- order:<parent>:<child>, for exactly that child's share. Anything else
    -- (a missing debit, a wrong amount, a debit no child accounts for) cannot
    -- be refunded safely and is refused before anything is changed.
    if exists (
      select 1 from public.sub_orders so
       where so.parent_order_id = p_order_id and so.coins_share_paise > 0
         and not exists (
           select 1 from public.retailer_wallet_ledger d
            where d.retailer_id = v_order.retailer_id and d.reference_type = 'order' and d.reference_id = p_order_id
              and d.transaction_type = 'ORDER_DEBIT' and d.direction = 'debit'
              and d.idempotency_key = 'order:' || p_order_id::text || ':' || so.id::text
              and d.amount_paise = so.coins_share_paise)
    ) or exists (
      select 1 from public.retailer_wallet_ledger d
       where d.retailer_id = v_order.retailer_id and d.reference_type = 'order' and d.reference_id = p_order_id
         and d.transaction_type = 'ORDER_DEBIT'
         and not exists (
           select 1 from public.sub_orders so
            where so.parent_order_id = p_order_id and so.coins_share_paise = d.amount_paise
              and d.idempotency_key = 'order:' || p_order_id::text || ':' || so.id::text)
    ) then
      raise exception 'Split order cancellation requires reconciliation: the wallet debits do not match the sub-order Coins shares.'
        using errcode = '22023';
    end if;
    for v_child in
      select * from public.sub_orders where parent_order_id = p_order_id order by id for update
    loop
      if v_child.status = 'cancelled' then continue; end if;
      if v_child.status not in ('pending', 'confirmed', 'processing', 'failed')
         or (not v_admin and v_child.status <> 'pending') then
        raise exception 'SPLIT_CANCEL: part of this order is already being fulfilled, so the whole order cannot be cancelled.'
          using errcode = '22023';
      end if;
      if exists (select 1 from public.collection_allocations where sub_order_id = v_child.id)
         or exists (select 1 from public.seller_ledger where sub_order_id = v_child.id) then
        raise exception 'SPLIT_CANCEL: a settled sub-order requires administrator reconciliation.' using errcode = '22023';
      end if;
      -- Aggregation moves the parent to cancelled after the last child.
      perform public._set_sub_order_status_plain(v_child.id, 'cancelled', coalesce(v_reason, 'Order cancelled'));
    end loop;
    select * into v_order from public.orders where id = p_order_id;
  end if;

  if v_order.status <> 'cancelled' then
    update public.orders set status = 'cancelled', cancelled_reason = v_reason where id = p_order_id;
  elsif v_split and v_reason is not null then
    update public.orders set cancelled_reason = coalesce(cancelled_reason, v_reason) where id = p_order_id;
  end if;

  -- Reverses what is still owed on EVERY debit of the order (one per child).
  v_refunded := public.refund_order_coins(p_order_id, coalesce(v_reason, 'Order cancelled'), auth.uid());
  if exists (select 1 from public.coupon_redemptions where order_id = p_order_id) then
    perform public.release_coupon(p_order_id);
  end if;

  if v_split then
    -- Post-conditions for split orders. A failure rolls everything back.
    if exists (select 1 from public.sub_orders where parent_order_id = p_order_id and status <> 'cancelled') then
      raise exception 'SPLIT_CANCEL: a sub-order is not cancelled.' using errcode = '22023';
    end if;
    if exists (
      select 1 from public.retailer_wallet_ledger d
       where d.retailer_id = v_order.retailer_id and d.reference_type = 'order' and d.reference_id = p_order_id
         and d.transaction_type = 'ORDER_DEBIT'
         and d.amount_paise <> coalesce((
           select sum(c.amount_paise) from public.retailer_wallet_ledger c
            where c.reversal_of = d.id and c.direction = 'credit'
              and c.transaction_type = 'ORDER_REVERSAL' and not c.is_reversed), 0)
    ) then
      raise exception 'SPLIT_CANCEL: Coins were not fully returned.' using errcode = '22023';
    end if;
    if exists (
      select 1 from public.order_items oi
       where oi.order_id = p_order_id and oi.sub_order_id is not null
         and oi.stock_deducted_quantity - oi.shipped_quantity + oi.returned_received_quantity > oi.stock_restored_quantity
    ) then
      raise exception 'SPLIT_CANCEL: stock was not fully released.' using errcode = '22023';
    end if;
  end if;
  return v_refunded;
end;
$$;

-- ----------------------------------------------------------------------------
-- Pre-existing defect found while testing (0069): the re-moderation trigger on
-- seller_offers demands an active SELLER membership for every UPDATE made in
-- an authenticated non-admin session - including the system stock movement a
-- database function performs for a RETAILER (stock release on cancellation).
-- A retailer therefore could not cancel any order holding seller-fulfilled
-- stock: the call failed with "An active seller membership is required."
--
-- A change that touches ONLY stock_quantity / updated_at is a stock movement,
-- not a seller editing terms, and is exempt. Direct Data API writes by
-- non-members are still impossible: the row-level policy
-- "seller_offers_seller_update" (0072) admits only Admins and active members,
-- and the 0068 column guard still restricts what a seller may write directly.
-- Everything else in this function is the 0069 body, unchanged.
-- ----------------------------------------------------------------------------
create or replace function public.remoderate_seller_offer_terms()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  if auth.role() = 'authenticated' and not public.is_admin_or_above() then
    -- The exemption never applies when seller_replace_offer_tiers has asked for
    -- re-moderation: that function signals a change of tier terms by touching
    -- only updated_at with app.remoderate_offer = 'on'.
    if coalesce(current_setting('app.remoderate_offer', true), '') <> 'on'
       and (to_jsonb(new) - 'stock_quantity' - 'updated_at') = (to_jsonb(old) - 'stock_quantity' - 'updated_at') then
      return new;
    end if;
    select status into v_status from public.sellers where id = new.seller_id;
    if public.current_user_role() is distinct from 'seller'
       or not public.is_member_of_seller(new.seller_id)
       or v_status is distinct from 'active' then
      raise exception 'An active seller membership is required.' using errcode = '42501';
    end if;

    if new.unit_price_paise is distinct from old.unit_price_paise
       or new.moq is distinct from old.moq
       or new.seller_sku is distinct from old.seller_sku
       or coalesce(current_setting('app.remoderate_offer', true), '') = 'on' then
      new.moderation_status := 'pending';
      new.moderation_by := null;
      new.moderated_at := null;
      new.moderation_reason := null;
    end if;
  end if;
  return new;
end;
$$;
-- A trigger function is never called directly; remove the default PUBLIC grant.
revoke all on function public.remoderate_seller_offer_terms() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- A cancelled order / closed child can only be produced by a database
-- function. SECURITY INVOKER on purpose: inside the definer functions above
-- current_user is the function owner, so only DIRECT Data API writes match.
-- ----------------------------------------------------------------------------
create or replace function public.guard_direct_order_cancellation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status::text = 'cancelled' and old.status::text <> 'cancelled'
     and current_user in ('anon', 'authenticated', 'service_role') then
    raise exception 'CANCEL_GUARD: orders are cancelled only through cancel_order_coins_atomic, which returns Coins, stock and coupon in the same transaction.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_direct_order_cancellation() from public, anon, authenticated;

drop trigger if exists trg_guard_direct_order_cancellation on public.orders;
create trigger trg_guard_direct_order_cancellation
  before update of status on public.orders
  for each row execute function public.guard_direct_order_cancellation();

create or replace function public.guard_direct_sub_order_closure()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status in ('cancelled', 'returned') and new.status is distinct from old.status
     and current_user in ('anon', 'authenticated', 'service_role') then
    raise exception 'CANCEL_GUARD: sub-orders are cancelled or returned only through close_sub_order_atomic.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_direct_sub_order_closure() from public, anon, authenticated;

drop trigger if exists trg_guard_direct_sub_order_closure on public.sub_orders;
create trigger trg_guard_direct_sub_order_closure
  before update of status on public.sub_orders
  for each row execute function public.guard_direct_sub_order_closure();
