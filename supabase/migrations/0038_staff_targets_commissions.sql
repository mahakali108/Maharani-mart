-- ============================================================================
-- 0038: Staff targets & commissions (Phase 2)
--
-- WHY
-- ---
-- Sales executives and staff had no targets, no incentive tracking and no
-- performance numbers beyond the super-admin Command Center. This adds the
-- two data tables; the admin UIs (/admin/targets, /admin/commissions) and
-- the self-service views (/salesman/targets, /salesman/commissions) read
-- and write them through these policies.
--
-- Design notes
-- ------------
-- * `staff_targets` — one row per (user, metric, period start). Periods are
--   explicit date ranges (month or quarter) so nothing has to agree on a
--   timezone; the app computes actuals from real orders / visits /
--   collections inside the same range. Target values are never fabricated:
--   attainment is only shown when real data exists in the window.
-- * `staff_commissions` — one row per (user, basis, period start). The
--   basis amount is snapshotted at computation time from real orders (and,
--   from Phase 4, verified payment collections), and the commission itself
--   is stored in integer paise like the wallet ledger — money is never a
--   float. Lifecycle: draft → approved → paid. No row is ever deleted;
--   corrections are new rows or status flips, and every change is audited.
-- * Rows are owned by a user but only ADMIN+ can create/edit them; the
--   owner gets read-only visibility. A target/commission can never be
--   edited by the person it is measured against.
-- ============================================================================

create table if not exists staff_targets (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id) on delete cascade,
  period_type text not null,
  period_start date not null,
  period_end date not null,
  metric text not null,
  target_value numeric(14,2) not null,
  is_active boolean not null default true,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_targets_period_type_check
    check (period_type in ('month', 'quarter')),
  constraint staff_targets_metric_check
    check (metric in ('sales_value', 'collection_value', 'order_count', 'visit_count', 'new_retailers')),
  constraint staff_targets_value_check
    check (target_value >= 0),
  constraint staff_targets_period_check
    check (period_end >= period_start),
  constraint staff_targets_unique
    unique (user_id, metric, period_start)
);

create index if not exists idx_staff_targets_user on staff_targets(user_id, is_active);
create index if not exists idx_staff_targets_period on staff_targets(period_start, period_end);

create table if not exists staff_commissions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  basis text not null,
  rate_percent numeric(5,2) not null,
  basis_amount_paise bigint not null default 0,
  computed_amount_paise bigint not null default 0,
  status text not null default 'draft',
  notes text,
  created_by uuid references profiles(id),
  approved_by uuid references profiles(id),
  approved_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_commissions_basis_check
    check (basis in ('sales_value', 'collection_value')),
  constraint staff_commissions_rate_check
    check (rate_percent >= 0 and rate_percent <= 100),
  constraint staff_commissions_amount_check
    check (basis_amount_paise >= 0 and computed_amount_paise >= 0),
  constraint staff_commissions_status_check
    check (status in ('draft', 'approved', 'paid')),
  constraint staff_commissions_period_check
    check (period_end >= period_start),
  constraint staff_commissions_unique
    unique (user_id, basis, period_start)
);

create index if not exists idx_staff_commissions_user on staff_commissions(user_id, status);
create index if not exists idx_staff_commissions_period on staff_commissions(period_start, period_end);

-- ----------------------------------------------------------------------------
-- RLS — admin+ manage, owner read-only, nobody deletes
-- ----------------------------------------------------------------------------

alter table staff_targets enable row level security;
alter table staff_commissions enable row level security;

drop policy if exists "staff_targets_admin_read" on staff_targets;
create policy "staff_targets_admin_read" on staff_targets
  for select using (is_admin_or_above() or user_id = auth.uid());

drop policy if exists "staff_targets_admin_insert" on staff_targets;
create policy "staff_targets_admin_insert" on staff_targets
  for insert with check (is_admin_or_above());

drop policy if exists "staff_targets_admin_update" on staff_targets;
create policy "staff_targets_admin_update" on staff_targets
  for update using (is_admin_or_above()) with check (is_admin_or_above());

drop policy if exists "staff_commissions_admin_read" on staff_commissions;
create policy "staff_commissions_admin_read" on staff_commissions
  for select using (is_admin_or_above() or user_id = auth.uid());

drop policy if exists "staff_commissions_admin_insert" on staff_commissions;
create policy "staff_commissions_admin_insert" on staff_commissions
  for insert with check (is_admin_or_above());

drop policy if exists "staff_commissions_admin_update" on staff_commissions;
create policy "staff_commissions_admin_update" on staff_commissions
  for update using (is_admin_or_above()) with check (is_admin_or_above());

-- ----------------------------------------------------------------------------
-- Audit — every target/commission change is recorded
-- ----------------------------------------------------------------------------

drop trigger if exists trg_audit_staff_targets on staff_targets;
create trigger trg_audit_staff_targets after insert or update or delete on staff_targets
  for each row execute function log_audit();

drop trigger if exists trg_audit_staff_commissions on staff_commissions;
create trigger trg_audit_staff_commissions after insert or update or delete on staff_commissions
  for each row execute function log_audit();

-- ============================================================================
-- END OF MIGRATION — no business data inserted.
-- ============================================================================
