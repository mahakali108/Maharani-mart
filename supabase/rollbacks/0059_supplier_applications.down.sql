-- Rollback for 0059_supplier_applications.sql — FAIL-SAFE, GUARDED.
--
-- This script ABORTS (raises, changing nothing) when any of these exist:
--   * rows in `suppliers` or `supplier_documents` (real application data), or
--   * objects in storage.objects for bucket 'supplier-documents'.
-- Rationale: dropping those tables would permanently delete supplier
-- application/document metadata, and deleting metadata does not back up
-- the files themselves. Ordinary database backups do NOT recover Storage
-- file contents — storage objects need their own backup/retention plan.
-- Before a data-bearing rollback, an operator must therefore:
--   1. export `suppliers` and `supplier_documents` with a reviewed
--      retention procedure, and
--   2. back up/export every object in the 'supplier-documents' bucket
--      through Storage tooling, and
--   3. only then remove those rows/objects deliberately and re-run this
--      script.
--
-- The 'supplier-documents' BUCKET ROW IS NEVER DELETED BY THIS SCRIPT:
-- migration 0059 created it with `on conflict do nothing`, so the bucket
-- might predate 0059 and cannot be confidently attributed to it. An
-- operator may delete the bucket manually in the Supabase dashboard only
-- after verifying it was created by 0059 and is empty/backed up.
-- This script removes only objects confidently owned by 0059: its two
-- tables, its two functions, its enum, and its bucket-scoped policies.
-- It touches no other bucket, table, or policy.
--
-- DO NOT run this against a configured or remote project as part of any
-- automated flow; it is an operator-run, reviewed procedure.

do $$
begin
  if (select count(*) from suppliers) > 0
     or (select count(*) from supplier_documents) > 0 then
    raise exception
      'ROLLBACK ABORTED: supplier application/document records exist. Export them under a reviewed retention procedure, back up storage objects separately, delete them deliberately, then re-run.';
  end if;
  if (select count(*) from storage.objects where bucket_id = 'supplier-documents') > 0 then
    raise exception
      'ROLLBACK ABORTED: storage objects exist in bucket supplier-documents. Back them up through Storage tooling (database backups do not cover file contents), delete them deliberately, then re-run.';
  end if;
end $$;

-- Safe point: no application rows, no document rows, no storage objects.
drop policy if exists "supplier_documents_bucket_read" on storage.objects;
drop policy if exists "supplier_documents_bucket_write" on storage.objects;
drop policy if exists "supplier_documents_bucket_delete" on storage.objects;
-- NOTE: storage.buckets row 'supplier-documents' intentionally left in
-- place (see header). Remove it manually only if proven created by 0059.

revoke execute on function submit_supplier_application(text, text, text, text, text, text, text, text, text, text, text) from anon, authenticated;
drop function if exists submit_supplier_application(text, text, text, text, text, text, text, text, text, text, text);
drop function if exists enforce_supplier_review();
drop function if exists set_suppliers_updated_at();

drop table if exists supplier_documents;
drop table if exists suppliers;
drop type if exists supplier_application_status;
