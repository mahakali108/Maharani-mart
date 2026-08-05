-- ============================================================================
-- 0005: Master data RLS, product barcode, pack pricing tiers
--
-- SECURITY FINDING fixed by this migration: `areas`, `warehouses`,
-- `brands`, `categories`, and `product_images` were created in
-- 0001_init.sql WITHOUT row level security ever being enabled on
-- them. Every other table in the schema had RLS turned on; these
-- five did not. In practice this meant any authenticated Supabase
-- client (and possibly anon, depending on default grants) could
-- read/write these tables directly, bypassing the app entirely.
-- This migration closes that gap for all five.
--
-- NOTE: `staff_assignments`, `schemes`, `order_status_history`,
-- `notification_logs`, and `audit_logs` have the SAME gap (RLS never
-- enabled) but are NOT touched here because they have no UI yet in
-- this phase and each needs its own considered policy design rather
-- than a rushed one bundled into this migration. Flagged as CRITICAL
-- for Phase 2B — do not build UI against them before RLS is added.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Enable RLS + policies: areas
-- ----------------------------------------------------------------------------
alter table areas enable row level security;
create policy "areas_read" on areas for select using (is_active or is_staff_or_above());
create policy "areas_staff_insert" on areas for insert with check (is_staff_or_above());
create policy "areas_admin_update" on areas for update using (is_admin_or_above());
create policy "areas_admin_delete" on areas for delete using (is_admin_or_above());

-- ----------------------------------------------------------------------------
-- 2. Enable RLS + policies: warehouses
-- ----------------------------------------------------------------------------
alter table warehouses enable row level security;
create policy "warehouses_read" on warehouses for select using (is_active or is_staff_or_above());
create policy "warehouses_staff_insert" on warehouses for insert with check (is_staff_or_above());
create policy "warehouses_staff_update" on warehouses for update using (is_staff_or_above());
create policy "warehouses_admin_delete" on warehouses for delete using (is_admin_or_above());

-- ----------------------------------------------------------------------------
-- 3. Enable RLS + policies: brands
-- ----------------------------------------------------------------------------
alter table brands enable row level security;
create policy "brands_read" on brands for select using (is_active or is_staff_or_above());
create policy "brands_staff_insert" on brands for insert with check (is_staff_or_above());
create policy "brands_staff_update" on brands for update using (is_staff_or_above());
create policy "brands_admin_delete" on brands for delete using (is_admin_or_above());

-- ----------------------------------------------------------------------------
-- 4. Enable RLS + policies: categories
-- ----------------------------------------------------------------------------
alter table categories enable row level security;
create policy "categories_read" on categories for select using (is_active or is_staff_or_above());
create policy "categories_staff_insert" on categories for insert with check (is_staff_or_above());
create policy "categories_staff_update" on categories for update using (is_staff_or_above());
create policy "categories_admin_delete" on categories for delete using (is_admin_or_above());

-- ----------------------------------------------------------------------------
-- 5. Enable RLS + policies: product_images
--    Read follows the parent product's own visibility (active
--    products readable by anyone authenticated; inactive only by
--    staff+), matching the "products_read" policy on `products`.
-- ----------------------------------------------------------------------------
alter table product_images enable row level security;
create policy "product_images_read" on product_images for select using (
  exists (
    select 1 from products p
    where p.id = product_images.product_id
      and (p.is_active or is_staff_or_above())
  )
);
create policy "product_images_staff_insert" on product_images for insert with check (is_staff_or_above());
create policy "product_images_staff_delete" on product_images for delete using (is_staff_or_above());
create policy "product_images_staff_update" on product_images for update using (is_staff_or_above());

-- Also add the previously-missing UPDATE policy on `products` itself
-- covering the ordinary `is_staff_or_above()` case explicitly (the
-- original policy was named "products_update" and already covers
-- this — no change needed there; noted here only for audit clarity).

-- ----------------------------------------------------------------------------
-- 6. Product barcode (EAN/UPC) — distinct from sku_code, which is the
--    internal catalog identifier. Optional: not every SKU from a
--    small distributor has a printed barcode yet.
-- ----------------------------------------------------------------------------
alter table products add column barcode text;
create unique index idx_products_barcode on products(barcode) where barcode is not null;

-- ----------------------------------------------------------------------------
-- 7. Pack-level pricing tiers: MRP (printed retail price), PTR (price
--    to retailer — what this platform actually charges by default),
--    and an explicit wholesale price for bulk-case orders. The
--    existing `base_price` on product_packs remains the default
--    effective price used by get_effective_price() unless
--    retailer/area/scheme pricing in `price_lists` overrides it.
-- ----------------------------------------------------------------------------
alter table product_packs add column mrp numeric(12,2);
alter table product_packs add column ptr numeric(12,2);
alter table product_packs add column wholesale_price numeric(12,2);
alter table product_packs add column barcode text;
create unique index idx_product_packs_barcode on product_packs(barcode) where barcode is not null;

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
