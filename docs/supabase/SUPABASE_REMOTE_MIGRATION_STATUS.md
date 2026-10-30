# Official Supabase remote migration status — 2026-10-30

## Focused read-only recheck — 2026-10-30 10:20 UTC

### Confirmed: official remote metadata

- The Supabase project list again identified `Maharani-mart` as `fhrmsrumsraprvutrpeo`; only this project's migration-history endpoint was queried. The history response again contained 73 records, 0001–0060 and 0062–0074, and no 0075–0087. This rechecks **history only**; it does not show failed attempts or prove the schema has no out-of-band changes.
- The detailed function ACL values below come from the **previous** read-only catalog query, not a new query. Because this follow-up explicitly forbids executing SQL, no SQL — including SELECT — was executed here. Their present-day effective ACLs, owners, exact grant origin and function bodies have **not been rechecked** and could have changed since that earlier snapshot.

### Confirmed: repository and branch findings

- Remote `origin/main` was advertised at `56c59e95cbfc5893e6872e69767f271bf975d3d8`, the current checkout HEAD. All eleven exact paths `0077`–`0087` listed below exist in that official main commit; the pending status is the history comparison above, not a claim that each file's objects are all absent.
- Why the jump? `supabase/migrations/0077_banner_draft_artwork.sql:20-22` explicitly says **0075 was reserved** for a data-retention archive on hold pending accountant/legal review and **0076 was reserved** for deferred banner `alt_text`. `docs/BANNER_ALT_TEXT_PROPOSAL.md` identifies 0076 as a draft, not implemented, and `supabase/audits/migration_and_security_verification_readonly.sql:30-31` independently repeats the reservation. Consequently the next present source version is 0077: the numeric gap does not mean 0077 depended on applying nonexistent files. That explains repository numbering; **why the database was last migrated only through 0074 is an operational decision/history question that cannot be established from this evidence**.
- `git ls-remote --heads origin` advertised **131** branch heads; all 131 exact advertised commit trees were examined recursively, including every path with a `migrations` directory component. Only `supabase/migrations` appeared, and no migration filename beginning 0075 or 0076 was found at any advertised branch tip. No branch was switched. Remote objects were fetched by commit ID without creating branch refs or changing working files.
- The reachable history from all 131 tip commits was searched for added, deleted and renamed paths with basenames starting 0075 or 0076; no match was found. This checkout is **shallow**, with `56c59e95cbfc5893e6872e69767f271bf975d3d8` recorded as a shallow boundary; the search covered 594 available reachable commits, not necessarily all historical commits. A deleted branch, unreachable commit, hidden/private ref, historical pre-boundary file, or content renamed without the same version number cannot be ruled out. No evidence of an actual 0075/0076 file, rename, deletion or application was found, but this is not proof none ever existed. An owner with full history and archived refs can investigate further if needed.
- The pending migration dependency summary is in **Version gaps and dependencies** below. These are source-derived direct dependencies and risk notes, not a complete verified dependency graph or permission to execute. Existing views/objects may have been modified outside migration history.

### Security-sensitive functions: earlier remote snapshot vs source-intended ACLs

The remote columns below are effective EXECUTE results from the previous catalog snapshot (`has_function_privilege`, 2026-10-30), not a recheck during this no-SQL follow-up. Each listed function was observed as SECURITY DEFINER with `search_path=public, pg_temp`; `service_role` was true for each in that snapshot. The intended ACL is the **pending migration's source plan**, conditional on its guards and role inheritance; it is not a statement of current privileges or authorization to change them.

