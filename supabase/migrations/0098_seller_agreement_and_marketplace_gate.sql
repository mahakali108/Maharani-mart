-- ============================================================================
-- 0098: Seller Agreement enforcement and the third-party marketplace switch.
--
-- REVIEW ONLY. NOT APPLIED TO PRODUCTION. Apply after 0095.
-- See docs/readiness-2026-11-14/04_MIGRATIONS.md.
--
-- Finding closed (independent review of PR #126):
--   SEC-17 (High)  0095 only RECORDED legal acceptances. Nothing stopped a
--           seller who never accepted the Seller Agreement from activating an
--           offer, or an Admin from publishing it, and there was no single
--           switch keeping third-party offers off before launch.
--
-- Rules enforced by the database for every caller (seller, Admin, service):
--   1. A seller offer can be ACTIVATED (is_active becomes true, including on
--      insert) or PUBLISHED (moderation_status becomes 'approved') only when
--        a. third-party offers are switched on, AND
--        b. an owner of that seller has accepted the CURRENT version of the
--           Seller Agreement.
--   2. A new order line can use a seller offer only under the same two
--      conditions, so offers that already exist are not orderable either.
--   3. The switch is OFF until a Super Admin records BOTH an owner approval
--      reference and a Chartered Accountant approval reference. The database
--      stores those references exactly as given; it does not decide, compute
--      or assume any GST / TCS (s.52 CGST) / TDS (s.194-O) position. Those
--      registrations and decisions remain with the owner and the CA.
--   4. Only the current version of a registered document can be accepted, so
--      a version cannot be "pre-accepted" before it is published.
--
-- This migration ships with the switch OFF and records no approval.
-- Depends on: 0062 (seller_members), 0063 (seller_offers), 0095.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Which version of a document is current, as known to the database.
--    Must match lib/legal/documents.ts (tests/seller-agreement-gate-db.test.ts
--    fails when they differ).
-- ----------------------------------------------------------------------------
create table if not exists public.legal_document_current_versions (
  document_key text primary key,
  document_version text not null,
  published_at timestamptz not null default now(),
  published_by uuid references auth.users(id) on delete set null,
  constraint legal_document_current_versions_key_format
    check (document_key ~ '^[a-z][a-z0-9-]{1,63}$'),
  constraint legal_document_current_versions_version_format
    check (document_version ~ '^[0-9]+\.[0-9]+$')
);
comment on table public.legal_document_current_versions is
  'Current version of each legal document that the database enforces. Written by migrations or publish_legal_document_version().';

alter table public.legal_document_current_versions enable row level security;
revoke all on table public.legal_document_current_versions from public, anon, authenticated;
grant select on table public.legal_document_current_versions to authenticated;
grant all on table public.legal_document_current_versions to service_role;

drop policy if exists "legal_document_current_versions_read" on public.legal_document_current_versions;
create policy "legal_document_current_versions_read" on public.legal_document_current_versions
  for select to authenticated using (true);

insert into public.legal_document_current_versions (document_key, document_version)
values ('seller-agreement', '1.0')
on conflict (document_key) do nothing;

create or replace function public.publish_legal_document_version(
  p_document_key text, p_document_version text
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or not exists (
    select 1 from public.profiles p where p.id = v_actor and p.role = 'super_admin'
  ) then
    raise exception 'Only an authenticated Super Admin can publish a document version.' using errcode = '42501';
  end if;
  insert into public.legal_document_current_versions (document_key, document_version, published_at, published_by)
  values (p_document_key, p_document_version, now(), v_actor)
  on conflict (document_key) do update
    set document_version = excluded.document_version,
        published_at = excluded.published_at,
        published_by = excluded.published_by
    where public.legal_document_current_versions.document_version is distinct from excluded.document_version;
end;
$$;
revoke all on function public.publish_legal_document_version(text, text) from public, anon;
grant execute on function public.publish_legal_document_version(text, text) to authenticated;

-- Same signature and grants as 0095. Adds rule 4.
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
  v_current text;
begin
  if v_user is null then
    raise exception 'Sign in to accept this document.' using errcode = '42501';
  end if;
  select document_version into v_current
    from public.legal_document_current_versions where document_key = p_document_key;
  if v_current is not null and v_current is distinct from p_document_version then
    raise exception 'LEGAL_VERSION_NOT_CURRENT: only the current version (%) of this document can be accepted.', v_current
      using errcode = '22023';
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

-- ----------------------------------------------------------------------------
-- 2. The marketplace switch: an append-only approval log. The newest row wins.
--    No row = OFF.
-- ----------------------------------------------------------------------------
create table if not exists public.marketplace_launch_approvals (
  id uuid primary key default gen_random_uuid(),
  third_party_offers_enabled boolean not null,
  owner_approval_reference text,
  ca_approval_reference text,
  reason text,
  recorded_by uuid not null references auth.users(id) on delete restrict,
  recorded_at timestamptz not null default clock_timestamp(),
  constraint marketplace_launch_approvals_enable_needs_both check (
    not third_party_offers_enabled
    or (char_length(btrim(coalesce(owner_approval_reference, ''))) between 3 and 200
        and char_length(btrim(coalesce(ca_approval_reference, ''))) between 3 and 200)
  ),
  constraint marketplace_launch_approvals_reason_len
    check (reason is null or char_length(btrim(reason)) <= 500)
);
comment on table public.marketplace_launch_approvals is
  'Append-only log of the third-party marketplace switch. Enabling needs an owner approval reference AND a Chartered Accountant approval reference. The references are evidence pointers supplied by the owner; the platform makes no tax (GST/TCS/TDS) determination.';

alter table public.marketplace_launch_approvals enable row level security;
revoke all on table public.marketplace_launch_approvals from public, anon, authenticated, service_role;
grant select on table public.marketplace_launch_approvals to authenticated, service_role;

drop policy if exists "marketplace_launch_approvals_admin_read" on public.marketplace_launch_approvals;
create policy "marketplace_launch_approvals_admin_read" on public.marketplace_launch_approvals
  for select to authenticated using ((select public.is_admin_or_above()));

create or replace function public.third_party_offers_enabled()
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select a.third_party_offers_enabled
      from public.marketplace_launch_approvals a
     order by a.recorded_at desc, a.id desc
     limit 1
  ), false)
