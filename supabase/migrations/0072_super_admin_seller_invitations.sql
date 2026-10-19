-- 0072: Forward-only seller onboarding hardening after main's
-- 0070_seller_invite_only.sql and 0071_gaya_default_district.sql. NO historical
-- migration is rewritten. No existing auth users, sellers, orders or offers
-- are removed or promoted. Apply only after verifying actual migration history
-- and a recoverable backup. Public account_type=seller AND a legacy 0070
-- staff_account_invites seller row are refused by the Auth trigger; only an
-- unexpired, one-use, nonce-bound invitation reserved by an active Super Admin
-- can assign seller role. Audit any outstanding 0070 invitations before rollout.
-- The trusted server, NOT the browser, calls Auth Admin inviteUserByEmail.

create table if not exists public.seller_account_invites (
  id uuid primary key default uuid_generate_v4(),
  email text not null unique check (email = lower(btrim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  seller_id uuid not null unique references public.sellers(id) on delete restrict,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '1 day'),
  consumed_at timestamptz,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  invitation_sent_at timestamptz,
  last_attempt_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count between 0 and 3),
  invite_nonce_hash text check (invite_nonce_hash ~ '^[0-9a-f]{64}$'),
  constraint seller_invite_consumption_shape check ((consumed_at is null) = (auth_user_id is null))
);
create index if not exists idx_seller_invites_seller on public.seller_account_invites(seller_id);
alter table public.seller_account_invites enable row level security;
revoke all on public.seller_account_invites from anon, authenticated;
grant select, update (invitation_sent_at) on public.seller_account_invites to authenticated;
drop policy if exists "seller_invites_super_admin_read" on public.seller_account_invites;
create policy "seller_invites_super_admin_read" on public.seller_account_invites
  for select to authenticated using (public.current_user_role() = 'super_admin');
drop policy if exists "seller_invites_super_admin_mark_sent" on public.seller_account_invites;
create policy "seller_invites_super_admin_mark_sent" on public.seller_account_invites
  for update to authenticated using (public.current_user_role() = 'super_admin')
  with check (public.current_user_role() = 'super_admin');

drop trigger if exists trg_audit_seller_account_invites on public.seller_account_invites;
create trigger trg_audit_seller_account_invites
  after insert or update or delete on public.seller_account_invites
  for each row execute function public.log_audit();

-- Direct PostgREST insert/update/delete of seller identity or membership is
-- now Super Admin only. Sellers still edit *non-status* fields through the
-- existing tenant-checked SECURITY DEFINER profile RPC, never these policies.
drop policy if exists "sellers_admin_insert" on public.sellers;
create policy "sellers_admin_insert" on public.sellers
  for insert to authenticated with check (public.current_user_role() = 'super_admin');
drop policy if exists "sellers_admin_update" on public.sellers;
create policy "sellers_admin_update" on public.sellers
  for update to authenticated using (public.current_user_role() = 'super_admin')
  with check (public.current_user_role() = 'super_admin');
drop policy if exists "sellers_admin_delete" on public.sellers;
-- Never delete seller identities from the API. Historical offers and order
-- snapshots already reference them; suspension is the reversible control.
drop policy if exists "seller_members_admin_insert" on public.seller_members;
create policy "seller_members_admin_insert" on public.seller_members
  for insert to authenticated with check (public.current_user_role() = 'super_admin');
drop policy if exists "seller_members_admin_delete" on public.seller_members;
create policy "seller_members_admin_delete" on public.seller_members
  for delete to authenticated using (public.current_user_role() = 'super_admin');

