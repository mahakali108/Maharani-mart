-- Rollback for 0068_seller_governance.sql — FAIL-SAFE.
-- Drops the governance triggers/functions only; no data touched.
-- Roll back 0062–0067 in reverse order afterwards (their guards cover data).
-- NOT executed.

drop trigger if exists trg_audit_collection_allocations on collection_allocations;
drop trigger if exists trg_audit_seller_ledger on seller_ledger;
drop trigger if exists trg_audit_seller_payouts on seller_payouts;
drop trigger if exists trg_set_seller_payouts_updated_at on seller_payouts;
drop trigger if exists trg_guard_seller_offers_admin_columns on seller_offers;
drop trigger if exists trg_drain_seller_offers_on_suspend on sellers;

drop function if exists public.set_seller_payouts_updated_at();
drop function if exists public.guard_seller_offers_admin_columns();
drop function if exists public.drain_seller_offers_on_suspend();