$$;
-- Internal: read only by the SECURITY DEFINER gate functions and triggers below.
-- No API session can call it; sellers read seller_offer_gate_status() (which
-- checks who is asking) and Admins read the approval log under RLS.
revoke all on function public.third_party_offers_enabled() from public, anon, authenticated;
grant execute on function public.third_party_offers_enabled() to service_role;

create or replace function public.record_marketplace_launch_approval(
  p_enabled boolean,
  p_owner_approval_reference text default null,
  p_ca_approval_reference text default null,
  p_reason text default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_owner text := nullif(btrim(coalesce(p_owner_approval_reference, '')), '');
  v_ca text := nullif(btrim(coalesce(p_ca_approval_reference, '')), '');
  v_placeholder constant text := '^(n/?a|tbd|todo|placeholder|owner input required|pending|none|x{2,}|-+)$';
  v_id uuid;
begin
  if v_actor is null or not exists (
    select 1 from public.profiles p where p.id = v_actor and p.role = 'super_admin'
  ) then
    raise exception 'Only an authenticated Super Admin can change the marketplace switch.' using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'State whether third-party offers are enabled.' using errcode = '22023';
  end if;
  if p_enabled then
    if v_owner is null or char_length(v_owner) not between 3 and 200 or v_owner ~* v_placeholder then
      raise exception 'MARKETPLACE_APPROVAL_REQUIRED: an owner approval reference is required to enable third-party offers.' using errcode = '22023';
    end if;
    if v_ca is null or char_length(v_ca) not between 3 and 200 or v_ca ~* v_placeholder then
      raise exception 'MARKETPLACE_APPROVAL_REQUIRED: a Chartered Accountant approval reference is required to enable third-party offers.' using errcode = '22023';
    end if;
    if lower(v_owner) = lower(v_ca) then
      raise exception 'MARKETPLACE_APPROVAL_REQUIRED: the owner and Chartered Accountant approvals must be two separate references.' using errcode = '22023';
    end if;
  end if;
  -- One writer at a time, so "newest row wins" is unambiguous.
  perform pg_advisory_xact_lock(hashtext('public.marketplace_launch_approvals')::bigint);
  insert into public.marketplace_launch_approvals (
    third_party_offers_enabled, owner_approval_reference, ca_approval_reference, reason, recorded_by, recorded_at
  ) values (
    p_enabled, v_owner, v_ca, nullif(btrim(coalesce(p_reason, '')), ''), v_actor, clock_timestamp()
  ) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.record_marketplace_launch_approval(boolean, text, text, text) from public, anon, service_role;
grant execute on function public.record_marketplace_launch_approval(boolean, text, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Has an OWNER of this seller accepted the current Seller Agreement?
--    Fails closed when no current version is registered.
-- ----------------------------------------------------------------------------
create or replace function public.seller_agreement_is_current(p_seller_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p_seller_id is not null and exists (
    select 1
      from public.legal_document_current_versions v
      join public.legal_document_acceptances a
        on a.document_key = v.document_key and a.document_version = v.document_version
      join public.seller_members m
        on m.profile_id = a.user_id and m.seller_id = p_seller_id and m.member_role = 'owner'
     where v.document_key = 'seller-agreement'
  )
$$;
revoke all on function public.seller_agreement_is_current(uuid) from public, anon, authenticated;
grant execute on function public.seller_agreement_is_current(uuid) to service_role;

-- Read model for the application (seller sees own seller only; Admin any).
create or replace function public.seller_offer_gate_status(p_seller_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.role() is distinct from 'service_role'
     and (auth.uid() is null
          or not (public.is_admin_or_above() or public.is_member_of_seller(p_seller_id))) then
    raise exception 'Access denied.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'marketplace_open', public.third_party_offers_enabled(),
    'agreement_current', public.seller_agreement_is_current(p_seller_id),
    'agreement_version', (select document_version from public.legal_document_current_versions
                           where document_key = 'seller-agreement')
  );
end;
$$;
revoke all on function public.seller_offer_gate_status(uuid) from public, anon;
grant execute on function public.seller_offer_gate_status(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. The gates.
-- ----------------------------------------------------------------------------
create or replace function public.enforce_seller_offer_launch_gate()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_going_live boolean;
begin
  if tg_op = 'INSERT' then
    v_going_live := new.is_active or new.moderation_status = 'approved';
  else
    v_going_live := (new.is_active and not old.is_active)
      or (new.moderation_status = 'approved' and old.moderation_status is distinct from 'approved');
  end if;
  if not v_going_live then
    return new;
  end if;
  if not public.third_party_offers_enabled() then
    raise exception 'MARKETPLACE_NOT_OPEN: third-party seller offers stay disabled until the owner and the Chartered Accountant have approved the marketplace launch requirements.'
      using errcode = '23514';
  end if;
  if not public.seller_agreement_is_current(new.seller_id) then
    raise exception 'SELLER_AGREEMENT_REQUIRED: the seller''s owner must accept the current Seller Agreement before an offer can be activated or published.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_seller_offer_launch_gate() from public, anon, authenticated;

drop trigger if exists trg_seller_offer_launch_gate on public.seller_offers;
create trigger trg_seller_offer_launch_gate
  before insert or update on public.seller_offers
  for each row execute function public.enforce_seller_offer_launch_gate();

create or replace function public.enforce_order_item_marketplace_gate()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_seller uuid;
begin
  if new.source_type is distinct from 'seller' and new.seller_offer_id is null then
    return new;
  end if;
  if not public.third_party_offers_enabled() then
    raise exception 'MARKETPLACE_NOT_OPEN: third-party seller offers cannot be ordered yet.' using errcode = '23514';
  end if;
  select so.seller_id into v_seller from public.seller_offers so where so.id = new.seller_offer_id;
  if v_seller is null or not public.seller_agreement_is_current(v_seller) then
    raise exception 'SELLER_AGREEMENT_REQUIRED: this seller has not accepted the current Seller Agreement.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_order_item_marketplace_gate() from public, anon, authenticated;

drop trigger if exists trg_order_item_marketplace_gate on public.order_items;
create trigger trg_order_item_marketplace_gate
  before insert on public.order_items
  for each row execute function public.enforce_order_item_marketplace_gate();
