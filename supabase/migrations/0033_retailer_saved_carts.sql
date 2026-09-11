-- ============================================================================
-- 0033: retailer_saved_carts — named saved carts / save-for-later
--
-- WHY
-- ---
-- The Cart upgrade adds: saving the current cart under a name, saving an
-- individual item for later, restoring a saved cart into the active cart
-- (merge) and deleting saved carts. `cart_items` cannot represent these —
-- it is the single live cart that becomes an order at checkout and is
-- cleared on placement.
--
-- SAFETY
-- ------
-- - Additive only, re-runnable; nothing existing is modified.
-- - Prices are NEVER copied into a saved cart. Only (product, pack, quantity)
--   is stored; restore re-resolves the CURRENT effective price through the
--   same merge path the catalog and reorder flows use, so stale money values
--   structurally cannot re-enter the cart.
-- - RLS mirrors cart_items: retailer_id = auth.uid() on every policy, for
--   both the cart header and its items (items carry a denormalized
--   retailer_id so RLS never needs a cross-table subquery that could be
--   confused by role differences). staff+ keep read access as usual.
-- ============================================================================

create table if not exists retailer_saved_carts (
  id uuid primary key default uuid_generate_v4(),
  retailer_id uuid not null references retailers(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint retailer_saved_carts_name_len check (char_length(btrim(name)) between 1 and 60)
);

create index if not exists idx_retailer_saved_carts_retailer
  on retailer_saved_carts(retailer_id);

create table if not exists retailer_saved_cart_items (
  id uuid primary key default uuid_generate_v4(),
  saved_cart_id uuid not null references retailer_saved_carts(id) on delete cascade,
  retailer_id uuid not null references retailers(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  pack_id uuid not null references product_packs(id) on delete cascade,
  quantity integer not null,
  created_at timestamptz not null default now(),
  constraint retailer_saved_cart_items_qty check (quantity >= 1)
);

create index if not exists idx_retailer_saved_cart_items_cart
  on retailer_saved_cart_items(saved_cart_id);
create index if not exists idx_retailer_saved_cart_items_retailer
  on retailer_saved_cart_items(retailer_id);

alter table retailer_saved_carts enable row level security;
alter table retailer_saved_cart_items enable row level security;

drop policy if exists "retailer_saved_carts_owner_read" on retailer_saved_carts;
create policy "retailer_saved_carts_owner_read" on retailer_saved_carts
  for select using (retailer_id = auth.uid() or is_staff_or_above());

drop policy if exists "retailer_saved_carts_owner_insert" on retailer_saved_carts;
create policy "retailer_saved_carts_owner_insert" on retailer_saved_carts
  for insert with check (retailer_id = auth.uid());

drop policy if exists "retailer_saved_carts_owner_update" on retailer_saved_carts;
create policy "retailer_saved_carts_owner_update" on retailer_saved_carts
  for update using (retailer_id = auth.uid())
  with check (retailer_id = auth.uid());

drop policy if exists "retailer_saved_carts_owner_delete" on retailer_saved_carts;
create policy "retailer_saved_carts_owner_delete" on retailer_saved_carts
  for delete using (retailer_id = auth.uid());

drop policy if exists "retailer_saved_cart_items_owner_read" on retailer_saved_cart_items;
create policy "retailer_saved_cart_items_owner_read" on retailer_saved_cart_items
  for select using (retailer_id = auth.uid() or is_staff_or_above());

drop policy if exists "retailer_saved_cart_items_owner_insert" on retailer_saved_cart_items;
create policy "retailer_saved_cart_items_owner_insert" on retailer_saved_cart_items
  for insert with check (retailer_id = auth.uid());

drop policy if exists "retailer_saved_cart_items_owner_delete" on retailer_saved_cart_items;
create policy "retailer_saved_cart_items_owner_delete" on retailer_saved_cart_items
  for delete using (retailer_id = auth.uid());

-- No UPDATE policy on items: a saved line is only ever added or removed.
-- Editing happens by removing the line and saving the corrected quantity,
-- which keeps the audit story simple and cannot drift.

-- ============================================================================
-- END OF MIGRATION — no business data inserted, existing RLS untouched.
-- ============================================================================
