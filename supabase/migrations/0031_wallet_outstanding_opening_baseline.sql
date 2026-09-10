-- ============================================================================
-- 0031: Fix wallet outstanding double-counting + salesman order-capture access
--
-- PROBLEM FOUND IN REVIEW OF 0029/0030
-- ------------------------------------
-- get_retailer_outstanding_paise() computed:
--     legacy retailers.outstanding_balance*100 + ledger(debits) - ledger(credits)
-- while trg_sync_outstanding_on_ledger rewrote retailers.outstanding_balance to
-- equal that SAME total after every ledger insert. Because the "legacy" column
-- was both an input and an output of the calculation, the ledger was added
-- again on every subsequent read. After a single ₹2000 order debit the balance
-- read ₹4000, after two debits it grew further — real money double-counted.
--
-- FIX
-- ---
-- Freeze the pre-wallet baseline ONCE into
-- retailer_credit_accounts.opening_outstanding_paise, and compute:
--     outstanding = opening_outstanding_paise + ledger(debits) - ledger(credits)
-- The sync trigger keeps mirroring the corrected outstanding into
-- retailers.outstanding_balance so legacy readers (dashboard, command center,
-- AI tools, old credit summary) stay correct without re-reading the ledger.
--
-- SECOND FIX
-- ----------
-- Salesmen capture orders for their assigned retailers through the same
-- createOrderForRetailer path (lib/salesman/order-creation-actions.ts), which
-- calls check_and_debit_retailer_wallet with the SALESMAN's session. 0030's
-- _can_access_retailer_wallet only allowed own-retailer / staff+ / admin, so a
-- salesman's wallet debit was denied ("Access denied") and the order cancelled.
-- Salesman access is now scoped to their assigned retailers only.
--
-- THIRD FIX
-- ---------
-- check_and_debit_retailer_wallet checked idempotency AFTER the credit check.
-- A retried request (same idempotency key) would therefore re-run the credit
-- check against a balance already debited by the first attempt and raise
-- "Insufficient credit" instead of returning the existing ledger id. The
-- idempotency lookup now happens FIRST, and the insert tolerates a concurrent
-- unique-violation by returning the winner's id.
--
-- SAFETY: additive only. No table/column/data dropped. No RLS weakened.
-- Existing grants on the replaced functions are preserved (CREATE OR REPLACE).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Frozen opening baseline on the credit account
-- ---------------------------------------------------------------------------
alter table retailer_credit_accounts
  add column if not exists opening_outstanding_paise bigint not null default 0;

comment on column retailer_credit_accounts.opening_outstanding_paise is
  'Frozen pre-wallet outstanding baseline in integer paise, migrated once from retailers.outstanding_balance. Outstanding = this baseline + ledger(debits) - ledger(credits). Never rewritten by the ledger sync trigger.';

-- ---------------------------------------------------------------------------
-- 2. Backfill the opening baseline ONCE.
--    - Retailers with no ledger rows (the normal state when migrations are
--      applied in order): the legacy retailers.outstanding_balance is the
--      untouched pre-wallet baseline -> copy it exactly.
--    - Retailers that already have ledger rows (only possible if 0029/0030 ran
--      and wrote entries before this fix): subtract the current ledger delta
--      from the already-synced mirror. This recovers the baseline EXACTLY for
--      zero or one ledger entry and stops any further double-counting growth
--      otherwise (the old trigger's accumulated phantom is not fully
--      reconstructible in general, so it is removed as far as possible and
--      never allowed to grow again).
--    Idempotent: re-running only touches rows whose baseline is still 0, and
--    for those the formula converges to the same opening value.
-- ---------------------------------------------------------------------------
update retailer_credit_accounts rca
set opening_outstanding_paise = sub.opening_paise
from (
  select
    a.id,
    case
      when l.ledger_delta_paise is null then coalesce((r.outstanding_balance * 100)::bigint, 0)
      else greatest(0, coalesce((r.outstanding_balance * 100)::bigint, 0) - l.ledger_delta_paise)
    end as opening_paise
  from retailer_credit_accounts a
  join retailers r on r.id = a.retailer_id
  left join (
    select
      retailer_id,
      coalesce(sum(amount_paise) filter (where direction = 'debit'), 0)
        - coalesce(sum(amount_paise) filter (where direction = 'credit'), 0) as ledger_delta_paise
    from retailer_wallet_ledger
    where is_reversed = false
      and transaction_type != 'CREDIT_LIMIT_CHANGE'
    group by retailer_id
  ) l on l.retailer_id = a.retailer_id
  where a.opening_outstanding_paise = 0
) sub
where rca.id = sub.id;

-- ---------------------------------------------------------------------------
-- 3. Corrected outstanding calculation (frozen baseline + ledger)
-- ---------------------------------------------------------------------------
create or replace function get_retailer_outstanding_paise(p_retailer_id uuid)
returns bigint as $$
declare
  v_opening bigint;
  v_ledger_delta bigint;
