-- ============================================================================
-- 0034: retailer_product_issues + retailer_stock_alerts
--
-- WHY
-- ---
-- The Product Detail upgrade adds "report a problem with this product" and
-- "notify me when available" (availability request / stock alert), plus a
-- stock-alert toggle from the wishlist. No existing table can represent
-- either intent:
--   - return_requests is order-scoped and only for delivered orders;
--   - retailer_favorites is product-level interest, not a pack-level
--     "tell me when this pack is back" request.
--
-- SAFETY
-- ------
-- - Additive only, re-runnable; nothing existing is modified.
-- - Issues: a retailer can create / read / withdraw ONLY their own rows.
--   staff+ can read all and move status forward (review workflow) but
--   retailers can never set status — the check constraint plus the missing
--   retailer update policy make that impossible.
-- - Stock alerts: owner-only rows keyed (retailer, pack); RLS identical in
--   spirit to retailer_favorites. No PII beyond the retailer link.
-- ============================================================================

create table if not exists retailer_product_issues (
  id uuid primary key default uuid_generate_v4(),
  retailer_id uuid not null references retailers(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  pack_id uuid references product_packs(id) on delete set null,
  issue_type text not null,
  message text not null,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint retailer_product_issues_type_check
    check (issue_type in ('wrong_information', 'image_problem', 'pricing_problem', 'stock_problem', 'other')),
  constraint retailer_product_issues_status_check
    check (status in ('open', 'reviewing', 'resolved')),
  constraint retailer_product_issues_message_len
    check (char_length(btrim(message)) between 3 and 1000)
);

create index if not exists idx_retailer_product_issues_retailer
  on retailer_product_issues(retailer_id);
create index if not exists idx_retailer_product_issues_product
  on retailer_product_issues(product_id);

create table if not exists retailer_stock_alerts (
  retailer_id uuid not null references retailers(id) on delete cascade,
  pack_id uuid not null references product_packs(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (retailer_id, pack_id)
);

create index if not exists idx_retailer_stock_alerts_pack
  on retailer_stock_alerts(pack_id);

alter table retailer_product_issues enable row level security;
alter table retailer_stock_alerts enable row level security;

drop policy if exists "retailer_product_issues_owner_insert" on retailer_product_issues;
create policy "retailer_product_issues_owner_insert" on retailer_product_issues
  for insert with check (retailer_id = auth.uid());

drop policy if exists "retailer_product_issues_owner_read" on retailer_product_issues;
create policy "retailer_product_issues_owner_read" on retailer_product_issues
  for select using (retailer_id = auth.uid() or is_staff_or_above());

drop policy if exists "retailer_product_issues_owner_delete" on retailer_product_issues;
create policy "retailer_product_issues_owner_delete" on retailer_product_issues
  for delete using (retailer_id = auth.uid());

drop policy if exists "retailer_product_issues_staff_update" on retailer_product_issues;
create policy "retailer_product_issues_staff_update" on retailer_product_issues
  for update using (is_staff_or_above())
  with check (is_staff_or_above());

drop policy if exists "retailer_stock_alerts_owner_read" on retailer_stock_alerts;
create policy "retailer_stock_alerts_owner_read" on retailer_stock_alerts
  for select using (retailer_id = auth.uid() or is_staff_or_above());

drop policy if exists "retailer_stock_alerts_owner_insert" on retailer_stock_alerts;
create policy "retailer_stock_alerts_owner_insert" on retailer_stock_alerts
  for insert with check (retailer_id = auth.uid());

drop policy if exists "retailer_stock_alerts_owner_delete" on retailer_stock_alerts;
create policy "retailer_stock_alerts_owner_delete" on retailer_stock_alerts
  for delete using (retailer_id = auth.uid());

-- ============================================================================
-- END OF MIGRATION — no business data inserted, existing RLS untouched.
-- ============================================================================
