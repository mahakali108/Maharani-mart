-- ============================================================================
-- ROLLBACK for 0110_retire_seller_supplier_marketplace.sql
-- REVIEW ONLY — this file is NOT applied anywhere by the migration author.
-- ============================================================================
--
-- WHAT THIS DOES
--   Restores the exact grant/policy surface that existed immediately before
--   0110, so the seller portal and supplier-application RPCs become callable
--   again. It also re-instates the 0072 handle_new_user(), which can consume a
--   seller invitation into a new seller account, and re-activates seller-role
--   profiles that 0110 deactivated.
--
-- WHAT IT DOES NOT DO
--   0110 deleted NO data, so there is nothing to restore:
--     * no table was dropped
--     * no row was deleted
--     * no column or foreign key was removed
--   The only row-level write in 0110 was `profiles.is_active = false` for
--   seller-role profiles. Re-activating them is destructive in its own way —
--   it re-opens access to a retired role — so it requires an explicit opt-in
--   flag (see the guard at the end).
--
-- WHY THIS IS DANGEROUS IN PRODUCTION
--   Rolling back 0110 without also rolling back the APPLICATION re-creates a
--   capability the code no longer restricts: working RPCs with no UI. Do not
--   roll this back on its own. The application commit that deleted the seller
--   portal is the other half of this change.
--
-- ORDER
--   1. roll back the application (git revert of the removal commit)
--   2. run this script
--   Never the other way round.
-- ============================================================================
begin;

-- ---------------------------------------------------------------------------
-- 1. Signup path — back to the 0072 invitation-consuming version
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_role public.user_role := 'retailer';
  v_staff_role public.user_role;
  v_invited_seller_id uuid;
  v_seller public.sellers%rowtype;
  v_signup_kind text := lower(btrim(coalesce(new.raw_user_meta_data->>'account_type', 'retailer')));
  v_area_text text := nullif(btrim(coalesce(new.raw_user_meta_data->>'area_id', '')), '');
  v_area_id uuid;
begin
  if new.email is not null then
    delete from public.staff_account_invites
     where email = lower(btrim(new.email)) and expires_at > now()
    returning role into v_staff_role;
    if v_staff_role is null then
      update public.seller_account_invites
         set consumed_at = now(), auth_user_id = new.id, invite_nonce_hash = null
       where email = lower(btrim(new.email))
         and consumed_at is null and expires_at > now()
         and invite_nonce_hash is not null
         and invite_nonce_hash = encode(sha256(convert_to(
               coalesce(new.raw_user_meta_data->>'seller_invite_nonce', ''), 'UTF8')), 'hex')
       returning seller_id into v_invited_seller_id;
      if v_invited_seller_id is null and exists (
        select 1 from public.seller_account_invites i
         where i.email = lower(btrim(new.email)) and i.consumed_at is null
      ) then
        raise exception 'seller_invite_required' using errcode = '42501';
      end if;
    end if;
  end if;

  if v_staff_role = 'seller' then
    raise exception 'seller_invite_required' using errcode = '42501';
  end if;

  if v_staff_role is not null then
    v_role := v_staff_role;
  elsif v_invited_seller_id is not null then
    v_role := 'seller';
    select * into strict v_seller from public.sellers where id = v_invited_seller_id and status = 'pending';
  elsif v_signup_kind <> 'retailer' then
    raise exception 'seller_invite_required' using errcode = '42501';
  end if;

  begin
    insert into public.profiles (id, role, full_name, phone)
    values (
      new.id, v_role,
      case when v_role = 'seller' then coalesce(v_seller.contact_name, '')
           else btrim(coalesce(new.raw_user_meta_data->>'full_name', '')) end,
      case when v_role = 'seller' then coalesce(v_seller.phone, '')
           else btrim(coalesce(new.raw_user_meta_data->>'phone', '')) end
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
  elsif v_role = 'seller' then
    insert into public.seller_members (seller_id, profile_id, member_role, created_by)
    values (v_invited_seller_id, new.id, 'owner', v_seller.created_by);
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. staff_account_invites role check — back to 0070's wider set
-- ---------------------------------------------------------------------------
alter table public.staff_account_invites drop constraint if exists staff_account_invites_role_check;
alter table public.staff_account_invites
  add constraint staff_account_invites_role_check check (role in ('staff', 'salesman', 'seller'));

-- ---------------------------------------------------------------------------
-- 3. Seller portal RPCs — restore the 0069/0072 grants
-- ---------------------------------------------------------------------------
do $restore_portal$
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
    'public.reserve_seller_invite(text, text, text, text, text, text, text)',
    'public.attach_existing_seller_invite(uuid)',
    'public.claim_seller_invite_attempt(uuid)'
  ]
  loop
    begin
      execute format('revoke all on function %s from public', v_sig);
      execute format('grant execute on function %s to authenticated', v_sig);
    exception when undefined_function then
      raise notice '0110 rollback: % not present — skipped.', v_sig;
    end;
  end loop;

  -- 0098 kept this one service_role-only; preserve that.
  begin
    execute 'revoke all on function public.seller_agreement_is_current(uuid) from public, anon, authenticated';
    execute 'grant execute on function public.seller_agreement_is_current(uuid) to service_role';
  exception when undefined_function then
    null;
  end;
