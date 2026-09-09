-- ============================================================================
-- 0030: Wallet RPC security hardening + idempotency safety
--
-- Issue found in review of 0029:
-- - Security definer RPCs get_retailer_outstanding_paise etc did not check
--   auth.uid() — a retailer could query other retailers' balances.
-- - check_and_debit_retailer_wallet also allowed arbitrary retailer_id
--   without auth check, could be abused to create ledger entries for others.
--
-- Fix: Add auth check inside each RPC: caller must be own retailer_id
-- or staff/admin (is_staff_or_above()). Also revoke public execute and
-- grant only to authenticated, to ensure anon cannot call.
--
-- Safety: additive, no data dropped, no RLS weakened, only strengthens.
-- ============================================================================

-- Helper to check if caller is allowed to access a retailer wallet
create or replace function _can_access_retailer_wallet(p_retailer_id uuid)
returns boolean as $$
begin
  -- If no auth (service role or internal call), allow — server actions use service role or authenticated admin
  if auth.uid() is null then
    return true;
  end if;
  -- Retailer can access own
  if auth.uid() = p_retailer_id then
    return true;
  end if;
  -- Staff/admin can access any
  if is_staff_or_above() then
    return true;
  end if;
  return false;
end;
$$ language plpgsql stable security definer set search_path = public;

-- Harden get_retailer_outstanding_paise
create or replace function get_retailer_outstanding_paise(p_retailer_id uuid)
returns bigint as $$
declare
  v_legacy_paise bigint;
  v_ledger_debit bigint;
  v_ledger_credit bigint;
begin
  if not _can_access_retailer_wallet(p_retailer_id) then
    raise exception 'Access denied: cannot view wallet for retailer %', p_retailer_id;
  end if;

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

-- Harden get_retailer_credit_limit_paise
create or replace function get_retailer_credit_limit_paise(p_retailer_id uuid)
returns bigint as $$
declare
  v_limit bigint;
begin
  if not _can_access_retailer_wallet(p_retailer_id) then
    raise exception 'Access denied: cannot view credit limit for retailer %', p_retailer_id;
  end if;

  select credit_limit_paise into v_limit
  from retailer_credit_accounts where retailer_id = p_retailer_id;
  if v_limit is not null then return v_limit; end if;
  select coalesce((credit_limit * 100)::bigint, 0) into v_limit from retailers where id = p_retailer_id;
  return coalesce(v_limit, 0);
end;
$$ language plpgsql stable security definer set search_path = public;

-- Harden get_retailer_available_credit_paise
create or replace function get_retailer_available_credit_paise(p_retailer_id uuid)
returns bigint as $$
declare
  v_limit bigint;
  v_outstanding bigint;
begin
  if not _can_access_retailer_wallet(p_retailer_id) then
    raise exception 'Access denied: cannot view available credit for retailer %', p_retailer_id;
  end if;
  v_limit := get_retailer_credit_limit_paise(p_retailer_id);
  v_outstanding := get_retailer_outstanding_paise(p_retailer_id);
  return v_limit - v_outstanding;
end;
$$ language plpgsql stable security definer set search_path = public;

-- Harden check_and_debit_retailer_wallet
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

  select id, credit_limit_paise, allow_overdue, overdue_limit_paise
  into v_account_id, v_limit, v_allow_overdue, v_overdue_limit
  from retailer_credit_accounts
  where retailer_id = p_retailer_id
  for update;

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

  if not v_allow_overdue and (v_available < p_amount_paise) then
    raise exception 'Insufficient credit: available % paise, required % paise', v_available, p_amount_paise;
  end if;

  if v_allow_overdue and v_overdue_limit > 0 then
    if (v_outstanding + p_amount_paise - v_limit) > v_overdue_limit then
      raise exception 'Overdue limit exceeded: overdue would be % paise, limit % paise', (v_outstanding + p_amount_paise - v_limit), v_overdue_limit;
    end if;
  end if;

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

-- Revoke from anon, grant only to authenticated
revoke all on function get_retailer_outstanding_paise(uuid) from public, anon;
revoke all on function get_retailer_credit_limit_paise(uuid) from public, anon;
revoke all on function get_retailer_available_credit_paise(uuid) from public, anon;
revoke all on function check_and_debit_retailer_wallet(uuid,uuid,bigint,text,uuid,text) from public, anon;
revoke all on function _can_access_retailer_wallet(uuid) from public, anon;

grant execute on function get_retailer_outstanding_paise(uuid) to authenticated;
grant execute on function get_retailer_credit_limit_paise(uuid) to authenticated;
grant execute on function get_retailer_available_credit_paise(uuid) to authenticated;
grant execute on function check_and_debit_retailer_wallet(uuid,uuid,bigint,text,uuid,text) to authenticated;
grant execute on function _can_access_retailer_wallet(uuid) to authenticated;

-- Ensure service_role can still execute (for server actions that may use service role)
grant execute on function get_retailer_outstanding_paise(uuid) to service_role;
grant execute on function get_retailer_credit_limit_paise(uuid) to service_role;
grant execute on function get_retailer_available_credit_paise(uuid) to service_role;
grant execute on function check_and_debit_retailer_wallet(uuid,uuid,bigint,text,uuid,text) to service_role;
grant execute on function _can_access_retailer_wallet(uuid) to service_role;

comment on function _can_access_retailer_wallet(uuid) is 'Security helper: retailer can access own wallet, staff+ can access any, anon denied.';

-- ============================================================================
-- END OF MIGRATION 0030 — strengthens security, no data loss
-- ============================================================================
