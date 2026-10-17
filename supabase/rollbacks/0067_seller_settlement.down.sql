-- Rollback for 0067_seller_settlement.sql — FAIL-SAFE, GUARDED.
--
-- ABORTS while any settlement rows exist (allocations, ledger entries or
-- payout requests). Financial history is never erased by a rollback: export
-- under a reviewed retention procedure first. Coin reversals written by
-- refund_sub_order_coins live in retailer_wallet_ledger and are PRESERVED
-- (they are wallet history, not marketplace schema).
--
-- Roll back 0068 FIRST. NOT executed.

do $$
begin
  if (select count(*) from collection_allocations) > 0 then
    raise exception
      'ROLLBACK ABORTED: collection allocations exist. Export and delete them deliberately, then re-run.';
  end if;
  if (select count(*) from seller_ledger) > 0 then
    raise exception
      'ROLLBACK ABORTED: seller ledger entries exist. Export and delete them deliberately, then re-run.';
  end if;
  if (select count(*) from seller_payouts) > 0 then
    raise exception
      'ROLLBACK ABORTED: seller payout rows exist. Export and delete them deliberately, then re-run.';
  end if;
end $$;

drop policy if exists "seller_payouts_admin_read" on seller_payouts;
drop policy if exists "seller_ledger_read" on seller_ledger;
drop policy if exists "collection_allocations_read" on collection_allocations;

drop function if exists public.refund_sub_order_coins(uuid, bigint, text, uuid);
drop function if exists public.allocate_payment_collection(uuid, uuid, bigint);

drop trigger if exists trg_prevent_collection_alloc_mutation on collection_allocations;
drop trigger if exists trg_prevent_seller_ledger_mutation on seller_ledger;
drop function if exists public.prevent_seller_ledger_mutation();

drop table if exists seller_payouts;
drop table if exists seller_ledger;
drop table if exists collection_allocations;