| Exact signature | Earlier snapshot: anon / authenticated / service_role | Source-intended access and migration | Origin / changes established in repository source |
|---|---|---|---|
| `public.fefo_plan_for_product(uuid, uuid, integer)` | true / true / true | 0078 revokes `PUBLIC`, `anon`, `authenticated`; expects service/owner use | Function defined in `0017_inventory_batches_fefo_grn.sql:458`; source 0078 proposes withdrawing API access. Actual historical grant origin not established. |
| `public.current_offer_floor_paise(uuid)` | false / true / true | 0078 revokes `PUBLIC`, `anon`, `authenticated`; expects service/owner use | `0063_seller_offers.sql:94-109` defines function, revokes PUBLIC/anon and explicitly grants authenticated. Out-of-band changes not excluded. |
| `public.handle_new_user()` | true / true / true | 0078 revokes `PUBLIC`, `anon`, `authenticated`; trigger invocation does not require API EXECUTE; service role grant is not explicitly revoked | Introduced in `0002_auth_trigger.sql:9`; replaced by 0011, 0012, 0052, 0069, 0070 and 0072. Actual origin of effective privileges not established. |
| `public.ensure_fefo_coverage(uuid, uuid, integer)` | true / true / true | 0079 revokes `PUBLIC`, `anon`, `authenticated`; service/owner internal use retained subject to effective ACL review | Defined in `0017_inventory_batches_fefo_grn.sql:503`; actual grant origin not established. |
| `public.release_order_stock(uuid)` | true / true / true | 0079 revokes `PUBLIC` and `anon`, retains authenticated execute and replaces body with caller checks; service/owner paths must remain functional | Defined in `0017_inventory_batches_fefo_grn.sql:651`; 0079 proposes guarded replacement. Actual remote body and origin of effective grants were not rechecked. |

- PostgreSQL/Supabase default or inherited privileges are possible explanations for the observed effective grants, but the catalog snapshot did **not** establish exactly which GRANT or default privilege caused each one. A comment in 0079 refers to defaults; it is not independent evidence of the production grant provenance. `CREATE OR REPLACE` can preserve existing ACLs. Validate actual grants, inherited roles, callers and function bodies before any corrective change; do not assume that revoking one explicit role automatically removes inherited access.
- The earlier snapshot also showed Storage policies `staff_write_banners` and `staff_update_banners` using `is_staff_or_above()`; 0078 proposes `is_admin_or_above()`. Current policy state was **not rechecked** in this no-SQL follow-up.

## Scope and method

- Official project **Maharani-mart**, ref **`fhrmsrumsraprvutrpeo`**, was verified in the connected Supabase project list before any database query. No query was sent to the legacy project.
- The connected Supabase **list_migrations** endpoint returned authoritative migration-history records for 0001–0060 and 0062–0074 inclusive, with matching source migration names. It returned no other versions. The history table metadata shows only `version`, `statements`, and `name`; **no application timestamp or failure status column** was available. History establishes a recorded version, not proof that all objects remain unchanged or that SQL file contents match what ran.
- System catalogs, information_schema, Storage bucket configuration and policies were queried read-only for a **selected subset**, not all objects; no customer, seller, retailer, or other business records were read. No writes, migrations, repairs, deployments, or configuration changes were performed.
- Snapshot taken 2026-10-30 UTC. Status reflects the returned project and history at inspection time; recheck before any future action. **A complete comparison of every object, its full definition, grant, dependency and data implications has not been completed.**
- Existing working tree changes were preserved. No migration files were edited. Source has no local Supabase CLI available.

## Summary

| Measure | Result | Interpretation |
|---|---:|---|
| Repository SQL migration files | 84 | `supabase/migrations/*.sql` |
| APPLIED | 73 | Version and name recorded remotely; object parity not established for all |
| PENDING | 11 | Source exists; version absent from returned remote history |
| FAILED | 0 confirmed | Failure information not exposed; this is **not** evidence of no failed attempts |
| PARTIAL / SCHEMA MISMATCH | 0 confirmed | Selected comparisons only; this is **not** a full schema parity finding |
| NOT VERIFIED | 0 migration histories | History comparison succeeded; schema for most objects is still **NOT VERIFIED** |
| Remote-only versions | 0 observed | Against returned history; assumes endpoint returned complete list |

