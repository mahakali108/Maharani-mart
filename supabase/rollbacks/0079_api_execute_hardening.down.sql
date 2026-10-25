-- ============================================================================
-- ROLLBACK for 0079_api_execute_hardening.sql — SECURITY-WEAKENING.
--
-- Read this before running it. Two of the three blocks put the database back
-- into a state that was exploitable:
--
--   * it re-grants EXECUTE on public.release_order_stock(uuid) to `anon`,
--     which lets anyone holding the publishable key release the stock
--     reservations of any order id;
--   * it re-grants EXECUTE on public.ensure_fefo_coverage(uuid, uuid, integer)
--     to `anon` and `authenticated`, which lets any of them create inventory
--     batches.
--
-- Run it only to revert 0079 exactly (for example because the owner rejected
-- the change), never to "fix" a failing test. Prefer a forward fix.
--
-- Effect on data: none. This file changes privileges and one function
-- definition; it touches no row, no table and no policy.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- R1 — restore the 0017 definition of release_order_stock (no caller check)
-- ---------------------------------------------------------------------------
create or replace function public.release_order_stock(p_order_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_alloc record;
  v_order orders%rowtype;
  v_released int := 0;
begin
  -- NOTE: restored verbatim from 0017_inventory_batches_fefo_grn.sql.
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


-- ---------------------------------------------------------------------------
-- R2 — re-grant EXECUTE (the pre-0079 default-privilege state)
-- ---------------------------------------------------------------------------
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
    'public.reserve_order_stock(uuid)',
    'public.release_order_stock(uuid)'
  ]::text[]
  loop
    if to_regprocedure(signature) is not null then
      execute format('grant execute on function %s to anon', signature);
    end if;
  end loop;

  if to_regprocedure('public.ensure_fefo_coverage(uuid, uuid, integer)') is not null then
    grant execute on function public.ensure_fefo_coverage(uuid, uuid, integer)
      to anon, authenticated;
  end if;
end;
$$;
