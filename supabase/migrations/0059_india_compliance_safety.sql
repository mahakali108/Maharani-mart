-- 0059 — Interim safeguards pending owner, Indian counsel and GST practitioner review.
-- Additive/re-runnable: no business rows are removed or rewritten. This does NOT
-- establish an invoice issuer, approve any seller, or set a lawful retention term.

-- 0055 scheduled deletion of orders (including GST figures, delivery evidence
-- and status history), returns, payment collections, wallet history and stock
-- movement/allocation records after only 120 days. Pause *all* 120-day rules,
-- including any site-specific additions, rather than infer a retention term.
-- The registry is migration-managed and its trigger accepts the migration owner.
update public.data_retention_rules
   set enabled = false
 where category = 'business_120' and enabled;

-- Defense in depth: even a service-role direct RPC call or a later accidental
-- registry change cannot re-enable these targets. Removing this hold requires
-- a separate, reviewed migration after owner/CA/lawyer sign-off. NOT VALID
-- avoids a long table lock; VALIDATE checks the small rules registry only.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.data_retention_rules'::regclass
       and conname = 'data_retention_business_hold'
  ) then
    alter table public.data_retention_rules
      add constraint data_retention_business_hold
      check (category <> 'business_120' or enabled = false) not valid;
  end if;
end;
$$;
alter table public.data_retention_rules
  validate constraint data_retention_business_hold;

-- The 90-day category also includes order/payment notification history and
-- prior cleanup-run audit trails. These can evidence a complaint, collection,
-- incident or previous deletion; do not call them disposable until counsel
-- maps their actual contents and applicable retention. Session carts, expired
-- invite tokens and AI rate-limit windows remain separate temporary targets.
update public.data_retention_rules
   set enabled = false
 where target_key in ('expired_notifications', 'notification_logs', 'cleanup_run_logs')
   and enabled;
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.data_retention_rules'::regclass
       and conname = 'data_retention_evidence_hold'
  ) then
    alter table public.data_retention_rules
      add constraint data_retention_evidence_hold
      check (target_key not in ('expired_notifications', 'notification_logs', 'cleanup_run_logs')
             or enabled = false) not valid;
  end if;
end;
$$;
alter table public.data_retention_rules validate constraint data_retention_evidence_hold;

-- Other evidence-erasing paths are NOT age-based: legacy release_coupon
-- deletes a cancellation's redemption; failed-delivery reset deletes prior
-- line snapshots; admin document deletion removes registration/KYC evidence.
-- The application pauses each operation below. Close their direct API bypasses
-- too, pending an immutable attempt/reversal/correction workflow.
-- This does not delete, rewrite or backfill any existing evidence.
revoke execute on function public.release_coupon(uuid)
  from public, anon, authenticated, service_role;
drop policy if exists "order_delivery_items_delete" on public.order_delivery_items;
-- Even an authorized direct UPDATE (or an FK cascade from a direct delete)
-- cannot reset a failed attempt or clear its failure/proof snapshot.
create or replace function public.hold_failed_delivery_evidence()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if old.delivery_status = 'failed' then
    raise exception 'Failed delivery evidence is held pending an immutable attempt model.'
      using errcode = '23514';
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists trg_hold_failed_delivery_evidence on public.order_deliveries;
create trigger trg_hold_failed_delivery_evidence
  before update or delete on public.order_deliveries
  for each row execute function public.hold_failed_delivery_evidence();
revoke all on function public.hold_failed_delivery_evidence() from public, anon, authenticated, service_role;
-- RLS alone cannot stop UPDATE of the previous line split while the failed
-- parent is visible. This narrowly holds those rows too; the definer reads
-- only the parent status and exposes no data to the caller.
create or replace function public.hold_failed_delivery_items()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (
    select 1 from public.order_deliveries od
     where od.id = old.delivery_id and od.delivery_status = 'failed'
  ) then
    raise exception 'Failed delivery line evidence is held pending an immutable attempt model.'
      using errcode = '23514';
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists trg_hold_failed_delivery_items on public.order_delivery_items;
create trigger trg_hold_failed_delivery_items
  before update or delete on public.order_delivery_items
  for each row execute function public.hold_failed_delivery_items();
