-- ============================================================================
-- Rollback 0069: disable seller portal entry points without deleting seller,
-- order, offer, shipment or ledger data. Run only after the application has
-- been rolled back. Existing seller identities remain for audit/history.
-- ============================================================================

do $$
begin
  if exists (
    select 1 from public.retailer_saved_cart_items where seller_offer_id is not null
  ) then
    raise exception 'Rollback 0069 refused: saved carts contain seller-offer identities. Restore/remove them through an approved data plan first.';
  end if;
end;
$$;

revoke all on function public.seller_update_sub_order(uuid, text, text, text) from public, anon, authenticated, service_role;
drop function if exists public.seller_update_sub_order(uuid, text, text, text);

revoke all on function public.seller_order_headers() from public, anon, authenticated, service_role;
drop function if exists public.seller_order_headers();

revoke all on function public.marketplace_offers_for_product(uuid) from public, anon, authenticated, service_role;
drop function if exists public.marketplace_offers_for_product(uuid);
revoke all on function public.marketplace_offer_quotes(uuid[]) from public, anon, authenticated, service_role;
drop function if exists public.marketplace_offer_quotes(uuid[]);

revoke all on function public.seller_set_offer_stock(uuid, integer) from public, anon, authenticated, service_role;
drop function if exists public.seller_set_offer_stock(uuid, integer);

drop policy if exists "order_items_seller_select" on public.order_items;

drop trigger if exists trg_zz_remoderate_seller_offer_terms on public.seller_offers;
drop function if exists public.remoderate_seller_offer_terms();
drop trigger if exists trg_a_seller_offer_portal_write on public.seller_offers;
drop function if exists public.guard_seller_offer_portal_write();

drop policy if exists "retailer_saved_cart_items_owner_update" on public.retailer_saved_cart_items;
drop index if exists public.idx_saved_cart_items_source_identity;
alter table public.retailer_saved_cart_items
  drop constraint if exists retailer_saved_cart_items_source_shape,
  drop column if exists source_type,
  drop column if exists seller_offer_id;

-- Restore the pre-0069 seller-offer trigger body.
create or replace function public.enforce_seller_offer_rules()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_floor bigint;
  v_seller_status text;
begin
  select status into v_seller_status from public.sellers where id = new.seller_id;
  if v_seller_status is null then
    raise exception 'Unknown seller for this offer.' using errcode = '23503';
  end if;

  v_floor := public.current_offer_floor_paise(new.pack_id);
  if v_floor is not null and new.unit_price_paise < v_floor then
    raise exception 'PRICE_BELOW_FLOOR: the offer price is below the admin minimum for this pack.'
      using errcode = '23514';
  end if;

  -- Moderation and stock-authority columns are admin-only for API clients.
  if current_user in ('authenticated', 'anon') and not public.is_admin_or_above() then
    if tg_op = 'UPDATE' then
      if new.moderation_status is distinct from old.moderation_status
         or new.moderation_by is distinct from old.moderation_by
         or new.moderated_at is distinct from old.moderated_at
         or new.moderation_reason is distinct from old.moderation_reason then
        raise exception 'Only an Admin can change the moderation state of an offer.'
          using errcode = '42501';
      end if;
      if new.is_active is distinct from old.is_active and v_seller_status <> 'active' then
        raise exception 'A suspended or inactive seller cannot activate offers.'
          using errcode = '42501';
      end if;
    end if;
    if tg_op = 'INSERT' and new.moderation_status <> 'pending' then
      raise exception 'New offers start in pending moderation.' using errcode = '42501';
    end if;
  end if;

  -- A non-active seller can never hold an ACTIVE, approved offer (drain mode
  -- is completed by the 0068 suspend hook; this blocks re-activation).
  if new.is_active and new.moderation_status = 'approved' and v_seller_status <> 'active' then
    raise exception 'SELLER_NOT_ACTIVE: only an active seller can trade this offer.'
      using errcode = '23514';
  end if;

  new.updated_at := now();
  return new;
end;
$$;


