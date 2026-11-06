-- Keep one calculation while allowing the internal ledger trigger to refresh
-- the legacy mirror for an authorized seller refund. This does NOT grant the
-- seller permission to read a retailer's wallet through the public RPC.
create function public._wallet_outstanding_for_trigger(p_retailer_id uuid)
returns bigint language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_opening bigint; v_delta bigint;
begin
  select coalesce(sum(amount_paise) filter (where direction = 'debit' and not is_reversed and transaction_type <> 'CREDIT_LIMIT_CHANGE'), 0)
       - coalesce(sum(amount_paise) filter (where direction = 'credit' and not is_reversed and transaction_type <> 'CREDIT_LIMIT_CHANGE'), 0)
    into v_delta from public.retailer_wallet_ledger where retailer_id = p_retailer_id;
  select opening_outstanding_paise into v_opening from public.retailer_credit_accounts where retailer_id = p_retailer_id;
  if v_opening is null then
    if v_delta = 0 then
      select coalesce((outstanding_balance * 100)::bigint, 0) into v_opening from public.retailers where id = p_retailer_id;
    else v_opening := 0; end if;
  end if;
  return coalesce(v_opening, 0) + v_delta;
end;
$$;
revoke all on function public._wallet_outstanding_for_trigger(uuid) from public, anon, authenticated, service_role;

create or replace function public.get_retailer_outstanding_paise(p_retailer_id uuid)
returns bigint language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public._can_access_retailer_wallet(p_retailer_id) then
    raise exception 'Access denied: cannot view wallet for retailer %', p_retailer_id using errcode = '42501';
  end if;
  return public._wallet_outstanding_for_trigger(p_retailer_id);
end;
$$;

create or replace function public.sync_retailer_outstanding_balance()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_retailer uuid := coalesce(new.retailer_id, old.retailer_id);
begin
  update public.retailers set outstanding_balance = public._wallet_outstanding_for_trigger(v_retailer)::numeric / 100.0,
    updated_at = now() where id = v_retailer;
  return coalesce(new, old);
end;
$$;
revoke all on function public.sync_retailer_outstanding_balance() from public, anon, authenticated, service_role;

-- Draft, isolated testing only. Wrap the seller fulfilment transition so an
-- eligible child cancellation, stock return and Coins credit commit together.
-- No seller settlement or historical ledger rows are modified.
-- The original transition becomes private; all seller calls retain its exact
-- tenant/state checks. Parent, account and child operations are serialized.
alter function public.seller_update_sub_order(uuid, text, text, text)
  rename to _seller_update_sub_order_before_atomic_refund;
revoke all on function public._seller_update_sub_order_before_atomic_refund(uuid, text, text, text)
  from public, anon, authenticated, service_role;

create function public.seller_update_sub_order(
  p_sub_order_id uuid, p_status text, p_courier text default null, p_awb text default null
) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_sub public.sub_orders%rowtype;
  v_parent public.orders%rowtype;
  v_debit public.retailer_wallet_ledger%rowtype;
  v_paid bigint;
  v_bad bigint;
  v_coupon_id uuid;
  v_result text;
