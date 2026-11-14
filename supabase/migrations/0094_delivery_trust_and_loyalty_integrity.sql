-- ============================================================================
-- 0094: delivery trust boundary, shortfall-credit integrity, loyalty accrual on
--       delivered value, and API-role privilege hygiene.
--
-- REVIEW ONLY. NOT APPLIED TO PRODUCTION. See
-- docs/readiness-2026-11-14/04_MIGRATIONS.md for the review, dependency,
-- rollback and application checklist.
--
-- Findings closed (docs/readiness-2026-11-14/02_SECURITY_AUDIT.md):
--   SEC-01  Delivery OTP was enforced only in the Next.js server action. The
--           assigned staff member's own session could UPDATE
--           order_deliveries (delivery_status, otp_hash, otp_attempts,
--           otp_verified_at, assigned_staff_id) and orders.status through the
--           Data API, completing a delivery with no OTP.
--   SEC-02  record_loyalty_points() (0080, restated by 0093) authorised callers
--           with `current_user is distinct from 'postgres'`. Inside a
--           SECURITY DEFINER function current_user IS the owner (postgres),
--           so the Admin check never ran: any authenticated account could
--           credit or debit loyalty points for any retailer.
--   SEC-03  order_shortfall_coins() trusted a caller-supplied amount: any
--           staff session could credit up to a whole order total to a
--           retailer wallet for a delivery with no recorded shortfall, and
--           could reverse a legitimate credit at any time.
--   SEC-04  trg_order_delivered_loyalty() (0093) awarded points on the full
--           grand_total even when part of the order was missing/damaged and
--           had been credited back.
--   SEC-07  anon/authenticated held TRUNCATE, REFERENCES and TRIGGER on
--           public tables (Supabase defaults). RLS does not govern TRUNCATE.
--
-- Depends on: 0043 (order_deliveries, order_delivery_items), 0052
-- (is_admin_or_above), 0053 (order_shortfall_coins, wallet idempotency key),
-- 0080/0093 (loyalty_ledger, trg_order_delivered_loyalty).
--
-- Deployment coupling: the application release in the same pull request
-- performs OTP regeneration, assignment and delivery completion through the
-- service-role client AFTER its own permission and OTP checks. Apply this
-- migration together with that release. The old release keeps working for
-- Admin/Super Admin sessions only; staff completion through the old release
-- is rejected by the guards below (fails closed).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Who is an untrusted direct caller?
--    SECURITY INVOKER on purpose: inside a trigger fired by a direct Data API
--    write, current_user is the API role. Inside SECURITY DEFINER RPCs (owner
--    postgres) and for the service-role key it is not, so reviewed server
--    paths are unaffected.
-- ----------------------------------------------------------------------------
create or replace function public.is_untrusted_api_caller()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select current_user in ('anon', 'authenticated')
     and not coalesce(public.is_admin_or_above(), false)
