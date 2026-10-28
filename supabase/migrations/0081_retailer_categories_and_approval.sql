-- ============================================================================
-- 0081 — Retailer pricing categories + secure approval workflow
--
-- REPLACES the paid-membership concept: a retailer's pricing category is a
-- CLASSIFICATION assigned by an administrator after review, never a purchase.
--
-- Adds
--   1. retailer_category enum ('general','silver','gold') and
--      retailers.retailer_category (default 'general' — Gold is never implied).
--   2. retailer_applications — one reviewable record per retailer, with the
--      submitted snapshot, workflow status (pending/approved/rejected/
--      suspended), the SLA target captured at submission, and the decision.
--   3. retailer_approval_events — append-only audit trail (actor, timestamp,
--      previous/new status, previous/new category, reason).
--   4. retailer_approval_settings — Owner/Super-Admin configurable review
--      target and reminder interval. There is no invented legal deadline:
--      the value is a business SLA and starts at 48 hours.
--   5. SECURITY DEFINER RPCs: admin_review_retailer_application,
--      admin_set_retailer_category, admin_set_retailer_access,
--      admin_update_approval_settings, retailer_resubmit_application.
--   6. Guard triggers so a retailer cannot self-approve, change their own
--      category, or flip their own status even if an application bug tried to
--      (RLS already denies self-update of `retailers`; this is depth 2).
--
-- DELIBERATELY NOT CHANGED
--   * retailers.status (enum pending_approval/active/suspended) stays the
--     single ACCESS gate that middleware, RLS and checkout already use, so no
--     existing workflow changes behaviour. A "rejected" application is stored
--     in retailer_applications.status='rejected' while the access gate stays
--     'pending_approval' (rejected = not admitted). Suspension sets both the
--     application row and the access gate to suspended.
--   * No table, column, row or policy from 0001–0080 is dropped.
--   * No historical membership/loyalty row is modified.
--
-- Nothing here is applied to any Supabase project by this repository change.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Category classification
-- ---------------------------------------------------------------------------
do $$ begin
  create type retailer_category as enum ('general', 'silver', 'gold');
exception when duplicate_object then null;
end $$;

alter table public.retailers
  add column if not exists retailer_category retailer_category not null default 'general';

comment on column public.retailers.retailer_category is
  'Retailer pricing classification (general = highest standard wholesale price, silver = medium, gold = lowest approved wholesale price). Assigned ONLY by an admin through admin_set_retailer_category / admin_review_retailer_application. Not a paid subscription, never auto-granted, and not self-editable.';

