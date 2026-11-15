-- ============================================================================
-- 0095: legal document acceptance records, wider privacy request types, and a
--       grievance topic with acknowledgement tracking.
--
-- REVIEW ONLY. NOT APPLIED TO PRODUCTION. Additive: no existing row is
-- changed or removed. See docs/readiness-2026-11-14/04_MIGRATIONS.md.
--
-- Why:
--   LEG-01  There was no record of WHICH version of a policy a user accepted
--           or when. A seller agreement or privacy notice cannot be relied on
--           without that record.
--   PRV-01  retailer_account_requests accepted only account_deletion and
--           data_export. A request to CORRECT personal data, or to WITHDRAW
--           consent, had no channel and no audit trail.
--   GRV-01  support_tickets had no grievance topic and no acknowledgement
--           timestamp, so the published 48-hour acknowledgement commitment
--           could not be evidenced.
-- Depends on: 0035 (retailer_account_requests), 0048 (support_tickets),
--             0052 (is_admin_or_above).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Acceptance records. Append-only: a user inserts their own acceptance
--    through the function below; nobody can update or delete a row.
-- ----------------------------------------------------------------------------
create table if not exists public.legal_document_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  document_key text not null,
  document_version text not null,
  accepted_at timestamptz not null default now(),
  context text not null default 'account',
  constraint legal_document_acceptances_key_format
    check (document_key ~ '^[a-z][a-z0-9-]{1,63}$'),
  constraint legal_document_acceptances_version_format
    check (document_version ~ '^[0-9]+\.[0-9]+$'),
  constraint legal_document_acceptances_context_check
    check (context in ('registration', 'account', 'seller_onboarding', 'checkout', 'policy_update')),
  constraint legal_document_acceptances_once unique (user_id, document_key, document_version)
);

comment on table public.legal_document_acceptances is
  'Append-only proof that a user accepted a specific version of a legal document. Written only by record_legal_acceptance().';

create index if not exists idx_legal_document_acceptances_user
  on public.legal_document_acceptances (user_id, document_key);

alter table public.legal_document_acceptances enable row level security;

revoke all on table public.legal_document_acceptances from public, anon, authenticated;
grant select on table public.legal_document_acceptances to authenticated;
grant all on table public.legal_document_acceptances to service_role;

drop policy if exists "legal_document_acceptances_read" on public.legal_document_acceptances;
create policy "legal_document_acceptances_read" on public.legal_document_acceptances
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin_or_above()));
-- Deliberately NO insert / update / delete policy: see the function below.

-- The caller can record an acceptance only for THEMSELVES, and the timestamp
-- is the database clock, never a client value. Re-accepting the same version
-- returns the original record unchanged.
create or replace function public.record_legal_acceptance(
  p_document_key text,
  p_document_version text,
  p_context text default 'account'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
begin
  if v_user is null then
    raise exception 'Sign in to accept this document.' using errcode = '42501';
  end if;
  insert into public.legal_document_acceptances (user_id, document_key, document_version, context)
  values (v_user, p_document_key, p_document_version, coalesce(p_context, 'account'))
  on conflict (user_id, document_key, document_version) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.legal_document_acceptances
     where user_id = v_user and document_key = p_document_key and document_version = p_document_version;
  end if;
  return v_id;
end;
$$;
revoke all on function public.record_legal_acceptance(text, text, text) from public, anon;
grant execute on function public.record_legal_acceptance(text, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. Privacy requests: add correction and consent-withdrawal, plus the fields
--    needed to show when and how a request was answered.
-- ----------------------------------------------------------------------------
alter table public.retailer_account_requests
  drop constraint if exists retailer_account_requests_type_check;
alter table public.retailer_account_requests
  add constraint retailer_account_requests_type_check
  check (request_type in ('account_deletion', 'data_export', 'data_correction', 'consent_withdrawal'));

alter table public.retailer_account_requests
  add column if not exists resolved_at timestamptz,
  add column if not exists resolution_note text;

alter table public.retailer_account_requests
  drop constraint if exists retailer_account_requests_resolution_note_len;
alter table public.retailer_account_requests
  add constraint retailer_account_requests_resolution_note_len
  check (resolution_note is null or char_length(btrim(resolution_note)) <= 1000);

-- ----------------------------------------------------------------------------
-- 3. Grievances: a dedicated topic and an acknowledgement timestamp.
-- ----------------------------------------------------------------------------
alter table public.support_tickets
  drop constraint if exists support_tickets_topic_check;
alter table public.support_tickets
  add constraint support_tickets_topic_check
  check (topic in ('order', 'payment', 'product', 'delivery', 'credit', 'other', 'grievance', 'privacy'));

alter table public.support_tickets
  add column if not exists acknowledged_at timestamptz;

comment on column public.support_tickets.acknowledged_at is
  'When an Admin first acknowledged the ticket. Evidence for the published grievance acknowledgement timeline.';
