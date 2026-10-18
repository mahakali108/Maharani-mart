-- ============================================================================
-- 0063: Seller Marketplace — offers, admin price floors, moderation, history.
--
-- WHAT THIS ADDS
--   * `offer_price_floors` — Admin-configured minimum selling prices per pack,
--     append-only (a new row supersedes; old rows are history). The floor is a
--     commercial configuration value — it is NOT derived from `cost_price`,
--     whose visibility is locked to admin (0025/0054).
--   * `seller_offers` — one seller's offer to sell an EXISTING central pack
--     (decision: shared catalogue; no duplicate seller products). Carries the
--     seller price (integer paise, matching the wallet/collections ledger
--     convention), seller MOQ, seller-owned stock (seller-fulfilled only),
--     fulfilment mode and a moderation state machine.
--   * `seller_offer_price_history` — append-only price audit written by
--     trigger on every `unit_price_paise` change.
--
-- DESIGN NOTES
--   * Seller-owned stock lives ONLY on `seller_offers.stock_quantity`. It never
--     enters warehouses, inventory_stock, inventory_batches, GRNs, transfers,
--     FEFO or valuation (0017/0054 machinery stays Maharani-only).
--   * `stock_quantity` is NULL for 'maharani'-fulfilled offers (stock comes
--     from product_packs as today) and NOT NULL for 'seller'-fulfilled offers.
--   * One ACTIVE offer per (seller, pack) via partial unique index —
--     inactive/history rows may repeat. A product pack may carry one Maharani
--     line AND several sellers' offers at once; checkout picks per line.
--   * Offers referenced by carts or order history are DEACTIVATED, never
--     deleted (no delete policy; FKs from cart/order lines are ON DELETE
--     RESTRICT in 0064).
--   * Revalidation points: cart mutation (0065 `mutate_retailer_cart_line_ex`),
--     quote (app layer), and final checkout (`create_order_atomic_v2`) all
--     re-check offer activity, moderation status, floor, and seller status.
--
-- SAFETY: additive & re-runnable. NOT executed against any database.
-- ============================================================================

create table if not exists offer_price_floors (
  id uuid primary key default uuid_generate_v4(),
  pack_id uuid not null references product_packs(id) on delete cascade,
  floor_paise bigint not null check (floor_paise > 0),
  effective_from timestamptz not null default now(),
  set_by uuid references profiles(id),
  note text check (note is null or char_length(btrim(note)) <= 300),
  created_at timestamptz not null default now()
);

create index if not exists idx_offer_price_floors_pack on offer_price_floors (pack_id, effective_from desc);

create table if not exists seller_offers (
  id uuid primary key default uuid_generate_v4(),
  seller_id uuid not null references sellers(id) on delete restrict,
  product_id uuid not null references products(id) on delete restrict,
  pack_id uuid not null references product_packs(id) on delete restrict,
  fulfilment_type text not null check (fulfilment_type in ('seller', 'maharani')),
  seller_sku text check (seller_sku is null or char_length(btrim(seller_sku)) <= 64),
  unit_price_paise bigint not null check (unit_price_paise > 0),
  moq int not null default 1 check (moq >= 1 and moq <= 100000),
  -- Seller-owned on-hand stock: required for seller fulfilment, meaningless
  -- (and therefore NULL) for Maharani fulfilment.
  stock_quantity int check (stock_quantity is null or (stock_quantity >= 0 and stock_quantity <= 2000000000)),
  is_active boolean not null default true,
  moderation_status text not null default 'pending'
    check (moderation_status in ('pending', 'approved', 'rejected')),
  moderation_by uuid references profiles(id),
  moderated_at timestamptz,
  moderation_reason text check (moderation_reason is null or char_length(btrim(moderation_reason)) between 3 and 500),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seller_offers_stock_shape check (
    (fulfilment_type = 'seller' and stock_quantity is not null)
    or (fulfilment_type = 'maharani' and stock_quantity is null)
  )
);

create unique index if not exists uq_seller_offers_active_pack
  on seller_offers (seller_id, pack_id) where is_active;
create index if not exists idx_seller_offers_pack on seller_offers (pack_id) where is_active;
create index if not exists idx_seller_offers_seller on seller_offers (seller_id, moderation_status);

