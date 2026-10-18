-- ============================================================================
-- 0068: Seller Marketplace — governance: drain-mode suspension, admin-only
--       column guards, and the remaining least-privilege grants.
--
-- WHAT THIS ADDS
--   * `drain_seller_offers_on_suspend` — when a seller moves to 'suspended',
--     all their active offers are deactivated IN THE SAME transaction (drain
--     mode: history preserved, nothing deleted). Open carts referencing those
--     offers fail closed at the next mutation/checkout (OFFER_UNAVAILABLE);
--     already-placed sub-orders continue their own lifecycle. Reinstating a
--     seller does NOT auto-reactivate offers — each offer is an explicit
--     admin/seller decision.
--   * `guard_seller_offers_admin_columns` — a second, explicit column guard on
--     seller_offers mirroring the 0052 `guard_admin_only_columns` pattern for
--     the seller's own API surface (stock/mode columns are DB-owned).
--   * Final function grants (all SECURITY DEFINER functions pin
--     `search_path = public, pg_temp` per the 0057 convention).
--
-- SAFETY: additive. NOT executed against any database.
-- ============================================================================

create or replace function public.drain_seller_offers_on_suspend()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'suspended' and old.status is distinct from 'suspended' then
    update public.seller_offers
       set is_active = false,
           updated_at = now()
     where seller_id = new.id
       and is_active;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_drain_seller_offers_on_suspend on public.sellers;
create trigger trg_drain_seller_offers_on_suspend
  after update of status on public.sellers
  for each row execute function public.drain_seller_offers_on_suspend();

-- Seller API surface cannot touch DB-owned offer stock (checkout/restore are
-- SECURITY DEFINER and run as the function owner).
create or replace function public.guard_seller_offers_admin_columns()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('authenticated', 'anon') and not public.is_admin_or_above() then
    if new.stock_quantity is distinct from old.stock_quantity then
      raise exception 'Offer stock is maintained by the database only.' using errcode = '42501';
    end if;
    if new.seller_id is distinct from old.seller_id
       or new.product_id is distinct from old.product_id
       or new.pack_id is distinct from old.pack_id
       or new.fulfilment_type is distinct from old.fulfilment_type
       or new.created_by is distinct from old.created_by then
      raise exception 'Offer identity fields cannot be changed after creation.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_seller_offers_admin_columns on public.seller_offers;
create trigger trg_guard_seller_offers_admin_columns
  before update on public.seller_offers
  for each row execute function public.guard_seller_offers_admin_columns();

-- Re-stamp payouts bookkeeping on admin-driven changes (table has no actions).
create or replace function public.set_seller_payouts_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_set_seller_payouts_updated_at on public.seller_payouts;
create trigger trg_set_seller_payouts_updated_at
  before update on public.seller_payouts
  for each row execute function public.set_seller_payouts_updated_at();

drop trigger if exists trg_audit_seller_payouts on public.seller_payouts;
create trigger trg_audit_seller_payouts
  after insert or update or delete on public.seller_payouts
  for each row execute function log_audit();

drop trigger if exists trg_audit_seller_ledger on public.seller_ledger;
create trigger trg_audit_seller_ledger
  after insert on public.seller_ledger
  for each row execute function log_audit();

drop trigger if exists trg_audit_collection_allocations on public.collection_allocations;
create trigger trg_audit_collection_allocations
  after insert on public.collection_allocations
  for each row execute function log_audit();

-- Final explicit grants on the settlement/fulfilment tables (writes remain
-- service-role only; no client write grants).
revoke all on public.seller_shipments from public, anon, authenticated;
grant select on public.seller_shipments to authenticated;

comment on function public.drain_seller_offers_on_suspend() is
  'Drain-mode suspension: suspending a seller deactivates their active offers in the same transaction. Reinstating does not auto-reactivate offers.';

-- ============================================================================
-- END OF MIGRATION. Marketplace schema complete:
--   0062 identity · 0063 offers · 0064 expand · 0065 checkout switch ·
--   0066 fulfilment · 0067 settlement · 0068 governance
-- ============================================================================
