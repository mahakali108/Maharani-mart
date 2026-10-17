-- ============================================================================
-- 0064: Seller Marketplace — split-order identity EXPAND layer (behaviour
-- neutral for every existing caller).
--
-- WHAT THIS ADDS
--   * `cart_items`: explicit source discriminator + nullable offer reference +
--     a generated `line_key` ('m' for Maharani, 's:<offer id>' for seller).
--     One cart line per (retailer, pack, source). Legacy rows default to the
--     Maharani source — ZERO backfill needed, and the old
--     UNIQUE(retailer_id, pack_id) is atomically replaced by
--     UNIQUE(retailer_id, pack_id, line_key) AFTER the new key is active
--     (replacement-first order inside this one transaction).
--   * `order_items`: source/offer identity + fulfilment accounting counters
--     (shipped / accepted / missing_damaged / returned_received) beside the
--     existing deducted/restored stock counters (0054). TWO partial uniques
--     enforce the legacy and split rules with NON-NULL key sets (Postgres
--     treats NULL keys as distinct in unique indexes, so a plain
--     UNIQUE(sub_order_id, pack_id) would NOT protect legacy rows):
--       · legacy unsplit rows (sub_order_id IS NULL): one pack per order
--       · split rows (sub_order_id NOT NULL): one pack per sub-order;
--         the same pack MAY appear in different sub-orders.
--   * `sub_orders`: seller-specific children of a customer-facing parent
--     `orders` row (decision: one parent order + seller sub-orders; parent and
--     children carry paise-exact totals that must reconcile).
--   * `orders.fulfilment_profile` — 'all_maharani' | 'mixed' | 'all_seller',
--     stamped by checkout; legacy rows stay NULL and behave exactly as today.
--
-- Quantity accounting (Phase 1.3 invariants): for each order line,
--   0 ≤ returned_received ≤ accepted, accepted + missing_damaged ≤ shipped,
--   shipped ≤ quantity, restored ≤ deducted ≤ quantity,
--   restorable = deducted − shipped + returned_received − restored ≥ 0.
-- Restores (0066) move only `restorable`, so stock is never restored twice or
-- for units still in transit.
--
-- SAFETY: behaviour-neutral expand. Old carts/orders/checkout callers see no
-- difference (defaults). NOT executed against any database.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. cart_items — source identity
-- ---------------------------------------------------------------------------
alter table public.cart_items
  add column if not exists source_type text not null default 'maharani',
  add column if not exists seller_offer_id uuid references public.seller_offers(id) on delete restrict;

alter table public.cart_items
  drop constraint if exists cart_items_source_shape;
alter table public.cart_items
  add constraint cart_items_source_shape
  check (
    (source_type = 'maharani' and seller_offer_id is null)
    or (source_type = 'seller' and seller_offer_id is not null)
  );

alter table public.cart_items
  add column if not exists line_key text
    generated always as (
      case when seller_offer_id is null then 'm' else 's:' || seller_offer_id::text end
    ) stored;

create unique index if not exists uq_cart_items_pack_source
  on public.cart_items (retailer_id, pack_id, line_key);

-- Replacement-first: the new key is proven active above, so the old
-- pack-only key can go in the same transaction.
alter table public.cart_items
  drop constraint if exists cart_items_retailer_id_pack_id_key;

-- ---------------------------------------------------------------------------
-- 2. order_items — split identity + fulfilment counters
-- ---------------------------------------------------------------------------
alter table public.order_items
  add column if not exists sub_order_id uuid,
  add column if not exists seller_offer_id uuid references public.seller_offers(id) on delete restrict,
  add column if not exists source_type text not null default 'maharani',
  add column if not exists fulfilment_type text,
  add column if not exists shipped_quantity integer not null default 0,
  add column if not exists accepted_quantity integer not null default 0,
  add column if not exists missing_damaged_quantity integer not null default 0,
  add column if not exists returned_received_quantity integer not null default 0;

alter table public.order_items
  drop constraint if exists order_items_source_shape;
alter table public.order_items
  add constraint order_items_source_shape
  check (
    (source_type = 'maharani' and seller_offer_id is null)
    or (source_type = 'seller' and seller_offer_id is not null)
  );

alter table public.order_items
  drop constraint if exists order_items_fulfilment_counters;
alter table public.order_items
  add constraint order_items_fulfilment_counters
  check (
    shipped_quantity >= 0
    and accepted_quantity >= 0
    and missing_damaged_quantity >= 0
    and returned_received_quantity >= 0
    and accepted_quantity + missing_damaged_quantity <= shipped_quantity
    and shipped_quantity <= quantity
    and returned_received_quantity <= accepted_quantity
    and stock_restored_quantity <= stock_deducted_quantity
    and stock_deducted_quantity - shipped_quantity + returned_received_quantity - stock_restored_quantity >= 0
  );

-- Legacy rule: one pack per order for unsplit rows. Key has NO null columns.
create unique index if not exists uq_order_items_legacy_pack
  on public.order_items (order_id, pack_id) where sub_order_id is null;

-- Split rule: one pack per sub-order; the same pack is allowed in siblings.
create unique index if not exists uq_order_items_child_pack
  on public.order_items (sub_order_id, pack_id) where sub_order_id is not null;

create index if not exists idx_order_items_sub_order on public.order_items (sub_order_id) where sub_order_id is not null;

