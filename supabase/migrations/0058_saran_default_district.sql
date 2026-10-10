-- ============================================================================
-- 0058 — Default service district: Saran (Bihar)
-- ============================================================================
-- The active business/service district changes from Khagaria to Saran.
--
-- This migration changes ONLY the column DEFAULT used for NEW rows inserted into
-- public.areas without an explicit district. It does NOT:
--   - update existing areas (their recorded district is kept as-is),
--   - touch retailers, retailer_addresses, orders, warehouses or any other data,
--   - insert any area, pincode, delivery coverage or coordinates.
-- Areas for Saran must be created by an admin in the Admin Panel from verified
-- information. See docs/SERVICE_AREA_SARAN.md.
--
-- Reversible: supabase/rollbacks/0058_saran_default_district.down.sql
-- Re-runnable: ALTER COLUMN ... SET DEFAULT is idempotent.
-- ============================================================================

alter table public.areas alter column district set default 'Saran';

comment on column public.areas.district is
  'District the area belongs to. Default for new areas: Saran (Bihar). Existing rows are not changed by migration 0058.';

-- ============================================================================
-- END OF MIGRATION — schema default only; no business data read or modified.
-- ============================================================================
