-- ============================================================================
-- 0007: Pack-based cart & order line items + order numbering + pack MOQ
--
-- Phase 1 designed cart_items/order_items against `products` directly,
-- before Phase 2A introduced product_packs (the real orderable unit,
-- carrying MRP/PTR/Wholesale pricing and units-per-case). This migration
-- adds pack_id to both tables so a retailer can select a specific pack
-- size (e.g. "1 Kg" vs "5 Kg") rather than an ambiguous whole product.
--
-- product_id is kept (not dropped) on both tables for cheap filtering/
-- joins without traversing through product_packs, and stays in sync
-- with pack_id via trigger — no existing data is destroyed, no existing
-- RLS policy needs to change (all policies key off retailer_id/order_id,
-- neither of which moves).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. product_packs: minimum order quantity
-- ----------------------------------------------------------------------------
alter table product_packs
  add column moq int not null default 1 check (moq > 0);

comment on column product_packs.moq is 'Minimum order quantity for this pack — cart/checkout must reject quantities below this.';

-- ----------------------------------------------------------------------------
-- 2. cart_items: add pack_id, re-scope uniqueness to (retailer_id, pack_id)
-- ----------------------------------------------------------------------------
alter table cart_items
  add column pack_id uuid references product_packs(id) on delete cascade;

-- Backfill: existing cart_items (if any — database starts empty in this
-- project, but this keeps the migration correct/idempotent for any
-- pre-existing rows) get no pack_id since none existed at the time;
-- such rows are no longer valid under the new model and are removed
-- rather than left in a broken state.
delete from cart_items where pack_id is null;

alter table cart_items
  alter column pack_id set not null;

alter table cart_items drop constraint if exists cart_items_retailer_id_product_id_key;
alter table cart_items add constraint cart_items_retailer_id_pack_id_key unique (retailer_id, pack_id);

create index idx_cart_items_pack on cart_items(pack_id);

-- Keep product_id in sync with pack_id automatically, so existing code
-- that filters/joins on cart_items.product_id keeps working unchanged.
create or replace function sync_cart_item_product_id() returns trigger as $$
begin
  select product_id into new.product_id from product_packs where id = new.pack_id;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_sync_cart_item_product_id on cart_items;
create trigger trg_sync_cart_item_product_id
  before insert or update of pack_id on cart_items
  for each row execute function sync_cart_item_product_id();

-- ----------------------------------------------------------------------------
-- 3. order_items: add pack_id (nullable — historical orders before this
--    migration, if any, won't have one; all new orders must set it,
--    enforced in the application layer since a hard NOT NULL would
--    break hypothetical pre-existing rows this migration can't inspect)
-- ----------------------------------------------------------------------------
alter table order_items
  add column pack_id uuid references product_packs(id);

create index idx_order_items_pack on order_items(pack_id);

-- ----------------------------------------------------------------------------
-- 4. Order number generation — safe, sequential, no application-side
--    race condition (previously orders.order_number had no default at
--    all, meaning the app would have had to invent numbers itself).
-- ----------------------------------------------------------------------------
create sequence if not exists order_number_seq;

create or replace function generate_order_number() returns text as $$
  select 'MK-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('order_number_seq')::text, 5, '0');
$$ language sql;

alter table orders
  alter column order_number set default generate_order_number();

-- ============================================================================
-- END OF MIGRATION — no business data inserted.
-- ============================================================================
