-- ============================================================================
-- 0039: Salesman follow-up reminders (Phase 2)
--
-- WHY
-- ---
-- A sales executive's day is built around callbacks: "go back Thursday",
-- "collect payment after Diwali", "shop owner asked to revisit next week".
-- Nothing in the schema could represent that intent — visits are logged
-- events, routes are recurring beats, notifications are one-way system
-- messages.
--
-- Design notes
-- ------------
-- * A follow-up belongs to one retailer and one owner (the salesman who
--   must act). It may optionally link the visit or order that produced it.
-- * Lifecycle: open → done | cancelled. No deletes — a cancelled or done
--   follow-up is the historical record. Every change is audited.
-- * A salesman can only create/see/edit follow-ups for retailers assigned
--   to them (RLS reuses is_retailer_assigned_to_current_salesman from
--   0014). Admin+ read everything for oversight (/admin/follow-ups).
-- * due_date is a plain Asia/Kolkata calendar date (the app formats it
--   with the existing lib/datetime/india helpers); no timezone is stored.
-- ============================================================================

create table if not exists follow_ups (
  id uuid primary key default uuid_generate_v4(),
  retailer_id uuid not null references retailers(id) on delete cascade,
  owner_id uuid not null references profiles(id) on delete cascade,
  due_date date not null,
  note text not null,
  status text not null default 'open',
  visit_id uuid references visits(id) on delete set null,
  order_id uuid references orders(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint follow_ups_status_check
    check (status in ('open', 'done', 'cancelled')),
  constraint follow_ups_note_len
    check (char_length(btrim(note)) between 3 and 500)
);

create index if not exists idx_follow_ups_owner_queue on follow_ups(owner_id, status, due_date);
create index if not exists idx_follow_ups_retailer on follow_ups(retailer_id);

alter table follow_ups enable row level security;

-- Owner sees their own follow-ups; admin+ sees all (oversight page).
drop policy if exists "follow_ups_read" on follow_ups;
create policy "follow_ups_read" on follow_ups
  for select using (
    owner_id = auth.uid()
    or is_admin_or_above()
  );

-- A salesman creates follow-ups only for retailers assigned to them, and
-- only in their own name.
drop policy if exists "follow_ups_owner_insert" on follow_ups;
create policy "follow_ups_owner_insert" on follow_ups
  for insert with check (
    owner_id = auth.uid()
    and is_retailer_assigned_to_current_salesman(retailer_id)
  );

-- The owner advances/cancels their own follow-ups; admin+ can too (e.g.
-- clean up after a reassignment). Status can only move forward via the
-- app; RLS keeps other salesmen's hands off.
drop policy if exists "follow_ups_owner_update" on follow_ups;
create policy "follow_ups_owner_update" on follow_ups
  for update using (
    owner_id = auth.uid()
    or is_admin_or_above()
  )
  with check (
    owner_id = auth.uid()
    or is_admin_or_above()
  );

-- No DELETE policy: append-only history (cancel instead).

drop trigger if exists trg_audit_follow_ups on follow_ups;
create trigger trg_audit_follow_ups after insert or update or delete on follow_ups
  for each row execute function log_audit();

-- ============================================================================
-- END OF MIGRATION — no business data inserted.
-- ============================================================================
