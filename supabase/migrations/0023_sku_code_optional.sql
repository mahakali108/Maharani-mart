-- ============================================================================
-- 0023: Make products.sku_code optional (SKU Code removed from the product
--       workflow)
--
-- Business change:
--   Maharani Traders does not maintain internal SKU codes for products. The
--   "SKU code" field has been removed from the Add / Edit Product workflow and
--   from every product-facing surface (admin product list & detail, retailer
--   catalog, catalog search, Quick Order, retailer search suggestions and the
--   salesman order builder).
--
-- Migration safety — NOTHING IS DROPPED:
--   - `products.sku_code` is KEPT for backward compatibility. Existing rows
--     keep their historical codes, and every legacy reader (inventory ledger,
--     GRN, batches, movements, reporting views `inventory_product_totals` /
--     `inventory_expiry_report`, AI tooling, exports) continues to work
--     unchanged.
--   - `product_packs.pack_sku_code` is NOT touched — packs still carry their
--     own SKU. The auto-seeded default pack now receives an application
--     generated code ("PK-<short product id>") instead of mirroring the
--     product SKU.
--   - `products.barcode` (EAN/UPC) and `inventory_batches.batch_number`
--     (Batch Code) are NOT touched.
--
-- What actually changes:
--   1. `sku_code` loses its NOT NULL constraint, so inserts that omit it (the
--      new product workflow) succeed.
--   2. `sku_code` gains a generated DEFAULT so rows created without one still
--      get a unique, non-null internal identifier. This keeps legacy readers
--      that assume a non-null code (e.g. the opening-stock batch numbering in
--      0017, which builds 'OPENING-' || upper(sku_code)) working exactly as
--      before, while the code is never entered or shown to a user again.
--   3. The UNIQUE constraint is left in place and stays satisfied by the
--      generated default.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. sku_code is no longer required on insert
-- ----------------------------------------------------------------------------
alter table products alter column sku_code drop not null;

-- ----------------------------------------------------------------------------
-- 2. Auto-generate an internal code when one is not supplied
--
--    gen_random_uuid() is already relied upon by 0017; the 12-hex suffix gives
--    a collision probability low enough for a distributor catalog while
--    keeping the value short and readable in legacy reports.
-- ----------------------------------------------------------------------------
alter table products
  alter column sku_code
  set default ('MK-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)));

comment on column products.sku_code is
  'LEGACY / internal only. Removed from the product workflow in 0023 — never entered by an admin and never shown in the UI. Kept nullable with a generated default so historical rows, reporting views and inventory tooling keep working.';

-- ============================================================================
-- END OF MIGRATION — no data is rewritten, no column is dropped.
-- ============================================================================
