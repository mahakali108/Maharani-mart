-- ============================================================================
-- READ-ONLY DIAGNOSTIC — migration 0109 dependency failure
--   ERROR: 42P01: MIGRATION ORDER VIOLATION: 0109 requires base catalog, seller,
--   supplier, membership, banner and control-center tables (0001–0108).
--   CONTEXT: PL/pgSQL function inline_code_block line 15 at RAISE
--
-- Project this is written for: `fhrmsrumsraprvutrpeo` (Maharani-mart).
--
-- SAFETY: every statement below is a SELECT (or a WITH ... SELECT). There is no
-- INSERT, UPDATE, DELETE, MERGE, TRUNCATE, ALTER, DROP, CREATE, GRANT, REVOKE,
-- COMMENT, CALL, DO block, `supabase migration repair`, or any other write.
-- Nothing here changes schema, data, privileges or migration history, and it
-- returns no secret: no key, token, password, phone number, e-mail address,
-- customer name or order content.
--
-- HOW TO USE
--   1. Open the SQL editor for the project shown in the dashboard header and
--      CONFIRM the project ref is `fhrmsrumsraprvutrpeo` (the legacy project
--      `gbxhmffsbsfhdrfuwurx` must not be used for this project's migrations).
--   2. Run each numbered block separately and keep the output.
--   3. Block 1 is the verdict. If any row says PRESENT where you expect MISSING
--      (or the reverse), the error you saw did not come from this database.
--
-- STATUS VOCABULARY USED BELOW
--   PRESENT         the object resolves in this database
--   MISSING         the object does not exist here
--   WRONG SCHEMA    a same-named object exists, but in another schema
--   WRONG SIGNATURE the function exists with different argument types
--   WRONG COLUMN    the table exists but lacks a column 0109 reads
--   WRONG ORDER     the object exists but a later migration in the chain that
--                   must run first has not been applied yet
--   LEDGER MISMATCH the migration ledger does not agree with the file sequence
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. VERDICT — the 19 objects the 0109 pre-flight guard checks.
--    `verdict` is the one column that matters.
-- ---------------------------------------------------------------------------
with required(kind, obj, expected_migration) as (
  values
    ('relation', 'public.products',                             '0001_init'),
    ('relation', 'public.banners',                              '0001_init'),
    ('relation', 'public.super_admin_audit_logs',               '0020_super_admin_control_center'),
    ('relation', 'public.product_pricing_tiers',                '0022_case_based_pricing'),
    ('relation', 'public.product_packs',                        '0004_product_packs'),
    ('relation', 'public.suppliers',                            '0059_supplier_applications'),
    ('relation', 'public.supplier_application_rate_limits',     '0060_supplier_application_rate_limit'),
    ('relation', 'public.sellers',                              '0062_seller_identity'),
    ('relation', 'public.seller_offers',                        '0063_seller_offers'),
    ('relation', 'public.seller_offer_tiers',                   '0069_seller_portal_access'),
    ('relation', 'public.membership_plans',                     '0080_retailer_memberships_and_loyalty'),
    ('relation', 'public.retailer_memberships',                 '0080_retailer_memberships_and_loyalty'),
    ('function', 'public.is_admin_or_above()',                                   '0052_phase0_security_hardening'),
    ('function', 'public.is_staff_or_above()',                                   '0052_phase0_security_hardening'),
    ('function', 'public.current_user_role()',                                   '0052_phase0_security_hardening'),
    ('function', 'public.is_retailer_area_assigned_to_current_staff(uuid)',      '0037_staff_scope_policies'),
    ('function', 'public.is_active_seller_member(uuid)',                          '0072_super_admin_seller_invitations'),
    ('function', 'public.consume_supplier_application_rate_limit(text,text,integer,integer)', '0060_supplier_application_rate_limit'),
    ('function', 'public.log_audit()',                                           '0057_security_definer_hardening')
),
resolved as (
  select r.kind,
         r.obj,
         r.expected_migration,
         case when r.kind = 'relation'
              then to_regclass(r.obj)::text
              else to_regprocedure(r.obj)::text
         end as resolved_to,
         -- same-named object living in a different schema
         case when r.kind = 'relation'
              then (select n.nspname || '.' || c.relname
                      from pg_class c
                      join pg_namespace n on n.oid = c.relnamespace
                     where c.relname = split_part(r.obj, '.', 2)
                       and n.nspname <> 'public'
                     order by n.nspname limit 1)
              else (select n.nspname || '.' || p.proname || '(' ||
                           pg_get_function_identity_arguments(p.oid) || ')'
                      from pg_proc p
                      join pg_namespace n on n.oid = p.pronamespace
                     where p.proname = split_part(split_part(r.obj, '.', 2), '(', 1)
                       and n.nspname <> 'public'
                     order by n.nspname limit 1)
         end as elsewhere,
         case when r.kind = 'function'
              then (select count(*)
                      from pg_proc p
                      join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public'
                       and p.proname = split_part(split_part(r.obj, '.', 2), '(', 1))
              else null
         end as same_name_functions
    from required r
)
select kind,
       obj                                as required_object,
       expected_migration                 as created_by,
       case
         when resolved_to is not null                     then 'PRESENT'
         when elsewhere is not null                       then 'WRONG SCHEMA'
         when kind = 'function' and same_name_functions > 0 then 'WRONG SIGNATURE'
         else 'MISSING'
       end                                as verdict,
       resolved_to                        as resolved_as,
       elsewhere                          as object_found_elsewhere,
       same_name_functions                as functions_with_that_name_in_public
  from resolved
 order by case when resolved_to is null then 0 else 1 end,
          kind desc,
          expected_migration,
          obj;


-- ---------------------------------------------------------------------------
-- 2. SUMMARY — one row, so the verdict is unambiguous.
-- ---------------------------------------------------------------------------
with required(kind, obj) as (
  values
    ('relation', 'public.products'), ('relation', 'public.banners'),
    ('relation', 'public.super_admin_audit_logs'), ('relation', 'public.product_pricing_tiers'),
    ('relation', 'public.product_packs'), ('relation', 'public.suppliers'),
    ('relation', 'public.supplier_application_rate_limits'), ('relation', 'public.sellers'),
    ('relation', 'public.seller_offers'), ('relation', 'public.seller_offer_tiers'),
    ('relation', 'public.membership_plans'), ('relation', 'public.retailer_memberships'),
    ('function', 'public.is_admin_or_above()'), ('function', 'public.is_staff_or_above()'),
    ('function', 'public.current_user_role()'),
    ('function', 'public.is_retailer_area_assigned_to_current_staff(uuid)'),
    ('function', 'public.is_active_seller_member(uuid)'),
    ('function', 'public.consume_supplier_application_rate_limit(text,text,integer,integer)'),
    ('function', 'public.log_audit()')
),
checked as (
  select kind,
         case when kind = 'relation'
              then to_regclass(obj) is not null
              else to_regprocedure(obj) is not null
         end as present
    from required
)
select count(*)                                                          as objects_checked,
       count(*) filter (where present)                                    as present,
       count(*) filter (where not present)                                as missing,
       case when count(*) filter (where not present) = 0
            then 'GUARD SHOULD PASS in this database — the reported 42P01 did not originate here'
            else 'GUARD WILL FAIL here — objects above are genuinely absent'
       end                                                               as conclusion
  from checked;


-- ---------------------------------------------------------------------------
-- 3. MIGRATION HISTORY — what this database believes it has applied.
--    Compares the ledger with the repository file list and classifies each
--    repository migration as APPLIED / ABSENT / LEDGER MISMATCH.
--
--    Historical facts this encodes:
--      * 0061, 0075 and 0076 never existed in the repository (documented gaps).
--      * Checkout 0077 was produced by the Supabase CLI, so the ledger may hold
--        14-digit entries for it. `0103_security_advisor_remediation` is
--        recorded under version `20261115155706` (applied by the CLI).
--    Anything else that does not line up is a real ledger discrepancy.
-- ---------------------------------------------------------------------------
with repo(version, name) as (
  values
    ('0001','init'), ('0002','auth_trigger'), ('0003','storage_buckets'),
    ('0004','product_packs'), ('0005','master_data_delete_and_pricing'),
    ('0006','retailer_documents'), ('0007','pack_based_ordering'),
    ('0008','order_status_history_rls'), ('0009','order_operations_inventory'),
    ('0010','route_assignment_rls'), ('0011','fix_retailer_row_creation'),
    ('0012','fix_registration_phone_conflict'), ('0013','rls_and_storage_hardening'),
    ('0014','salesman_retailer_order_rls'), ('0015','retailer_favorites'),
    ('0016','storage_paths_category_bucket'), ('0017','inventory_batches_fefo_grn'),
    ('0018','maharani_ai_security'), ('0019','ai_demand_forecast'),
    ('0020','super_admin_control_center'), ('0021','ensure_category_images_bucket'),
    ('0022','case_based_pricing'), ('0023','sku_code_optional'),
    ('0024','pack_variant_images'), ('0025','cost_price_column_lockdown'),
    ('0026','case_and_loose_piece_pricing'), ('0027','powder_category_and_catalog_constraints'),
    ('0028','product_pack_gallery'), ('0029','retailer_wallet_ledger'),
    ('0030','wallet_rpc_security'), ('0031','wallet_outstanding_opening_baseline'),
    ('0032','retailer_address_book'), ('0033','retailer_saved_carts'),
    ('0034','retailer_product_feedback'), ('0035','retailer_profile_rpc_prefs_requests'),
    ('0036','order_shipping_address'), ('0037','staff_scope_policies'),
    ('0038','staff_targets_commissions'), ('0039','follow_ups'), ('0040','schemes_audit'),
    ('0041','area_stock_view'), ('0042','order_state_machine'), ('0043','deliveries_module'),
    ('0044','payment_collections'), ('0045','delivery_payment_proof_buckets'),
    ('0046','smoke_fixture'), ('0047','banner_content'), ('0048','support_tickets'),
    ('0049','credit_payment_terms'), ('0050','catalog_admin_upgrade'), ('0051','coupon_system'),
    ('0052','phase0_security_hardening'), ('0053','order_coin_refund'),
    ('0054','simplified_pack_stock'), ('0055','data_retention_cleanup'),
    ('0056','mobile_checkout_atomic'), ('0057','security_definer_hardening'),
    ('0058','saran_default_district'), ('0059','supplier_applications'),
    ('0060','supplier_application_rate_limit'), ('0062','seller_identity'),
    ('0063','seller_offers'), ('0064','split_order_identity'), ('0065','checkout_split_rpcs'),
    ('0066','fulfilment_and_delivery'), ('0067','seller_settlement'),
    ('0068','seller_governance'), ('0069','seller_portal_access'),
    ('0070','seller_invite_only'), ('0071','gaya_default_district'),
    ('0072','super_admin_seller_invitations'), ('0073','configured_delivery_pins'),
    ('0074','banner_lifecycle_and_variants'), ('0077','banner_draft_artwork'),
    ('0078','privilege_hardening'), ('0079','api_execute_hardening'),
    ('0080','retailer_memberships_and_loyalty'), ('0081','retailer_categories_and_approval'),
    ('0082','category_tier_pricing'), ('0083','retire_paid_membership'),
    ('0084','ai_data_retention_14_days'), ('0085','ordering_launch_readiness_atomic'),
    ('0086','catalog_seller_compliance_enforcement'),
    ('0087','phase_2d1_compliance_security_and_evidence_storage'),
    ('0088','refund_ledger_integrity'), ('0089','split_parent_stock_restoration'),
    ('0090','atomic_manual_wallet_reversal'), ('0091','seller_child_cancellation_refund'),
    ('0092','refund_replay_and_child_share_guard'), ('0093','loyalty_earn_rpc_hardening'),
    ('0094','delivery_trust_and_loyalty_integrity'),
    ('0095','legal_acceptance_and_privacy_requests'), ('0096','delivery_snapshot_integrity'),
    ('0097','atomic_split_order_cancellation'),
    ('0098','seller_agreement_and_marketplace_gate'), ('0099','atomic_delivery_completion'),
    ('0100','atomic_dispatch_failure_and_return'),
    ('0101','atomic_return_request_resolution'),
    ('0102','anonymous_read_policies_fail_closed'),
    ('0103','security_advisor_remediation'),
    ('0104','site_content_management'), ('0105','seed_site_content'),
    ('0106','first_super_admin_bootstrap'),
    ('0107','restore_cost_price_column_lockdown'), ('0108','publishing_integrity'),
    ('0109','phase3_business_control')
),
ledger as (
  select version, name from supabase_migrations.schema_migrations
)
select r.version,
       r.name,
       l.version                                   as ledger_version,
       l.name                                      as ledger_name,
       case
         when l.version is null                                   then 'ABSENT (not applied)'
         -- 0103 was applied by the Supabase CLI, so the ledger row is keyed
         -- 20261115155706 with the name '0103_security_advisor_remediation'.
         -- The SQL is byte-identical to the repository file, so this is KNOWN
         -- and is NOT a mismatch. Reconcile only if you deploy via CLI.
         when r.version = '0103' and l.version = '20261115155706'
              then 'APPLIED (CLI-recorded as 20261115155706 — KNOWN, content identical)'
         when l.name is not null and l.name <> r.name             then 'LEDGER MISMATCH (name differs)'
         else 'APPLIED'
       end                                         as ledger_state
  from repo r
  left join ledger l
         on l.version = r.version
         -- 0103 was applied by the CLI and is recorded under a 14-digit version.
         or (r.version = '0103' and l.name = '0103_security_advisor_remediation')
 order by r.version;


-- ---------------------------------------------------------------------------
-- 4. LEDGER ENTRIES THAT MATCH NO REPOSITORY MIGRATION FILE.
--    Any row here means the ledger contains a version the repository cannot
--    reproduce — the condition that makes Supabase CLI report
--    "Remote migration versions not found in local migrations directory".
-- ---------------------------------------------------------------------------
select m.version,
       m.name,
       length(m.version)                                                  as version_length,
       case
         when m.version like '2026%' and m.name like '0103_%' then 'KNOWN: CLI-recorded 0103'
         when length(m.version) = 14 and m.name like '0077_%' then 'KNOWN: CLI-recorded 0077'
         else 'UNEXPLAINED — investigate before any repair'
       end                                                                as classification
  from supabase_migrations.schema_migrations m
 where not exists (
         select 1 from (values
           ('0001'),('0002'),('0003'),('0004'),('0005'),('0006'),('0007'),('0008'),('0009'),('0010'),
           ('0011'),('0012'),('0013'),('0014'),('0015'),('0016'),('0017'),('0018'),('0019'),('0020'),
           ('0021'),('0022'),('0023'),('0024'),('0025'),('0026'),('0027'),('0028'),('0029'),('0030'),
           ('0031'),('0032'),('0033'),('0034'),('0035'),('0036'),('0037'),('0038'),('0039'),('0040'),
           ('0041'),('0042'),('0043'),('0044'),('0045'),('0046'),('0047'),('0048'),('0049'),('0050'),
           ('0051'),('0052'),('0053'),('0054'),('0055'),('0056'),('0057'),('0058'),('0059'),('0060'),
           ('0062'),('0063'),('0064'),('0065'),('0066'),('0067'),('0068'),('0069'),('0070'),('0071'),
           ('0072'),('0073'),('0074'),('0077'),('0078'),('0079'),('0080'),('0081'),('0082'),('0083'),
           ('0084'),('0085'),('0086'),('0087'),('0088'),('0089'),('0090'),('0091'),('0092'),('0093'),
           ('0094'),('0095'),('0096'),('0097'),('0098'),('0099'),('0100'),('0101'),('0102'),('0103'),
           ('0104'),('0105'),('0106'),('0107'),('0108'),('0109')
         ) known(version)
        where known.version = m.version)
 order by m.version;


-- ---------------------------------------------------------------------------
-- 5. WHAT THE LEDGER PROMISES vs WHAT THE SCHEMA ACTUALLY CONTAINS.
--    Proves partial application: a migration listed as APPLIED whose defining
--    object is absent.
-- ---------------------------------------------------------------------------
with expectations(migration, object_kind, obj) as (
  values
    ('0060_supplier_application_rate_limit', 'relation', 'public.supplier_application_rate_limits'),
    ('0059_supplier_applications',           'relation', 'public.suppliers'),
    ('0062_seller_identity',                 'relation', 'public.sellers'),
    ('0063_seller_offers',                   'relation', 'public.seller_offers'),
    ('0069_seller_portal_access',             'relation', 'public.seller_offer_tiers'),
    ('0080_retailer_memberships_and_loyalty', 'relation', 'public.membership_plans'),
    ('0080_retailer_memberships_and_loyalty', 'relation', 'public.retailer_memberships'),
    ('0020_super_admin_control_center',       'relation', 'public.super_admin_audit_logs'),
    ('0022_case_based_pricing',               'relation', 'public.product_pricing_tiers'),
    ('0004_product_packs',                    'relation', 'public.product_packs'),
    ('0104_site_content_management',          'relation', 'public.site_pages'),
    ('0104_site_content_management',          'relation', 'public.site_page_revisions'),
    ('0106_first_super_admin_bootstrap',      'relation', 'public.super_admin_bootstrap_allowlist'),
    ('0109_phase3_business_control',          'relation', 'public.wholesale_pricing_rules'),
    ('0109_phase3_business_control',          'relation', 'public.ad_program_settings'),
    ('0109_phase3_business_control',          'relation', 'public.membership_program_settings')
)
select e.migration,
       e.obj,
       (select m.version
          from supabase_migrations.schema_migrations m
         where m.version = substr(e.migration, 1, 4)
            or m.name like substr(e.migration, 1, 4) || '\_%'
         limit 1)                                    as ledger_entry,
       to_regclass(e.obj)::text                      as present_as,
       case
         when to_regclass(e.obj) is not null then 'PRESENT'
         when exists (select 1 from supabase_migrations.schema_migrations m
                       where m.version = substr(e.migration, 1, 4)
                          or m.name like substr(e.migration, 1, 4) || '\_%')
              then 'LEDGER SAYS APPLIED BUT OBJECT IS MISSING (partial application)'
         else 'MISSING (migration not applied)'
       end                                           as verdict
  from expectations e
 order by e.migration, e.obj;


-- ---------------------------------------------------------------------------
-- 6. THE 0107 ORDERING DEPENDENCY.
--    0109 §1 grants column-level SELECT on the new `products.description`
--    column and relies on 0107 having re-granted every other `products`
--    column. 0107 revokes table-level SELECT from PUBLIC, anon AND
--    authenticated, so if EITHER API role can still read cost_price, 0107 has
--    not run and 0109 must not be applied yet.
-- ---------------------------------------------------------------------------
-- NOTE: `has_column_privilege()` raises 42703 when the TABLE exists but the
-- COLUMN does not, so each probe is reached only through a `left join lateral`
-- over `pg_catalog.pg_attribute` rows for `products.cost_price`. With no such
-- attribute there is no input row, so the projection that calls the privilege
-- function never runs and this read-only script cannot fail on a pre-0109
-- database. This is deliberately NOT `has_column and has_column_privilege(…)`:
-- boolean AND short-circuit order is an evaluation detail, not a guarantee.
with cols as (
  select
    exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'products' and column_name = 'cost_price')    as has_cost_price,
    exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'products' and column_name = 'description')   as has_description,
    to_regclass('public.products') is not null                                                        as has_products
),
probe as (
  select c.has_products,
         c.has_cost_price,
         c.has_description,
         cost.authenticated_can_read_cost_price,
         cost.anon_can_read_cost_price,
         descr.authenticated_can_read_description,
         nullif(array_to_string(array_remove(array[
           case when cost.anon_can_read_cost_price            then 'anon' end,
           case when cost.authenticated_can_read_cost_price then 'authenticated' end
         ], null), ' and '), '')                                                            as cost_price_readable_by
    from cols c
    left join lateral (
      select has_column_privilege('authenticated', a.attrelid, 'cost_price', 'SELECT') as authenticated_can_read_cost_price,
             has_column_privilege('anon',          a.attrelid, 'cost_price', 'SELECT') as anon_can_read_cost_price
        from pg_catalog.pg_attribute a
       where a.attrelid = to_regclass('public.products')
         and a.attname  = 'cost_price'
         and a.attnum   > 0
         and not a.attisdropped
    ) cost on true
    left join lateral (
      select has_column_privilege('authenticated', a.attrelid, 'description', 'SELECT') as authenticated_can_read_description
        from pg_catalog.pg_attribute a
       where a.attrelid = to_regclass('public.products')
         and a.attname  = 'description'
         and a.attnum   > 0
         and not a.attisdropped
    ) descr on true
)
select has_products,
       has_cost_price,
       has_description                                                          as description_column_exists,
       authenticated_can_read_cost_price,
       anon_can_read_cost_price,
       authenticated_can_read_description,
       cost_price_readable_by,
       case
         when not has_products  then 'products TABLE MISSING — 0001_init never applied here'
         when not has_cost_price then 'products.cost_price MISSING — 0001_init/0025 never applied here; 0109 pre-flight raises before any DDL'
         when cost_price_readable_by is not null
           then '0107 NOT IN FORCE — ' || cost_price_readable_by
                || ' can still SELECT products.cost_price; apply 0104 -> 0105 -> 0106 -> 0107 -> 0108 before 0109'
         else '0107 IN FORCE — ordering satisfied for 0109'
       end                                                                      as verdict
  from probe;