end;
$restore_portal$;

-- ---------------------------------------------------------------------------
-- 4. Marketplace projection RPCs — restore the 0069/0072/0098 grants
-- ---------------------------------------------------------------------------
do $restore_marketplace$
declare
  v_sig text;
begin
  foreach v_sig in array array[
    'public.marketplace_offer_quotes(uuid[])',
    'public.marketplace_offers_for_product(uuid)',
    'public.marketplace_offer_tiers(uuid[])',
    'public.effective_seller_offer_unit_price_paise(uuid, integer)',
    'public.third_party_offers_enabled()',
    'public.is_member_of_seller(uuid)',
    'public.is_active_seller_member(uuid)'
  ]
  loop
    begin
      execute format('revoke all on function %s from public, anon', v_sig);
      execute format('grant execute on function %s to authenticated', v_sig);
    exception when undefined_function then
      raise notice '0110 rollback: % not present — skipped.', v_sig;
    end;
  end loop;

  -- 0098: the launch-approval writer was authenticated-granted.
  begin
    execute 'revoke all on function public.record_marketplace_launch_approval(boolean, text, text, text) from public, anon, service_role';
    execute 'grant execute on function public.record_marketplace_launch_approval(boolean, text, text, text) to authenticated';
  exception when undefined_function then
    null;
  end;

  -- 0078 H2 kept this owner/service_role only.
  begin
    execute 'revoke all on function public.current_offer_floor_paise(uuid) from public, anon, authenticated';
  exception when undefined_function then
    null;
  end;
end;
$restore_marketplace$;

-- ---------------------------------------------------------------------------
-- 5. Supplier application funnel — restore the 0059 public grant
-- ---------------------------------------------------------------------------
do $restore_supplier$
begin
  if to_regprocedure('public.submit_supplier_application(text, text, text, text, text, text, text, text, text, text, text)') is not null then
    grant execute on function public.submit_supplier_application(text, text, text, text, text, text, text, text, text, text, text)
      to anon, authenticated;
  end if;
  if to_regprocedure('public.consume_supplier_application_rate_limit(text, integer, integer)') is not null then
    grant execute on function public.consume_supplier_application_rate_limit(text, integer, integer)
      to anon, authenticated;
  end if;

  grant select, insert, update, delete on table public.supplier_application_rate_limits to anon, authenticated;

  if to_regclass('storage.objects') is not null then
    drop policy if exists "supplier_documents_bucket_read" on storage.objects;
    drop policy if exists "supplier_documents_bucket_write" on storage.objects;
    -- 0059 bodies, verbatim.
    execute $pol$
      create policy "supplier_documents_bucket_read" on storage.objects
        for select using (bucket_id = 'supplier-documents' and is_admin_or_above())
    $pol$;
    execute $pol$
      create policy "supplier_documents_bucket_write" on storage.objects
        for insert with check (bucket_id = 'supplier-documents' and is_admin_or_above())
    $pol$;
  end if;
end;
$restore_supplier$;

