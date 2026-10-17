-- ============================================================================
-- 0059: Supplier applications (V1, application-only — approved design)
--
-- WHAT THIS ADDS
--   * `suppliers` — supplier application + master record in one table; the
--     lifecycle is the `status` enum (pending → approved / rejected, and
--     suspended for a previously approved supplier). An approved row IS the
--     supplier record of Maharani Traders. No supplier login, no supplier
--     role, no supplier-owned inventory, no marketplace, no settlements.
--   * `supplier_documents` + PRIVATE `supplier-documents` storage bucket —
--     documents are uploaded by Maharani reviewers (admin/super_admin via
--     the app; staff role has no application access in V1) after receiving
--     them offline. Applicants cannot upload in V1.
--   * `submit_supplier_application(...)` — the ONLY write path open to the
--     public application form. SECURITY DEFINER, pinned search_path,
--     EXECUTE granted to anon/authenticated, never to PUBLIC implicitly.
--
-- HONESTY RULES
--   * GSTIN is applicant-declared text, format-checked only. Nothing in
--     this migration (or the app) marks a GSTIN or business as "verified":
--     `gstin_verified` defaults false and the submission function cannot
--     set it; only a reviewer who has seen documents may, via the app.
--   * Legacy GRN free-text `supplier_reference` is untouched. No automatic
--     matching/backfill of existing GRNs to supplier rows happens here.
--
-- RLS / PRIVILEGE MODEL (least privilege)
--   * Table privileges for anon are revoked entirely; authenticated gets
--     SELECT/UPDATE only, further narrowed by RLS to admin-or-above.
--     INSERT/DELETE are granted to NO api role: inserts happen solely
--     through the definer function; deletion is not offered at all.
--   * supplier_documents: SELECT admin-or-above; INSERT admin-or-above
--     (the app additionally requires `suppliers.documents.manage`);
--     no UPDATE/DELETE grant or policy for api roles. V1 supports upload
--     only: document deletion is intentionally NOT offered (audit record
--     retention), in the app or via direct API access.
--
-- ROLLBACK: see supabase/rollbacks/0059_supplier_applications.down.sql
-- (drops both tables, the bucket row, the function and the enum — data
-- destroying, to be run only before any real application data exists or
-- after exporting the tables).
-- ============================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'supplier_application_status') then
    create type supplier_application_status as enum ('pending', 'approved', 'rejected', 'suspended');
  end if;
end $$;

create table if not exists suppliers (
  id uuid primary key default uuid_generate_v4(),
  business_name text not null check (char_length(btrim(business_name)) between 2 and 120),
  legal_name text check (legal_name is null or char_length(btrim(legal_name)) between 2 and 160),
  contact_name text not null check (char_length(btrim(contact_name)) between 2 and 80),
  phone text not null check (phone ~ '^[6-9][0-9]{9}$'),
  email text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  address_line text check (address_line is null or char_length(address_line) <= 300),
  city text check (city is null or char_length(city) <= 80),
  state text check (state is null or char_length(state) <= 80),
  pincode text check (pincode is null or pincode ~ '^[0-9]{6}$'),
  -- Applicant-declared only; see header. Format (15-char GSTIN) is
  -- validated, existence/ownership is NOT verified by any code here.
  gstin text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  gstin_verified boolean not null default false,
  product_categories text check (product_categories is null or char_length(product_categories) <= 500),
  status supplier_application_status not null default 'pending',
  rejection_reason text check (rejection_reason is null or char_length(rejection_reason) <= 500),
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint suppliers_rejection_reason_required
    check (status <> 'rejected' or rejection_reason is not null),
  constraint suppliers_review_stamp_required
    check (status = 'pending' or (reviewed_by is not null and reviewed_at is not null))
);

-- Exactly one live (pending) application per phone number. Re-application
-- is possible after a rejection (that row is no longer pending).
create unique index if not exists uq_suppliers_pending_phone
  on suppliers (phone) where status = 'pending';
create unique index if not exists uq_suppliers_pending_email
  on suppliers (lower(email)) where status = 'pending' and email is not null;
create index if not exists idx_suppliers_status_created
  on suppliers (status, created_at desc);

