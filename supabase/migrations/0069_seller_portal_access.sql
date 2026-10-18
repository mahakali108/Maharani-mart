-- ============================================================================
-- 0069: Seller portal access, self-registration and marketplace disclosure.
--
-- Deploy only AFTER 0062-0068. This migration does not approve a seller,
-- invent tax identity, enable payouts, or change the legacy cart/order RPCs.
-- Public seller signup creates a PENDING tenant; admin review remains the only
-- path to ACTIVE. All marketplace prices, stock and tenant ids remain
-- database-derived and RLS/function enforced.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Public Auth signup may choose only the unprivileged public account kinds:
--    retailer (default) or seller. Staff/admin roles still require a one-time
--    server-created invite and can never come from client metadata.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role public.user_role := 'retailer';
  v_invite_role public.user_role;
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
    returning role into v_invite_role;
  end if;

  if v_invite_role is not null then
    v_role := v_invite_role;
  elsif v_signup_kind = 'seller' then
    -- `seller` is intentionally unprivileged until an admin activates the
    -- matching business. No metadata value can produce staff/admin access.
    v_role := 'seller';
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
        lower(new.email), v_address, 'pending', new.id
      ) returning id into v_seller_id;
    exception
      when unique_violation then
        raise exception 'seller_business_already_registered';
    end;

    insert into public.seller_members (
      seller_id, profile_id, member_role, created_by
    ) values (v_seller_id, new.id, 'owner', new.id);
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Fix the source-aware cart add path. 0065 accidentally rejected the
--    compare-and-set sentinel expected_quantity=0 for a NEW seller line,
--    making seller offers impossible to add. Existing-line CAS semantics and
--    all offer/stock/floor validation remain unchanged.
-- ---------------------------------------------------------------------------
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

-- Saved carts must retain source identity too; otherwise restoring a seller
-- line silently converts it into Maharani stock. Existing rows backfill as the
-- legacy Maharani source and no historical price is copied.
alter table public.retailer_saved_cart_items
  add column if not exists seller_offer_id uuid references public.seller_offers(id) on delete restrict,
  add column if not exists source_type text;
update public.retailer_saved_cart_items
   set source_type = case when seller_offer_id is null then 'maharani' else 'seller' end
 where source_type is null;
alter table public.retailer_saved_cart_items
  alter column source_type set default 'maharani',
  alter column source_type set not null;
alter table public.retailer_saved_cart_items
  drop constraint if exists retailer_saved_cart_items_source_shape;
alter table public.retailer_saved_cart_items
  add constraint retailer_saved_cart_items_source_shape check (
    (source_type = 'maharani' and seller_offer_id is null)
    or (source_type = 'seller' and seller_offer_id is not null)
  );
create index if not exists idx_saved_cart_items_source_identity
  on public.retailer_saved_cart_items(saved_cart_id, pack_id, seller_offer_id);
drop policy if exists "retailer_saved_cart_items_owner_update" on public.retailer_saved_cart_items;
create policy "retailer_saved_cart_items_owner_update" on public.retailer_saved_cart_items
  for update to authenticated
  using (retailer_id = auth.uid())
  with check (retailer_id = auth.uid());

-- 0063 declared this SECURITY DEFINER trigger but tested `current_user`,
-- which is the function owner inside a definer function. Test the verified JWT
-- role instead so a seller cannot forge moderation columns through PostgREST.
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
  if auth.role() in ('authenticated', 'anon') and not public.is_admin_or_above() then
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


