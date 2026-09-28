-- ============================================================================
-- 0053 — 🪙 ORDER COIN REFUNDS — one atomic, auditable, RLS-safe function
-- ============================================================================
--
-- Coins are spent by `check_and_debit_retailer_wallet` (0030), which writes an
-- `ORDER_DEBIT` row keyed `order:<order_id>`. Giving those coins back was done
-- by the app with a direct INSERT into `retailer_wallet_ledger` + an UPDATE of
-- the original row — but that ledger table only has admin INSERT/UPDATE policies
-- (0029: `wallet_ledger_admin_insert` / `wallet_ledger_admin_update`).
--
-- Consequence: a refund triggered by the RETAILER cancelling their own order or
-- by STAFF recording a return was rejected by RLS, so the coins were never
-- credited back. Opening the table to those roles would be far worse — a
-- retailer could then mint coins for itself.
--
-- This function keeps the ledger admin-only at the table level and exposes the
-- ONE narrow operation the business needs:
--
--   * the caller must be the order's own retailer, or staff/admin, or have no
--     session (service role / internal server call),
--   * the order must be in a refundable state (cancelled or returned) — a live
--     order cannot be refunded,
--   * at most ONE reversal per debit, enforced by the ledger's unique
--     `idempotency_key` (`reversal:<debit id>`) — cancelling twice refunds once,
--   * the credit and the "original reversed" flag move in the SAME transaction,
--   * historical credit rows are never touched: this only appends.
--
-- Additive only: no table, column, policy or grant is dropped or weakened, and
-- no data is modified. Existing rows keep their meaning.
-- ============================================================================

create or replace function public.refund_order_coins(
  p_order_id uuid,
  p_reason text default null,
  p_created_by uuid default null
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_retailer_id uuid;
  v_status public.order_status;
  v_debit public.retailer_wallet_ledger%rowtype;
  v_account_id uuid;
  v_ledger_id uuid;
  v_actor uuid;
  v_reason text;
begin
  if p_order_id is null then
    raise exception 'Order id is required.' using errcode = '22023';
  end if;

  select retailer_id, status into v_retailer_id, v_status
  from public.orders
  where id = p_order_id;

  if v_retailer_id is null then
    raise exception 'Order % was not found.', p_order_id using errcode = 'P0002';
  end if;

  -- Authorization: the shop itself, staff/admin, or an internal (unauthenticated
  -- within the function) call. Any other signed-in user is refused.
  if auth.uid() is not null
     and auth.uid() <> v_retailer_id
     and not public.is_staff_or_above() then
    raise exception 'Access denied: you cannot refund coins for this order.' using errcode = '42501';
  end if;

  -- Only a terminal, non-delivered outcome gives the goods back. `delivered`
  -- and every in-flight state are deliberately excluded.
  if v_status not in ('cancelled', 'returned') then
    raise exception 'Order % is not refundable in status %.', p_order_id, v_status
      using errcode = '22023';
  end if;

  v_actor := coalesce(p_created_by, auth.uid(), v_retailer_id);
  v_reason := coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'Order refunded');

  select * into v_debit
  from public.retailer_wallet_ledger
  where reference_id = p_order_id
    and retailer_id = v_retailer_id
    and transaction_type = 'ORDER_DEBIT'
  order by created_at
  limit 1;

  -- No coin spend on this order (a pre-coins order, or a zero-balance checkout)
  -- and an already-reversed spend both mean there is nothing to give back.
  if not found or v_debit.is_reversed then
    return 0;
  end if;

  select id into v_account_id
  from public.retailer_credit_accounts
  where retailer_id = v_retailer_id;

  insert into public.retailer_wallet_ledger (
    retailer_id, account_id, transaction_type, amount_paise, direction,
    reference_type, reference_id, description, reason, created_by, notes,
    idempotency_key, metadata, reversal_of
  ) values (
    v_retailer_id, v_account_id, 'ORDER_REVERSAL', v_debit.amount_paise, 'credit',
    'order', p_order_id,
    format('Reversal of order %s — %s', p_order_id, v_reason),
    v_reason, v_actor,
    format('Reverses ORDER_DEBIT %s', v_debit.id),
    'reversal:' || v_debit.id::text,
    jsonb_build_object('reversal_of', v_debit.id, 'order_id', p_order_id),
    v_debit.id
  )
  on conflict (idempotency_key) do nothing
  returning id into v_ledger_id;

  -- A concurrent/retried refund already wrote the same deterministic credit:
  -- that IS the idempotent success, with nothing left to move.
  if v_ledger_id is null then
    return 0;
  end if;

  update public.retailer_wallet_ledger
     set is_reversed = true,
         reversed_at = now(),
         reversed_by = v_actor
   where id = v_debit.id
     and is_reversed = false;

  return v_debit.amount_paise;
end;
$$;

comment on function public.refund_order_coins(uuid, text, uuid) is
  '🪙 Refunds the coins an order actually spent: one linked ORDER_REVERSAL credit, idempotent on reversal:<debit id>, restricted to the order''s retailer or staff/admin, and only for a cancelled/returned order.';

