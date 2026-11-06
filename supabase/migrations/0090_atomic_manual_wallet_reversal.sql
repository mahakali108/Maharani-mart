-- Draft: atomic compensation of manual wallet adjustments only.
-- Order debits/refunds, payment collections and other financial events have
-- separate entitlement/settlement rules and must NOT use this generic RPC.
-- Historical flags and credits are not changed or silently reconciled.
create or replace function public.reverse_manual_wallet_adjustment(
  p_retailer_id uuid,
  p_transaction_id uuid,
  p_reason text
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_original public.retailer_wallet_ledger%rowtype;
  v_existing public.retailer_wallet_ledger%rowtype;
  v_id uuid;
  v_key text;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_actor uuid := auth.uid();
begin
  if v_actor is null or not public.is_active_account() or not public.is_admin_or_above() then
    raise exception 'Active administrator required.' using errcode = '42501';
  end if;
  if p_retailer_id is null or p_transaction_id is null or length(v_reason) not between 5 and 500 then
    raise exception 'Retailer, transaction and a reason of 5 to 500 characters are required.' using errcode = '22023';
  end if;

  -- Same account-first lock used by checkout/refund writers. Do not lock the
  -- ledger row first: doing so can deadlock a concurrent financial operation.
  perform 1 from public.retailer_credit_accounts where retailer_id = p_retailer_id for update;
  if not found then raise exception 'Wallet account missing; reconciliation required.' using errcode = '22023'; end if;
  select * into v_original from public.retailer_wallet_ledger
    where id = p_transaction_id and retailer_id = p_retailer_id for update;
  if not found then raise exception 'Transaction not found.' using errcode = 'P0002'; end if;
  if v_original.is_reversed or v_original.reversal_of is not null
     or v_original.reference_type is distinct from 'adjustment'
     or v_original.transaction_type not in ('MANUAL_CREDIT', 'MANUAL_DEBIT', 'ADJUSTMENT') then
    raise exception 'Only an unreversed manual adjustment can use this operation; other transactions require their own reviewed workflow.' using errcode = '22023';
  end if;
  v_key := 'manual-reversal-v1:' || p_transaction_id::text;
  select * into v_existing from public.retailer_wallet_ledger where idempotency_key = v_key;
  if found then
    if v_existing.retailer_id is distinct from p_retailer_id
       or v_existing.reversal_of is distinct from p_transaction_id
       or v_existing.transaction_type <> 'ADJUSTMENT'
       or v_existing.direction <> (case when v_original.direction = 'debit' then 'credit' else 'debit' end)
       or v_existing.amount_paise <> v_original.amount_paise
       or v_existing.reference_type is distinct from 'reversal'
       or v_existing.reference_id is distinct from p_transaction_id
       or exists (select 1 from public.retailer_wallet_ledger where reversal_of = p_transaction_id and id <> v_existing.id)
       or exists (select 1 from public.retailer_wallet_ledger where idempotency_key = 'reversal:' || p_transaction_id::text)
       or v_existing.is_reversed or v_existing.reason is distinct from v_reason
       or v_existing.created_by is distinct from v_actor then
      raise exception 'Reversal retry conflicts with existing history.' using errcode = '23505';
    end if;
    return v_existing.id;
  end if;
  if exists (select 1 from public.retailer_wallet_ledger where reversal_of = p_transaction_id)
     or exists (select 1 from public.retailer_wallet_ledger where idempotency_key = 'reversal:' || p_transaction_id::text) then
    raise exception 'Existing reversal history requires reconciliation.' using errcode = '22023';
  end if;
  insert into public.retailer_wallet_ledger (
    retailer_id, account_id, transaction_type, amount_paise, direction,
    reference_type, reference_id, description, reason, created_by,
    idempotency_key, metadata, reversal_of
  ) values (
    p_retailer_id, v_original.account_id, 'ADJUSTMENT', v_original.amount_paise,
    case when v_original.direction = 'debit' then 'credit' else 'debit' end,
    'reversal', p_transaction_id, 'Reversal of manual wallet adjustment', v_reason, v_actor,
    v_key, jsonb_build_object('original_type', v_original.transaction_type), p_transaction_id
  ) returning id into v_id;
  -- Do not flag the original: both entries must remain in the outstanding sum.
  return v_id;
end;
$$;
revoke all on function public.reverse_manual_wallet_adjustment(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.reverse_manual_wallet_adjustment(uuid, uuid, text) to authenticated;
