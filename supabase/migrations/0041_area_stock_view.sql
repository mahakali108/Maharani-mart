-- ============================================================================
-- 0041: Area stock view (Phase 3 — warehouse & area stock operations)
--
-- WHY
-- ---
-- Stock was only ever visible per warehouse. Operations also reason per
-- AREA ("how much do we hold across Khagaria Town?") because staff are
-- area-assigned (0037) and reporting is area-wise. This adds a read-only
-- aggregation view; no table or policy is modified.
--
-- SAFETY
-- ------
-- * Additive & re-runnable: CREATE OR REPLACE VIEW only.
-- * `security_invoker = true` (Postgres 15+): the view executes with the
--   CALLER's privileges, so the underlying `inventory_stock` RLS (scoped to
--   admin+ or assigned staff since 0037) applies exactly as if the caller
--   queried inventory_stock directly. No privilege is gained through the
--   view; retailers still see nothing.
-- * Only ACTIVE warehouses in the area contribute (an inactive depot's
--   stock is not available stock for the area).
-- ============================================================================

create or replace view inventory_area_totals
with (security_invoker = true) as
select
  a.id            as area_id,
  a.name          as area_name,
  ist.product_id  as product_id,
  p.name          as product_name,
  p.sku_code      as sku_code,
  sum(ist.quantity)          as quantity_on_hand,
  sum(ist.reserved_quantity) as quantity_reserved,
  max(ist.updated_at)        as updated_at
from areas a
join warehouses w on w.area_id = a.id and w.is_active
join inventory_stock ist on ist.warehouse_id = w.id
join products p on p.id = ist.product_id
group by a.id, a.name, ist.product_id, p.name, p.sku_code;

comment on view inventory_area_totals is
  'Stock aggregated per AREA across its active warehouses. security_invoker: caller RLS on inventory_stock applies.';

-- ============================================================================
-- END OF MIGRATION — no business data inserted.
-- ============================================================================
