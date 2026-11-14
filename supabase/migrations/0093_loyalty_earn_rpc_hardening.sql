-- 0093: close caller-controlled loyalty accrual and legacy OTP hash bypass.
-- Reviewable migration only; do not apply to production until independently tested.

-- ORDER_EARN must be emitted only by the trusted order-status trigger, never
-- by an authenticated caller supplying an arbitrary retailer/amount/reference.
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

-- The SECURITY DEFINER trigger writes ORDER_EARN/ORDER_REVERSAL rows itself.
-- This avoids exposing a privileged RPC that accepts caller-chosen ORDER_EARN.
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