$$;
revoke all on function public.is_untrusted_api_caller() from public;
grant execute on function public.is_untrusted_api_caller() to anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. order_deliveries: OTP, assignment, proof and completion fields may only
--    be written by a trusted path (Admin/Super Admin session, service role,
--    or a SECURITY DEFINER function).
-- ----------------------------------------------------------------------------
create or replace function public.guard_order_delivery_trusted_fields()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not public.is_untrusted_api_caller() then
    return new;
  end if;

  if new.order_id is distinct from old.order_id
     or new.sub_order_id is distinct from old.sub_order_id then
    raise exception 'DELIVERY_GUARD: a delivery cannot be moved to another order.' using errcode = '42501';
  end if;

  if new.assigned_staff_id is distinct from old.assigned_staff_id
     or new.assigned_by is distinct from old.assigned_by
     or new.assigned_at is distinct from old.assigned_at then
    raise exception 'DELIVERY_GUARD: delivery assignment is changed only through the dispatch desk.' using errcode = '42501';
  end if;

  if new.otp_hash is distinct from old.otp_hash
     or new.otp_verified_at is distinct from old.otp_verified_at then
    raise exception 'DELIVERY_GUARD: delivery OTP fields are server-managed.' using errcode = '42501';
  end if;

  -- A wrong attempt may be counted (+1). The counter can never be lowered or
  -- skipped by the person being rate-limited.
  if new.otp_attempts is distinct from old.otp_attempts
     and new.otp_attempts <> old.otp_attempts + 1 then
    raise exception 'DELIVERY_GUARD: OTP attempts can only be counted upward one at a time.' using errcode = '42501';
  end if;

  if new.delivery_status is distinct from old.delivery_status
     and new.delivery_status in ('delivered', 'partially_delivered', 'assigned') then
    raise exception 'DELIVERY_GUARD: completion and re-dispatch require server-side OTP verification.' using errcode = '42501';
  end if;

  if new.delivered_at is distinct from old.delivered_at
     or new.completed_by is distinct from old.completed_by
     or new.receiver_name is distinct from old.receiver_name
     or new.signature_url is distinct from old.signature_url
     or new.photo_url is distinct from old.photo_url
     or new.return_window_days is distinct from old.return_window_days
     or new.return_deadline is distinct from old.return_deadline then
    raise exception 'DELIVERY_GUARD: delivery proof and completion fields are server-managed.' using errcode = '42501';
  end if;

  return new;
end;
$$;
revoke all on function public.guard_order_delivery_trusted_fields() from public, anon, authenticated;

drop trigger if exists trg_guard_order_delivery_trusted_fields on public.order_deliveries;
create trigger trg_guard_order_delivery_trusted_fields
  before update on public.order_deliveries
  for each row execute function public.guard_order_delivery_trusted_fields();

-- Recorded quantities drive the shortfall credit and loyalty accrual, so they
-- are frozen for untrusted callers once the delivery is no longer open.
create or replace function public.guard_order_delivery_items_after_completion()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_delivery_id uuid := coalesce(new.delivery_id, old.delivery_id);
  v_status text;
begin
  if not public.is_untrusted_api_caller() then
    return coalesce(new, old);
  end if;
  select delivery_status into v_status from public.order_deliveries where id = v_delivery_id;
  if v_status is not null and v_status not in ('assigned', 'in_progress', 'failed') then
    raise exception 'DELIVERY_GUARD: delivered quantities are locked after completion.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function public.guard_order_delivery_items_after_completion() from public, anon, authenticated;

drop trigger if exists trg_guard_order_delivery_items_after_completion on public.order_delivery_items;
create trigger trg_guard_order_delivery_items_after_completion
  before insert or update or delete on public.order_delivery_items
  for each row execute function public.guard_order_delivery_items_after_completion();

-- ----------------------------------------------------------------------------
-- 3. orders: an untrusted session cannot mark an order delivered. The status
--    change fires stock, settlement and loyalty side effects and must follow
--    OTP verification (or an explicit Admin decision, which is audited by
--    trg_audit_orders / order_status_history).
-- ----------------------------------------------------------------------------
create or replace function public.guard_order_delivered_transition()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status = 'delivered'
     and old.status is distinct from new.status
     and public.is_untrusted_api_caller() then
    raise exception 'ORDER_GUARD: an order is marked delivered only after server-side delivery verification.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_order_delivered_transition() from public, anon, authenticated;

drop trigger if exists trg_guard_order_delivered_transition on public.orders;
create trigger trg_guard_order_delivered_transition
  before update of status on public.orders
  for each row execute function public.guard_order_delivered_transition();

-- ----------------------------------------------------------------------------
-- 4. Shortfall value is derived from the recorded delivery lines, never from
--    a caller parameter. Per line (same formula as lib/delivery/settlement.ts):
--      share = min(line, round_half_up(line * (missing + damaged) / ordered))
--    order_items.line_total is rupees numeric(12,2); the ledger is in paise.
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
        (round(oi.line_total * 100) * (di.quantity_missing + di.quantity_damaged))::numeric
        / di.quantity_ordered + 0.5
      )::bigint
    )
  ), 0)::bigint
  from public.order_delivery_items di
  join public.order_items oi on oi.id = di.order_item_id
  where di.delivery_id = p_delivery_id
    and di.quantity_ordered > 0
    and (di.quantity_missing + di.quantity_damaged) > 0
    and oi.line_total > 0
