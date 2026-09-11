-- ============================================================================
-- 0032: retailer_addresses — saved delivery address book for retailers
--
-- WHY
-- ---
-- The Retailer Account upgrade adds a multiple-saved-addresses feature with
-- a default address and address selection during checkout. Today the only
-- delivery location is the single free-text `retailers.address` column, which
-- cannot represent several shops/godowns or per-address contact details.
--
-- SAFETY
-- ------
-- - Additive only: CREATE IF NOT EXISTS / DROP POLICY IF EXISTS, re-runnable.
-- - No existing table, column, policy or default is modified.
-- - RLS mirrors the cart_items / retailer_favorites ownership pattern:
--   a retailer reads/writes ONLY their own addresses; staff+ keep read
--   access (same as every retailer-scoped table). Writes stay owner-only.
-- - `retailers.address` remains the fallback when the book is empty, so
--   checkout and existing admin screens never break.
-- ============================================================================

create table if not exists retailer_addresses (
  id uuid primary key default uuid_generate_v4(),
  retailer_id uuid not null references retailers(id) on delete cascade,
  label text not null default 'Shop',
  receiver_name text not null,
  phone text not null,
  line1 text not null,
  line2 text,
  landmark text,
  city text not null,
  district text,
  state text not null default 'Bihar',
  pincode text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint retailer_addresses_label_len check (char_length(btrim(label)) between 1 and 40),
  constraint retailer_addresses_receiver_len check (char_length(btrim(receiver_name)) between 1 and 120),
  constraint retailer_addresses_phone_len check (char_length(btrim(phone)) between 5 and 20),
  constraint retailer_addresses_line1_len check (char_length(btrim(line1)) between 3 and 200),
  constraint retailer_addresses_pincode_fmt check (pincode ~ '^[0-9]{6}$')
);

create index if not exists idx_retailer_addresses_retailer
  on retailer_addresses(retailer_id);

alter table retailer_addresses enable row level security;

drop policy if exists "retailer_addresses_owner_read" on retailer_addresses;
create policy "retailer_addresses_owner_read" on retailer_addresses
  for select using (retailer_id = auth.uid() or is_staff_or_above());

drop policy if exists "retailer_addresses_owner_insert" on retailer_addresses;
create policy "retailer_addresses_owner_insert" on retailer_addresses
  for insert with check (retailer_id = auth.uid());

drop policy if exists "retailer_addresses_owner_update" on retailer_addresses;
create policy "retailer_addresses_owner_update" on retailer_addresses
  for update using (retailer_id = auth.uid())
  with check (retailer_id = auth.uid());

drop policy if exists "retailer_addresses_owner_delete" on retailer_addresses;
create policy "retailer_addresses_owner_delete" on retailer_addresses
  for delete using (retailer_id = auth.uid());

-- ============================================================================
-- END OF MIGRATION — no business data inserted, existing RLS untouched.
-- ============================================================================
