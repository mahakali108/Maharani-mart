-- ============================================================================
-- 0050: Catalog administration upgrade (Phase 3)
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- Purely additive hardening for the admin catalog screens. It creates NO
-- table, adds NO column, adds NO unique constraint, drops nothing and rewrites
-- no row. Every statement is idempotent so the migration can be re-run.
--
--   1. Indexes for the columns the admin product list now filters and sorts
--      on. None existed: 0001 indexed only `price_lists(product_id)` on the
--      catalog side, and 0005/0023 added the unique barcode/sku indexes.
--   2. Audit triggers for the four catalog tables that never had one.
--      products, product_packs, price_lists, product_pricing_tiers, orders and
--      schemes were already audited (0001, 0022, 0040); brands, categories,
--      product_images and product_pack_images were not — so a category or brand
--      deletion left no trail at all. They now use the SAME `log_audit()`
--      function as every other audited table, so /admin/audit-logs shows them
--      with no UI change.
--   3. `catalog_product_sales` — a read-only view that makes "sort by sales"
--      and "top-selling products" answerable from real order rows. It is a
--      plain view (not the nightly `mv_top_products` materialized view from
--      0001, which is empty until a cron refresh runs) so the numbers are
--      always current, and it is gated by `is_staff_or_above()` exactly like
--      `inventory_product_totals` (0017).
--   4. `admin_product_costs()` — a batched, admin-only purchase-cost read.
--      0025 REVOKED direct `SELECT (cost_price)` from anon/authenticated and
--      provided `admin_product_cost(uuid)` for ONE product at a time. The
--      admin product list now shows a margin column and can sort by margin, so
--      a per-row call would mean N queries per page. This is the batched
--      equivalent, with the same `is_admin_or_above()` gate and the same
--      explicit privilege handling.
--
-- WHAT WAS DELIBERATELY NOT DONE
-- ------------------------------
-- * No `product_status` enum (draft/archived). `products.is_active` is the
--   only lifecycle flag in this schema and every retailer-facing surface
--   filters on it; a parallel status column would create two sources of truth
--   for "can a retailer see this product".
-- * No supplier or manufacturer column. Supplier is free text on GRNs
--   (`inventory_batches.supplier_reference`, 0017) and is not linked to a
--   product, so there is nothing to search or report on.
-- * No unique constraint on `products.hsn_code` or `products.name`. HSN codes
--   legitimately repeat across pack sizes of related goods, and duplicate
--   product names are a data-quality question, not an integrity one.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Indexes for admin catalog search / filter / sort
-- ----------------------------------------------------------------------------

-- FK columns used by the brand and category filters. Postgres does not index
-- foreign keys automatically; both are filtered on every catalog request.
create index if not exists idx_products_category_id on products (category_id);
create index if not exists idx_products_brand_id on products (brand_id);

-- Sort orders offered by the admin product list.
create index if not exists idx_products_created_at_desc on products (created_at desc);
create index if not exists idx_products_updated_at_desc on products (updated_at desc);
create index if not exists idx_products_base_price on products (base_price);

-- Status filter + the default active-catalog scan.
create index if not exists idx_products_is_active on products (is_active);

-- HSN and GST filters. HSN is sparse, so the index is partial — the vast
-- majority of rows have no code and should not be indexed at all.
create index if not exists idx_products_hsn_code on products (hsn_code) where hsn_code is not null;
create index if not exists idx_products_gst_percent on products (gst_percent);

-- Catalog organisation: the admin category list is now ordered by sort_order
-- within a parent (the column has existed since 0001 but was never indexed).
create index if not exists idx_categories_parent_sort on categories (parent_id, sort_order);
create index if not exists idx_brands_name on brands (name);

comment on index idx_products_category_id is
  'Admin catalog category filter (Phase 3). FK columns are not indexed by default.';
comment on index idx_products_hsn_code is
  'Partial index for the admin HSN filter/search. NULL HSN codes are excluded.';

-- ----------------------------------------------------------------------------
-- 2. Audit trail for the catalog master-data tables
-- ----------------------------------------------------------------------------
-- Uses the existing `log_audit()` (0001) — the same function that already
-- audits products, product_packs, price_lists, product_pricing_tiers, orders
-- and schemes. No new audit table, no new log shape.

