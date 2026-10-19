-- 0073: Configured delivery coverage AFTER main's 0071 sets the Gaya default.
-- Existing areas/retailers/addresses/orders remain unchanged. No PINs are
-- seeded: verified PINs must be explicitly activated by an admin. Pricing /
-- inventory areas remain separate from actual delivery serviceability.
-- DB-first rollout is required; a self-checkout with an unstructured address
-- will be refused until the web/mobile clients select a saved, PIN-coded one.
-- Do not reapply the existing 0071 migration or rewrite its history.

create table if not exists public.delivery_service_areas (
  id uuid primary key default uuid_generate_v4(),
  district text not null default 'Gaya' check (char_length(district) between 2 and 120 and district = btrim(district)),
  state text not null default 'Bihar' check (char_length(state) between 2 and 120 and state = btrim(state)),
  pincode text not null check (pincode ~ '^[0-9]{6}$'),
  is_active boolean not null default false,
  minimum_order_paise bigint not null default 0 check (minimum_order_paise >= 0),
  delivery_fee_paise bigint not null default 0 check (delivery_fee_paise >= 0),
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists delivery_service_areas_geo_pin_key
  on public.delivery_service_areas(lower(district), lower(state), pincode);
create index if not exists delivery_service_areas_active_pin_idx
  on public.delivery_service_areas(pincode) where is_active;

alter table public.delivery_service_areas enable row level security;
revoke all on public.delivery_service_areas from public, anon, authenticated;
grant select, insert, update on public.delivery_service_areas to authenticated;
create policy "delivery_pins_admin_read" on public.delivery_service_areas
  for select to authenticated using (public.is_admin_or_above());
create policy "delivery_pins_admin_insert" on public.delivery_service_areas
  for insert to authenticated with check (public.is_admin_or_above() and created_by = auth.uid());
create policy "delivery_pins_admin_update" on public.delivery_service_areas
  for update to authenticated using (public.is_admin_or_above())
  with check (public.is_admin_or_above() and updated_by = auth.uid());
-- No API delete: deactivate a PIN so existing order snapshots remain meaningful.
create trigger trg_audit_delivery_service_areas
  after insert or update on public.delivery_service_areas
  for each row execute function public.log_audit();

-- Retailers can check coverage/terms without reading or editing the admin PIN
-- directory. A missing row means *not confirmed serviceable*, not a promise.
create or replace function public.check_delivery_serviceability(
  p_district text, p_state text, p_pincode text
) returns table (area_id uuid, minimum_order_paise bigint, delivery_fee_paise bigint)
language sql stable security definer set search_path = public, pg_temp
as $$
  select d.id, d.minimum_order_paise, d.delivery_fee_paise
    from public.delivery_service_areas d
   where auth.uid() is not null and public.current_user_role() = 'retailer'
     and public.is_active_account()
     and d.is_active
     and lower(d.district) = lower(btrim(coalesce(p_district, '')))
     and lower(d.state) = lower(btrim(coalesce(p_state, '')))
     and d.pincode = p_pincode
   limit 1;
$$;
revoke all on function public.check_delivery_serviceability(text, text, text) from public, anon;
grant execute on function public.check_delivery_serviceability(text, text, text) to authenticated;

alter table public.orders
  add column if not exists delivery_service_area_id uuid references public.delivery_service_areas(id) on delete restrict,
  add column if not exists delivery_minimum_order_paise bigint check (delivery_minimum_order_paise >= 0),
  add column if not exists delivery_fee_paise bigint not null default 0 check (delivery_fee_paise >= 0);

-- Defense in depth for *both* atomic order RPCs: all self-checkout orders with
-- a request fingerprint must match currently active, verified coverage at the
-- instant the order is inserted. The FOR SHARE lock serializes an admin PIN
-- deactivation/terms edit against checkout. Existing history is not backfilled.
-- Salesman-captured and older pre-0056 orders have no structured PIN snapshot;
-- they remain manual processes, not implied delivery coverage.
create or replace function public.enforce_self_checkout_delivery_area()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_area public.delivery_service_areas%rowtype;
begin
  if new.shipping_address is null or jsonb_typeof(new.shipping_address) <> 'object'
     or nullif(btrim(new.shipping_address->>'line'), '') is null
     or nullif(btrim(new.shipping_address->>'district'), '') is null
     or nullif(btrim(new.shipping_address->>'state'), '') is null
     or coalesce(new.shipping_address->>'pincode', '') !~ '^[0-9]{6}$' then
    raise exception 'DELIVERY_ADDRESS_REQUIRED: select a saved address with district, state and PIN.'
      using errcode = '23514';
  end if;
  select * into v_area from public.delivery_service_areas d
   where d.is_active
     and lower(d.district) = lower(btrim(new.shipping_address->>'district'))
     and lower(d.state) = lower(btrim(new.shipping_address->>'state'))
     and d.pincode = new.shipping_address->>'pincode'
   for share;
  if not found then
    raise exception 'DELIVERY_AREA_UNAVAILABLE: delivery is not confirmed for this address/PIN.'
      using errcode = '23514';
  end if;
  if round(new.grand_total * 100)::bigint < v_area.minimum_order_paise then
    raise exception 'DELIVERY_MINIMUM_NOT_MET: order is below the configured delivery minimum.'
      using errcode = '23514';
  end if;
  -- The existing 0056/0065 RPCs reconcile order totals and multi-seller
  -- allocations strictly to goods, GST, coupon and Coins. Never insert a
  -- payable order missing a configured fee while fee allocations are absent.
  if v_area.delivery_fee_paise <> 0 then
    raise exception 'DELIVERY_FEE_NOT_SUPPORTED: this area cannot be ordered online yet.'
      using errcode = '23514';
  end if;
  new.delivery_service_area_id := v_area.id;
  new.delivery_minimum_order_paise := v_area.minimum_order_paise;
  new.delivery_fee_paise := v_area.delivery_fee_paise;
  new.shipping_address := jsonb_set(new.shipping_address, '{deliveryAreaId}', to_jsonb(v_area.id::text), true);
  return new;
end;
$$;
create trigger trg_enforce_self_checkout_delivery_area
  before insert on public.orders
  for each row when (new.collected_by is null and new.request_fingerprint is not null)
  execute function public.enforce_self_checkout_delivery_area();

create or replace function public.guard_delivery_snapshot_update()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if new.delivery_service_area_id is distinct from old.delivery_service_area_id
     or new.delivery_minimum_order_paise is distinct from old.delivery_minimum_order_paise
     or new.delivery_fee_paise is distinct from old.delivery_fee_paise then
    raise exception 'Order delivery terms are immutable after placement.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger trg_guard_delivery_snapshot_update
  before update on public.orders
  for each row execute function public.guard_delivery_snapshot_update();

comment on table public.delivery_service_areas is
  'Admin-verified district/state/PIN coverage. No rows are seeded: district defaults alone never confer delivery coverage. Positive delivery fees block online checkout until split-order fee allocation is implemented.';
comment on column public.orders.delivery_service_area_id is
  'Verified delivery PIN used at self-checkout; null for historical orders or manual salesman captures. Do not infer coverage for null rows.';
