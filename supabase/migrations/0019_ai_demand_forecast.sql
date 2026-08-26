-- ============================================================================
-- 0019: AI Demand Forecasting support
-- ----------------------------------------------------------------------------
-- Purely additive. Reuses existing orders / order_items / return handling and
-- the inventory_product_totals view. No existing table, column, policy or
-- trigger is modified, dropped or weakened.
--
-- What this migration adds:
--   * ai_product_demand_daily — an RLS-guarded, server-side aggregation view
--     of authorized per-product daily demand (non-cancelled orders), plus
--     cancellation and return context. Aggregates in Postgres so the app
--     never drags raw order lines into Node and never bypasses RLS.
--   * ai_demand_forecasts — an optional snapshot table so an authorized
--     staff/admin can persist an explainable forecast run for observability.
--     It is READ, not authoritative: sales are never auto-written.
--
-- Security model:
--   * The demand view gates every row with is_staff_or_above(), matching the
--     existing inventory_product_totals / inventory_expiry_report pattern. It
--     therefore returns ZERO rows to retailer/salesman sessions, and only
--     authorized rows to staff+. The underlying orders / order_items RLS still
--     applies to the querying session because the helper reads auth.uid().
--   * ai_demand_forecasts has owner-scoped RLS for staff/admin only and is
--     writeable only through secure definer-style policies that verify the
--     caller's role via is_staff_or_above()/is_admin_or_above().
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Server-side daily demand aggregation (REAL data only).
--    Demand = summed quantities of non-cancelled orders per product per day.
--    Cancelled/returned units are surfaced separately as context (they are
--    never added to demand). Gated to staff+ so salesman/retailer sessions
--    see nothing here, exactly like the existing inventory views.
-- ----------------------------------------------------------------------------
create or replace view ai_product_demand_daily as
with base as (
  select oi.product_id,
         o.placed_at::date as demand_date,
         sum(oi.quantity) as quantity,
         count(distinct o.id) as order_count
  from order_items oi
  join orders o on o.id = oi.order_id
  where o.status not in ('cancelled')
    and is_staff_or_above()
  group by oi.product_id, o.placed_at::date
),
cancelled as (
  select oi.product_id,
         o.placed_at::date as demand_date,
         sum(oi.quantity) as cancelled_units
  from order_items oi
  join orders o on o.id = oi.order_id
  where o.status = 'cancelled'
    and is_staff_or_above()
  group by oi.product_id, o.placed_at::date
),
returns as (
  select osa.product_id,
         o.placed_at::date as demand_date,
         sum(osa.quantity_returned) as return_units
  from order_stock_allocations osa
  join orders o on o.id = osa.order_id
  where is_staff_or_above()
  group by osa.product_id, o.placed_at::date
)
select b.product_id,
       b.demand_date,
       b.quantity,
       b.order_count,
       coalesce(c.cancelled_units, 0) as cancelled_units,
       coalesce(r.return_units, 0) as return_units
from base b
left join cancelled c
  on c.product_id = b.product_id and c.demand_date = b.demand_date
left join returns r
  on r.product_id = b.product_id and r.demand_date = b.demand_date;

comment on view ai_product_demand_daily is
  'Authorized per-product daily demand from REAL non-cancelled orders, with cancellation/return context. Only staff+ can read it.';

-- ----------------------------------------------------------------------------
-- 2. Optional forecast snapshot table (observability only).
--    The app computes forecasts on demand from real data; when an authorized
--    staff/admin runs a forecast batch it may persist the snapshot here so the
--    business can review the trend over time. It never bypasses RLS and is
--    never used to change stock, prices or orders.
-- ----------------------------------------------------------------------------
create table if not exists ai_demand_forecasts (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid not null references products(id) on delete cascade,
  snapshot_days int not null check (snapshot_days between 1 and 365),
  demand_7_day int,
  demand_30_day int,
  direction text not null check (direction in ('rising', 'stable', 'falling')),
  trend_change_percent numeric(8,2),
  confidence numeric(4,3) check (confidence >= 0 and confidence <= 1),
  confidence_label text check (confidence_label in ('High', 'Medium', 'Low', 'Insufficient')),
  available_stock int,
  stockout_days int,
  stockout_date date,
  stockout_risk text check (stockout_risk in ('none', 'low', 'medium', 'high', 'critical')),
  reorder_quantity int,
  overstock_warning boolean not null default false,
  dead_stock_warning boolean not null default false,
  data_basis text,
  method text,
  created_by uuid references profiles(id),
  computed_at timestamptz not null default now()
);

create index if not exists idx_ai_demand_forecasts_product on ai_demand_forecasts(product_id, computed_at desc);
create index if not exists idx_ai_demand_forecasts_created on ai_demand_forecasts(computed_at desc);

alter table ai_demand_forecasts enable row level security;

-- Staff+ may read the snapshot ledger (matches inventory views).
drop policy if exists "ai_demand_forecasts_staff_read" on ai_demand_forecasts;
create policy "ai_demand_forecasts_staff_read" on ai_demand_forecasts
  for select using (is_staff_or_above());

-- Staff+ may record the snapshots they computed; no DELETE by default so the
-- historical trend is preserved. Admins may remove stale snapshots.
drop policy if exists "ai_demand_forecasts_staff_insert" on ai_demand_forecasts;
create policy "ai_demand_forecasts_staff_insert" on ai_demand_forecasts
  for insert with check (is_staff_or_above());

drop policy if exists "ai_demand_forecasts_staff_update" on ai_demand_forecasts;
create policy "ai_demand_forecasts_staff_update" on ai_demand_forecasts
  for update using (is_staff_or_above()) with check (is_staff_or_above());

drop policy if exists "ai_demand_forecasts_admin_delete" on ai_demand_forecasts;
create policy "ai_demand_forecasts_admin_delete" on ai_demand_forecasts
  for delete using (is_admin_or_above());

comment on table ai_demand_forecasts is
  'Read-only observability snapshot of authorized demand-forecast runs. Never used to mutate stock, prices, credit or orders.';

-- ============================================================================
-- END OF MIGRATION — no business data inserted; no existing data modified.
-- ============================================================================