**Important:** a migration absent from history is PENDING by the requested definition, not proof that none of its changes were manually executed or that it never failed. Some pending migrations modify objects that predate them. FAILED and PARTIAL counts above mean *confirmed by this limited inspection*, not comprehensive coverage. Migration history does not provide failure logs, applied timestamps, checksums, or evidence of execution by non-migration channels. Reconcile any out-of-band changes and failure logs separately.

## Ordered source inventory and exact statuses

One status per file. `APPLIED` here means recorded in official remote migration history, not independently verified object-by-object. `PENDING` means source version absent in the returned history. All filenames below are under `supabase/migrations/`.

| Version | Filename | Status | Basis |
|---|---|---|---|
| 0001 | `0001_init.sql` | APPLIED | Version and name in returned history |
| 0002 | `0002_auth_trigger.sql` | APPLIED | Version and name in returned history |
| 0003 | `0003_storage_buckets.sql` | APPLIED | Version and name in returned history |
| 0004 | `0004_product_packs.sql` | APPLIED | Version and name in returned history |
| 0005 | `0005_master_data_delete_and_pricing.sql` | APPLIED | Version and name in returned history |
| 0006 | `0006_retailer_documents.sql` | APPLIED | Version and name in returned history |
| 0007 | `0007_pack_based_ordering.sql` | APPLIED | Version and name in returned history |
| 0008 | `0008_order_status_history_rls.sql` | APPLIED | Version and name in returned history |
| 0009 | `0009_order_operations_inventory.sql` | APPLIED | Version and name in returned history |
| 0010 | `0010_route_assignment_rls.sql` | APPLIED | Version and name in returned history |
| 0011 | `0011_fix_retailer_row_creation.sql` | APPLIED | Version and name in returned history |
| 0012 | `0012_fix_registration_phone_conflict.sql` | APPLIED | Version and name in returned history |
| 0013 | `0013_rls_and_storage_hardening.sql` | APPLIED | Version and name in returned history |
| 0014 | `0014_salesman_retailer_order_rls.sql` | APPLIED | Version and name in returned history |
| 0015 | `0015_retailer_favorites.sql` | APPLIED | Version and name in returned history |
| 0016 | `0016_storage_paths_category_bucket.sql` | APPLIED | Version and name in returned history |
| 0017 | `0017_inventory_batches_fefo_grn.sql` | APPLIED | Version and name in returned history |
| 0018 | `0018_maharani_ai_security.sql` | APPLIED | Version and name in returned history |
| 0019 | `0019_ai_demand_forecast.sql` | APPLIED | Version and name in returned history |
| 0020 | `0020_super_admin_control_center.sql` | APPLIED | Version and name in returned history |
| 0021 | `0021_ensure_category_images_bucket.sql` | APPLIED | Version and name in returned history |
| 0022 | `0022_case_based_pricing.sql` | APPLIED | Version and name in returned history |
| 0023 | `0023_sku_code_optional.sql` | APPLIED | Version and name in returned history |
| 0024 | `0024_pack_variant_images.sql` | APPLIED | Version and name in returned history |
| 0025 | `0025_cost_price_column_lockdown.sql` | APPLIED | Version and name in returned history |
| 0026 | `0026_case_and_loose_piece_pricing.sql` | APPLIED | Version and name in returned history |
| 0027 | `0027_powder_category_and_catalog_constraints.sql` | APPLIED | Version and name in returned history |
| 0028 | `0028_product_pack_gallery.sql` | APPLIED | Version and name in returned history |
| 0029 | `0029_retailer_wallet_ledger.sql` | APPLIED | Version and name in returned history |
| 0030 | `0030_wallet_rpc_security.sql` | APPLIED | Version and name in returned history |
| 0031 | `0031_wallet_outstanding_opening_baseline.sql` | APPLIED | Version and name in returned history |
| 0032 | `0032_retailer_address_book.sql` | APPLIED | Version and name in returned history |
| 0033 | `0033_retailer_saved_carts.sql` | APPLIED | Version and name in returned history |
| 0034 | `0034_retailer_product_feedback.sql` | APPLIED | Version and name in returned history |
| 0035 | `0035_retailer_profile_rpc_prefs_requests.sql` | APPLIED | Version and name in returned history |
| 0036 | `0036_order_shipping_address.sql` | APPLIED | Version and name in returned history |
| 0037 | `0037_staff_scope_policies.sql` | APPLIED | Version and name in returned history |
| 0038 | `0038_staff_targets_commissions.sql` | APPLIED | Version and name in returned history |
| 0039 | `0039_follow_ups.sql` | APPLIED | Version and name in returned history |
| 0040 | `0040_schemes_audit.sql` | APPLIED | Version and name in returned history |
| 0041 | `0041_area_stock_view.sql` | APPLIED | Version and name in returned history |
| 0042 | `0042_order_state_machine.sql` | APPLIED | Version and name in returned history |
| 0043 | `0043_deliveries_module.sql` | APPLIED | Version and name in returned history |
| 0044 | `0044_payment_collections.sql` | APPLIED | Version and name in returned history |
| 0045 | `0045_delivery_payment_proof_buckets.sql` | APPLIED | Version and name in returned history |
| 0046 | `0046_smoke_fixture.sql` | APPLIED | Version and name in returned history |
| 0047 | `0047_banner_content.sql` | APPLIED | Version and name in returned history |
| 0048 | `0048_support_tickets.sql` | APPLIED | Version and name in returned history |
| 0049 | `0049_credit_payment_terms.sql` | APPLIED | Version and name in returned history |
| 0050 | `0050_catalog_admin_upgrade.sql` | APPLIED | Version and name in returned history |
| 0051 | `0051_coupon_system.sql` | APPLIED | Version and name in returned history |
| 0052 | `0052_phase0_security_hardening.sql` | APPLIED | Version and name in returned history |
| 0053 | `0053_order_coin_refund.sql` | APPLIED | Version and name in returned history |
| 0054 | `0054_simplified_pack_stock.sql` | APPLIED | Version and name in returned history |
| 0055 | `0055_data_retention_cleanup.sql` | APPLIED | Version and name in returned history |
| 0056 | `0056_mobile_checkout_atomic.sql` | APPLIED | Version and name in returned history |
| 0057 | `0057_security_definer_hardening.sql` | APPLIED | Version and name in returned history |
| 0058 | `0058_saran_default_district.sql` | APPLIED | Version and name in returned history |
| 0059 | `0059_supplier_applications.sql` | APPLIED | Version and name in returned history |
| 0060 | `0060_supplier_application_rate_limit.sql` | APPLIED | Version and name in returned history |
| 0062 | `0062_seller_identity.sql` | APPLIED | Version and name in returned history |
| 0063 | `0063_seller_offers.sql` | APPLIED | Version and name in returned history |
| 0064 | `0064_split_order_identity.sql` | APPLIED | Version and name in returned history |
| 0065 | `0065_checkout_split_rpcs.sql` | APPLIED | Version and name in returned history |
| 0066 | `0066_fulfilment_and_delivery.sql` | APPLIED | Version and name in returned history |
| 0067 | `0067_seller_settlement.sql` | APPLIED | Version and name in returned history |
| 0068 | `0068_seller_governance.sql` | APPLIED | Version and name in returned history |
| 0069 | `0069_seller_portal_access.sql` | APPLIED | Version and name in returned history |
| 0070 | `0070_seller_invite_only.sql` | APPLIED | Version and name in returned history |
| 0071 | `0071_gaya_default_district.sql` | APPLIED | Version and name in returned history |
| 0072 | `0072_super_admin_seller_invitations.sql` | APPLIED | Version and name in returned history |
| 0073 | `0073_configured_delivery_pins.sql` | APPLIED | Version and name in returned history |
| 0074 | `0074_banner_lifecycle_and_variants.sql` | APPLIED | Version and name in returned history |
| 0077 | `0077_banner_draft_artwork.sql` | PENDING | Absent from returned history |
| 0078 | `0078_privilege_hardening.sql` | PENDING | Absent from returned history |
| 0079 | `0079_api_execute_hardening.sql` | PENDING | Absent from returned history |
| 0080 | `0080_retailer_memberships_and_loyalty.sql` | PENDING | Absent from returned history |
| 0081 | `0081_retailer_categories_and_approval.sql` | PENDING | Absent from returned history |
| 0082 | `0082_category_tier_pricing.sql` | PENDING | Absent from returned history |
| 0083 | `0083_retire_paid_membership.sql` | PENDING | Absent from returned history |
| 0084 | `0084_ai_data_retention_14_days.sql` | PENDING | Absent from returned history |
| 0085 | `0085_ordering_launch_readiness_atomic.sql` | PENDING | Absent from returned history |
| 0086 | `0086_catalog_seller_compliance_enforcement.sql` | PENDING | Absent from returned history |
| 0087 | `0087_phase_2d1_compliance_security_and_evidence_storage.sql` | PENDING | Absent from returned history |

