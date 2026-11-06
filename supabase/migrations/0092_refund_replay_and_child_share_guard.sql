-- Draft: verify all linked history even on an event replay, and reject a
-- malformed child debit whose total exceeds its immutable checkout share.
-- No historical rows are modified.

create or replace function public._append_order_refund(
  p_order_id uuid, p_debit_id uuid, p_amount_paise bigint,
  p_event_key text, p_reason text, p_actor uuid
) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_debit public.retailer_wallet_ledger%rowtype;
  v_existing public.retailer_wallet_ledger%rowtype;
  v_credited bigint;
  v_bad bigint;
  v_key text;
begin
  if p_amount_paise is null or p_amount_paise <= 0 or p_event_key is null
     or length(p_event_key) not between 1 and 100 or btrim(p_event_key) <> p_event_key then
    raise exception 'A positive amount and stable refund event key are required.' using errcode = '22023';
  end if;
  -- The caller has already locked the order and retailer credit account.
  select * into v_debit from public.retailer_wallet_ledger where id = p_debit_id for update;
  if not found or v_debit.reference_type is distinct from 'order' or v_debit.reference_id is distinct from p_order_id
     or v_debit.transaction_type <> 'ORDER_DEBIT' or v_debit.direction <> 'debit' then
    raise exception 'Eligible order debit not found.' using errcode = '22023';
  end if;
  if v_debit.is_reversed then
    raise exception 'Historical reversed debit requires reconciliation.' using errcode = '22023';
  end if;
  -- Delivery shortfall entries are not linked to the original debit. Until an
  -- allocation policy exists, do not risk refunding the same entitlement twice.
  if exists (
    select 1 from public.retailer_wallet_ledger l
    join public.order_deliveries d on d.id = l.reference_id
    where d.order_id = p_order_id and l.retailer_id = v_debit.retailer_id
      and l.transaction_type = 'REFUND_CREDIT' and l.reference_type = 'delivery'
  ) or exists (
    select 1 from public.retailer_wallet_ledger l
    where l.retailer_id = v_debit.retailer_id and l.reference_type = 'order'
      and l.reference_id = p_order_id and l.transaction_type = 'ORDER_REVERSAL'
      and l.reversal_of is null
  ) then
    raise exception 'Ambiguous prior order credits require reconciliation.' using errcode = '22023';
  end if;
  select coalesce(sum(amount_paise) filter (where direction = 'credit' and transaction_type = 'ORDER_REVERSAL' and not is_reversed), 0),
         count(*) filter (where direction <> 'credit' or transaction_type <> 'ORDER_REVERSAL' or is_reversed
           or retailer_id is distinct from v_debit.retailer_id or reference_type is distinct from 'order' or reference_id is distinct from p_order_id)
    into v_credited, v_bad from public.retailer_wallet_ledger where reversal_of = p_debit_id;
  if v_bad > 0 or v_credited > v_debit.amount_paise then
    raise exception 'Existing linked refund history requires reconciliation.' using errcode = '22023';
  end if;
  v_key := 'order-refund-v1:' || p_debit_id::text || ':' || p_event_key;
  select * into v_existing from public.retailer_wallet_ledger where idempotency_key = v_key;
  if found then
    if v_existing.reversal_of is distinct from p_debit_id
       or v_existing.retailer_id is distinct from v_debit.retailer_id
       or v_existing.reference_id is distinct from p_order_id
       or v_existing.transaction_type <> 'ORDER_REVERSAL' or v_existing.direction <> 'credit'
       or v_existing.is_reversed or v_existing.amount_paise <> p_amount_paise
       or v_existing.reason is distinct from p_reason
       or v_existing.created_by is distinct from p_actor then
      raise exception 'Refund event key conflicts with an existing request.' using errcode = '23505';
    end if;
    return v_existing.amount_paise;
  end if;
  if p_amount_paise > v_debit.amount_paise - v_credited then
    raise exception 'Refund exceeds the remaining eligible debit.' using errcode = '22023';
  end if;
  insert into public.retailer_wallet_ledger (
    retailer_id, account_id, transaction_type, amount_paise, direction,
    reference_type, reference_id, description, reason, created_by, notes,
    idempotency_key, metadata, reversal_of
  ) values (
    v_debit.retailer_id, v_debit.account_id, 'ORDER_REVERSAL', p_amount_paise, 'credit',
    'order', p_order_id, 'Order coin refund', p_reason, p_actor,
    'Linked refund of order debit', v_key,
    jsonb_build_object('order_id', p_order_id, 'refund_event_key', p_event_key), p_debit_id
  );
  return p_amount_paise;
end;
$$;
revoke all on function public._append_order_refund(uuid, uuid, bigint, text, text, uuid) from public, anon, authenticated, service_role;


create or replace function public.refund_sub_order_coins_event(
  p_sub_order_id uuid, p_amount_paise bigint, p_event_key text,
  p_reason text default null, p_created_by uuid default null
) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_sub public.sub_orders%rowtype;
  v_order public.orders%rowtype;
  v_debit public.retailer_wallet_ledger%rowtype;
  v_actor uuid;
begin
  select * into v_sub from public.sub_orders where id = p_sub_order_id;
  if not found then raise exception 'Sub-order not found.' using errcode = 'P0002'; end if;
  select * into v_order from public.orders where id = v_sub.parent_order_id for update;
  if not found then raise exception 'Parent order not found.' using errcode = 'P0002'; end if;
  if auth.uid() is null and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if auth.uid() is not null and not public.is_active_account() then
    raise exception 'Active account required.' using errcode = '42501';
  end if;
  if auth.uid() is not null and auth.uid() <> v_order.retailer_id and not public.is_staff_or_above() then
    raise exception 'Access denied.' using errcode = '42501';
  end if;
  if auth.uid() is not null and p_created_by is not null and p_created_by <> auth.uid() then
    raise exception 'Actor mismatch.' using errcode = '42501';
  end if;
  perform 1 from public.retailer_credit_accounts where retailer_id = v_order.retailer_id for update;
  if not found then raise exception 'Wallet account missing.' using errcode = '22023'; end if;
  select * into v_sub from public.sub_orders where id = p_sub_order_id for update;
  if not found or v_sub.parent_order_id <> v_order.id or v_sub.status not in ('cancelled', 'returned') then
    raise exception 'Sub-order is not refundable.' using errcode = '22023';
  end if;
  if p_amount_paise is null or p_amount_paise <= 0 or p_amount_paise > v_sub.coins_share_paise then
    raise exception 'Invalid child refund amount.' using errcode = '22023';
  end if;
  select * into v_debit from public.retailer_wallet_ledger
  where retailer_id = v_order.retailer_id and reference_type = 'order' and reference_id = v_order.id
    and transaction_type = 'ORDER_DEBIT'
    and idempotency_key = 'order:' || v_order.id::text || ':' || p_sub_order_id::text for update;
  if not found or v_debit.is_reversed or v_debit.direction <> 'debit'
     or v_debit.amount_paise <> v_sub.coins_share_paise then
    raise exception 'Child debit does not match checkout share; reconciliation required.' using errcode = '22023';
  end if;
  v_actor := coalesce(auth.uid(), p_created_by, v_order.retailer_id);
  return public._append_order_refund(v_order.id, v_debit.id, p_amount_paise, p_event_key,
    coalesce(nullif(btrim(p_reason), ''), 'Sub-order refunded'), v_actor);
end;
$$;
revoke all on function public.refund_sub_order_coins_event(uuid, bigint, text, text, uuid) from public, anon;
grant execute on function public.refund_sub_order_coins_event(uuid, bigint, text, text, uuid) to authenticated, service_role;
