-- ============================================================================
-- 0035: shop-profile self-service RPC + notification prefs + account requests
--
-- WHY
-- ---
-- 1. The Account upgrade lets a retailer correct their own shop name and
--    address. `retailers` has NO retailer update policy (only
--    retailers_admin_update), deliberately: credit_limit, outstanding_balance,
--    status, area and approval columns must never be retailer-editable. This
--    migration adds the narrowest possible self-service path: a SECURITY
--    DEFINER function that updates ONLY shop_name / address for
--    auth.uid() and cannot touch anything else. No broad policy is added.
-- 2. Notification preferences (order / payment / wallet / offer toggles)
--    need a per-retailer store — a one-row-per-retailer table.
-- 3. The account-deletion / data-export request flow needs a request record
--    that staff can review. Requests are recorded, never self-executed —
--    deletion stays a human, admin-side action, exactly like retailer
--    approval today.
--
-- SAFETY
-- ------
-- - Additive only, re-runnable; no existing table, column or policy changes.
-- - update_my_shop_profile validates lengths, trims, and is tightly scoped;
--   search_path is pinned; EXECUTE is revoked from anon and granted to
--   authenticated only (same hardening pattern as the wallet RPCs).
-- - Preferences and requests follow the standard owner-only RLS pattern.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Self-service shop profile (name + delivery/shop address ONLY)
-- ---------------------------------------------------------------------------
create or replace function update_my_shop_profile(
  p_shop_name text,
  p_address text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_shop_name, ''));
  v_address text := nullif(btrim(coalesce(p_address, '')), '');
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'Shop name must be between 2 and 120 characters';
  end if;
  if v_address is not null and char_length(v_address) > 500 then
    raise exception 'Address must be at most 500 characters';
  end if;

  update retailers
     set shop_name = v_name,
         address = v_address,
         updated_at = now()
   where id = v_uid;

  if not found then
    raise exception 'Retailer profile not found';
  end if;
end;
$$;

revoke all on function update_my_shop_profile(text, text) from public, anon;
grant execute on function update_my_shop_profile(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Notification preferences (one row per retailer; absent row = all on)
-- ---------------------------------------------------------------------------
create table if not exists retailer_notification_prefs (
  retailer_id uuid primary key references retailers(id) on delete cascade,
  order_updates boolean not null default true,
  payment_updates boolean not null default true,
  wallet_updates boolean not null default true,
  offer_updates boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table retailer_notification_prefs enable row level security;

drop policy if exists "retailer_notification_prefs_owner_read" on retailer_notification_prefs;
create policy "retailer_notification_prefs_owner_read" on retailer_notification_prefs
  for select using (retailer_id = auth.uid() or is_staff_or_above());

drop policy if exists "retailer_notification_prefs_owner_write" on retailer_notification_prefs;
create policy "retailer_notification_prefs_owner_write" on retailer_notification_prefs
  for insert with check (retailer_id = auth.uid());

drop policy if exists "retailer_notification_prefs_owner_update" on retailer_notification_prefs;
create policy "retailer_notification_prefs_owner_update" on retailer_notification_prefs
  for update using (retailer_id = auth.uid())
  with check (retailer_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 3. Account requests (deletion / data export) — recorded, staff-reviewed
-- ---------------------------------------------------------------------------
create table if not exists retailer_account_requests (
  id uuid primary key default uuid_generate_v4(),
  retailer_id uuid not null references retailers(id) on delete cascade,
  request_type text not null,
  note text,
  status text not null default 'submitted',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint retailer_account_requests_type_check
    check (request_type in ('account_deletion', 'data_export')),
  constraint retailer_account_requests_status_check
    check (status in ('submitted', 'reviewing', 'completed', 'rejected')),
  constraint retailer_account_requests_note_len
    check (note is null or char_length(btrim(note)) <= 500)
);

create index if not exists idx_retailer_account_requests_retailer
  on retailer_account_requests(retailer_id);

alter table retailer_account_requests enable row level security;

drop policy if exists "retailer_account_requests_owner_insert" on retailer_account_requests;
create policy "retailer_account_requests_owner_insert" on retailer_account_requests
  for insert with check (retailer_id = auth.uid());

drop policy if exists "retailer_account_requests_owner_read" on retailer_account_requests;
create policy "retailer_account_requests_owner_read" on retailer_account_requests
  for select using (retailer_id = auth.uid() or is_staff_or_above());

drop policy if exists "retailer_account_requests_staff_update" on retailer_account_requests;
create policy "retailer_account_requests_staff_update" on retailer_account_requests
  for update using (is_staff_or_above())
  with check (is_staff_or_above());

-- ============================================================================
-- END OF MIGRATION — no business data inserted, existing RLS untouched.
-- ============================================================================