-- ---------------------------------------------------------------------------
-- 7. RLS STATUS of every table Phase 3 touches. 0109 enables RLS on the tables
--    it creates; this block proves the pre-existing ones are already covered.
-- ---------------------------------------------------------------------------
select c.relname                              as table_name,
       c.relrowsecurity                       as rls_enabled,
       c.relforcerowsecurity                   as rls_forced,
       (select count(*) from pg_policy p where p.polrelid = c.oid) as policy_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relkind = 'r'
   and c.relname in (
     'products', 'product_packs', 'product_pricing_tiers', 'sellers', 'seller_offers',
     'seller_offer_tiers', 'membership_plans', 'retailer_memberships', 'banners',
     'suppliers', 'supplier_application_rate_limits', 'super_admin_audit_logs', 'audit_logs'
   )
 order by c.relname;


-- ---------------------------------------------------------------------------
-- 8. COLUMNS 0109 READS OR ALTERS on pre-existing tables.
--    A missing column here is a WRONG COLUMN / partially-migrated table even
--    when the table itself resolves.
-- ---------------------------------------------------------------------------
with expected(table_name, column_name, expected_migration) as (
  values
    ('products',              'cost_price',        '0001_init'),
    ('products',              'description',       '0109 (added by this migration)'),
    ('product_packs',         'base_price',        '0004_product_packs'),
    ('product_pricing_tiers', 'price_per_piece',   '0022_case_based_pricing'),
    ('product_pricing_tiers', 'min_quantity',      '0022_case_based_pricing'),
    ('seller_offers',         'moq',               '0063_seller_offers'),
    ('seller_offers',         'unit_price_paise',  '0063_seller_offers'),
    ('seller_offers',         'moderation_status', '0063_seller_offers'),
    ('seller_offer_tiers',    'unit_price_paise',  '0069_seller_portal_access'),
    ('membership_plans',      'discount_percent',  '0080_retailer_memberships_and_loyalty'),
    ('membership_plans',      'is_active',         '0083_retire_paid_membership'),
    ('retailer_memberships',  'plan_id',           '0080_retailer_memberships_and_loyalty'),
    ('retailers',             'retailer_category', '0081_retailer_categories_and_approval'),
    ('super_admin_audit_logs','actor_id',          '0020_super_admin_control_center'),
    ('banners',               'status',            '0074_banner_lifecycle_and_variants'),
    ('banners',               'draft_image_path',  '0077_banner_draft_artwork')
)
select e.table_name,
       e.column_name,
       e.expected_migration,
       case
         when to_regclass('public.' || e.table_name) is null then 'WRONG ORDER (table missing)'
         when exists (select 1 from information_schema.columns c
                       where c.table_schema = 'public'
                         and c.table_name = e.table_name
                         and c.column_name = e.column_name) then 'PRESENT'
         when e.column_name = 'description' then 'MISSING (expected — 0109 adds it)'
         else 'WRONG COLUMN (table exists, column missing)'
       end as verdict
  from expected e
 order by e.table_name, e.column_name;