create table if not exists seller_offer_price_history (
  id uuid primary key default uuid_generate_v4(),
  seller_offer_id uuid not null references seller_offers(id) on delete cascade,
  old_price_paise bigint,
  new_price_paise bigint not null check (new_price_paise > 0),
  changed_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_seller_offer_price_history on seller_offer_price_history (seller_offer_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Helpers: current floor for a pack (append-only table: latest effective row).
-- ---------------------------------------------------------------------------
create or replace function public.current_offer_floor_paise(p_pack_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select f.floor_paise
    from public.offer_price_floors f
   where f.pack_id = p_pack_id
     and f.effective_from <= now()
   order by f.effective_from desc, f.created_at desc
   limit 1;
$$;
revoke all on function public.current_offer_floor_paise(uuid) from public, anon;
grant execute on function public.current_offer_floor_paise(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Offer rules: floor enforcement, moderation-column lockdown, seller activity.
-- ---------------------------------------------------------------------------
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

drop trigger if exists trg_enforce_seller_offer_rules on seller_offers;
create trigger trg_enforce_seller_offer_rules
  before insert or update on seller_offers
  for each row execute function public.enforce_seller_offer_rules();

-- Append-only price history.
create or replace function public.log_seller_offer_price_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.unit_price_paise is distinct from old.unit_price_paise then
    insert into public.seller_offer_price_history
      (seller_offer_id, old_price_paise, new_price_paise, changed_by)
    values
      (new.id, old.unit_price_paise, new.unit_price_paise, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists trg_log_seller_offer_price_change on seller_offers;
create trigger trg_log_seller_offer_price_change
  before update of unit_price_paise on seller_offers
  for each row execute function public.log_seller_offer_price_change();

drop trigger if exists trg_audit_seller_offers on seller_offers;
create trigger trg_audit_seller_offers
  after insert or update or delete on seller_offers
  for each row execute function log_audit();

drop trigger if exists trg_audit_offer_price_floors on offer_price_floors;
create trigger trg_audit_offer_price_floors
  after insert or update or delete on offer_price_floors
  for each row execute function log_audit();

-- Floors are history: ordinary updates/deletes are refused outright.
create or replace function public.prevent_offer_floor_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'Price floors are append-only history. Insert a new row instead.'
    using errcode = '42501';
end;
$$;

drop trigger if exists trg_prevent_offer_floor_mutation on offer_price_floors;
create trigger trg_prevent_offer_floor_mutation
  before update or delete on offer_price_floors
  for each row execute function public.prevent_offer_floor_mutation();

-- ---------------------------------------------------------------------------
-- RLS + explicit grants.
-- ---------------------------------------------------------------------------
alter table offer_price_floors enable row level security;
alter table seller_offers enable row level security;
alter table seller_offer_price_history enable row level security;

revoke all on offer_price_floors from anon, authenticated;
revoke all on seller_offers from anon, authenticated;
revoke all on seller_offer_price_history from anon, authenticated;

-- Floors: admin-only everywhere (a seller must not see the margin guardrail).
grant select, insert on offer_price_floors to authenticated;

-- Offers: public READ of trading offers is granted, RLS narrows it to
-- approved+active rows of active sellers. Sellers manage their own rows.
grant select, insert, update on seller_offers to authenticated;
grant select on seller_offer_price_history to authenticated;

drop policy if exists "offer_price_floors_admin_select" on offer_price_floors;
create policy "offer_price_floors_admin_select" on offer_price_floors
  for select using (is_admin_or_above());

drop policy if exists "offer_price_floors_admin_insert" on offer_price_floors;
create policy "offer_price_floors_admin_insert" on offer_price_floors
  for insert with check (is_admin_or_above());

drop policy if exists "seller_offers_trading_select" on seller_offers;
create policy "seller_offers_trading_select" on seller_offers
  for select using (
    is_admin_or_above()
    or public.is_member_of_seller(seller_id)
    or (
      is_active
      and moderation_status = 'approved'
      and exists (
        select 1 from public.sellers s
         where s.id = seller_id and s.status = 'active'
      )
    )
  );

drop policy if exists "seller_offers_seller_insert" on seller_offers;
create policy "seller_offers_seller_insert" on seller_offers
  for insert with check (
    is_admin_or_above()
    or (public.is_member_of_seller(seller_id) and moderation_status = 'pending')
  );

drop policy if exists "seller_offers_seller_update" on seller_offers;
create policy "seller_offers_seller_update" on seller_offers
  for update
  using (is_admin_or_above() or public.is_member_of_seller(seller_id))
  with check (is_admin_or_above() or public.is_member_of_seller(seller_id));

-- No DELETE policy on purpose: offers are deactivated, never deleted.

drop policy if exists "seller_offer_price_history_read" on seller_offer_price_history;
create policy "seller_offer_price_history_read" on seller_offer_price_history
  for select using (
    is_admin_or_above()
    or exists (
      select 1 from public.seller_offers so
       where so.id = seller_offer_id
         and public.is_member_of_seller(so.seller_id)
    )
  );

comment on table seller_offers is
  'Seller offers over central product packs: seller price (paise), seller MOQ, seller-owned stock (seller fulfilment only), fulfilment mode and moderation state. Deactivate, never delete.';
comment on table offer_price_floors is
  'Admin-configured minimum offer prices per pack. Append-only commercial history; not derived from cost_price.';

-- ============================================================================
-- END OF MIGRATION — no business data inserted.
-- ============================================================================
