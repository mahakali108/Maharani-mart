-- ============================================================================
-- READ-ONLY audit queries — project `fhrmsrumsraprvutrpeo` (Maharani-mart).
--
-- Every statement below is a SELECT (or a VALUES/CTE inside one). There is no
-- INSERT, UPDATE, DELETE, DDL, GRANT, REVOKE, storage write or function call
-- that mutates anything. It is safe to paste into the Supabase SQL editor
-- during a maintenance window, and it returns nothing secret: no key, token,
-- password, customer name, phone number, order total or document content.
--
-- Run each block separately and keep the output. It is the evidence the
-- migration decisions in docs/SQL_AND_PAGE_AUDIT_2026-10-24.md depend on;
-- without it that document is repository-only analysis.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Migration history: what the project believes it has applied
--    Compare this list with `ls supabase/migrations` in the repository.
--    A version present here but absent from the repo means history was
--    rewritten; a repo version absent here is unapplied.
-- ---------------------------------------------------------------------------
select version, name, inserted_at
  from supabase_migrations.schema_migrations
 order by version desc;


-- ---------------------------------------------------------------------------
-- 2. Migration numbering sanity
--    expected_gap: 0061 never existed (there is no 0061 file in the repo).
--    0075 and 0076 are RESERVED and intentionally missing: 0075 is the
--    on-hold 120-day retention migration, 0076 the deferred banner alt_text.
--    0079+ must not be allocated without checking open PRs (see §7 of the
--    audit document).
-- ---------------------------------------------------------------------------
with repo_versions(version, note) as (
  values
    ('0001', 'init'), ('0002', 'auth trigger'), ('0003', 'storage buckets'),
    ('0004', 'product packs'), ('0005', 'master data'), ('0006', 'retailer documents'),
    ('0007', 'pack ordering'), ('0008', 'order status history'), ('0009', 'order ops'),
    ('0010', 'route assignment'), ('0011', 'retailer row fix'), ('0012', 'phone conflict'),
    ('0013', 'rls + storage'), ('0014', 'salesman rls'), ('0015', 'favorites'),
    ('0016', 'storage paths'), ('0017', 'inventory fefo'), ('0018', 'ai security'),
    ('0019', 'ai forecast'), ('0020', 'control center'), ('0021', 'category bucket'),
    ('0022', 'case pricing'), ('0023', 'sku optional'), ('0024', 'pack images'),
    ('0025', 'cost lockdown'), ('0026', 'piece pricing'), ('0027', 'catalog constraints'),
    ('0028', 'pack gallery'), ('0029', 'wallet ledger'), ('0030', 'wallet security'),
    ('0031', 'wallet baseline'), ('0032', 'address book'), ('0033', 'saved carts'),
    ('0034', 'product feedback'), ('0035', 'profile rpc'), ('0036', 'shipping address'),
    ('0037', 'staff scope'), ('0038', 'targets'), ('0039', 'follow ups'),
    ('0040', 'schemes audit'), ('0041', 'area stock'), ('0042', 'order state machine'),
    ('0043', 'deliveries'), ('0044', 'payment collections'), ('0045', 'proof buckets'),
    ('0046', 'smoke fixture'), ('0047', 'banner content'), ('0048', 'support tickets'),
    ('0049', 'credit terms'), ('0050', 'catalog admin'), ('0051', 'coupons'),
    ('0052', 'security hardening'), ('0053', 'coin refund'), ('0054', 'pack stock'),
    ('0055', 'retention (on hold)'), ('0056', 'mobile checkout'), ('0057', 'definer hardening'),
    ('0058', 'saran default'), ('0059', 'supplier applications'), ('0060', 'supplier rate limit'),
    ('0062', 'seller identity'), ('0063', 'seller offers'), ('0064', 'split order identity'),
    ('0065', 'checkout split rpcs'), ('0066', 'fulfilment'), ('0067', 'seller settlement'),
    ('0068', 'seller governance'), ('0069', 'seller portal'), ('0070', 'seller invite only'),
    ('0071', 'gaya default'), ('0072', 'super admin invitations'), ('0073', 'delivery pins'),
    ('0074', 'banner lifecycle'), ('0077', 'banner draft artwork'),
    ('0078', 'privilege hardening')
)
select r.version,
       r.note,
       case when m.version is null then 'NOT APPLIED' else 'recorded as applied' end as history_state
  from repo_versions r
  left join supabase_migrations.schema_migrations m
         on split_part(m.version, '_', 1) = r.version
 order by r.version;


-- ---------------------------------------------------------------------------
-- 3. Migration 0074 — does the schema actually match the file?
--    Expected: image_url_mobile text NULL, status text NOT NULL DEFAULT
--    'published', constraint banners_status_check, index banners_public_feed_idx,
--    and banners_read/banners_write policies.
-- ---------------------------------------------------------------------------
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public' and table_name = 'banners'
 order by ordinal_position;