-- ---------------------------------------------------------------------------
-- 2. Approval settings (single row). Owner/Super-Admin configurable SLA.
-- ---------------------------------------------------------------------------
create table if not exists public.retailer_approval_settings (
  id boolean primary key default true check (id),
  review_target_hours int not null default 48 check (review_target_hours between 1 and 720),
  reminder_hours int not null default 12 check (reminder_hours between 1 and 720),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

comment on table public.retailer_approval_settings is
  'Business SLA for retailer application review. Configurable by Super Admin; this is NOT a legally mandated approval time.';

insert into public.retailer_approval_settings (id) values (true) on conflict (id) do nothing;

alter table public.retailer_approval_settings enable row level security;

drop policy if exists "retailer_approval_settings_staff_read" on public.retailer_approval_settings;
create policy "retailer_approval_settings_staff_read" on public.retailer_approval_settings
  for select to authenticated
  using (is_staff_or_above());

-- Writes only through admin_update_approval_settings (SECURITY DEFINER).
revoke insert, update, delete on public.retailer_approval_settings from anon, authenticated;
revoke all on public.retailer_approval_settings from anon;

-- ---------------------------------------------------------------------------
-- 3. Applications
-- ---------------------------------------------------------------------------
create table if not exists public.retailer_applications (
  id uuid primary key default uuid_generate_v4(),
  retailer_id uuid not null unique references public.retailers(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'suspended')),
  shop_name text not null,
  gstin text,
  address text,
  area_id uuid references public.areas(id),
  submitted_at timestamptz not null default now(),
  review_target_hours int not null default 48 check (review_target_hours between 1 and 720),
  decided_at timestamptz,
  decided_by uuid references public.profiles(id),
  decision_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.retailer_applications is
  'One review record per retailer. status is the workflow state; retailers.status remains the access gate. Submitted details are the applicant-supplied snapshot at submission time — nothing here asserts that a GSTIN, business or identity was verified.';

create index if not exists idx_retailer_applications_status_submitted
  on public.retailer_applications(status, submitted_at);

alter table public.retailer_applications enable row level security;

drop policy if exists "retailer_applications_owner_or_staff_read" on public.retailer_applications;
create policy "retailer_applications_owner_or_staff_read" on public.retailer_applications
  for select to authenticated
  using (retailer_id = auth.uid() or is_staff_or_above());

-- No client INSERT/UPDATE/DELETE policies: all writes go through the
-- SECURITY DEFINER RPCs below (which record the actor and enforce roles).
revoke insert, update, delete on public.retailer_applications from anon, authenticated;
revoke all on public.retailer_applications from anon;

-- ---------------------------------------------------------------------------
-- 4. Append-only approval / category audit trail
-- ---------------------------------------------------------------------------
create table if not exists public.retailer_approval_events (
  id uuid primary key default uuid_generate_v4(),
  retailer_id uuid not null references public.retailers(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  action text not null check (action in (
    'submitted', 'resubmitted', 'approved', 'rejected', 'suspended', 'restored', 'category_changed'
  )),
  previous_status text,
  new_status text,
  previous_category text,
  new_category text,
  reason text,
  created_at timestamptz not null default now()
);

comment on table public.retailer_approval_events is
  'Immutable audit trail for retailer approval, suspension, restoration and category changes: who acted, when, the previous and new values, and why.';

create index if not exists idx_retailer_approval_events_retailer
  on public.retailer_approval_events(retailer_id, created_at desc);

alter table public.retailer_approval_events enable row level security;

drop policy if exists "retailer_approval_events_read" on public.retailer_approval_events;
create policy "retailer_approval_events_read" on public.retailer_approval_events
  for select to authenticated
  using (retailer_id = auth.uid() or is_staff_or_above());

revoke insert, update, delete on public.retailer_approval_events from anon, authenticated;
revoke all on public.retailer_approval_events from anon;

-- Even a role that somehow obtains an UPDATE grant cannot rewrite history.
create or replace function public.retailer_approval_events_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'retailer_approval_events is an append-only audit trail.' using errcode = '42501';
end;
$$;

drop trigger if exists trg_retailer_approval_events_immutable on public.retailer_approval_events;
create trigger trg_retailer_approval_events_immutable
  before update or delete on public.retailer_approval_events
  for each row execute function public.retailer_approval_events_immutable();

revoke all on function public.retailer_approval_events_immutable() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Backfill + automatic application creation for new signups
-- ---------------------------------------------------------------------------
insert into public.retailer_applications (retailer_id, status, shop_name, gstin, address, area_id, submitted_at, review_target_hours)
select
  r.id,
  case r.status
    when 'active' then 'approved'
    when 'suspended' then 'suspended'
    else 'pending'
  end,
  r.shop_name,
  r.gstin,
  r.address,
  r.area_id,
  coalesce(r.created_at, now()),
  coalesce((select review_target_hours from public.retailer_approval_settings limit 1), 48)
from public.retailers r
on conflict (retailer_id) do nothing;

create or replace function public.ensure_retailer_application()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.retailer_applications
    (retailer_id, status, shop_name, gstin, address, area_id, submitted_at, review_target_hours)
  values
    (new.id,
     case new.status when 'active' then 'approved' when 'suspended' then 'suspended' else 'pending' end,
     new.shop_name,
     new.gstin,
     new.address,
     new.area_id,
     coalesce(new.created_at, now()),
     coalesce((select review_target_hours from public.retailer_approval_settings limit 1), 48))
  on conflict (retailer_id) do nothing;

  -- While an application is still pending, its submitted snapshot mirrors the
  -- retailer's current details (registration may fill them in a second write).
  -- Decided applications are never rewritten — their snapshot is evidence.
  if tg_op = 'UPDATE' then
    update public.retailer_applications
       set shop_name = new.shop_name,
           gstin = new.gstin,
           address = new.address,
           area_id = new.area_id,
           updated_at = now()
     where retailer_id = new.id and status = 'pending';
  end if;
  return new;
end;
$$;

revoke all on function public.ensure_retailer_application() from public, anon, authenticated;

drop trigger if exists trg_ensure_retailer_application on public.retailers;
create trigger trg_ensure_retailer_application
  after insert or update of shop_name, gstin, address, area_id on public.retailers
  for each row execute function public.ensure_retailer_application();

-- ---------------------------------------------------------------------------
-- 6. Depth-2 guard: category and access status can only move for an admin
--    (or the function owner inside a sanctioned SECURITY DEFINER RPC).
-- ---------------------------------------------------------------------------
create or replace function public.guard_retailer_sensitive_columns()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('postgres', 'supabase_admin') then
    return new;
  end if;
  if new.retailer_category is distinct from old.retailer_category and not is_admin_or_above() then
    raise exception 'retailer_category can only be changed by an administrator.' using errcode = '42501';
  end if;
  if new.status is distinct from old.status and not is_admin_or_above() then
    raise exception 'retailer status can only be changed by an administrator.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_retailer_sensitive_columns() from public, anon, authenticated;

drop trigger if exists trg_guard_retailer_sensitive_columns on public.retailers;
create trigger trg_guard_retailer_sensitive_columns
  before update on public.retailers
  for each row execute function public.guard_retailer_sensitive_columns();

-- ---------------------------------------------------------------------------
-- 7. RPCs
-- ---------------------------------------------------------------------------

-- Super Admin / Admin: configure the review SLA.
create or replace function public.admin_update_approval_settings(
  p_review_target_hours int,
  p_reminder_hours int
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.retailer_approval_settings%rowtype;
begin
  if not is_admin_or_above() then
    raise exception 'Access denied: administrator authorization required.' using errcode = '42501';
  end if;
  if p_review_target_hours is null or p_review_target_hours < 1 or p_review_target_hours > 720 then
    raise exception 'Review target must be between 1 and 720 hours.' using errcode = '22023';
  end if;
  if p_reminder_hours is null or p_reminder_hours < 1 or p_reminder_hours > 720 then
    raise exception 'Reminder interval must be between 1 and 720 hours.' using errcode = '22023';
  end if;

  insert into public.retailer_approval_settings (id, review_target_hours, reminder_hours, updated_by, updated_at)
  values (true, p_review_target_hours, p_reminder_hours, auth.uid(), now())
  on conflict (id) do update
    set review_target_hours = excluded.review_target_hours,
        reminder_hours = excluded.reminder_hours,
        updated_by = excluded.updated_by,
        updated_at = now()
  returning * into v_row;

  return jsonb_build_object(
    'review_target_hours', v_row.review_target_hours,
    'reminder_hours', v_row.reminder_hours,
    'updated_at', v_row.updated_at
  );
end;
$$;

revoke all on function public.admin_update_approval_settings(int, int) from public, anon;
grant execute on function public.admin_update_approval_settings(int, int) to authenticated;

-- Super Admin / Admin: approve or reject an application.
create or replace function public.admin_review_retailer_application(
  p_retailer_id uuid,
  p_decision text,
  p_reason text,
  p_category text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_app public.retailer_applications%rowtype;
  v_retailer public.retailers%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_category public.retailer_category;
  v_new_app_status text;
  v_new_access public.retailer_status;
begin
  if not is_admin_or_above() then
    raise exception 'Access denied: administrator authorization required.' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected.' using errcode = '22023';
  end if;
  if v_reason is null or char_length(v_reason) < 3 then
    raise exception 'A reason of at least 3 characters is required for every review decision.' using errcode = '22023';
  end if;

  select * into v_app from public.retailer_applications where retailer_id = p_retailer_id for update;
  if not found then
    raise exception 'No retailer application found for that retailer.' using errcode = '22023';
  end if;
  select * into v_retailer from public.retailers where id = p_retailer_id for update;
  if not found then
    raise exception 'Retailer not found.' using errcode = '22023';
  end if;

  if p_category is not null then
    if p_category not in ('general', 'silver', 'gold') then
      raise exception 'Unknown retailer category.' using errcode = '22023';
    end if;
    v_category := p_category::public.retailer_category;
  end if;

  if p_decision = 'approved' then
    v_new_app_status := 'approved';
    v_new_access := 'active';
    v_category := coalesce(v_category, v_retailer.retailer_category, 'general');
    if v_category = 'gold' then
      -- Gold is never granted implicitly or automatically: the reviewer must
      -- record an explicit reason (already required above) and ask for Gold.
      if p_category is null then
        raise exception 'Gold must be assigned explicitly, not as a side effect of approval.' using errcode = '22023';
      end if;
    end if;
  else
    v_new_app_status := 'rejected';
    -- Access gate has no 'rejected' value by design: a rejected applicant is
    -- simply not admitted, so the gate stays 'pending_approval'.
    v_new_access := 'pending_approval';
    v_category := null;
  end if;

  update public.retailers
     set status = v_new_access,
         retailer_category = coalesce(v_category, retailer_category),
         approved_by = case when v_new_access = 'active' then auth.uid() else null end,
         approved_at = case when v_new_access = 'active' then now() else null end,
         updated_at = now()
   where id = p_retailer_id;

  update public.retailer_applications
     set status = v_new_app_status,
         decided_at = now(),
         decided_by = auth.uid(),
         decision_reason = v_reason,
         updated_at = now()
   where retailer_id = p_retailer_id;

  insert into public.retailer_approval_events
    (retailer_id, actor_id, action, previous_status, new_status, previous_category, new_category, reason)
  values
    (p_retailer_id, auth.uid(), p_decision,
     v_app.status, v_new_app_status,
     v_retailer.retailer_category::text, coalesce(v_category, v_retailer.retailer_category)::text,
     v_reason);

  return jsonb_build_object(
    'retailer_id', p_retailer_id,
    'application_status', v_new_app_status,
    'access_status', v_new_access,
    'retailer_category', coalesce(v_category, v_retailer.retailer_category)
  );
end;
$$;

revoke all on function public.admin_review_retailer_application(uuid, text, text, text) from public, anon;
grant execute on function public.admin_review_retailer_application(uuid, text, text, text) to authenticated;

-- Super Admin / Admin: change a retailer's pricing category (audited).
create or replace function public.admin_set_retailer_category(
  p_retailer_id uuid,
  p_category text,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_previous public.retailer_category;
  v_new public.retailer_category;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not is_admin_or_above() then
    raise exception 'Access denied: administrator authorization required.' using errcode = '42501';
  end if;
  if p_category is null or p_category not in ('general', 'silver', 'gold') then
    raise exception 'Unknown retailer category.' using errcode = '22023';
  end if;
  if v_reason is null or char_length(v_reason) < 3 then
    raise exception 'A reason of at least 3 characters is required to change a retailer category.' using errcode = '22023';
  end if;

  select retailer_category into v_previous from public.retailers where id = p_retailer_id for update;
  if not found then
    raise exception 'Retailer not found.' using errcode = '22023';
  end if;
  v_new := p_category::public.retailer_category;
  if v_new = v_previous then
    return jsonb_build_object('retailer_id', p_retailer_id, 'retailer_category', v_new, 'changed', false);
  end if;

  update public.retailers
     set retailer_category = v_new, updated_at = now()
   where id = p_retailer_id;

  insert into public.retailer_approval_events
    (retailer_id, actor_id, action, previous_category, new_category, reason)
  values
    (p_retailer_id, auth.uid(), 'category_changed', v_previous::text, v_new::text, v_reason);

  return jsonb_build_object('retailer_id', p_retailer_id, 'retailer_category', v_new, 'changed', true);
end;
$$;

revoke all on function public.admin_set_retailer_category(uuid, text, text) from public, anon;
grant execute on function public.admin_set_retailer_category(uuid, text, text) to authenticated;

-- Super Admin / Admin: suspend or restore access (audited).
create or replace function public.admin_set_retailer_access(
  p_retailer_id uuid,
  p_action text,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_previous text;
  v_app_status text;
  v_access public.retailer_status;
begin
  if not is_admin_or_above() then
    raise exception 'Access denied: administrator authorization required.' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('suspend', 'restore') then
    raise exception 'Action must be suspend or restore.' using errcode = '22023';
  end if;
  if v_reason is null or char_length(v_reason) < 3 then
    raise exception 'A reason of at least 3 characters is required.' using errcode = '22023';
  end if;

  select status::text into v_previous from public.retailers where id = p_retailer_id for update;
  if not found then
    raise exception 'Retailer not found.' using errcode = '22023';
  end if;

  if p_action = 'suspend' then
    v_access := 'suspended';
    v_app_status := 'suspended';
  else
    -- Restoring access re-admits an already-approved retailer only. A retailer
    -- whose only application is pending/rejected stays pending: restore is not
    -- an approval shortcut.
    if v_previous = 'pending_approval' then
      raise exception 'A pending application must be reviewed, not restored.' using errcode = '22023';
    end if;
    v_access := 'active';
    v_app_status := 'approved';
  end if;

  update public.retailers set status = v_access, updated_at = now() where id = p_retailer_id;
  update public.retailer_applications
     set status = v_app_status, updated_at = now()
   where retailer_id = p_retailer_id;

  insert into public.retailer_approval_events
    (retailer_id, actor_id, action, previous_status, new_status, reason)
  values
    (p_retailer_id, auth.uid(),
     case when p_action = 'suspend' then 'suspended' else 'restored' end,
     v_previous, v_access::text, v_reason);

  return jsonb_build_object('retailer_id', p_retailer_id, 'access_status', v_access);
end;
$$;

revoke all on function public.admin_set_retailer_access(uuid, text, text) from public, anon;
grant execute on function public.admin_set_retailer_access(uuid, text, text) to authenticated;

-- Retailer (self only): resubmit a pending/rejected application with corrected
-- details. Never touches status, category or approval fields.
create or replace function public.retailer_resubmit_application(
  p_shop_name text,
  p_gstin text,
  p_address text,
  p_area_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_app public.retailer_applications%rowtype;
  v_target int;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_shop_name, '')), '') is null then
    raise exception 'Shop name is required.' using errcode = '22023';
  end if;
  if p_area_id is null or not exists (select 1 from public.areas a where a.id = p_area_id and a.is_active) then
    raise exception 'Choose an active service area.' using errcode = '22023';
  end if;

  select * into v_app from public.retailer_applications where retailer_id = v_uid for update;
  if not found then
    raise exception 'No application found for this account.' using errcode = '22023';
  end if;
  if v_app.status not in ('pending', 'rejected') then
    raise exception 'Only a pending or rejected application can be resubmitted.' using errcode = '22023';
  end if;

  select review_target_hours into v_target from public.retailer_approval_settings limit 1;

  update public.retailer_applications
     set shop_name = btrim(p_shop_name),
         gstin = nullif(btrim(coalesce(p_gstin, '')), ''),
         address = nullif(btrim(coalesce(p_address, '')), ''),
         area_id = p_area_id,
         status = 'pending',
         submitted_at = now(),
         review_target_hours = coalesce(v_target, review_target_hours),
         decided_at = null,
         decided_by = null,
         decision_reason = null,
         updated_at = now()
   where retailer_id = v_uid;

  update public.retailers
     set shop_name = btrim(p_shop_name),
         gstin = nullif(btrim(coalesce(p_gstin, '')), ''),
         address = nullif(btrim(coalesce(p_address, '')), ''),
         area_id = p_area_id,
         updated_at = now()
   where id = v_uid;

  insert into public.retailer_approval_events
    (retailer_id, actor_id, action, previous_status, new_status, reason)
  values (v_uid, v_uid, 'resubmitted', v_app.status, 'pending', 'Applicant resubmitted details');

  return jsonb_build_object('retailer_id', v_uid, 'status', 'pending');
end;
$$;

revoke all on function public.retailer_resubmit_application(text, text, text, uuid) from public, anon;
grant execute on function public.retailer_resubmit_application(text, text, text, uuid) to authenticated;

-- ============================================================================
-- END OF MIGRATION 0081
-- ============================================================================
