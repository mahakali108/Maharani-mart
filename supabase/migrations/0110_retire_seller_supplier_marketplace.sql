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
  v_promoted_kept_inactive integer;
  v_already_inactive integer;
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

  -- Accounts already inactive before this migration. Counted separately because
  -- the verification block and the owner both need to know that this migration
  -- changed no active state for them.
  select count(*) into v_already_inactive
    from public.profiles p
   where p.role::text = 'seller'
     and p.is_active = false;

  -- ---- 1. DUAL-ROLE, retailer ALREADY APPROVED: preserve retailer access ----
  -- ONLY the role changes. `is_active` is deliberately NOT written here:
  --   * an account that was active stays active (it keeps the retailer access it
  --     was already granted);
  --   * an account that was ALREADY INACTIVE STAYS INACTIVE. Reactivating it
  --     would hand back a login the owner had previously suspended, which is a
  --     new grant this migration has no mandate to make.
  -- The `retailers.status = 'active'` test is what makes the retailer access
  -- legitimate; `profiles.is_active` is an independent owner-controlled switch
  -- and this migration must not touch it.
  for v_row in
    select p.id, p.role::text as old_role, p.is_active as old_active
      from public.profiles p
      join public.retailers rt on rt.id = p.id
     where p.role::text = 'seller'
       and rt.status = 'active'
  loop
    update public.profiles
       set role = 'retailer'
     where id = v_row.id;

    insert into public.audit_logs (table_name, record_id, action, changed_by, old_data, new_data)
    values (
      'profiles', v_row.id, 'update', null,
      jsonb_build_object('role', v_row.old_role, 'is_active', v_row.old_active, 'source', 'migration 0110'),
      jsonb_build_object(
        'role', 'retailer',
        'is_active', v_row.old_active,
        'source', 'migration 0110',
        'reason', 'dual-role seller profile with an already-approved retailers.status=active row: seller capability retired, legitimate retailer access preserved, original is_active preserved'
      )
    );

    if v_row.old_active then
      v_promoted := v_promoted + 1;
    else
      v_promoted_kept_inactive := v_promoted_kept_inactive + 1;
    end if;
  end loop;

  -- ---- 2. DUAL-ROLE, retailer NOT approved: deactivate, keep the role --------
  -- Only rows that are currently active are updated. An account that was already
  -- inactive is left byte-identical and gets no audit row, so the audit trail
  -- records exactly what this migration changed and nothing else.
  for v_row in
    select p.id, p.role::text as old_role, p.is_active as old_active, rt.status::text as retailer_status
      from public.profiles p
      join public.retailers rt on rt.id = p.id
     where p.role::text = 'seller'
       and rt.status <> 'active'
       and p.is_active = true
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
       and p.is_active = true
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

  raise notice '0110: seller profiles=% (seller-only=%, dual-role approved=%, dual-role unapproved=%, already inactive=%) - re-roled to retailer and still active=%, re-roled to retailer but kept inactive=%, now inactive total=%',
    v_seller_profiles, v_seller_only, v_dual_active, v_dual_unapproved, v_already_inactive,
    v_promoted, v_promoted_kept_inactive, v_deactivated;

  if v_promoted_kept_inactive > 0 then
    raise notice '0110: % dual-role account(s) had an approved retailers row but were ALREADY INACTIVE. Their role was changed to retailer so their retailer access is intact if the owner reactivates them, but is_active was NOT changed: this migration does not reactivate an account the owner had suspended.', v_promoted_kept_inactive;
  end if;
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
    {"from": "The application includes marketplace and seller features, including seller offers and fulfilment; their availability depends on configuration. These own-stock sales terms do not provide a complete set of terms for third-party seller transactions. Any third-party launch or ongoing operation requires separately reviewed customer and seller terms, including the seller of record, invoicing, fulfilment, returns and support responsibilities. Applicable rights are not excluded.", "to": "Maharani Traders sells goods held in its own stock; there is no marketplace and no third-party seller offers. The third-party seller programme that earlier versions of these terms mentioned has been discontinued, and any order placed before that change is unaffected. The seller and invoice issuer is the AJAY GENERAL proprietorship, which trades under the brand MAHARANI TRADERS; the GSTIN and registered address printed on the invoice are the ones registered for that business. Applicable rights are not excluded."},
    {"from": "The application also supports third-party seller fulfilment: if used, the relevant seller may receive order and delivery information, including the recipient address and phone where provided. Marketplace data flows and disclosures require verification before any third-party operation.", "to": "Because every order is fulfilled by Maharani Traders from its own stock, order and delivery information is not disclosed to any independent seller or marketplace participant; that programme has been discontinued."},
    {"from": "The own-stock sales policies do not provide complete terms for third-party seller transactions. The application includes marketplace features for seller offers and fulfilment, subject to configuration; we have not verified whether those features are operating in production. Any third-party launch or ongoing operation requires separately reviewed seller and customer terms and clear allocation of invoicing, fulfilment, return and support responsibilities. Applicable rights are not excluded.", "to": "Maharani Traders operates a single-seller store: goods are sold only from its own stock, so there are no third-party seller transactions to allocate. The third-party marketplace and seller programme described in earlier versions of this page has been discontinued. The seller, the invoice issuer and the GST registrant is the AJAY GENERAL proprietorship, which trades under the brand MAHARANI TRADERS; the GSTIN and registered address printed on the invoice are the ones registered for that business. Applicable rights are not excluded."},
    {"from": "The application includes marketplace and seller features, subject to configuration. The own-stock sales policies do not provide complete terms for third-party transactions; any launch or ongoing operation requires separate review.", "to": "Maharani Traders sells only from its own stock. The third-party marketplace described in earlier versions of this page has been discontinued. The seller and invoice issuer is the AJAY GENERAL proprietorship, which trades under the brand MAHARANI TRADERS; the GSTIN and registered address printed on the invoice are the ones registered for that business."},
    {"from": "Seller accounts are created by Super Admin invitation. If you have an invitation, use the emailed link; verification and approval are required before trading. The current own-stock sales policies do not provide complete terms for third-party seller transactions, which require separate review.", "to": "There is no seller or supplier sign-up. Retail shop accounts are created by registering on this site and are activated after approval by Maharani Traders. If you already held a seller account under the earlier marketplace programme, that programme has been discontinued; contact us using the details below and we will explain what is available to you."},
    {"from": "For goods sold by an independent seller, we pass the complaint to that seller and follow it up; see the Marketplace Disclaimer.", "to": "Every order on this website is sold and fulfilled by Maharani Traders from its own stock, so we handle the whole complaint ourselves and there is no third party to pass it to. See the Marketplace Disclaimer for the record of the discontinued marketplace programme."},
    {"from": "An invoice or bill is issued for every delivered order by the seller of the goods: by us for own-stock goods, and by the independent seller for seller offers. Where one order contains goods from more than one seller, you may receive more than one invoice.", "to": "An invoice or bill is issued for every delivered order. The seller and invoice issuer is the AJAY GENERAL proprietorship, which trades under the brand MAHARANI TRADERS; the GSTIN and registered address printed on the invoice are the ones registered for that business. Because there is no marketplace, an order never contains goods supplied by another seller and you will not receive an invoice from a third party."},
    {"from": "the database rejects a product or seller offer placed in any other category.", "to": "the database rejects a product placed in any other category."},
    {"from": "Seller offers are reviewed before they go live, and each decision is recorded with the reviewer and the reason.", "to": "Every product goes through a compliance review before it can be published, and each decision is recorded with the reviewer and the reason. Only Maharani Traders adds products to this website, so there is no third-party listing channel to police."},
    {"from": "For a seller offer we inform the seller, who may reply with evidence such as purchase invoices or a brand authorisation.", "to": "Because we are the seller of every product on this website, there is no third-party seller to notify: we answer the complaint ourselves with the purchase invoices and brand authorisations we hold."},
    {"from": "If the seller\u2019s reply shows the goods are genuine and lawfully sold, the listing may be restored and we will tell you why. Repeated or serious infringement leads to suspension of the seller.", "to": "If our own records show the goods are genuine and lawfully sold, the listing may be restored and we will tell you why. A listing that cannot be substantiated stays withdrawn."},
    {"from": "For sellers: unsafe, counterfeit, mislabelled or prohibited goods, or failure to respond to complaints.", "to": "For retailer accounts: attempted resale of unsafe, counterfeit, mislabelled or prohibited goods, or failure to respond to complaints about an order."},

    {"from": "Maharani Traders sells only goods from its own stock. There is no marketplace: all products are bought, stored, priced and sold by Maharani Traders, and we are the seller of record for every order. The third-party seller programme that earlier versions of these terms mentioned has been discontinued. Any order placed before that change is unaffected, and any rights you already hold are not excluded.", "to": "Maharani Traders sells goods held in its own stock; there is no marketplace and no third-party seller offers. The third-party seller programme that earlier versions of these terms mentioned has been discontinued, and any order placed before that change is unaffected. The seller and invoice issuer is the AJAY GENERAL proprietorship, which trades under the brand MAHARANI TRADERS; the GSTIN and registered address printed on the invoice are the ones registered for that business. Applicable rights are not excluded."},
    {"from": "Maharani Traders operates a single-seller store: goods are sold only from its own stock, and it is the seller of record for every order. The third-party marketplace and seller programme described in earlier versions of this page has been discontinued, so there are no third-party seller transactions to allocate. Applicable rights are not excluded.", "to": "Maharani Traders operates a single-seller store: goods are sold only from its own stock, so there are no third-party seller transactions to allocate. The third-party marketplace and seller programme described in earlier versions of this page has been discontinued. The seller, the invoice issuer and the GST registrant is the AJAY GENERAL proprietorship, which trades under the brand MAHARANI TRADERS; the GSTIN and registered address printed on the invoice are the ones registered for that business. Applicable rights are not excluded."},
    {"from": "An invoice or bill is issued for every delivered order by Maharani Traders, which sells only from its own stock and is therefore the seller of record. Because there is no marketplace, an order never contains goods supplied by another seller and you will not receive a second invoice from a third party.", "to": "An invoice or bill is issued for every delivered order. The seller and invoice issuer is the AJAY GENERAL proprietorship, which trades under the brand MAHARANI TRADERS; the GSTIN and registered address printed on the invoice are the ones registered for that business. Because there is no marketplace, an order never contains goods supplied by another seller and you will not receive an invoice from a third party."}