-- ---------------------------------------------------------------------------
-- 3. sub_orders — seller children of a parent order
-- ---------------------------------------------------------------------------
create table if not exists public.sub_orders (
  id uuid primary key default uuid_generate_v4(),
  parent_order_id uuid not null references public.orders(id) on delete cascade,
  seller_id uuid references public.sellers(id) on delete restrict,
  fulfilment_type text not null check (fulfilment_type in ('seller', 'maharani')),
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned', 'failed')),
  sort_index integer not null default 0,
  -- Immutable money snapshots (integer paise). Allocation shares must sum
  -- exactly to the parent amounts (largest-remainder at checkout, 0065).
  gross_paise bigint not null default 0 check (gross_paise >= 0),
  gst_paise bigint not null default 0 check (gst_paise >= 0),
  coupon_share_paise bigint not null default 0 check (coupon_share_paise >= 0),
  coins_share_paise bigint not null default 0 check (coins_share_paise >= 0),
  payable_paise bigint not null default 0 check (payable_paise >= 0),
  commission_rate_bp integer check (commission_rate_bp is null or (commission_rate_bp >= 0 and commission_rate_bp <= 10000)),
  commission_basis text not null default 'undecided',
  needs_admin_review boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sub_orders_shape check (
    -- A seller child always has a seller (it may still be Maharani-fulfilled).
    (seller_id is not null)
    or (fulfilment_type = 'maharani')
  )
);

-- At most one child per (parent, seller) and at most one Maharani child per
-- parent (keeps the existing one-delivery-per-order model valid for Maharani).
create unique index if not exists uq_sub_orders_parent_seller
  on public.sub_orders (parent_order_id, coalesce(seller_id, '00000000-0000-0000-0000-000000000000'::uuid));

create index if not exists idx_sub_orders_parent on public.sub_orders (parent_order_id, sort_index);
create index if not exists idx_sub_orders_seller on public.sub_orders (seller_id, status);

-- Child state machine (parent transitions stay governed by 0042 untouched).
create or replace function public.enforce_sub_order_status_transitions()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status is distinct from old.status then
    if not (
      (old.status = 'pending'    and new.status in ('confirmed', 'cancelled'))
      or (old.status = 'confirmed'  and new.status in ('processing', 'shipped', 'cancelled'))
      or (old.status = 'processing' and new.status in ('shipped', 'cancelled'))
      or (old.status = 'shipped'    and new.status in ('delivered', 'failed', 'returned'))
      or (old.status = 'failed'     and new.status in ('shipped', 'cancelled', 'returned'))
      or (old.status = 'delivered'  and new.status in ('returned'))
    ) then
      raise exception 'INVALID_SUB_ORDER_STATUS_TRANSITION: % -> %', old.status, new.status
        using errcode = 'check_violation';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_enforce_sub_order_status_transitions on public.sub_orders;
create trigger trg_enforce_sub_order_status_transitions
  before update of status on public.sub_orders
  for each row execute function public.enforce_sub_order_status_transitions();

-- Money snapshots are immutable after creation (0056:372 convention).
create or replace function public.guard_sub_order_snapshot_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.parent_order_id is distinct from old.parent_order_id
     or new.seller_id is distinct from old.seller_id
     or new.fulfilment_type is distinct from old.fulfilment_type
     or new.gross_paise is distinct from old.gross_paise
     or new.gst_paise is distinct from old.gst_paise
     or new.coupon_share_paise is distinct from old.coupon_share_paise
     or new.coins_share_paise is distinct from old.coins_share_paise
     or new.payable_paise is distinct from old.payable_paise
     or new.sort_index is distinct from old.sort_index then
    raise exception 'Sub-order checkout snapshots are immutable.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_sub_order_snapshot_update on public.sub_orders;
create trigger trg_guard_sub_order_snapshot_update
  before update on public.sub_orders
  for each row execute function public.guard_sub_order_snapshot_update();

drop trigger if exists trg_audit_sub_orders on public.sub_orders;
create trigger trg_audit_sub_orders
  after insert or update or delete on public.sub_orders
  for each row execute function log_audit();

-- ---------------------------------------------------------------------------
-- 4. orders — fulfilment profile marker (NULL = legacy)
-- ---------------------------------------------------------------------------
alter table public.orders
  add column if not exists fulfilment_profile text
    check (fulfilment_profile is null or fulfilment_profile in ('all_maharani', 'mixed', 'all_seller'));

comment on column public.orders.fulfilment_profile is
  'Stamped at checkout from line fulfilment_type: all_seller = no pack-stock lines (seller stock only, no warehouse needed) | mixed | all_maharani. NULL for orders created before the seller marketplace split — those keep legacy behaviour everywhere.';
comment on column public.order_items.sub_order_id is
  'NULL for legacy unsplit orders (one-pack-per-order rule applies). Non-null on split checkouts (one-pack-per-sub-order rule applies).';

-- ---------------------------------------------------------------------------
-- 5. RLS for sub_orders (member/admin). Order-line identity columns inherit
--    the existing order_items policies (0037) which scope by parent order.
-- ---------------------------------------------------------------------------
alter table public.sub_orders enable row level security;

revoke all on public.sub_orders from anon, authenticated;
grant select on public.sub_orders to authenticated;

drop policy if exists "sub_orders_select" on public.sub_orders;
create policy "sub_orders_select" on public.sub_orders
  for select using (
    is_admin_or_above()
    or public.is_member_of_seller(seller_id)
    or exists (
      select 1 from public.orders o
       where o.id = parent_order_id
         and (o.retailer_id = auth.uid() or o.collected_by = auth.uid())
    )
    or exists (
      select 1 from public.orders o
       where o.id = parent_order_id
         and public.is_retailer_assigned_to_current_salesman(o.retailer_id)
    )
  );

comment on table public.sub_orders is
  'Seller-specific children of a customer-facing parent order. Money snapshots are immutable; status follows the child state machine (0064) and parent aggregation (0066).';

-- ============================================================================
-- END OF MIGRATION — behaviour-neutral for existing callers; no business data.
-- ============================================================================
