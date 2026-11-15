-- ============================================================================
-- ROLLBACK for 0098_seller_agreement_and_marketplace_gate.sql
-- REVIEW ONLY, NOT APPLIED ANYWHERE.
--
-- WARNING: re-opens SEC-17. After this rollback seller offers can be activated
-- and published without an accepted Seller Agreement and without the owner /
-- Chartered Accountant marketplace approval. The application code in this PR
-- still refuses (it fails closed when seller_offer_gate_status is absent), so
-- third-party offers stay off unless the application is rolled back as well.
--
-- NO DATA IS DELETED BY THIS SCRIPT. The approval log and the published
-- version register are evidence. Every row is copied to an archive table
-- (appended on each rollback, so a second rollback after a re-apply loses
-- nothing) before the live table is removed. The archives stay in place, with
-- no API access. Removing the live approval log is deliberate: re-applying
-- 0098 then starts with the marketplace CLOSED and needs a fresh decision.
-- ============================================================================
begin;

drop trigger if exists trg_order_item_marketplace_gate on public.order_items;
drop function if exists public.enforce_order_item_marketplace_gate();
drop trigger if exists trg_seller_offer_launch_gate on public.seller_offers;
drop function if exists public.enforce_seller_offer_launch_gate();

drop function if exists public.seller_offer_gate_status(uuid);
drop function if exists public.seller_agreement_is_current(uuid);
drop function if exists public.record_marketplace_launch_approval(boolean, text, text, text);
drop function if exists public.third_party_offers_enabled();

create table if not exists public.marketplace_launch_approvals_rollback_archive as
  select *, now() as archived_at from public.marketplace_launch_approvals with no data;
insert into public.marketplace_launch_approvals_rollback_archive
  select a.*, now() from public.marketplace_launch_approvals a
   where not exists (select 1 from public.marketplace_launch_approvals_rollback_archive x where x.id = a.id);
alter table public.marketplace_launch_approvals_rollback_archive enable row level security;
revoke all on table public.marketplace_launch_approvals_rollback_archive from public, anon, authenticated;
drop table if exists public.marketplace_launch_approvals;

-- 0095 body.
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

drop function if exists public.publish_legal_document_version(text, text);
create table if not exists public.legal_document_current_versions_rollback_archive as
  select *, now() as archived_at from public.legal_document_current_versions with no data;
insert into public.legal_document_current_versions_rollback_archive
  select v.*, now() from public.legal_document_current_versions v;
alter table public.legal_document_current_versions_rollback_archive enable row level security;
revoke all on table public.legal_document_current_versions_rollback_archive from public, anon, authenticated;
drop table if exists public.legal_document_current_versions;

commit;
