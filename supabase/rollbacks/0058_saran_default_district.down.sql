-- ============================================================================
-- ROLLBACK for migration 0058 (NOT picked up by the migration runner).
-- Restores the previous column default. Changes no rows.
-- Run manually only if the Saran default must be reverted.
-- ============================================================================
alter table public.areas alter column district set default 'Khagaria';
comment on column public.areas.district is null;
