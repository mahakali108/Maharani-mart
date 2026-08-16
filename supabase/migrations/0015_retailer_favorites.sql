-- ============================================================================
-- 0015: retailer_favorites — retailer wishlist/favourite products
--
-- Mandatory audit context: the Retailer Ordering & Account upgrade includes
-- a favourites/wishlist feature, which no existing table or column can
-- represent:
--   - cart_items          — order-intent semantics; it converts into orders
--                           at checkout and is cleared on order placement.
--                           Re-using it as a wishlist would corrupt the cart.
--   - profiles / retailers — fixed-column business tables, no JSON scratch
--                            column exists for lists like this.
-- This migration therefore creates the smallest possible dedicated table:
-- one row per (retailer, product) favourite. It is intentionally a
-- product-level link (not pack-level): the wishlist answers "which products
-- does this shop reorder habitually", and pack choice happens at order time
-- (packs change activation/price independently of interest in the product).
--
-- Safety: CREATE IF NOT EXISTS / DROP POLICY IF EXISTS make this re-runnable;
-- no existing table, column, RLS policy, or migration is touched. RLS is
-- enabled with the exact same ownership pattern as cart_items ("cart_owner"):
-- a retailer reads/writes ONLY their own favourites; staff+ get read access
-- (same as other retailer-scoped tables) — writes stay owner-only.
-- ============================================================================

create table if not exists retailer_favorites (
  id uuid primary key default uuid_generate_v4(),
  retailer_id uuid not null references retailers(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (retailer_id, product_id)
);

create index if not exists idx_retailer_favorites_retailer on retailer_favorites(retailer_id);
create index if not exists idx_retailer_favorites_product on retailer_favorites(product_id);

alter table retailer_favorites enable row level security;

drop policy if exists "retailer_favorites_owner_read" on retailer_favorites;
create policy "retailer_favorites_owner_read" on retailer_favorites
  for select using (retailer_id = auth.uid() or is_staff_or_above());

drop policy if exists "retailer_favorites_owner_insert" on retailer_favorites;
create policy "retailer_favorites_owner_insert" on retailer_favorites
  for insert with check (retailer_id = auth.uid());

drop policy if exists "retailer_favorites_owner_delete" on retailer_favorites;
create policy "retailer_favorites_owner_delete" on retailer_favorites
  for delete using (retailer_id = auth.uid());

-- No update policy: a favourite link has no mutable payload — it is only
-- ever inserted or removed, so UPDATE remains denied for everyone.

-- ============================================================================
-- END OF MIGRATION — no business data inserted, existing RLS untouched.
-- ============================================================================