create table if not exists supplier_documents (
  id uuid primary key default uuid_generate_v4(),
  supplier_id uuid not null references suppliers(id) on delete cascade,
  doc_type text not null check (doc_type in
    ('gstin_certificate', 'pan_card', 'bank_proof', 'trade_licence', 'address_proof', 'other')),
  file_url text not null,          -- object path inside the private bucket, never a public URL
  file_name text not null check (char_length(file_name) between 1 and 200),
  uploaded_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_supplier_documents_supplier
  on supplier_documents (supplier_id, created_at desc);

-- ----------------------------------------------------------------------------
-- Review-workflow enforcement at the DATABASE boundary (audit Fix 1 / M2).
-- The RLS update policy above only proves "admin-or-above"; without this
-- trigger, an admin using direct PostgREST could bypass the app workflow:
-- approve an already-reviewed row, rewrite applicant fields, forge another
-- reviewer, or flip gstin_verified. This trigger makes those impossible
-- for API callers (anon/authenticated). The database owner / service_role
-- (migrations, vetted corrections) are not API callers and bypass it.
--   * applicant-declared fields are immutable after submission;
--   * status may only move pending -> approved / pending -> rejected /
--     approved -> suspended (suspend has no V1 UI; it exists for a future
--     reviewed suspension flow and still requires the stamp below);
--   * a transition must stamp reviewed_by = auth.uid() and reviewed_at
--     within 5 minutes of now() — forged reviewer ids/timestamps raise;
--   * gstin_verified can never change via an API update in V1 (no app flow
--     sets it; verification remains a human, document-based judgement that
--     a future reviewed flow may stamp under its own rules).
-- ----------------------------------------------------------------------------
create or replace function enforce_supplier_review() returns trigger as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.business_name is distinct from old.business_name
     or new.legal_name is distinct from old.legal_name
     or new.contact_name is distinct from old.contact_name
     or new.phone is distinct from old.phone
     or new.email is distinct from old.email
     or new.address_line is distinct from old.address_line
     or new.city is distinct from old.city
     or new.state is distinct from old.state
     or new.pincode is distinct from old.pincode
     or new.gstin is distinct from old.gstin
     or new.product_categories is distinct from old.product_categories
     or new.created_at is distinct from old.created_at then
    raise exception 'Supplier application details are immutable after submission.';
  end if;

  if new.gstin_verified is distinct from old.gstin_verified then
    raise exception 'GSTIN verification cannot be changed through this path.';
  end if;

  if new.status is distinct from old.status then
    if not is_admin_or_above() then
      raise exception 'Only an Admin or Super Admin may review a supplier application.';
    end if;
    if not (
      (old.status = 'pending' and new.status in ('approved', 'rejected'))
      or (old.status = 'approved' and new.status = 'suspended')
    ) then
      raise exception 'Invalid supplier status transition: % -> %.', old.status, new.status;
    end if;
    if new.reviewed_by is distinct from auth.uid() then
      raise exception 'reviewed_by must be the reviewing user.';
    end if;
    if new.reviewed_at is null
       or new.reviewed_at < now() - interval '5 minutes'
       or new.reviewed_at > now() + interval '5 minutes' then
      raise exception 'reviewed_at must be the time of review.';
    end if;
    if new.status = 'approved' and new.rejection_reason is not null then
      raise exception 'An approved application cannot carry a rejection reason.';
    end if;
  else
    -- No transition: reviewer stamp is part of the decision record.
    if new.reviewed_by is distinct from old.reviewed_by
       or new.reviewed_at is distinct from old.reviewed_at
       or new.rejection_reason is distinct from old.rejection_reason then
      raise exception 'Review fields can only change as part of a review decision.';
    end if;
  end if;

  return new;
end;
$$ language plpgsql set search_path = public, pg_temp;

drop trigger if exists trg_suppliers_enforce_review on suppliers;
create trigger trg_suppliers_enforce_review
  before update on suppliers
  for each row execute function enforce_supplier_review();

-- updated_at maintenance (no shared helper exists in this schema).
create or replace function set_suppliers_updated_at() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql set search_path = public, pg_temp;

drop trigger if exists trg_suppliers_updated_at on suppliers;
create trigger trg_suppliers_updated_at
  before update on suppliers
  for each row execute function set_suppliers_updated_at();

drop trigger if exists trg_audit_suppliers on suppliers;
create trigger trg_audit_suppliers
  after insert or update or delete on suppliers
  for each row execute function log_audit();
drop trigger if exists trg_audit_supplier_documents on supplier_documents;
create trigger trg_audit_supplier_documents
  after insert or update or delete on supplier_documents
  for each row execute function log_audit();

alter table suppliers enable row level security;
alter table supplier_documents enable row level security;

-- Least-privilege table grants: RLS is the row boundary, grants are the
-- operation boundary. Submission goes through the definer function only.
revoke all on suppliers from anon, authenticated;
grant select, update on suppliers to authenticated;
revoke all on supplier_documents from anon, authenticated;
grant select, insert on supplier_documents to authenticated;

drop policy if exists "suppliers_admin_read" on suppliers;
create policy "suppliers_admin_read" on suppliers
  for select using (is_admin_or_above());
drop policy if exists "suppliers_admin_update" on suppliers;
create policy "suppliers_admin_update" on suppliers
  for update using (is_admin_or_above()) with check (is_admin_or_above());

drop policy if exists "supplier_documents_admin_read" on supplier_documents;
create policy "supplier_documents_admin_read" on supplier_documents
  for select using (is_admin_or_above());
drop policy if exists "supplier_documents_admin_insert" on supplier_documents;
create policy "supplier_documents_admin_insert" on supplier_documents
  for insert with check (is_admin_or_above());

-- ----------------------------------------------------------------------------
-- Public submission. SECURITY DEFINER with pinned search_path; forces
-- status='pending', gstin_verified=false and no reviewer fields regardless
-- of caller input (the signature simply has no such parameters).
-- ----------------------------------------------------------------------------
create or replace function submit_supplier_application(
  p_business_name text,
  p_legal_name text,
  p_contact_name text,
  p_phone text,
  p_email text,
  p_address_line text,
  p_city text,
  p_state text,
  p_pincode text,
  p_gstin text,
  p_product_categories text
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into suppliers (
    business_name, legal_name, contact_name, phone, email,
    address_line, city, state, pincode, gstin, product_categories, status
  ) values (
    btrim(p_business_name),
    nullif(btrim(coalesce(p_legal_name, '')), ''),
    btrim(p_contact_name),
    btrim(p_phone),
    nullif(lower(btrim(coalesce(p_email, ''))), ''),
    nullif(btrim(coalesce(p_address_line, '')), ''),
    nullif(btrim(coalesce(p_city, '')), ''),
    nullif(btrim(coalesce(p_state, '')), ''),
    nullif(btrim(coalesce(p_pincode, '')), ''),
    nullif(upper(btrim(coalesce(p_gstin, ''))), ''),
    nullif(btrim(coalesce(p_product_categories, '')), ''),
    'pending'
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function submit_supplier_application(text, text, text, text, text, text, text, text, text, text, text) from public;
grant execute on function submit_supplier_application(text, text, text, text, text, text, text, text, text, text, text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Private document bucket (mirrors retailer-documents, 0006). Objects live
-- under suppliers/<supplier_id>/documents/... (lib/media path layout) and
-- are only reachable through signed URLs minted server-side for reviewers.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('supplier-documents', 'supplier-documents', false, 10485760,
        array['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

drop policy if exists "supplier_documents_bucket_read" on storage.objects;
create policy "supplier_documents_bucket_read" on storage.objects
  for select using (bucket_id = 'supplier-documents' and is_admin_or_above());
drop policy if exists "supplier_documents_bucket_write" on storage.objects;
create policy "supplier_documents_bucket_write" on storage.objects
  for insert with check (bucket_id = 'supplier-documents' and is_admin_or_above());
-- V1 is upload-only: there is deliberately NO delete policy for this
-- bucket, so neither the app nor direct Storage API access can delete
-- supplier documents (audit Fix M-1). The drop below only removes the
-- policy if an earlier unapplied draft of this migration created it in a
-- disposable environment; it creates no deletion access.
drop policy if exists "supplier_documents_bucket_delete" on storage.objects;

-- ============================================================================
-- END OF MIGRATION 0059 (NOT applied to any production project by this file;
-- applying it requires the owner's verified-target procedure.)
-- ============================================================================
