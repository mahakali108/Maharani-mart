-- ============================================================================
-- ROLLBACK for 0095_legal_acceptance_and_privacy_requests.sql
-- REVIEW ONLY, NOT APPLIED ANYWHERE.
--
-- NO DATA IS DELETED BY THIS SCRIPT.
--   * legal_document_acceptances (the proof of which policy versions users
--     accepted) is KEPT, with all rows. Only API access to it is removed, so
--     it behaves as if absent to the application. Re-applying 0095 restores
--     access (the migration is `create table if not exists`).
--   * The added nullable columns (support_tickets.acknowledged_at,
--     retailer_account_requests.resolved_at / resolution_note) are KEPT with
--     their values. They are unused by the pre-0095 application.
--   * The narrower check constraints are restored only if no row uses a newer
--     value; otherwise this script stops with an error rather than deleting
--     user requests.
-- ============================================================================
begin;

do $$
begin
  if exists (select 1 from public.retailer_account_requests
              where request_type in ('data_correction', 'consent_withdrawal')) then
    raise exception 'Rollback blocked: correction / consent-withdrawal requests exist. Resolve and archive them first.';
  end if;
  if exists (select 1 from public.support_tickets where topic in ('grievance', 'privacy')) then
    raise exception 'Rollback blocked: grievance / privacy tickets exist. Re-file them under another topic first.';
  end if;
end $$;

alter table public.support_tickets drop constraint if exists support_tickets_topic_check;
alter table public.support_tickets add constraint support_tickets_topic_check
  check (topic in ('order', 'payment', 'product', 'delivery', 'credit', 'other'));

alter table public.retailer_account_requests drop constraint if exists retailer_account_requests_type_check;
alter table public.retailer_account_requests add constraint retailer_account_requests_type_check
  check (request_type in ('account_deletion', 'data_export'));

drop function if exists public.record_legal_acceptance(text, text, text);
drop policy if exists "legal_document_acceptances_read" on public.legal_document_acceptances;
revoke all on table public.legal_document_acceptances from public, anon, authenticated;
comment on table public.legal_document_acceptances is
  'Kept by the 0095 rollback as evidence. No API access. Re-apply 0095 to restore.';

commit;
