-- ============================================================================
-- 0062: Seller Marketplace — seller identity, membership and review states.
--
-- WHAT THIS ADDS
--   * `sellers` — external marketplace seller business records with an
--     onboarding/review lifecycle (pending → active | rejected; active ↔
--     suspended). Distinct from Supplier Registration V1 (`suppliers`, 0059):
--     suppliers are upstream vendors (application-only), sellers are
--     downstream marketplace merchants who own offers and sub-orders. The two
--     models share no records, transitions or roles.
--   * `seller_members` — which app profiles may act for a seller (V1: one
--     profile maps to at most one seller). The `seller` role is added to
--     `user_role` here, but no login surface is exposed yet (owner decision
--     pending); RLS keys on membership regardless.
--   * `is_member_of_seller(uuid)` — SECURITY DEFINER membership helper used by
--     every seller-tenant RLS policy in 0063/0068.
--
-- REVIEW RULES (trigger `enforce_seller_status_transitions`)
--   * pending → active / rejected only, and every transition stamps
--     `reviewed_by = auth.uid()` with a fresh `reviewed_at` (same discipline as
--     0059 `enforce_supplier_review`), so a direct PostgREST call cannot forge
--     a reviewer or self-approve.
--   * active → suspended / suspended → active are admin review decisions with
--     mandatory reason columns (drain mode semantics live in 0068).
--   * `created_by` is immutable after insert.
--
-- RLS: admin-or-above manage; members read their own seller; nobody else reads
-- anything. Writes are never open to a seller for status/review columns (the
-- transition trigger re-checks every change).
--
-- SAFETY: additive & re-runnable. Like every migration in this repository this
-- file is applied only through a separately authorized process — it has NOT
-- been executed against any database.
-- ============================================================================

-- Seller role for future login surfaces. Must not be referenced later in this
-- same migration (Postgres restriction on brand-new enum values).
alter type public.user_role add value if not exists 'seller';

