-- Rollback for 0066_fulfilment_and_delivery.sql — FAIL-SAFE, GUARDED.
--
-- ABORTS while any seller shipment records exist: fulfilment history is
-- shipment history and must not be erased. Order_deliveries rows are
-- preserved in every case (the sub_order_id link column is simply dropped).
--
-- Roll back 0067–0068 FIRST. NOT executed.

do $$
begin
  if (select count(*) from seller_shipments) > 0 then
    raise exception
      'ROLLBACK ABORTED: seller shipment records exist. Export them under a reviewed retention procedure, delete deliberately, then re-run.';
  end if;
end $$;

drop policy if exists "seller_shipments_select" on seller_shipments;
drop trigger if exists trg_audit_seller_shipments on seller_shipments;
drop table if exists seller_shipments;

alter table order_deliveries
  drop column if exists sub_order_id;

drop trigger if exists trg_guard_order_item_fulfilment_counters on order_items;
drop function if exists public.guard_order_item_fulfilment_counters();
drop function if exists public.set_sub_order_status(uuid, text, text);
drop function if exists public.apply_parent_order_status(uuid);
drop function if exists public.restore_sub_order_stock(uuid);
