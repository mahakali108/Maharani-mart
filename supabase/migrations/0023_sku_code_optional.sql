-- ============================================================================
-- 0023: SKU code optional (removed from the product workflow)
--
-- Product-level SKU codes are no longer part of the product Add/Edit flow or
-- the retailer-facing product workflow. Admins no longer enter a SKU when
-- creating a product, and new products may legitimately have none.
--
-- Migration safety:
--   - The legacy `products.sku_code` column is RETAINED (not dropped) for
--     backward compatibility: existing rows keep their codes, and internal
--     inventory / reporting / AI surfaces continue to show them where present.
--   - Only the NOT NULL constraint is relaxed. The unique constraint stays
--     (Postgres allows multiple NULLs in a unique column), so legacy codes
--     remain deduplicated while new products can store NULL.
--   - `product_packs.pack_sku_code` (the pack / batch identifier) is a
--     SEPARATE concept and is untouched: packs keep their mandatory, unique
--     pack codes. Product creation now auto-generates the default pack's code
--     (AUTO-<8 hex chars of the product uuid>) instead of mirroring the
--     product SKU.
--   - `ensure_fefo_coverage()` (from 0017) concatenated `products.sku_code`
--     into synthetic OPENING batch numbers. With nullable SKUs that concat
--     would yield a NULL batch_number and fail the insert, so the function is
--     recreated here with a NULL-safe expression (no behaviour change for
--     products that still have a SKU).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. products.sku_code is now optional (column retained, NULL allowed)
-- ----------------------------------------------------------------------------
alter table products alter column sku_code drop not null;

comment on column products.sku_code is
  'LEGACY product SKU code. Optional since 0023: new products created through the product form have no SKU. Retained for backward compatibility with existing rows, inventory/reporting views and AI tooling. Pack-level identifiers live in product_packs.pack_sku_code.';

-- Note: the unique constraint (products_sku_code_key) is intentionally kept.
-- Postgres treats NULLs as distinct, so any number of SKU-less products can
-- coexist with unique legacy codes.

-- ----------------------------------------------------------------------------
-- 2. NULL-safe OPENING batch numbers in ensure_fefo_coverage()
--    (recreated from 0017 with a coalesce around products.sku_code)
-- ----------------------------------------------------------------------------
create or replace function ensure_fefo_coverage(
  p_product_id uuid,
  p_warehouse_id uuid,
  p_required int
)
returns void
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare
  v_stock inventory_stock%rowtype;
  v_product products%rowtype;
  v_product_available int;
  v_batch_available int;
  v_shortfall int;
  v_batch inventory_batches%rowtype;
begin
  select * into v_stock
  from inventory_stock
  where product_id = p_product_id and warehouse_id = p_warehouse_id
  for update;

  v_product_available := coalesce(v_stock.quantity, 0) - coalesce(v_stock.reserved_quantity, 0);
  if v_product_available < p_required then
    select * into v_product from products where id = p_product_id;
    raise exception 'INSUFFICIENT_STOCK: only % unit(s) of % available (requested %).',
      greatest(v_product_available, 0), coalesce(v_product.name, p_product_id::text), p_required;
  end if;

  select coalesce(sum(current_quantity - reserved_quantity), 0) into v_batch_available
  from inventory_batches
  where product_id = p_product_id
    and warehouse_id = p_warehouse_id
    and is_active
    and current_quantity - reserved_quantity > 0
    and (expiry_date is null or expiry_date >= current_date);

  -- Bridge ONLY when this product/warehouse has no batches at all (the
  -- true pre-migration legacy state). If batches exist but don't cover the
  -- requirement, the gap is expired/damaged/not-yet-written-off stock
  -- and must NOT become sellable through a synthetic OPENING batch —
  -- the FEFO planner will (correctly) report insufficient stock instead.
  if v_batch_available < p_required
     and not exists (select 1 from inventory_batches
                     where product_id = p_product_id and warehouse_id = p_warehouse_id) then
    -- Fold the ENTIRE un-batched balance into one OPENING batch (not just
    -- this order's requirement), so subsequent orders see the same pool.
    v_shortfall := v_product_available;
    if v_shortfall > 0 then
      select * into v_product from products where id = p_product_id;

      -- Direct batch insert, deliberately WITHOUT a stock movement: the
      -- units already exist in inventory_stock (recorded by pre-batch
      -- movements), so a movement here would double-count them. The
      -- audit_logs trigger on inventory_batches records who/when.
      -- 0023: sku_code is optional, so the batch number no longer depends
      -- on it (SKU-less products get "OPENING-<uuid8>").
      insert into inventory_batches
        (product_id, warehouse_id, batch_number, received_quantity, current_quantity, created_by)
      values
        (p_product_id, p_warehouse_id,
         'OPENING-' || coalesce(upper(nullif(v_product.sku_code, '')) || '-', '') || substr(gen_random_uuid()::text, 1, 8),
         v_shortfall, v_shortfall, auth.uid())
      returning * into v_batch;
    end if;
  end if;
end;
$$;

-- ============================================================================
-- END OF MIGRATION — no further seed data.
-- ============================================================================