-- ---------------------------------------------------------------------------
-- 3. Seller offer writes: server-derived attribution, active-tenant gate and
--    automatic re-moderation after a seller changes commercial terms.
-- ---------------------------------------------------------------------------
create or replace function public.guard_seller_offer_portal_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  if auth.role() = 'authenticated' and not public.is_admin_or_above() then
    select s.status into v_status
      from public.sellers s
     where s.id = new.seller_id;

    if public.current_user_role() is distinct from 'seller'
       or not public.is_member_of_seller(new.seller_id)
       or v_status is distinct from 'active' then
      raise exception 'An active seller membership is required.' using errcode = '42501';
    end if;

    if tg_op = 'INSERT' then
      if coalesce(new.moderation_status, 'pending') <> 'pending'
         or new.moderation_by is not null
         or new.moderated_at is not null
         or new.moderation_reason is not null then
        raise exception 'New offers start in pending moderation.' using errcode = '42501';
      end if;
      new.created_by := auth.uid();
      new.moderation_status := 'pending';
      new.moderation_by := null;
      new.moderated_at := null;
      new.moderation_reason := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_a_seller_offer_portal_write on public.seller_offers;
create trigger trg_a_seller_offer_portal_write
  before insert on public.seller_offers
  for each row execute function public.guard_seller_offer_portal_write();

create or replace function public.remoderate_seller_offer_terms()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  if auth.role() = 'authenticated' and not public.is_admin_or_above() then
    select status into v_status from public.sellers where id = new.seller_id;
    if public.current_user_role() is distinct from 'seller'
       or not public.is_member_of_seller(new.seller_id)
       or v_status is distinct from 'active' then
      raise exception 'An active seller membership is required.' using errcode = '42501';
    end if;

    if new.unit_price_paise is distinct from old.unit_price_paise
       or new.moq is distinct from old.moq
       or new.seller_sku is distinct from old.seller_sku
       or coalesce(current_setting('app.remoderate_offer', true), '') = 'on' then
      new.moderation_status := 'pending';
      new.moderation_by := null;
      new.moderated_at := null;
      new.moderation_reason := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_zz_remoderate_seller_offer_terms on public.seller_offers;
create trigger trg_zz_remoderate_seller_offer_terms
  before update on public.seller_offers
  for each row execute function public.remoderate_seller_offer_terms();