-- Reserve both business identity and invitation in ONE database transaction.
-- A failed Auth email request leaves an auditable pending record; it NEVER
-- creates a usable seller session or silently deletes the business record.
create or replace function public.reserve_seller_invite(
  p_email text, p_business_name text, p_contact_name text,
  p_phone text, p_gstin text default null, p_pan text default null,
  p_address_line text default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_business text := btrim(coalesce(p_business_name, ''));
  v_contact text := btrim(coalesce(p_contact_name, ''));
  v_phone text := btrim(coalesce(p_phone, ''));
  v_gstin text := nullif(upper(btrim(coalesce(p_gstin, ''))), '');
  v_pan text := nullif(upper(btrim(coalesce(p_pan, ''))), '');
  v_address text := nullif(btrim(coalesce(p_address_line, '')), '');
  v_seller_id uuid;
begin
  if auth.role() is distinct from 'authenticated'
     or public.current_user_role() is distinct from 'super_admin' then
    raise exception 'Super Admin authorization required.' using errcode = '42501';
  end if;
  if char_length(v_email) > 160 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
     or char_length(v_business) not between 2 and 160
     or char_length(v_contact) not between 2 and 120
     or v_phone !~ '^[6-9][0-9]{9}$'
     or (v_gstin is not null and v_gstin !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$')
     or (v_pan is not null and v_pan !~ '^[A-Z]{5}[0-9]{4}[A-Z]$')
     or (v_address is not null and char_length(v_address) > 300) then
    raise exception 'Invalid seller invitation details.' using errcode = '22023';
  end if;
  if exists (select 1 from public.sellers where lower(btrim(email)) = v_email)
     or exists (select 1 from public.staff_account_invites where email = v_email and expires_at > now()) then
    raise exception 'SELLER_EMAIL_ALREADY_RESERVED' using errcode = '23505';
  end if;
  insert into public.sellers
    (business_name, contact_name, phone, email, gstin, pan, address_line, status, created_by)
  values
    (v_business, v_contact, v_phone, v_email, v_gstin, v_pan, v_address, 'pending', auth.uid())
  returning id into v_seller_id;
  insert into public.seller_account_invites (email, seller_id, created_by)
  values (v_email, v_seller_id, auth.uid());
  return v_seller_id;
end;
$$;
revoke all on function public.reserve_seller_invite(text, text, text, text, text, text, text) from public, anon;
grant execute on function public.reserve_seller_invite(text, text, text, text, text, text, text) to authenticated;

-- Existing pre-0070 admin-created PENDING businesses can be invited without
-- duplicating/deleting them. This is an explicit Super Admin action only.
create or replace function public.attach_existing_seller_invite(p_seller_id uuid)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_seller public.sellers%rowtype;
begin
  if auth.role() is distinct from 'authenticated'
     or public.current_user_role() is distinct from 'super_admin' then
    raise exception 'Super Admin authorization required.' using errcode = '42501';
  end if;
  select * into v_seller from public.sellers
   where id = p_seller_id and status = 'pending' for update;
  if not found or v_seller.email is null
     or lower(btrim(v_seller.email)) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
     or exists (select 1 from public.seller_members where seller_id = p_seller_id)
     or exists (select 1 from public.staff_account_invites
                 where email = lower(btrim(v_seller.email)) and expires_at > now()) then
    raise exception 'Seller is not eligible for an email invitation.' using errcode = '23514';
  end if;
  insert into public.seller_account_invites (email, seller_id, created_by)
  values (lower(btrim(v_seller.email)), p_seller_id, auth.uid());
  return p_seller_id;
end;
$$;
revoke all on function public.attach_existing_seller_invite(uuid) from public, anon;
grant execute on function public.attach_existing_seller_invite(uuid) to authenticated;

-- Bounded retry: only the reserved address can be invited; no public caller
-- can use this RPC. The row lock and cooldown prevent concurrent spamming.
-- Return a fresh 244+-bit nonce to trusted server code ONLY. A public signup
-- with the reserved email cannot impersonate the Auth Admin invite, even if
-- they know the email: the trigger verifies a one-use SHA-256 hash of the nonce.
create or replace function public.claim_seller_invite_attempt(p_seller_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_invite public.seller_account_invites%rowtype;
  v_nonce text;
begin
  if auth.role() is distinct from 'authenticated'
     or public.current_user_role() is distinct from 'super_admin' then
    raise exception 'Super Admin authorization required.' using errcode = '42501';
  end if;
  select i.* into v_invite
    from public.seller_account_invites i
    join public.sellers s on s.id = i.seller_id
   where i.seller_id = p_seller_id and s.status = 'pending'
   for update of i;
  if not found or v_invite.consumed_at is not null then
    raise exception 'This seller has an Auth account or has no pending invitation.' using errcode = '23514';
  end if;
  if v_invite.last_attempt_at is not null
     and v_invite.last_attempt_at > now() - interval '2 minutes' then
    raise exception 'Wait before retrying this invitation.' using errcode = '23514';
  end if;
  if v_invite.attempt_count >= 3
     and v_invite.last_attempt_at > now() - interval '1 day' then
    raise exception 'Invitation attempt limit reached. Try again tomorrow.' using errcode = '23514';
  end if;
  v_nonce := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  update public.seller_account_invites
     set invite_nonce_hash = encode(sha256(convert_to(v_nonce, 'UTF8')), 'hex'),
         last_attempt_at = now(),
         attempt_count = case when v_invite.last_attempt_at < now() - interval '1 day'
                              then 1 else v_invite.attempt_count + 1 end,
         expires_at = greatest(v_invite.expires_at, now() + interval '1 day')
   where seller_id = p_seller_id;
  return jsonb_build_object('email', v_invite.email, 'nonce', v_nonce);
end;
$$;
revoke all on function public.claim_seller_invite_attempt(uuid) from public, anon;
grant execute on function public.claim_seller_invite_attempt(uuid) to authenticated;

-- auth.users trigger: staff invite behaviour and retailer registration survive;
-- public seller signup does NOT. Client metadata cannot claim the role, link
-- to another seller or create a seller. No password or invite token is stored.
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
      -- An email reservation alone is NOT an invitation: a public signup can
      -- submit someone else's address and arbitrary user_metadata. Only the
      -- high-entropy nonce returned to the trusted Auth Admin caller works.
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

  -- Main's 0070 permitted seller rows in the general staff-invites table.
  -- That legacy path is not nonce-bound: never accept it as a seller login.
  -- Raising rolls back the DELETE above, preserving the record for operator
  -- review instead of consuming or silently converting an old invitation.
  if v_staff_role = 'seller' then
    raise exception 'seller_invite_required' using errcode = '42501';
  end if;

  if v_staff_role is not null then
    v_role := v_staff_role;
  elsif v_invited_seller_id is not null then
    v_role := 'seller';
    select * into strict v_seller from public.sellers where id = v_invited_seller_id and status = 'pending';
  elsif v_signup_kind <> 'retailer' then
    -- Explicitly reject, rather than silently opening a retailer account.
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

-- The membership helper still allows a pending seller to read their own
-- business STATUS. Trading data is separately restricted to active sellers.
create or replace function public.is_active_seller_member(p_seller_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(public.current_user_role() = 'seller', false)
    and exists (
      select 1 from public.seller_members sm
      join public.sellers s on s.id = sm.seller_id
      where sm.seller_id = p_seller_id and sm.profile_id = auth.uid()
        and s.status = 'active'
    );
$$;
revoke all on function public.is_active_seller_member(uuid) from public, anon;
grant execute on function public.is_active_seller_member(uuid) to authenticated;

-- Sellers cannot inspect other sellers' approved offer rows through the
-- general marketplace branch. Retailers see approved, active trade terms;
-- pending/suspended sellers see no offer inventory through PostgREST.
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
drop policy if exists "seller_offer_price_history_read" on public.seller_offer_price_history;
create policy "seller_offer_price_history_read" on public.seller_offer_price_history
  for select to authenticated using (
    public.is_admin_or_above()
    or exists (select 1 from public.seller_offers so where so.id = seller_offer_id
               and public.is_active_seller_member(so.seller_id))
  );
-- Suspension also hides operational shipment and financial rows from the
-- portal. Records remain intact for Super Admin reconciliation and recovery.
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
drop policy if exists "sub_orders_select" on public.sub_orders;
create policy "sub_orders_select" on public.sub_orders
  for select to authenticated using (
    public.is_admin_or_above()
    or public.is_active_seller_member(seller_id)
    or exists (select 1 from public.orders o where o.id = parent_order_id
               and (o.retailer_id = auth.uid() or o.collected_by = auth.uid()
                    or public.is_retailer_assigned_to_current_salesman(o.retailer_id)))
  );
drop policy if exists "order_items_seller_select" on public.order_items;
create policy "order_items_seller_select" on public.order_items
  for select to authenticated using (
    exists (select 1 from public.sub_orders so where so.id = order_items.sub_order_id
              and public.is_active_seller_member(so.seller_id))
  );
drop policy if exists "seller_offer_tiers_select" on public.seller_offer_tiers;
create policy "seller_offer_tiers_select" on public.seller_offer_tiers
  for select to authenticated using (
    exists (select 1 from public.seller_offers so where so.id = seller_offer_tiers.seller_offer_id
      and (public.is_admin_or_above()
        or public.is_active_seller_member(so.seller_id)
        or (public.current_user_role() = 'retailer' and public.is_active_account()
            and so.is_active and so.moderation_status = 'approved'
            and exists (select 1 from public.sellers s where s.id = so.seller_id and s.status = 'active'))))
  );

-- The 0069 definer projection would otherwise let a seller read approved tiers
-- belonging to ANOTHER tenant. Keep the same result shape / grants, tighten
-- its role-aware predicate. Also fix the duplicate STABLE keyword in 0069.
create or replace function public.marketplace_offer_tiers(p_offer_ids uuid[])
returns table (offer_id uuid, min_quantity integer, max_quantity integer, unit_price_paise bigint)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_offer_ids), 0) < 1 or cardinality(p_offer_ids) > 200
     or array_position(p_offer_ids, null) is not null then
    raise exception 'Request between 1 and 200 offer ids.' using errcode = '22023';
  end if;
  return query
  select sot.seller_offer_id, sot.min_quantity, sot.max_quantity, sot.unit_price_paise
    from public.seller_offer_tiers sot
    join public.seller_offers so on so.id = sot.seller_offer_id
    join public.sellers s on s.id = so.seller_id
   where sot.seller_offer_id = any(p_offer_ids) and sot.is_active
     and (public.is_admin_or_above()
          or public.is_active_seller_member(so.seller_id)
          or (public.current_user_role() = 'retailer' and public.is_active_account()
              and so.is_active and so.moderation_status = 'approved' and s.status = 'active'))
   order by sot.seller_offer_id, sot.min_quantity;
end;
$$;
revoke all on function public.marketplace_offer_tiers(uuid[]) from public, anon;
grant execute on function public.marketplace_offer_tiers(uuid[]) to authenticated;

-- 0069 allowed a seller to change the displayed email, GSTIN and registered
-- business identity while Auth still owned the *old* login email. Those fields
-- now need a separately verified Super Admin change; seller self-service is
-- restricted to contact name, phone and dispatch address while ACTIVE.
create or replace function public.seller_update_own_profile(
  p_business_name text,
  p_contact_name text default null,
  p_phone text default null,
  p_email text default null,
  p_gstin text default null,
  p_pan text default null,
  p_address_line text default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_seller public.sellers%rowtype;
  v_contact text := nullif(btrim(coalesce(p_contact_name, '')), '');
  v_phone text := nullif(regexp_replace(btrim(coalesce(p_phone, '')), '^\+?91[\s-]*|^0', ''), '');
  v_address text := nullif(btrim(coalesce(p_address_line, '')), '');
begin
  if v_uid is null or public.current_user_role() is distinct from 'seller' then
    raise exception 'An active seller session is required.' using errcode = '42501';
  end if;
  select s.* into v_seller
    from public.seller_members sm
    join public.sellers s on s.id = sm.seller_id
   where sm.profile_id = v_uid and s.status = 'active'
   for update of s;
  if not found then
    raise exception 'An active seller membership is required.' using errcode = '42501';
  end if;
  if btrim(coalesce(p_business_name, '')) is distinct from v_seller.business_name
     or nullif(lower(btrim(coalesce(p_email, ''))), '') is distinct from v_seller.email
     or nullif(upper(regexp_replace(coalesce(p_gstin, ''), '\s+', '', 'g')), '') is distinct from v_seller.gstin
     or nullif(upper(regexp_replace(coalesce(p_pan, ''), '\s+', '', 'g')), '') is distinct from v_seller.pan then
    raise exception 'Business identity changes require Super Admin verification.' using errcode = '42501';
  end if;
  if v_contact is not null and char_length(v_contact) not between 2 and 120
     or v_phone is not null and v_phone !~ '^[6-9][0-9]{9}$'
     or v_address is not null and char_length(v_address) > 300 then
    raise exception 'Invalid seller contact details.' using errcode = '22023';
  end if;
  update public.sellers
     set contact_name = coalesce(v_contact, contact_name),
         phone = coalesce(v_phone, phone),
         address_line = coalesce(v_address, address_line),
         updated_at = now()
   where id = v_seller.id;
  update public.profiles
     set full_name = coalesce(v_contact, full_name),
         phone = coalesce(v_phone, phone)
   where id = v_uid;
  return v_seller.id;
end;
$$;
revoke all on function public.seller_update_own_profile(text, text, text, text, text, text, text) from public, anon;
grant execute on function public.seller_update_own_profile(text, text, text, text, text, text, text) to authenticated;

-- This helper was executable by every authenticated profile and could reveal
-- a private/unapproved offer's rate without checking ownership. v2 checkout
-- calls it with service_role; only active sellers, authorized retailers and
-- admins may get a rate through direct authenticated RPC calls.
create or replace function public.effective_seller_offer_unit_price_paise(
  p_offer_id uuid, p_quantity integer
) returns bigint
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_base_paise bigint;
  v_tier_paise bigint;
begin
  select so.unit_price_paise into v_base_paise
    from public.seller_offers so
    join public.sellers s on s.id = so.seller_id
   where so.id = p_offer_id
     and (auth.role() = 'service_role'
       or public.is_admin_or_above()
       or public.is_active_seller_member(so.seller_id)
       or (public.current_user_role() = 'retailer'
           and public.is_active_account() and so.is_active
           and so.moderation_status = 'approved' and s.status = 'active'));
  if not found then return null; end if;
  select sot.unit_price_paise into v_tier_paise
    from public.seller_offer_tiers sot
   where sot.seller_offer_id = p_offer_id and sot.is_active
     and sot.min_quantity <= coalesce(p_quantity, 1)
     and (sot.max_quantity is null or coalesce(p_quantity, 1) <= sot.max_quantity)
   order by sot.min_quantity desc limit 1;
  return coalesce(v_tier_paise, v_base_paise);
end;
$$;
revoke all on function public.effective_seller_offer_unit_price_paise(uuid, integer) from public, anon;
grant execute on function public.effective_seller_offer_unit_price_paise(uuid, integer) to authenticated, service_role;

comment on table public.seller_account_invites is
  'Super-Admin-reserved, one-use Auth invitations; only a hashed ephemeral nonce is stored and cleared on consumption. Seller remains pending until verified Super Admin review; no passwords are stored.';