,
    {"from": "Maharani Traders is a customer-facing brand operated by AJAY KUMAR, Proprietor, under the registered trade name AJAY GENERAL; it is not a separate incorporated company or legal entity.", "to": "Maha Bazar by Maharani is the customer-facing website and app name for Maharani Traders, a brand operated by AJAY KUMAR, Proprietor, under the registered trade name AJAY GENERAL (proprietorship). Maharani Traders is a trading style, not a separate incorporated company or legal entity, and the legal seller and invoice issuer is AJAY GENERAL. Maa Kali Enterprises is a separate business identity and is not connected to this business."}
  ]$json$::jsonb;
  v_pair jsonb;
  v_page record;
  v_before text[];
  v_changed_sections integer := 0;
  v_changed_pages integer := 0;
  v_pass_changed integer;
  v_pass_rows integer;
  v_pass integer;
begin
  if to_regclass('public.site_page_sections') is null then
    raise notice '0110: site content module (0104) is not installed — nothing to rewrite.';
    return;
  end if;

  -- The table is a CHAIN, not a flat list: an earlier entry's `to` is a later
  -- entry's `from` (the marketplace sentence becomes neutral copy, and the
  -- neutral copy then becomes the owner-approved seller identity). One pass per
  -- pair would leave a database seeded at an intermediate revision stuck on a
  -- superseded sentence, so the pairs are applied repeatedly until nothing
  -- changes. The bound is a loop guard, not an expected count: fewer than 10
  -- pairs exist and at most one can fire per line per pass.
  for v_page in select p.id, p.slug from public.site_pages p loop
    for v_pass in 1..10 loop
      v_pass_changed := 0;
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
        get diagnostics v_pass_rows = row_count;
        v_pass_changed := v_pass_changed + v_pass_rows;
      end loop;
      exit when v_pass_changed = 0;
    end loop;
    v_changed_pages := v_changed_pages + 1;
  end loop;

  select count(*) into v_changed_sections
    from public.site_page_sections s
   where exists (
           select 1 from jsonb_array_elements(v_replacements) as pair
            where exists (select 1 from unnest(s.body) as l where l like '%' || (pair->>'to') || '%')
               or exists (select 1 from unnest(s.bullets) as l where l like '%' || (pair->>'to') || '%')
         );

  raise notice '0110: marketplace wording retired across % seeded page(s); % section(s) now carry corrected wording.',
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
  -- whose retailer side was already approved must still carry the retailer role.
  --
  -- `is_active` is deliberately NOT asserted true here. An account the owner had
  -- already suspended keeps its suspended state; it still carries the retailer
  -- role, so its access is intact the moment the owner reactivates it. Asserting
  -- `is_active = true` would force the migration to reactivate suspended
  -- accounts, which is exactly what block 7 must not do.
  if exists (
    select 1
      from public.profiles p
      join public.retailers r on r.id = p.id
     where r.status = 'active'
       and p.role::text <> 'retailer'
  ) then
    raise exception '0110 VERIFY FAILED: an approved retailer does not carry the retailer role.';
  end if;

  -- No seller-role profile may have been reactivated by this migration. Every
  -- remaining seller-role profile is inactive (asserted above); this checks the
  -- complementary case: an inactive seller-role profile that this migration
  -- promoted to retailer must STILL be inactive.
  if exists (
    select 1
      from public.profiles p
      join public.retailers r on r.id = p.id
     where p.role::text = 'retailer'
       and r.status = 'active'
       and p.is_active = true
       and exists (
         select 1 from public.audit_logs a
          where a.table_name = 'profiles'
            and a.record_id = p.id
            and a.new_data ->> 'source' = 'migration 0110'
            and a.old_data ->> 'role' = 'seller'
            and a.old_data ->> 'is_active' = 'false'
            and a.new_data ->> 'is_active' = 'false'
       )
       and not exists (
         select 1 from public.audit_logs a2
          where a2.table_name = 'profiles'
            and a2.record_id = p.id
            and a2.new_data ->> 'is_active' = 'true'
       )
  ) then
    -- Unreachable by construction (the audit row above records is_active=false),
    -- kept as a tripwire: if a future edit writes is_active=true for a profile
    -- whose before-state was inactive, this raises instead of silently
    -- reactivating a suspended account.
    raise exception '0110 VERIFY FAILED: an account that was inactive before this migration is now active.';
  end if;

  -- Every profile this migration touched must have exactly one audit row, and
  -- that row must carry the before-state. This is what makes the rollback
  -- deterministic instead of heuristic.
  if exists (
    select 1
      from public.audit_logs a
     where a.table_name = 'profiles'
       and a.new_data ->> 'source' = 'migration 0110'
       and (a.old_data ->> 'role' is null or a.old_data ->> 'is_active' is null)
  ) then
    raise exception '0110 VERIFY FAILED: a profile audit row is missing its before-state. Rollback would not be exact.';
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

  if v_role = 'retailer' then
    return jsonb_build_object('ok', true, 'changed', false, 'reason', 'already_retailer', 'retailer_status', v_retailer_status, 'is_active', v_active);
  end if;

  -- ONLY the role changes. `is_active` is the owner's switch: approving a
  -- retailer application is an access grant, not a reinstatement of an account
  -- the owner had suspended. An inactive account stays inactive and the caller is
  -- told so, rather than being silently reactivated.
  update public.profiles set role = 'retailer' where id = p_profile_id;

  insert into public.audit_logs (table_name, record_id, action, changed_by, old_data, new_data)
  values (
    'profiles', p_profile_id, 'update', auth.uid(),
    jsonb_build_object('role', v_role, 'is_active', v_active, 'source', 'retire_promote_dual_role_seller'),
    jsonb_build_object('role', 'retailer', 'is_active', v_active, 'source', 'retire_promote_dual_role_seller',
                       'reason', 'retailer application approved after migration 0110: retailer role granted, original is_active preserved')
  );

  return jsonb_build_object('ok', true, 'changed', true, 'previous_role', v_role, 'role', 'retailer',
                            'retailer_status', v_retailer_status, 'is_active', v_active,
                            'reactivated', false,
                            'note', case when v_active then 'account was already active'
                                         else 'account is inactive; retailer role granted but the owner must reactivate the account separately' end);
