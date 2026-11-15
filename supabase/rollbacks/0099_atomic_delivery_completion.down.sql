-- ============================================================================
-- ROLLBACK for 0099_atomic_delivery_completion.sql
-- REVIEW ONLY, NOT APPLIED ANYWHERE.
--
-- WARNING: after this rollback the application cannot complete a delivery
-- (the server action calls complete_delivery_atomic and fails closed when it
-- is absent). Roll the application back to a build that predates 0099 first.
--
-- No data is removed:
--   * public.delivery_completion_requests is KEPT (inert: no API role can
--     reach it). Re-applying 0099 reuses it.
--   * Ledger rows written by completions stay.
-- Known consequence: the 0094 loyalty trigger restored below reverses the
-- original ORDER_EARN on a return. For an order that carries a
-- 'loyalty:shortfall-adjust:<delivery>' row (written only when an Admin had
-- marked the order delivered before a partial delivery was recorded), a later
-- return would over-reverse by the adjustment. List them first:
--   select reference_id from public.loyalty_ledger
--    where idempotency_key like 'loyalty:shortfall-adjust:%';
-- ============================================================================
begin;

drop function if exists public.complete_delivery_atomic(uuid, uuid, text, text, text, text, text, text, jsonb);
drop function if exists public._order_loyalty_points_due(uuid);

-- 0094 body, verbatim.
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

commit;