drop trigger if exists trg_audit_brands on brands;
create trigger trg_audit_brands after insert or update or delete on brands
  for each row execute function log_audit();

drop trigger if exists trg_audit_categories on categories;
create trigger trg_audit_categories after insert or update or delete on categories
  for each row execute function log_audit();

drop trigger if exists trg_audit_product_images on product_images;
create trigger trg_audit_product_images after insert or update or delete on product_images
  for each row execute function log_audit();

drop trigger if exists trg_audit_product_pack_images on product_pack_images;
create trigger trg_audit_product_pack_images after insert or update or delete on product_pack_images
  for each row execute function log_audit();

comment on trigger trg_audit_brands on brands is
  'Phase 3: brand create/edit/deactivate/delete now lands in audit_logs.';
comment on trigger trg_audit_categories on categories is
  'Phase 3: category create/edit/deactivate/delete now lands in audit_logs.';
comment on trigger trg_audit_product_images on product_images is
  'Phase 3: product image add/reorder/delete now lands in audit_logs.';
comment on trigger trg_audit_product_pack_images on product_pack_images is
  'Phase 3: variant image add/reorder/delete now lands in audit_logs.';

-- ----------------------------------------------------------------------------
-- 3. catalog_product_sales — real sales per product
-- ----------------------------------------------------------------------------
-- Aggregates `order_items` over orders that were actually placed and not
-- cancelled. `quantity_pieces` (0026) is preferred over `quantity` because a
-- pre-0026 row counts packs while a post-0026 row counts pieces; coalescing to
-- `quantity` keeps historical rows counted in the unit they were billed in
-- rather than silently dropping them.
--
-- Returns are joined from `return_requests` (0009) via `order_item_id`, which
-- is the only place a return is linked to a specific product line.

create or replace view catalog_product_sales as
select
  oi.product_id,
  count(*) filter (where o.placed_at > now() - interval '30 days') as orders_30d,
  coalesce(sum(oi.quantity_pieces) filter (where o.placed_at > now() - interval '30 days'), 0) as units_30d,
  coalesce(sum(oi.line_total)      filter (where o.placed_at > now() - interval '30 days'), 0) as revenue_30d,
  coalesce(sum(oi.quantity_pieces), 0) as units_all_time,
  coalesce(sum(oi.line_total), 0)      as revenue_all_time,
  max(o.placed_at) as last_ordered_at,
  count(rr.id) as return_requests
from order_items oi
join orders o on o.id = oi.order_id
left join return_requests rr on rr.order_item_id = oi.id and rr.status <> 'rejected'
where o.status <> 'cancelled'
  and is_staff_or_above()
group by oi.product_id;

comment on view catalog_product_sales is
  'Phase 3: real sales and return counts per product, from order_items/orders/return_requests. Empty until real orders exist — never fabricated. Staff+ only, via the same is_staff_or_above() gate inventory_product_totals uses.';

-- ----------------------------------------------------------------------------
-- 4. admin_product_costs() — batched admin-only purchase cost
-- ----------------------------------------------------------------------------
-- Companion to admin_product_cost(uuid) / admin_pack_costs(uuid) from 0025.
-- Same SECURITY DEFINER + is_admin_or_above() gate; returns one row per
-- product for the whole catalog so the admin list can build a margin column
-- with a single round trip. Returns ZERO rows (not nulls) for anyone below
-- admin, so a non-admin caller gets nothing rather than a leaked margin.

create or replace function admin_product_costs()
returns table (product_id uuid, cost_price numeric)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id, p.cost_price
  from products p
  where is_admin_or_above();
$$;

comment on function admin_product_costs() is
  'Phase 3: batched admin/super_admin-only read of products.cost_price for the whole catalog. Needed because 0025 revokes direct column SELECT; a non-admin caller receives zero rows.';

revoke all on function admin_product_costs() from public;
grant execute on function admin_product_costs() to authenticated;

-- ============================================================================
-- END OF MIGRATION — no table created, no column added, no row changed.
-- ============================================================================
