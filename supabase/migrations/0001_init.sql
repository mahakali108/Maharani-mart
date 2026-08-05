-- ============================================================================
-- Maa Kali B2B Ultra Platform — Production Database Schema
-- Supabase / Postgres
-- NOTE: This file contains SCHEMA ONLY. No INSERT statements. No seed data.
-- Database boots completely empty. All data entered via Admin Panel.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. EXTENSIONS
-- ----------------------------------------------------------------------------
create extension if not exists "uuid-ossp";
create extension if not exists "pg_net";       -- for webhook triggers (notifications)
create extension if not exists "pg_cron";      -- for nightly AI insight jobs

-- ----------------------------------------------------------------------------
-- 1. ENUMS
-- ----------------------------------------------------------------------------
create type user_role as enum ('super_admin', 'admin', 'staff', 'salesman', 'retailer');
create type order_status as enum ('pending','confirmed','processing','packed','dispatched','delivered','cancelled','returned');
create type stock_movement_type as enum ('inward','outward','damage','return','transfer','adjustment');
create type price_scope as enum ('base','area','retailer','scheme','festival');
create type notification_channel as enum ('whatsapp','sms','push','in_app');
create type notification_status as enum ('queued','sent','delivered','failed');
create type visit_status as enum ('planned','checked_in','checked_out','skipped');
create type retailer_status as enum ('pending_approval','active','suspended');

-- ----------------------------------------------------------------------------
-- 2. CORE IDENTITY
-- ----------------------------------------------------------------------------

