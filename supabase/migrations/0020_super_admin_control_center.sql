-- ============================================================================
-- Super Admin Master Control Center
-- Adds: platform_features, user_feature_overrides, user_access_periods,
--       platform_settings, super_admin_audit_logs
-- All tables use UUIDs, timestamps, RLS. Never weakens existing RLS.
-- ============================================================================

-- 1. ENUMS -------------------------------------------------------------------

create type access_status as enum ('active','expiring_soon','expired','suspended','unlimited');
create type feature_target_type as enum ('global','role','user');
create type maintenance_scope as enum ('entire_platform','retailer','salesman','admin','staff','warehouse');

-- 2. PLATFORM FEATURES -------------------------------------------------------

create table platform_features (
  id uuid primary key default uuid_generate_v4(),
  key text not null unique,                     -- e.g. 'retailer_marketplace', 'ai', 'reports'
  name text not null,
  description text,
  icon text,                                    -- lucide icon name
  route text,                                   -- e.g. '/retailer/catalog'
  is_enabled boolean not null default true,
  is_implemented boolean not null default true,  -- false = "Not Implemented" badge
  target_type feature_target_type not null default 'global',
  target_roles user_role[] default null,         -- when target_type = 'role'
  target_user_id uuid references profiles(id),   -- when target_type = 'user'
  expires_at timestamptz,                        -- feature-level expiry
  sort_order int not null default 0,
  created_by uuid references profiles(id),
  updated_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_platform_features_key on platform_features(key);
create index idx_platform_features_enabled on platform_features(is_enabled);

-- 3. USER FEATURE OVERRIDES --------------------------------------------------

create table user_feature_overrides (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id) on delete cascade,
  feature_key text not null,                     -- references platform_features.key
  is_enabled boolean not null,
  expires_at timestamptz,
  reason text,
  created_by uuid references profiles(id),
  updated_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, feature_key)
);

create index idx_user_feature_overrides_user on user_feature_overrides(user_id);
create index idx_user_feature_overrides_feature on user_feature_overrides(feature_key);

-- 4. USER ACCESS PERIODS -----------------------------------------------------

create table user_access_periods (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id) on delete cascade,
  role user_role not null,
  status access_status not null default 'active',
  started_at timestamptz not null default now(),
  expires_at timestamptz,                        -- null = unlimited
  created_by uuid references profiles(id),
  updated_by uuid references profiles(id),
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_user_access_periods_user on user_access_periods(user_id);
create index idx_user_access_periods_status on user_access_periods(status);
create index idx_user_access_periods_expires on user_access_periods(expires_at);

-- 5. PLATFORM SETTINGS -------------------------------------------------------

