-- ============================================================================
-- 0083 — Retire the paid retailer membership system (keep the history)
--
-- Owner decision: the paid Free/Silver/Gold membership subscription is no
-- longer offered. Retailer pricing categories (0081/0082) replace it.
--
-- WHAT THIS MIGRATION DOES
--   1. Deactivates every membership plan (is_active = false). The plans and
--      their prices stay readable to administrators for history; no retailer
--      sees a purchasable plan any more.
--   2. Withdraws the API grant on admin_set_retailer_membership(id,...) so no
--      authenticated session (admin UI included) can grant, renew or extend a
--      paid membership. The function body is retained so historical rows stay
--      explainable and a future owner-approved rollback is possible.
--   3. Stops the delivered-order loyalty trigger from reading a membership
--      multiplier. New loyalty accrual is the documented base rate (1 point per
--      whole ₹100 of the delivered order total).
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--   * No table is dropped, no row is deleted: membership_plans,
--     retailer_memberships and loyalty_ledger keep every historical row.
--   * No loyalty balance is converted to cash, reduced, expired or rewritten.
--     Existing points stay exactly as recorded, and remain readable to the
--     retailer and to administrators.
--   * No order, payment, invoice or settlement row is touched.
--
-- BEHAVIOURAL NOTES FOR THE REVIEWER
--   * Because membership discounts were never wired into checkout arithmetic
--     (verified by a repository-wide search: `computeMembershipDiscount` had no
--     checkout caller before this change), removing the membership system does
--     not change any order total. Only the *marketing/claim* surfaces and the
--     admin assignment screen are removed in the same change.
--   * Loyalty accrual for orders delivered AFTER this migration is lower for a
--     retailer who previously held a membership multiplier (≤2x -> 1x). This is
--     a forward-looking change to an unearned bonus, not a balance edit; it is
--     called out in docs/MASTER_UPGRADE_AUDIT_2026-10-27.md §5.
--
-- NOTHING IS APPLIED TO ANY PROJECT BY THIS FILE.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Plans are no longer sold
-- ---------------------------------------------------------------------------
update public.membership_plans set is_active = false, updated_at = now() where is_active;

comment on table public.membership_plans is
  'RETIRED 2026-10-27. Paid retailer memberships are no longer sold; every plan is inactive. Rows are retained for historical reference only. Retailer pricing now uses retailers.retailer_category (migration 0081) and product_tier_prices (0082).';

comment on table public.retailer_memberships is
  'HISTORICAL 2026-10-27. Retained so old assignments remain explainable. No new membership may be granted: admin_set_retailer_membership is no longer executable by any API role.';

-- ---------------------------------------------------------------------------
-- 2. No API role may assign/renew a membership
-- ---------------------------------------------------------------------------
do $$ begin
  if to_regprocedure('public.admin_set_retailer_membership(uuid, text, text, text)') is not null then
    execute 'revoke all on function public.admin_set_retailer_membership(uuid, text, text, text) from public, anon, authenticated';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Loyalty accrual no longer depends on a paid membership
-- ---------------------------------------------------------------------------
create or replace function public.trg_order_delivered_loyalty()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_qualifying_rupees numeric;
  v_points integer;
  v_idempotency_key text;
begin
  -- Condition 1: Order transitions to 'delivered' -> award base points.
  -- 1 point per whole ₹100 of the GST-inclusive order total. No multiplier:
  -- the paid-membership boost was retired in migration 0083.
  if new.status = 'delivered' and (old.status is distinct from 'delivered') then
    v_qualifying_rupees := coalesce(new.grand_total, 0);
    if v_qualifying_rupees >= 100 then
      v_points := floor(v_qualifying_rupees / 100)::integer;
      if v_points > 0 then
        v_idempotency_key := 'loyalty:earn:' || new.id::text;
        perform public.record_loyalty_points(
          new.retailer_id,
          v_points,
          'ORDER_EARN',
          'Delivered Order #' || coalesce(new.order_number, new.id::text) || ' loyalty award',
          'order',
          new.id,
          v_idempotency_key
        );
      end if;
    end if;
  end if;

  -- Condition 2: Delivered order is returned -> reverse the points earned.
  if new.status = 'returned' and old.status = 'delivered' then
    v_idempotency_key := 'loyalty:reversal:' || new.id::text;
    select points into v_points
      from public.loyalty_ledger
     where reference_type = 'order'
       and reference_id = new.id
       and entry_type = 'ORDER_EARN';

    if found and v_points > 0 then
      perform public.record_loyalty_points(
        new.retailer_id,
        -v_points,
        'ORDER_REVERSAL',
        'Returned Order #' || coalesce(new.order_number, new.id::text) || ' point reversal',
        'order',
        new.id,
        v_idempotency_key
      );
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.trg_order_delivered_loyalty() from public, anon;
grant execute on function public.trg_order_delivered_loyalty() to authenticated, service_role;

drop trigger if exists trg_orders_delivered_loyalty on public.orders;
create trigger trg_orders_delivered_loyalty
  after update of status on public.orders
  for each row execute function public.trg_order_delivered_loyalty();

-- ============================================================================
-- END OF MIGRATION 0083
-- ============================================================================