-- Restore the pre-0069 source-aware cart function.
create or replace function public.mutate_retailer_cart_line_ex(
  p_pack_id uuid,
  p_seller_offer_id uuid,
  p_cart_item_id uuid,
  p_expected_quantity integer,
  p_quantity integer
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_retailer_id uuid := auth.uid();
  v_cart_item_id uuid;
  v_actual_pack_id uuid;
  v_actual_offer_id uuid;
  v_current_quantity integer;
  v_moq integer;
  v_pack_active boolean;
  v_product_active boolean;
  v_offer_price_paise bigint;
  v_offer_moq integer;
  v_offer_stock integer;
  v_offer_active boolean;
  v_offer_moderation text;
  v_offer_pack uuid;
  v_seller_status text;
  v_floor bigint;
begin
  if v_retailer_id is null
     or public.current_user_role() is distinct from 'retailer'
     or not exists (
       select 1 from public.profiles pr
        where pr.id = v_retailer_id and pr.role = 'retailer' and pr.is_active
     )
     or not exists (
       select 1 from public.retailers r
        where r.id = v_retailer_id and r.status = 'active'
     ) then
    raise exception 'An active retailer session is required.' using errcode = '42501';
  end if;
  if p_pack_id is null
     or p_expected_quantity is null or p_expected_quantity < 0 or p_expected_quantity > 100000
     or p_quantity is null or p_quantity < 1 or p_quantity > 100000 then
    raise exception 'Cart quantity must be a whole number between 1 and 100000 pieces.' using errcode = '22023';
  end if;
  if p_seller_offer_id is not null and p_expected_quantity = 0 then
    raise exception 'Invalid cart quantity for an offer line.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('retailer-cart:' || v_retailer_id::text, 0)
  );

  select pp.moq, pp.is_active, p.is_active
    into v_moq, v_pack_active, v_product_active
    from public.product_packs pp
    join public.products p on p.id = pp.product_id
   where pp.id = p_pack_id
   for share of pp, p;
  if not found or not v_pack_active or not v_product_active then
    raise exception 'PACK_UNAVAILABLE: this pack is no longer available.' using errcode = '23514';
  end if;

  if p_seller_offer_id is null then
    if p_quantity < v_moq then
      raise exception 'MINIMUM_ORDER_QUANTITY: minimum is % pieces for this pack.', v_moq using errcode = '23514';
    end if;
  else
    select so.unit_price_paise, so.moq, so.stock_quantity, so.is_active,
           so.moderation_status, so.pack_id, s.status
      into v_offer_price_paise, v_offer_moq, v_offer_stock, v_offer_active,
           v_offer_moderation, v_offer_pack, v_seller_status
      from public.seller_offers so
      join public.sellers s on s.id = so.seller_id
     where so.id = p_seller_offer_id
       for share of so, s;
    if not found or not v_offer_active or v_offer_moderation <> 'approved'
       or v_seller_status <> 'active' or v_offer_pack is distinct from p_pack_id then
      raise exception 'OFFER_UNAVAILABLE: this seller offer is no longer available.' using errcode = '23514';
    end if;
    if v_offer_price_paise is null or v_offer_price_paise <= 0 then
      raise exception 'OFFER_UNAVAILABLE: this seller offer has no valid price.' using errcode = '23514';
    end if;
    v_floor := public.current_offer_floor_paise(p_pack_id);
    if v_floor is not null and v_offer_price_paise < v_floor then
      raise exception 'PRICE_BELOW_FLOOR: the offer price is below the admin minimum for this pack.' using errcode = '23514';
    end if;
    if p_quantity < greatest(v_offer_moq, 1) then
      raise exception 'MINIMUM_ORDER_QUANTITY: minimum is % pieces for this offer.', greatest(v_offer_moq, 1) using errcode = '23514';
    end if;
    if v_offer_stock is not null and p_quantity > v_offer_stock then
      raise exception 'INSUFFICIENT_STOCK: only % available for this offer.', v_offer_stock using errcode = '23514';
    end if;
  end if;

  if p_cart_item_id is not null then
    select ci.pack_id, ci.seller_offer_id, ci.quantity
      into v_actual_pack_id, v_actual_offer_id, v_current_quantity
      from public.cart_items ci
     where ci.id = p_cart_item_id and ci.retailer_id = v_retailer_id
     for update;
    if not found or v_actual_pack_id is distinct from p_pack_id
       or v_actual_offer_id is distinct from p_seller_offer_id
       or v_current_quantity is distinct from p_expected_quantity then
      raise exception 'CART_CHANGED: refresh the cart before applying this quantity.' using errcode = '40001';
    end if;
    update public.cart_items ci
       set quantity = p_quantity, updated_at = now()
     where ci.id = p_cart_item_id and ci.retailer_id = v_retailer_id;
    return p_quantity;
  end if;

  select ci.id, ci.quantity
    into v_cart_item_id, v_current_quantity
    from public.cart_items ci
   where ci.retailer_id = v_retailer_id
     and ci.pack_id = p_pack_id
     and ci.seller_offer_id is not distinct from p_seller_offer_id
   for update;
  if not found then
    v_cart_item_id := null;
    v_current_quantity := 0;
  end if;
  if v_current_quantity is distinct from p_expected_quantity then
    raise exception 'CART_CHANGED: refresh the cart before adding this item.' using errcode = '40001';
  end if;

  if v_cart_item_id is null then
    insert into public.cart_items (retailer_id, pack_id, seller_offer_id, source_type, quantity)
    values (
      v_retailer_id,
      p_pack_id,
      p_seller_offer_id,
      case when p_seller_offer_id is null then 'maharani' else 'seller' end,
      p_quantity
    );
  else
    update public.cart_items ci
       set quantity = p_quantity, updated_at = now()
     where ci.id = v_cart_item_id and ci.retailer_id = v_retailer_id;
  end if;
  return p_quantity;
