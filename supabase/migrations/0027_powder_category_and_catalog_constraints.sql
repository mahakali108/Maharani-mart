-- 0027: Powder catalog enablement and variant integrity
-- Uses the existing categories/product_packs model. No products or prices are seeded.

insert into public.categories (name, parent_id, is_active)
select 'Powder', null, true
where not exists (
  select 1 from public.categories
  where lower(trim(name)) = 'powder' and parent_id is null
);

-- Category names are case-insensitively unique within a parent. The existing
-- named constraint remains for compatibility; this closes the API path that
-- could otherwise create "powder" beside "Powder".
create unique index if not exists categories_name_parent_ci_uq
  on public.categories (lower(trim(name)), coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- A product cannot have two active variants with the same size label. Historical
-- duplicate/inactive rows are not removed; admins can deactivate them safely.
create unique index if not exists product_packs_active_name_ci_uq
  on public.product_packs (product_id, lower(trim(pack_name)))
  where is_active;

comment on index public.categories_name_parent_ci_uq is
  'Case-insensitive category uniqueness, including the idempotent Powder category.';
comment on index public.product_packs_active_name_ci_uq is
  'Prevents duplicate active size/variant labels within one product.';