$$;
revoke all on function public.delivery_shortfall_paise(uuid) from public, anon, authenticated;
grant execute on function public.delivery_shortfall_paise(uuid) to service_role;

-- Same signature as 0053 so existing grants and callers keep working.
-- p_amount_paise is retained for compatibility and IGNORED.
create or replace function public.order_shortfall_coins(
  p_delivery_id uuid,
  p_amount_paise bigint default 0,
  p_reason text default null,
  p_created_by uuid default null,
  p_reverse boolean default false
) returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_id uuid;
  v_retailer_id uuid;
  v_grand_total_paise bigint;
  v_delivery_actor uuid;
  v_delivery_status text;
  v_account_id uuid;
  v_ledger_id uuid;
  v_existing public.retailer_wallet_ledger%rowtype;
  v_actor uuid;
  v_amount bigint;
begin
  -- Row lock: serialises a completion credit against a return reversal.
  select d.order_id, d.delivery_status, coalesce(d.completed_by, d.assigned_staff_id)
    into v_order_id, v_delivery_status, v_delivery_actor
  from public.order_deliveries d
  where d.id = p_delivery_id
  for update;

  if v_order_id is null then
    raise exception 'Delivery % was not found.', p_delivery_id using errcode = 'P0002';
  end if;

  select o.retailer_id, round(o.grand_total * 100)::bigint
    into v_retailer_id, v_grand_total_paise
  from public.orders o where o.id = v_order_id;

  if auth.uid() is not null
     and not public.is_staff_or_above()
     and auth.uid() is distinct from v_delivery_actor then
    raise exception 'Access denied: you cannot settle coins for this delivery.' using errcode = '42501';
  end if;

  -- The actor is the authenticated caller when there is one; a caller cannot
  -- attribute the entry to somebody else.
  v_actor := coalesce(auth.uid(), p_created_by, v_delivery_actor, v_retailer_id);

  if p_reverse then
    if v_delivery_status <> 'returned_to_warehouse' and not public.is_admin_or_above()
       and coalesce(auth.role(), '') <> 'service_role' then
      raise exception 'A shortfall credit is reversed only after the delivery is returned to the warehouse.' using errcode = '22023';
    end if;
    update public.retailer_wallet_ledger
       set is_reversed = true, reversed_at = now(), reversed_by = v_actor
     where transaction_type = 'REFUND_CREDIT'
       and reference_type = 'delivery'
       and reference_id = p_delivery_id
       and retailer_id = v_retailer_id
       and is_reversed = false
    returning * into v_existing;
    if not found then return 0; end if;
    return v_existing.amount_paise;
  end if;

  if v_delivery_status not in ('delivered', 'partially_delivered') then
    raise exception 'A shortfall credit requires a completed delivery.' using errcode = '22023';
  end if;

  v_amount := least(public.delivery_shortfall_paise(p_delivery_id), v_grand_total_paise);
  if v_amount is null or v_amount <= 0 then
    return 0;
  end if;

  select id into v_account_id
  from public.retailer_credit_accounts
  where retailer_id = v_retailer_id;

  insert into public.retailer_wallet_ledger (
    retailer_id, account_id, transaction_type, amount_paise, direction,
    reference_type, reference_id, description, reason, created_by, notes,
    idempotency_key, metadata
  ) values (
    v_retailer_id, v_account_id, 'REFUND_CREDIT', v_amount, 'credit',
    'delivery', p_delivery_id,
    format('Delivery shortfall — %s', coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'missing or damaged goods')),
    coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'Delivery shortfall'),
    v_actor,
    format('Delivery %s shortfall credit', p_delivery_id),
    'delivery-shortfall:' || p_delivery_id::text,
    jsonb_build_object('delivery_id', p_delivery_id, 'order_id', v_order_id,
                       'computed_from', 'order_delivery_items')
  )
  on conflict (idempotency_key) do nothing
  returning id into v_ledger_id;

  if v_ledger_id is null then
    return 0;
  end if;
  return v_amount;