## Version gaps and dependencies

No duplicate source version was found. Sequence numbers **0061, 0075 and 0076** have no source files and were not present in returned remote history; 0075/0076 are documented as reserved as detailed in the focused recheck above; numerical gaps alone do not prove lost migrations. Nothing was renumbered. Exact semantic dependency graph for all 84 files is **not verified**.

For the pending files, review the actual SQL and existing objects, not just numeric order:

| File | Dependency / rollout concern |
|---|---|
| 0077 | Extends 0074 banner lifecycle; creates private draft bucket, policies and banner columns. Check existing bucket settings, path policies and published artwork. |
| 0078 | Tightens existing inventory and seller helper ACLs and banner Storage policies; depends on earlier helper functions and role policies. Check policy callers before any change. |
| 0079 | Further inventory/AI EXECUTE changes and replacement of `release_order_stock`; replacement references `sub_orders` from 0064. Its guards may skip parts when prerequisites are missing. Coordinate cancellation callers and trigger behavior. |
| 0080 | Creates membership/loyalty tables, RPCs and delivered-order trigger. 0083 retires paid membership; avoid an unintended interval enabling paid plans or changed loyalty accrual. |
| 0081 | Adds retailer categories, application approval and sensitive-column guards; assess existing retailer registration and staff flows, plus existing data and defaults. |
| 0082 | Depends on 0081 retailer categories and prior checkout/seller objects; replaces atomic checkout RPCs and adds category prices. Verify both order versions, ACL preservation and pricing behavior. |
| 0083 | Depends on 0080 membership/loyalty and 0081/0082 pricing. It **updates membership plan records** and changes loyalty accrual, so data/business impact and transaction strategy require approval. |
| 0084 | Relies on earlier AI objects; defines AI retention cleanup and audit/registry. Cleanup can delete eligible AI data **when invoked**; confirm existing or planned cron/automation and retention/legal approval first. |
| 0085 | Depends on `platform_settings`, Super Admin identity and audit tables from 0020 and other prior security functions. Persists ordering approvals atomically; review server-side order gate and expiry behavior. |
| 0086 | Depends on categories, products, packs, sellers, offers and order objects, earlier RPC/security functions; defaults existing categories to unapproved and gates sale visibility/eligibility. Assess launch and historical fulfilment impacts. |
| 0087 | Depends on 0086 reviews/evidence and existing product, seller, pack, category and Storage objects. Adds fail-closed classification/revisions and private evidence bucket, and adjusts ACLs/triggers; verify bucket conflicts, seller suspension and current-review behavior. |

