-- ============================================================================
-- 0070: Super Admin-only seller account invitations.
-- Additive: preserves all seller/order data; no table or row deletion.
-- Public metadata can no longer create seller identities. A seller user must
-- consume an unexpired service-role invite, and the profile and pending seller
-- tenant are still created atomically by handle_new_user().
-- Apply only after reviewing on a disposable database; never run automatically.
-- ============================================================================

alter table public.staff_account_invites
  drop constraint if exists staff_account_invites_role_check;
alter table public.staff_account_invites
  add constraint staff_account_invites_role_check
  check (role in ('staff', 'salesman', 'seller'));

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role public.user_role := 'retailer';
  v_invite_role public.user_role;
  v_invite_created_by uuid;
  v_signup_kind text := lower(btrim(coalesce(new.raw_user_meta_data->>'account_type', 'retailer')));
  v_area_text text := nullif(btrim(coalesce(new.raw_user_meta_data->>'area_id', '')), '');
  v_area_id uuid;
  v_phone text := btrim(coalesce(new.raw_user_meta_data->>'phone', ''));
  v_business_name text := btrim(coalesce(new.raw_user_meta_data->>'business_name', ''));
  v_contact_name text := nullif(btrim(coalesce(new.raw_user_meta_data->>'full_name', '')), '');
  v_gstin text := nullif(upper(regexp_replace(coalesce(new.raw_user_meta_data->>'gstin', ''), '\s+', '', 'g')), '');
  v_pan text := nullif(upper(regexp_replace(coalesce(new.raw_user_meta_data->>'pan', ''), '\s+', '', 'g')), '');
  v_address text := nullif(btrim(coalesce(new.raw_user_meta_data->>'address', '')), '');
  v_seller_id uuid;
begin
  if new.email is not null then
    delete from public.staff_account_invites
     where email = lower(new.email)
       and expires_at > now()
    returning role, created_by into v_invite_role, v_invite_created_by;
  end if;

  if v_invite_role is not null then
    v_role := v_invite_role;
  elsif v_signup_kind = 'seller' then
    -- Seller identity can be created only through a live, service-role invite.
    raise exception 'seller_invitation_required' using errcode = '42501';
  end if;

  if v_role = 'seller' then
    if v_signup_kind <> 'seller' then
      raise exception 'seller_invitation_metadata_required' using errcode = '22023';
    end if;
    if char_length(v_business_name) not between 2 and 160 then
      raise exception 'invalid_seller_business_name' using errcode = '22023';
    end if;
    if v_phone !~ '^[6-9][0-9]{9}$' then
      raise exception 'invalid_seller_phone' using errcode = '22023';
    end if;
    if v_gstin is not null and v_gstin !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$' then
      raise exception 'invalid_seller_gstin' using errcode = '22023';
    end if;
    if v_pan is not null and v_pan !~ '^[A-Z]{5}[0-9]{4}[A-Z]$' then
      raise exception 'invalid_seller_pan' using errcode = '22023';
    end if;
  end if;

  begin
    insert into public.profiles (id, role, full_name, phone)
    values (new.id, v_role, coalesce(v_contact_name, ''), v_phone);
  exception
    when unique_violation then
      raise exception 'phone_already_registered';
  end;

  if v_role = 'retailer' then
    if v_area_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      select a.id into v_area_id
        from public.areas a
       where a.id = v_area_text::uuid and a.is_active;
    end if;
    if v_area_id is null then
      raise exception 'invalid_area';
    end if;

    insert into public.retailers (id, shop_name, area_id, address, status)
    values (
      new.id,
      coalesce(new.raw_user_meta_data->>'shop_name', ''),
      v_area_id,
      new.raw_user_meta_data->>'address',
      'pending_approval'
    );
  elsif v_role = 'seller' then
    begin
      insert into public.sellers (
        business_name, gstin, pan, contact_name, phone, email, address_line,
        status, created_by
      ) values (
        v_business_name, v_gstin, v_pan, v_contact_name, v_phone,
        lower(new.email), v_address, 'pending', coalesce(v_invite_created_by, new.id)
      ) returning id into v_seller_id;
    exception
      when unique_violation then
        raise exception 'seller_business_already_registered';
    end;

    insert into public.seller_members (
      seller_id, profile_id, member_role, created_by
    ) values (v_seller_id, new.id, 'owner', coalesce(v_invite_created_by, new.id));
  end if;

  return new;
end;
$$;
