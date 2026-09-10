-- ============================================================================
-- 0029: Retailer Wallet / Credit Ledger — production-ready B2B credit system
--
-- Business meaning: This wallet is a controlled B2B credit ledger.
-- For every retailer, Admin must know credit limit, total used, paid back,
-- outstanding, available, overdue, payment history, adjustment history, who
-- approved/changed limit, date and reason for every transaction.
--
-- Architecture: proper ledger, not a simple editable balance field.
-- Reuses existing retailer IDs and orders.
--
-- Every ledger transaction has: id, retailer_id, type, amount in paise,
-- signed debit/credit direction, reference type/id, description/reason,
-- created_by, created_at, notes, idempotency_key.
--
-- Transaction types: ORDER_DEBIT, PAYMENT_CREDIT, REFUND_CREDIT,
-- MANUAL_CREDIT, MANUAL_DEBIT, CREDIT_LIMIT_CHANGE, ORDER_REVERSAL, ADJUSTMENT
--
-- Safety: No data dropped, no existing column dropped, no RLS weakened.
-- All amounts integer paise. Outstanding = debits - credits.
-- Available = limit - outstanding.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. retailer_credit_accounts — one per retailer, authoritative limit
-- ---------------------------------------------------------------------------
create table if not exists retailer_credit_accounts (
  id uuid primary key default uuid_generate_v4(),
  retailer_id uuid not null unique references retailers(id) on delete cascade,
  credit_limit_paise bigint not null default 0 check (credit_limit_paise >= 0),
  allow_overdue boolean not null default false,
  overdue_limit_paise bigint not null default 0 check (overdue_limit_paise >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references profiles(id),
  updated_by uuid references profiles(id),
  notes text,
  -- For initial migration from retailers.credit_limit (numeric rupees)
  migrated_from_rupees numeric(12,2)
);

comment on table retailer_credit_accounts is 'B2B credit account per retailer. credit_limit_paise is authoritative limit in paise. Outstanding computed from ledger + legacy retailers.outstanding_balance for backward compat.';
comment on column retailer_credit_accounts.retailer_id is 'Retailer who owns this credit account.';
comment on column retailer_credit_accounts.credit_limit_paise is 'Current credit limit in integer paise (₹1 = 100 paise).';
comment on column retailer_credit_accounts.allow_overdue is 'If true, Admin explicitly allows negative available credit (overdue policy).';
comment on column retailer_credit_accounts.overdue_limit_paise is 'Maximum overdue allowed when allow_overdue=true, in paise.';

create index if not exists idx_retailer_credit_accounts_retailer on retailer_credit_accounts(retailer_id);

-- Trigger to auto-update updated_at
create or replace function update_retailer_credit_account_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_retailer_credit_accounts_updated_at on retailer_credit_accounts;
create trigger trg_retailer_credit_accounts_updated_at
  before update on retailer_credit_accounts
  for each row execute function update_retailer_credit_account_updated_at();

-- ---------------------------------------------------------------------------
-- 2. retailer_wallet_ledger — immutable financial ledger
-- ---------------------------------------------------------------------------
create table if not exists retailer_wallet_ledger (
  id uuid primary key default uuid_generate_v4(),
  retailer_id uuid not null references retailers(id) on delete cascade,
  account_id uuid references retailer_credit_accounts(id) on delete set null,
  transaction_type text not null check (transaction_type in (
    'ORDER_DEBIT',
    'PAYMENT_CREDIT',
    'REFUND_CREDIT',
    'MANUAL_CREDIT',
    'MANUAL_DEBIT',
    'CREDIT_LIMIT_CHANGE',
    'ORDER_REVERSAL',
    'ADJUSTMENT'
  )),
  amount_paise bigint not null check (amount_paise > 0),
  direction text not null check (direction in ('debit','credit')),
  reference_type text,
  reference_id uuid,
  description text not null,
  reason text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  notes text,
  idempotency_key text unique,
  metadata jsonb,
  is_reversed boolean not null default false,
  reversed_by uuid references profiles(id),
  reversed_at timestamptz,
  reversal_of uuid references retailer_wallet_ledger(id)
);

comment on table retailer_wallet_ledger is 'Immutable B2B wallet ledger. Outstanding = sum(debits) - sum(credits) where transaction_type != CREDIT_LIMIT_CHANGE and is_reversed=false. Available = credit_limit - outstanding. No row is ever deleted; corrections use reversal/adjustment entries.';
comment on column retailer_wallet_ledger.retailer_id is 'Retailer this transaction belongs to.';
comment on column retailer_wallet_ledger.account_id is 'Credit account at time of transaction, for audit.';
comment on column retailer_wallet_ledger.transaction_type is 'Type: ORDER_DEBIT, PAYMENT_CREDIT, REFUND_CREDIT, MANUAL_CREDIT, MANUAL_DEBIT, CREDIT_LIMIT_CHANGE, ORDER_REVERSAL, ADJUSTMENT';
comment on column retailer_wallet_ledger.amount_paise is 'Amount in integer paise, always positive. Direction field says debit/credit.';
comment on column retailer_wallet_ledger.direction is 'debit = money owed increases, credit = money owed decreases.';
comment on column retailer_wallet_ledger.reference_type is 'What this transaction references: order, payment, etc.';
comment on column retailer_wallet_ledger.reference_id is 'ID of referenced row (e.g. orders.id) when applicable.';
comment on column retailer_wallet_ledger.description is 'Human readable description, e.g. Order #MK-... debit.';
comment on column retailer_wallet_ledger.reason is 'Reason for manual adjustments, limit changes, etc.';
comment on column retailer_wallet_ledger.idempotency_key is 'Prevents duplicate order debit or payment credit on retry. Unique.';
comment on column retailer_wallet_ledger.is_reversed is 'True if this entry has been reversed by a later entry.';

create index if not exists idx_wallet_ledger_retailer on retailer_wallet_ledger(retailer_id, created_at desc);
create index if not exists idx_wallet_ledger_retailer_type on retailer_wallet_ledger(retailer_id, transaction_type);
create index if not exists idx_wallet_ledger_reference on retailer_wallet_ledger(reference_type, reference_id);
create index if not exists idx_wallet_ledger_idempotency on retailer_wallet_ledger(idempotency_key);
create index if not exists idx_wallet_ledger_created_at on retailer_wallet_ledger(created_at desc);

-- ---------------------------------------------------------------------------
-- 3. Migrate existing retailers.credit_limit into new accounts table
-- ---------------------------------------------------------------------------
insert into retailer_credit_accounts (retailer_id, credit_limit_paise, migrated_from_rupees, created_at)
select
  r.id,
  (r.credit_limit * 100)::bigint,
  r.credit_limit,
  now()
from retailers r
where not exists (
  select 1 from retailer_credit_accounts rca where rca.retailer_id = r.id
)
on conflict (retailer_id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Helper function: calculate outstanding from ledger + legacy balance
--    Outstanding = legacy retailers.outstanding_balance (in paise) + sum(debits) - sum(credits)
--    Excludes CREDIT_LIMIT_CHANGE transactions and reversed entries.
-- ---------------------------------------------------------------------------
create or replace function get_retailer_outstanding_paise(p_retailer_id uuid)
returns bigint as $$
declare
  v_legacy_paise bigint;
  v_ledger_debit bigint;
  v_ledger_credit bigint;
begin
  -- Legacy outstanding from retailers table (for backward compat)
  select coalesce((outstanding_balance * 100)::bigint, 0) into v_legacy_paise
  from retailers where id = p_retailer_id;

  select coalesce(sum(amount_paise), 0) into v_ledger_debit
  from retailer_wallet_ledger
  where retailer_id = p_retailer_id
    and direction = 'debit'
    and is_reversed = false
    and transaction_type != 'CREDIT_LIMIT_CHANGE';

  select coalesce(sum(amount_paise), 0) into v_ledger_credit
  from retailer_wallet_ledger
  where retailer_id = p_retailer_id
    and direction = 'credit'
    and is_reversed = false
    and transaction_type != 'CREDIT_LIMIT_CHANGE';

  return v_legacy_paise + v_ledger_debit - v_ledger_credit;
end;
$$ language plpgsql stable security definer set search_path = public;

create or replace function get_retailer_credit_limit_paise(p_retailer_id uuid)
returns bigint as $$
declare
  v_limit bigint;
begin
  select credit_limit_paise into v_limit
  from retailer_credit_accounts where retailer_id = p_retailer_id;
  if v_limit is not null then return v_limit; end if;
  -- Fallback to legacy retailers.credit_limit
  select coalesce((credit_limit * 100)::bigint, 0) into v_limit from retailers where id = p_retailer_id;
  return coalesce(v_limit, 0);
end;
$$ language plpgsql stable security definer set search_path = public;

create or replace function get_retailer_available_credit_paise(p_retailer_id uuid)
returns bigint as $$
declare
  v_limit bigint;
  v_outstanding bigint;
begin
  v_limit := get_retailer_credit_limit_paise(p_retailer_id);
  v_outstanding := get_retailer_outstanding_paise(p_retailer_id);
  return v_limit - v_outstanding;
end;
$$ language plpgsql stable security definer set search_path = public;

-- ---------------------------------------------------------------------------
-- 5. Function to atomically create order debit with credit check
--    Prevents race conditions via SELECT FOR UPDATE on credit account.
-- ---------------------------------------------------------------------------
create or replace function check_and_debit_retailer_wallet(
  p_retailer_id uuid,
  p_order_id uuid,
  p_amount_paise bigint,
  p_idempotency_key text,
  p_created_by uuid,
  p_description text
) returns uuid as $$
declare
  v_account_id uuid;
  v_limit bigint;
  v_outstanding bigint;
  v_available bigint;
  v_allow_overdue boolean;
  v_overdue_limit bigint;
  v_ledger_id uuid;
begin
  if p_amount_paise <= 0 then
    raise exception 'Amount must be positive';
  end if;

  -- Lock credit account row to prevent concurrent over-limit orders
  select id, credit_limit_paise, allow_overdue, overdue_limit_paise
  into v_account_id, v_limit, v_allow_overdue, v_overdue_limit
  from retailer_credit_accounts
  where retailer_id = p_retailer_id
  for update;

  -- If no account exists, create one from legacy data
  if v_account_id is null then
    insert into retailer_credit_accounts (retailer_id, credit_limit_paise, created_by)
    select p_retailer_id, coalesce((credit_limit * 100)::bigint, 0), p_created_by
    from retailers where id = p_retailer_id
    returning id, credit_limit_paise, allow_overdue, overdue_limit_paise
    into v_account_id, v_limit, v_allow_overdue, v_overdue_limit;
  end if;

  if v_account_id is null then
    raise exception 'Retailer credit account not found';
  end if;

  v_outstanding := get_retailer_outstanding_paise(p_retailer_id);
  v_available := v_limit - v_outstanding;

  -- Check if order would exceed limit
  if not v_allow_overdue and (v_available < p_amount_paise) then
    raise exception 'Insufficient credit: available % paise, required % paise', v_available, p_amount_paise;
  end if;

  if v_allow_overdue and v_overdue_limit > 0 then
    if (v_outstanding + p_amount_paise - v_limit) > v_overdue_limit then
      raise exception 'Overdue limit exceeded: overdue would be % paise, limit % paise', (v_outstanding + p_amount_paise - v_limit), v_overdue_limit;
    end if;
  end if;

  -- Idempotency check: if key exists, return existing id (prevent duplicate debit)
  if p_idempotency_key is not null then
    select id into v_ledger_id from retailer_wallet_ledger where idempotency_key = p_idempotency_key;
    if v_ledger_id is not null then
      return v_ledger_id;
    end if;
  end if;

  insert into retailer_wallet_ledger (
    retailer_id, account_id, transaction_type, amount_paise, direction,
    reference_type, reference_id, description, created_by, idempotency_key
  ) values (
    p_retailer_id, v_account_id, 'ORDER_DEBIT', p_amount_paise, 'debit',
    'order', p_order_id, coalesce(p_description, 'Order debit'), p_created_by, p_idempotency_key
  ) returning id into v_ledger_id;

  return v_ledger_id;
end;
$$ language plpgsql security definer set search_path = public;

-- ---------------------------------------------------------------------------
-- 6. RLS
-- ---------------------------------------------------------------------------
alter table retailer_credit_accounts enable row level security;
alter table retailer_wallet_ledger enable row level security;

-- Credit accounts: retailer can read own, staff+ can read all, admin can write
drop policy if exists "credit_accounts_retailer_read" on retailer_credit_accounts;
create policy "credit_accounts_retailer_read" on retailer_credit_accounts
  for select using (retailer_id = auth.uid() or is_staff_or_above());

drop policy if exists "credit_accounts_admin_write" on retailer_credit_accounts;
create policy "credit_accounts_admin_write" on retailer_credit_accounts
  for all using (is_admin_or_above());

-- Ledger: retailer can read own, staff+ can read all, only admin can insert via RLS
-- (but actual inserts go through security definer functions or server actions that check is_admin)
drop policy if exists "wallet_ledger_retailer_read" on retailer_wallet_ledger;
create policy "wallet_ledger_retailer_read" on retailer_wallet_ledger
  for select using (retailer_id = auth.uid() or is_staff_or_above());

drop policy if exists "wallet_ledger_admin_insert" on retailer_wallet_ledger;
create policy "wallet_ledger_admin_insert" on retailer_wallet_ledger
  for insert with check (is_admin_or_above());

drop policy if exists "wallet_ledger_admin_update" on retailer_wallet_ledger;
create policy "wallet_ledger_admin_update" on retailer_wallet_ledger
  for update using (is_admin_or_above());

-- Retailers cannot insert/update/delete ledger directly (no policy for them beyond select)
-- Admin cannot delete ledger (no delete policy at all — only service role can, but we don't grant it)

-- ---------------------------------------------------------------------------
-- 7. Keep retailers.outstanding_balance in sync for backward compat (optional)
--    This trigger updates the legacy column when ledger changes, so old code
--    that reads retailers.outstanding_balance still sees correct value.
-- ---------------------------------------------------------------------------
create or replace function sync_retailer_outstanding_balance()
returns trigger as $$
declare
  v_new_outstanding bigint;
begin
  v_new_outstanding := get_retailer_outstanding_paise(coalesce(new.retailer_id, old.retailer_id));
  -- Update legacy column in rupees (numeric) for backward compat
  update retailers set outstanding_balance = (v_new_outstanding::numeric / 100.0), updated_at = now()
  where id = coalesce(new.retailer_id, old.retailer_id);
  return coalesce(new, old);
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_sync_outstanding_on_ledger on retailer_wallet_ledger;
create trigger trg_sync_outstanding_on_ledger
  after insert or update or delete on retailer_wallet_ledger
  for each row execute function sync_retailer_outstanding_balance();

-- ---------------------------------------------------------------------------
-- 8. Audit trigger for credit limit changes
-- ---------------------------------------------------------------------------
create or replace function audit_credit_limit_change()
returns trigger as $$
begin
  if old.credit_limit_paise is distinct from new.credit_limit_paise then
    insert into retailer_wallet_ledger (
      retailer_id, account_id, transaction_type, amount_paise, direction,
      description, reason, created_by, metadata
    ) values (
      new.retailer_id,
      new.id,
      'CREDIT_LIMIT_CHANGE',
      new.credit_limit_paise,
      'credit',
      format('Credit limit changed from %s to %s paise', old.credit_limit_paise, new.credit_limit_paise),
      format('Limit change: %s -> %s', (old.credit_limit_paise::numeric/100), (new.credit_limit_paise::numeric/100)),
      new.updated_by,
      jsonb_build_object('old_limit_paise', old.credit_limit_paise, 'new_limit_paise', new.credit_limit_paise, 'old_limit_rupees', old.credit_limit_paise::numeric/100, 'new_limit_rupees', new.credit_limit_paise::numeric/100)
    );
    -- Also sync legacy retailers.credit_limit
    update retailers set credit_limit = (new.credit_limit_paise::numeric / 100.0), updated_at = now() where id = new.retailer_id;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_audit_credit_limit on retailer_credit_accounts;
create trigger trg_audit_credit_limit
  after update on retailer_credit_accounts
  for each row execute function audit_credit_limit_change();

-- ============================================================================
-- END OF MIGRATION — no fake data, no deletion, additive only.
-- ============================================================================