select conname, pg_get_constraintdef(oid) as definition
  from pg_constraint
 where conrelid = 'public.banners'::regclass
 order by conname;

select indexname, indexdef
  from pg_indexes
 where schemaname = 'public' and tablename = 'banners'
 order by indexname;

select policyname, cmd, qual, with_check
  from pg_policies
 where schemaname = 'public' and tablename = 'banners'
 order by policyname;

-- Data state that 0074 changes: every pre-existing row must be 'published'.
select status, count(*) as banners
  from public.banners
 group by status
 order by status;


-- ---------------------------------------------------------------------------
-- 4. Migration 0077 — private banner-drafts bucket (expected: absent until
--    the owner approves it; if present it must be private with 4 policies).
-- ---------------------------------------------------------------------------
select id, public, file_size_limit, allowed_mime_types
  from storage.buckets
 order by id;

select policyname, cmd, qual, with_check
  from pg_policies
 where schemaname = 'storage' and tablename = 'objects'
   and (qual like '%banner-drafts%' or with_check like '%banner-drafts%')
 order by policyname;

select column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema = 'public' and table_name = 'banners'
   and column_name in ('draft_image_path', 'draft_image_mobile_path');


-- ---------------------------------------------------------------------------
-- 5. Migration 0078 — privilege posture of the three hardened functions.
--    Expected after 0078: anon = false and authenticated = false for the two
--    helpers; handle_new_user has no API-role grant at all.
-- ---------------------------------------------------------------------------
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef                               as security_definer,
       p.proconfig                               as settings,
       has_function_privilege('anon', p.oid, 'EXECUTE')          as anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE')  as authenticated_exec,
       has_function_privilege('service_role', p.oid, 'EXECUTE')   as service_role_exec
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in (
     'fefo_plan_for_product',
     'current_offer_floor_paise',
     'handle_new_user',
     'is_phone_registered',
     'submit_supplier_application',
     'can_current_staff_read_profile'
   )
 order by p.proname;


-- ---------------------------------------------------------------------------
-- 6. Banner artwork writes — is Storage still looser than the table?
--    Expected after 0078: is_admin_or_above() for insert/update/delete.
-- ---------------------------------------------------------------------------
select policyname, cmd, roles, qual, with_check
  from pg_policies
 where schemaname = 'storage' and tablename = 'objects'
   and (qual like '%''banners''%' or with_check like '%''banners''%')
 order by policyname;


-- ---------------------------------------------------------------------------
-- 7. RLS coverage across the whole public schema (read-only summary).
--    Three tables are intentionally policy-less and service-role-only:
--    cleanup_runs, data_retention_rules, supplier_application_rate_limits.
-- ---------------------------------------------------------------------------
select c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       (select count(*) from pg_policies p
         where p.schemaname = 'public' and p.tablename = c.relname) as policies
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r'
 order by c.relrowsecurity, policies, c.relname;


-- ---------------------------------------------------------------------------
-- 8. SECURITY DEFINER hygiene: every definer function must pin search_path.
--    Expected: 0 rows.
-- ---------------------------------------------------------------------------
select p.proname, pg_get_function_identity_arguments(p.oid) as args
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.prosecdef
   and not exists (
     select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg
      where cfg like 'search_path=%'
   )
 order by p.proname;


-- ---------------------------------------------------------------------------
-- 9. Banner object inventory — COUNTS ONLY, no customer data.
--    Read-only: confirms which buckets hold banner artwork and how much of it
--    is unreferenced. Does not read or expose object contents.
-- ---------------------------------------------------------------------------
select bucket_id, count(*) as objects, coalesce(sum((metadata->>'size')::bigint), 0) as bytes
  from storage.objects
 where bucket_id in ('banners', 'banner-drafts')
 group by bucket_id
 order by bucket_id;

select count(*) as banners_total,
       count(*) filter (where is_active) as banners_active,
       count(*) filter (where starts_at is not null) as banners_scheduled
  from public.banners;


-- ---------------------------------------------------------------------------
-- 10. Retention engine: is the on-hold 120-day deletion ARMED?
--     Expected by owner decision: no enabled business_120 rules should be
--     running while legal/accountant review is outstanding. This query only
--     reads the registry; it does not run, schedule or change anything.
-- ---------------------------------------------------------------------------
select target_key, category, table_name, retention_days, enabled
  from public.data_retention_rules
 order by deletion_order;

select status, count(*) as runs, max(completed_at) as last_completed
  from public.cleanup_runs
 group by status
 order by status;
