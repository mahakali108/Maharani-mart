# Supabase security and migration audit

2026-11-01. **No live connection, SQL, migration or data access in this audit.** Owner identified desired ref `fhrmsrumsraprvutrpeo`; prior checked-in evidence says it was independently listed, but this audit did not independently verify current project configuration/owner confirmation. The legacy project is out of scope and must never be targeted. Do not treat any ref in documentation as permission to connect.

## Evidence and severity

- Source: 84 migration SQL files, types under `types/`, RLS/functions/triggers across migrations, storage helpers and `supabase/audits/migration_and_security_verification_readonly.sql`. Full function-by-function grants, storage policies, live schema and data isolation **not inspected or verified** in this audit.
- `docs/supabase/SUPABASE_REMOTE_MIGRATION_STATUS.md` describes a 2026-10-30 read-only history snapshot: 73 entries 0001–0060 and 0062–0074, none 0077–0087. This is historical evidence, not a live observation; ledger presence/absence does not establish actual SQL/object contents, out-of-band changes or failed attempts. 0075/0076 reserved; 0061 gap. No current schema-parity claim.
- That historical audit observed anonymous/authenticated EXECUTE for certain SECURITY DEFINER functions including `fefo_plan_for_product(uuid,uuid,integer)`, `ensure_fefo_coverage(uuid,uuid,integer)`, `handle_new_user()` and `release_order_stock(uuid)`; current grants, bodies, caller checks and actual exploitability **unknown**. 0078/0079 propose targeted hardening. Treat as high-priority verification, not a current breach finding.
- `docs/PRE_PRODUCTION_GATE_2026-10-28.md` identifies retailer code dependency on `product_tier_prices` (0082) and risk of fail-closed commerce if schema missing. The checked-in code still calls `loadEffectiveCategoryPrices` in `lib/retailer/pricing-data.ts`. Current deployed code/DB parity is unknown and may differ.
- Ordering gate 0085 and food/compliance enforcement 0086/0087 are source, **not proven live**. Existing documentation warns 0081–0084 rollback scripts are incomplete and cleanup deletions are irreversible. Do not simply execute migrations to 'fix' audit findings.
- Source storage inventory: public `product-images`, `banners`, `brand-logos`, `category-images`, `avatars`; private `retailer-documents`, proposed private `banner-drafts` (0077); later compliance evidence storage in 0087. Older `docs/storage-buckets.md` is not a current bucket/policy verification. No secret or user data read.

## Owner-approved read-only verification plan

1. Owner confirms exact official project ref and deployment environment host **without keys**; stop on any mismatch/legacy. Confirm read-only credentials/access and scope separately; never use production as a test database.
2. Capture date-stamped migration ledger, schema/type inventories and compare exact function signatures/owners/source hashes, role inheritance, default ACLs, RLS table enable/force flags, policies, triggers, indexes, constraints, views, grants, extensions and storage bucket visibility/policies. Use catalog-only queries in existing audit SQL after owner review; redact sensitive content.
3. Map every entry point against expected anonymous, retailer A/B, seller A/B, staff, admin, super-admin and service-role capabilities. Inspect checkout, stock release, seller publishing/approval, identity creation, audit logs, file ownership, media paths and tenant isolation. Avoid live business mutations or PII retrieval. Effective grants require more than explicit GRANT checks.
4. Capture backup retention/PITR entitlement and conduct a later **approved disposable-environment restore**; Free plan does not include automatic backups/PITR according to current Supabase pricing. Review deletion/retention and sensitive evidence access.

## Migration planning gate (no SQL diff invented)

Exact SQL diffs require current catalog/source comparison; **not prepared or approved** until independent identity and read-only schema evidence exist. For each candidate 0077–0087 prepare a review bundle: exact forward diff and its source hash, existing vs target object definitions/ACLs, ordered dependency graph (e.g. 0081→0082, 0080→0083), lock/runtime and affected row counts, business/PII impact, RLS and caller matrix, compatibility/deployment ordering, non-production rehearsal, backup/restore evidence, fully tested rollback/reapply or explicitly irreversible alternatives, owner/DBA/CA/legal approval and postconditions. Do not use migration-history insertion as a repair. Avoid destructive rollback for sales/audit evidence. Production application needs explicit separate authorization.

## Recommendations / unknowns

Super Admin-only actions need exact role checks, not merely admin/staff checks or middleware. Validate security-definer search paths and caller validation, file MIME/size/content, signed URLs, anonymous exposure, rate limiting, session revocation, price and stock atomicity, replay/concurrency, tenant isolation and immutable security audit. Only real isolated Supabase tests can verify policy behavior. None passed or failed in this audit.