-- ---------------------------------------------------------------------------
-- 6. RLS policies — restore the pre-0110 bodies
-- ---------------------------------------------------------------------------
-- seller_offers (0072)
drop policy if exists "seller_offers_seller_insert" on public.seller_offers;
create policy "seller_offers_seller_insert" on public.seller_offers
  for insert to authenticated with check (
    public.is_admin_or_above()
    or (public.is_active_seller_member(seller_id) and moderation_status = 'pending')
  );
drop policy if exists "seller_offers_seller_update" on public.seller_offers;
create policy "seller_offers_seller_update" on public.seller_offers
  for update to authenticated
  using (public.is_admin_or_above() or public.is_active_seller_member(seller_id))
  with check (public.is_admin_or_above() or public.is_active_seller_member(seller_id));
drop policy if exists "seller_offers_trading_select" on public.seller_offers;
create policy "seller_offers_trading_select" on public.seller_offers
  for select to authenticated using (
    public.is_admin_or_above()
    or public.is_active_seller_member(seller_id)
    or (public.current_user_role() = 'retailer'
        and public.is_active_account()
        and is_active and moderation_status = 'approved'
        and exists (select 1 from public.sellers s where s.id = seller_id and s.status = 'active'))
  );

-- seller_offer_tiers (0072)
drop policy if exists "seller_offer_tiers_select" on public.seller_offer_tiers;
create policy "seller_offer_tiers_select" on public.seller_offer_tiers
  for select to authenticated using (
    public.is_admin_or_above()
    or exists (select 1 from public.seller_offers so
               where so.id = seller_offer_id and public.is_active_seller_member(so.seller_id))
  );

-- seller_offer_price_history (0072)
drop policy if exists "seller_offer_price_history_read" on public.seller_offer_price_history;
create policy "seller_offer_price_history_read" on public.seller_offer_price_history
  for select to authenticated using (
    public.is_admin_or_above()
    or exists (select 1 from public.seller_offers so where so.id = seller_offer_id
               and public.is_active_seller_member(so.seller_id))
  );

-- sellers (0062/0072)
drop policy if exists "sellers_select" on public.sellers;
create policy "sellers_select" on public.sellers
  for select to authenticated using (
    public.is_admin_or_above() or public.is_active_seller_member(id)
  );
drop policy if exists "sellers_admin_insert" on public.sellers;
create policy "sellers_admin_insert" on public.sellers
  for insert to authenticated with check (public.is_admin_or_above());
drop policy if exists "sellers_admin_delete" on public.sellers;
create policy "sellers_admin_delete" on public.sellers
  for delete to authenticated using (public.is_admin_or_above());

-- seller_members (0062/0072)
drop policy if exists "seller_members_select" on public.seller_members;
create policy "seller_members_select" on public.seller_members
  for select to authenticated using (
    public.is_admin_or_above() or profile_id = auth.uid()
  );
drop policy if exists "seller_members_admin_insert" on public.seller_members;
create policy "seller_members_admin_insert" on public.seller_members
  for insert to authenticated with check (public.is_admin_or_above());
drop policy if exists "seller_members_admin_delete" on public.seller_members;
create policy "seller_members_admin_delete" on public.seller_members
  for delete to authenticated using (public.is_admin_or_above());

-- seller_shipments / seller_ledger (0067/0072)
drop policy if exists "seller_shipments_select" on public.seller_shipments;
create policy "seller_shipments_select" on public.seller_shipments
  for select to authenticated using (
    public.is_admin_or_above() or public.is_active_seller_member(seller_id)
  );
drop policy if exists "seller_ledger_read" on public.seller_ledger;
create policy "seller_ledger_read" on public.seller_ledger
  for select to authenticated using (
    public.is_admin_or_above() or public.is_active_seller_member(seller_id)
  );

-- offer_price_floors (0063)
drop policy if exists "offer_price_floors_admin_select" on public.offer_price_floors;
create policy "offer_price_floors_admin_select" on public.offer_price_floors
  for select to authenticated using (public.is_admin_or_above());

-- suppliers / supplier_documents (0059)
drop policy if exists "suppliers_admin_read" on public.suppliers;
create policy "suppliers_admin_read" on public.suppliers
  for select to authenticated using (public.is_admin_or_above());
