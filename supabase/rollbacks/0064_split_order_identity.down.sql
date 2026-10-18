-- Rollback for 0064_split_order_identity.sql — FAIL-SAFE, GUARDED.
--
-- ABORTS while any split-order rows exist (sub_orders, or order/cart lines
-- carrying a seller source). Removing the identity columns would destroy
-- split-order history. Legacy-only environments (no marketplace rows) can
-- roll back cleanly: the old cart key is restored and order_items columns are
-- dropped ONLY when no split rows reference them.
--
-- Roll back 0065–0068 FIRST. NOT executed.

do $$
begin
  if (select count(*) from sub_orders) > 0 then
    raise exception
      'ROLLBACK ABORTED: sub-order rows exist. Split-order history must be exported and deleted deliberately, then re-run.';
  end if;
  if exists (select 1 from order_items where sub_order_id is not null or seller_offer_id is not null) then
    raise exception
      'ROLLBACK ABORTED: order lines carry seller/split identity. Export and delete them deliberately, then re-run.';
  end if;
  if exists (select 1 from cart_items where seller_offer_id is not null) then
    raise exception
      'ROLLBACK ABORTED: cart lines reference seller offers. Delete them deliberately, then re-run.';
  end if;
end $$;

drop policy if exists "sub_orders_select" on sub_orders;
drop trigger if exists trg_audit_sub_orders on sub_orders;
drop trigger if exists trg_guard_sub_order_snapshot_update on sub_orders;
drop trigger if exists trg_enforce_sub_order_status_transitions on sub_orders;
drop function if exists public.guard_sub_order_snapshot_update();
drop function if exists public.enforce_sub_order_status_transitions();
drop table if exists sub_orders;

drop index if exists uq_order_items_child_pack;
drop index if exists uq_order_items_legacy_pack;
drop index if exists idx_order_items_sub_order;

alter table order_items
  drop constraint if exists order_items_fulfilment_counters;
alter table order_items
  drop constraint if exists order_items_source_shape;
alter table order_items
  drop column if exists returned_received_quantity,
  drop column if exists missing_damaged_quantity,
  drop column if exists accepted_quantity,
  drop column if exists shipped_quantity,
  drop column if exists fulfilment_type,
  drop column if exists source_type,
  drop column if exists seller_offer_id,
  drop column if exists sub_order_id;

alter table orders
  drop column if exists fulfilment_profile;

-- Restore the legacy cart key BEFORE removing the new one.
alter table cart_items
  add constraint cart_items_retailer_id_pack_id_key unique (retailer_id, pack_id);
drop index if exists uq_cart_items_pack_source;
alter table cart_items
  drop column if exists line_key;
alter table cart_items
  drop constraint if exists cart_items_source_shape;
alter table cart_items
  drop column if exists seller_offer_id,
  drop column if exists source_type;