-- Seller-owned stock is mutable only through this row-locked, tenant-checked
-- RPC. The 0068 direct-column guard remains in place for PostgREST UPDATEs.
create or replace function public.seller_set_offer_stock(
  p_offer_id uuid,
  p_stock_quantity integer
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_offer public.seller_offers%rowtype;
begin
  if p_offer_id is null or p_stock_quantity is null
     or p_stock_quantity < 0 or p_stock_quantity > 2000000000 then
    raise exception 'Stock must be a whole number from 0 to 2000000000.' using errcode = '22023';
  end if;

  select so.* into v_offer
    from public.seller_offers so
    join public.sellers s on s.id = so.seller_id
   where so.id = p_offer_id
     and so.fulfilment_type = 'seller'
     and s.status = 'active'
   for update of so;

  if not found
     or public.current_user_role() is distinct from 'seller'
     or not public.is_member_of_seller(v_offer.seller_id) then
    raise exception 'Offer not found for this active seller.' using errcode = '42501';
  end if;

  update public.seller_offers
     set stock_quantity = p_stock_quantity,
         updated_at = now()
   where id = p_offer_id;
  return p_stock_quantity;
end;
$$;
revoke all on function public.seller_set_offer_stock(uuid, integer) from public, anon;
grant execute on function public.seller_set_offer_stock(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Safe retailer disclosure. The base sellers table keeps its private
--    contact/PAN/address columns tenant/admin-only; these RPCs return only the
--    merchant identity and live trading terms needed for an informed choice.
-- ---------------------------------------------------------------------------
create or replace function public.marketplace_offer_quotes(p_offer_ids uuid[])
returns table (
  offer_id uuid,
  seller_id uuid,
  seller_business_name text,
  seller_gstin text,
  product_id uuid,
  pack_id uuid,
  fulfilment_type text,
  unit_price_paise bigint,
  moq integer,
  stock_quantity integer,
  in_stock boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null
     or public.current_user_role() is distinct from 'retailer'
     or not exists (
       select 1 from public.retailers r
        where r.id = auth.uid() and r.status = 'active'
     ) then
    raise exception 'An active retailer session is required.' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_offer_ids), 0) < 1
     or cardinality(p_offer_ids) > 200
     or array_position(p_offer_ids, null) is not null then
    raise exception 'Request between 1 and 200 offer ids.' using errcode = '22023';
  end if;

  return query
  select so.id, s.id, s.business_name, s.gstin, so.product_id, pp.id,
         so.fulfilment_type, so.unit_price_paise, so.moq,
         case when so.fulfilment_type = 'seller' then so.stock_quantity else pp.stock_quantity end,
         case when so.fulfilment_type = 'seller'
              then coalesce(so.stock_quantity, 0) >= so.moq
              else pp.stock_quantity >= so.moq end
    from public.seller_offers so
    join public.sellers s on s.id = so.seller_id and s.status = 'active'
    join public.product_packs pp on pp.id = so.pack_id and pp.product_id = so.product_id
    join public.products p on p.id = so.product_id
   where so.id = any(p_offer_ids)
     and so.is_active
     and so.moderation_status = 'approved'
     and so.unit_price_paise >= coalesce(public.current_offer_floor_paise(so.pack_id), 0)
     and pp.is_active
     and p.is_active
   order by so.id;
end;
$$;
revoke all on function public.marketplace_offer_quotes(uuid[]) from public, anon;
grant execute on function public.marketplace_offer_quotes(uuid[]) to authenticated;

create or replace function public.marketplace_offers_for_product(p_product_id uuid)
returns table (
  offer_id uuid,
  seller_id uuid,
  seller_business_name text,
  seller_gstin text,
  pack_id uuid,
  pack_name text,
  fulfilment_type text,
  unit_price_paise bigint,
  moq integer,
  in_stock boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null
     or public.current_user_role() is distinct from 'retailer'
     or not exists (
       select 1 from public.retailers r
        where r.id = auth.uid() and r.status = 'active'
     ) then
    raise exception 'An active retailer session is required.' using errcode = '42501';
  end if;

  return query
  select so.id, s.id, s.business_name, s.gstin, pp.id, pp.pack_name,
         so.fulfilment_type, so.unit_price_paise, so.moq,
         case when so.fulfilment_type = 'seller'
              then coalesce(so.stock_quantity, 0) >= so.moq
              else pp.stock_quantity >= so.moq end
    from public.seller_offers so
    join public.sellers s on s.id = so.seller_id and s.status = 'active'
    join public.product_packs pp on pp.id = so.pack_id and pp.product_id = so.product_id
    join public.products p on p.id = so.product_id
   where so.product_id = p_product_id
     and so.is_active
     and so.moderation_status = 'approved'
     and so.unit_price_paise >= coalesce(public.current_offer_floor_paise(so.pack_id), 0)
     and pp.is_active
     and p.is_active
   order by so.unit_price_paise, s.business_name, so.id;
end;
$$;
revoke all on function public.marketplace_offers_for_product(uuid) from public, anon;
grant execute on function public.marketplace_offers_for_product(uuid) to authenticated;

-- Seller order lines inherit the parent-order policy in 0064, which does not
-- admit sellers. Add one narrow, child-membership SELECT path.
drop policy if exists "order_items_seller_select" on public.order_items;
create policy "order_items_seller_select" on public.order_items
  for select to authenticated
  using (
    exists (
      select 1 from public.sub_orders so
       where so.id = order_items.sub_order_id
         and public.is_member_of_seller(so.seller_id)
    )
  );

-- Parent orders contain unrelated seller totals. Expose a bounded projection
-- instead of widening orders RLS. Delivery address is returned only when this
-- seller, rather than Maharani, fulfils the child.
create or replace function public.seller_order_headers()
returns table (
  sub_order_id uuid,
  parent_order_id uuid,
  order_number text,
  placed_at timestamptz,
  status text,
  fulfilment_type text,
  gross_paise bigint,
  gst_paise bigint,
  payable_paise bigint,
  shipping_address jsonb,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null
     or public.current_user_role() is distinct from 'seller'
     or not exists (
       select 1
         from public.seller_members sm
         join public.sellers s on s.id = sm.seller_id
        where sm.profile_id = auth.uid() and s.status = 'active'
     ) then
    raise exception 'An active seller session is required.' using errcode = '42501';
  end if;

  return query
  select so.id, so.parent_order_id, o.order_number, o.placed_at,
         so.status, so.fulfilment_type, so.gross_paise, so.gst_paise,
         so.payable_paise,
         case when so.fulfilment_type = 'seller' then o.shipping_address else null end,
         so.updated_at
    from public.sub_orders so
    join public.orders o on o.id = so.parent_order_id
   where public.is_member_of_seller(so.seller_id)
   order by so.created_at desc, so.id;
end;
$$;
revoke all on function public.seller_order_headers() from public, anon;
grant execute on function public.seller_order_headers() to authenticated;

-- Seller fulfilment transition. The existing child-state trigger remains the
-- authority. Sellers can confirm/process/ship/cancel their own seller-fulfilled
-- child only; delivered/returned/failed remain admin/delivery outcomes.
create or replace function public.seller_update_sub_order(
  p_sub_order_id uuid,
  p_status text,
  p_courier text default null,
  p_awb text default null
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sub public.sub_orders%rowtype;
  v_item record;
  v_restore integer;
begin
  if p_sub_order_id is null
     or p_status is null
     or p_status not in ('confirmed', 'processing', 'shipped', 'cancelled') then
    raise exception 'Unsupported seller fulfilment status.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_courier, ''))) > 120
     or char_length(btrim(coalesce(p_awb, ''))) > 64 then
    raise exception 'Courier or tracking reference is too long.' using errcode = '22023';
  end if;

  select so.* into v_sub
    from public.sub_orders so
    join public.sellers s on s.id = so.seller_id
   where so.id = p_sub_order_id
     and so.fulfilment_type = 'seller'
     and s.status = 'active'
   for update of so;

  if not found
     or public.current_user_role() is distinct from 'seller'
     or not public.is_member_of_seller(v_sub.seller_id) then
    raise exception 'Sub-order not found for this active seller.' using errcode = '42501';
  end if;

  update public.sub_orders
     set status = p_status
   where id = p_sub_order_id;

  insert into public.seller_shipments (
    sub_order_id, seller_id, status, courier, awb,
    packed_at, dispatched_at, cancelled_at, updated_at
  ) values (
    p_sub_order_id, v_sub.seller_id,
    case p_status
      when 'processing' then 'packed'
      when 'shipped' then 'shipped'
      when 'cancelled' then 'cancelled'
      else 'pending'
    end,
    nullif(btrim(coalesce(p_courier, '')), ''),
    nullif(btrim(coalesce(p_awb, '')), ''),
    case when p_status = 'processing' then now() else null end,
    case when p_status = 'shipped' then now() else null end,
    case when p_status = 'cancelled' then now() else null end,
    now()
  )
  on conflict (sub_order_id) do update set
    status = excluded.status,
    courier = coalesce(excluded.courier, seller_shipments.courier),
    awb = coalesce(excluded.awb, seller_shipments.awb),
    packed_at = coalesce(seller_shipments.packed_at, excluded.packed_at),
    dispatched_at = coalesce(seller_shipments.dispatched_at, excluded.dispatched_at),
    cancelled_at = coalesce(seller_shipments.cancelled_at, excluded.cancelled_at),
    updated_at = now();

  if p_status = 'shipped' then
    update public.order_items
       set shipped_quantity = quantity
     where sub_order_id = p_sub_order_id
       and shipped_quantity < quantity;
  elsif p_status = 'cancelled' then
    -- Child is locked and cannot have shipped units on a legal pre-dispatch
    -- cancellation. Restore each line's exact remaining restorable quantity.
    for v_item in
      select oi.*
        from public.order_items oi
       where oi.sub_order_id = p_sub_order_id
         and oi.stock_deducted_quantity - oi.shipped_quantity
             + oi.returned_received_quantity > oi.stock_restored_quantity
       order by oi.id
       for update of oi
    loop
      v_restore := v_item.stock_deducted_quantity
                 - v_item.shipped_quantity
                 + v_item.returned_received_quantity
                 - v_item.stock_restored_quantity;
      if v_restore > 0 then
        update public.seller_offers
           set stock_quantity = stock_quantity + v_restore,
               updated_at = now()
         where id = v_item.seller_offer_id
           and stock_quantity <= 2000000000 - v_restore;
        if not found then
          raise exception 'Seller stock could not be restored.' using errcode = '22003';
        end if;
        update public.order_items
           set stock_restored_quantity = stock_restored_quantity + v_restore
         where id = v_item.id;
      end if;
    end loop;
  end if;

  perform public.apply_parent_order_status(v_sub.parent_order_id);
  return p_status;
end;
$$;
revoke all on function public.seller_update_sub_order(uuid, text, text, text) from public, anon;
grant execute on function public.seller_update_sub_order(uuid, text, text, text) to authenticated;

comment on function public.marketplace_offer_quotes(uuid[]) is
  'Batch retailer-safe quote projection for persisted offer identities; capped at 200 and excludes inactive, unapproved and below-floor offers.';
comment on function public.marketplace_offers_for_product(uuid) is
  'Retailer-safe marketplace disclosure: live approved offers plus seller business name/GSTIN; no seller PAN, contact or address.';
comment on function public.seller_order_headers() is
  'Seller-scoped order projection. Never exposes another child or the parent aggregate totals; address only for seller fulfilment.';
comment on function public.seller_update_sub_order(uuid, text, text, text) is
  'Tenant-checked seller fulfilment transition; delivered/returns/failures stay outside seller authority. Cancellation restores only the DB-computed restorable stock.';

-- Allow Admin (checked inside both functions via is_admin_or_above()) to invoke
-- sub-order status transitions and child-scoped stock restores from Server Actions.
grant execute on function public.set_sub_order_status(uuid, text, text) to authenticated;
grant execute on function public.restore_sub_order_stock(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Seller self-service profile update (never touches status/review columns).
-- ---------------------------------------------------------------------------
create or replace function public.seller_update_own_profile(
  p_business_name text,
  p_contact_name text default null,
  p_phone text default null,
  p_email text default null,
  p_gstin text default null,
  p_pan text default null,
  p_address_line text default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_seller_id uuid;
  v_business text := btrim(coalesce(p_business_name, ''));
  v_contact text := nullif(btrim(coalesce(p_contact_name, '')), '');
  v_phone text := nullif(regexp_replace(btrim(coalesce(p_phone, '')), '^\+?91[\s-]*|^0', ''), '');
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_gstin text := nullif(upper(regexp_replace(coalesce(p_gstin, ''), '\s+', '', 'g')), '');
  v_pan text := nullif(upper(regexp_replace(coalesce(p_pan, ''), '\s+', '', 'g')), '');
  v_address text := nullif(btrim(coalesce(p_address_line, '')), '');
begin
  if v_uid is null or public.current_user_role() is distinct from 'seller' then
    raise exception 'A seller session is required.' using errcode = '42501';
  end if;

  select sm.seller_id into v_seller_id
    from public.seller_members sm
    join public.sellers s on s.id = sm.seller_id
   where sm.profile_id = v_uid
   for update of s;
  if not found then
    raise exception 'Seller membership not found.' using errcode = '42501';
  end if;

  if char_length(v_business) not between 2 and 160 then
    raise exception 'Business name must be between 2 and 160 characters.' using errcode = '22023';
  end if;
  if v_contact is not null and char_length(v_contact) not between 2 and 120 then
    raise exception 'Contact name must be between 2 and 120 characters.' using errcode = '22023';
  end if;
  if v_phone is not null and v_phone !~ '^[6-9][0-9]{9}$' then
    raise exception 'Enter a valid 10-digit Indian mobile number.' using errcode = '22023';
  end if;
  if v_email is not null and (char_length(v_email) > 160 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'Enter a valid email address.' using errcode = '22023';
  end if;
  if v_gstin is not null and v_gstin !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$' then
    raise exception 'Enter a valid 15-character GSTIN.' using errcode = '22023';
  end if;
  if v_pan is not null and v_pan !~ '^[A-Z]{5}[0-9]{4}[A-Z]$' then
    raise exception 'Enter a valid 10-character PAN.' using errcode = '22023';
  end if;
  if v_address is not null and char_length(v_address) > 300 then
    raise exception 'Address must be 300 characters or fewer.' using errcode = '22023';
  end if;

  update public.sellers
     set business_name = v_business,
         contact_name = coalesce(v_contact, contact_name),
         phone = coalesce(v_phone, phone),
         email = coalesce(v_email, email),
         gstin = v_gstin,
         pan = v_pan,
         address_line = v_address,
         updated_at = now()
   where id = v_seller_id;

  update public.profiles
     set full_name = coalesce(v_contact, full_name),
         phone = coalesce(v_phone, phone)
   where id = v_uid;

  return v_seller_id;
end;
$$;
revoke all on function public.seller_update_own_profile(text, text, text, text, text, text, text) from public, anon;
grant execute on function public.seller_update_own_profile(text, text, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Seller-specific quantity-tier pricing (seller_offer_tiers).
-- ---------------------------------------------------------------------------
create table if not exists public.seller_offer_tiers (
  id uuid primary key default uuid_generate_v4(),
  seller_offer_id uuid not null references public.seller_offers(id) on delete cascade,
  min_quantity integer not null check (min_quantity >= 1 and min_quantity <= 100000),
  max_quantity integer check (max_quantity is null or (max_quantity >= min_quantity and max_quantity <= 100000)),
  unit_price_paise bigint not null check (unit_price_paise > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (seller_offer_id, min_quantity)
);

create index if not exists idx_seller_offer_tiers_offer
  on public.seller_offer_tiers (seller_offer_id, min_quantity)
  where is_active;

create or replace function public.enforce_seller_offer_tier_rules()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_offer public.seller_offers%rowtype;
  v_floor bigint;
begin
  select * into v_offer from public.seller_offers where id = new.seller_offer_id;
  if not found then
    raise exception 'Unknown seller offer for this tier.' using errcode = '23503';
  end if;

  v_floor := public.current_offer_floor_paise(v_offer.pack_id);
  if v_floor is not null and new.unit_price_paise < v_floor then
    raise exception 'PRICE_BELOW_FLOOR: the tier price is below the admin minimum for this pack.'
      using errcode = '23514';
  end if;

  if new.unit_price_paise > v_offer.unit_price_paise then
    raise exception 'TIER_ABOVE_BASE_PRICE: a quantity tier cannot exceed the base offer price.'
      using errcode = '23514';
  end if;

  if new.min_quantity < v_offer.moq then
    raise exception 'TIER_BELOW_MOQ: tier minimum quantity must be at least the offer MOQ.'
      using errcode = '23514';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_enforce_seller_offer_tier_rules on public.seller_offer_tiers;
create trigger trg_enforce_seller_offer_tier_rules
  before insert or update on public.seller_offer_tiers
  for each row execute function public.enforce_seller_offer_tier_rules();

drop trigger if exists trg_audit_seller_offer_tiers on public.seller_offer_tiers;
create trigger trg_audit_seller_offer_tiers
  after insert or update or delete on public.seller_offer_tiers
  for each row execute function log_audit();

alter table public.seller_offer_tiers enable row level security;
revoke all on public.seller_offer_tiers from anon, authenticated;
grant select on public.seller_offer_tiers to authenticated;

drop policy if exists "seller_offer_tiers_select" on public.seller_offer_tiers;
create policy "seller_offer_tiers_select" on public.seller_offer_tiers
  for select to authenticated
  using (
    public.is_admin_or_above()
    or exists (
      select 1 from public.seller_offers so
       where so.id = seller_offer_tiers.seller_offer_id
         and (
           public.is_member_of_seller(so.seller_id)
           or (
             so.is_active
             and so.moderation_status = 'approved'
             and exists (
               select 1 from public.sellers s
                where s.id = so.seller_id and s.status = 'active'
             )
           )
         )
    )
  );

create or replace function public.effective_seller_offer_unit_price_paise(
  p_offer_id uuid,
  p_quantity integer
) returns bigint
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_base_paise bigint;
  v_tier_paise bigint;
begin
  select so.unit_price_paise into v_base_paise
    from public.seller_offers so
   where so.id = p_offer_id;
  if not found then
    return null;
  end if;

  select sot.unit_price_paise into v_tier_paise
    from public.seller_offer_tiers sot
   where sot.seller_offer_id = p_offer_id
     and sot.is_active
     and sot.min_quantity <= coalesce(p_quantity, 1)
     and (sot.max_quantity is null or coalesce(p_quantity, 1) <= sot.max_quantity)
   order by sot.min_quantity desc
   limit 1;

  return coalesce(v_tier_paise, v_base_paise);
end;
$$;
revoke all on function public.effective_seller_offer_unit_price_paise(uuid, integer) from public, anon;
grant execute on function public.effective_seller_offer_unit_price_paise(uuid, integer) to authenticated, service_role;

create or replace function public.seller_replace_offer_tiers(
  p_offer_id uuid,
  p_tiers jsonb
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_offer public.seller_offers%rowtype;
  v_seller_status text;
  v_is_admin boolean := public.is_admin_or_above();
  v_tier record;
  v_prev_max integer := 0;
  v_prev_min integer := 0;
  v_count integer := 0;
begin
  if p_offer_id is null then
    raise exception 'Offer id is required.' using errcode = '22023';
  end if;
  if p_tiers is null or jsonb_typeof(p_tiers) <> 'array' or jsonb_array_length(p_tiers) > 20 then
    raise exception 'Provide an array of up to 20 pricing tiers.' using errcode = '22023';
  end if;

  select so.*, s.status as seller_status
    into v_offer
    from public.seller_offers so
    join public.sellers s on s.id = so.seller_id
   where so.id = p_offer_id
   for update of so;
  if not found then
    raise exception 'Seller offer not found.' using errcode = 'P0002';
  end if;

  select status into v_seller_status from public.sellers where id = v_offer.seller_id;

  if not v_is_admin then
    if public.current_user_role() is distinct from 'seller'
       or not public.is_member_of_seller(v_offer.seller_id)
       or v_seller_status is distinct from 'active' then
      raise exception 'An active seller membership is required.' using errcode = '42501';
    end if;
  end if;

  delete from public.seller_offer_tiers where seller_offer_id = p_offer_id;

  for v_tier in
    select *
      from jsonb_to_recordset(p_tiers) as r(
        min_quantity integer,
        max_quantity integer,
        unit_price_paise bigint
      )
     order by min_quantity asc
  loop
    if v_tier.min_quantity is null or v_tier.unit_price_paise is null then
      raise exception 'Each tier requires min_quantity and unit_price_paise.' using errcode = '22023';
    end if;
    if v_prev_min > 0 and (v_tier.min_quantity <= v_prev_min or (v_prev_max is null or v_tier.min_quantity <= v_prev_max)) then
      raise exception 'Pricing tiers must have strictly increasing, non-overlapping quantity ranges.' using errcode = '22023';
    end if;

    insert into public.seller_offer_tiers (
      seller_offer_id, min_quantity, max_quantity, unit_price_paise, is_active
    ) values (
      p_offer_id, v_tier.min_quantity, v_tier.max_quantity, v_tier.unit_price_paise, true
    );

    v_prev_min := v_tier.min_quantity;
    v_prev_max := v_tier.max_quantity;
    v_count := v_count + 1;
  end loop;

  -- Changing commercial tier terms as a seller requires fresh admin moderation.
  if not v_is_admin then
    perform set_config('app.remoderate_offer', 'on', true);
    update public.seller_offers
       set updated_at = now()
     where id = p_offer_id;
    perform set_config('app.remoderate_offer', '', true);
  end if;

  return v_count;
end;
$$;
revoke all on function public.seller_replace_offer_tiers(uuid, jsonb) from public, anon;
grant execute on function public.seller_replace_offer_tiers(uuid, jsonb) to authenticated;

create or replace function public.marketplace_offer_tiers(p_offer_ids uuid[])
returns table (
  offer_id uuid,
  min_quantity integer,
  max_quantity integer,
  unit_price_paise bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_offer_ids), 0) < 1
     or cardinality(p_offer_ids) > 200
     or array_position(p_offer_ids, null) is not null then
    raise exception 'Request between 1 and 200 offer ids.' using errcode = '22023';
  end if;

  return query
  select sot.seller_offer_id, sot.min_quantity, sot.max_quantity, sot.unit_price_paise
    from public.seller_offer_tiers sot
    join public.seller_offers so on so.id = sot.seller_offer_id
    join public.sellers s on s.id = so.seller_id
   where sot.seller_offer_id = any(p_offer_ids)
     and sot.is_active
     and (
       public.is_admin_or_above()
       or public.is_member_of_seller(so.seller_id)
       or (so.is_active and so.moderation_status = 'approved' and s.status = 'active')
     )
   order by sot.seller_offer_id, sot.min_quantity asc;
end;
$$;
revoke all on function public.marketplace_offer_tiers(uuid[]) from public, anon;
grant execute on function public.marketplace_offer_tiers(uuid[]) to authenticated;

-- Wire effective_seller_offer_unit_price_paise into create_order_atomic_v2 so
-- split-order checkout validates quantity-tier unit prices when tiers exist.
do $$
declare
  v_def text;
  v_old text := 'v_expected_unit_price := round(v_offer_price_paise::numeric / 100, 2);';
  v_new text := 'v_offer_price_paise := coalesce(public.effective_seller_offer_unit_price_paise(v_item.seller_offer_id, v_item.quantity), v_offer_price_paise);
      v_expected_unit_price := round(v_offer_price_paise::numeric / 100, 2);';
begin
  select pg_get_functiondef('public.create_order_atomic_v2'::regproc) into v_def;
  if v_def is not null and position('effective_seller_offer_unit_price_paise' in v_def) = 0 then
    v_def := replace(v_def, v_old, v_new);
    execute v_def;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Retailer/Admin sub-order & shipment tracking projection.
-- ---------------------------------------------------------------------------
create or replace function public.retailer_order_sub_orders(p_order_id uuid)
returns table (
  sub_order_id uuid,
  seller_id uuid,
  seller_business_name text,
  seller_gstin text,
  fulfilment_type text,
  status text,
  gross_paise bigint,
  gst_paise bigint,
  coupon_share_paise bigint,
  coins_share_paise bigint,
  payable_paise bigint,
  shipment_status text,
  courier text,
  awb text,
  packed_at timestamptz,
  dispatched_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or p_order_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not (
    public.is_staff_or_above()
    or exists (
      select 1 from public.orders o
       where o.id = p_order_id
         and (
           o.retailer_id = auth.uid()
           or o.collected_by = auth.uid()
           or public.is_retailer_assigned_to_current_salesman(o.retailer_id)
         )
    )
  ) then
    raise exception 'Access denied for this order.' using errcode = '42501';
  end if;

  return query
  select so.id,
         so.seller_id,
         coalesce(s.business_name, 'Maharani Traders'),
         s.gstin,
         so.fulfilment_type,
         so.status,
         so.gross_paise,
         so.gst_paise,
         so.coupon_share_paise,
         so.coins_share_paise,
         so.payable_paise,
         sh.status,
         sh.courier,
         sh.awb,
         sh.packed_at,
         sh.dispatched_at,
         sh.delivered_at,
         sh.cancelled_at
    from public.sub_orders so
    left join public.sellers s on s.id = so.seller_id
    left join public.seller_shipments sh on sh.sub_order_id = so.id
   where so.parent_order_id = p_order_id
   order by so.sort_index asc, so.created_at asc;
end;
$$;
revoke all on function public.retailer_order_sub_orders(uuid) from public, anon;
grant execute on function public.retailer_order_sub_orders(uuid) to authenticated;

-- ============================================================================
-- END OF 0069
-- ============================================================================
