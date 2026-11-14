-- ============================================================================
-- ROLLBACK for 0095_legal_acceptance_and_privacy_requests.sql
-- REVIEW ONLY, NOT APPLIED ANYWHERE.
--
-- DATA LOSS WARNING: dropping legal_document_acceptances destroys the proof of
-- which policy versions users accepted. Export the table first. The narrower
-- check constraints are restored only if no row uses a newer value; otherwise
-- this script stops with an error rather than deleting user requests.
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

alter table public.support_tickets drop column if exists acknowledged_at;
alter table public.support_tickets drop constraint if exists support_tickets_topic_check;
alter table public.support_tickets add constraint support_tickets_topic_check
  check (topic in ('order', 'payment', 'product', 'delivery', 'credit', 'other'));

alter table public.retailer_account_requests drop constraint if exists retailer_account_requests_resolution_note_len;
alter table public.retailer_account_requests drop column if exists resolution_note;
alter table public.retailer_account_requests drop column if exists resolved_at;
alter table public.retailer_account_requests drop constraint if exists retailer_account_requests_type_check;
alter table public.retailer_account_requests add constraint retailer_account_requests_type_check
  check (request_type in ('account_deletion', 'data_export'));

drop function if exists public.record_legal_acceptance(text, text, text);
drop table if exists public.legal_document_acceptances;

commit;