revoke all on function public.hold_failed_delivery_items() from public, anon, authenticated, service_role;
drop policy if exists "retailer_documents_staff_delete" on public.retailer_documents;
drop policy if exists "retailer_documents_bucket_delete" on storage.objects;

-- Existing offer_updates=true values do NOT establish an affirmative choice.
-- Do not backfill a date or alter any historical preference row. New settings
-- default off; only a deliberate post-0059 save of the offers toggle provides
-- a preference marker. This is NOT a substitute for an approved privacy notice
-- or a legal determination about promotional communication.
alter table public.retailer_notification_prefs
  alter column offer_updates set default false;
alter table public.retailer_notification_prefs
  add column if not exists offer_preference_recorded_at timestamptz;
comment on column public.retailer_notification_prefs.offer_preference_recorded_at is
  'Set when the account holder explicitly saves offers=on after 0059; null for legacy values and withdrawals. This marker alone is not statutory marketing consent.';

-- The database stamps the time instead of trusting a client-supplied value;
-- a withdrawal clears it. A save of unrelated preferences cannot silently
-- upgrade a historical offers=true row, because it has no marker to stamp.
create or replace function public.stamp_offer_preference()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.offer_updates is false then
    new.offer_preference_recorded_at := null;
  elsif new.offer_preference_recorded_at is not null then
    if tg_op = 'INSERT' then
      new.offer_preference_recorded_at := now();
    elsif old.offer_preference_recorded_at is distinct from new.offer_preference_recorded_at then
      new.offer_preference_recorded_at := now();
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_stamp_offer_preference on public.retailer_notification_prefs;
create trigger trg_stamp_offer_preference
  before insert or update on public.retailer_notification_prefs
  for each row execute function public.stamp_offer_preference();
revoke all on function public.stamp_offer_preference() from public, anon, authenticated, service_role;

-- Salesmen who are actually assigned to a retailer may deliver the retailer's
-- order updates; let the notification helper read that retailer's preferences
-- rather than treating an RLS-hidden opt-out as a missing row. No write grant
-- changes, and unrelated retailers' preferences stay hidden.
drop policy if exists "retailer_notification_prefs_owner_read" on public.retailer_notification_prefs;
create policy "retailer_notification_prefs_owner_read" on public.retailer_notification_prefs
  for select using (
    retailer_id = auth.uid()
    or public.is_staff_or_above()
    or (public.current_user_role() = 'salesman'
      and public.is_retailer_assigned_to_current_salesman(retailer_id))
  );

-- Direct PostgREST inserts must not forge a ticket against another retailer's
-- order or pre-set a workflow status. The app's own ownership check remains
-- useful but is not a substitute for this database boundary.
drop policy if exists "support_tickets_retailer_insert" on public.support_tickets;
create policy "support_tickets_retailer_insert" on public.support_tickets
  for insert with check (
    retailer_id = auth.uid()
    and public.current_user_role() = 'retailer'
    and status = 'open'
    and resolved_at is null
    and closed_at is null
    and (order_id is null or exists (
      select 1 from public.orders o
       where o.id = order_id and o.retailer_id = auth.uid()
    ))
  );

-- A forged author_role could otherwise make a retailer reply look like an
-- official admin reply. The snapshot must reflect the verified active role.
drop policy if exists "support_messages_insert" on public.support_ticket_messages;
create policy "support_messages_insert" on public.support_ticket_messages
  for insert with check (
    author_id = auth.uid()
    and author_role = public.current_user_role()::text
    and exists (
      select 1 from public.support_tickets t
       where t.id = ticket_id
         and (
           (t.retailer_id = auth.uid()
             and public.current_user_role() = 'retailer'
             and t.status in ('open', 'in_progress'))
           or public.is_admin_or_above()
         )
    )
  );
-- Neither policy changes SELECT/UPDATE/DELETE grants. No support history is
-- changed; staff and salesman still cannot impersonate admins on tickets.
