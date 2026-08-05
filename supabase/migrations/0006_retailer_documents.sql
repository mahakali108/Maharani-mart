-- ============================================================================
-- 0006: Retailer documents + audit_logs RLS
--
-- SECURITY FINDING fixed here (flagged but deliberately deferred in
-- 0005's comments): `audit_logs` was created in 0001_init.sql without
-- RLS ever being enabled. The Admin Dashboard "Recent Activities" and
-- the Pricing "Price History" views in this migration's companion
-- code both read from audit_logs, so this can no longer be deferred.
--
-- `schemes` still has no RLS and is intentionally NOT touched here —
-- no UI in this phase reads/writes it. Do not build against `schemes`
-- until it gets the same treatment in its own reviewed migration.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. audit_logs RLS — staff+ read-only. Rows are written exclusively by
--    the `log_audit()` trigger function (security definer), so there is
--    deliberately no insert/update/delete policy for ordinary clients.
-- ----------------------------------------------------------------------------
alter table audit_logs enable row level security;
create policy "audit_logs_staff_read" on audit_logs for select using (is_staff_or_above());

-- ----------------------------------------------------------------------------
-- 2. Retailer documents (KYC / registration paperwork — GSTIN
--    certificate, shop photo, ID proof, etc.) Admin-managed in Phase
--    2A; retailer self-upload is a Phase 2B addition once the
--    retailer-facing account settings screen exists.
-- ----------------------------------------------------------------------------
create table retailer_documents (
  id uuid primary key default uuid_generate_v4(),
  retailer_id uuid not null references retailers(id) on delete cascade,
  doc_type text not null,          -- e.g. 'gstin_certificate', 'shop_photo', 'id_proof', 'other'
  file_url text not null,
  file_name text not null,
  uploaded_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create index idx_retailer_documents_retailer on retailer_documents(retailer_id);

alter table retailer_documents enable row level security;

create policy "retailer_documents_read" on retailer_documents for select using (
  retailer_id = auth.uid() or is_staff_or_above()
);
create policy "retailer_documents_staff_write" on retailer_documents for insert with check (is_staff_or_above());
create policy "retailer_documents_staff_delete" on retailer_documents for delete using (is_staff_or_above());

create trigger trg_audit_retailer_documents after insert or update or delete on retailer_documents
  for each row execute function log_audit();

-- ----------------------------------------------------------------------------
-- 3. Storage bucket for retailer documents — PRIVATE (unlike
--    product-images/banners/avatars/brand-logos, which are public).
--    KYC documents must never be publicly readable by URL guessing.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('retailer-documents', 'retailer-documents', false, 10485760, array['image/png','image/jpeg','image/webp','application/pdf'])
on conflict (id) do nothing;

create policy "retailer_documents_bucket_read" on storage.objects
  for select using (
    bucket_id = 'retailer-documents'
    and (is_staff_or_above() or (storage.foldername(name))[1] = auth.uid()::text)
  );
create policy "retailer_documents_bucket_write" on storage.objects
  for insert with check (bucket_id = 'retailer-documents' and is_staff_or_above());
create policy "retailer_documents_bucket_delete" on storage.objects
  for delete using (bucket_id = 'retailer-documents' and is_staff_or_above());

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