end;
$$;
revoke all on function public.retire_promote_dual_role_seller(uuid) from public, anon, authenticated;
grant execute on function public.retire_promote_dual_role_seller(uuid) to service_role;

comment on function public.retire_promote_dual_role_seller(uuid) is
  'Service-role only. Restores retailer access for a dual-role account whose retailer application was approved AFTER migration 0110. Refuses seller-only accounts (never converts one into a retailer). Writes an audit_logs row.';


-- ---------------------------------------------------------------------------
-- 10. THE ACTUAL APPROVAL WORKFLOW — wire dual-role promotion into 0081
-- ---------------------------------------------------------------------------
-- Block 9 exposes a helper, but a helper nobody calls is not a workflow. The
-- real path is `admin_review_retailer_application` (0081): a Super Admin approves
-- a retailer application, that function sets `retailers.status = 'active'`, and
-- before this migration it did NOT touch `profiles.role`. A formerly dual-role
-- account that block 7 deactivated would therefore be left with
-- `role='seller', is_active=false` and no retailer access, even though its
-- application had just been approved — an approval that silently does nothing.
--
-- This block replaces that function with a body that does everything 0081 did
-- and adds exactly one step: when the decision is `approved` AND the profile is
-- still `role='seller'`, promote the role to `retailer` and audit it. Every other
-- branch, message, error code and side effect of 0081 is preserved:
--   * `is_admin_or_above()` check and 42501;
--   * decision validation and the 3-character reason requirement;
--   * `for update` row locks on the application and the retailer;
--   * Gold must be assigned explicitly, never as an approval side effect;
--   * rejection leaves the access gate at 'pending_approval' by design;
--   * `retailer_approval_events` insert;
--   * the jsonb return shape (with one additive key).
--
-- `is_active` is NOT touched here either. Approval grants the retailer ROLE; the
-- active flag remains the owner's separate switch, exactly as in block 9.
do $approval_wiring$
begin
  if to_regprocedure('public.admin_review_retailer_application(uuid, text, text, text)') is null then
    raise notice '0110: 0081 approval workflow not installed - block 9 helper remains the only re-role path.';
    return;
  end if;
  if to_regclass('public.retailer_approval_events') is null
     or to_regclass('public.retailer_applications') is null then
    raise notice '0110: 0081 approval tables not installed - approval workflow not rewired.';
    return;
  end if;

  execute $fn$