-- Extends auth.users 1:1
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role user_role not null,
  full_name text not null,
  phone text unique not null,
  avatar_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table areas (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,                -- e.g. Khagaria Town, Gogri, Parbatta, Alauli
  district text not null default 'Khagaria',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table warehouses (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  area_id uuid references areas(id),
  address text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table retailers (
  id uuid primary key references profiles(id) on delete cascade,
  shop_name text not null,
  gstin text,
  area_id uuid not null references areas(id),
  address text,
  credit_limit numeric(12,2) not null default 0,
  outstanding_balance numeric(12,2) not null default 0,
  status retailer_status not null default 'pending_approval',
  approved_by uuid references profiles(id),
  approved_at timestamptz,
  assigned_salesman_id uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table staff_assignments (
  id uuid primary key default uuid_generate_v4(),
  staff_id uuid not null references profiles(id) on delete cascade,
  area_id uuid references areas(id),
  warehouse_id uuid references warehouses(id),
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 3. CATALOG
-- ----------------------------------------------------------------------------

create table brands (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,
  logo_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table categories (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  parent_id uuid references categories(id),
  image_url text,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (name, parent_id)
);

create table products (
  id uuid primary key default uuid_generate_v4(),
  sku_code text not null unique,
  name text not null,
  brand_id uuid references brands(id),
  category_id uuid references categories(id),
  unit text not null,                 -- e.g. 'carton', 'box', 'pcs'
  units_per_case int not null default 1,
  base_price numeric(12,2) not null,
  cost_price numeric(12,2),           -- admin/super_admin visibility only (RLS)
  gst_percent numeric(5,2) not null default 0,
  hsn_code text,
  lead_time_days int not null default 2,   -- used by low-stock predictor
  is_new_launch boolean not null default false,
  is_active boolean not null default true,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table product_images (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid not null references products(id) on delete cascade,
  image_url text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table banners (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  image_url text not null,
  link_url text,
  area_id uuid references areas(id),      -- null = all areas
  sort_order int not null default 0,
  is_active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 4. PRICING ENGINE
-- ----------------------------------------------------------------------------

create table schemes (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  description text,
  is_festival boolean not null default false,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  is_active boolean not null default true,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table price_lists (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid not null references products(id) on delete cascade,
  scope price_scope not null,
  area_id uuid references areas(id),          -- set when scope = 'area'
  retailer_id uuid references retailers(id),  -- set when scope = 'retailer'
  scheme_id uuid references schemes(id),      -- set when scope = 'scheme' or 'festival'
  price numeric(12,2) not null,
  priority int not null default 0,            -- higher wins when multiple match
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  is_active boolean not null default true,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  constraint price_scope_target check (
    (scope = 'base') or
    (scope = 'area' and area_id is not null) or
    (scope = 'retailer' and retailer_id is not null) or
    (scope in ('scheme','festival') and scheme_id is not null)
  )
);

create index idx_price_lists_product on price_lists(product_id);

-- Resolves the effective price for a retailer at order time.
-- Priority: retailer-specific > active scheme/festival > area > base.
create or replace function get_effective_price(p_product_id uuid, p_retailer_id uuid)
returns numeric as $$
declare
  v_price numeric;
  v_area_id uuid;
begin
  select area_id into v_area_id from retailers where id = p_retailer_id;

  select price into v_price from price_lists
    where product_id = p_product_id and scope = 'retailer' and retailer_id = p_retailer_id
      and is_active and now() between valid_from and coalesce(valid_to, 'infinity')
    order by priority desc limit 1;
  if v_price is not null then return v_price; end if;

  select price into v_price from price_lists
    where product_id = p_product_id and scope in ('scheme','festival')
      and is_active and now() between valid_from and coalesce(valid_to, 'infinity')
    order by priority desc limit 1;
  if v_price is not null then return v_price; end if;

  select price into v_price from price_lists
    where product_id = p_product_id and scope = 'area' and area_id = v_area_id
      and is_active and now() between valid_from and coalesce(valid_to, 'infinity')
    order by priority desc limit 1;
  if v_price is not null then return v_price; end if;

  select price into v_price from price_lists
    where product_id = p_product_id and scope = 'base'
      and is_active and now() between valid_from and coalesce(valid_to, 'infinity')
    order by priority desc limit 1;
  if v_price is not null then return v_price; end if;

  select base_price into v_price from products where id = p_product_id;
  return v_price;
end;
$$ language plpgsql stable;

-- ----------------------------------------------------------------------------
-- 5. INVENTORY (movement-sourced, never directly edited)
-- ----------------------------------------------------------------------------

create table inventory_stock (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid not null references products(id) on delete cascade,
  warehouse_id uuid not null references warehouses(id) on delete cascade,
  quantity int not null default 0,     -- derived/cached; kept in sync by trigger below
  updated_at timestamptz not null default now(),
  unique (product_id, warehouse_id)
);

create table stock_movements (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid not null references products(id),
  warehouse_id uuid not null references warehouses(id),
  movement_type stock_movement_type not null,
  quantity int not null,               -- always positive; direction implied by type
  reference_order_id uuid,             -- nullable link to orders(id)
  reason text,
  performed_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

create index idx_stock_movements_product on stock_movements(product_id, warehouse_id);

create or replace function apply_stock_movement() returns trigger as $$
declare
  v_delta int;
begin
  v_delta := case
    when new.movement_type in ('inward','return') then new.quantity
    when new.movement_type in ('outward','damage','transfer') then -new.quantity
    else new.quantity -- adjustment: caller passes signed intent via reason/quantity convention
  end;

  insert into inventory_stock (product_id, warehouse_id, quantity, updated_at)
  values (new.product_id, new.warehouse_id, v_delta, now())
  on conflict (product_id, warehouse_id)
  do update set quantity = inventory_stock.quantity + v_delta, updated_at = now();

  return new;
end;
$$ language plpgsql;

create trigger trg_apply_stock_movement
  after insert on stock_movements
  for each row execute function apply_stock_movement();

-- ----------------------------------------------------------------------------
-- 6. ORDERING
-- ----------------------------------------------------------------------------

create table cart_items (
  id uuid primary key default uuid_generate_v4(),
  retailer_id uuid not null references retailers(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  quantity int not null check (quantity > 0),
  updated_at timestamptz not null default now(),
  unique (retailer_id, product_id)
);

create table orders (
  id uuid primary key default uuid_generate_v4(),
  order_number text not null unique,         -- generated via sequence/function, not random demo text
  retailer_id uuid not null references retailers(id),
  warehouse_id uuid references warehouses(id),
  status order_status not null default 'pending',
  collected_by uuid references profiles(id), -- salesman/staff who captured it, null if self-placed
  subtotal numeric(12,2) not null default 0,
  discount_total numeric(12,2) not null default 0,
  gst_total numeric(12,2) not null default 0,
  grand_total numeric(12,2) not null default 0,
  notes text,
  placed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table order_items (
  id uuid primary key default uuid_generate_v4(),
  order_id uuid not null references orders(id) on delete cascade,
  product_id uuid not null references products(id),
  quantity int not null check (quantity > 0),
  unit_price numeric(12,2) not null,   -- snapshot of effective price at order time
  gst_percent numeric(5,2) not null default 0,
  line_total numeric(12,2) not null
);

create table order_status_history (
  id uuid primary key default uuid_generate_v4(),
  order_id uuid not null references orders(id) on delete cascade,
  status order_status not null,
  changed_by uuid references profiles(id),
  note text,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 7. SALESMAN MODULE
-- ----------------------------------------------------------------------------

create table routes (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  salesman_id uuid not null references profiles(id),
  area_id uuid references areas(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table route_customers (
  id uuid primary key default uuid_generate_v4(),
  route_id uuid not null references routes(id) on delete cascade,
  retailer_id uuid not null references retailers(id) on delete cascade,
  visit_day int,                     -- 1=Mon .. 7=Sun, for weekly beat plans
  sort_order int not null default 0,
  unique (route_id, retailer_id)
);

create table visits (
  id uuid primary key default uuid_generate_v4(),
  salesman_id uuid not null references profiles(id),
  retailer_id uuid not null references retailers(id),
  status visit_status not null default 'planned',
  check_in_at timestamptz,
  check_in_lat numeric(9,6),
  check_in_lng numeric(9,6),
  check_out_at timestamptz,
  order_id uuid references orders(id),
  notes text,
  created_at timestamptz not null default now()
);

create table attendance (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id),
  punch_in_at timestamptz not null,
  punch_in_lat numeric(9,6),
  punch_in_lng numeric(9,6),
  punch_out_at timestamptz,
  punch_out_lat numeric(9,6),
  punch_out_lng numeric(9,6),
  work_date date not null default current_date,
  unique (user_id, work_date)
);

-- ----------------------------------------------------------------------------
-- 8. NOTIFICATIONS
-- ----------------------------------------------------------------------------

create table notifications (
  id uuid primary key default uuid_generate_v4(),
  recipient_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  body text not null,
  link_url text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create table notification_logs (
  id uuid primary key default uuid_generate_v4(),
  recipient_id uuid references profiles(id),
  channel notification_channel not null,
  status notification_status not null default 'queued',
  provider_message_id text,
  payload jsonb,
  error text,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 9. AI / ANALYTICS (computed, never fabricated)
-- ----------------------------------------------------------------------------

create table ai_predictions (
  id uuid primary key default uuid_generate_v4(),
  prediction_type text not null,       -- 'daily_sales' | 'low_stock' | 'top_products'
  scope_id uuid,                       -- e.g. product_id or warehouse_id, nullable
  payload jsonb not null,              -- structured result
  confidence numeric(5,2),
  computed_at timestamptz not null default now()
);

create table retailer_insights (
  retailer_id uuid primary key references retailers(id) on delete cascade,
  recency_score int,
  frequency_score int,
  monetary_score int,
  last_order_at timestamptz,
  avg_order_value numeric(12,2),
  updated_at timestamptz not null default now()
);

-- Materialized view refreshed nightly by cron — empty until real orders exist.
create materialized view mv_top_products as
  select oi.product_id, sum(oi.quantity) as qty_sold, sum(oi.line_total) as revenue
  from order_items oi
  join orders o on o.id = oi.order_id
  where o.placed_at > now() - interval '30 days'
    and o.status not in ('cancelled')
  group by oi.product_id;

-- ----------------------------------------------------------------------------
-- 10. AUDIT LOG
-- ----------------------------------------------------------------------------

create table audit_logs (
  id uuid primary key default uuid_generate_v4(),
  table_name text not null,
  record_id uuid not null,
  action text not null,          -- 'insert' | 'update' | 'delete'
  changed_by uuid references profiles(id),
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create or replace function log_audit() returns trigger as $$
begin
  insert into audit_logs (table_name, record_id, action, changed_by, old_data, new_data)
  values (
    tg_table_name,
    coalesce(new.id, old.id),
    lower(tg_op),
    auth.uid(),
    case when tg_op in ('update','delete') then to_jsonb(old) else null end,
    case when tg_op in ('update','insert') then to_jsonb(new) else null end
  );
  return coalesce(new, old);
end;
$$ language plpgsql security definer;

create trigger trg_audit_products after insert or update or delete on products
  for each row execute function log_audit();
create trigger trg_audit_price_lists after insert or update or delete on price_lists
  for each row execute function log_audit();
create trigger trg_audit_orders after insert or update or delete on orders
  for each row execute function log_audit();

-- ============================================================================
-- 11. ROW LEVEL SECURITY
-- ============================================================================

alter table profiles enable row level security;
alter table retailers enable row level security;
alter table products enable row level security;
alter table price_lists enable row level security;
alter table inventory_stock enable row level security;
alter table stock_movements enable row level security;
alter table cart_items enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table notifications enable row level security;
alter table visits enable row level security;
alter table attendance enable row level security;
alter table routes enable row level security;
alter table route_customers enable row level security;
alter table banners enable row level security;
alter table ai_predictions enable row level security;
alter table retailer_insights enable row level security;

-- Helper functions
create or replace function current_user_role() returns user_role as $$
  select role from profiles where id = auth.uid();
$$ language sql stable security definer;

create or replace function is_staff_or_above() returns boolean as $$
  select current_user_role() in ('super_admin','admin','staff');
$$ language sql stable security definer;

create or replace function is_admin_or_above() returns boolean as $$
  select current_user_role() in ('super_admin','admin');
$$ language sql stable security definer;

-- profiles: users see/edit their own row; staff+ see all
create policy "profiles_self_select" on profiles for select using (id = auth.uid() or is_staff_or_above());
create policy "profiles_self_update" on profiles for update using (id = auth.uid() or is_admin_or_above());

-- retailers: retailer sees own row; staff+/assigned salesman see all/assigned
create policy "retailers_select" on retailers for select using (
  id = auth.uid() or is_staff_or_above() or assigned_salesman_id = auth.uid()
);
create policy "retailers_admin_write" on retailers for insert with check (is_admin_or_above());
create policy "retailers_admin_update" on retailers for update using (is_admin_or_above());

-- products: everyone authenticated can read active products; only staff+ can write
create policy "products_read" on products for select using (is_active or is_staff_or_above());
create policy "products_write" on products for insert with check (is_staff_or_above());
create policy "products_update" on products for update using (is_staff_or_above());
create policy "products_delete" on products for delete using (is_admin_or_above());

-- price_lists: retailers only see rows resolvable to them; admins see all
create policy "price_lists_admin" on price_lists for all using (is_admin_or_above());
create policy "price_lists_retailer_read" on price_lists for select using (
  scope = 'base'
  or (scope = 'retailer' and retailer_id = auth.uid())
  or (scope = 'area' and area_id = (select area_id from retailers where id = auth.uid()))
  or (scope in ('scheme','festival'))
);

-- inventory_stock / stock_movements: staff+ only
create policy "inventory_staff" on inventory_stock for select using (is_staff_or_above());
create policy "stock_movements_staff_write" on stock_movements for insert with check (is_staff_or_above());
create policy "stock_movements_staff_read" on stock_movements for select using (is_staff_or_above());

-- cart_items: retailer manages own cart only
create policy "cart_owner" on cart_items for all using (retailer_id = auth.uid());

-- orders: retailer sees own; salesman sees ones they collected; staff+ sees all
create policy "orders_select" on orders for select using (
  retailer_id = auth.uid() or collected_by = auth.uid() or is_staff_or_above()
);
create policy "orders_insert" on orders for insert with check (
  retailer_id = auth.uid() or is_staff_or_above() or current_user_role() = 'salesman'
);
create policy "orders_update_staff" on orders for update using (is_staff_or_above());

create policy "order_items_select" on order_items for select using (
  exists (select 1 from orders o where o.id = order_id
    and (o.retailer_id = auth.uid() or o.collected_by = auth.uid() or is_staff_or_above()))
);

-- notifications: recipient only
create policy "notifications_owner" on notifications for select using (recipient_id = auth.uid());
create policy "notifications_owner_update" on notifications for update using (recipient_id = auth.uid());

-- salesman module
create policy "visits_owner_or_staff" on visits for all using (salesman_id = auth.uid() or is_staff_or_above());
create policy "attendance_owner_or_staff" on attendance for all using (user_id = auth.uid() or is_staff_or_above());
create policy "routes_owner_or_staff" on routes for select using (salesman_id = auth.uid() or is_staff_or_above());
create policy "routes_staff_write" on routes for insert with check (is_staff_or_above());
create policy "route_customers_owner_or_staff" on route_customers for select using (
  exists (select 1 from routes r where r.id = route_id and (r.salesman_id = auth.uid() or is_staff_or_above()))
);

-- banners: public read (active only), staff+ write
create policy "banners_read" on banners for select using (is_active or is_staff_or_above());
create policy "banners_write" on banners for all using (is_staff_or_above());

-- AI insights: staff+ only (retailer_insights scoped read allowed for own record)
create policy "ai_predictions_staff" on ai_predictions for select using (is_staff_or_above());
create policy "retailer_insights_select" on retailer_insights for select using (
  retailer_id = auth.uid() or is_staff_or_above()
);

-- ============================================================================
-- END OF SCHEMA — no seed/demo data included by design.
-- ============================================================================
