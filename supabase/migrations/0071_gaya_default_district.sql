-- 0071: Set the district for NEW admin-created service areas to Gaya, Bihar.
-- This deliberately does not rewrite existing areas, addresses, orders, or
-- declare any PIN code/locality serviceable. Coverage remains admin-configured.
-- Additive, no data deletion; review and apply only through the approved process.
alter table public.areas alter column district set default 'Gaya';

comment on column public.areas.district is
  'District for this configured service area. New areas default to Gaya; existing rows are preserved and are not implicitly serviceable by this default.';
