-- ============================================================================
-- 0028: Variant gallery — multiple images per pack (product_packs)
--
-- BUSINESS CHANGE
--   Every product variant (product_packs row) may have its OWN gallery of
--   images — front, back, side, ingredients, usage, alternate angles, etc.
--   The retailer product-detail page shows the selected variant's gallery;
--   when a variant has no gallery it falls back to the parent product's
--   product_images gallery (existing behaviour preserved).
--
-- WHY A NEW TABLE (and not reusing product_packs.image_url)
--   product_packs.image_url holds a single image. A gallery requires ordered
--   multiple images with primary selection, reordering and per-variant
--   ownership. The parent product already has a dedicated ordered gallery
--   table (product_images); a symmetric table for variants keeps the model
--   explicit and avoids overloading product_images with a nullable pack_id
--   that would complicate RLS and reporting queries.
--
-- MIGRATION SAFETY — NOTHING IS DROPPED, EXISTING DATA IS PRESERVED
--   - No column is dropped. product_packs.image_url is kept for backward
--     compatibility: old readers that only know that column keep working.
--   - Every non-empty product_packs.image_url is migrated into the new
--     product_pack_images table as sort_order 0 (the primary), so no image
--     disappears on upgrade and the retailer page keeps showing the same
--     image it showed before.
--   - No storage bucket, storage policy or access path is introduced.
--     Variant gallery images reuse the existing public product-images bucket
--     (lib/media/types.ts kind product-gallery) and its existing RLS.
--   - RLS on the new table mirrors product_images: retailers see gallery
--     images of active products/packs; staff+ can write. No policy is
--     weakened.
--   - All statements are idempotent (IF NOT EXISTS / DROP IF EXISTS) so
--     the migration can be re-run safely.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. product_pack_images — ordered gallery per variant pack
-- ----------------------------------------------------------------------------
create table if not exists product_pack_images (
  id uuid primary key default uuid_generate_v4(),
  product_pack_id uuid not null references product_packs(id) on delete cascade,
  image_url text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

comment on table product_pack_images is
  'Ordered gallery for one product variant (product_packs). sort_order 0 is the primary. Falls back to product_images when empty. Images live in the public product-images bucket (same refs as product_images.image_url).';
comment on column product_pack_images.product_pack_id is
  'Variant whose gallery this image belongs to.';
comment on column product_pack_images.image_url is
  'Supabase Storage public URL in product-images bucket (same format as product_images.image_url). Private paths are not used here.';
comment on column product_pack_images.sort_order is
  'Ordering within the variant gallery. 0 is the primary image shown first and synced to product_packs.image_url for backward compatibility.';

create index if not exists idx_product_pack_images_pack on product_pack_images(product_pack_id, sort_order);
create index if not exists idx_product_pack_images_pack_created on product_pack_images(product_pack_id, created_at);

alter table product_pack_images enable row level security;

drop policy if exists "product_pack_images_read" on product_pack_images;
create policy "product_pack_images_read" on product_pack_images for select using (
  exists (
    select 1 from product_packs pp
    join products p on p.id = pp.product_id
    where pp.id = product_pack_images.product_pack_id
      and (p.is_active or is_staff_or_above())
      and (pp.is_active or is_staff_or_above())
  )
);

drop policy if exists "product_pack_images_staff_insert" on product_pack_images;
create policy "product_pack_images_staff_insert" on product_pack_images for insert with check (is_staff_or_above());

drop policy if exists "product_pack_images_staff_update" on product_pack_images;
create policy "product_pack_images_staff_update" on product_pack_images for update using (is_staff_or_above());

drop policy if exists "product_pack_images_staff_delete" on product_pack_images;
create policy "product_pack_images_staff_delete" on product_pack_images for delete using (is_staff_or_above());

-- ----------------------------------------------------------------------------
-- 2. Migrate existing single variant images into the gallery as primary
--    Each product_packs.image_url becomes the first gallery image. Existing
--    rows that already have gallery images are left untouched.
-- ----------------------------------------------------------------------------
insert into product_pack_images (product_pack_id, image_url, sort_order)
select pp.id, pp.image_url, 0
from product_packs pp
where pp.image_url is not null
  and trim(pp.image_url) <> ''
  and not exists (
    select 1 from product_pack_images ppi where ppi.product_pack_id = pp.id
  )
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- 3. Keep product_packs.image_url in sync with the primary gallery image
--    for backward compatibility with readers that only look at that column.
--    The app writes both: the gallery is the source of truth, the column is
--    a denormalised convenience so no retailer's image disappears even if an
--    older code path is cached.
-- ----------------------------------------------------------------------------
create or replace function sync_product_pack_primary_image()
returns trigger as $$
begin
  -- When a gallery row is inserted/updated/deleted, sync the parent pack's
  -- image_url to the primary (lowest sort_order) gallery image, or NULL when
  -- the gallery becomes empty.
  if (tg_op = 'DELETE') then
    update product_packs
    set image_url = (
      select image_url from product_pack_images
      where product_pack_id = old.product_pack_id
      order by sort_order, created_at
      limit 1
    )
    where id = old.product_pack_id;
    return old;
  else
    update product_packs
    set image_url = (
      select image_url from product_pack_images
      where product_pack_id = new.product_pack_id
      order by sort_order, created_at
      limit 1
    )
    where id = new.product_pack_id;
    return new;
  end if;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_sync_product_pack_primary_image on product_pack_images;
create trigger trg_sync_product_pack_primary_image
  after insert or update or delete on product_pack_images
  for each row execute function sync_product_pack_primary_image();

-- ============================================================================
-- END OF MIGRATION — no bucket, no column, no row is dropped.
-- ============================================================================