end;
$$;
revoke all on function public.order_shortfall_coins(uuid, bigint, text, uuid, boolean) from public, anon;
grant execute on function public.order_shortfall_coins(uuid, bigint, text, uuid, boolean) to authenticated, service_role;

comment on function public.order_shortfall_coins(uuid, bigint, text, uuid, boolean) is
  '0094: credits the delivery shortfall computed from order_delivery_items. p_amount_paise is ignored. One idempotent credit per delivery.';

-- ----------------------------------------------------------------------------
-- 5. Loyalty: points accrue on the value actually delivered.
--    eligible = grand_total - recorded shortfall of this order's completed
--    delivery. Idempotency key and ORDER_REVERSAL behaviour are unchanged
--    from 0093, so existing ORDER_EARN / ORDER_REVERSAL rows stay valid.
-- ----------------------------------------------------------------------------
create or replace function public.trg_order_delivered_loyalty()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_multiplier numeric(4, 2) := 1.0;
  v_shortfall_paise bigint := 0;
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

    select coalesce(sum(public.delivery_shortfall_paise(d.id)), 0)::bigint
      into v_shortfall_paise
      from public.order_deliveries d
     where d.order_id = new.id
       and d.delivery_status in ('delivered', 'partially_delivered');

    v_qualifying_rupees := greatest(coalesce(new.grand_total, 0) - (v_shortfall_paise / 100.0), 0);
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
     where reference_type = 'order' and reference_id = new.id and entry_type = 'ORDER_EARN'
     order by created_at asc
     limit 1;
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
-- A trigger function needs no EXECUTE grant for API roles (0093 granted one).
revoke all on function public.trg_order_delivered_loyalty() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5b. record_loyalty_points(): real authorisation. Only the service-role key
--     or an Admin/Super Admin session may write a manual entry. ORDER_EARN
--     stays trigger-only (0093). Signature unchanged.
-- ----------------------------------------------------------------------------
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
  -- Do NOT test current_user here: in a SECURITY DEFINER function it is the
  -- function owner for every caller.
  if coalesce(auth.role(), '') <> 'service_role'
     and not coalesce(public.is_admin_or_above(), false) then
    raise exception 'Access denied: Super Admin or Admin authorization required to write loyalty points.' using errcode = '42501';
  end if;
  if p_entry_type = 'ORDER_EARN' then
    raise exception 'Order-earned points are created only by the verified order-delivery trigger.' using errcode = '42501';
  end if;
  if p_points is null or p_points = 0 then
    raise exception 'Points cannot be zero.' using errcode = '22023';
  end if;
  if p_retailer_id is null or p_entry_type is null or p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'Retailer, entry type and reason are required.' using errcode = '22023';
  end if;
  -- Retailer row lock first: serialises concurrent writers so the idempotency
  -- lookup and the balance check below see a stable ledger.
  perform 1 from public.retailers where id = p_retailer_id for update;
  if not found then raise exception 'Retailer not found.' using errcode = 'P0002'; end if;
  if p_idempotency_key is not null then
    select id into v_entry_id from public.loyalty_ledger where idempotency_key = p_idempotency_key;
    if v_entry_id is not null then return v_entry_id; end if;
  end if;
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
grant execute on function public.record_loyalty_points(uuid, integer, text, text, text, uuid, text) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6. Privilege hygiene. The Data API never needs TRUNCATE / REFERENCES /
--    TRIGGER, and RLS does not restrict TRUNCATE.
-- ----------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select c.oid::regclass as tbl
      from pg_class c
     where c.relnamespace = 'public'::regnamespace
       and c.relkind in ('r', 'p', 'v', 'm')
  loop
    execute format('revoke truncate, references, trigger on table %s from anon, authenticated', r.tbl);
  end loop;
end;
$$;
alter default privileges in schema public revoke truncate, references, trigger on tables from anon, authenticated;