drop policy if exists "suppliers_admin_update" on public.suppliers;
create policy "suppliers_admin_update" on public.suppliers
  for update to authenticated using (public.is_admin_or_above()) with check (public.is_admin_or_above());
drop policy if exists "supplier_documents_admin_read" on public.supplier_documents;
create policy "supplier_documents_admin_read" on public.supplier_documents
  for select to authenticated using (public.is_admin_or_above());
drop policy if exists "supplier_documents_admin_insert" on public.supplier_documents;
create policy "supplier_documents_admin_insert" on public.supplier_documents
  for insert to authenticated with check (public.is_admin_or_above());

-- seller_account_invites (0072)
drop policy if exists "seller_invites_super_admin_read" on public.seller_account_invites;
create policy "seller_invites_super_admin_read" on public.seller_account_invites
  for select to authenticated using (public.current_user_role() = 'super_admin');
drop policy if exists "seller_invites_super_admin_insert" on public.seller_account_invites;
create policy "seller_invites_super_admin_insert" on public.seller_account_invites
  for insert to authenticated with check (public.current_user_role() = 'super_admin');
drop policy if exists "seller_invites_super_admin_update" on public.seller_account_invites;
create policy "seller_invites_super_admin_update" on public.seller_account_invites
  for update to authenticated
  using (public.current_user_role() = 'super_admin')
  with check (public.current_user_role() = 'super_admin');
grant select, update (invitation_sent_at) on public.seller_account_invites to authenticated;

-- order_items seller branch (0069)
drop policy if exists "order_items_seller_select" on public.order_items;
create policy "order_items_seller_select" on public.order_items
  for select to authenticated using (
    seller_offer_id is not null
    and exists (
      select 1 from public.sub_orders so
       where so.id = order_items.sub_order_id
         and public.is_active_seller_member(so.seller_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 7. Undo the role changes 0110 made to profiles — EXPLICIT OPT-IN ONLY
-- ---------------------------------------------------------------------------
-- 0110 did two different things to `profiles`, and the rollback must not confuse
-- them:
--
--   (a) it DEACTIVATED seller-only and dual-role-unapproved accounts, and
--   (b) it RE-ROLED dual-role accounts that already had an approved retailer row
--       from 'seller' to 'retailer', keeping them active.
--
-- Undoing (b) unconditionally would hand back the seller capability that the
-- application no longer exposes, so both are gated behind the same opt-in.
--
-- Set `set local maharani.reactivate_seller_profiles = 'true'` in the SAME
-- transaction to approve. The reverse-re-role is additionally restricted to
-- profiles that this migration marked in audit_logs, so a genuine retailer is
-- never demoted to 'seller' by a rollback.
do $reactivate$
declare
  v_reactivated integer := 0;
  v_unpromoted integer := 0;
  r record;
begin
  if coalesce(current_setting('maharani.reactivate_seller_profiles', true), '') <> 'true' then
    raise notice '0110 rollback: profile role changes left in place. To reverse them, set maharani.reactivate_seller_profiles = ''true'' and re-run that block.';
    return;
  end if;

  -- (b) first: put the promoted dual-role accounts back to 'seller', but only the
  -- ones 0110 itself promoted (identified by its own audit marker).
  for r in
    select distinct a.record_id
      from public.audit_logs a
     where a.table_name = 'profiles'
       and a.new_data ->> 'source' = 'migration 0110'
       and a.new_data ->> 'role' = 'retailer'
       and a.old_data ->> 'role' = 'seller'
  loop
    update public.profiles set role = 'seller' where id = r.record_id and role = 'retailer';
    v_unpromoted := v_unpromoted + 1;
  end loop;

  -- (a) then: reactivate the seller-role accounts.
  update public.profiles set is_active = true
   where role::text = 'seller' and is_active = false;
  get diagnostics v_reactivated = row_count;

  raise notice '0110 rollback: re-roled back to seller=%, re-activated seller-role profile(s)=%.',
    v_unpromoted, v_reactivated;
end;
$reactivate$;

-- The re-role helper added by 0110 only exists while 0110 is applied.
drop function if exists public.retire_promote_dual_role_seller(uuid);

commit;
