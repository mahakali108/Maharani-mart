-- ============================================================================
-- 0048: Support tickets (retailer helpdesk)
--
-- WHY
-- ---
-- The retailer "Help centre" was FAQ + a configured phone number only. Real
-- B2B support needs durable tickets: a retailer raises a ticket (optionally
-- linked to one of their own orders), an admin answers, and both sides see
-- the message history and the ticket's status.
--
-- MODEL
-- * ONE `support_tickets` row per request. `ticket_number` is generated
--   server-side in the app (never client-supplied) and is unique.
-- * `order_id` links the ticket to a specific order (nullable — many issues
--   are not order-specific). The link is `on delete set null` so purging an
--   order (never done by the app) can never destroy a support record.
-- * Status is a one-way workflow: open → in_progress → resolved → closed.
--   Only admin+ may change status; retailers can only CREATE a ticket and
--   REPLY while it is open/in_progress. Re-opening is an admin action
--   (resolved/closed → in_progress), so the lifecycle is fully audited.
-- * `support_ticket_messages` is append-only. `author_role` is a snapshot of
--   the author's role at send time, stored by the app from the verified
--   profile row — never trusted from the client.
-- * No DELETE policies anywhere: tickets and messages are money/relationship
--   history. Corrections happen as new messages, not edits.
--
-- RLS
-- * retailer:  read own tickets + messages; INSERT own ticket (retailer_id =
--   auth.uid()); INSERT a message on own ticket ONLY while open/in_progress.
-- * admin+:    read all; INSERT messages; UPDATE status.
-- * staff/salesman: no access (support is an admin-office function; the
--   /admin route is the only surface that can answer tickets).
--
-- SAFETY: additive & re-runnable; no existing table touched; no data seeded.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. support_tickets
-- ----------------------------------------------------------------------------
create table if not exists support_tickets (
  id uuid primary key default uuid_generate_v4(),
  ticket_number text not null unique,
  retailer_id uuid not null references profiles(id) on delete cascade,
  subject text not null,
  topic text not null,
  priority text not null default 'normal',
  order_id uuid references orders(id) on delete set null,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  closed_at timestamptz,
  constraint support_tickets_subject_len
    check (char_length(btrim(subject)) between 10 and 120),
  constraint support_tickets_topic_check
    check (topic in ('order', 'payment', 'product', 'delivery', 'credit', 'other')),
  constraint support_tickets_priority_check
    check (priority in ('low', 'normal', 'high', 'urgent')),
  constraint support_tickets_status_check
    check (status in ('open', 'in_progress', 'resolved', 'closed')),
  constraint support_tickets_resolution_consistency
    check (
      (status = 'resolved' and resolved_at is not null)
      or (status <> 'resolved' and resolved_at is null)
    ),
  constraint support_tickets_closure_consistency
    check (
      (status = 'closed' and closed_at is not null)
      or (status <> 'closed' and closed_at is null)
    )
);

comment on table support_tickets is 'Retailer support tickets. ticket_number is app-generated and unique. Retailers create + reply (open/in_progress only); admin+ manages status. No deletes.';
comment on column support_tickets.ticket_number is 'Human-readable unique ticket number (e.g. MT-TKT-20260915-A1B2), generated server-side.';
comment on column support_tickets.order_id is 'Optional link to the retailer''s own order the ticket is about.';
comment on column support_tickets.priority is 'Retailer-selected urgency: low / normal / high / urgent. Display + triage only — never gates data access.';
comment on column support_tickets.status is 'Workflow: open → in_progress → resolved → closed. Only admin+ updates it.';

create index if not exists idx_support_tickets_retailer on support_tickets(retailer_id, status, created_at desc);
create index if not exists idx_support_tickets_status on support_tickets(status, priority, created_at desc);
create index if not exists idx_support_tickets_order on support_tickets(order_id);

create or replace function update_support_ticket_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_support_tickets_updated_at on support_tickets;
create trigger trg_support_tickets_updated_at
  before update on support_tickets
  for each row execute function update_support_ticket_updated_at();

-- ----------------------------------------------------------------------------
-- 2. support_ticket_messages — append-only conversation
-- ----------------------------------------------------------------------------
create table if not exists support_ticket_messages (
  id uuid primary key default uuid_generate_v4(),
  ticket_id uuid not null references support_tickets(id) on delete cascade,
  author_id uuid not null references profiles(id),
  author_role text not null,
  body text not null,
  created_at timestamptz not null default now(),
  constraint support_ticket_messages_body_len
    check (char_length(btrim(body)) between 5 and 3000),
  constraint support_ticket_messages_author_role_check
    check (author_role in ('retailer', 'admin', 'super_admin', 'staff', 'salesman'))
);

comment on table support_ticket_messages is 'Append-only messages on a support ticket. author_role is a server-verified snapshot of the author''s role. No update/delete.';

create index if not exists idx_support_ticket_messages_ticket on support_ticket_messages(ticket_id, created_at);

-- ----------------------------------------------------------------------------
-- 3. RLS
-- ----------------------------------------------------------------------------
alter table support_tickets enable row level security;
alter table support_ticket_messages enable row level security;

-- Retailers see their own tickets; admins see all. (No staff/salesman.)
drop policy if exists "support_tickets_read" on support_tickets;
create policy "support_tickets_read" on support_tickets
  for select using (retailer_id = auth.uid() or is_admin_or_above());

-- Only a retailer can open a ticket, and only for their own account.
drop policy if exists "support_tickets_retailer_insert" on support_tickets;
create policy "support_tickets_retailer_insert" on support_tickets
  for insert with check (
    retailer_id = auth.uid()
    and current_user_role() = 'retailer'
  );

-- Only admin+ may move a ticket through the workflow.
drop policy if exists "support_tickets_admin_update" on support_tickets;
create policy "support_tickets_admin_update" on support_tickets
  for update using (is_admin_or_above())
  with check (is_admin_or_above());

-- No DELETE policy: tickets are relationship history.

-- Messages: visible wherever the parent ticket is visible.
drop policy if exists "support_messages_read" on support_ticket_messages;
create policy "support_messages_read" on support_ticket_messages
  for select using (
    exists (
      select 1 from support_tickets t
      where t.id = ticket_id
        and (t.retailer_id = auth.uid() or is_admin_or_above())
    )
  );

-- Retailers may post on their own ticket while it is actionable; admins post
-- on any ticket. author_id is always the verified caller (set by the app).
drop policy if exists "support_messages_insert" on support_ticket_messages;
create policy "support_messages_insert" on support_ticket_messages
  for insert with check (
    author_id = auth.uid()
    and exists (
      select 1 from support_tickets t
      where t.id = ticket_id
        and (
          (t.retailer_id = auth.uid() and current_user_role() = 'retailer'
            and t.status in ('open', 'in_progress'))
          or is_admin_or_above()
        )
    )
  );

-- No update/delete policies: the conversation is immutable.

-- ----------------------------------------------------------------------------
-- 4. Audit
-- ----------------------------------------------------------------------------
drop trigger if exists trg_audit_support_tickets on support_tickets;
create trigger trg_audit_support_tickets
  after insert or update or delete on support_tickets
  for each row execute function log_audit();

drop trigger if exists trg_audit_support_ticket_messages on support_ticket_messages;
create trigger trg_audit_support_ticket_messages
  after insert on support_ticket_messages
  for each row execute function log_audit();

-- ============================================================================
-- END OF MIGRATION — no business data inserted.
-- ============================================================================
