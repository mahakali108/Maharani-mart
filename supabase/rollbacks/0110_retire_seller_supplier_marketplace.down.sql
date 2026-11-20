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
-- 7. Restore EXACTLY the profiles 0110 changed — EXPLICIT OPT-IN ONLY
-- ---------------------------------------------------------------------------
-- 0110 changed two things, and never anything else:
--
--   (a) it DEACTIVATED seller-only and dual-role-unapproved accounts that were
--       ACTIVE, and
--   (b) it RE-ROLED dual-role accounts that already had an approved retailer row
--       from 'seller' to 'retailer', WITHOUT touching their is_active.
--
-- Every one of those changes wrote an audit_logs row carrying `source =
-- 'migration 0110'` and the EXACT before-state (`old_data.role`,
-- `old_data.is_active`). This block replays that before-state instead of guessing
-- from a role predicate, which is what makes the reversal exact:
--
--   * only profiles that 0110 itself marked are touched;
--   * `role` is restored to old_data.role (never blanket-demoted);
--   * `is_active` is restored to old_data.is_active (so an account that was
--     already suspended before the migration goes back to suspended, and an
--     account that was active goes back to active);
--   * a profile whose current state no longer matches what 0110 wrote is SKIPPED
--     and reported, so a change the owner made afterwards is never overwritten;
--   * a genuine retailer that 0110 never touched has no such audit row and is
--     therefore never demoted.
--
-- Set `set local maharani.reactivate_seller_profiles = 'true'` in the SAME
-- transaction to approve. Without it the block does nothing and says so.
do $restore_profiles$
declare
  v_restored integer := 0;
  v_skipped integer := 0;
  v_row record;
begin
  if coalesce(current_setting('maharani.reactivate_seller_profiles', true), '') <> 'true' then
    raise notice '0110 rollback: profile role/active changes left in place. To restore the exact before-state, set maharani.reactivate_seller_profiles = ''true'' and re-run that block.';
    return;
  end if;

  for v_row in
    select distinct on (a.record_id)
           a.record_id,
           a.old_data ->> 'role' as old_role,
           a.old_data ->> 'is_active' as old_active,
           a.new_data ->> 'role' as new_role,
           a.new_data ->> 'is_active' as new_active
      from public.audit_logs a
     where a.table_name = 'profiles'
       and a.new_data ->> 'source' in ('migration 0110', 'retire_promote_dual_role_seller', 'admin_review_retailer_application')
       and a.old_data ->> 'role' is not null
       and a.old_data ->> 'is_active' is not null
     order by a.record_id, a.created_at desc
  loop
    -- Never overwrite a state the owner changed after the migration. If the
    -- profile no longer looks like 0110 left it, leave it alone and say so.
    if not exists (
      select 1 from public.profiles p
       where p.id = v_row.record_id
         and p.role::text = coalesce(v_row.new_role, p.role::text)
         and p.is_active = coalesce(v_row.new_active::boolean, p.is_active)
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    update public.profiles
       set role = v_row.old_role::public.user_role,
           is_active = v_row.old_active::boolean
     where id = v_row.record_id;

    v_restored := v_restored + 1;
  end loop;

  raise notice '0110 rollback: restored exact before-state for % profile(s); skipped % whose state had changed since the migration.',
    v_restored, v_skipped;

  if v_skipped > 0 then
    raise notice '0110 rollback: skipped profiles were NOT reverted because they no longer matched the state 0110 wrote. Review audit_logs (source in ''migration 0110'', ''retire_promote_dual_role_seller'', ''admin_review_retailer_application'') before closing this out.';
  end if;
end;
$restore_profiles$;

-- Block 9's helper and block 10's rewiring only exist while 0110 is applied.
drop function if exists public.retire_promote_dual_role_seller(uuid);

-- Restore 0081's ORIGINAL admin_review_retailer_application, without the
-- dual-role promotion step 0110 added. Leaving 0110's version in place would
-- keep re-roling profiles to 'retailer' after the retirement was rolled back.
do $restore_approval$
begin
  if to_regclass('public.retailer_applications') is null
     or to_regclass('public.retailer_approval_events') is null then
    raise notice '0110 rollback: 0081 approval tables absent - nothing to restore.';
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
      if p_category is null then
        raise exception 'Gold must be assigned explicitly, not as a side effect of approval.' using errcode = '22023';
      end if;
    end if;
  else
    v_new_app_status := 'rejected';
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

  return jsonb_build_object(
    'retailer_id', p_retailer_id,
    'application_status', v_new_app_status,
    'access_status', v_new_access,
    'retailer_category', coalesce(v_category, v_retailer.retailer_category)
  );
end;
$body$;
  $fn$;

  revoke all on function public.admin_review_retailer_application(uuid, text, text, text) from public, anon;
  grant execute on function public.admin_review_retailer_application(uuid, text, text, text) to authenticated;

  raise notice '0110 rollback: admin_review_retailer_application restored to its 0081 body.';
end;
$restore_approval$;

commit;
