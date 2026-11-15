-- ============================================================================
-- 0099 — Atomic delivery completion (SEC-10 for the delivery workflow)
--
-- REVIEW-ONLY. Do not apply to production without the owner's approval.
-- Requires 0094 (trust guards, shortfall credit, loyalty on delivered value)
-- and 0096 (snapshot integrity). Rollback: supabase/rollbacks/0099_….down.sql
--
-- Before this migration the server action completed a delivery with separate
-- writes: line quantities, the delivery row, the order status, the wallet
-- shortfall credit and (by trigger) loyalty. A failure in the middle left a
-- half-completed delivery.
--
-- complete_delivery_atomic() does all of it in ONE transaction:
--   lock order -> delivery lines -> delivery row (the same line -> delivery
--   order the 0096 snapshot guard uses, so the two cannot deadlock), verify the
--   actor, verify the OTP digest, validate every line against the original
--   order line, write quantities + completion + order status, credit the
--   shortfall, reconcile loyalty, record the idempotency result.
--
-- OTP: the 6-digit code never reaches the database. The server computes the
-- keyed HMAC digest (lib/delivery/otp.ts) and passes only that; it is compared
-- with order_deliveries.otp_hash. A wrong digest counts one attempt under the
-- row lock and RETURNS (so the count commits); every other refusal RAISES (so
-- nothing is written).
--
-- Execution: service_role only, and the function re-checks auth.role(). It
-- does not trust the caller's claim about who is acting: p_actor_id must be an
-- active profile whose role may execute deliveries and who is the assignee or
-- an Admin / Super Admin.
--
-- Idempotent: safe to re-run. No table is dropped, no row is deleted.
-- ============================================================================

do $$
begin
  if to_regprocedure('public.delivery_shortfall_paise(uuid)') is null
     or to_regprocedure('public.guard_order_delivery_completion_lines()') is null then
    raise exception 'MIGRATION ORDER VIOLATION: 0099 requires 0094 and 0096.' using errcode = 'undefined_function';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 1. Idempotency record: one row per completed request. Server-only.