create table platform_settings (
  id uuid primary key default uuid_generate_v4(),
  key text not null unique,
  value jsonb not null,
  description text,
  updated_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 6. SUPER ADMIN AUDIT LOG ---------------------------------------------------

create table super_admin_audit_logs (
  id uuid primary key default uuid_generate_v4(),
  actor_id uuid not null references profiles(id),
  target_id uuid references profiles(id),
  action text not null,                          -- e.g. 'USER_ACCESS_GRANTED', 'FEATURE_ENABLED'
  before_data jsonb,
  after_data jsonb,
  reason text,
  ip_address text,
  created_at timestamptz not null default now()
);

create index idx_sa_audit_actor on super_admin_audit_logs(actor_id);
create index idx_sa_audit_target on super_admin_audit_logs(target_id);
create index idx_sa_audit_action on super_admin_audit_logs(action);
create index idx_sa_audit_created on super_admin_audit_logs(created_at);

-- 7. HELPER FUNCTIONS --------------------------------------------------------

-- Check if a user's access is currently valid
create or replace function is_user_access_valid(p_user_id uuid)
returns boolean as $$
declare
  v_status access_status;
  v_expires timestamptz;
  v_role user_role;
begin
  -- Super Admin always has unlimited access
  select role into v_role from profiles where id = p_user_id;
  if v_role = 'super_admin' then return true; end if;

  -- Check for an active/unlimited access period
  select status, expires_at into v_status, v_expires
  from user_access_periods
  where user_id = p_user_id
    and status in ('active', 'expiring_soon', 'unlimited')
  order by created_at desc
  limit 1;

  if v_status is null then return true; end if; -- no access record = allow (backward compat)
  if v_status = 'unlimited' then return true; end if;
  if v_expires is null then return true; end if;
  if v_expires > now() then return true; end if;

  return false;
end;
$$ language plpgsql stable security definer;

-- Get the active access period for a user
create or replace function get_active_access(p_user_id uuid)
returns table(status access_status, started_at timestamptz, expires_at timestamptz) as $$
begin
  return query
  select uap.status, uap.started_at, uap.expires_at
  from user_access_periods uap
  where uap.user_id = p_user_id
    and uap.status in ('active', 'expiring_soon', 'unlimited')
  order by uap.created_at desc
  limit 1;
end;
$$ language plpgsql stable security definer;

-- Check if a feature is enabled for a user (considers global + overrides + expiry)
create or replace function is_feature_enabled_for_user(p_user_id uuid, p_feature_key text)
returns boolean as $$
declare
  v_role user_role;
  v_global_enabled boolean;
  v_global_implemented boolean;
  v_global_expires timestamptz;
  v_global_target feature_target_type;
  v_global_roles user_role[];
  v_global_target_user uuid;
  v_override_enabled boolean;
  v_override_expires timestamptz;
begin
  -- Super Admin always has access to all features
  select role into v_role from profiles where id = p_user_id;
  if v_role = 'super_admin' then return true; end if;

  -- Check global feature
  select is_enabled, is_implemented, expires_at, target_type, target_roles, target_user_id
  into v_global_enabled, v_global_implemented, v_global_expires, v_global_target, v_global_roles, v_global_target_user
  from platform_features
  where key = p_feature_key;

  if v_global_enabled is null then return false; end if; -- feature doesn't exist
  if not v_global_enabled then return false; end if;
  if not v_global_implemented then return false; end if;
  if v_global_expires is not null and v_global_expires < now() then return false; end if;

  -- Check target restrictions
  if v_global_target = 'user' and v_global_target_user != p_user_id then return false; end if;
  if v_global_target = 'role' and v_global_roles is not null and not (v_role = any(v_global_roles)) then return false; end if;

  -- Check user override
  select is_enabled, expires_at
  into v_override_enabled, v_override_expires
  from user_feature_overrides
  where user_id = p_user_id and feature_key = p_feature_key;

  if v_override_enabled is not null then
    if v_override_expires is not null and v_override_expires < now() then return true; end if; -- override expired, fall back to global
    return v_override_enabled;
  end if;

  return true;
end;
$$ language plpgsql stable security definer;

-- 8. RLS POLICIES ------------------------------------------------------------

alter table platform_features enable row level security;
alter table user_feature_overrides enable row level security;
alter table user_access_periods enable row level security;
alter table platform_settings enable row level security;
alter table super_admin_audit_logs enable row level security;

-- platform_features: everyone can read enabled features; super_admin can manage all
create policy "platform_features_read" on platform_features for select using (true);
create policy "platform_features_admin_all" on platform_features for all using (
  current_user_role() = 'super_admin'
);

-- user_feature_overrides: super_admin only
create policy "user_feature_overrides_admin_all" on user_feature_overrides for all using (
  current_user_role() = 'super_admin'
);

-- user_access_periods: super_admin only
create policy "user_access_periods_admin_all" on user_access_periods for all using (
  current_user_role() = 'super_admin'
);

-- platform_settings: super_admin only
create policy "platform_settings_admin_all" on platform_settings for all using (
  current_user_role() = 'super_admin'
);

-- super_admin_audit_logs: super_admin can read; insert via security definer function
create policy "super_admin_audit_logs_read" on super_admin_audit_logs for select using (
  current_user_role() = 'super_admin'
);
create policy "super_admin_audit_logs_insert" on super_admin_audit_logs for insert with check (
  current_user_role() = 'super_admin'
);

-- 9. SEED DEFAULT FEATURES ---------------------------------------------------

insert into platform_features (key, name, description, icon, route, is_enabled, is_implemented, sort_order) values
  ('retailer_marketplace', 'Retailer Marketplace', 'Product catalog and ordering for retailers', 'Store', '/retailer/home', true, true, 1),
  ('catalog', 'Catalog', 'Product catalog browsing', 'BookOpen', '/retailer/catalog', true, true, 2),
  ('brands', 'Brands', 'Brand directory', 'Award', '/retailer/brands', true, true, 3),
  ('schemes', 'Schemes & Offers', 'Promotional schemes and offers', 'Gift', '/retailer/schemes', true, true, 4),
  ('cart', 'Shopping Cart', 'Cart management', 'ShoppingCart', '/retailer/cart', true, true, 5),
  ('orders', 'Orders', 'Order management', 'Package', '/admin/orders', true, true, 6),
  ('quick_order', 'Quick Order', 'Fast reorder interface', 'Zap', '/retailer/quick-order', true, true, 7),
  ('wallet_credit', 'Wallet/Credit', 'Credit management and wallet', 'Wallet', null, true, false, 8),
  ('favourites', 'Favourites', 'Saved favourite products', 'Heart', '/retailer/favorites', true, true, 9),
  ('notifications', 'Notifications', 'In-app notifications', 'Bell', '/admin/notifications', true, true, 10),
  ('salesman_app', 'Salesman App', 'Salesman mobile application', 'Users', '/salesman/dashboard', true, true, 11),
  ('warehouse', 'Warehouse', 'Warehouse management', 'Warehouse', '/admin/warehouses', true, true, 12),
  ('inventory', 'Inventory', 'Inventory management', 'Boxes', '/admin/inventory', true, true, 13),
  ('grn', 'GRN', 'Goods Receipt Notes', 'ClipboardCheck', '/admin/inventory/grn', true, true, 14),
  ('fefo', 'FEFO', 'First Expiry First Out management', 'Clock', '/admin/inventory/expiry', true, true, 15),
  ('stock_transfer', 'Stock Transfer', 'Inter-warehouse stock transfers', 'ArrowLeftRight', '/admin/inventory/transfers', true, true, 16),
  ('ai', 'Maharani AI', 'AI-powered business copilot', 'Sparkles', '/admin/ai', true, true, 17),
  ('reports', 'Reports', 'Business reports and analytics', 'BarChart3', '/admin/reports', true, true, 18),
  ('analytics', 'Analytics', 'Advanced analytics dashboard', 'TrendingUp', null, true, false, 19),
  ('command_center', 'Command Center', 'Super Admin command center', 'Gauge', '/admin/command-center', true, true, 20),
  ('gst_invoice', 'GST Invoice', 'GST invoice generation', 'FileText', null, true, false, 21),
  ('customer_management', 'Customer Management', 'Customer relationship management', 'UserCog', '/admin/retailers', true, true, 22),
  ('control_center', 'Control Center', 'Super Admin master control center', 'Settings', '/admin/control-center', true, true, 23)
on conflict (key) do nothing;

-- 10. SEED DEFAULT PLATFORM SETTINGS -----------------------------------------

insert into platform_settings (key, value, description) values
  ('maintenance_mode', '{"enabled": false, "scope": "entire_platform", "message": "Platform is under maintenance. Please try again later."}', 'Maintenance mode configuration'),
  ('default_trial_days', '7', 'Default trial period in days for new users'),
  ('platform_name', '"Maharani Traders"', 'Platform display name'),
  ('support_contact', '"support@maharanitraders.com"', 'Support contact email')
on conflict (key) do nothing;

-- ============================================================================
-- END
-- ============================================================================
