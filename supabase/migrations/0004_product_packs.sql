-- ============================================================================
-- 0004: Product Packs (pack-size variants of a base product)
-- e.g. a base product "Sunflower Oil" might have packs: 200ml / 500ml / 1L / 5L,
-- each with its own SKU, price, and units-per-case, but sharing brand/category/
-- images/GST from the parent product. This is the FMCG-relevant "variant"
-- concept for this business, rather than generic e-commerce variants
-- (color/size), which don't apply to wholesale grocery distribution.
-- ============================================================================

create table product_packs (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid not null references products(id) on delete cascade,
  pack_name text not null,            -- e.g. '200ml', '500g', '1kg', '5L Jar'
  pack_sku_code text not null unique,
  units_per_case int not null default 1,
  base_price numeric(12,2) not null,
  cost_price numeric(12,2),
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_product_packs_product on product_packs(product_id);

alter table product_packs enable row level security;

create policy "product_packs_read" on product_packs for select using (is_active or is_staff_or_above());
create policy "product_packs_write" on product_packs for insert with check (is_staff_or_above());
create policy "product_packs_update" on product_packs for update using (is_staff_or_above());
create policy "product_packs_delete" on product_packs for delete using (is_admin_or_above());

create trigger trg_audit_product_packs after insert or update or delete on product_packs
  for each row execute function log_audit();

-- ============================================================================
-- END OF MIGRATION — no seed data.
-- ============================================================================
