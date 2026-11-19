-- ============================================================================
-- 0110: Retire the Seller & Supplier marketplace — capability revocation ONLY
-- ============================================================================
--
-- WHAT THIS MIGRATION IS
--   Maharani Traders no longer operates a multi-seller marketplace or a
--   supplier programme. The application code that drove both was deleted in the
--   same change. This migration removes the remaining DATABASE CAPABILITY,
--   because deleting the UI alone would leave working RPCs that any holder of a
--   URL and a session could still call.
--
-- WHAT THIS MIGRATION IS NOT
--   It is NOT a schema cleanup. It deletes NO table, NO row, NO column and NO
--   foreign key. Every historical record stays readable by an authorised
--   administrator. Specifically it preserves:
--     * sellers / seller_members / seller_offers / seller_offer_tiers
--     * seller_ledger / seller_payouts / collection_allocations
--     * sub_orders / seller_shipments (reachable from historical orders)
--     * suppliers / supplier_documents / supplier_application_rate_limits
--     * seller_account_invites / seller_compliance_reviews
--     * product_compliance_evidence, product_moderation_history
--     * legal_document_current_versions (retailer terms acceptance uses it)
--     * grns.supplier_reference (historical purchase provenance)
--
--   WHY THE TABLES MUST STAY — three hard constraints, all verified in-repo:
--     1. `collection_allocations.sub_order_id` is NOT NULL with ON DELETE
--        RESTRICT (0067). Dropping sub_orders would destroy payment-collection
--        history.
--     2. Thirteen foreign keys point at `sellers` (5 cascade / 7 restrict /
--        1 set null) across 0064, 0066, 0067, 0072, 0086 and 0109.
--     3. 0109 (merged as PR #139) has an explicit preflight that RAISES
--        'MIGRATION ORDER VIOLATION' unless public.sellers, public.seller_offers,
--        public.seller_offer_tiers and public.is_active_seller_member(uuid)
--        exist. Dropping them would break the already-merged migration.
--   `user_role` also contains 'seller' (0062). PostgreSQL cannot drop an enum
--   value in place, so the role is refused at every entry point instead.
--
-- SAFETY PROPERTIES
--   * Forward-only. No already-applied migration is edited.
--   * Idempotent. Every statement is guarded by to_regprocedure / to_regclass /
--     drop-if-exists / create-or-replace, so a re-run is a no-op.
--   * Ordered. Preflight -> signup path -> portal RPCs -> marketplace RPCs ->
--     grants -> policies -> verification.
--   * Rollback: supabase/rollbacks/0110_retire_seller_supplier_marketplace.down.sql
--     restores the REVOKED grants and the pre-0110 handle_new_user(). It cannot
--     restore deleted data — none is deleted here, which is the point.
--
-- APPLY ORDER: after 0109. This file must never be renumbered into the range
-- 0104–0109 (already merged) or the 0001–0103 baseline.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. PREFLIGHT — refuse to run against an unexpected schema
-- ---------------------------------------------------------------------------
do $preflight$
begin
  -- The objects this migration revokes grants on. If the marketplace layer is
  -- not installed, this migration has nothing to do and must not half-apply.
  if to_regclass('public.sellers') is null
     or to_regclass('public.seller_offers') is null then
    raise exception 'MIGRATION ORDER VIOLATION: 0110 requires public.sellers and public.seller_offers (0062/0063). Apply 0062 and 0063 first.';
  end if;

  -- The role helper 0110 re-states must exist, or the signup path below would
  -- be replaced with a version that cannot compile.
  if to_regprocedure('public.current_user_role()') is null then
    raise exception 'MIGRATION ORDER VIOLATION: 0110 requires public.current_user_role() from 0001_init.sql.';
  end if;
end;
$preflight$;


-- ---------------------------------------------------------------------------
-- 1. SIGNUP PATH — no seller account can ever be created again
-- ---------------------------------------------------------------------------
-- Replaces the 0072/0070 version, which still contains the seller-invitation
-- branch (nonce match against seller_account_invites, seller_members insert,
-- 'seller_invite_required' refusal). The invitation TABLES are kept as
-- historical records; the ability to CONSUME an invitation into a new seller
-- account is removed here.
--
-- Behaviour after 0110:
--   * staff / salesman invitations still work exactly as before
--   * a public signup always becomes a retailer (unchanged)
--   * an explicit non-retailer account_type is refused
--   * a leftover 'seller' reservation or an unconsumed seller invitation is
--     refused, so a stale invitation can never mint a seller login
do $signup$
begin
  if to_regprocedure('public.handle_new_user()') is not null then
    execute $fn$
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_role public.user_role := 'retailer';
  v_staff_role public.user_role;
  v_signup_kind text := lower(btrim(coalesce(new.raw_user_meta_data->>'account_type', 'retailer')));
  v_area_text text := nullif(btrim(coalesce(new.raw_user_meta_data->>'area_id', '')), '');
  v_area_id uuid;
begin
  if new.email is not null then
    delete from public.staff_account_invites
     where email = lower(btrim(new.email)) and expires_at > now()
    returning role into v_staff_role;

    if v_staff_role is null then
      -- A leftover seller invitation must never be consumed. Raise BEFORE any
      -- insert so the whole signup rolls back and no partial profile remains.
      if exists (
        select 1 from public.seller_account_invites i
         where i.email = lower(btrim(new.email))
           and i.consumed_at is null
      ) then
        raise exception 'seller_invite_required' using errcode = '42501';
      end if;
    end if;
  end if;

  -- The retired seller role can never be assigned. 0070 allowed it through the
  -- general staff-invites table; that path is closed.
  if v_staff_role = 'seller' then
    raise exception 'seller_invite_required' using errcode = '42501';
  end if;

  if v_staff_role is not null then
    v_role := v_staff_role;
  elsif v_signup_kind <> 'retailer' then
    -- Explicitly reject rather than silently opening a retailer account.
    raise exception 'seller_invite_required' using errcode = '42501';
  end if;

  begin
    insert into public.profiles (id, role, full_name, phone)
    values (
      new.id, v_role,
      btrim(coalesce(new.raw_user_meta_data->>'full_name', '')),
      btrim(coalesce(new.raw_user_meta_data->>'phone', ''))
    );
  exception when unique_violation then
    raise exception 'phone_already_registered';
  end;

  if v_role = 'retailer' then
    if v_area_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      select a.id into v_area_id from public.areas a
       where a.id = v_area_text::uuid and a.is_active;
    end if;
    if v_area_id is null then raise exception 'invalid_area'; end if;
    insert into public.retailers (id, shop_name, area_id, address, status)
    values (new.id, coalesce(new.raw_user_meta_data->>'shop_name', ''),
            v_area_id, new.raw_user_meta_data->>'address', 'pending_approval');
  end if;
  return new;
end;
$$;
    $fn$;
  end if;
end;
$signup$;

-- The trigger function must not be reachable over PostgREST (0078 H3 rule).
do $signup_grant$
begin
  if to_regprocedure('public.handle_new_user()') is not null then
    revoke all on function public.handle_new_user() from public, anon, authenticated;
  end if;
end;
$signup_grant$;

-- Narrow the staff-invite role check back to internal roles only (0070 widened
-- it to include 'seller').
do $invites$
begin
  if to_regclass('public.staff_account_invites') is not null then
    alter table public.staff_account_invites drop constraint if exists staff_account_invites_role_check;
    alter table public.staff_account_invites
      add constraint staff_account_invites_role_check check (role in ('staff', 'salesman'));
  end if;
end;
$invites$;


-- ---------------------------------------------------------------------------
-- 2. SELLER PORTAL RPCs — revoke from every API role
-- ---------------------------------------------------------------------------
-- These are the seller workspace's own functions. The workspace no longer
-- exists in the application, so no API session may call them. Bodies and
-- signatures are untouched: a future audit can still read what they did, and
-- the historical tables they write remain intact.
do $revoke_portal$
declare
  v_sig text;
begin
  foreach v_sig in array array[
    'public.seller_set_offer_stock(uuid, integer)',
    'public.seller_replace_offer_tiers(uuid, jsonb)',
    'public.seller_update_sub_order(uuid, text, text, text)',
    'public.seller_update_own_profile(text, text, text, text, text, text, text)',
    'public.seller_order_headers()',
    'public.seller_offer_gate_status(uuid)',
    -- Exact signatures from 0072. Guessing these would silently skip the revoke
    -- and leave a live invitation-minting RPC behind; the verify block below
    -- exists to catch exactly that mistake.
    'public.reserve_seller_invite(text, text, text, text, text, text, text)',
    'public.attach_existing_seller_invite(uuid)',
    'public.claim_seller_invite_attempt(uuid)'
  ]
  loop
    begin
      execute format('revoke all on function %s from public, anon, authenticated', v_sig);
    exception
      when undefined_function then
        raise notice '0110: % is not installed on this database — skipped.', v_sig;
      when undefined_object then
        raise notice '0110: % is not installed on this database — skipped.', v_sig;
    end;
  end loop;
end;
$revoke_portal$;


-- ---------------------------------------------------------------------------
-- 3. RETAILER-FACING MARKETPLACE RPCs — revoke
-- ---------------------------------------------------------------------------
-- Migration 0069 exposed a narrow projection so retailers could price and view
-- third-party offers. With no offers left to quote, these functions have no
-- legitimate caller and are a data-exposure surface if left executable.
do $revoke_marketplace$
declare
  v_sig text;
begin
  foreach v_sig in array array[
    'public.marketplace_offer_quotes(uuid[])',
    'public.marketplace_offers_for_product(uuid)',
    'public.marketplace_offer_tiers(uuid[])',
    'public.effective_seller_offer_unit_price_paise(uuid, integer)',
    'public.current_offer_floor_paise(uuid)',
    'public.third_party_offers_enabled()',
    'public.record_marketplace_launch_approval(boolean, text, text, text)'
  ]
  loop
    begin
      execute format('revoke all on function %s from public, anon, authenticated', v_sig);
    exception
      when undefined_function then
        raise notice '0110: % is not installed on this database — skipped.', v_sig;
      when undefined_object then
        raise notice '0110: % is not installed on this database — skipped.', v_sig;
    end;
  end loop;
end;
$revoke_marketplace$;

-- NOTE: public.seller_agreement_is_current(uuid) was already service_role-only
-- from 0098 and is intentionally left that way (no API grant to withdraw).
--
-- ---------------------------------------------------------------------------
-- DELIBERATELY NOT REVOKED: public.is_member_of_seller(uuid) and
-- public.is_active_seller_member(uuid).
--
-- Both are pure read-only predicates that answer "is the caller a member of
-- this seller". They are LEFT EXECUTABLE for three concrete reasons:
--
--   1. Live RLS policies still REFERENCE them. 0062/0063 policies on
--      public.sellers and public.seller_offers, the 0086 compliance policies on
--      public.product_compliance_evidence, and the 0109 policies on
--      public.seller_compliance_* all call these functions. Revoking EXECUTE
--      makes those policies raise `permission denied for function` instead of
--      returning false — which breaks unrelated reads and, empirically, breaks
--      migration application itself. Caught by
--      tests/migration-0110-seller-supplier-retirement.test.ts.
--   2. 0109 (merged as PR #139) preflights on is_active_seller_member's
--      presence; keeping it callable preserves that contract for any future
--      re-application.
--   3. They leak nothing. Every seller-role profile is deactivated by block 7
--      below, so both return false for every caller. The value is information
--      about a surface that no longer has any account.
--
-- The ACCESS that mattered — reading and writing seller tables — is removed by
-- the policy changes in block 5, not by these predicates.
do $keep_service$
begin
  if to_regprocedure('public.is_active_seller_member(uuid)') is not null then
    grant execute on function public.is_active_seller_member(uuid) to service_role;
  end if;
end;
$keep_service$;


-- ---------------------------------------------------------------------------
-- 4. SUPPLIER APPLICATION — close the public funnel
-- ---------------------------------------------------------------------------
-- `submit_supplier_application` was granted to anon + authenticated (0059) so a
-- stranger could file an application. The programme is discontinued, so the
-- public execute grant is removed. The function, its tables and every submitted
-- row stay for historical reference.
do $supplier$
begin
  if to_regprocedure('public.submit_supplier_application(text, text, text, text, text, text, text, text, text, text, text)') is not null then
    revoke all on function public.submit_supplier_application(text, text, text, text, text, text, text, text, text, text, text)
      from public, anon, authenticated;
  end if;
  if to_regprocedure('public.consume_supplier_application_rate_limit(text, integer, integer)') is not null then
    revoke all on function public.consume_supplier_application_rate_limit(text, integer, integer)
      from public, anon, authenticated;
  end if;

  -- Supplier paperwork bucket: object policies are dropped so no API session can
  -- read or write supplier documents. The bucket and its objects are KEPT.
  if to_regclass('storage.objects') is not null then
    drop policy if exists "supplier_documents_bucket_read" on storage.objects;
    drop policy if exists "supplier_documents_bucket_write" on storage.objects;
  end if;
end;
$supplier$;


-- ---------------------------------------------------------------------------
-- 5. SELLER-WRITE POLICIES — remove the write surface, keep admin read
-- ---------------------------------------------------------------------------
-- The seller portal wrote its own offers, tiers, profile and shipments through
-- RLS. Those write policies are removed so no seller session can mutate
-- marketplace data even if a token survives. Administrative SELECT policies are
-- deliberately KEPT: a Super Admin must still be able to read historical seller
-- records for audit, reconciliation and dispute handling.
do $policies$
begin
  -- seller_offers
  -- Seller write policies go. The ADMIN update path STAYS, because the
  -- product_moderation_history trigger (0109) appends its audit row when an
  -- administrator rejects or removes a historical offer. Dropping this would
  -- silently stop the moderation audit trail for pre-existing records.
  drop policy if exists "seller_offers_seller_insert" on public.seller_offers;
  drop policy if exists "seller_offers_seller_update" on public.seller_offers;
  drop policy if exists "seller_offers_admin_update" on public.seller_offers;
  execute $pol$
    create policy "seller_offers_admin_update" on public.seller_offers
      for update to authenticated
      using (public.is_admin_or_above())
      with check (public.is_admin_or_above())
  $pol$;
  -- Re-state the trading policy as admin-only: retailers no longer browse offers.
  drop policy if exists "seller_offers_trading_select" on public.seller_offers;
  execute $pol$
    create policy "seller_offers_trading_select" on public.seller_offers
      for select to authenticated using (public.is_admin_or_above())
  $pol$;

  -- seller_offer_tiers
  drop policy if exists "seller_offer_tiers_select" on public.seller_offer_tiers;
  execute $pol$
    create policy "seller_offer_tiers_select" on public.seller_offer_tiers
      for select to authenticated using (public.is_admin_or_above())
  $pol$;

  -- seller price history stays admin-readable only
  drop policy if exists "seller_offer_price_history_read" on public.seller_offer_price_history;
  execute $pol$
    create policy "seller_offer_price_history_read" on public.seller_offer_price_history
      for select to authenticated using (public.is_admin_or_above())
  $pol$;

  -- offer price floors stay admin-readable only
  drop policy if exists "offer_price_floors_admin_select" on public.offer_price_floors;
  execute $pol$
    create policy "offer_price_floors_admin_select" on public.offer_price_floors
      for select to authenticated using (public.is_admin_or_above())
  $pol$;

  -- seller shipments / ledger: admin read only (sellers can no longer see them)
  if to_regclass('public.seller_shipments') is not null then
    drop policy if exists "seller_shipments_select" on public.seller_shipments;
    execute $pol$
      create policy "seller_shipments_select" on public.seller_shipments
        for select to authenticated using (public.is_admin_or_above())
    $pol$;
  end if;

  if to_regclass('public.seller_ledger') is not null then
    drop policy if exists "seller_ledger_read" on public.seller_ledger;
    execute $pol$
      create policy "seller_ledger_read" on public.seller_ledger
        for select to authenticated using (public.is_admin_or_above())
    $pol$;
  end if;

  -- seller identity: membership writes removed; admin keeps read + update so a
  -- historical seller record can still be annotated/closed by the owner.
  if to_regclass('public.seller_members') is not null then
    drop policy if exists "seller_members_select" on public.seller_members;
    execute $pol$
      create policy "seller_members_select" on public.seller_members
        for select to authenticated using (public.is_admin_or_above())
    $pol$;
    -- Admin insert/delete of a membership row STAYS. This is administrative
    -- control over historical records (closing a membership, correcting an
    -- owner), not seller self-service: only is_admin_or_above() may do it, and
    -- no seller session can create one for itself.
    drop policy if exists "seller_members_admin_insert" on public.seller_members;
    execute $pol$
      create policy "seller_members_admin_insert" on public.seller_members
        for insert to authenticated with check (public.is_admin_or_above())
    $pol$;
    drop policy if exists "seller_members_admin_delete" on public.seller_members;
    execute $pol$
      create policy "seller_members_admin_delete" on public.seller_members
        for delete to authenticated using (public.is_admin_or_above())
    $pol$;
  end if;

  -- order_items: the seller branch of the row policy is removed.
  drop policy if exists "order_items_seller_select" on public.order_items;
end;
$policies$;

-- Sellers can no longer read/write their own `sellers` row through the API.
-- Admin read + update are kept for historical administration.
do $seller_row_policies$
begin
  if to_regclass('public.sellers') is not null then
    drop policy if exists "sellers_select" on public.sellers;
    execute $pol$
      create policy "sellers_select" on public.sellers
        for select to authenticated using (public.is_admin_or_above())
    $pol$;
    -- No INSERT: a seller business record can no longer be created.
    drop policy if exists "sellers_admin_insert" on public.sellers;
    -- No DELETE: historical seller records are never removed.
    drop policy if exists "sellers_admin_delete" on public.sellers;
  end if;
end;
$seller_row_policies$;

-- Supplier document tables: admin read only, no new inserts.
do $supplier_policies$
begin
  if to_regclass('public.suppliers') is not null then
    drop policy if exists "suppliers_admin_read" on public.suppliers;
    execute $pol$
      create policy "suppliers_admin_read" on public.suppliers
        for select to authenticated using (public.is_admin_or_above())
    $pol$;
    -- The admin update path STAYS: a historical supplier row must still be
    -- annotatable (status, rejection reason, review metadata) so an audit or a
    -- grievance can be closed. Only the ability to CREATE new suppliers goes.
    drop policy if exists "suppliers_admin_update" on public.suppliers;
    execute $pol$
      create policy "suppliers_admin_update" on public.suppliers
        for update to authenticated
        using (public.is_admin_or_above())
        with check (public.is_admin_or_above())
    $pol$;
  end if;

  if to_regclass('public.supplier_documents') is not null then
    drop policy if exists "supplier_documents_admin_read" on public.supplier_documents;
    execute $pol$
      create policy "supplier_documents_admin_read" on public.supplier_documents
        for select to authenticated using (public.is_admin_or_above())
    $pol$;
    drop policy if exists "supplier_documents_admin_insert" on public.supplier_documents;
  end if;

  -- No new supplier application rate-limit buckets.
  if to_regclass('public.supplier_application_rate_limits') is not null then
    revoke all on table public.supplier_application_rate_limits from anon, authenticated;
  end if;
end;
$supplier_policies$;


-- ---------------------------------------------------------------------------
-- 6. SELLER ACCOUNT INVITATIONS — keep the rows, remove the mint capability
-- ---------------------------------------------------------------------------
do $invite_policies$
begin
  if to_regclass('public.seller_account_invites') is not null then
    drop policy if exists "seller_invites_super_admin_read" on public.seller_account_invites;
    execute $pol$
      create policy "seller_invites_super_admin_read" on public.seller_account_invites
        for select to authenticated using (public.current_user_role() = 'super_admin')
    $pol$;
    -- No INSERT / UPDATE: a new seller invitation cannot be created or resent.
    drop policy if exists "seller_invites_super_admin_insert" on public.seller_account_invites;
    drop policy if exists "seller_invites_super_admin_update" on public.seller_account_invites;
    drop policy if exists "seller_invites_super_admin_mark_sent" on public.seller_account_invites;
    revoke insert, update, delete on table public.seller_account_invites from authenticated;
    grant select on table public.seller_account_invites to authenticated;
  end if;
end;
$invite_policies$;


-- ---------------------------------------------------------------------------
-- 7. RETIRED `seller` PROFILES — block every remaining capability
-- ---------------------------------------------------------------------------
-- `user_role` keeps the 'seller' value (PostgreSQL cannot drop an enum value in
-- place, and re-creating the type would rewrite every dependent column and all
-- history). The application refuses the role at sign-in, in middleware and in
-- requireUser(). This block removes the database half:
--   * the accounts are deactivated, so any surviving session fails the
--     is_active_account() check that 0052's restrictive policies already use;
--   * nothing is deleted: profiles, auth users, membership rows and every order
--     they ever placed remain in place for audit.
--
-- A former seller who ALSO holds a legitimate, already-approved retailer record
-- is a DUAL-ROLE account. The schema has always supported this: `public.retailers`
-- is a separate table keyed on the same profile id, so a profile can hold a
-- retailer row while its single `profiles.role` column says something else. The
-- SELLER half of that account is retired; the RETAILER half was never part of the
-- marketplace and must not be destroyed by a marketplace removal.
--
-- So this block separates the three cases explicitly:
--
--   SELLER-ONLY  (no `retailers` row)
--     -> deactivated. Nothing deleted; profile, auth user, seller membership,
--        orders and audit rows all survive. NEVER converted to a retailer.
--
--   DUAL-ROLE, retailer ALREADY APPROVED  (`retailers.status = 'active'`)
--     -> re-roled to `retailer` and kept active. This is NOT a new grant: the
--        status was set by the retailer approval workflow, and `is_active_account()`
--        (0052) already requires exactly `retailers.status = 'active'` for a
--        retailer-role profile, so the account's effective permission set is
--        unchanged. Only the seller capability is lost -- and that is enforced by
--        the revocations above, not by the profile row.
--
--   DUAL-ROLE, retailer NOT APPROVED  (`pending_approval` / `suspended`)
--     -> deactivated, role left as `seller`. The retailer side never passed
--        approval (or was revoked), so there is nothing legitimate to preserve.
--        If the owner later approves the application through
--        admin_review_retailer_application (0081), that function sets
--        retailers.status = 'active' but does NOT re-role the profile, so block 9
--        below provides a re-role path for exactly that case.
--
-- A seller-only account is NEVER promoted: the split above requires a pre-existing
-- `retailers` row, which only the retail registration or approval workflow creates.
--
-- Every decision is written to `public.audit_logs` with before/after state, so the
-- owner can review and reverse each one. Counts are emitted as NOTICEs.
do $retired_profiles$
declare
  v_seller_profiles integer;
  v_seller_only integer;
  v_dual_active integer;
  v_dual_unapproved integer;
  v_deactivated integer;
  v_promoted integer;
  v_row record;
begin
  -- Guard: the enum value may not exist on a database predating 0062.
  if not exists (
    select 1 from pg_enum e
      join pg_type t on t.oid = e.enumtypid
     where t.typname = 'user_role' and e.enumlabel = 'seller'
  ) then
    raise notice '0110: user_role has no seller value - nothing to deactivate.';
    return;
  end if;

  select count(*) into v_seller_profiles
    from public.profiles where role::text = 'seller';

  -- The three populations, counted up front so the operator sees the whole
  -- picture even when every bucket is empty.
  select count(*) into v_seller_only
    from public.profiles p
   where p.role::text = 'seller'
     and not exists (select 1 from public.retailers r where r.id = p.id);

  select count(*) into v_dual_active
    from public.profiles p
    join public.retailers r on r.id = p.id
   where p.role::text = 'seller'
     and r.status = 'active';

  select count(*) into v_dual_unapproved
    from public.profiles p
    join public.retailers r on r.id = p.id
   where p.role::text = 'seller'
     and r.status <> 'active';

  -- ---- 1. DUAL-ROLE, retailer ALREADY APPROVED: preserve retailer access ----
  for v_row in
    select p.id, p.role::text as old_role, p.is_active as old_active
      from public.profiles p
      join public.retailers rt on rt.id = p.id
     where p.role::text = 'seller'
       and rt.status = 'active'
  loop
    update public.profiles
       set role = 'retailer',
           is_active = true
     where id = v_row.id;

    insert into public.audit_logs (table_name, record_id, action, changed_by, old_data, new_data)
    values (
      'profiles', v_row.id, 'update', null,
      jsonb_build_object('role', v_row.old_role, 'is_active', v_row.old_active, 'source', 'migration 0110'),
      jsonb_build_object(
        'role', 'retailer',
        'is_active', true,
        'source', 'migration 0110',
        'reason', 'dual-role seller profile with an already-approved retailers.status=active row: seller capability retired, legitimate retailer access preserved'
      )
    );
    v_promoted := v_promoted + 1;
  end loop;

  -- ---- 2. DUAL-ROLE, retailer NOT approved: deactivate, keep the role --------
  for v_row in
    select p.id, p.role::text as old_role, p.is_active as old_active, rt.status::text as retailer_status
      from public.profiles p
      join public.retailers rt on rt.id = p.id
     where p.role::text = 'seller'
       and rt.status <> 'active'
  loop
    update public.profiles set is_active = false where id = v_row.id;

    insert into public.audit_logs (table_name, record_id, action, changed_by, old_data, new_data)
    values (
      'profiles', v_row.id, 'update', null,
      jsonb_build_object('role', v_row.old_role, 'is_active', v_row.old_active, 'source', 'migration 0110'),
      jsonb_build_object(
        'role', v_row.old_role,
        'is_active', false,
        'source', 'migration 0110',
        'reason', format('dual-role seller profile whose retailers.status is "%s" (not approved): deactivated, not promoted', v_row.retailer_status)
      )
    );
  end loop;

  -- ---- 3. SELLER-ONLY: deactivate, never convert -----------------------------
  for v_row in
    select p.id, p.role::text as old_role, p.is_active as old_active
      from public.profiles p
     where p.role::text = 'seller'
       and not exists (select 1 from public.retailers rt where rt.id = p.id)
  loop
    update public.profiles set is_active = false where id = v_row.id;

    insert into public.audit_logs (table_name, record_id, action, changed_by, old_data, new_data)
    values (
      'profiles', v_row.id, 'update', null,
      jsonb_build_object('role', v_row.old_role, 'is_active', v_row.old_active, 'source', 'migration 0110'),
      jsonb_build_object(
        'role', v_row.old_role,
        'is_active', false,
        'source', 'migration 0110',
        'reason', 'seller-only account: seller programme discontinued, deactivated. Not converted to a retailer.'
      )
    );
  end loop;

  select count(*) into v_deactivated
    from public.profiles where role::text = 'seller' and is_active = false;

  raise notice '0110: seller profiles=% (seller-only=%, dual-role approved=%, dual-role unapproved=%) - promoted to retailer=%, now inactive=%',
    v_seller_profiles, v_seller_only, v_dual_active, v_dual_unapproved, v_promoted, v_deactivated;
end;
$retired_profiles$;


-- ---------------------------------------------------------------------------
-- 7b. WEBSITE CONTENT — retire the marketplace claims in the DRAFT content
-- ---------------------------------------------------------------------------
-- 0105 seeds every managed page as a draft, and 0104/0105 have never been
-- applied to the hosted project. A page that IS already published would
-- otherwise keep telling customers that "the application includes marketplace
-- and seller features", which is no longer true.
--
-- This block rewrites ONLY the exact superseded sentences, and only where the
-- stored body still contains them:
--   * a page that does not already say this is untouched;
--   * an owner edit in Super Admin -> Website content is never overwritten;
--   * `status`, `published_at`, `published_snapshot`, `version` and
--     `effective_date` are NOT touched. A live policy's version history is the
--     owner's decision, so this migration fixes drafts and leaves republishing
--     an explicit act. (Running it after publication is safe: the draft text is
--     already corrected and the snapshot is not read back.)
-- The same replacement table lives in scripts/generate-site-content-seed.mjs, so
-- a regenerated seed and this migration cannot disagree.
do $site_copy$
declare
  v_replacements jsonb := $json$[
    {"from": "The application includes marketplace and seller features, including seller offers and fulfilment; their availability depends on configuration. These own-stock sales terms do not provide a complete set of terms for third-party seller transactions. Any third-party launch or ongoing operation requires separately reviewed customer and seller terms, including the seller of record, invoicing, fulfilment, returns and support responsibilities. Applicable rights are not excluded.", "to": "Maharani Traders sells goods held in its own stock; there is no marketplace and no third-party seller offers. The third-party seller programme that earlier versions of these terms mentioned has been discontinued, and any order placed before that change is unaffected. The business identity that appears as the seller, as the invoice issuer and on the GST registration for a given transaction is stated on the invoice and in the Contact and Legal Information page; it is not assumed by this page. Applicable rights are not excluded."},
    {"from": "The application also supports third-party seller fulfilment: if used, the relevant seller may receive order and delivery information, including the recipient address and phone where provided. Marketplace data flows and disclosures require verification before any third-party operation.", "to": "Because every order is fulfilled by Maharani Traders from its own stock, order and delivery information is not disclosed to any independent seller or marketplace participant; that programme has been discontinued."},
    {"from": "The own-stock sales policies do not provide complete terms for third-party seller transactions. The application includes marketplace features for seller offers and fulfilment, subject to configuration; we have not verified whether those features are operating in production. Any third-party launch or ongoing operation requires separately reviewed seller and customer terms and clear allocation of invoicing, fulfilment, return and support responsibilities. Applicable rights are not excluded.", "to": "Maharani Traders operates a single-seller store: goods are sold only from its own stock, so there are no third-party seller transactions to allocate. The third-party marketplace and seller programme described in earlier versions of this page has been discontinued. Which business identity is the seller, the invoice issuer or the GST registrant for a transaction is stated on the invoice and in the Contact and Legal Information page, and is not assumed by this page. Applicable rights are not excluded."},
    {"from": "The application includes marketplace and seller features, subject to configuration. The own-stock sales policies do not provide complete terms for third-party transactions; any launch or ongoing operation requires separate review.", "to": "Maharani Traders sells only from its own stock, so every order is fulfilled and invoiced by Maharani Traders. The third-party marketplace described in earlier versions of this page has been discontinued."},
    {"from": "Seller accounts are created by Super Admin invitation. If you have an invitation, use the emailed link; verification and approval are required before trading. The current own-stock sales policies do not provide complete terms for third-party seller transactions, which require separate review.", "to": "There is no seller or supplier sign-up. Retail shop accounts are created by registering on this site and are activated after approval by Maharani Traders. If you already held a seller account under the earlier marketplace programme, that programme has been discontinued; contact us using the details below and we will explain what is available to you."},
    {"from": "For goods sold by an independent seller, we pass the complaint to that seller and follow it up; see the Marketplace Disclaimer.", "to": "Every order on this website is sold and fulfilled by Maharani Traders from its own stock, so we handle the whole complaint ourselves and there is no third party to pass it to. See the Marketplace Disclaimer for the record of the discontinued marketplace programme."},
    {"from": "An invoice or bill is issued for every delivered order by the seller of the goods: by us for own-stock goods, and by the independent seller for seller offers. Where one order contains goods from more than one seller, you may receive more than one invoice.", "to": "An invoice or bill is issued for every delivered order. The business identity printed on it as the seller and as the GST registrant is the one recorded for that transaction; this website does not assume a legal seller role for any brand or business name it uses, and the invoice for the transaction is the authoritative record. Because there is no marketplace, an order never contains goods supplied by another seller and you will not receive an invoice from a third party."},
    {"from": "the database rejects a product or seller offer placed in any other category.", "to": "the database rejects a product placed in any other category."},
    {"from": "Seller offers are reviewed before they go live, and each decision is recorded with the reviewer and the reason.", "to": "Every product goes through a compliance review before it can be published, and each decision is recorded with the reviewer and the reason. Only Maharani Traders adds products to this website, so there is no third-party listing channel to police."},
    {"from": "For a seller offer we inform the seller, who may reply with evidence such as purchase invoices or a brand authorisation.", "to": "Because we are the seller of every product on this website, there is no third-party seller to notify: we answer the complaint ourselves with the purchase invoices and brand authorisations we hold."},
    {"from": "If the seller\u2019s reply shows the goods are genuine and lawfully sold, the listing may be restored and we will tell you why. Repeated or serious infringement leads to suspension of the seller.", "to": "If our own records show the goods are genuine and lawfully sold, the listing may be restored and we will tell you why. A listing that cannot be substantiated stays withdrawn."},
    {"from": "For sellers: unsafe, counterfeit, mislabelled or prohibited goods, or failure to respond to complaints.", "to": "For retailer accounts: attempted resale of unsafe, counterfeit, mislabelled or prohibited goods, or failure to respond to complaints about an order."},

    {"from": "Maharani Traders sells only goods from its own stock. There is no marketplace: all products are bought, stored, priced and sold by Maharani Traders, and we are the seller of record for every order. The third-party seller programme that earlier versions of these terms mentioned has been discontinued. Any order placed before that change is unaffected, and any rights you already hold are not excluded.", "to": "Maharani Traders sells goods held in its own stock; there is no marketplace and no third-party seller offers. The third-party seller programme that earlier versions of these terms mentioned has been discontinued, and any order placed before that change is unaffected. The business identity that appears as the seller, as the invoice issuer and on the GST registration for a given transaction is stated on the invoice and in the Contact and Legal Information page; it is not assumed by this page. Applicable rights are not excluded."},
    {"from": "Maharani Traders operates a single-seller store: goods are sold only from its own stock, and it is the seller of record for every order. The third-party marketplace and seller programme described in earlier versions of this page has been discontinued, so there are no third-party seller transactions to allocate. Applicable rights are not excluded.", "to": "Maharani Traders operates a single-seller store: goods are sold only from its own stock, so there are no third-party seller transactions to allocate. The third-party marketplace and seller programme described in earlier versions of this page has been discontinued. Which business identity is the seller, the invoice issuer or the GST registrant for a transaction is stated on the invoice and in the Contact and Legal Information page, and is not assumed by this page. Applicable rights are not excluded."},
    {"from": "An invoice or bill is issued for every delivered order by Maharani Traders, which sells only from its own stock and is therefore the seller of record. Because there is no marketplace, an order never contains goods supplied by another seller and you will not receive a second invoice from a third party.", "to": "An invoice or bill is issued for every delivered order. The business identity printed on it as the seller and as the GST registrant is the one recorded for that transaction; this website does not assume a legal seller role for any brand or business name it uses, and the invoice for the transaction is the authoritative record. Because there is no marketplace, an order never contains goods supplied by another seller and you will not receive an invoice from a third party."}
  ]$json$::jsonb;
  v_pair jsonb;
  v_page record;
  v_before text[];
  v_changed_sections integer := 0;
  v_changed_pages integer := 0;
begin
  if to_regclass('public.site_page_sections') is null then
    raise notice '0110: site content module (0104) is not installed — nothing to rewrite.';
    return;
  end if;

  for v_page in select p.id, p.slug from public.site_pages p loop
    for v_pair in select * from jsonb_array_elements(v_replacements) loop
      -- body and bullets are text[] (0104); replace each element that contains
      -- the superseded sentence and leave every other element byte-identical.
      update public.site_page_sections s
         set body = (
               select coalesce(array_agg(
                        case when line like '%' || (v_pair->>'from') || '%'
                             then replace(line, v_pair->>'from', v_pair->>'to')
                             else line end order by ord), '{}'::text[])
                 from unnest(s.body) with ordinality as t(line, ord)
             ),
             bullets = (
               select coalesce(array_agg(
                        case when line like '%' || (v_pair->>'from') || '%'
                             then replace(line, v_pair->>'from', v_pair->>'to')
                             else line end order by ord), '{}'::text[])
                 from unnest(s.bullets) with ordinality as t(line, ord)
             )
       where s.page_id = v_page.id
         and (
           exists (select 1 from unnest(s.body) as line where line like '%' || (v_pair->>'from') || '%')
           or exists (select 1 from unnest(s.bullets) as line where line like '%' || (v_pair->>'from') || '%')
         );
      v_changed_sections := v_changed_sections + coalesce((select count(*) from public.site_page_sections s
                                                            where s.page_id = v_page.id
                                                              and (exists (select 1 from unnest(s.body) as l
                                                                            where l like '%' || (v_pair->>'to') || '%')
                                                                or exists (select 1 from unnest(s.bullets) as l
                                                                            where l like '%' || (v_pair->>'to') || '%'))), 0);
    end loop;
    v_changed_pages := v_changed_pages + 1;
  end loop;

  raise notice '0110: marketplace wording retired across % seeded page(s); % sentence(s) corrected.',
    v_changed_pages, v_changed_sections;

  -- No seeded page may still advertise the discontinued programme. The
  -- seller-agreement page is excluded: it is the historical contract with
  -- sellers, kept verbatim as a record, and it is never published.
  if exists (
    select 1
      from public.site_pages p
      join public.site_page_sections s on s.page_id = p.id
     where p.slug <> 'seller-agreement'
       and (
         exists (select 1 from unnest(s.body) as l where l like '%marketplace and seller features%')
         or exists (select 1 from unnest(s.bullets) as l where l like '%marketplace and seller features%')
       )
  ) then
    raise exception '0110 VERIFY FAILED: seeded website content still advertises the discontinued marketplace.';
  end if;
end;
$site_copy$;


-- ---------------------------------------------------------------------------
-- 8. VERIFICATION — fail loudly if any capability survived
-- ---------------------------------------------------------------------------
do $verify$
declare
  v_bad text;
begin
  -- No API role may execute any seller-portal or marketplace RPC.
  select string_agg(p.proname, ', ' order by p.proname) into v_bad
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'seller_set_offer_stock','seller_replace_offer_tiers','seller_update_sub_order',
       'seller_update_own_profile','seller_order_headers','seller_offer_gate_status',
       'marketplace_offer_quotes','marketplace_offers_for_product','marketplace_offer_tiers',
       'submit_supplier_application','record_marketplace_launch_approval',
       'reserve_seller_invite','attach_existing_seller_invite','claim_seller_invite_attempt'
     )
     and (
       has_function_privilege('anon', p.oid, 'EXECUTE')
       or has_function_privilege('authenticated', p.oid, 'EXECUTE')
     );

  if v_bad is not null then
    raise exception '0110 VERIFY FAILED: these functions are still executable by an API role: %', v_bad;
  end if;

  -- The public supplier funnel must be closed to anon.
  if to_regprocedure('public.submit_supplier_application(text, text, text, text, text, text, text, text, text, text, text)') is not null
     and has_function_privilege('anon',
           'public.submit_supplier_application(text, text, text, text, text, text, text, text, text, text, text)',
           'EXECUTE') then
    raise exception '0110 VERIFY FAILED: anonymous callers can still submit supplier applications.';
  end if;

  -- No ACTIVE seller-role profile may remain. A dual-role account that kept its
  -- legitimate retailer access is now role='retailer', so this still holds; a
  -- seller-role profile that is inactive is an intentional historical record.
  if exists (select 1 from public.profiles where role::text = 'seller' and is_active = true) then
    raise exception '0110 VERIFY FAILED: an active seller-role profile remains.';
  end if;

  -- Retailer access must not have been collateral damage. A dual-role account
  -- whose retailer side was already approved must still be a live retailer.
  if exists (
    select 1
      from public.profiles p
      join public.retailers r on r.id = p.id
     where r.status = 'active'
       and (p.role::text <> 'retailer' or p.is_active = false)
  ) then
    raise exception '0110 VERIFY FAILED: an approved retailer lost retailer access.';
  end if;

  -- The historical data this migration promised to preserve must still be there.
  if to_regclass('public.sub_orders') is null
     or to_regclass('public.seller_ledger') is null
     or to_regclass('public.collection_allocations') is null
     or to_regclass('public.suppliers') is null then
    raise exception '0110 VERIFY FAILED: a historical table is missing. This migration must never drop one.';
  end if;

  -- 0109's preflight contract must still hold.
  if to_regclass('public.sellers') is null
     or to_regprocedure('public.is_active_seller_member(uuid)') is null then
    raise exception '0110 VERIFY FAILED: the 0109 dependency contract (sellers + is_active_seller_member) was broken.';
  end if;

  raise notice '0110: seller/supplier capability revoked; all historical tables and rows preserved.';
end;
$verify$;

-- ---------------------------------------------------------------------------
-- 9. RE-ROLE PATH for a dual-role account approved AFTER this migration
-- ---------------------------------------------------------------------------
-- If the owner later approves a pending retailer application through
-- admin_review_retailer_application (0081) for a profile that this migration
-- deactivated, that function sets `retailers.status = 'active'` but does not
-- touch `profiles.role`. This helper performs the missing step deliberately and
-- idempotently, so the owner does not have to hand-write an UPDATE.
--
-- It is service_role-only: it changes an account's role, which no API caller may
-- do (0052's guard_profile_privileged_columns already enforces that).
create or replace function public.retire_promote_dual_role_seller(p_profile_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_active boolean;
  v_retailer_status text;
begin
  if p_profile_id is null then
    return jsonb_build_object('ok', false, 'reason', 'profile_id_required');
  end if;

  select p.role::text, p.is_active into v_role, v_active
    from public.profiles p where p.id = p_profile_id;
  if v_role is null then
    return jsonb_build_object('ok', false, 'reason', 'profile_not_found');
  end if;

  select r.status::text into v_retailer_status
    from public.retailers r where r.id = p_profile_id;

  if v_retailer_status is null then
    -- Seller-only. Refuse: this helper must never convert one into a retailer.
    return jsonb_build_object('ok', false, 'reason', 'seller_only_never_converted', 'role', v_role);
  end if;

  if v_retailer_status <> 'active' then
    return jsonb_build_object('ok', false, 'reason', 'retailer_not_approved', 'retailer_status', v_retailer_status, 'role', v_role);
  end if;

  if v_role = 'retailer' and v_active then
    return jsonb_build_object('ok', true, 'changed', false, 'reason', 'already_retailer', 'retailer_status', v_retailer_status);
  end if;

  update public.profiles set role = 'retailer', is_active = true where id = p_profile_id;

  insert into public.audit_logs (table_name, record_id, action, changed_by, old_data, new_data)
  values (
    'profiles', p_profile_id, 'update', auth.uid(),
    jsonb_build_object('role', v_role, 'is_active', v_active, 'source', 'retire_promote_dual_role_seller'),
    jsonb_build_object('role', 'retailer', 'is_active', true, 'source', 'retire_promote_dual_role_seller',
                       'reason', 'retailer application approved after migration 0110: retailer access restored')
  );

  return jsonb_build_object('ok', true, 'changed', true, 'previous_role', v_role, 'role', 'retailer', 'retailer_status', v_retailer_status);
end;
$$;
revoke all on function public.retire_promote_dual_role_seller(uuid) from public, anon, authenticated;
grant execute on function public.retire_promote_dual_role_seller(uuid) to service_role;

comment on function public.retire_promote_dual_role_seller(uuid) is
  'Service-role only. Restores retailer access for a dual-role account whose retailer application was approved AFTER migration 0110. Refuses seller-only accounts (never converts one into a retailer). Writes an audit_logs row.';


-- ============================================================================
-- OWNER ACTION REQUIRED (not performed by this migration, by design)
-- ============================================================================
-- 1. Apply this migration to the hosted project (`fhrmsrumsraprvutrpeo`) only
--    after reviewing it on a disposable database.
-- 2. Review the NOTICE emitted by block 7. If any deactivated seller profile is
--    a real person who also trades legitimately, the owner must deliberately
--    create/re-approve a retailer account for them. This migration will not
--    invent one.
-- 3. No production action of any kind was performed by the author of this file.
-- ============================================================================
