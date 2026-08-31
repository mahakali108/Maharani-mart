-- ============================================================================
-- 0022: Case-based pricing (case is the primary pricing unit)
--
-- Pricing model change:
--   - The CASE is the primary selling unit. Each sellable pack carries a
--     fixed, GST-INCLUSIVE `case_price` (the source of truth). The per-piece
--     selling price is ALWAYS derived (case_price / units_per_case) and is
--     never stored or entered manually.
--   - Quantity-based pricing lives in `product_pricing_tiers`: each tier is a
--     half-open [min_quantity, max_quantity) range (in PIECES) with its own
--     GST-inclusive price_per_piece. Priority is predictable — the matching
--     tier with the largest min_quantity wins.
--   - Selling prices are GST-INCLUSIVE. GST is extracted (not added) at
--     checkout / invoice time.
--
-- Migration safety:
--   - No columns are dropped. Legacy `base_price` (MRP), `ptr`,
--     `wholesale_price`, `cost_price` stay on `product_packs` for backward
--     compatibility with reports / AI tooling.
--   - `case_price` is backfilled from the previous effective pack price so
--     existing products continue to be billed the same amount they were
--     before: case_price = (ptr ?? base_price) * (1 + gst_percent/100).
--   - A `default` pricing tier is created for every existing pack so the
--     legacy single-price behaviour is preserved until an admin adds tiers.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. product_packs.case_price — the fixed GST-inclusive case selling price
-- ----------------------------------------------------------------------------
alter table product_packs add column case_price numeric(12,2);

comment on column product_packs.case_price is
  'Fixed GST-INCLUSIVE selling price of ONE full case. Source of truth for pricing. Per-piece price is derived (case_price / units_per_case), never stored.';

-- Backfill from the previous effective per-pack price so existing products
-- keep charging the same GST-inclusive amount they charged before.
update product_packs pp
set case_price = round(
  (coalesce(pp.ptr, pp.base_price) * (1 + coalesce(p.gst_percent, 0) / 100)),
  2
)
from products p
where p.id = pp.product_id;

-- Any pack that could not be mapped falls back to its base price (GST-inclusive).
update product_packs
set case_price = round(base_price * (1 + 0), 2)
where case_price is null or case_price < 0;

alter table product_packs
  alter column case_price set not null;

alter table product_packs
  add constraint product_packs_case_price_non_negative check (case_price >= 0);

-- ----------------------------------------------------------------------------
-- 2. product_pricing_tiers — quantity slabs (in pieces), GST-inclusive rates
-- ----------------------------------------------------------------------------
create table product_pricing_tiers (
  id uuid primary key default uuid_generate_v4(),
  product_pack_id uuid not null references product_packs(id) on delete cascade,
  min_quantity int not null check (min_quantity >= 1),
  max_quantity int,                     -- NULL = unbounded (last tier)
  price_per_piece numeric(12,2) not null check (price_per_piece >= 0),
  rule_type text not null default 'bulk'
    check (rule_type in ('default', 'case', 'bulk')),
  label text,
  is_active boolean not null default true,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_pricing_tiers_min_lt_max check (
    max_quantity is null or max_quantity > min_quantity
  )
);

comment on column product_pricing_tiers.min_quantity is
  'Minimum pieces for this tier (inclusive). Evaluated on total pieces = pack quantity * units_per_case.';
comment on column product_pricing_tiers.max_quantity is
  'Upper exclusive bound (pieces) for this tier. NULL = unbounded (last tier). Half-open [min_quantity, max_quantity).';
comment on column product_pricing_tiers.price_per_piece is
  'GST-INCLUSIVE selling price per piece within this tier.';

create index idx_product_pricing_tiers_pack on product_pricing_tiers(product_pack_id, min_quantity);

alter table product_pricing_tiers enable row level security;

-- Retailers/anyone authenticated can read active tiers; staff+ can write.
create policy "product_pricing_tiers_read" on product_pricing_tiers
  for select using (is_active or is_staff_or_above());
create policy "product_pricing_tiers_insert" on product_pricing_tiers
  for insert with check (is_staff_or_above());
create policy "product_pricing_tiers_update" on product_pricing_tiers
  for update using (is_staff_or_above());
create policy "product_pricing_tiers_delete" on product_pricing_tiers
  for delete using (is_admin_or_above());

create trigger trg_audit_product_pricing_tiers after insert or update or delete on product_pricing_tiers
  for each row execute function log_audit();

-- ----------------------------------------------------------------------------
-- 3. Backfill a default tier per existing pack so legacy single-price packs
--    continue to work unchanged (piece price = case_price / units_per_case).
-- ----------------------------------------------------------------------------
insert into product_pricing_tiers
  (product_pack_id, min_quantity, max_quantity, price_per_piece, rule_type, label)
select
  pp.id,
  1,
  null,
  round(pp.case_price / greatest(pp.units_per_case, 1), 2),
  'default',
  'Default'
from product_packs pp;

-- ============================================================================
-- END OF MIGRATION — no further seed data.
-- ============================================================================
