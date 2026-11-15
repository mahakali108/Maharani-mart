-- ============================================================================
-- ROLLBACK for 0094_delivery_trust_and_loyalty_integrity.sql
-- REVIEW ONLY, NOT APPLIED ANYWHERE.
--
-- WARNING: this rollback RE-OPENS security findings SEC-01..SEC-04 and SEC-07:
--   * record_loyalty_points() returns to the 0093 body whose Admin check never
--     runs (any signed-in account can write loyalty points);
--   * order_shortfall_coins() trusts the caller-supplied amount again;
--   * delivery OTP / assignment / proof fields become writable by staff
--     sessions through the Data API again;
--   * loyalty accrues on the full order total for partial deliveries.
-- Use it only to recover from a functional regression, and re-apply a fixed
-- forward migration as soon as possible. Ledger rows written while 0094 was
-- live are NOT altered (points and credits already issued stay as recorded).
--
-- Not restored: TRUNCATE / REFERENCES / TRIGGER table grants to anon and
-- authenticated. Nothing in the application uses them, and re-granting them
-- would only widen exposure.
-- ============================================================================
begin;

drop trigger if exists trg_guard_order_delivered_transition on public.orders;
drop trigger if exists trg_guard_order_delivery_items_after_completion on public.order_delivery_items;
drop trigger if exists trg_guard_order_delivery_trusted_fields on public.order_deliveries;
drop function if exists public.guard_order_delivered_transition();
drop function if exists public.guard_order_delivery_items_after_completion();
drop function if exists public.guard_order_delivery_trusted_fields();

-- order_shortfall_coins: body exactly as in 0053.
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

revoke all on function public.order_shortfall_coins(uuid, bigint, text, uuid, boolean) from public;
revoke all on function public.order_shortfall_coins(uuid, bigint, text, uuid, boolean) from anon;
grant execute on function public.order_shortfall_coins(uuid, bigint, text, uuid, boolean) to authenticated;
grant execute on function public.order_shortfall_coins(uuid, bigint, text, uuid, boolean) to service_role;

drop function if exists public.delivery_shortfall_paise(uuid);

-- record_loyalty_points and trg_order_delivered_loyalty: bodies exactly as in 0093.
create or replace function public.record_loyalty_points(
  p_retailer_id uuid,
  p_points integer,
  p_entry_type text,
  p_reason text,
  p_reference_type text default null,
  p_reference_id uuid default null,
  p_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entry_id uuid;
  v_current_balance integer;
begin
  if p_entry_type = 'ORDER_EARN' then
    raise exception 'Order-earned points are created only by the verified order-delivery trigger.' using errcode = '42501';
  end if;

  if auth.role() is distinct from 'service_role'
     and current_user is distinct from 'postgres'
     and not public.is_admin_or_above() then
    raise exception 'Access denied: Super Admin or Admin authorization required to write loyalty points.' using errcode = '42501';
  end if;
  if p_points = 0 then
    raise exception 'Points cannot be zero.' using errcode = '22023';
  end if;
  if p_retailer_id is null or p_entry_type is null or p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'Retailer, entry type and reason are required.' using errcode = '22023';
  end if;
  if p_idempotency_key is not null then
    select id into v_entry_id from public.loyalty_ledger where idempotency_key = p_idempotency_key;
    if v_entry_id is not null then return v_entry_id; end if;
  end if;
  perform 1 from public.retailers where id = p_retailer_id for update;
  if not found then raise exception 'Retailer not found.' using errcode = 'P0002'; end if;
  if p_points < 0 then
    select coalesce(sum(points), 0)::integer into v_current_balance
      from public.loyalty_ledger where retailer_id = p_retailer_id;
    if v_current_balance + p_points < 0 then
      raise exception 'INSUFFICIENT_LOYALTY_POINTS: Balance (%) cannot cover deduction (%).',
        v_current_balance, abs(p_points) using errcode = '22023';
    end if;
  end if;
  insert into public.loyalty_ledger (
    retailer_id, points, entry_type, reason, reference_type, reference_id,
    idempotency_key, created_by
  ) values (
    p_retailer_id, p_points, p_entry_type, p_reason, p_reference_type,
    p_reference_id, p_idempotency_key, auth.uid()
  ) returning id into v_entry_id;
  return v_entry_id;
end;
$$;
revoke all on function public.record_loyalty_points(uuid, integer, text, text, text, uuid, text) from public, anon;
grant execute on function public.record_loyalty_points(uuid, integer, text, text, text, uuid, text) to authenticated;

create or replace function public.trg_order_delivered_loyalty()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_multiplier numeric(4, 2) := 1.0;
  v_qualifying_rupees numeric;
  v_points integer;
  v_idempotency_key text;
begin
  if new.status = 'delivered' and old.status is distinct from 'delivered' then
    select coalesce(mp.points_multiplier, 1.0) into v_multiplier
      from public.retailer_memberships rm
      join public.membership_plans mp on mp.id = rm.plan_id
     where rm.retailer_id = new.retailer_id and rm.status = 'active'
       and (rm.expires_at is null or rm.expires_at > now())
     order by case rm.tier when 'gold' then 3 when 'silver' then 2 else 1 end desc
     limit 1;
    v_qualifying_rupees := coalesce(new.grand_total, 0);
    if v_qualifying_rupees >= 100 then
      v_points := floor(floor(v_qualifying_rupees / 100) * coalesce(v_multiplier, 1.0));
      if v_points > 0 then
        v_idempotency_key := 'loyalty:earn:' || new.id::text;
        insert into public.loyalty_ledger (
          retailer_id, points, entry_type, reason, reference_type,
          reference_id, idempotency_key, created_by
        ) values (
          new.retailer_id, v_points, 'ORDER_EARN',
          'Delivered Order #' || coalesce(new.order_number, new.id::text) || ' loyalty award',
          'order', new.id, v_idempotency_key, auth.uid()
        ) on conflict (idempotency_key) do nothing;
      end if;
    end if;
  end if;

  if new.status = 'returned' and old.status = 'delivered' then
    v_idempotency_key := 'loyalty:reversal:' || new.id::text;
    select points into v_points from public.loyalty_ledger
     where reference_type = 'order' and reference_id = new.id and entry_type = 'ORDER_EARN';
    if found and v_points > 0 then
      insert into public.loyalty_ledger (
        retailer_id, points, entry_type, reason, reference_type,
        reference_id, idempotency_key, created_by
      ) values (
        new.retailer_id, -v_points, 'ORDER_REVERSAL',
        'Returned Order #' || coalesce(new.order_number, new.id::text) || ' point reversal',
        'order', new.id, v_idempotency_key, auth.uid()
      ) on conflict (idempotency_key) do nothing;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.trg_order_delivered_loyalty() from public, anon;
grant execute on function public.trg_order_delivered_loyalty() to authenticated, service_role;

drop function if exists public.is_untrusted_api_caller();

commit;