end;
$$;
revoke all on function public.mutate_retailer_cart_line_ex(uuid, uuid, uuid, integer, integer) from public, anon;
grant execute on function public.mutate_retailer_cart_line_ex(uuid, uuid, uuid, integer, integer) to authenticated;

comment on function public.mutate_retailer_cart_line_ex(uuid, uuid, uuid, integer, integer) is
  'Source-aware cart mutation (maharani pack line when p_seller_offer_id is null, seller offer line otherwise) with compare-and-set semantics, offer/seller/floor revalidation and seller MOQ/stock checks. The legacy 4-arg RPC is unchanged.';

-- Restore the pre-0069 auth trigger: public signup is retailer-only again;
-- staff/salesman still require their one-time server-created invite.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_role user_role := 'retailer';
  v_invite_role user_role;
  v_area_text text := nullif(trim(coalesce(new.raw_user_meta_data->>'area_id', '')), '');
  v_area_id uuid;
begin
  -- The role is NEVER taken from raw_user_meta_data: any visitor controls it
  -- through supabase.auth.signUp({ options: { data } }) with the public anon
  -- key. A staff/salesman role comes only from a live, server-created invite
  -- for this exact email, consumed here so it can never be reused.
  if new.email is not null then
    delete from public.staff_account_invites
     where email = lower(new.email)
       and expires_at > now()
    returning role into v_invite_role;
  end if;
  if v_invite_role is not null then
    v_role := v_invite_role;
  end if;

  begin
    insert into public.profiles (id, role, full_name, phone)
    values (
      new.id,
      v_role,
      coalesce(new.raw_user_meta_data->>'full_name', ''),
      coalesce(new.raw_user_meta_data->>'phone', '')
    );
  exception
    when unique_violation then
      raise exception 'phone_already_registered';
  end;

  if v_role = 'retailer' then
    -- Area must be a real, active area (retailers.area_id is NOT NULL). The
    -- old trigger swallowed this failure and left a retailer profile with no
    -- retailers row, which the (now dropped) self-insert policy let the user
    -- fill in as an ACTIVE shop with any credit limit.
    if v_area_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      select a.id into v_area_id from public.areas a where a.id = v_area_text::uuid and a.is_active;
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
  end if;

  return new;
end;
$$;

-- ============================================================================
-- END ROLLBACK 0069
-- ============================================================================