These dependencies are a planning summary, not a proved complete dependency DAG. Do not start with 0085–0087 while skipping their earlier prerequisites.

## Selected actual object comparisons (read-only)

### Objects absent from pending migration source expectations

The following catalog observations are **confirmed missing at inspection time**, not evidence that the full corresponding migration is absent in every respect:

- **0077:** bucket `banner-drafts`; `banners.draft_image_path`, `banners.draft_image_mobile_path`.
- **0080:** `membership_plans`, `retailer_memberships`, `loyalty_ledger`.
- **0081:** `retailer_approval_settings`, `retailer_applications`, `retailer_approval_events`, `retailers.retailer_category`.
- **0082:** `product_tier_prices`.
- **0084:** `ai_retention_rules`, `ai_cleanup_runs`, function `run_ai_data_cleanup` (name-level check).
- **0085:** function `record_ordering_launch_readiness` (name-level check).
- **0086:** `categories.compliance_scope`, `product_compliance_reviews`, `product_compliance_evidence`, `seller_compliance_reviews`, `seller_compliance_evidence`.
- **0087:** `products.regulatory_classification`, `products.compliance_revision`, `sellers.compliance_revision`, function `can_read_compliance_evidence_object` (name-level check), bucket `compliance-evidence`.

The remaining objects, signatures, policy definitions and migration effects were not exhaustively compared. Absence of migration 0083 in history is known, but selected object checks cannot establish its complete effects independently.