-- ---------------------------------------------------------------------------
-- 9. HELPER FUNCTIONS: every overload in public, so a wrong signature is
--    visible next to the expected one.
-- ---------------------------------------------------------------------------
select p.proname                                                as function_name,
       pg_get_function_identity_arguments(p.oid)                as arguments,
       pg_get_function_result(p.oid)                            as returns,
       p.prosecdef                                              as security_definer,
       coalesce(array_to_string(p.proconfig, ','), '')          as proconfig,
       has_function_privilege('anon', p.oid, 'EXECUTE')         as anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in (
     'is_admin_or_above', 'is_staff_or_above', 'current_user_role',
     'is_retailer_area_assigned_to_current_staff', 'is_active_seller_member',
     'consume_supplier_application_rate_limit', 'log_audit',
     'can_current_staff_read_profile', 'submit_supplier_application',
     'get_retailer_membership_overview', 'super_admin_assign_membership'
   )
 order by p.proname, arguments;


-- ---------------------------------------------------------------------------
-- 10. DATABASE IDENTITY — confirm which project you actually ran this on.
--     Compare `database` with the project ref shown in the dashboard header.
-- ---------------------------------------------------------------------------
select current_database()                    as database,
       current_user                           as executed_as,
       current_setting('server_version')       as server_version,
       pg_postmaster_start_time()              as server_started_at,
       (select count(*) from pg_roles)         as role_count,
       (select count(*) from supabase_migrations.schema_migrations) as ledger_entries,
       (select max(version) from supabase_migrations.schema_migrations) as highest_ledger_version;
