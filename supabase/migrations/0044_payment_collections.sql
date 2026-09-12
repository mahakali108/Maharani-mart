-- ============================================================================
-- 0044: Payment collections (Phase 4 — sales executive collection workflow)
--
-- WHY
-- ---
-- Only admins could record wallet payments. Sales executives collect cash
-- in the field; those collections need their own record with WHO collected,
-- method, reference, optional photo proof, and an admin verification step
-- before the money is credited to the retailer's wallet ledger.
--
-- MODEL
-- ---
-- * A collection starts `pending`. It does NOT touch the wallet.
-- * Admin verification (verifyCollectionAction) writes the PAYMENT_CREDIT
--   row through the existing retailer_wallet_ledger with a deterministic
--   idempotency key (`collection:<id>`) and links ledger_entry_id — the
--   retailer's outstanding falls only when finance confirms the money.
-- * Rejection records the reason; nothing is credited.
-- * Status is one-way: pending → verified | rejected, enforced by a BEFORE
--   UPDATE trigger (not just the app) — money state must never depend on
--   client cooperation. No deletes.
-- * proof_url stores an OBJECT PATH in the private `payment-proofs`
--   bucket (migration 0045), never a public URL.
-- * ledger_entry_id is a real FK to retailer_wallet_ledger: a verified
--   collection always links the PAYMENT_CREDIT row that verification wrote.
--
-- RLS:
--   admin+      read + insert (back-office corrections; the wallet is still
--               credited ONLY by the verification step, never by the insert)
--               + update (verification)
--   retailer    read-only, own collections — NO insert/update/delete
--   salesman    insert ONLY for retailers assigned to them (0014 helper);
--               read own collected rows
--   staff       no access (collections are a sales-executive/finance concern)
--
-- SAFETY: additive & re-runnable; append-only; audited via log_audit().
-- ============================================================================

create table if not exists payment_collections (
  id uuid primary key default uuid_generate_v4(),
  retailer_id uuid not null references retailers(id) on delete cascade,
  order_id uuid references orders(id) on delete set null,
  collected_by uuid not null references profiles(id),
  amount_paise bigint not null,
  method text not null,
  reference_number text,
  proof_url text,
  notes text,
  status text not null default 'pending',
  verified_by uuid references profiles(id),
  verified_at timestamptz,
  ledger_entry_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_collections_amount_check
    check (amount_paise > 0 and amount_paise <= 100000000000),
  constraint payment_collections_method_check
    check (method in ('cash', 'bank_transfer', 'upi', 'cheque', 'other')),
  constraint payment_collections_status_check
    check (status in ('pending', 'verified', 'rejected')),
  constraint payment_collections_reference_len
    check (reference_number is null or char_length(btrim(reference_number)) <= 100),
  constraint payment_collections_notes_len
    check (notes is null or char_length(btrim(notes)) <= 500)
);

create index if not exists idx_payment_collections_retailer on payment_collections(retailer_id, status);
create index if not exists idx_payment_collections_collector on payment_collections(collected_by, status);

alter table payment_collections enable row level security;

-- Retailer: own rows. Salesman: rows they collected. Admin+: everything.
drop policy if exists "payment_collections_read" on payment_collections;
create policy "payment_collections_read" on payment_collections
  for select using (
    retailer_id = auth.uid()
    or collected_by = auth.uid()
    or is_admin_or_above()
  );

-- A salesman records a collection only for a retailer assigned to them.
-- Admin+ may also insert (back-office corrections on behalf of the field);
-- the wallet is still credited only by verification, so this grants no
-- money movement. Every row starts `pending`: a pre-verified insert would
-- skip the ledger credit, so the status is pinned here, not just in the app.
-- (Renamed from payment_collections_salesman_insert: the old name is dropped
-- so a re-run converges instead of stacking a redundant policy.)
drop policy if exists "payment_collections_salesman_insert" on payment_collections;
drop policy if exists "payment_collections_authorized_insert" on payment_collections;
create policy "payment_collections_authorized_insert" on payment_collections
  for insert with check (
    status = 'pending'
    and (
      is_admin_or_above()
      or (
        current_user_role() = 'salesman'
        and collected_by = auth.uid()
        and is_retailer_assigned_to_current_salesman(retailer_id)
      )
    )
  );

-- Verification is admin-only (finance). Salesmen can never flip a status.
drop policy if exists "payment_collections_admin_update" on payment_collections;
create policy "payment_collections_admin_update" on payment_collections
  for update using (is_admin_or_above())
  with check (is_admin_or_above());

-- No DELETE policy: collections are money history.

-- ledger_entry_id links the PAYMENT_CREDIT row written at verification.
-- Nullable (pending rows have none yet); set-null on the impossible delete
-- keeps the collection readable as money history either way.
alter table payment_collections drop constraint if exists payment_collections_ledger_entry_fk;
alter table payment_collections
  add constraint payment_collections_ledger_entry_fk
  foreign key (ledger_entry_id) references retailer_wallet_ledger(id) on delete set null;

-- One-way status: pending → verified | rejected. Same-status updates are
-- legal no-ops (lets admin touch notes without tripping the machine).
create or replace function enforce_collection_status_oneway() returns trigger as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if not (old.status = 'pending' and new.status in ('verified', 'rejected')) then
    raise exception 'INVALID_COLLECTION_STATUS_TRANSITION: % -> %', old.status, new.status
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_enforce_collection_status_oneway on payment_collections;
create trigger trg_enforce_collection_status_oneway
  before update of status on payment_collections
  for each row execute function enforce_collection_status_oneway();

drop trigger if exists trg_audit_payment_collections on payment_collections;
create trigger trg_audit_payment_collections after insert or update or delete on payment_collections
  for each row execute function log_audit();

-- ============================================================================
-- END OF MIGRATION — no business data inserted.
-- ============================================================================
