-- Rollback for 0063_seller_offers.sql — FAIL-SAFE, GUARDED.
--
-- ABORTS while any seller offers or floors exist (deactivated rows count):
-- dropping these tables would destroy offer history, price history and
-- floor configuration that admin entered through the app, and would break any
-- order/cart rows referencing offers (0064 FKs are ON DELETE RESTRICT).
-- Roll back 0064–0068 FIRST (reverse order), then export/delete rows
-- deliberately, then re-run.
--
-- DO NOT run against any configured or remote project. NOT executed.

do $$
begin
  if (select count(*) from seller_offers) > 0 then
    raise exception
      'ROLLBACK ABORTED: seller offer rows exist (including deactivated history). Export and delete them deliberately, then re-run.';
  end if;
  if (select count(*) from seller_offer_price_history) > 0 then
    raise exception
      'ROLLBACK ABORTED: offer price history exists. Export and delete it deliberately, then re-run.';
  end if;
  if (select count(*) from offer_price_floors) > 0 then
    raise exception
      'ROLLBACK ABORTED: price floors exist. Delete them deliberately, then re-run.';
  end if;
end $$;

drop policy if exists "seller_offer_price_history_read" on seller_offer_price_history;
drop policy if exists "seller_offers_seller_update" on seller_offers;
drop policy if exists "seller_offers_seller_insert" on seller_offers;
drop policy if exists "seller_offers_trading_select" on seller_offers;
drop policy if exists "offer_price_floors_admin_insert" on offer_price_floors;
drop policy if exists "offer_price_floors_admin_select" on offer_price_floors;

drop trigger if exists trg_prevent_offer_floor_mutation on offer_price_floors;
drop trigger if exists trg_audit_offer_price_floors on offer_price_floors;
drop trigger if exists trg_audit_seller_offers on seller_offers;
drop trigger if exists trg_log_seller_offer_price_change on seller_offers;
drop trigger if exists trg_enforce_seller_offer_rules on seller_offers;

drop function if exists public.prevent_offer_floor_mutation();
drop function if exists public.log_seller_offer_price_change();
drop function if exists public.enforce_seller_offer_rules();
drop function if exists public.current_offer_floor_paise(uuid);

drop table if exists seller_offer_price_history;
drop table if exists seller_offers;
drop table if exists offer_price_floors;