-- Only a signed-in caller (or the service role) can ask; the function's own
-- authorization still decides whether the refund happens.
revoke all on function public.refund_order_coins(uuid, text, uuid) from public;
revoke all on function public.refund_order_coins(uuid, text, uuid) from anon;
grant execute on function public.refund_order_coins(uuid, text, uuid) to authenticated;
grant execute on function public.refund_order_coins(uuid, text, uuid) to service_role;

-- ----------------------------------------------------------------------------
-- Shortfall coins: the refund for missing/damaged goods at delivery.
--
-- The same RLS problem applies to the credit written at partial delivery: the
-- ledger is admin-only, yet the delivery is completed by STAFF or a SALESMAN.
-- One function covers both directions:
--
--   p_reverse = false → credit the shortfall, idempotent on
--                       `delivery-shortfall:<delivery id>`
--   p_reverse = true  → flag that credit as reversed (the goods came back, so
--                       the shop pays for them again) — at most once
--
-- The amount is bounded by the order's own grand total, so a settlement bug
-- cannot credit more coins than the order ever cost.
-- ----------------------------------------------------------------------------
create or replace function public.order_shortfall_coins(
  p_delivery_id uuid,
  p_amount_paise bigint default 0,
  p_reason text default null,
  p_created_by uuid default null,
  p_reverse boolean default false
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_retailer_id uuid;
  v_grand_total_paise bigint;
  v_delivery_actor uuid;
  v_account_id uuid;
  v_ledger_id uuid;
  v_existing public.retailer_wallet_ledger%rowtype;
  v_actor uuid;
begin
  select d.order_id, o.retailer_id, round(o.grand_total * 100)::bigint,
         coalesce(d.completed_by, d.assigned_staff_id)
    into v_order_id, v_retailer_id, v_grand_total_paise, v_delivery_actor
  from public.order_deliveries d
  join public.orders o on o.id = d.order_id
  where d.id = p_delivery_id;

  if v_order_id is null then
    raise exception 'Delivery % was not found.', p_delivery_id using errcode = 'P0002';
  end if;

  -- The delivery team (staff/admin, or the member actually assigned/completing
  -- this delivery) is the only non-internal caller.
  if auth.uid() is not null
     and not public.is_staff_or_above()
     and auth.uid() <> v_delivery_actor then
    raise exception 'Access denied: you cannot settle coins for this delivery.' using errcode = '42501';
  end if;

  v_actor := coalesce(p_created_by, v_delivery_actor, auth.uid(), v_retailer_id);

  if p_reverse then
    update public.retailer_wallet_ledger
       set is_reversed = true,
           reversed_at = now(),
           reversed_by = v_actor
     where transaction_type = 'REFUND_CREDIT'
       and reference_type = 'delivery'
       and reference_id = p_delivery_id
       and retailer_id = v_retailer_id
       and is_reversed = false
    returning * into v_existing;

    if not found then
      return 0;
    end if;
    return v_existing.amount_paise;
  end if;

  if p_amount_paise is null or p_amount_paise <= 0 then
    return 0;
  end if;

  if p_amount_paise > v_grand_total_paise then
    raise exception 'A shortfall credit (%) cannot exceed the order total (%).',
      p_amount_paise, v_grand_total_paise using errcode = '22023';
  end if;

  select id into v_account_id
  from public.retailer_credit_accounts
  where retailer_id = v_retailer_id;

  insert into public.retailer_wallet_ledger (
    retailer_id, account_id, transaction_type, amount_paise, direction,
    reference_type, reference_id, description, reason, created_by, notes,
    idempotency_key, metadata
  ) values (
    v_retailer_id, v_account_id, 'REFUND_CREDIT', p_amount_paise, 'credit',
    'delivery', p_delivery_id,
    format('Delivery shortfall — %s', coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'missing or damaged goods')),
    coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'Delivery shortfall'),
    v_actor,
    format('Delivery %s shortfall credit', p_delivery_id),
    'delivery-shortfall:' || p_delivery_id::text,
    jsonb_build_object('delivery_id', p_delivery_id, 'order_id', v_order_id)
  )
  on conflict (idempotency_key) do nothing
  returning id into v_ledger_id;

  if v_ledger_id is null then
    return 0;
  end if;

  return p_amount_paise;
end;
$$;

comment on function public.order_shortfall_coins(uuid, bigint, text, uuid, boolean) is
  '🪙 Missing/damaged delivery settlement: one bounded, idempotent REFUND_CREDIT per delivery (delivery-shortfall:<id>), reversible exactly once. Callable by the delivery team (staff/admin or the assigned member).';

revoke all on function public.order_shortfall_coins(uuid, bigint, text, uuid, boolean) from public;
revoke all on function public.order_shortfall_coins(uuid, bigint, text, uuid, boolean) from anon;
grant execute on function public.order_shortfall_coins(uuid, bigint, text, uuid, boolean) to authenticated;
grant execute on function public.order_shortfall_coins(uuid, bigint, text, uuid, boolean) to service_role;