-- ----------------------------------------------------------------------------
create table if not exists public.delivery_completion_requests (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.order_deliveries(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  idempotency_key text not null,
  actor_id uuid not null references public.profiles(id),
  delivered_at timestamptz not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  constraint delivery_completion_requests_key_len check (char_length(idempotency_key) between 16 and 200),
  constraint delivery_completion_requests_unique unique (delivery_id, idempotency_key)
);

comment on table public.delivery_completion_requests is
  '0099: result of each completed delivery request, keyed by an idempotency key, so a retry after a lost response returns the first result instead of settling again. No API role can read or write it.';

alter table public.delivery_completion_requests enable row level security;
revoke all on table public.delivery_completion_requests from public, anon, authenticated;
grant select on table public.delivery_completion_requests to service_role;

-- Explicit deny for every browser session. With RLS on and no policy the table
-- is already unreadable; the named policy makes that a stated decision rather
-- than an omission (the repository's RLS-coverage check requires one).
drop policy if exists delivery_completion_requests_no_client_access on public.delivery_completion_requests;
create policy delivery_completion_requests_no_client_access
  on public.delivery_completion_requests
  as restrictive for all to anon, authenticated
  using (false) with check (false);

-- ----------------------------------------------------------------------------
-- 2. Loyalty points an order should hold NOW, from the value actually
--    delivered. Same arithmetic as trg_order_delivered_loyalty (0094).
-- ----------------------------------------------------------------------------
create or replace function public._order_loyalty_points_due(p_order_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_retailer uuid;
  v_grand_total numeric;
  v_multiplier numeric(4, 2) := 1.0;
  v_shortfall_paise bigint := 0;
  v_qualifying numeric;
begin
  select o.retailer_id, coalesce(o.grand_total, 0) into v_retailer, v_grand_total
    from public.orders o where o.id = p_order_id;
  if not found then return 0; end if;

  select coalesce(mp.points_multiplier, 1.0) into v_multiplier
    from public.retailer_memberships rm
    join public.membership_plans mp on mp.id = rm.plan_id
   where rm.retailer_id = v_retailer and rm.status = 'active'
     and (rm.expires_at is null or rm.expires_at > now())
   order by case rm.tier when 'gold' then 3 when 'silver' then 2 else 1 end desc
   limit 1;

  select coalesce(sum(public.delivery_shortfall_paise(d.id)), 0)::bigint into v_shortfall_paise
    from public.order_deliveries d
   where d.order_id = p_order_id
     and d.delivery_status in ('delivered', 'partially_delivered');

  v_qualifying := greatest(v_grand_total - (v_shortfall_paise / 100.0), 0);
  if v_qualifying < 100 then return 0; end if;
  return greatest(floor(floor(v_qualifying / 100) * coalesce(v_multiplier, 1.0))::integer, 0);
end;
$$;
revoke all on function public._order_loyalty_points_due(uuid) from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. Loyalty trigger: unchanged award; the RETURN reversal now reverses the
--    order's NET points (award minus any shortfall adjustment written by the
--    completion below) instead of the original award, so a returned order can
--    never go below zero.
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
    select coalesce(sum(points), 0)::integer into v_points from public.loyalty_ledger
     where reference_type = 'order' and reference_id = new.id
       and entry_type in ('ORDER_EARN', 'ORDER_REVERSAL');
    if v_points > 0 then
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
revoke all on function public.trg_order_delivered_loyalty() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. The completion transaction.
--
-- Returns jsonb:
--   { status: 'completed', replayed, delivery_id, order_id, order_number,
--     retailer_id, delivery_status, fully_delivered, shortfall_pieces,
--     credit_back_paise, return_window_days, return_deadline, delivered_at }
--   { status: 'otp_incorrect', attempts_remaining }      (attempt counted)
-- Raises 'DELIVERY_COMPLETE:<CODE>: text' for every other refusal.
-- ----------------------------------------------------------------------------
create or replace function public.complete_delivery_atomic(
  p_order_id uuid,
  p_actor_id uuid,
  p_otp_digest text,
  p_idempotency_key text,
  p_receiver_name text,
  p_notes text,
  p_signature_ref text,
  p_photo_ref text,
  p_items jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c_max_attempts constant integer := 10;
  v_order public.orders%rowtype;
  v_delivery public.order_deliveries%rowtype;
  v_delivery_id uuid;
  v_actor_role text;
  v_actor_active boolean;
  v_receiver text := btrim(coalesce(p_receiver_name, ''));
  v_notes text := btrim(coalesce(p_notes, ''));
  v_signature text := nullif(btrim(coalesce(p_signature_ref, '')), '');
  v_photo text := nullif(btrim(coalesce(p_photo_ref, '')), '');
  v_ref text;
  v_prefix text;
  v_previous_sub text := current_setting('request.jwt.claim.sub', true);
  v_request public.delivery_completion_requests%rowtype;
  v_submitted integer;
  v_submitted_distinct integer;
  v_snapshot integer;
  v_expected integer;
  v_bad integer;
  v_shortfall_pieces integer;
  v_final_status text;
  v_window integer := 7;
  v_setting jsonb;
  v_now timestamptz := clock_timestamp();
  v_deadline date;
  v_credit bigint := 0;
  v_points_due integer;
  v_points_held integer;
  v_result jsonb;
begin
  -- Only the server's trusted role. An Admin's browser session cannot call it.
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'DELIVERY_COMPLETE:FORBIDDEN: delivery completion runs only on the server.' using errcode = '42501';
  end if;

  -- ---- Shape of the request (no database state needed) --------------------
  if p_order_id is null or p_actor_id is null then
    raise exception 'DELIVERY_COMPLETE:INVALID_INPUT: order and actor are required.' using errcode = '22023';
  end if;
  if p_otp_digest is null or p_otp_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'DELIVERY_COMPLETE:INVALID_INPUT: the OTP digest is malformed.' using errcode = '22023';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 16 and 200 then
    raise exception 'DELIVERY_COMPLETE:INVALID_INPUT: an idempotency key is required.' using errcode = '22023';
  end if;
  if char_length(v_receiver) not between 2 and 120 then
    raise exception 'DELIVERY_COMPLETE:RECEIVER: receiver name must be 2-120 characters.' using errcode = '22023';
  end if;
  if char_length(v_notes) > 1000 then
    raise exception 'DELIVERY_COMPLETE:NOTES: delivery notes must be 1000 characters or fewer.' using errcode = '22023';
  end if;
  -- A proof must sit inside THIS order's folder of the private bucket.
  v_prefix := 'deliveries/' || p_order_id::text || '/';
  foreach v_ref in array array[v_signature, v_photo] loop
    if v_ref is not null and (
         left(v_ref, char_length(v_prefix)) <> v_prefix
         or char_length(v_ref) <= char_length(v_prefix)
         or char_length(v_ref) > 300
         or position('..' in v_ref) > 0
         or position('://' in v_ref) > 0
         or position(chr(92) in v_ref) > 0
       ) then
      raise exception 'DELIVERY_COMPLETE:PROOF: proof files must belong to this order.' using errcode = '22023';
    end if;
  end loop;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0
     or jsonb_array_length(p_items) > 1000 then
    raise exception 'DELIVERY_COMPLETE:LINES_REQUIRED: quantities for every order line are required.' using errcode = '22023';
  end if;
  select count(*) into v_bad
    from jsonb_array_elements(p_items) e
   where jsonb_typeof(e) <> 'object'
      or coalesce(e ->> 'order_item_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(e -> 'delivered') is distinct from 'number'
      or jsonb_typeof(e -> 'missing') is distinct from 'number'
      or jsonb_typeof(e -> 'damaged') is distinct from 'number';
  if v_bad > 0 then
    raise exception 'DELIVERY_COMPLETE:QUANTITY: quantities must be whole numbers of 0 or more.' using errcode = '22023';
  end if;
  select count(*) into v_bad
    from jsonb_array_elements(p_items) e,
         lateral (values ((e ->> 'delivered')::numeric), ((e ->> 'missing')::numeric), ((e ->> 'damaged')::numeric)) q(n)
   where q.n < 0 or q.n > 100000000 or q.n <> trunc(q.n);
  if v_bad > 0 then
    raise exception 'DELIVERY_COMPLETE:QUANTITY: quantities must be whole numbers of 0 or more.' using errcode = '22023';
  end if;

  -- ---- Locks: order -> lines -> delivery ----------------------------------
  select * into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'DELIVERY_COMPLETE:NOT_FOUND: order not found.' using errcode = 'P0002';
  end if;
  select d.id into v_delivery_id from public.order_deliveries d where d.order_id = p_order_id;
  if v_delivery_id is null then
    raise exception 'DELIVERY_COMPLETE:NO_DELIVERY: no delivery task exists for this order.' using errcode = 'P0002';
  end if;
  perform 1 from public.order_delivery_items di where di.delivery_id = v_delivery_id order by di.id for update;
  select * into v_delivery from public.order_deliveries d where d.id = v_delivery_id for update;

  -- ---- Actor ---------------------------------------------------------------
  select p.role::text, coalesce(p.is_active, false) into v_actor_role, v_actor_active
    from public.profiles p where p.id = p_actor_id;
  if not found or not v_actor_active
     or v_actor_role not in ('super_admin', 'admin', 'staff', 'salesman') then
    raise exception 'DELIVERY_COMPLETE:NO_PERMISSION: this account cannot execute deliveries.' using errcode = '42501';
  end if;
  if v_delivery.assigned_staff_id is distinct from p_actor_id
     and v_actor_role not in ('super_admin', 'admin') then
    raise exception 'DELIVERY_COMPLETE:NOT_ASSIGNED: only the assigned delivery person can complete this delivery.' using errcode = '42501';
  end if;

  -- ---- Retry of a request that already succeeded --------------------------
  if v_delivery.delivery_status in ('delivered', 'partially_delivered') then
    select * into v_request from public.delivery_completion_requests r
     where r.delivery_id = v_delivery.id and r.idempotency_key = p_idempotency_key;
    if found
       and v_request.actor_id = p_actor_id
       and v_request.delivered_at is not distinct from v_delivery.delivered_at
       and v_delivery.otp_hash is not null and v_delivery.otp_hash = p_otp_digest then
      return v_request.result || jsonb_build_object('replayed', true);
    end if;
    raise exception 'DELIVERY_COMPLETE:ALREADY_COMPLETED: this delivery was already completed.' using errcode = '55000';
  end if;

  -- ---- State ---------------------------------------------------------------
  if v_delivery.delivery_status not in ('assigned', 'in_progress') then
    raise exception 'DELIVERY_COMPLETE:NOT_OPEN: this delivery is not open.' using errcode = '55000';
  end if;
  if v_order.status::text not in ('dispatched', 'delivered') then
    raise exception 'DELIVERY_COMPLETE:ORDER_STATE:%', v_order.status::text using errcode = '55000';
  end if;
  if v_delivery.otp_hash is null or v_delivery.otp_hash = '' then
    raise exception 'DELIVERY_COMPLETE:NO_OTP: this delivery has no OTP.' using errcode = '55000';
  end if;
  if v_delivery.otp_attempts >= c_max_attempts then
    raise exception 'DELIVERY_COMPLETE:OTP_LOCKED: too many wrong OTP attempts.' using errcode = '55000';
  end if;

  -- From here on, rows are written. Audit triggers read auth.uid(); attribute
  -- them to the verified actor for the rest of this transaction only.
  perform set_config('request.jwt.claim.sub', p_actor_id::text, true);

  -- ---- OTP: the delivery row is locked, so attempts cannot be raced --------
  if v_delivery.otp_hash <> p_otp_digest then
    update public.order_deliveries
       set otp_attempts = otp_attempts + 1
     where id = v_delivery.id;
    perform set_config('request.jwt.claim.sub', coalesce(v_previous_sub, ''), true);
    return jsonb_build_object(
      'status', 'otp_incorrect',
      'attempts_remaining', greatest(c_max_attempts - (v_delivery.otp_attempts + 1), 0)
    );
  end if;

  -- ---- Lines: submission vs snapshot vs original order lines ---------------
  create temporary table if not exists _delivery_completion_lines (
    order_item_id uuid, delivered integer, missing integer, damaged integer
  ) on commit drop;
  delete from _delivery_completion_lines;
  insert into _delivery_completion_lines (order_item_id, delivered, missing, damaged)
  select (e ->> 'order_item_id')::uuid, (e ->> 'delivered')::integer,
         (e ->> 'missing')::integer, (e ->> 'damaged')::integer
    from jsonb_array_elements(p_items) e;

  select count(*), count(distinct order_item_id) into v_submitted, v_submitted_distinct
    from _delivery_completion_lines;
  if v_submitted <> v_submitted_distinct then
    raise exception 'DELIVERY_COMPLETE:DUPLICATE_LINES: an order line was submitted more than once.' using errcode = '22023';
  end if;

  select count(*) into v_snapshot from public.order_delivery_items di where di.delivery_id = v_delivery.id;
  if v_snapshot = 0 then
    raise exception 'DELIVERY_COMPLETE:NO_LINES: this delivery task has no line snapshots.' using errcode = '55000';
  end if;
  select count(*) into v_expected from public.order_items oi
   where oi.order_id = v_order.id
     and (v_delivery.sub_order_id is null or oi.sub_order_id = v_delivery.sub_order_id);
  if v_expected <> v_snapshot then
    raise exception 'DELIVERY_COMPLETE:SNAPSHOT_MISMATCH: the delivery task does not match the order lines.' using errcode = '55000';
  end if;
  select count(*) into v_bad
    from public.order_delivery_items di
    left join public.order_items oi on oi.id = di.order_item_id
   where di.delivery_id = v_delivery.id
     and (oi.id is null
          or oi.order_id <> v_order.id
          or (v_delivery.sub_order_id is not null and oi.sub_order_id is distinct from v_delivery.sub_order_id)
          or di.quantity_ordered is distinct from coalesce(oi.quantity_pieces, oi.quantity));
  if v_bad > 0 then
    raise exception 'DELIVERY_COMPLETE:SNAPSHOT_TAMPERED: the delivery task no longer matches the original order quantities.' using errcode = '55000';
  end if;

  select count(*) into v_bad from _delivery_completion_lines s
   where not exists (select 1 from public.order_delivery_items di
                      where di.delivery_id = v_delivery.id and di.order_item_id = s.order_item_id);
  if v_bad > 0 then
    raise exception 'DELIVERY_COMPLETE:UNKNOWN_LINE: a submitted line does not belong to this delivery.' using errcode = '22023';
  end if;
  if v_submitted <> v_snapshot then
    raise exception 'DELIVERY_COMPLETE:MISSING_LINES:%', v_snapshot using errcode = '22023';
  end if;
  select count(*) into v_bad
    from public.order_delivery_items di
    join _delivery_completion_lines s on s.order_item_id = di.order_item_id
   where di.delivery_id = v_delivery.id
     and s.delivered + s.missing + s.damaged <> di.quantity_ordered;
  if v_bad > 0 then
    raise exception 'DELIVERY_COMPLETE:QUANTITY_SPLIT: delivered + missing + damaged must equal the ordered quantity for every line.' using errcode = '22023';
  end if;

  -- ---- Writes --------------------------------------------------------------
  update public.order_delivery_items di
     set quantity_delivered = s.delivered,
         quantity_missing = s.missing,
         quantity_damaged = s.damaged
    from _delivery_completion_lines s
   where di.delivery_id = v_delivery.id
     and di.order_item_id = s.order_item_id;

  select coalesce(sum(s.missing + s.damaged), 0)::integer into v_shortfall_pieces
    from _delivery_completion_lines s;
  v_final_status := case when v_shortfall_pieces > 0 then 'partially_delivered' else 'delivered' end;

  select ps.value into v_setting from public.platform_settings ps where ps.key = 'orders.return_window_days';
  if v_setting is not null and jsonb_typeof(v_setting) = 'number'
     and (v_setting #>> '{}')::numeric = trunc((v_setting #>> '{}')::numeric)
     and (v_setting #>> '{}')::numeric between 0 and 365 then
    v_window := (v_setting #>> '{}')::integer;
  end if;
  v_deadline := ((v_now at time zone 'UTC')::date + v_window);

  update public.order_deliveries
     set delivery_status = v_final_status,
         delivered_at = v_now,
         receiver_name = v_receiver,
         otp_verified_at = v_now,
         signature_url = v_signature,
         photo_url = v_photo,
         delivery_notes = nullif(v_notes, ''),
         return_window_days = v_window,
         return_deadline = v_deadline,
         completed_by = p_actor_id
   where id = v_delivery.id;

  if v_order.status::text = 'dispatched' then
    -- The loyalty trigger awards points on the delivered value here.
    update public.orders set status = 'delivered', delivered_at = v_now where id = v_order.id;
  end if;

  -- One idempotent REFUND_CREDIT per delivery, computed from the order lines.
  if v_shortfall_pieces > 0 then
    v_credit := coalesce(public.order_shortfall_coins(
      v_delivery.id, 0,
      v_shortfall_pieces::text || ' item(s) missing or damaged at delivery',
      p_actor_id, false), 0);
  end if;

  -- An order that an Admin had already marked delivered earned points on the
  -- full value. Bring the order's points down to the delivered value.
  v_points_due := public._order_loyalty_points_due(v_order.id);
  select coalesce(sum(l.points), 0)::integer into v_points_held from public.loyalty_ledger l
   where l.reference_type = 'order' and l.reference_id = v_order.id
     and l.entry_type in ('ORDER_EARN', 'ORDER_REVERSAL');
  if v_points_held > v_points_due then
    insert into public.loyalty_ledger (
      retailer_id, points, entry_type, reason, reference_type, reference_id, idempotency_key, created_by
    ) values (
      v_order.retailer_id, v_points_due - v_points_held, 'ORDER_REVERSAL',
      'Order #' || coalesce(v_order.order_number, v_order.id::text) || ' delivery shortfall point adjustment',
      'order', v_order.id, 'loyalty:shortfall-adjust:' || v_delivery.id::text, p_actor_id
    ) on conflict (idempotency_key) do nothing;
  end if;

  v_result := jsonb_build_object(
    'status', 'completed',
    'replayed', false,
    'delivery_id', v_delivery.id,
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'retailer_id', v_order.retailer_id,
    'delivery_status', v_final_status,
    'fully_delivered', v_shortfall_pieces = 0,
    'shortfall_pieces', v_shortfall_pieces,
    'credit_back_paise', v_credit,
    'return_window_days', v_window,
    'return_deadline', v_deadline,
    'delivered_at', v_now
  );

  insert into public.delivery_completion_requests (delivery_id, order_id, idempotency_key, actor_id, delivered_at, result)
  values (v_delivery.id, v_order.id, p_idempotency_key, p_actor_id, v_now, v_result);

  perform set_config('request.jwt.claim.sub', coalesce(v_previous_sub, ''), true);
  return v_result;
end;
$$;

revoke all on function public.complete_delivery_atomic(uuid, uuid, text, text, text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.complete_delivery_atomic(uuid, uuid, text, text, text, text, text, text, jsonb)
  to service_role;

comment on function public.complete_delivery_atomic(uuid, uuid, text, text, text, text, text, text, jsonb) is
  '0099: completes a delivery in one transaction (quantities, completion, order status, shortfall credit, loyalty). service_role only; verifies the actor, the OTP digest and every line itself.';