### Selected checks on history-recorded migrations

- The following 11 tables exist and report RLS enabled, at least one policy and one primary key: `profiles`, `retailers`, `products`, `product_packs`, `orders`, `order_items`, `sellers`, `seller_offers`, `sub_orders`, `banners`, `platform_settings`. Catalog also reported foreign keys and indexes on each; counts and enabled RLS do not establish that policies or constraints are correct or complete.
- `banners.status` is `text NOT NULL DEFAULT 'published'`, consistent with 0074's specified column; `starts_at`/`ends_at` are nullable `timestamptz`. `order_items.source_type` is `text NOT NULL DEFAULT 'maharani'`, and `seller_offer_id` is nullable UUID. Selected money fields are non-null `numeric`, and `orders.placed_at` is non-null `timestamptz`. Numeric precision/scale, all other columns, and full constraints/indexes are not compared here.
- `inventory_area_totals` exists with `security_invoker=true`, consistent with 0041. Selected views `ai_product_demand_daily`, `inventory_product_totals`, and `inventory_expiry_report` exist with no reloptions reported; view grants/owners and definitions require separate review.
- Trigger `trg_release_stock_on_order_cancel` exists on orders, enabled in origin mode, calling `release_stock_on_order_cancel`. The trigger's full definition and runtime behavior were not verified.
- `banners` bucket is public (5 MiB PNG/JPEG/WebP); `retailer-documents` and `supplier-documents` are private (10 MiB PNG/JPEG/WebP/PDF). This is observed metadata, not a complete assessment of access or policies.
- SECURITY DEFINER `create_order_atomic` and `create_order_atomic_v2` have the observed 16-argument signatures and `search_path=public, pg_temp`; catalog reports `anon=false`, `authenticated=false`, `service_role=true` for EXECUTE. This does not prove their full bodies, authority checks, or runtime behavior.

### Priority security metadata requiring owner attention

These are effective EXECUTE privilege results from the earlier 2026-10-30 `has_function_privilege` snapshot, not rechecked in the no-SQL follow-up. No function was invoked and no data was accessed:

| Function | SECURITY DEFINER | anon execute | authenticated execute | Pending source change |
|---|---|---|---|---|
| `fefo_plan_for_product(uuid, uuid, integer)` | yes | true | true | 0078 proposes withdrawal |
| `current_offer_floor_paise(uuid)` | yes | false | true | 0078 proposes withdrawal |
| `handle_new_user()` | yes | true | true | 0078 proposes withdrawal; trigger function |
| `ensure_fefo_coverage(uuid, uuid, integer)` | yes | true | true | 0079 proposes withdrawal |
| `release_order_stock(uuid)` | yes | true | true | 0079 proposes guarded replacement and privilege hardening |

All five show `search_path=public, pg_temp`. The 0079 source describes inventory mutation and stock-release risks, but effective grants alone do not establish exploitability or that a proposed fix is safe for all callers. **Escalate promptly to the authorized security owner; do not invoke RPCs, revoke privileges blindly, or apply SQL as part of this task.** In the earlier snapshot, `staff_write_banners` INSERT and `staff_update_banners` UPDATE Storage policies used `is_staff_or_above()`; 0078 proposes narrowing them to admins. Confirm application roles and intended behavior before changing.

## Exact files needing attention

All eleven PENDING files in the inventory need dependency, conflict, security, data impact, staging, and owner review; **none is authorized for execution**:

- `0077_banner_draft_artwork.sql`
- `0078_privilege_hardening.sql`
- `0079_api_execute_hardening.sql`
- `0080_retailer_memberships_and_loyalty.sql`
- `0081_retailer_categories_and_approval.sql`
- `0082_category_tier_pricing.sql`
- `0083_retire_paid_membership.sql`
- `0084_ai_data_retention_14_days.sql`
- `0085_ordering_launch_readiness_atomic.sql`
- `0086_catalog_seller_compliance_enforcement.sql`
- `0087_phase_2d1_compliance_security_and_evidence_storage.sql`

No specific history-recorded migration has been proven partially applied by this limited check. Full object parity for 0001–0074 remains unverified; do not infer it from a zero confirmed mismatch count.

## Safe future execution plan — approval only

1. Reconfirm the exact official project, history and all out-of-band changes; obtain audit logs for failed attempts and a schema-only dump of all relevant public/auth/Storage objects, types, indexes, constraints, policies, triggers, functions, signatures, owners and ACLs. Compare final expected definitions after all subsequent migrations, not each historical version in isolation.
2. Obtain owner, security, operations and where relevant legal/CA sign-off. Establish a current verified restorable backup and a separate isolated staging project; restore/rehearse without exposing production records to this task. Inventory impact of 0083's plan update, 0084 retention and scheduler, and 0086/0087 sale-blocking defaults; agree safe launch order, operational freeze and recovery conditions.
3. Rehearse in dependency order **0077 → 0078 → 0079 → 0080 → 0081 → 0082 → 0083 → 0084 → 0085 → 0086 → 0087**, unless a reviewed dependency graph or existing drift requires an owner-approved alternative. Test the 0080/0083 transition as a coherent release and confirm no unsafe interim availability. No execution is approved by this report.
4. Preflight duplicate objects, Storage bucket privacy/configuration and policy collisions; verify data type/default compatibility for `IF NOT EXISTS`, view dependencies, existing role grants and required API/RLS callers. Confirm migration tooling transaction semantics and lock/timeout behavior. Test full migration replay and app workflows, seller suspension, auth, checkout, stock cancellation, ACL/RLS and concurrency on disposable staging.
5. Capture schema/ACL snapshots and define monitoring and a recovery decision for every step; a transaction can roll back a failure only within its actual transaction boundary. Some scripts change existing rows, defaults or access, and rollback may not restore external effects or data. Preserve all orders, audit trails and evidence; never use destructive down scripts casually. For drift or partly executed SQL, prefer a reviewed forward corrective migration over blindly rerunning an applied migration; establish exact state first.
6. On a separately approved future change window, use the owner's normal controlled migration process, verify returned history and object behavior after each approved phase, and stop on mismatch. Do not perform `db push`, repair, or any schema/data change from this audit.
