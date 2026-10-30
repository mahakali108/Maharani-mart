# Maharani Traders compliance worktree scope inventory

**Prepared:** 2026-10-30 (Asia/Kolkata)
**Repository branch:** `arena/240ffc1c-maharani-mart`
**Baseline commit:** `5fcc22ff753ff2715c9915e4d8d6d39df2815ce0`
**Purpose:** identify the scope of the already-dirty working tree before any further compliance work is undertaken.

## Handling rule

Every item below pre-dated this inventory and remains unstaged. This inventory does **not** assert authorship, approval, production deployment, database execution, legal certification, or test success. It is a static-scope classification only. No file must be included in a commit merely because it appears here; any future PR must be reviewed file-by-file for provenance and relevance.

At the time of inventory, there were no staged files. The visible Supabase directory did not contain a checked-in `supabase/config.toml` or project reference, so the official remote project could not be identified from that location. No remote Supabase action was performed.

## Classification legend

- **Direct — legal/public disclosure:** public legal route, review notice, or unpublished legal-review draft.
- **Direct — ordering readiness:** fail-closed order readiness controls and their tests/migration.
- **Direct — seller/catalog compliance:** product/seller classification, review, marketplace-offer, or purchase enforcement.
- **Direct — evidence security:** private compliance-evidence Storage design or helper.
- **Supporting — test:** test coverage for one of the direct controls.
- **Not in scope:** unrelated product work. No such dirty file was identified in this snapshot.

## Modified tracked files

| File | Classification | Static scope observation |
| --- | --- | --- |
| `app/admin/compliance/page.tsx` | Direct — ordering readiness | Restricts the dashboard to Super Admin and displays authoritative launch-readiness/audit state. |
| `app/api/mobile/v1/orders/route.ts` | Direct — ordering readiness | Maps the fail-closed ordering-not-enabled result into the mobile API’s existing conflict vocabulary. |
| `app/legal/grievance/page.tsx` | Direct — legal/public disclosure | Reworks the public grievance page into a review-gated page that does not publish invented officer/SLA details. |
| `components/auth/auth-frame.tsx` | Direct — legal/public disclosure | Adds the pre-authentication grievance-information link. |
| `components/layout/admin-shell.tsx` | Direct — ordering readiness | Supporting navigation/accessibility change for the compliance/readiness controls. |
| `docs/LEGAL_REVIEW.md` | Direct — legal/public disclosure | Records that public pages and legal-review drafts remain unapproved pending professional/operator review. |
| `lib/admin/business-settings/actions.ts` | Direct — ordering readiness | Adds the Super-Admin-only audited writer action for readiness approvals. |
| `lib/admin/business-settings/server.ts` | Direct — ordering readiness | Reads the authoritative readiness record fail-closed. |
| `lib/admin/business-settings/types.ts` | Direct — ordering readiness | Adds strict placeholder/timestamp/readiness schemas. |
| `lib/admin/offer-actions.ts` | Direct — seller/catalog compliance | Applies product/seller compliance gates before an admin creates an offer. |
| `lib/admin/product-import-actions.ts` | Direct — seller/catalog compliance | Restricts imports to permitted category scopes and creates inactive compliance drafts. |
| `lib/admin/products-actions.ts` | Direct — seller/catalog compliance | Applies category and product gates to create/update/activation flows. |
| `lib/orders/create-order.ts` | Direct — ordering readiness | Applies the server-side launch-readiness gate in the order writer. |
| `lib/orders/quote-order.ts` | Direct — seller/catalog compliance | Rejects quoting products that are not currently sale eligible. |
| `lib/seller/actions.ts` | Direct — seller/catalog compliance | Applies seller/product checks to seller portal offer creation. |
| `tests/business-settings-authorization.test.ts` | Supporting — test | Exercises Super Admin authorization and readiness writer payload boundaries. |
| `tests/order-request-replay.test.ts` | Supporting — test | Updates the replay harness for the ordering-readiness dependency. |
| `tests/public-information.test.ts` | Supporting — test | Checks public grievance discoverability and the unpublished legal-review pack contract. |

## Untracked public-route and legal-review files

| File | Classification | Static scope observation |
| --- | --- | --- |
| `app/legal/canonical-redirect.ts` | Direct — legal/public disclosure | Shared permanent redirect mechanism for historical legal aliases. |
| `app/privacy/page.tsx` | Direct — legal/public disclosure | Canonical privacy route alias. |
| `app/returns/page.tsx` | Direct — legal/public disclosure | Canonical returns route alias. |
| `app/shipping/page.tsx` | Direct — legal/public disclosure | Canonical shipping route alias. |
| `app/terms/page.tsx` | Direct — legal/public disclosure | Canonical terms route alias. |
| `docs/legal-review/README.md` | Direct — legal/public disclosure | Publication/review status and policy-document index. |
| `docs/legal-review/TERMS_AND_CONDITIONS.md` | Direct — legal/public disclosure | Unpublished, versioned terms draft. |
| `docs/legal-review/PRIVACY_POLICY.md` | Direct — legal/public disclosure | Unpublished, versioned privacy draft. |
| `docs/legal-review/SHIPPING_AND_DELIVERY_POLICY.md` | Direct — legal/public disclosure | Unpublished, versioned shipping/delivery draft. |
| `docs/legal-review/CANCELLATION_RETURNS_REFUNDS_POLICY.md` | Direct — legal/public disclosure | Unpublished, versioned cancellation/returns/refunds draft. |
| `docs/legal-review/GRIEVANCE_REDRESSAL_POLICY.md` | Direct — legal/public disclosure | Unpublished, versioned grievance draft. |
| `docs/legal-review/MARKETPLACE_SELLER_AGREEMENT.md` | Direct — legal/public disclosure | Unpublished, versioned marketplace seller-agreement draft. |
| `docs/legal-review/SELLER_COMPLIANCE_DECLARATION.md` | Direct — legal/public disclosure | Unpublished, versioned seller-compliance declaration draft. |
| `docs/legal-review/PRODUCT_AUTHENTICITY_ANTI_COUNTERFEIT_POLICY.md` | Direct — legal/public disclosure | Unpublished, versioned product-authenticity/anti-counterfeit draft. |
| `docs/ORDERING_LAUNCH_READINESS_CHECKLIST.md` | Direct — ordering readiness | Owner/lawyer/CA approval and operational evidence checklist. |

