-- ============================================================================
-- 0079 — API-role EXECUTE hardening, part 2 (inventory + AI helpers)
--
-- REVIEW ONLY. This file is NOT applied to any project. Applying it to
-- `fhrmsrumsraprvutrpeo` is an owner decision and needs the read-only evidence
-- in docs/FINAL_SQL_AND_PAGE_AUDIT.md §3 first.
--
-- Companion to 0078 (which withdrew the API grants on fefo_plan_for_product,
-- current_offer_floor_paise and handle_new_user, and aligned the banner
-- storage policies). The same audit pass, repeated over the whole catalog after
-- 0078, found three more classes. Each was reproduced by executing the full
-- migration set on PostgreSQL 16 (see tests/api-privilege-hardening.test.ts),
-- not by reading the files.
--
-- ---------------------------------------------------------------------------
-- H5  public.ensure_fefo_coverage(uuid, uuid, integer)
--     SECURITY DEFINER, NO caller check at all, and EXECUTE-able by `anon`
--     and `authenticated` through Supabase's default function privileges
--     (0002's `alter default privileges`). It does not only read: when the
--     FEFO batches do not cover the requested quantity it INSERTS rows into
--     inventory_batches. A signed-in retailer — in fact anyone holding the
--     publishable key — could therefore create stock batches for any
--     product/warehouse, corrupting availability and the movement ledger.
--
--     Its only callers are SECURITY DEFINER bodies in 0017
--     (reserve_order_stock, consume_order_stock). Those run as the function
--     owner, so withdrawing the API grants changes no application behaviour.
--
-- ---------------------------------------------------------------------------
-- H6  public.release_order_stock(uuid)
--     SECURITY DEFINER, deliberately unguarded ("invoked from the orders
--     cancel trigger"), and EXECUTE-able by `anon` and `authenticated`. Any
--     signed-in account could call /rest/v1/rpc/release_order_stock with the
--     id of somebody else's order and release its live reservations, after
--     which the stock is free to be sold twice. The comment in 0017 is
--     accurate about WHO calls it but that is exactly why the check belongs
--     inside the function rather than nowhere:
--
--       1. lib/admin/orders-actions.ts calls it directly from an admin session;
--       2. trg_release_stock_on_order_cancel (0017) calls it for every
--          cancellation, including a retailer cancelling their own order and
--          a seller cancelling a sub-order (0069, which can cancel the
--          parent).
--
--     The replacement below keeps the body byte-for-byte identical and puts
--     the decision in front of it:
--
--       * `anon`                     → refused (42501);
--       * `authenticated`            → allowed for staff/admin, for the
--                                      retailer who owns the order, for a
--                                      seller with a child order here, and for
--                                      a salesman whose RLS policy
--                                      `orders_salesman_update` (0009) already
--                                      lets them update this order (which is
--                                      what the cancel trigger needs);
--       * `service_role`             → allowed (cron/cancellation jobs);
--       * no JWT at all (`auth.role()` null: SQL Editor, psql, a migration)
--                                  → allowed, so an owner-driven manual
--                                      cancellation behaves exactly as today.
--
--     This narrows WHO may call it; it does not change what the function does,
--     its idempotency or its return value.
--
--     The allowed set is deliberately the set of roles that can already reach
--     this cancellation through RLS: a salesman is included because 0009's
--     `orders_salesman_update` policy lets them set `orders.status` for their
--     assigned retailers, and a cancellation whose stock release is refused
--     would fail the whole UPDATE with 42501 (found in the 2026-10-24 review,
--     pinned by tests/release-stock-authorization.test.ts).
--
-- ---------------------------------------------------------------------------
-- H7  Fourteen more SECURITY DEFINER functions are EXECUTE-able by `anon`,
--     although every one of them either mutates stock/inventory or returns
--     confidential cost data behind a caller check that an unauthenticated
--     request can never satisfy. The grant serves no purpose (the API key is
--     publishable, so "unreachable" is not a mitigation) and enlarges the
--     attack surface: PostgREST exposes every EXECUTE-able function under
--     /rest/v1/rpc. Withdrawing it from `anon` only — `authenticated` keeps
--     every grant it had, so no page, action or RPC flow changes.
--
--     Deliberately NOT revoked from `anon`:
--       * is_phone_registered(text)         — public registration pre-check.
--       * submit_supplier_application(...)  — the public application form.
--       * current_user_role() and the other boolean predicates referenced by
--         RLS policies granted to `public` (is_admin_or_above, is_staff_or_above,
--         is_area_assigned_to_current_staff, ...). Policies are evaluated with
--         the CALLER's privileges, so revoking these from `anon` would turn an
--         anonymous `select` that correctly returns zero rows into
--         "permission denied for function".
--
-- Every statement is idempotent and guarded (to_regprocedure / to_regclass), so
-- this file applies cleanly even where a prerequisite migration is missing. One
-- caveat is stated rather than hidden: H6's replacement body references
-- `sub_orders` (0064), so on a database without it H6 is SKIPPED with a NOTICE
-- and `release_order_stock` keeps its unguarded body (though H7 still withdraws
-- its `anon` grant). Apply in version order — 0064 always precedes 0079 — and
-- re-run this file afterwards if the NOTICE appears.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- H5 — the FEFO coverage helper must not be callable through the API
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.ensure_fefo_coverage(uuid, uuid, integer)') is not null then
    revoke all on function public.ensure_fefo_coverage(uuid, uuid, integer)
      from public, anon, authenticated;
  end if;
end;
$$;


-- ---------------------------------------------------------------------------
-- H6 — release_order_stock: same body, plus the caller check it never had
-- ---------------------------------------------------------------------------
-- Guarded: the body references orders / order_stock_allocations /
-- stock_movements / sub_orders, so on a database that never reached 0017 or
-- 0064 this is a NOTICE instead of an abort (which would leave H5/H7 applied
-- and the function definition un-hardened). Re-runnable.
do $h6$
begin
  if to_regclass('public.orders') is null
     or to_regclass('public.order_stock_allocations') is null
     or to_regclass('public.stock_movements') is null
     or to_regclass('public.sub_orders') is null then
    raise notice '0079 H6 SKIPPED: orders/order_stock_allocations/stock_movements/sub_orders not all present. release_order_stock still has NO caller check — apply 0017/0064 first, then re-run 0079.';
    return;
  end if;

  execute $ddl$
  create or replace function public.release_order_stock(p_order_id uuid)
  returns jsonb
  language plpgsql security definer set search_path = public, pg_temp
  as $$
  declare
    v_alloc record;
    v_order orders%rowtype;
    v_released int := 0;
    v_caller_role text := coalesce(auth.role(), '');
  begin
    -- H6 (0079). Order of the checks matters: `anon` is refused before the
    -- order is even read, so an unauthenticated caller learns nothing about
    -- whether the id exists.
    if v_caller_role = 'anon' then
      raise exception 'You are not permitted to release stock.' using errcode = '42501';
    end if;

    -- A JWT means a real API caller. Allowed: staff/admin for any order, the
    -- retailer who owns it, a seller who is a member of a seller that holds a
    -- child order here (seller_update_sub_order('cancelled') can cancel the
    -- parent, and that cancellation fires trg_release_stock_on_order_cancel),
    -- and a salesman for an order 0009's orders_salesman_update policy already
    -- lets them update.
    -- No JWT at all is a database session (SQL Editor, psql, migration, cron)
    -- and keeps today's behaviour.
    if v_caller_role <> '' and v_caller_role <> 'service_role' then
      if not (
        public.is_staff_or_above()
        or exists (
          select 1 from orders o
           where o.id = p_order_id
             and o.retailer_id = auth.uid()
        )
        or exists (
          select 1 from sub_orders so
           where so.parent_order_id = p_order_id
             and public.is_member_of_seller(so.seller_id)
        )
        -- Mirrors 0009's orders_salesman_update USING predicate exactly.
        or (
          public.current_user_role() = 'salesman'
          and exists (
            select 1 from orders o
             where o.id = p_order_id
               and (
                 o.collected_by = auth.uid()
                 or public.is_retailer_assigned_to_current_salesman(o.retailer_id)
               )
          )
        )
      ) then
        raise exception 'You are not permitted to release stock for this order.'
          using errcode = '42501';
      end if;
    end if;

    select * into v_order from orders where id = p_order_id for update;
    if not found then
      return jsonb_build_object('status', 'order_not_found');
    end if;

    for v_alloc in
      select * from order_stock_allocations
      where order_id = p_order_id and status = 'reserved'
      order by id
      for update
    loop
      insert into stock_movements
        (product_id, warehouse_id, batch_id, movement_type, quantity,
         reference_type, reference_id, reference_order_id, reason, performed_by)
      values
        (v_alloc.product_id, v_alloc.warehouse_id, v_alloc.batch_id, 'sale_release',
         v_alloc.quantity_reserved - v_alloc.quantity_dispatched,
         'order', p_order_id, p_order_id,
         'Reservation released for order ' || v_order.order_number, auth.uid());

      update order_stock_allocations
      set status = 'released'
      where id = v_alloc.id;

      v_released := v_released + (v_alloc.quantity_reserved - v_alloc.quantity_dispatched);
    end loop;

    return jsonb_build_object('status', 'released', 'order_id', p_order_id, 'units_released', v_released);
  end;
  $$;
  $ddl$;
end;
$h6$;
do $$
begin
  if to_regprocedure('public.release_order_stock(uuid)') is not null then
    revoke all on function public.release_order_stock(uuid) from public, anon;
  end if;
end;
$$;


-- ---------------------------------------------------------------------------
-- H7 — withdraw `anon` EXECUTE from inventory mutation and cost RPCs
-- ---------------------------------------------------------------------------
-- One block per function so a partially migrated database (for example a
-- restore that stopped before 0026) still applies every line it can.
do $$
declare
  signature text;
begin
  foreach signature in array array[
    'public.adjust_product_stock(uuid, uuid, integer, text, uuid)',
    'public.admin_pack_cost(uuid)',
    'public.admin_pack_costs(uuid)',
    'public.admin_product_cost(uuid)',
    'public.admin_product_costs()',
    'public.cancel_grn(uuid, text)',
    'public.cancel_stock_transfer(uuid, text)',
    'public.confirm_grn(uuid)',
    'public.consume_ai_confirmation(text)',
    'public.consume_ai_rate_limit(text, integer, integer)',
    'public.execute_stock_transfer(uuid)',
    'public.record_batch_loss(uuid, integer, text, text)',
    'public.require_inventory_role()',
    'public.reserve_order_stock(uuid)'
  ]::text[]
  loop
    if to_regprocedure(signature) is not null then
      execute format('revoke all on function %s from public, anon', signature);
    end if;
  end loop;
end;
$$;

-- ============================================================================
-- Verification (read-only, run after applying):
--
--   -- every function above must report anon = false, authenticated unchanged
--   select p.proname,
--          has_function_privilege('anon', p.oid, 'EXECUTE')          as anon,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname in (
--      'adjust_product_stock','admin_pack_cost','admin_pack_costs',
--      'admin_product_cost','admin_product_costs','cancel_grn',
--      'cancel_stock_transfer','confirm_grn','consume_ai_confirmation',
--      'consume_ai_rate_limit','execute_stock_transfer','record_batch_loss',
--      'require_inventory_role','reserve_order_stock','ensure_fefo_coverage',
--      'release_order_stock')
--    order by 1;
--
--   -- must still be true: the public registration pre-check and the public
--   -- supplier form, plus the predicates RLS uses for anonymous readers
--   select has_function_privilege('anon','public.is_phone_registered(text)','EXECUTE'),
--          has_function_privilege('anon','public.is_admin_or_above()','EXECUTE'),
--          has_function_privilege('anon','public.is_staff_or_above()','EXECUTE');
-- ============================================================================