begin
  if auth.uid() is null or not public.is_active_account()
     or public.current_user_role() is distinct from 'seller' then
    raise exception 'Active seller required.' using errcode = '42501';
  end if;
  select so.* into v_sub from public.sub_orders so
    join public.sellers s on s.id = so.seller_id
   where so.id = p_sub_order_id and so.fulfilment_type = 'seller'
     and s.status = 'active' and public.is_member_of_seller(so.seller_id);
  if not found then raise exception 'Sub-order not found for this active seller.' using errcode = '42501'; end if;
  select * into v_parent from public.orders where id = v_sub.parent_order_id for update;
  if not found then raise exception 'Parent order not found.' using errcode = 'P0002'; end if;

  if p_status = 'cancelled' then
    -- Collections and AP need an independently reviewed compensation workflow;
    -- refusing such a case leaves both planes and all fulfilment unchanged.
    if exists (select 1 from public.collection_allocations where sub_order_id = p_sub_order_id)
       or exists (select 1 from public.seller_ledger where sub_order_id = p_sub_order_id) then
      raise exception 'Settled child requires administrator reconciliation.' using errcode = '22023';
    end if;
    if exists (
      select 1 from public.order_deliveries d
      join public.retailer_wallet_ledger l on l.reference_id = d.id
       where d.order_id = v_parent.id and l.retailer_id = v_parent.retailer_id
         and l.transaction_type = 'REFUND_CREDIT' and l.reference_type = 'delivery'
    ) or exists (
      select 1 from public.retailer_wallet_ledger l
       where l.retailer_id = v_parent.retailer_id and l.reference_type = 'order'
         and l.reference_id = v_parent.id and l.transaction_type = 'ORDER_REVERSAL'
         and l.reversal_of is null
    ) then raise exception 'Ambiguous prior order credits require reconciliation.' using errcode = '22023'; end if;
    if v_sub.coins_share_paise > 0 then
      perform 1 from public.retailer_credit_accounts where retailer_id = v_parent.retailer_id for update;
      if not found then raise exception 'Wallet account missing; reconciliation required.' using errcode = '22023'; end if;
    end if;
  end if;

  -- The private original preserves seller shipment changes, stock restoration,
  -- state-machine validation and parent aggregation in this transaction.
  v_result := public._seller_update_sub_order_before_atomic_refund(p_sub_order_id, p_status, p_courier, p_awb);
  if p_status <> 'cancelled' then return v_result; end if;
  select * into v_sub from public.sub_orders where id = p_sub_order_id for update;
  select * into v_debit from public.retailer_wallet_ledger
    where retailer_id = v_parent.retailer_id and reference_type = 'order'
      and reference_id = v_parent.id and transaction_type = 'ORDER_DEBIT'
      and idempotency_key = 'order:' || v_parent.id::text || ':' || v_sub.id::text for update;
  if v_sub.coins_share_paise = 0 then
    if found then raise exception 'Unexpected child debit requires reconciliation.' using errcode = '22023'; end if;
  else
    if not found or v_debit.is_reversed or v_debit.direction <> 'debit'
       or v_debit.amount_paise <> v_sub.coins_share_paise then
      raise exception 'Child debit does not match checkout share; reconciliation required.' using errcode = '22023';
    end if;
    select coalesce(sum(amount_paise) filter (where direction = 'credit' and transaction_type = 'ORDER_REVERSAL' and not is_reversed), 0),
           count(*) filter (where direction <> 'credit' or transaction_type <> 'ORDER_REVERSAL' or is_reversed
             or retailer_id is distinct from v_parent.retailer_id or reference_type is distinct from 'order'
             or reference_id is distinct from v_parent.id)
      into v_paid, v_bad from public.retailer_wallet_ledger where reversal_of = v_debit.id;
    if v_bad > 0 or v_paid > v_sub.coins_share_paise then
      raise exception 'Existing child refunds require reconciliation.' using errcode = '22023';
    end if;
    if v_paid < v_sub.coins_share_paise then
      perform public._append_order_refund(v_parent.id, v_debit.id, v_sub.coins_share_paise - v_paid,
        'seller-child-cancel', 'Seller cancelled sub-order', auth.uid());
    end if;
  end if;

  -- Only release a parent coupon after every child has actually cancelled.
  -- Mirror release_coupon's counter updates, within the same transaction;
  -- seller callers cannot directly execute release_coupon for the parent.
  if (select status = 'cancelled' from public.orders where id = v_parent.id)
     and not exists (select 1 from public.sub_orders where parent_order_id = v_parent.id and status <> 'cancelled') then
    for v_coupon_id in delete from public.coupon_redemptions where order_id = v_parent.id returning coupon_id loop
      update public.coupons set used_count = greatest(used_count - 1, 0), updated_at = now() where id = v_coupon_id;
    end loop;
  end if;
  return v_result;
end;
$$;
revoke all on function public.seller_update_sub_order(uuid, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.seller_update_sub_order(uuid, text, text, text) to authenticated;