create table if not exists sellers (
  id uuid primary key default uuid_generate_v4(),
  business_name text not null check (char_length(btrim(business_name)) between 2 and 160),
  gstin text check (gstin is null or char_length(btrim(gstin)) <= 20),
  pan text check (pan is null or char_length(btrim(pan)) <= 12),
  contact_name text check (contact_name is null or char_length(btrim(contact_name)) between 2 and 120),
  phone text check (phone is null or char_length(btrim(phone)) <= 20),
  email text check (email is null or char_length(btrim(email)) <= 160),
  address_line text check (address_line is null or char_length(btrim(address_line)) <= 300),
  status text not null default 'pending'
    check (status in ('pending', 'active', 'rejected', 'suspended')),
  rejection_reason text check (rejection_reason is null or char_length(btrim(rejection_reason)) between 3 and 500),
  suspension_reason text check (suspension_reason is null or char_length(btrim(suspension_reason)) between 3 and 500),
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  suspended_by uuid references profiles(id),
  suspended_at timestamptz,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_sellers_status on sellers(status);
create unique index if not exists uq_sellers_business_name on sellers (lower(btrim(business_name)));

create table if not exists seller_members (
  id uuid primary key default uuid_generate_v4(),
  seller_id uuid not null references sellers(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  member_role text not null default 'member' check (member_role in ('owner', 'member')),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  unique (seller_id, profile_id)
);

-- One seller per user in V1: keeps tenant isolation unambiguous.
create unique index if not exists uq_seller_members_profile on seller_members (profile_id);

-- ---------------------------------------------------------------------------
-- Membership helper (used by RLS policies in 0063/0068).
-- ---------------------------------------------------------------------------
create or replace function public.is_member_of_seller(p_seller_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_seller_id is not null
    and exists (
      select 1 from public.seller_members sm
      where sm.seller_id = p_seller_id
        and sm.profile_id = auth.uid()
    );
$$;
revoke all on function public.is_member_of_seller(uuid) from public, anon;
grant execute on function public.is_member_of_seller(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Status transition guard (mirrors 0059's supplier review discipline).
-- ---------------------------------------------------------------------------
create or replace function public.enforce_seller_status_transitions()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  -- Same-status update: still guard immutable fields below, but no review stamp.
  if new.status is distinct from old.status then
    if not (
      (old.status = 'pending'   and new.status in ('active', 'rejected'))
      or (old.status = 'active'    and new.status = 'suspended')
      or (old.status = 'suspended' and new.status = 'active')
    ) then
      raise exception 'INVALID_SELLER_STATUS_TRANSITION: % -> %', old.status, new.status
        using errcode = 'check_violation';
    end if;

    if v_uid is null then
      raise exception 'A signed-in reviewer is required to change seller status.'
        using errcode = '42501';
    end if;

    if new.status in ('active', 'rejected') then
      new.reviewed_by := v_uid;
      new.reviewed_at := now();
    end if;
    if new.status = 'suspended' then
      if new.suspension_reason is null or char_length(btrim(new.suspension_reason)) < 3 then
        raise exception 'Suspension needs a reason of at least 3 characters.'
          using errcode = '22023';
      end if;
      new.suspended_by := v_uid;
      new.suspended_at := now();
    end if;
    if new.status = 'active' and old.status = 'suspended' then
      -- Reinstatement clears the suspension stamp but keeps history in audit.
      new.suspended_by := null;
      new.suspended_at := null;
      new.suspension_reason := null;
      new.reviewed_by := v_uid;
      new.reviewed_at := now();
    end if;
    if new.status = 'rejected' and (new.rejection_reason is null or char_length(btrim(new.rejection_reason)) < 3) then
      raise exception 'Rejection needs a reason of at least 3 characters.'
        using errcode = '22023';
    end if;
  end if;

  if new.created_by is distinct from old.created_by then
    raise exception 'The creator of a seller record cannot be changed.'
      using errcode = '42501';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_enforce_seller_status_transitions on sellers;
create trigger trg_enforce_seller_status_transitions
  before update on sellers
  for each row execute function public.enforce_seller_status_transitions();

drop trigger if exists trg_audit_sellers on sellers;
create trigger trg_audit_sellers
  after insert or update or delete on sellers
  for each row execute function log_audit();

drop trigger if exists trg_audit_seller_members on seller_members;
create trigger trg_audit_seller_members
  after insert or update or delete on seller_members
  for each row execute function log_audit();

-- ---------------------------------------------------------------------------
-- RLS + explicit grants (0054/0061 allowlist convention).
-- ---------------------------------------------------------------------------
alter table sellers enable row level security;
alter table seller_members enable row level security;

revoke all on sellers from anon, authenticated;
revoke all on seller_members from anon, authenticated;
grant select on sellers to authenticated;
grant select, insert, update, delete on sellers to authenticated;
grant select on seller_members to authenticated;
grant select, insert, delete on seller_members to authenticated;

drop policy if exists "sellers_select" on sellers;
create policy "sellers_select" on sellers
  for select using (is_admin_or_above() or public.is_member_of_seller(id));

drop policy if exists "sellers_admin_insert" on sellers;
create policy "sellers_admin_insert" on sellers
  for insert with check (is_admin_or_above());

drop policy if exists "sellers_admin_update" on sellers;
create policy "sellers_admin_update" on sellers
  for update using (is_admin_or_above()) with check (is_admin_or_above());

drop policy if exists "sellers_admin_delete" on sellers;
create policy "sellers_admin_delete" on sellers
  for delete using (is_admin_or_above());

drop policy if exists "seller_members_select" on seller_members;
create policy "seller_members_select" on seller_members
  for select using (is_admin_or_above() or profile_id = auth.uid());

drop policy if exists "seller_members_admin_insert" on seller_members;
create policy "seller_members_admin_insert" on seller_members
  for insert with check (is_admin_or_above());

drop policy if exists "seller_members_admin_delete" on seller_members;
create policy "seller_members_admin_delete" on seller_members
  for delete using (is_admin_or_above());

comment on table sellers is
  'Marketplace seller businesses (merchant of record for their own sub-orders). Distinct from upstream Supplier Registration V1 (suppliers, 0059).';
comment on table seller_members is
  'Profiles allowed to act for a seller tenant. V1: at most one seller per profile.';

-- ============================================================================
-- END OF MIGRATION — no business data inserted.
-- ============================================================================
