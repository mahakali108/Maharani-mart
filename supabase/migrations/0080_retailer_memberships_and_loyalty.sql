-- ============================================================================
-- 0080 — Retailer Memberships (Free, Silver, Gold) & Auditable Loyalty Points
--
-- Safely adds:
--   1. membership_plans: Configurable by Super Admin / Admin (Free, Silver, Gold).
--   2. retailer_memberships: Authoritative membership assignments & history.
--      Only Super Admin / Admin can grant or change paid memberships.
--      Membership benefits cease authoritatively at `expires_at`.
--   3. loyalty_ledger: Dedicated append-only loyalty points ledger separate
--      from the currency wallet/coins ledger. Immutable, server-validated,
--      idempotent via unique idempotency_key.
--   4. RLS & SECURITY DEFINER RPCs with strict role and ownership checks.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. MEMBERSHIP PLANS
-- ---------------------------------------------------------------------------
do $$ begin
  create type membership_tier as enum ('free', 'silver', 'gold');
exception when duplicate_object then null;
end $$;

create table if not exists public.membership_plans (
  id text primary key,                                   -- 'free', 'silver', 'gold'
  tier membership_tier not null unique,
  name text not null,
  description text,
  price_paise bigint not null default 0 check (price_paise >= 0),
  duration_days integer not null check (duration_days > 0),
  discount_percent numeric(5, 2) not null default 0 check (discount_percent >= 0 and discount_percent <= 100),
  points_multiplier numeric(4, 2) not null default 1.0 check (points_multiplier >= 1.0),
  features jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.membership_plans is 'Configurable retailer membership plans (Free, Silver, Gold) managed by Admins.';

-- Default baseline plans
insert into public.membership_plans (id, tier, name, description, price_paise, duration_days, discount_percent, points_multiplier, features, is_active)
values
  ('free', 'free', 'Free Tier', 'Standard B2B membership with wholesale catalog access', 0, 36500, 0.00, 1.00, '["Standard wholesale catalog pricing", "1x Loyalty Points", "Standard dispatch"]'::jsonb, true),
  ('silver', 'silver', 'Silver Club', 'Exclusive discounts and accelerated loyalty points', 49900, 30, 2.00, 1.50, '["2% extra order discount", "1.5x Loyalty Points", "Priority dispatch queue"]'::jsonb, true),
  ('gold', 'gold', 'Gold VIP', 'Highest wholesale savings, double loyalty points and VIP support', 99900, 30, 5.00, 2.00, '["5% extra order discount", "2x Loyalty Points", "VIP priority support & expedited dispatch"]'::jsonb, true)
on conflict (id) do nothing;

alter table public.membership_plans enable row level security;

-- Read: Authenticated users can view active membership plans
drop policy if exists "membership_plans_read" on public.membership_plans;
create policy "membership_plans_read" on public.membership_plans
  for select to authenticated
  using (is_active = true or is_admin_or_above());

-- Write: Super Admin & Admin only
drop policy if exists "membership_plans_admin_insert" on public.membership_plans;
create policy "membership_plans_admin_insert" on public.membership_plans
  for insert with check (is_admin_or_above());

drop policy if exists "membership_plans_admin_update" on public.membership_plans;
create policy "membership_plans_admin_update" on public.membership_plans
  for update using (is_admin_or_above());

-- ---------------------------------------------------------------------------
-- 2. RETAILER MEMBERSHIPS (Assignments & History)
-- ---------------------------------------------------------------------------
do $$ begin
  create type membership_status as enum ('active', 'pending_payment', 'expired', 'cancelled');
exception when duplicate_object then null;
end $$;

create table if not exists public.retailer_memberships (
  id uuid primary key default uuid_generate_v4(),
  retailer_id uuid not null references public.retailers(id) on delete cascade,
  plan_id text not null references public.membership_plans(id),
  tier membership_tier not null,
  status membership_status not null default 'active',
  starts_at timestamptz not null default now(),
  expires_at timestamptz,                                 -- null for perpetual free tier
  amount_paid_paise bigint not null default 0 check (amount_paid_paise >= 0),
  payment_reference text,
  notes text,
  activated_by uuid references public.profiles(id),       -- Admin/Super Admin who activated
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.retailer_memberships is 'Retailer membership subscriptions and historical records.';

create index if not exists idx_retailer_memberships_retailer on public.retailer_memberships(retailer_id, status);
create index if not exists idx_retailer_memberships_expiry on public.retailer_memberships(expires_at) where status = 'active';

alter table public.retailer_memberships enable row level security;

-- Retailers can view their own membership rows; Admins see all
drop policy if exists "retailer_memberships_read" on public.retailer_memberships;
create policy "retailer_memberships_read" on public.retailer_memberships
  for select to authenticated
  using (retailer_id = auth.uid() or is_admin_or_above());

-- Direct mutation is restricted to Admins only
drop policy if exists "retailer_memberships_admin_insert" on public.retailer_memberships;
create policy "retailer_memberships_admin_insert" on public.retailer_memberships
  for insert with check (is_admin_or_above());

drop policy if exists "retailer_memberships_admin_update" on public.retailer_memberships;
create policy "retailer_memberships_admin_update" on public.retailer_memberships
  for update using (is_admin_or_above());

-- Helper: Get active membership for a retailer (Authoritative Server Time)
create or replace function public.get_active_retailer_membership(p_retailer_id uuid)
returns table (
  membership_id uuid,
  plan_id text,
  tier membership_tier,
  status membership_status,
  starts_at timestamptz,
  expires_at timestamptz,
  discount_percent numeric(5, 2),
  points_multiplier numeric(4, 2)
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Access check: caller must be retailer themselves or admin
  if auth.uid() <> p_retailer_id and not is_admin_or_above() then
    raise exception 'Access denied: cannot inspect membership for retailer %', p_retailer_id using errcode = '42501';
  end if;

  return query
  select
    rm.id as membership_id,
    rm.plan_id,
    rm.tier,
    rm.status,
    rm.starts_at,
    rm.expires_at,
    mp.discount_percent,
    mp.points_multiplier
  from public.retailer_memberships rm
  join public.membership_plans mp on mp.id = rm.plan_id
  where rm.retailer_id = p_retailer_id
    and rm.status = 'active'
    and (rm.expires_at is null or rm.expires_at > now())
  order by
    case rm.tier
      when 'gold' then 3
      when 'silver' then 2
      else 1
    end desc,
    rm.created_at desc
  limit 1;
end;
$$;

revoke all on function public.get_active_retailer_membership(uuid) from public, anon;
grant execute on function public.get_active_retailer_membership(uuid) to authenticated;

-- Admin RPC: Safe idempotent plan assignment / upgrade / renewal
create or replace function public.admin_set_retailer_membership(
  p_retailer_id uuid,
  p_plan_id text,
  p_notes text default null,
  p_payment_ref text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan public.membership_plans%rowtype;
  v_membership_id uuid;
  v_expires_at timestamptz;
begin
  if not is_admin_or_above() then
    raise exception 'Access denied: Super Admin or Admin authorization required.' using errcode = '42501';
  end if;

  select * into v_plan from public.membership_plans where id = p_plan_id;
  if not found then
    raise exception 'Membership plan % not found.', p_plan_id using errcode = '22023';
  end if;

  if v_plan.tier = 'free' then
    v_expires_at := null;
  else
    v_expires_at := now() + (v_plan.duration_days || ' days')::interval;
  end if;

  -- Mark prior active memberships as superseded / cancelled
  update public.retailer_memberships
  set status = 'cancelled',
      updated_at = now()
  where retailer_id = p_retailer_id and status = 'active';

  insert into public.retailer_memberships (
    retailer_id,
    plan_id,
    tier,
    status,
    starts_at,
    expires_at,
    amount_paid_paise,
    payment_reference,
    notes,
    activated_by
  ) values (
    p_retailer_id,
    v_plan.id,
    v_plan.tier,
    'active',
    now(),
    v_expires_at,
    v_plan.price_paise,
    p_payment_ref,
    p_notes,
    auth.uid()
  ) returning id into v_membership_id;

  return v_membership_id;
end;
$$;

revoke all on function public.admin_set_retailer_membership(uuid, text, text, text) from public, anon;
grant execute on function public.admin_set_retailer_membership(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. AUDITABLE LOYALTY POINTS LEDGER
-- ---------------------------------------------------------------------------
create table if not exists public.loyalty_ledger (
  id uuid primary key default uuid_generate_v4(),
  retailer_id uuid not null references public.retailers(id) on delete cascade,
  points integer not null check (points <> 0),           -- positive for credit/earn, negative for debit/reversal
  entry_type text not null check (entry_type in (
    'ORDER_EARN',
    'ORDER_REVERSAL',
    'REDEMPTION',
    'MANUAL_CREDIT',
    'MANUAL_DEBIT',
    'EXPIRY'
  )),
  reference_type text,                                    -- 'order', 'manual'
  reference_id uuid,
  reason text not null,
  idempotency_key text unique,                           -- Enforces exactly-once point award/reversal
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

comment on table public.loyalty_ledger is 'Immutable, append-only loyalty points ledger for retailers. Net points = sum(points).';

create index if not exists idx_loyalty_ledger_retailer on public.loyalty_ledger(retailer_id, created_at desc);
create index if not exists idx_loyalty_ledger_reference on public.loyalty_ledger(reference_type, reference_id);

alter table public.loyalty_ledger enable row level security;

-- Retailers see own points; Admins see all
drop policy if exists "loyalty_ledger_read" on public.loyalty_ledger;
create policy "loyalty_ledger_read" on public.loyalty_ledger
  for select to authenticated
  using (retailer_id = auth.uid() or is_admin_or_above());

-- No direct client inserts/updates/deletes on loyalty ledger
revoke all on public.loyalty_ledger from anon, authenticated;
grant select on public.loyalty_ledger to authenticated;

-- Helper: Get authoritative retailer loyalty points balance
create or replace function public.get_retailer_loyalty_balance(p_retailer_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_balance integer;
begin
  if auth.uid() <> p_retailer_id and not is_admin_or_above() then
    raise exception 'Access denied: cannot check loyalty points for retailer %', p_retailer_id using errcode = '42501';
  end if;

  select coalesce(sum(points), 0)::integer into v_balance
  from public.loyalty_ledger
  where retailer_id = p_retailer_id;

  return greatest(0, v_balance);
end;
$$;

revoke all on function public.get_retailer_loyalty_balance(uuid) from public, anon;
grant execute on function public.get_retailer_loyalty_balance(uuid) to authenticated;

-- RPC: Record loyalty points transaction (with idempotency check)
create or replace function public.record_loyalty_points(
  p_retailer_id uuid,
  p_points integer,
  p_entry_type text,
  p_reason text,
  p_reference_type text default null,
  p_reference_id uuid default null,
  p_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entry_id uuid;
  v_current_balance integer;
begin
  if not is_admin_or_above() then
    raise exception 'Access denied: Super Admin or Admin authorization required to write loyalty points.' using errcode = '42501';
  end if;

  if p_points = 0 then
    raise exception 'Points cannot be zero.' using errcode = '22023';
  end if;

  -- Idempotency check: if key already exists, return existing row id safely
  if p_idempotency_key is not null then
    select id into v_entry_id from public.loyalty_ledger where idempotency_key = p_idempotency_key;
    if v_entry_id is not null then
      return v_entry_id;
    end if;
  end if;

  -- Row-lock retailer account row to serialize concurrent debits/mutations
  perform id from public.retailers where id = p_retailer_id for update;

  -- Prevent negative balance on debit
  if p_points < 0 then
    select coalesce(sum(points), 0)::integer into v_current_balance
    from public.loyalty_ledger
    where retailer_id = p_retailer_id;

    if v_current_balance + p_points < 0 then
      raise exception 'INSUFFICIENT_LOYALTY_POINTS: Balance (%) cannot cover deduction (%).', v_current_balance, abs(p_points) using errcode = '22023';
    end if;
  end if;

  insert into public.loyalty_ledger (
    retailer_id,
    points,
    entry_type,
    reason,
    reference_type,
    reference_id,
    idempotency_key,
    created_by
  ) values (
    p_retailer_id,
    p_points,
    p_entry_type,
    p_reason,
    p_reference_type,
    p_reference_id,
    p_idempotency_key,
    auth.uid()
  ) returning id into v_entry_id;

  return v_entry_id;
end;
$$;

revoke all on function public.record_loyalty_points(uuid, integer, text, text, text, uuid, text) from public, anon;
grant execute on function public.record_loyalty_points(uuid, integer, text, text, text, uuid, text) to authenticated;