begin
  if not _can_access_retailer_wallet(p_retailer_id) then
    raise exception 'Access denied: cannot view wallet for retailer %', p_retailer_id;
  end if;

  -- Ledger delta: valid debits minus valid credits. CREDIT_LIMIT_CHANGE rows
  -- are never money movement and reversed rows are ignored.
  select
    coalesce(sum(amount_paise) filter (where direction = 'debit' and is_reversed = false and transaction_type != 'CREDIT_LIMIT_CHANGE'), 0)
      - coalesce(sum(amount_paise) filter (where direction = 'credit' and is_reversed = false and transaction_type != 'CREDIT_LIMIT_CHANGE'), 0)
  into v_ledger_delta
  from retailer_wallet_ledger
  where retailer_id = p_retailer_id;

  -- Frozen baseline. The live retailers.outstanding_balance mirror is NOT read
  -- here (it is an OUTPUT of the sync trigger, reading it would double-count).
  select opening_outstanding_paise into v_opening
  from retailer_credit_accounts where retailer_id = p_retailer_id;

  if v_opening is null then
    -- No credit account row yet (pre-first-write brand-new retailer). The legacy
    -- column is only a valid baseline when the ledger has no entries yet — once
    -- entries exist the mirror already contains ledger money, so the ledger is
    -- authoritative and the opening baseline is 0.
    if v_ledger_delta = 0 then
      select coalesce((outstanding_balance * 100)::bigint, 0) into v_opening
      from retailers where id = p_retailer_id;
    else
      v_opening := 0;
    end if;
  end if;

  return coalesce(v_opening, 0) + v_ledger_delta;
end;
$$ language plpgsql stable security definer set search_path = public;

comment on function get_retailer_outstanding_paise(uuid) is
  'Authoritative outstanding in integer paise = frozen opening_outstanding_paise baseline + valid ledger debits - valid ledger credits. Does not read the live retailers.outstanding_balance mirror (prevents double counting).';

-- ---------------------------------------------------------------------------
-- 4. Allow a salesman to access wallets of their ASSIGNED retailers only.
--    Salesman order capture debits the retailer wallet via the same server
--    path as self-checkout, so the wallet RPCs must accept an assigned salesman.
-- ---------------------------------------------------------------------------
create or replace function _can_access_retailer_wallet(p_retailer_id uuid)
returns boolean as $$
begin
  -- Service role / internal call (no auth.uid()) is trusted.
  if auth.uid() is null then
    return true;
  end if;
  -- Retailer can access own wallet.
  if auth.uid() = p_retailer_id then
    return true;
  end if;
  -- Staff/admin can access any retailer wallet.
  if is_staff_or_above() then
    return true;
  end if;
  -- A salesman can access only the wallets of retailers assigned to them
  -- (the same scope that authorises their order capture).
  if is_retailer_assigned_to_current_salesman(p_retailer_id) then
    return true;
  end if;
  return false;
end;
$$ language plpgsql stable security definer set search_path = public;

comment on function _can_access_retailer_wallet(uuid) is
  'Security helper: retailer -> own wallet; staff/admin -> any; salesman -> assigned retailers only; anon denied.';

-- ---------------------------------------------------------------------------
-- 5. Idempotency-first order debit with concurrent duplicate tolerance.
--    A retried request with the same idempotency key returns the existing
--    ledger id BEFORE any credit check; a concurrent duplicate insert falls
--    back to the winner's row instead of surfacing a unique violation.
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
  if not _can_access_retailer_wallet(p_retailer_id) then
    raise exception 'Access denied: cannot debit wallet for retailer %', p_retailer_id;
  end if;

  if p_amount_paise <= 0 then
    raise exception 'Amount must be positive';
  end if;

  -- Idempotency FIRST: a retry must return the existing debit, not re-run the
  -- credit check against a balance the first attempt already moved.
  if p_idempotency_key is not null then
    select id into v_ledger_id from retailer_wallet_ledger where idempotency_key = p_idempotency_key;
    if v_ledger_id is not null then
      return v_ledger_id;
    end if;
  end if;

  -- Lock credit account row to prevent concurrent over-limit orders
  select id, credit_limit_paise, allow_overdue, overdue_limit_paise
  into v_account_id, v_limit, v_allow_overdue, v_overdue_limit
  from retailer_credit_accounts
  where retailer_id = p_retailer_id
  for update;

  -- If no account exists, create one from legacy data
  if v_account_id is null then
    insert into retailer_credit_accounts (retailer_id, credit_limit_paise, created_by, opening_outstanding_paise)
    select p_retailer_id, coalesce((credit_limit * 100)::bigint, 0), p_created_by, coalesce((outstanding_balance * 100)::bigint, 0)
    from retailers where id = p_retailer_id
    returning id, credit_limit_paise, allow_overdue, overdue_limit_paise
    into v_account_id, v_limit, v_allow_overdue, v_overdue_limit;
  end if;

  if v_account_id is null then
    raise exception 'Retailer credit account not found';
  end if;

  -- Re-check idempotency after the account lock: a concurrent duplicate request
  -- that slipped past the first check is now guaranteed to see the winner's
  -- committed row, so it returns that id instead of failing the credit check.
  if p_idempotency_key is not null then
    select id into v_ledger_id from retailer_wallet_ledger where idempotency_key = p_idempotency_key;
    if v_ledger_id is not null then
      return v_ledger_id;
    end if;
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

  begin
    insert into retailer_wallet_ledger (
      retailer_id, account_id, transaction_type, amount_paise, direction,
      reference_type, reference_id, description, created_by, idempotency_key
    ) values (
      p_retailer_id, v_account_id, 'ORDER_DEBIT', p_amount_paise, 'debit',
      'order', p_order_id, coalesce(p_description, 'Order debit'), p_created_by, p_idempotency_key
    ) returning id into v_ledger_id;
  exception when unique_violation then
    -- A concurrent request with the same idempotency key won the insert.
    select id into v_ledger_id from retailer_wallet_ledger where idempotency_key = p_idempotency_key;
    if v_ledger_id is not null then
      return v_ledger_id;
    end if;
    raise;
  end;

  return v_ledger_id;
end;
$$ language plpgsql security definer set search_path = public;

-- ============================================================================
-- END OF MIGRATION 0031 — additive, no data dropped, no RLS weakened.
-- ============================================================================
