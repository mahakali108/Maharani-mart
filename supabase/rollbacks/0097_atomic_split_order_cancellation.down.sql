-- ============================================================================
-- ROLLBACK for 0097_atomic_split_order_cancellation.sql
-- REVIEW ONLY, NOT APPLIED ANYWHERE.
--
-- WARNING: re-opens SEC-06. After this rollback split orders cannot be
-- cancelled atomically, a child can again be left cancelled without its stock
-- or Coins, and status = 'cancelled' can again be written directly through the
-- Data API. The application (this PR) refuses to cancel or return a sub-order
-- when close_sub_order_atomic is absent, so roll the application back too if
-- the old behaviour is really wanted.
-- Restores the 0088 body of cancel_order_coins_atomic and the 0066 body of
-- set_sub_order_status verbatim. Ledger rows written while 0097 was active
-- stay valid: their keys (order-refund-v1:<debit>:child-close) are understood
-- by the 0088/0092 functions as ordinary linked reversals. No data is changed.
-- ============================================================================
begin;

drop trigger if exists trg_guard_direct_sub_order_closure on public.sub_orders;
drop function if exists public.guard_direct_sub_order_closure();
drop trigger if exists trg_guard_direct_order_cancellation on public.orders;
drop function if exists public.guard_direct_order_cancellation();

-- 0088 body.
create or replace function public.cancel_order_coins_atomic(p_order_id uuid, p_reason text default null)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order public.orders%rowtype;
  v_refunded bigint;
  v_admin boolean;
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
  if exists (select 1 from public.sub_orders where parent_order_id = p_order_id) then
    raise exception 'Split order cancellation requires separate reviewed handling.' using errcode = '22023';
  end if;
  if length(coalesce(p_reason, '')) > 500 then raise exception 'Reason is too long.' using errcode = '22023'; end if;
  if v_order.status <> 'cancelled' then
    update public.orders set status = 'cancelled', cancelled_reason = nullif(btrim(p_reason), '') where id = p_order_id;
  end if;
  v_refunded := public.refund_order_coins(p_order_id, coalesce(nullif(btrim(p_reason), ''), 'Order cancelled'), auth.uid());
  if exists (select 1 from public.coupon_redemptions where order_id = p_order_id) then
    perform public.release_coupon(p_order_id);
  end if;
  return v_refunded;
end;
$$;

-- 0066 body.
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

-- 0069 body.
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

drop function if exists public.close_sub_order_atomic(uuid, uuid, text, text);
drop function if exists public._close_sub_order_core(uuid, text, text);
drop function if exists public._set_sub_order_status_plain(uuid, text, text);
drop function if exists public._refund_child_share_remaining(uuid, uuid, text, text, uuid);

commit;