## Untracked implementation and migration files

| File | Classification | Static scope observation |
| --- | --- | --- |
| `lib/compliance/ordering-readiness.ts` | Direct — ordering readiness | Server-only, fail-closed readiness evaluator. |
| `supabase/migrations/0085_ordering_launch_readiness_atomic.sql` | Direct — ordering readiness | Forward migration for protected readiness state, audit, and atomic write enforcement. |
| `lib/compliance/catalog-compliance.ts` | Direct — seller/catalog compliance | Server-side product, category, and seller eligibility checks. |
| `supabase/migrations/0086_catalog_seller_compliance_enforcement.sql` | Direct — seller/catalog compliance | Forward catalog/seller review, category scope, and marketplace controls. |
| `lib/compliance/evidence-storage.ts` | Direct — evidence security | Server-only received-file validation, canonical private keys, authorized upload and signed-URL minting. |
| `supabase/migrations/0087_phase_2d1_compliance_security_and_evidence_storage.sql` | Direct — seller/catalog compliance; evidence security | Forward corrective migration for revision/fingerprint approvals, offer/seller safety transitions, classification, function ACLs, and private evidence Storage/RLS. |
| `docs/COMPLIANCE_EVIDENCE_STORAGE_RUNBOOK.md` | Direct — evidence security | Private-bucket setup, authorisation, validation, staging verification and non-destructive rollback guidance. |

## Untracked tests

| File | Classification | Static scope observation |
| --- | --- | --- |
| `tests/legal-canonical-redirects.test.ts` | Supporting — test | Canonical legal route/alias contract. |
| `tests/business-settings-schema.test.ts` | Supporting — test | Strict owner-setting/readiness validation. |
| `tests/order-launch-readiness.test.ts` | Supporting — test | Server readiness evaluation and fail-closed behavior. |
| `tests/ordering-readiness.test.ts` | Supporting — test | Order/quote integration contracts for readiness enforcement. |
| `tests/ordering-readiness-persistence-db.test.ts` | Supporting — test | PGlite migration/persistence contract for readiness controls. |
| `tests/compliance-dashboard-access.test.ts` | Supporting — test | Super Admin-only dashboard access contract. |
| `tests/catalog-seller-compliance-migration.test.ts` | Supporting — test | Source/migration contract for 0086 protections. |
| `tests/phase-2d1-compliance-corrections.test.ts` | Supporting — test | Source/migration contract for 0087 safeguards and historical-order preservation. |
| `tests/phase-2d1-compliance-flow-db.test.ts` | Supporting — test | PGlite seller/product/revision/classification/Storage flow coverage. |
| `tests/phase-2d1-function-acl-db.test.ts` | Supporting — test | PGlite `pg_proc.proacl` and least-privilege execution coverage. |
| `tests/phase-2d1-concurrency-contract.test.ts` | Supporting — test | Static lock/audit contract only; explicitly not multi-session PostgreSQL proof. |

## Additions made after the initial inventory

The following files/edits were made during the 30 October audit after the initial baseline inventory. They are direct, attributable compliance work and remain unstaged.

| File | Classification | Scope observation |
| --- | --- | --- |
| `lib/retailer/tax-invoice-readiness.ts` | Direct — tax invoice publication | Fail-closed invoice issuer configuration and marketplace-seller invoice-model guard. |
| `app/retailer/orders/[id]/invoice/page.tsx` | Direct — tax invoice publication | Stops rendering a tax invoice when issuer data/model is unresolved; preserves the underlying order. |
| `app/retailer/orders/[id]/invoice/download/route.ts` | Direct — tax invoice publication | Refuses a downloadable tax invoice when the same guard is unresolved. |
| `app/api/mobile/v1/orders/[id]/invoice/route.ts` | Direct — tax invoice publication | Applies the same guard to the mobile invoice endpoint. |
| `tests/tax-invoice-readiness.test.ts` | Supporting — test | Tests own-stock configuration, placeholder/invalid GSTIN rejection, seller-source blocking and all three invoice surfaces. |
| `docs/legal-review/COMPLIANCE_AUDIT_2026-10-30.md` | Direct — legal/readiness audit | Current source-based audit, finding register, evidence limits and owner/lawyer/CA register. |
| `docs/compliance/india-ecommerce-compliance-matrix.md` | Direct — legal/readiness audit | Adds an explicit historical/superseded warning so pre-existing PASS labels cannot be treated as current legal conclusions. |

## Result

No unrelated dirty file was identified by this static, file-level review. All currently visible changes are either direct compliance work or tests/documentation supporting it. That does not make them safe to commit as a single PR yet: migration/runtime execution, independent code review, legal/CA/owner approvals, and a final secret/provenance diff review remain required.