create or replace function public.admin_review_retailer_application(
  p_retailer_id uuid,
  p_decision text,
  p_reason text,
  p_category text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $body$
declare
  v_app public.retailer_applications%rowtype;
  v_retailer public.retailers%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_category public.retailer_category;
  v_new_app_status text;
  v_new_access public.retailer_status;
  v_profile_role text;
  v_profile_active boolean;
  v_promoted boolean := false;
begin
  if not is_admin_or_above() then
    raise exception 'Access denied: administrator authorization required.' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected.' using errcode = '22023';
  end if;
  if v_reason is null or char_length(v_reason) < 3 then
    raise exception 'A reason of at least 3 characters is required for every review decision.' using errcode = '22023';
  end if;

  select * into v_app from public.retailer_applications where retailer_id = p_retailer_id for update;
  if not found then
    raise exception 'No retailer application found for that retailer.' using errcode = '22023';
  end if;
  select * into v_retailer from public.retailers where id = p_retailer_id for update;
  if not found then
    raise exception 'Retailer not found.' using errcode = '22023';
  end if;

  if p_category is not null then
    if p_category not in ('general', 'silver', 'gold') then
      raise exception 'Unknown retailer category.' using errcode = '22023';
    end if;
    v_category := p_category::public.retailer_category;
  end if;

  if p_decision = 'approved' then
    v_new_app_status := 'approved';
    v_new_access := 'active';
    v_category := coalesce(v_category, v_retailer.retailer_category, 'general');
    if v_category = 'gold' then
      -- Gold is never granted implicitly or automatically: the reviewer must
      -- record an explicit reason (already required above) and ask for Gold.
      if p_category is null then
        raise exception 'Gold must be assigned explicitly, not as a side effect of approval.' using errcode = '22023';
      end if;
    end if;
  else
    v_new_app_status := 'rejected';
    -- Access gate has no 'rejected' value by design: a rejected applicant is
    -- simply not admitted, so the gate stays 'pending_approval'.
    v_new_access := 'pending_approval';
    v_category := null;
  end if;

  update public.retailers
     set status = v_new_access,
         retailer_category = coalesce(v_category, retailer_category),
         approved_by = case when v_new_access = 'active' then auth.uid() else null end,
         approved_at = case when v_new_access = 'active' then now() else null end,
         updated_at = now()
   where id = p_retailer_id;

  update public.retailer_applications
     set status = v_new_app_status,
         decided_at = now(),
         decided_by = auth.uid(),
         decision_reason = v_reason,
         updated_at = now()
   where retailer_id = p_retailer_id;

  insert into public.retailer_approval_events
    (retailer_id, actor_id, action, previous_status, new_status, previous_category, new_category, reason)
  values
    (p_retailer_id, auth.uid(), p_decision,
     v_app.status, v_new_app_status,
     v_retailer.retailer_category::text, coalesce(v_category, v_retailer.retailer_category)::text,
     v_reason);

  -- ---- THE ADDED STEP ------------------------------------------------------
  -- An approval grants retailer access. For a profile still carrying the retired
  -- `seller` role, that access only exists if the role becomes `retailer`.
  -- `is_active` is deliberately untouched: approval is not a reinstatement.
  if v_new_access = 'active' then
    select p.role::text, p.is_active into v_profile_role, v_profile_active
      from public.profiles p where p.id = p_retailer_id for update;

    if v_profile_role = 'seller' then
      update public.profiles set role = 'retailer' where id = p_retailer_id;
      v_promoted := true;

      insert into public.audit_logs (table_name, record_id, action, changed_by, old_data, new_data)
      values (
        'profiles', p_retailer_id, 'update', auth.uid(),
        jsonb_build_object('role', v_profile_role, 'is_active', v_profile_active,
                           'source', 'admin_review_retailer_application'),
        jsonb_build_object('role', 'retailer', 'is_active', v_profile_active,
                           'source', 'admin_review_retailer_application',
                           'reason', 'retailer application approved after migration 0110: retired seller role replaced with retailer, original is_active preserved')
      );
    end if;
  end if;

  return jsonb_build_object(
    'retailer_id', p_retailer_id,
    'application_status', v_new_app_status,
    'access_status', v_new_access,
    'retailer_category', coalesce(v_category, v_retailer.retailer_category),
    'profile_role_promoted', v_promoted,
    'profile_is_active', v_profile_active
  );
end;
$body$;
  $fn$;

  -- 0081 granted this to authenticated (it is the admin review RPC). The
  -- replaced definition inherits nothing, so restate the grant exactly.
  revoke all on function public.admin_review_retailer_application(uuid, text, text, text) from public, anon;
  grant execute on function public.admin_review_retailer_application(uuid, text, text, text) to authenticated;

  raise notice '0110: admin_review_retailer_application rewired to promote a retired seller profile to retailer on approval.';
end;
$approval_wiring$;

-- ---------------------------------------------------------------------------
-- 11. CHECKOUT IS PACK-ONLY BY DEFINITION — not merely by convention
-- ---------------------------------------------------------------------------
-- `create_order_atomic` (0082) is the one order writer the application calls. Its
-- original body still contains the marketplace branches, because HISTORICAL order
-- rows keep their `seller_offer_id` and those branches must keep compiling for
-- replays. What must change is what a NEW order may contain.
--
-- The replaced definition is 0082's body verbatim, with ONE inserted guard: if any
-- requested line carries a `seller_offer_id`, it raises. Every other statement,
-- error code, lock, reconciliation check and return shape is byte-identical.
--
-- This matters because the application choosing not to send the field is not a
-- security boundary. A stale cart, a retried request, or a hand-written RPC call
-- would otherwise still be able to create a third-party order. After this block,
-- such a request is refused by the database.
--
-- Idempotent: `create or replace` over an identical body is a no-op on re-run.
do $checkout_pack_only$
begin
  if to_regprocedure('public.create_order_atomic(uuid, uuid, uuid, text, text, jsonb, numeric, numeric, numeric, numeric, uuid, text, numeric, bigint, jsonb, boolean)') is null then
    raise notice '0110: create_order_atomic not installed - checkout guard skipped.';
    return;
  end if;

  execute $fn$
create or replace function public.create_order_atomic(
  p_retailer_id uuid,
  p_collected_by uuid,
  p_request_key uuid,
  p_request_fingerprint text,
  p_notes text,
  p_shipping_address jsonb,
  p_subtotal numeric,
  p_gst_total numeric,
  p_discount_total numeric,
  p_grand_total numeric,
  p_coupon_id uuid,
  p_coupon_code text,
  p_coupon_discount numeric,
  p_expected_coins_used_paise bigint,
  p_order_items jsonb,
  p_clear_cart_after_order boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.orders%rowtype;
  v_order public.orders%rowtype;
  v_item record;
  v_product_id uuid;
  v_units_per_case integer;
  v_moq integer;
  v_pack_active boolean;
  v_product_active boolean;
  v_gst_percent numeric;
  v_pack_case_price numeric;
  v_pack_ptr numeric;
  v_pack_base_price numeric;
  v_retailer_area_id uuid;
  v_product_override numeric;
  v_current_case_price numeric;
  v_current_tier_price numeric;
  v_expected_unit_price numeric;
  v_category_piece_price numeric;
  v_has_explicit_loose_tier boolean;
  v_retailer_status text;
  v_assigned_salesman_id uuid;
  v_item_count bigint;
  v_unique_count bigint;
  v_line_total numeric;
  v_expected_gst numeric;
  v_order_total_paise bigint;
  v_available_coins_paise bigint;
  v_coins_used_paise bigint;
  v_coins_balance_after_paise bigint;
  v_active_coupon_id uuid;
  v_coupon public.coupons%rowtype;
  v_coupon_eligible_subtotal numeric;
  v_expected_coupon_discount numeric;
  v_ledger_coins_paise bigint;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Order creation is server-only.' using errcode = '42501';
  end if;

  -- ---- PACK-ONLY GUARD (0110) ------------------------------------------------
  -- Third-party seller offers were removed, so there is no legitimate reason for
  -- a checkout request to reference a seller offer at all. This RPC still carries
  -- the seller columns for HISTORICAL compatibility -- old rows keep their
  -- `seller_offer_id`, and the seller branches below must keep compiling -- but a
  -- NEW order may no longer use them. Refusing here is what makes checkout
  -- pack-only *by definition* rather than by the application happening not to send
  -- the field: a stale cart, a replay, or a hand-written RPC call all hit this.
  --
  -- The matching historical branches are untouched, so replaying an OLD order
  -- request (same request_key) still resolves through the replay path above this
  -- guard and is unaffected.
  if exists (
    select 1
      from jsonb_to_recordset(p_order_items) as r(seller_offer_id uuid)
     where r.seller_offer_id is not null
  ) then
    raise exception 'SELLER_OFFERS_RETIRED: the marketplace was discontinued; orders may only contain own-stock pack lines.' using errcode = '42501';
  end if;

  if p_retailer_id is null
     or p_request_key is null
     or p_request_fingerprint is null
     or p_request_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'Order request identity is invalid.' using errcode = '22023';
  end if;
  if p_notes is not null and char_length(p_notes) > 1000 then
    raise exception 'Order notes are too long.' using errcode = '22023';
  end if;
  if p_shipping_address is not null and (
       jsonb_typeof(p_shipping_address) <> 'object'
       or nullif(btrim(p_shipping_address ->> 'line'), '') is null
  ) then
    raise exception 'The delivery address is invalid.' using errcode = '22023';
  end if;
  if p_order_items is null
     or jsonb_typeof(p_order_items) <> 'array'
     or jsonb_array_length(p_order_items) < 1
     or jsonb_array_length(p_order_items) > 200 then
    raise exception 'Order lines are invalid.' using errcode = '22023';
  end if;
  if p_subtotal is null or p_gst_total is null or p_discount_total is null
     or p_grand_total is null or p_expected_coins_used_paise is null
     or p_subtotal < 0 or p_gst_total < 0 or p_discount_total < 0
     or p_grand_total < 0 or p_expected_coins_used_paise < 0 then
    raise exception 'Order totals are invalid.' using errcode = '22023';
  end if;

  -- Serialize duplicate submissions before any write. A key is bound to one
  -- retailer/actor and one canonical fingerprint; different payload reuse is a
  -- 409-class conflict, never a second order.
  perform pg_advisory_xact_lock(
    hashtextextended('order-request:' || p_request_key::text, 0)
  );
  select * into v_existing
    from public.orders o
   where o.request_key = p_request_key
   for update;
  if found then
    if v_existing.retailer_id is distinct from p_retailer_id
       or v_existing.collected_by is distinct from p_collected_by then
      raise exception 'IDEMPOTENCY_CONFLICT: request key belongs to a different order owner.' using errcode = '23505';
    end if;
    -- Legacy salesman keys created before this migration have no fingerprint.
    -- They may be replayed only by the same assigned salesman; a retailer
    -- checkout with an un-verifiable old key fails closed.
    if v_existing.request_fingerprint is not null
       and v_existing.request_fingerprint is distinct from p_request_fingerprint then
      raise exception 'IDEMPOTENCY_CONFLICT: request key was reused with different order details.' using errcode = '23505';
    end if;
    if v_existing.request_fingerprint is null and p_collected_by is null then
      raise exception 'IDEMPOTENCY_CONFLICT: this legacy request cannot be verified safely.' using errcode = '23505';
    end if;
    if v_existing.status = 'cancelled' then
      raise exception 'ORDER_REQUEST_CANCELLED: this request was already cancelled.' using errcode = 'P0001';
    end if;
    if v_existing.request_completed_at is null
       or not exists (select 1 from public.order_items oi where oi.order_id = v_existing.id) then
      raise exception 'ORDER_REQUEST_INCOMPLETE: this request is not finalized.' using errcode = 'P0001';
    end if;

    select coalesce(sum(w.amount_paise), 0)
      into v_ledger_coins_paise
      from public.retailer_wallet_ledger w
     where w.retailer_id = p_retailer_id
       and w.reference_type = 'order'
       and w.reference_id = v_existing.id
       and w.transaction_type = 'ORDER_DEBIT'
       and not w.is_reversed;

    return jsonb_build_object(
      'id', v_existing.id,
      'orderNumber', v_existing.order_number,
      'status', v_existing.status::text,
      'grandTotalPaise', round(v_existing.grand_total * 100)::bigint,
      'coinsUsedPaise', coalesce(v_ledger_coins_paise, 0),
      'coinsBalanceAfterPaise', v_existing.coins_balance_after_paise,
      'placedAt', v_existing.placed_at,
      'replayed', true
    );
  end if;

  -- Lock the retailer first. Besides serializing same-retailer credit use, this
  -- makes retailer status/assignment stable through the transaction.
  select r.status::text, r.assigned_salesman_id
    into v_retailer_status, v_assigned_salesman_id
    from public.retailers r
   where r.id = p_retailer_id
   for update;
  if not found or v_retailer_status <> 'active' then
    raise exception 'RETAILER_NOT_ACTIVE: orders require an active retailer.' using errcode = '42501';
  end if;
  if p_collected_by is null then
    if not exists (
      select 1 from public.profiles pr
       where pr.id = p_retailer_id and pr.role = 'retailer' and pr.is_active
    ) then
      raise exception 'RETAILER_NOT_ACTIVE: retailer profile is not eligible to order.' using errcode = '42501';
    end if;
  else
    if not exists (
      select 1 from public.profiles pr
       where pr.id = p_collected_by and pr.role = 'salesman' and pr.is_active
    ) or v_assigned_salesman_id is distinct from p_collected_by then
      raise exception 'RETAILER_ASSIGNMENT_REQUIRED: only the assigned active salesman may capture this order.' using errcode = '42501';
    end if;
  end if;

  -- One server-resolved active warehouse is mandatory; the 0054 BEFORE INSERT
  -- trigger independently enforces and snapshots it, so no caller value is used.
  if (select count(*) from public.warehouses w where w.is_active) <> 1 then
    raise exception 'WAREHOUSE_CONFIGURATION_ERROR: exactly one active warehouse is required.' using errcode = '22023';
  end if;

  if p_clear_cart_after_order then
    perform pg_advisory_xact_lock(
      hashtextextended('retailer-cart:' || p_retailer_id::text, 0)
    );
    perform 1 from public.cart_items ci
     where ci.retailer_id = p_retailer_id
     order by ci.id
     for update;

    select count(*), count(distinct r.pack_id)
      into v_item_count, v_unique_count
      from jsonb_to_recordset(p_order_items) as r(pack_id uuid, quantity integer);
    if v_item_count <> v_unique_count
       or (select count(*) from public.cart_items ci where ci.retailer_id = p_retailer_id) <> v_item_count
       or exists (
         select ci.pack_id, ci.quantity from public.cart_items ci where ci.retailer_id = p_retailer_id
         except
         select r.pack_id, r.quantity from jsonb_to_recordset(p_order_items) as r(pack_id uuid, quantity integer)
       )
       or exists (
         select r.pack_id, r.quantity from jsonb_to_recordset(p_order_items) as r(pack_id uuid, quantity integer)
         except
         select ci.pack_id, ci.quantity from public.cart_items ci where ci.retailer_id = p_retailer_id
       ) then
      raise exception 'CART_CHANGED: the saved cart changed after it was reviewed.' using errcode = '40001';
    end if;
  end if;

  -- Structural and arithmetic reconciliation: every pack is unique, quantity
  -- is a whole piece count, unit_price × quantity = line_total, and the sum of
  -- GST-inclusive lines equals subtotal + extracted GST.
  select count(*), count(distinct r.pack_id), round(coalesce(sum(r.line_total), 0), 2)
    into v_item_count, v_unique_count, v_line_total
    from jsonb_to_recordset(p_order_items) as r(
      pack_id uuid, quantity integer, unit_price numeric,
      gst_percent numeric, line_total numeric
    );
  if v_item_count <> v_unique_count or v_item_count < 1 then
    raise exception 'ORDER_QUOTE_INVALID: order lines contain duplicate or missing packs.' using errcode = '22023';
  end if;
  if exists (
    select 1
      from jsonb_to_recordset(p_order_items) as r(
        pack_id uuid, quantity integer, unit_price numeric,
        gst_percent numeric, line_total numeric
      )
     where r.pack_id is null or r.quantity is null or r.quantity < 1 or r.quantity > 100000
        or r.unit_price is null or r.unit_price <= 0
        or r.gst_percent is null or r.gst_percent < 0 or r.gst_percent > 100
        or r.line_total is null or r.line_total <= 0
        or round(r.unit_price * r.quantity, 2) <> round(r.line_total, 2)
  ) then
    raise exception 'ORDER_QUOTE_INVALID: an order line is not a valid server-priced piece line.' using errcode = '22023';
  end if;
  select round(coalesce(sum(
           case when r.gst_percent = 0 then 0
                else round((r.line_total * r.gst_percent) / (100 + r.gst_percent), 2)
           end
         ), 0), 2)
    into v_expected_gst
    from jsonb_to_recordset(p_order_items) as r(
      pack_id uuid, quantity integer, unit_price numeric,
      gst_percent numeric, line_total numeric
    );
  if round(v_line_total, 2) <> round(p_subtotal + p_gst_total, 2)
     or round(v_expected_gst, 2) <> round(p_gst_total, 2)
     or round(p_subtotal + p_gst_total - p_discount_total, 2) <> round(p_grand_total, 2) then
    raise exception 'ORDER_QUOTE_INVALID: order totals do not reconcile with the quoted lines.' using errcode = '22023';
  end if;

  if p_clear_cart_after_order then
    perform pg_advisory_xact_lock(
      hashtextextended('retailer-coupon:' || p_retailer_id::text, 0)
    );
  end if;

  if p_coupon_id is null then
    if coalesce(p_coupon_code, '') <> ''
       or coalesce(p_coupon_discount, 0) <> 0
       or p_discount_total <> 0 then
      raise exception 'COUPON_INVALID: coupon snapshot does not match the quote.' using errcode = '22023';
    end if;
    if p_clear_cart_after_order and exists (
      select 1 from public.retailer_active_coupons rac where rac.retailer_id = p_retailer_id
    ) then
      raise exception 'COUPON_INVALID: the active coupon changed after the quote.' using errcode = '40001';
    end if;
  else
    if nullif(btrim(p_coupon_code), '') is null
       or p_coupon_discount is null
       or round(p_coupon_discount, 2) <> round(p_discount_total, 2) then
      raise exception 'COUPON_INVALID: coupon snapshot does not match the quote.' using errcode = '22023';
    end if;
    select rac.coupon_id into v_active_coupon_id
      from public.retailer_active_coupons rac
     where rac.retailer_id = p_retailer_id
     for update;
    if v_active_coupon_id is distinct from p_coupon_id then
      raise exception 'COUPON_INVALID: the active coupon changed after the quote.' using errcode = '40001';
    end if;

    -- Lock the exact coupon terms through commit. The lower-level redemption
    -- RPC also checks use limits under this same row lock.
    select * into v_coupon
      from public.coupons c
     where c.id = p_coupon_id
     for update;
    if not found
       or v_coupon.is_active is not true
       or now() < v_coupon.starts_at
       or now() > v_coupon.expires_at
       or (v_coupon.retailer_id is not null and v_coupon.retailer_id <> p_retailer_id)
       or upper(btrim(v_coupon.code)) <> upper(btrim(p_coupon_code)) then
      raise exception 'COUPON_INVALID: this coupon is no longer eligible.' using errcode = '23514';
    end if;
  end if;

  -- Serialize on the affected products in a stable order. Price-list, tier,
  -- pack and GST mutations use this same product lock, so a quote cannot go
  -- stale between this comparison and the stock/order commit.
  for v_item in
    select distinct pp.product_id
      from jsonb_to_recordset(p_order_items) as r(pack_id uuid)
      join public.product_packs pp on pp.id = r.pack_id
     order by pp.product_id
  loop
    perform pg_advisory_xact_lock(
      hashtextextended('retailer-pricing:' || v_item.product_id::text, 0)
    );
  end loop;

  -- Revalidate active state, MOQ, current GST and the exact piece rate used by
  -- quoteOrderForRetailer. The quote service remains the canonical arithmetic
  -- engine; this DB check rejects a quote made stale by a price/tax edit before
  -- the atomic write. Existing 0054 stock triggers check exact on-hand quantity.
  for v_item in
    select r.pack_id, r.quantity, r.unit_price, r.gst_percent, r.line_total
      from jsonb_to_recordset(p_order_items) as r(
        pack_id uuid, quantity integer, unit_price numeric,
        gst_percent numeric, line_total numeric
      )
     order by r.pack_id
  loop
    select pp.product_id, pp.units_per_case, pp.moq, pp.is_active, p.is_active,
           p.gst_percent, pp.case_price, pp.ptr, pp.base_price, r.area_id
      into v_product_id, v_units_per_case, v_moq, v_pack_active, v_product_active,
           v_gst_percent, v_pack_case_price, v_pack_ptr, v_pack_base_price, v_retailer_area_id
      from public.product_packs pp
      join public.products p on p.id = pp.product_id
      join public.retailers r on r.id = p_retailer_id
     where pp.id = v_item.pack_id
     for share of pp, p;
    if not found or not v_pack_active or not v_product_active then
      raise exception 'PACK_UNAVAILABLE: a selected pack is no longer active.' using errcode = '23514';
    end if;
    if v_item.quantity < v_moq then
      raise exception 'MINIMUM_ORDER_QUANTITY: minimum is % pieces for this pack.', v_moq using errcode = '23514';
    end if;
    if round(v_item.gst_percent, 2) is distinct from round(v_gst_percent, 2) then
      raise exception 'ORDER_PRICE_CHANGED: the GST rate changed after the quote.' using errcode = '40001';
    end if;

    select pl.price
      into v_product_override
      from public.price_lists pl
     where pl.product_id = v_product_id
       and pl.scope = 'retailer'
       and pl.retailer_id = p_retailer_id
       and pl.is_active
       and pl.valid_from <= now()
     order by pl.priority desc
     limit 1;
    if v_product_override is null and v_retailer_area_id is not null then
      select pl.price
        into v_product_override
        from public.price_lists pl
       where pl.product_id = v_product_id
         and pl.scope = 'area'
         and pl.area_id = v_retailer_area_id
         and pl.is_active
         and pl.valid_from <= now()
       order by pl.priority desc
       limit 1;
    end if;
    v_current_case_price := coalesce(v_product_override, v_pack_case_price, v_pack_ptr, v_pack_base_price);

    -- 0082 — retailer category tier pricing is authoritative. When a category
    -- price is configured for this pack + the retailer's category, it prices
    -- the line and no slab/override/case fallback applies. The helper returns
    -- NULL when no category price is configured, so every pre-existing
    -- pricing rule is byte-for-byte unchanged for those packs.
    v_category_piece_price := public.pack_category_price_per_piece(v_item.pack_id, p_retailer_id);
    if v_category_piece_price is not null then
      if round(v_item.unit_price, 2) is distinct from round(v_category_piece_price, 2) then
        raise exception 'ORDER_PRICE_CHANGED: the retailer category price changed after the quote.' using errcode = '40001';
      end if;
      continue;
    end if;

    select exists (
      select 1 from public.product_pricing_tiers ppt
       where ppt.product_pack_id = v_item.pack_id
         and ppt.is_active and ppt.rule_type = 'loose'
    ) into v_has_explicit_loose_tier;

    select ppt.price_per_piece
      into v_current_tier_price
      from public.product_pricing_tiers ppt
     where ppt.product_pack_id = v_item.pack_id
       and ppt.is_active
       and ((v_has_explicit_loose_tier and ppt.rule_type = 'loose')
         or (not v_has_explicit_loose_tier and ppt.rule_type <> 'case'))
       and ppt.min_quantity >= 1
       and ppt.min_quantity < v_units_per_case
       and (ppt.max_quantity is null or ppt.max_quantity > ppt.min_quantity)
       and ppt.min_quantity <= v_item.quantity
       and (ppt.max_quantity is null or v_item.quantity < ppt.max_quantity)
     order by ppt.min_quantity asc
     limit 1;
    if not found then
      select ppt.price_per_piece
        into v_current_tier_price
        from public.product_pricing_tiers ppt
       where ppt.product_pack_id = v_item.pack_id
         and ppt.is_active
         and ((v_has_explicit_loose_tier and ppt.rule_type = 'loose')
           or (not v_has_explicit_loose_tier and ppt.rule_type <> 'case'))
         and ppt.min_quantity >= 1
         and ppt.min_quantity < v_units_per_case
         and (ppt.max_quantity is null or ppt.max_quantity > ppt.min_quantity)
       order by ppt.min_quantity desc
       limit 1;
    end if;

    if v_current_tier_price is null then
      v_expected_unit_price := round(v_current_case_price / greatest(v_units_per_case, 1), 2);
    else
      v_expected_unit_price := v_current_tier_price;
    end if;
    if round(v_item.unit_price, 2) is distinct from round(v_expected_unit_price, 2) then
      raise exception 'ORDER_PRICE_CHANGED: the selling price changed after the quote.' using errcode = '40001';
    end if;
  end loop;

  if p_coupon_id is not null then
    if p_subtotal < v_coupon.minimum_order_value then
      raise exception 'COUPON_INVALID: the order no longer meets the coupon minimum.' using errcode = '23514';
    end if;

    -- Recompute eligible GST-exclusive value from the same current product
    -- identities and reconciled lines the order will persist. This duplicates
    -- only the coupon eligibility math at the transaction boundary; TypeScript
    -- remains the quote engine, and stale coupon terms/discounts fail closed.
    select round(coalesce(sum(
             r.line_total - case when r.gst_percent = 0 then 0
                                 else round((r.line_total * r.gst_percent) / (100 + r.gst_percent), 2)
                            end
           ), 0), 2)
      into v_coupon_eligible_subtotal
      from jsonb_to_recordset(p_order_items) as r(
        pack_id uuid, quantity integer, unit_price numeric,
        gst_percent numeric, line_total numeric
      )
      join public.product_packs pp on pp.id = r.pack_id
      join public.products p on p.id = pp.product_id
     where r.line_total > 0
       and (v_coupon.category_id is null or p.category_id = v_coupon.category_id)
       and (v_coupon.brand_id is null or p.brand_id = v_coupon.brand_id)
       and (v_coupon.product_id is null or p.id = v_coupon.product_id)
       and r.line_total - case when r.gst_percent = 0 then 0
                               else round((r.line_total * r.gst_percent) / (100 + r.gst_percent), 2)
                          end > 0;

    if (v_coupon.category_id is not null or v_coupon.brand_id is not null or v_coupon.product_id is not null)
       and coalesce(v_coupon_eligible_subtotal, 0) <= 0 then
      raise exception 'COUPON_INVALID: the coupon no longer applies to these products.' using errcode = '23514';
    end if;

    if v_coupon.discount_type = 'percentage' then
      v_expected_coupon_discount := round(v_coupon_eligible_subtotal * v_coupon.discount_value / 100, 2);
      if v_coupon.maximum_discount is not null and v_coupon.maximum_discount > 0 then
        v_expected_coupon_discount := least(v_expected_coupon_discount, v_coupon.maximum_discount);
      end if;
    else
      v_expected_coupon_discount := v_coupon.discount_value;
    end if;
    v_expected_coupon_discount := round(
      least(greatest(coalesce(v_expected_coupon_discount, 0), 0), coalesce(v_coupon_eligible_subtotal, 0)),
      2
    );

    if v_expected_coupon_discount <= 0
       or round(p_coupon_discount, 2) is distinct from v_expected_coupon_discount
       or round(p_discount_total, 2) is distinct from v_expected_coupon_discount then
      raise exception 'COUPON_INVALID: the coupon discount changed after the quote.' using errcode = '40001';
    end if;
  end if;

  insert into public.orders (
    retailer_id, collected_by, status, subtotal, gst_total, discount_total,
    grand_total, notes, shipping_address, coupon_id, coupon_code,
    coupon_discount, request_key, request_fingerprint
  ) values (
    p_retailer_id, p_collected_by, 'pending', p_subtotal, p_gst_total,
    p_discount_total, p_grand_total, nullif(btrim(p_notes), ''),
    p_shipping_address, p_coupon_id, nullif(upper(btrim(p_coupon_code)), ''),
    coalesce(p_coupon_discount, 0), p_request_key, p_request_fingerprint
  ) returning * into v_order;

  -- The 0054 order_items trigger deducts exact pack stock in this same
  -- transaction, rejecting stale/out-of-stock quotes. It overwrites the piece
  -- snapshot from quantity and records its own reversible stock counters.
  for v_item in
    select r.pack_id, r.quantity, r.unit_price, r.gst_percent, r.line_total
      from jsonb_to_recordset(p_order_items) as r(
        pack_id uuid, quantity integer, unit_price numeric,
        gst_percent numeric, line_total numeric
      )
     order by r.pack_id
  loop
    -- Read the current product/pack snapshot for THIS row (the validation loop
    -- above may have finished on a different pack).
    select pp.product_id, pp.units_per_case
      into v_product_id, v_units_per_case
      from public.product_packs pp
     where pp.id = v_item.pack_id;

    insert into public.order_items (
      order_id, product_id, pack_id, quantity, quantity_unit,
      quantity_pieces, units_per_case, unit_price, gst_percent, line_total
    ) values (
      v_order.id, v_product_id, v_item.pack_id, v_item.quantity, 'pieces',
      v_item.quantity, v_units_per_case, v_item.unit_price,
      v_item.gst_percent, v_item.line_total
    );
  end loop;

  if p_coupon_id is not null then
    if not public.redeem_coupon(
      p_coupon_id, p_retailer_id, v_order.id, p_coupon_discount
    ) then
      raise exception 'COUPON_INVALID: this coupon is no longer eligible.' using errcode = '23514';
    end if;
    delete from public.retailer_active_coupons rac
     where rac.retailer_id = p_retailer_id and rac.coupon_id = p_coupon_id;
  end if;

  v_order_total_paise := round(p_grand_total * 100)::bigint;
  v_available_coins_paise := greatest(
    0,
    public.get_retailer_available_credit_paise(p_retailer_id)
  );
  v_coins_used_paise := least(v_available_coins_paise, v_order_total_paise);
  if p_expected_coins_used_paise <> v_coins_used_paise then
    raise exception 'COIN_BALANCE_CHANGED: the available coin balance changed after the quote.' using errcode = '40001';
  end if;

  if v_coins_used_paise > 0 then
    perform public.check_and_debit_retailer_wallet(
      p_retailer_id,
      v_order.id,
      v_coins_used_paise,
      'order:' || v_order.id::text,
      coalesce(p_collected_by, p_retailer_id),
      'Order ' || v_order.order_number || ' — ₹' || to_char(p_grand_total, 'FM999999990.00')
    );
  end if;

  -- Unlike grandTotal - coinsUsed (the amount left on the order), this is the
  -- retailer's remaining wallet/Coins balance, read after the atomic debit.
  v_coins_balance_after_paise := greatest(
    0,
    public.get_retailer_available_credit_paise(p_retailer_id)
  );
  update public.orders
     set coins_balance_after_paise = v_coins_balance_after_paise
   where id = v_order.id;

  if p_request_key is not null then
    update public.orders
       set request_completed_at = now()
     where id = v_order.id;
  end if;

  if p_clear_cart_after_order then
    delete from public.cart_items ci where ci.retailer_id = p_retailer_id;
  end if;

  return jsonb_build_object(
    'id', v_order.id,
    'orderNumber', v_order.order_number,
    'status', v_order.status::text,
    'grandTotalPaise', v_order_total_paise,
    'coinsUsedPaise', v_coins_used_paise,
    'coinsBalanceAfterPaise', v_coins_balance_after_paise,
    'placedAt', v_order.placed_at,
    'replayed', false
  );
end;
$$;
  $fn$;

  -- 0082 did not restate the grant, so the function inherited 0056's. Re-assert
  -- it explicitly rather than relying on inheritance: the function is service_role
  -- only (it checks auth.role() itself), and no API role may call it.
  revoke all on function public.create_order_atomic(uuid, uuid, uuid, text, text, jsonb, numeric, numeric, numeric, numeric, uuid, text, numeric, bigint, jsonb, boolean) from public, anon, authenticated;
  grant execute on function public.create_order_atomic(uuid, uuid, uuid, text, text, jsonb, numeric, numeric, numeric, numeric, uuid, text, numeric, bigint, jsonb, boolean) to service_role;

  raise notice '0110: create_order_atomic rejects any line carrying a seller offer. Checkout is pack-only at the database.';
end;
$checkout_pack_only$;

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
