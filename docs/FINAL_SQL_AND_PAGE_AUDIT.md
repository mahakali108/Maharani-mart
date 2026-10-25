# FINAL SQL & PAGE AUDIT — Maharani Traders

**Project in scope:** `fhrmsrumsraprvutrpeo` (Maharani-mart).
**Legacy project `gbxhmffsbsfhdrfuwurx` / `maharanimaa`:** not referenced, not
connected, not modified.
**Date:** 2026-10-24 · **Branch:** `arena/b405a872-maharani-mart`
**Supersedes:** `docs/SQL_AND_PAGE_AUDIT_2026-10-24.md` (same analysis, kept in
git history; this file is the single authoritative deliverable).

> **Nothing in this work touched production.** No production SQL was executed,
> no secret changed, no cron setting modified, no storage bucket or policy
> altered, no data deleted, no PR merged, nothing deployed.

---

## 0. What could be completed here, and what access is missing

| Task | Status in this workspace | Why |
| --- | --- | --- |
| Read/inspect the whole repo (76 migrations, 151 pages, 69 API routes, 15 rollbacks, tests) | **done** | local checkout |
| Apply every migration in order on a disposable PostgreSQL-compatible engine | **done** — 76/76, 0 failures (PGlite = PostgreSQL 16 WASM) | no credentials needed |
| Query the resulting catalog: RLS, 444 public + 32 storage policies, 106 `SECURITY DEFINER` fns, per-role EXECUTE, buckets | **done** | executes the real SQL |
| Cross-check every `.from()` / `.rpc()` in the app against that schema | **done** — 0 missing tables, 0 missing RPCs | static + catalog |
| Route inventory, internal-link check, role-gate analysis, page error/empty-state audit | **done** | file tree + code |
| Reproduce and fix page defects; add regression tests | **done** (26 read-failure pages + earlier layout/banner/list fixes + 2 query modules) | local |
| typecheck / ESLint / Vitest / production build | **done** — 150 files, 2 639 tests pass | local toolchain |
| Determine whether the 120-day deletion job is *running in Vercel* | **NOT POSSIBLE** — needs the Vercel project | no Vercel access |
| Read the official project's `supabase_migrations.schema_migrations` | **NOT POSSIBLE** — needs DB access | no CLI/token/connection string |
| Inspect production schema, policies, buckets, banner objects | **NOT POSSIBLE** | no `.env.local`, network to `*.supabase.co` blocked (TLS fails, HTTP 000) |
| Apply migrations 0074/0078, change cron/secrets, test against a live Supabase project | **NOT DONE BY DESIGN** | requires explicit owner approval |

**Minimum evidence needed to move from "repository-only" to "verified":**

1. Output of `supabase/audits/migration_and_security_verification_readonly.sql`
   (11 read-only SELECT blocks; run in the SQL editor of `fhrmsrumsraprvutrpeo`).
2. Vercel → Project → Cron Jobs / Settings → Environment Variables: whether a
   cron for `/api/cron/cleanup` is enabled and whether `CRON_SECRET` is set.
3. The deployed `NEXT_PUBLIC_SUPABASE_URL` value (URL only, never keys), to prove
   which project ref Preview and Production resolve to.
4. A verified backup/restore rehearsal before any write.

---

## 1. Method

1. **Migration replay.** Stubbed the Supabase platform surface (`auth.users`,
   `auth.uid()`, `storage.buckets/objects`, `anon/authenticated/service_role`,
   Supabase default privileges) and applied **all 76** files from
   `supabase/migrations` in filename order to PGlite (PostgreSQL 16 compiled to
   WASM). Result: 76 applied, 0 failed.
2. **Second pass (idempotency).** Re-applied the entire set on the same
   database: 16 files fail on re-entry (historical, non-idempotent by design,
   plus `0073` which is not).
3. **Catalog interrogation.** Tables, RLS flags, every policy, every
   `SECURITY DEFINER` function with `proconfig`, per-role `EXECUTE` privileges,
   function bodies for guard analysis, buckets, object policies, duplicate
   indexes, foreign keys.
4. **Static cross-check.** Every `.from('…')` and `.rpc('…')` in `app/`,
   `lib/`, `components/` compared against the replayed catalog.
5. **Page audit.** Route inventory from the tree, internal `href` link
   resolution, per-page guard detection, error/empty-state analysis of every
   page that reads Supabase.
6. **Behavioural proof.** Privilege-escalation and privilege-revocation
   assertions executed as `anon` / `authenticated` roles (see §4).
7. **Verification loop.** `tsc --noEmit`, `next lint`, `vitest run`,
   `next build` — before and after every change.

---

## 2. Migration status matrix

**Legend.** *Replay* = applies cleanly in order on PostgreSQL 16. *Re-run* =
the same file can be applied a second time. *Production* = state of
`fhrmsrumsraprvutrpeo`, which is **unknown** (see §0) except where the repo
itself documents otherwise.

### 2.1 Summary

| Category | Files | Evidence |
| --- | --- | --- |
| Applied **and verified** | **none** | production catalog unreachable |
| Not applied (documented in-repo) | `0074`, `0077`, `0078`, `0079` | headers + `docs/MIGRATION_APPLICATION_EVIDENCE.md`; `0078`/`0079` are new here |
| Partially applied / drift — cannot be excluded | `0073` (not re-runnable), and any history row whose effects are missing | second-pass test; §2.3 |
| Conflicting / duplicated / unsafe | `0055` (armed retention), `0073` (retry hazard), `0059` (number collision with PR #107), `0061` (dangling reference), 16 files not re-runnable | executed tests + PR file lists |
| Unverified | the remaining 72 | no production access |

### 2.2 Items the mission named explicitly

| Migration | Verdict | Evidence |
| --- | --- | --- |
| **0073** configured delivery pins | **Not re-runnable ⇒ retry hazard.** Three `create policy` statements and one `create trigger` have no `if not exists`/`drop` guard. A half-applied 0073 cannot be retried (fails `policy "delivery_pins_admin_read" … already exists`). Remote state unverified. | executed second pass |
| **0074** banner lifecycle | **Required by code already on `main`** (`lib/retailer/home-data.ts:173`, `lib/mobile/catalog-service.ts:512` filter `status='published'`; admin actions write `status`/`image_url_mobile`). Additive and re-runnable; safe SQL, but deploy order is wrong while it is unapplied — reads fail with `42703`. | grep + replay |
| **0077** draft storage | **Unapproved, and inert if applied alone**: no page or action references `draft_image_path` / `draft_image_mobile_path`; `types/database.types.ts` has no such columns; the copy-on-publish module (`lib/admin/banner-artwork.ts`) is not wired to any UI. Creates a private bucket + 4 admin-only policies. | grep + types |
| **0078** privilege hardening (new, this branch) | **Not applied anywhere.** Forward-only, re-runnable, guarded: revokes `EXECUTE` on `fefo_plan_for_product`, `current_offer_floor_paise`, `handle_new_user` from API roles; narrows two banner storage write policies to `is_admin_or_above()`. Matching rollback restores the previous grants **verbatim** (documented as a security downgrade). | `tests/privilege-hardening-db.test.ts` (11 executed cases) |
| **0079** API EXECUTE hardening, part 2 (new, this turn) | **Not applied anywhere.** Revokes `anon`/`authenticated` EXECUTE on `ensure_fefo_coverage` (it inserts inventory batches, no caller check); adds the missing caller check to `release_order_stock` (same body, `42501` for anon and for any non-owner/non-seller/non-staff caller); withdraws `anon` EXECUTE on 14 inventory/cost RPCs. Keeps `authenticated` grants and the RLS predicates that `public` policies evaluate. Rollback restores 0017's unguarded body and the anon grants — **security-weakening, labelled in the file**. | `tests/api-privilege-hardening.test.ts` (24 executed cases; 20 of them fail on the 0078-only database) |
| **0059** vs PR #107 | **Collision, unresolved by design.** `main` has `0059_supplier_applications.sql`; PR #107 adds `0059_india_compliance_safety.sql`. #107 must renumber (now **0080+**, because this branch took 0079 for its own review-only hardening) before it can ever be applied. **No file owned by #107 was modified.** | `gh pr view 107 --json files` |
| **0061** | **Does not exist and must not be invented.** `0062` still references a "0054/0061 allowlist convention" in a comment. | file list + grep |
| 0075 / 0076 | **Reserved and absent** (0075 = on-hold retention archive, 0076 = deferred banner `alt_text`). This branch used 0078 accordingly. | 0077 header |

### 2.3 Full inventory (all 76 migrations)

| # | Migration | Purpose | Replay | Re-run | Production | Action |
| --- | --- | :-: | :-: | :-: | --- | --- |
| 1 | `0001_init.sql` | Maa Kali B2B Ultra Platform — Production Database Schema | OK | **NO** | Unverified | None beyond history check |
| 2 | `0002_auth_trigger.sql` | 0002: Auth trigger + self-registration policy for retailers | OK | yes | Unverified | None beyond history check |
| 3 | `0003_storage_buckets.sql` | 0003: Storage buckets + policies for images/files | OK | **NO** | Unverified | None beyond history check |
| 4 | `0004_product_packs.sql` | 0004: Product Packs (pack-size variants of a base product) | OK | **NO** | Unverified | None beyond history check |
| 5 | `0005_master_data_delete_and_pricing.sql` | 0005: Master data RLS, product barcode, pack pricing tiers | OK | **NO** | Unverified | None beyond history check |
| 6 | `0006_retailer_documents.sql` | 0006: Retailer documents + audit_logs RLS | OK | **NO** | Unverified | None beyond history check |
| 7 | `0007_pack_based_ordering.sql` | 0007: Pack-based cart & order line items + order numbering + pack MOQ | OK | **NO** | Unverified | None beyond history check |
| 8 | `0008_order_status_history_rls.sql` | 0008: order_status_history RLS + auto-logging trigger | OK | **NO** | Unverified | None beyond history check |
| 9 | `0009_order_operations_inventory.sql` | 0009: Order operations (dispatch/cancel/assign) + stock reservation + | OK | **NO** | Unverified | None beyond history check |
| 10 | `0010_route_assignment_rls.sql` | 0010: Route assignment write policies | OK | **NO** | Unverified | None beyond history check |
| 11 | `0011_fix_retailer_row_creation.sql` | 0011: Fix retailer row never being created when email confirmation is on | OK | yes | Unverified | None beyond history check |
| 12 | `0012_fix_registration_phone_conflict.sql` | 0012: Fix root cause of "users are not being created during registration" | OK | yes | Unverified | None beyond history check |
| 13 | `0013_rls_and_storage_hardening.sql` | 0013: RLS + storage policy hardening | OK | **NO** | Unverified | None beyond history check |
| 14 | `0014_salesman_retailer_order_rls.sql` | 0014: Assigned-retailer access and salesman order-capture RLS | OK | yes | Unverified | None beyond history check |
| 15 | `0015_retailer_favorites.sql` | 0015: retailer_favorites — retailer wishlist/favourite products | OK | yes | Unverified | None beyond history check |
| 16 | `0016_storage_paths_category_bucket.sql` | 0016: Supabase Storage — category bucket + object-path alignment | OK | **NO** | Unverified | None beyond history check |
| 17 | `0017_inventory_batches_fefo_grn.sql` | 0017: Inventory Management System — Batches, Expiry, FEFO, GRN, Transfers | OK | yes | Unverified | None beyond history check |
| 18 | `0018_maharani_ai_security.sql` | 0018: Maharani AI security support | OK | **NO** | Unverified | None beyond history check |
| 19 | `0019_ai_demand_forecast.sql` | 0019: AI Demand Forecasting support | OK | yes | Unverified | None beyond history check |
| 20 | `0020_super_admin_control_center.sql` | Super Admin Master Control Center | OK | **NO** | Unverified | None beyond history check |
| 21 | `0021_ensure_category_images_bucket.sql` | 0021: ensure `category-images` bucket exists (idempotent fix) | OK | yes | Unverified | None beyond history check |
| 22 | `0022_case_based_pricing.sql` | 0022: Case-based pricing (case is the primary pricing unit) | OK | **NO** | Unverified | None beyond history check |
| 23 | `0023_sku_code_optional.sql` | 0023: Make products.sku_code optional (SKU Code removed from the product | OK | yes | Unverified | None beyond history check |
| 24 | `0024_pack_variant_images.sql` | 0024: Per-variant (pack) product image | OK | **NO** | Unverified | None beyond history check |
| 25 | `0025_cost_price_column_lockdown.sql` | 0025: Column-level lockdown of purchase cost (`cost_price`) | OK | yes | Unverified | None beyond history check |
| 26 | `0026_case_and_loose_piece_pricing.sql` | 0026: Case price + LOOSE PIECE quantity tiers | OK | yes | Unverified | None beyond history check |
| 27 | `0027_powder_category_and_catalog_constraints.sql` | 0027: Powder catalog enablement and variant integrity | OK | yes | Unverified | None beyond history check |
| 28 | `0028_product_pack_gallery.sql` | 0028: Variant gallery — multiple images per pack (product_packs) | OK | yes | Unverified | None beyond history check |
| 29 | `0029_retailer_wallet_ledger.sql` | 0029: Retailer Wallet / Credit Ledger — production-ready B2B credit system | OK | yes | Unverified | None beyond history check |
| 30 | `0030_wallet_rpc_security.sql` | 0030: Wallet RPC security hardening + idempotency safety | OK | yes | Unverified | None beyond history check |
| 31 | `0031_wallet_outstanding_opening_baseline.sql` | 0031: Fix wallet outstanding double-counting + salesman order-capture access | OK | yes | Unverified | None beyond history check |
| 32 | `0032_retailer_address_book.sql` | 0032: retailer_addresses — saved delivery address book for retailers | OK | yes | Unverified | None beyond history check |
| 33 | `0033_retailer_saved_carts.sql` | 0033: retailer_saved_carts — named saved carts / save-for-later | OK | yes | Unverified | None beyond history check |
| 34 | `0034_retailer_product_feedback.sql` | 0034: retailer_product_issues + retailer_stock_alerts | OK | yes | Unverified | None beyond history check |
| 35 | `0035_retailer_profile_rpc_prefs_requests.sql` | 0035: shop-profile self-service RPC + notification prefs + account requests | OK | yes | Unverified | None beyond history check |
| 36 | `0036_order_shipping_address.sql` | 0036: orders.shipping_address — delivery address snapshot on the order | OK | yes | Unverified | None beyond history check |
| 37 | `0037_staff_scope_policies.sql` | 0037: Staff assignment scoping (Phase 2, confirmed decision D1) | OK | yes | Unverified | None beyond history check |
| 38 | `0038_staff_targets_commissions.sql` | 0038: Staff targets & commissions (Phase 2) | OK | yes | Unverified | None beyond history check |
| 39 | `0039_follow_ups.sql` | 0039: Salesman follow-up reminders (Phase 2) | OK | yes | Unverified | None beyond history check |
| 40 | `0040_schemes_audit.sql` | 0040: schemes audit trigger (Phase 2) | OK | yes | Unverified | None beyond history check |
| 41 | `0041_area_stock_view.sql` | 0041: Area stock view (Phase 3 — warehouse & area stock operations) | OK | yes | Unverified | None beyond history check |
| 42 | `0042_order_state_machine.sql` | 0042: Order status state machine (Phase 4 — order lifecycle) | OK | yes | Unverified | None beyond history check |
| 43 | `0043_deliveries_module.sql` | 0043: Deliveries module (Phase 4 — order lifecycle & delivered module) | OK | yes | Unverified | None beyond history check |
| 44 | `0044_payment_collections.sql` | 0044: Payment collections (Phase 4 — sales executive collection workflow) | OK | yes | Unverified | None beyond history check |
| 45 | `0045_delivery_payment_proof_buckets.sql` | 0045: Private proof buckets — delivery-proofs & payment-proofs (Phase 4) | OK | yes | Unverified | None beyond history check |
| 46 | `0046_smoke_fixture.sql` | 0046: Smoke-test fixture table used by supabase/smoke-test.sql | OK | yes | Unverified | None beyond history check |
| 47 | `0047_banner_content.sql` | Optional merchant-authored copy for the retailer home carousel. | OK | yes | Unverified | None beyond history check |
| 48 | `0048_support_tickets.sql` | 0048: Support tickets (retailer helpdesk) | OK | yes | Unverified | None beyond history check |
| 49 | `0049_credit_payment_terms.sql` | 0049: Credit payment terms (Net-15 / Net-30 / …) | OK | yes | Unverified | None beyond history check |
| 50 | `0050_catalog_admin_upgrade.sql` | 0050: Catalog administration upgrade (Phase 3) | OK | yes | Unverified | None beyond history check |
| 51 | `0051_coupon_system.sql` | 0051: B2B coupon / promo code system | OK | yes | Unverified | None beyond history check |
| 52 | `0052_phase0_security_hardening.sql` | 0052 — PHASE 0 EMERGENCY SECURITY HARDENING | OK | yes | Unverified | None beyond history check |
| 53 | `0053_order_coin_refund.sql` | 0053 — 🪙 ORDER COIN REFUNDS — one atomic, auditable, RLS-safe function | OK | yes | Unverified | None beyond history check |
| 54 | `0054_simplified_pack_stock.sql` | 0054 — SIMPLIFIED PACK STOCK + SERVER-AUTHORITATIVE ORDER DEDUCTION | OK | yes | Unverified | None beyond history check |
| 55 | `0055_data_retention_cleanup.sql` | 0055 — DATA RETENTION & CLEANUP (90-day temporary + 120-day business data) | OK | yes | Unverified | **On hold** — deletion engine already armed, see §4 S1 |
| 56 | `0056_mobile_checkout_atomic.sql` | 0056: Native checkout foundation — one server-only order transaction | OK | yes | Unverified | None beyond history check |
| 57 | `0057_security_definer_hardening.sql` | 0057 — SECURITY DEFINER hardening for the five functions flagged in review | OK | yes | Unverified | None beyond history check |
| 58 | `0058_saran_default_district.sql` | 0058 — Default service district: Saran (Bihar) | OK | yes | Unverified | None beyond history check |
| 59 | `0059_supplier_applications.sql` | 0059: Supplier applications (V1, application-only — approved design) | OK | yes | Unverified | None beyond history check |
| 60 | `0060_supplier_application_rate_limit.sql` | 0060: Durable rate limiting for the public supplier application form. | OK | yes | Unverified | None beyond history check |
| 61 | `0062_seller_identity.sql` | 0062: Seller Marketplace — seller identity, membership and review states. | OK | yes | Unverified | None beyond history check |
| 62 | `0063_seller_offers.sql` | 0063: Seller Marketplace — offers, admin price floors, moderation, history. | OK | yes | Unverified | None beyond history check |
| 63 | `0064_split_order_identity.sql` | 0064: Seller Marketplace — split-order identity EXPAND layer (behaviour | OK | yes | Unverified | None beyond history check |
| 64 | `0065_checkout_split_rpcs.sql` | 0065: Seller Marketplace — checkout behaviour switch (deploy DB-first). | OK | yes | Unverified | None beyond history check |
| 65 | `0066_fulfilment_and_delivery.sql` | 0066: Seller Marketplace — fulfilment: seller shipments, delivery link, | OK | yes | Unverified | None beyond history check |
| 66 | `0067_seller_settlement.sql` | 0067: Seller Marketplace — settlement plane: collection allocations, seller | OK | yes | Unverified | None beyond history check |
| 67 | `0068_seller_governance.sql` | 0068: Seller Marketplace — governance: drain-mode suspension, admin-only | OK | yes | Unverified | None beyond history check |
| 68 | `0069_seller_portal_access.sql` | 0069: Seller portal access, self-registration and marketplace disclosure. | OK | yes | Unverified | None beyond history check |
| 69 | `0070_seller_invite_only.sql` | 0070: Super Admin-only seller account invitations. | OK | yes | Unverified | None beyond history check |
| 70 | `0071_gaya_default_district.sql` | 0071: Set the district for NEW admin-created service areas to Gaya, Bihar. | OK | yes | Unverified | None beyond history check |
| 71 | `0072_super_admin_seller_invitations.sql` | 0072: Forward-only seller onboarding hardening after main's | OK | yes | Unverified | None beyond history check |
| 72 | `0073_configured_delivery_pins.sql` | 0073: Configured delivery coverage AFTER main's 0071 sets the Gaya default. | OK | **NO** | Unverified | Verify; retry needs manual guard (§4 S4) |
| 73 | `0074_banner_lifecycle_and_variants.sql` | Banner lifecycle and responsive artwork. | OK | yes | Repo-only, **not applied** (repo docs) | **Blocking for the app** — see §4 S2 |
| 74 | `0077_banner_draft_artwork.sql` | 0077 — private storage for UNPUBLISHED banner artwork. | OK | yes | Repo-only, **not applied**; unreviewed | Hold — feature not wired end-to-end |
| 75 | `0078_privilege_hardening.sql` | 0078 — forward-only privilege hardening found by the repository SQL audit. | OK | yes | **New in this branch — not applied** | Owner approval; apply after 0074 decision (order-independent) |
| 76 | `0079_api_execute_hardening.sql` | 0079 — API-role EXECUTE hardening, part 2: `ensure_fefo_coverage` owner-only, `release_order_stock` caller check, `anon` grants withdrawn from 14 inventory/cost RPCs. | OK | yes | **New this turn — not applied** | Owner approval; independent of 0074/0077/0078 |

---

## 3. The 120-day deletion job — what the evidence actually supports

### 3.1 What is verifiable from the repository

| Fact | Evidence | Consequence |
| --- | --- | --- |
| A daily cron **is declared** targeting the deletion endpoint | `vercel.json` → `"crons": [{ "path": "/api/cron/cleanup", "schedule": "0 2 * * *" }]` | if that file is the one deployed to Vercel, a cron exists |
| The endpoint **fails closed** without a secret | `app/api/cron/cleanup/route.ts`: no `CRON_SECRET` → HTTP 503 before any work | an unset secret disables the job |
| With the secret set, it **deletes** | `run_data_cleanup(false, 'cron', batch 500, max 20000/target)` via the service-role client | real deletions, daily |
| The retention registry is **armed at the SQL level** | `0055` seeds `data_retention_rules` with `enabled = true` for: `orders` (120 d + cascades), `retailer_wallet_ledger` (coins/credit/refunds), `payment_collections`, `return_requests`, `order_stock_allocations`, `stock_movements`, plus 90-day temporary targets (abandoned carts, notifications, logs, invites, AI rate-limit windows, cleanup logs) | enabling the scheduler is enough; no extra SQL needed |
| A **second** 120-day storage sweep runs in the same request | `lib/retention/storage-cleanup.ts` — only `delivery-proofs` and `payment-proofs`, 120 d, caps 500 deletes / 2 000 scans per bucket; every other bucket (incl. `product-images`, `retailer-documents`, `banner-drafts`) is permanent-by-default and structurally unreachable | proof imagery older than 120 days is deleted too |
| The admin UI can only **dry-run** | `app/admin/cleanup/page.tsx` + `lib/admin/cleanup-actions.ts` (`p_dry_run: true`) | no manual production deletion path from the UI |

### 3.2 What cannot be determined here

Whether **Vercel currently has that cron enabled** and whether **`CRON_SECRET`
is set** in Production. Both are Vercel-side facts. **Therefore the status of
the deletion job is UNVERIFIED — I do not claim it is running, and I do not
claim it is stopped.** The two SQL facts above (registry armed, engine
reachable) plus one Vercel fact (cron + secret) decide it:

| `data_retention_rules` enabled | `CRON_SECRET` set | Vercel cron deployed | Outcome |
| --- | --- | --- | --- |
| true | yes | yes | **deletions are running daily** |
| true | yes | no | dormant, but any manual call of the endpoint with the secret would run it |
| true | no | any | disabled — endpoint returns 503 |
| false (`business_120`) | yes | yes | only the 90-day temporary rules run |

### 3.3 Safe, reversible pause plan (owner approval required — not executed)

Ordered from least to most invasive; **step A alone stops all deletion**.

**A. Vercel side (no database change, instantly reversible)**
1. Vercel → Project → Settings → Cron Jobs → **Pause/Delete** the
   `/api/cron/cleanup` job.
   *Reversible:* re-add the same schedule from `vercel.json`.
2. Belt-and-braces: remove/rotate `CRON_SECRET` in Production env.
   *Reversible:* set it again. The endpoint then returns 503 and deletes nothing.
   *Cost:* a redeploy.

**B. Database side (finer control, keeps the scheduler running for 90-day logs)**
```sql
-- OWNER APPROVAL REQUIRED. Reversible: set enabled = true again.
begin;
update public.data_retention_rules
   set enabled = false
 where category = 'business_120';          -- orders, coins/credit ledger,
                                           -- payments, returns, allocations,
                                           -- stock movements
select target_key, category, enabled from public.data_retention_rules
 order by deletion_order;                  -- verify: business_120 all false
commit;
```
*Pre-check:* `select status, count(*), max(completed_at) from cleanup_runs group by status;`
— if runs exist with `completed_at` recent, deletion has already been happening
and the accountant must review what was removed.

*Owner-facing version of this section, with the exact evidence to collect
(and nothing sensitive to paste), is `docs/OWNER_SECURITY_EVIDENCE_PACK.md`.*

*Executed finding (this branch):* `guard_data_retention_rules_mutation()`
(0055) rejects UPDATE/DELETE/INSERT on `data_retention_rules` unless the
current role is `postgres`/`supabase_admin`. The **service-role key cannot
pause the job** (it fails `42501`); block B must be run in the SQL Editor (or
as `postgres`) or it will silently be assumed to have worked. The same run
confirmed the 12 registry rows: `business_120` = allocations, returns,
coins_ledger, payment_records, stock_movements, orders (all `enabled = true`);
`temporary_90` = carts, notifications, notification_logs, invites,
ai_rate_limit, cleanup_runs.

**C. Code side (permanent, reviewed via PR — not done here)**
Remove the `crons` entry from `vercel.json` and/or gate `run_data_cleanup` behind
a kill-switch setting. **`vercel.json` and the retention files are owned by open
PR #107**, so this must be coordinated with that PR, not applied twice.

**What this branch deliberately did NOT do:** no retention SQL, no cron change,
no rule flip, no data deletion, no "kept forever" rewrite. 0055/0075 stay on
hold exactly as instructed.

### 3.4 Data the pause protects

Orders and their items/status history/deliveries, payment collections, the
coins/credit wallet ledger, return requests, stock allocations and movements,
plus 90-day temporary records (carts, notifications, logs, invites). Master data
(products, packs, images, categories, brands, pricing, current stock), KYC
documents and banner artwork are **never** in scope of the engine.

---

## 4. Prioritized bug & security list

Severity: **P0** data loss · **P1** broken/unsafe in production · **P2** wrong
behaviour or misleading UI · **P3** hygiene.

| # | Sev | Finding | Evidence | Status |
| --- | --- | --- | --- | --- |
| 1 | **P0** | On-hold 120-day deletion engine is armed in SQL and scheduled in `vercel.json`; whether it runs depends on one Vercel env var. Threatens orders, payments, coins/credit ledger. | `0055` seed rows + `vercel.json` + cron route | **Documented + pause plan (§3.3); not changed — owner decision** |
| 2 | **P1** | `main`'s code requires unapplied `0074`: home/mobile banner reads and all banner writes reference `status` / `image_url_mobile`. Against 0073 every banner read fails `42703`; admin list looked like "no banners". | grep of `home-data.ts`, `catalog-service.ts`, `banners-actions.ts` | **UI truthfulness fixed** (explicit failure notice); schema is an owner migration decision |
| 3 | **P1** | `fefo_plan_for_product(uuid,uuid,int)` — `SECURITY DEFINER`, **no caller check**, `EXECUTE` granted to `anon`. Anonymous disclosure of per-warehouse batch ids and quantities for any product id. | catalog: `has_function_privilege('anon', …) = true`; body has no guard | **Fix prepared in 0078** (revoke; only called from definer bodies in 0017) |
| 4 | **P1** | `current_offer_floor_paise(uuid)` — `SECURITY DEFINER`, **no caller check**, granted to `authenticated` (0063). Any signed-in account reads the confidential seller price floor of any pack. | same method; callers are 0063 trigger + 0065/0069 definer RPCs only | **Fix prepared in 0078** |
| 5 | **P1** | Banner artwork in Storage writable by **staff** (`staff_write_banners` / `staff_update_banners`, 0003) while the `banners` table policy is admin-only (0074) and `banners.manage` is admin+super_admin. | policy text vs `lib/permissions/permissions.ts` | **Fix prepared in 0078** (keeps the same policy names) |
| 6 | **P1** | Retention job could also delete **proof objects** (delivery/payment) older than 120 days in the same request. | `lib/retention/storage-cleanup.ts` | In scope of the §3 pause |
| 7 | **P2** | 31 pages called the **throwing** `requirePermission` during render ⇒ a role that reaches a page it lacks permission for got `error.tsx` ("Something went wrong") instead of `/unauthorized`. | `lib/admin/guard.ts` docs + page scan | **Fixed** — 28 pages converted to `requirePagePermission`; 6 nested Server Actions keep the throwing guard |
| 8 | **P2** | Admin layout only proved "somebody is signed in" while 35 admin pages have no page-level guard ⇒ the `/admin` area depended on middleware alone. | `app/admin/layout.tsx` before/after | **Fixed** — layout now enforces the `/admin` role prefix |
| 9 | **P2** | Failed reads rendered as legitimate empty states: `/admin/orders` ("No orders yet" + "No more orders"), `/admin/sellers` ("No sellers yet"), `/admin/banners` ("No banners yet"), and `/admin/banners/[id]` returned **404 for a query error** (looks like the banner was deleted). | pages destructured `{ data }` only | **Fixed** — explicit failure notices; 404 only when the read succeeded |
| 10 | **P2** | `0073` cannot be retried if half-applied. | second-pass replay | Reported; fix requires a reviewed forward migration (not written — remote state unknown) |
| 11 | **P2** | Staff/salesman role is granted at signup before e-mail confirmation (`handle_new_user` ignores `email_confirmed_at`); safety depends on GoTrue "Confirm email" being ON. | `0052`/`0072` function bodies | Reported — owner must confirm the Auth setting |
| 12 | **P3** | `0059` number collision with PR #107; `0061` referenced but absent. | PR file list; `0062` comment | Reported; renumbering is #107's owner's job |
| 13 | **P3** | `middleware.ts` has dead code: `PUBLIC_PATHS` / `isPublicPath()` unused; the list omits `/register-supplier`, `/forgot-password`, `/legal/*` (harmless today). | grep | Reported only (auth path, cosmetic) |
| 14 | **P3** | `lib/admin/seller-actions.ts` and `lib/delivery/otp.ts` handle secrets but lack an explicit `import 'server-only'` (they are only imported from server modules today). | grep of `SERVICE_ROLE` users | Reported only |
| 15 | **P3** | 16 historical migrations are not re-runnable; `is_phone_registered` is intentionally anon-callable (enumeration surface, rate-limit decision open since 0057). | second-pass replay; 0057 note | Reported, by design |
| 16 | **P1** | `ensure_fefo_coverage(uuid,uuid,int)` — `SECURITY DEFINER`, **no caller check**, EXECUTE-able by `anon` **and** `authenticated`, and it **writes**: when batches do not cover the request it inserts rows into `inventory_batches`. Anyone with the publishable key could create stock for any product/warehouse and skew the movement ledger. | privilege probe (`has_function_privilege('anon',…)=true`), body has no guard, executed call as `anon` reached the insert path | **Fix prepared in 0079** (owner-only; both callers are definer bodies in 0017) |
| 17 | **P1** | `release_order_stock(uuid)` — `SECURITY DEFINER`, deliberately unguarded, EXECUTE-able by `anon` and `authenticated`. Any signed-in account could release another retailer's live reservations (the function then frees those units for a second sale). 0017's comment explains who calls it, not why nobody may. | executed: retailer B released retailer A's order before the fix, `42501` after | **Fix prepared in 0079** (staff/admin, owning retailer, seller with a child order, `service_role`, or a JWT-less DB session; identical body/idempotency) |
| 18 | **P3** | 14 further definer functions (`adjust_product_stock`, `confirm_grn`, `cancel_grn`, `cancel_stock_transfer`, `execute_stock_transfer`, `record_batch_loss`, `reserve_order_stock`, `require_inventory_role`, `consume_ai_confirmation`, `consume_ai_rate_limit`, and four `admin_*_cost(s)` readers) were EXECUTE-able by `anon` although each either mutates stock or returns confidential cost behind a caller check an anonymous call can never satisfy. | privilege probe over the whole catalog | **Fix prepared in 0079** (anon-only revoke; `authenticated` grants unchanged) |
| 19 | **P2** | 26 detail pages turned a **failed read into a 404**: they destructured `{ data }`, dropped `error`, and called `notFound()`, so a query/permission failure was reported to the user as "this record no longer exists" (orders, products, retailers, sellers, wallets, support, goods receipts, invoices, deliveries). | page scan (31 `notFound()` sites) + per-page read; `lib/supabase/read-guard.ts`, `lib/delivery/queries.ts` | **Fixed in 23 pages + 2 query modules + the shared `read-guard`**; 3 pages are owned by open PRs #107/#42 and are **handed off** (`docs/HANDOFF_TO_PR_OWNERS.md`) and listed as `PENDING HANDOFF` in `tests/detail-pages-read-failure.test.ts` (see §6.1) |

### 4.1 Verified-good (so the list above is read in context)

* All **95** public tables/views have RLS enabled; no `DISABLE ROW LEVEL SECURITY` anywhere.
  (Count is taken from the catalog after the full replay; earlier drafts said 89
  because `information_schema` + `pg_tables` disagreed on the partitioned/`if not
  exists` tables. `tests/migration-catalog-invariants.test.ts` now asserts it.)
* **106** `SECURITY DEFINER` functions, **0** without a pinned `search_path`; **0**
  reachable by `anon` without either a caller check or a reviewed public purpose
  once 0078 + 0079 are applied (the invariant is now a test, not a paragraph).
* **0** duplicate indexes; **206** foreign keys; 3 tables intentionally
  policy-less and service-role only (`cleanup_runs`, `data_retention_rules`,
  `supplier_application_rate_limits`).
* 33 write policies without explicit `WITH CHECK` are **not** a widening —
  `UPDATE`/`ALL` inherit `USING` (catalog-verified).
* Privilege escalation is **blocked and proven**: an active retailer calling
  `update profiles set role='super_admin'` gets `42501` from
  `trg_guard_profile_privileged_columns`; `is_active` likewise; `full_name` on
  their own row is allowed. An unapproved retailer cannot reach that point
  (`active_account_update` restrictive policy).
* Service-role clients appear only in server modules (`lib/supabase/server.ts`
  is `server-only`; no client component imports it).
* Every bucket the app targets exists after the replay, every private bucket's
  policy is path-scoped (no bare `bucket_id = …` read), and banner artwork
  writes are `is_admin_or_above()` only.
* The **application ↔ schema contract** is now executed: 699 source files,
  **1 041** `.from()` references and **61** `.rpc()` references all resolve
  (plus every RPC's argument names), and no migration version is duplicated.

---

## 5. SQL files created / modified in this branch

| File | Kind | Applied? | Notes |
| --- | --- | --- | --- |
| `supabase/migrations/0078_privilege_hardening.sql` | forward-only migration | **No** | Guarded on `to_regprocedure(...)`; re-runnable; no DROP TABLE/COLUMN, no DELETE, no data change; addresses #3, #4, #5 |
| `supabase/rollbacks/0078_privilege_hardening.sql` | rollback | No | Restores the pre-0078 grants and the two 0003 policies verbatim. **This rollback weakens security** (re-opens anon/authenticated access to the price floor and inventory plan) — documented in the file header; use only on staging or with written acceptance |
| `supabase/migrations/0079_api_execute_hardening.sql` | forward-only migration | **No** | Guarded on `to_regprocedure(...)`; re-runnable; no DROP/DELETE/data change; addresses #16, #17, #18. Keeps every `authenticated` grant and every predicate that `public` RLS policies evaluate for anonymous readers |
| `supabase/rollbacks/0079_api_execute_hardening.down.sql` | rollback | No | Restores 0017's unguarded `release_order_stock` body and the pre-0079 `anon` grants **verbatim**. **This rollback weakens security** (re-opens #16 and #17) — header says so; use only for an exact revert |
| `tests/api-privilege-hardening.test.ts` | test (executed) | n/a | 24 cases: anon/authenticated `ensure_fefo_coverage`, owner/non-owner/staff/service `release_order_stock`, all 14 revoked grants, and the deliberate exceptions (`is_phone_registered`, `submit_supplier_application`, RLS predicates, anonymous catalog read) |
| `tests/migration-catalog-invariants.test.ts` | test (executed) | n/a | 13 catalog invariants + app↔schema contract (RLS coverage, policy-less allow-list, definer `search_path`, anon-exposure allow-list, buckets, private-bucket policies, duplicate indexes, unvalidated FKs, contiguous numbering, table/view/RPC references) |
| `tests/release-stock-authorization.test.ts` | test (executed) | n/a | 20 cases: the full `release_order_stock` matrix — allowed (staff/admin/super_admin, service_role, owning retailer, seller with a child order, salesman for an assigned or personally-collected order, JWT-less session) vs denied (anon, other retailer, another seller, another salesman, deactivated admin), plus idempotency and three real cancellation paths |
| `tests/api-execute-revocation-flows.test.ts` | test (executed) | n/a | 11 cases proving AUTHORIZED inventory work still runs after 0079: GRN confirm (and idempotent re-confirm), GRN cancel, transfer execute, transfer cancel, batch loss, stock adjustment, plus the anon/retailer denial for each |
| `docs/OWNER_SECURITY_EVIDENCE_PACK.md` | owner runbook | n/a | What to send back (E1–E7), how to run the read-only script, expected result per block, the two independent ways to pause the retention job |
| `docs/HANDOFF_TO_PR_OWNERS.md` | handoff | n/a | The read-failure fix for the three pages owned by PR #107 / #42 (this branch must not edit them) + the migration-number reservation for #107 |
| `supabase/audits/migration_and_security_verification_readonly.sql` | read-only audit (edited) | n/a | **11** SELECT blocks: history, numbering (76 versions incl. 0079), 0074/0077 effects, 0078/0079 grant posture, banner storage, RLS coverage, definer hygiene, **COUNT-only** object inventory, retention registry + run history, and the new anon-EXECUTE inventory (must be empty of `NO CALLER CHECK — REVIEW` rows) |
| (unchanged) `supabase/migrations/0055_data_retention_cleanup.sql` | — | — | **On hold.** No retention or deletion job was added or altered |

No historical migration was edited, renumbered or replayed. No table, column,
row, bucket or object was dropped.

---

## 6. Page-by-page repair checklist

**Inventory:** 151 pages · 69 route handlers · 6 layouts · 16 `loading.tsx` ·
8 `error.tsx` · 1 `not-found.tsx`.
**Automated results:** 0 missing tables/views · 0 missing RPCs · 0 broken
internal links (243 static `href` literals) · 0 protected pages without a guard.

### 6.1 Changed in this branch

| Route / file | Problem | Fix |
| --- | --- | --- |
| `app/admin/layout.tsx` | area protected by middleware only | role-prefix check + `/unauthorized` redirect |
| `app/admin/banners/page.tsx` | query error ⇒ "No banners yet" | explicit "Banners could not be loaded" notice + error text + 0074 hint; empty state suppressed on failure |
| `app/admin/banners/[id]/page.tsx` | query error ⇒ **404** | 404 only when the read succeeded; otherwise throws to `error.tsx` with the message |
| `app/admin/orders/page.tsx` | query error ⇒ "No orders yet"; a failed continuation ⇒ "No more orders" | failure notice for the first batch; the load-more action throws so the client shows an error row instead of an end-of-list |
| `app/admin/sellers/page.tsx` + `lib/admin/sellers-query.ts` | `listSellers` swallowed errors and returned `[]`, page rendered "No sellers yet" | `failed` / `failureMessage` in the contract; explicit notice |
| 28 pages (list in §6.3) | throwing guard during render ⇒ error boundary for an authorization decision | `requirePagePermission` (redirect to `/unauthorized`) |
| `app/retailer/orders/[id]/page.tsx`, `app/admin/orders/[id]/page.tsx` | failed read ⇒ 404 ("order deleted") | `throwIfReadFailed(error, 'Order')` before `notFound()` |
| `app/admin/products/[id]/page.tsx` | `.single()` error ⇒ 404 | error surfaced; 404 only for `PGRST116` |
| `app/admin/retailers/[id]/page.tsx`, `app/admin/wallets/[id]/page.tsx` | failed retailer read ⇒ 404 | error destructured and rethrown to `error.tsx` |
| `app/admin/sellers/[id]/page.tsx` + `lib/admin/sellers-query.ts` | `getSellerDetail` returned `null` for both "missing" and "failed" | `failureMessage` on the contract; page throws on failure, 404 only on absence |
| `app/admin/support/[id]/page.tsx`, `app/retailer/support/[id]/page.tsx` | failed ticket read ⇒ 404; also hid the RLS "not yours" case behind the same 404 message | read failure thrown; `notFound()` kept for "no row visible to you" |
| `app/retailer/orders/[id]/invoice/page.tsx` | a **money document** 404'd on a read error | **REVERTED — handed off.** The file belongs to open PR #107, which already throws on `orderError` in its own version, so the defect closes when #107 merges (`docs/HANDOFF_TO_PR_OWNERS.md`) |
| `app/retailer/orders/[id]/page.tsx`, `app/retailer/catalog/[id]/page.tsx` | same defect | **REVERTED — handed off.** Owned by PR #107 and PR #42; this branch's edit was removed to honour "do not edit open-PR files". Exact hunks are in `docs/HANDOFF_TO_PR_OWNERS.md`; both routes still 404 on a failed read until those PRs land |
| `app/admin/inventory/grn/[id]/page.tsx` | failed GRN read ⇒ "receipt deleted" | read failure thrown |
| `lib/delivery/queries.ts` (`fetchDeliveryDetail`) | returned `null` for a failed read, so `/admin/delivered/[orderId]`, `/retailer/orders/[id]/delivery`, `/salesman/deliveries/[orderId]`, `/staff/deliveries/[orderId]` and the mobile delivery route all answered 404/`not_found` | error thrown with code + message; mobile route already maps a thrown error to `503 database_unavailable`, which is the honest answer |
| `app/admin/areas/[id]`, `admin/catalog/brands/[id]`, `admin/catalog/categories/[id]`, `admin/coupons/[id]`, `admin/routes/[id]`, `admin/team/[id]`, `admin/warehouses/[id]`, `admin/suppliers/applications/[id]` | same defect on `.single()` / `.maybeSingle()` — a 42703 or an RLS denial showed as "deleted" | `throwIfReadFailed(...)` before `notFound()` |
| `app/salesman/orders/[id]`, `salesman/retailers/[id]`, `staff/orders/[id]`, `retailer/orders/[id]/reorder` | same defect on order/retailer detail | `throwIfReadFailed(...)` before `notFound()` |
| `app/retailer/catalog/[id]` (product **and** pack resolution) | three lookups 404'd on failure — on the customer-facing product page | all three errors thrown |
| `app/retailer/brands/[id]` | `errors.brand` flag ignored before `notFound()` | flag now throws |
| `app/retailer/categories/[id]` | `errors.category` flag ignored before `notFound()` | flag now throws |
| `app/salesman/orders/new` | a failed retailer read rendered "No active retailers assigned" — a false statement about the salesman's book | read failure thrown; the empty state now only means empty |
| `lib/supabase/read-guard.ts` + `tests/detail-pages-read-failure.test.ts` | the class, not just the instances | shared helper + a scan that fails if any `notFound()` page stops distinguishing the two cases (2 documented exceptions) |

### 6.2 Audited, no change needed

| Area | Finding |
| --- | --- |
| Public (`/`, `/login`, `/register-retailer`, `/register-seller`, `/register-supplier`, `/forgot-password`, `/reset-password`, `/about`, `/contact`, `/legal/*`, `/unauthorized`, `/access-expired`, `/pending-approval`) | render; supplier application is the only public write path and is rate-limited server-side + RPC-level |
| Retailer (39 pages) | layout blocks non-retailers and pending/suspended accounts **before** any query; per-page reads owner-scoped |
| Seller (6 pages) | `requireSellerPage` + membership check; inactive sellers pinned to `/seller/status` |
| Staff (9) / Salesman (18) | layouts enforce the role prefix; guards redirect |
| Admin (62) | now guarded twice (middleware + layout); narrower powers via page guards; `/admin/control-center*` requires Super Admin |
| Mobile API (69 handlers) | every RPC and table they reference exists in the migration set |
| Loading/empty/error states | root + role shells + 16/8 segment boundaries; empty states are real empty states (the four misleading ones are fixed above) |
| `notFound()` for authorization, not for absence (`salesman/orders/new`'s unassigned-retailer branch, role checks in the retailer/staff/salesman layouts) | these 404 deliberately so a URL cannot be used to enumerate accounts | unchanged — but the page's *read* failure no longer shares that path |

### 6.3 Pages converted to the redirecting guard

`admin/ai`, `admin/areas/[id]`, `admin/banners/[id]`, `admin/collections`,
`admin/commissions`, `admin/coupons`, `admin/coupons/[id]`, `admin/coupons/new`,
`admin/dashboard`, `admin/delivered`, `admin/delivered/[orderId]`,
`admin/inventory/forecast`, `admin/inventory/grn/[id]`,
`admin/inventory/grn/new`, `admin/inventory/reports`, `admin/inventory/transfers`,
`admin/pricing/schemes`, `admin/targets`, `salesman/collections`,
`salesman/deliveries`, `salesman/deliveries/[orderId]`, `staff/ai`,
`staff/dashboard`, `staff/deliveries`, `staff/deliveries/[orderId]`,
`staff/inventory`, `staff/orders`, `staff/orders/[id]`
(28 files; `admin/cleanup` **excluded** — owned by open PR #107).

### 6.4 Deliberately untouched

`app/admin/cleanup/page.tsx`, all retention code, `vercel.json`, `0055`, and
every file belonging to PRs #42, #45, #66, #107 (banner components
`promo-banner.tsx` / `promo-carousel.tsx`, `lib/retailer/home-data.ts`,
`tests/retailer-home-ui.test.tsx`, `components/admin/product-form.tsx`,
`lib/retention/*`, invoice/notification files, and #107's `0059`).

---

## 7. Tests — exact commands, counts, simulated vs live

All run in this workspace on this branch.

| # | Command | Type | Result |
| --- | --- | --- | --- |
| 1 | `corepack pnpm install --frozen-lockfile` | setup | ok (`@supabase/supabase-js` 2.110.7 per lockfile) |
| 2 | `corepack pnpm run typecheck` (`tsc --noEmit`) | real | **pass**, exit 0 |
| 3 | `corepack pnpm run lint` (`next lint`) | real | **pass** — "No ESLint warnings or errors" |
| 4 | `corepack pnpm run test` (`vitest run`) | real | **pass — 153 files / 2 674 tests** (baseline at start of mission: 144 / 2 572; +102 across the audit and the two review rounds) |
| 5 | `corepack pnpm exec vitest run tests/privilege-hardening-db.test.ts tests/admin-layout-guard.test.ts` | real | **pass — 18/18** |
| 5a | `corepack pnpm exec vitest run tests/api-privilege-hardening.test.ts` | real, executed SQL | **pass — 24/24**; the same file run against the 0078-only database fails **20/24**, which is the proof the migration is what closes those holes |
| 5b | `corepack pnpm exec vitest run tests/migration-catalog-invariants.test.ts` | real, executed SQL | **pass — 13/13** (95 tables, 444 public + 32 storage policies, 106 definer fns, 10 buckets, 1 041 `.from()` + 61 `.rpc()` references) |
| 5c | `corepack pnpm exec vitest run tests/detail-pages-read-failure.test.ts` | real (static over 151 pages) | **pass — 4/4**: 31 `notFound()` pages scanned; every one is error-aware or in the documented allow-list (2 by design + 3 `PENDING HANDOFF` to PRs #107/#42) |
| 5d | `corepack pnpm exec vitest run tests/release-stock-authorization.test.ts` | real, executed SQL | **pass — 20/20**; against a pre-0079 database **7 fail** (the denial cases), proving the check does the work |
| 5e | `corepack pnpm exec vitest run tests/api-execute-revocation-flows.test.ts` | real, executed SQL | **pass — 11/11** (GRN confirm/cancel, transfer execute/cancel, batch loss, stock adjustment as staff/admin; anon denied) |
| 6 | `corepack pnpm exec vitest run tests/admin-page-error-states.test.tsx tests/page-permission-guards.test.ts` | real | **pass — 12/12** |
| 7 | `NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… corepack pnpm run build` | real | **pass** — 151 pages + 69 handlers compiled |
| 8 | Migration replay, all 76 files in order (PGlite/PostgreSQL 16) | **simulated platform**, real SQL engine | **76/76 applied, 0 failures**; `0078` and `0079` re-apply cleanly (idempotent) |
| 9 | Second application of the whole set | simulated | 16 files fail on re-entry (all historical + `0073`); `0078` and `0079` re-apply cleanly |
| 10 | Catalog audit (RLS, policies, definer fns, grants, buckets, indexes) | simulated | 95 tables/views all RLS-on; 444 public + 32 storage policies; 106 definer fns, 0 without `search_path`; 0 duplicate indexes; 0 unvalidated FKs; 10 buckets with the expected visibility |
| 10a | `supabase/audits/migration_and_security_verification_readonly.sql` executed against that replay | **simulated platform**, real SQL | **11/11 blocks execute, 0 failures**, no DML/DDL token outside comments (so the file really is read-only). Blocks 3/9/10 contain several statements and are run as a *script* by the SQL Editor — a single-statement runner rejects them. Block 11 returns the 15 reviewed anon-callable functions and **0** `NO CALLER CHECK — REVIEW` rows |
| 10b | RPC argument-name check (61 call sites vs `proargnames`) | static + catalog | 0 mismatches |
| 11 | RPC/table cross-check vs catalog | static + simulated | 0 missing |
| 12 | Internal link check | static | 0 broken / 243 literals |
| 13 | RLS & Storage against a real non-production Supabase project | **live** | **NOT RUN — no credentials** |
| 14 | SQL lint / static formatting | **real** | **NOT RUN — no tool installed** |
| 15 | Android/Gradle build & device tests | **real** | **NOT RUN — out of scope** |

**Honest separation:** rows 1–7 are real executions in this sandbox. Rows 8–12
execute the real SQL on a *simulated* Supabase platform (stubbed `auth`/
`storage`, single connection — no PostgREST, no GoTrue, no concurrency).
Nothing was verified against production, and no test claims to prove live RLS
behaviour.

**Existing failures introduced:** none. The one pre-existing test updated is
`tests/dashboard-upgrade.test.ts` — it asserted the dashboard page contains
`requirePermission('dashboard.view')`; the page now uses
`requirePagePermission('dashboard.view')` (same permission, redirecting
variant), and the assertion was updated plus an extra assertion that the
throwing form is not used at page-body level. No assertion was weakened; the
intent (page authorized by `dashboard.view`, cookie-bound client only) is
unchanged.

---

## 8. Owner runbook — applying approved changes safely

> Run in this order. Each step states its approval gate and its rollback.
> Never rerun all migrations; apply only versions missing from
> `supabase_migrations.schema_migrations`.

**Step 0 — freeze the deletion job (P0, approval: owner).**
Pause the Vercel cron (and/or unset `CRON_SECRET`) per §3.3-A; optionally flip
`business_120` rules to `enabled = false` (§3.3-B). Rollback: re-enable.
Record `cleanup_runs` history first so the accountant knows what may already
have been deleted.

**Step 1 — produce evidence (read-only, no approval needed beyond DB access).**
Run `supabase/audits/migration_and_security_verification_readonly.sql` in the
SQL editor of `fhrmsrumsraprvutrpeo`. Attach queries 1–10. Confirm:
* query 1 lists the versions actually applied;
* query 2 shows `0074`/`0077`/`0078` as `NOT APPLIED` (expected);
* query 3 shows banner columns per 0074 or not at all (drift check);
* query 8 returns **0 rows**;
* query 10 shows whether `business_120` rules are enabled;
* query 11 lists only the reviewed anon-callable functions (no
  `NO CALLER CHECK — REVIEW` row).

**Step 2 — bind the target.** Confirm Vercel `NEXT_PUBLIC_SUPABASE_URL` is
`https://fhrmsrumsraprvutrpeo.supabase.co` and that Preview ≠ Production. If
Preview and Production share the ref, run **no** write test against Preview.

**Step 3 — backup.** Verified restorable backup (PITR or a restore rehearsal on
a scratch project) plus `copy (select * from public.banners) to stdout with
(format csv, header true);` for the banner table and a `pg_policies` snapshot.

**Step 4 — staging rehearsal (never straight to production).**
Apply `0074` → verify: `anon` cannot read a draft; staff cannot write a banner;
admin can create/publish/unpublish; `/retailer/home` and
`/api/mobile/v1/home` show the same published set → run
`supabase/rollbacks/0074_banner_lifecycle_and_variants.sql` → confirm no draft
was left `is_active` (otherwise drafts become public) → re-apply.

**Step 5 — apply `0074` to production (approval: owner).**
Order matters: 0074 is **required by code already on `main`**, so it must be
applied before/with the next deployment. Post-checks: queries 3 and 4 of the
audit script.

**Step 6 — apply `0078` to production (approval: owner).**
Independent of 0074. Pre-check on staging; post-check §“Verification” footer of
the file (grants all false for API roles; storage policies mention
`is_admin_or_above`). Rollback exists and is documented as a downgrade.

**Step 6b — apply `0079` to production (approval: owner).**
Independent of 0074/0077/0078. It touches privileges and one function body, no
data. Pre-check on staging (a) retailer B cannot release retailer A's order,
(b) `anon` cannot execute `ensure_fefo_coverage` or any of the 14 RPCs,
(c) the admin cancel button still releases stock, (d) the seller sub-order
cancel test still passes, (e) `tests/release-stock-authorization.test.ts` and
`tests/api-execute-revocation-flows.test.ts` pass **on staging** (they are the
salesman-cancel regression guard and the inventory-flow guard). Post-check the two verification snippets at the
bottom of the file. Rollback exists and re-opens the two exposures — labelled
as such.

**Step 7 — keep on hold.**
`0077` (unapproved; nothing consumes it) and `0055`/`0075` (retention window
pending legal + accountant review). No banner objects are moved or deleted; no
draft artwork is auto-deleted.

**Step 8 — regenerate types.**
After 0074 + 0078, regenerate `types/database.types.ts` from the project and
drop the `as never` casts around `status`, `image_url_mobile`, and the revoked
RPCs.

**Step 9 — deploy the app.**
`pnpm typecheck && pnpm lint && pnpm test && pnpm build`, then deploy. Verify
the four error-state pages behave (blank/functional queries show empty states;
a deliberately broken query shows the notice).

**Rollback drills (staging):** 0078 → rollback → re-apply; 0079 → rollback →
re-apply; 0074 → rollback → re-apply. Record outcomes. Production rollback of 0074 drops two columns
(**data loss**) — the rollback file says so; pause drafts first.

---

## 9. Remaining blockers

1. **Vercel-side facts unknown** (cron enabled? `CRON_SECRET` set?) ⇒ the
   deletion job's running state is unverified. Pause plan ready; owner action.
2. **Production schema unknown** ⇒ every migration is `Unverified` until the
   read-only script is run.
3. **`0074` unapplied while `main` depends on it** ⇒ banner reads/writes fail on
   a 0073 database.
4. **`0078` + `0079` need approval** to close the SECURITY DEFINER RPC exposures
   (`fefo_plan_for_product`, `current_offer_floor_paise`, `ensure_fefo_coverage`,
   `release_order_stock`, 14 anon-executable helpers) and the
   staff-writes-banner-artwork gap.
5. **Auth "Confirm email"** must be confirmed ON (staff-role-at-signup risk).
6. **`0059` collision** with PR #107 must be resolved by that PR's owner
   (renumber to **0080+**, since 0079 is now taken); no #107 file was touched here.
7. **Open PRs #42/#45/#66** still conflict among themselves; nothing was merged,
   rebased or overwritten. Three files owned by #107/#42 were **reverted** out of
   this branch this round, so the read-failure fix for those routes is pending
   their owners (`docs/HANDOFF_TO_PR_OWNERS.md`).
8. **No live Supabase/Storage verification** was possible ⇒ no production
   performance, RLS-under-load or signed-URL behaviour is claimed.

---

---

## 10. Security review round — release gate (2026-10-24, second pass)

An independent statement-by-statement review of `0078`/`0079` against a full
migration replay **found one real regression and two robustness gaps** in this
branch's own work. All three are fixed here; nothing was applied to production.

### 10.1 Found and fixed

| # | Finding (in our own migrations) | How it was found | Fix |
| --- | --- | --- | --- |
| R1 | **0079 broke salesman-initiated cancellation.** `orders_salesman_update` (0009) lets a salesman set `orders.status` for their assigned retailers; the cancel trigger then called `release_order_stock`, which 0079 refused with `42501`, so the whole UPDATE failed. Executed: `SALESMAN CANCEL RESULT: You are not permitted to release stock for this order.` | authorization matrix on a disposable DB | The allowed set now **mirrors the 0009 RLS predicate** (`current_user_role() = 'salesman'` AND (`collected_by = auth.uid()` OR retailer assigned)). It grants no capability the salesman did not already have through RLS. Pinned by `tests/release-stock-authorization.test.ts` |
| R2 | **0078 aborted on a database without 0002/0003** (`function is_admin_or_above() does not exist`), after H1–H3 had already applied — leaving a half-applied migration. | ran both files against an empty schema | H4 wrapped in a `do $h4$` block guarded on `to_regprocedure('public.is_admin_or_above()')` + `to_regclass('storage.objects')` |
| R3 | **0079 aborted on a database without 0017/0064** (`relation "orders" does not exist`). | same probe | H6 wrapped in a `do $h6$` block guarded on the four relations it references, with a NOTICE that names the consequence (the unguarded body survives, H7's anon revocation still applies) |
| R4 | The **0078 rollback** had the same unguarded-policy abort path. | rollback review | Same guard added to the rollback |
| R5 | This branch had edited **three files owned by open PRs #107 and #42**. | cross-checked every changed path against the file lists of PRs 7/21/31/42/45/66/107 | Reverted those three files to the branch base (verified byte-identical) and moved the fixes to `docs/HANDOFF_TO_PR_OWNERS.md`. Note: PR #107's own version of the invoice page **already** throws on `orderError`, so that one closes on merge |

### 10.2 What the review proved (executed, disposable PostgreSQL 16)

| Claim | How it was proven | Result |
| --- | --- | --- |
| Function ownership | catalog query after the replay | all five hardened functions are owned by `postgres` (so definer bodies inside them keep working after the revokes) |
| 0079 is idempotent | applied twice on the full schema | clean both times; `anon=false`, `authenticated=true`, caller check present |
| 0078/0079 are safe without prerequisites | applied to an empty schema, and to a 0063-level schema | both **apply cleanly** (no-op / NOTICE) |
| The anon revocations break nothing anonymous | exhaustive differential: every one of the **95** tables read as `anon` before vs after 0079 | **0 differences**; 22 tables were already unreadable to `anon` before and after |
| Public flows still work | executed as `anon` | `is_phone_registered`, `submit_supplier_application` (returns an application id), banner/brand/category/area reads, product id reads: all OK |
| Cost columns stay closed | executed as `anon` | `select cost_price from products` → `permission denied for table products` (pre-existing column grants: 20/21 columns) |
| The two exposures are really closed | executed as `anon` | `release_order_stock` and `ensure_fefo_coverage` → `permission denied for function` |
| The revocations do not break authorized inventory work | GRN confirm/cancel, transfer execute/cancel, batch loss, stock adjustment as staff/admin | all succeed (`tests/api-execute-revocation-flows.test.ts`, 11/11) |
| The release check is what closes the hole | same test file run against a pre-0079 database | **7 cases fail** (the denials), i.e. the guards are doing the work |
| Rollbacks are honest downgrades | applied both rollbacks, then re-applied 0079 | rollback re-opens `anon=true` and removes the caller check; re-applying 0079 restores it |
| The audit script is read-only | 19 statements, all `SELECT`/`WITH`; executed whole-file with a **schema + data fingerprint** before/after | 0 non-select statements, 0 DML/DDL keywords, **fingerprints identical** |

### 10.3 Reviewed and accepted as-is

* `0078` H1–H3: revokes only, guarded on `to_regprocedure`, no data or policy change beyond the two banner storage policies.
* `0079` H5: `ensure_fefo_coverage` has no legitimate API caller — its only call sites are 0017 definer bodies.
* `0079` H7: the 14 `anon` revocations keep every `authenticated` grant; the RLS predicates that `public` policies evaluate for anonymous readers (`current_user_role`, `is_admin_or_above`, `is_staff_or_above`, `is_*_assigned_to_current_*`, `is_member_of_seller`, `can_current_*`) are **deliberately kept**.
* Neither migration touches `banners` columns, `banner-drafts` policies (0077's), the retention registry, `vercel.json`, or any data row.

### 10.4 Still unverified (cannot be proven from this repository)

* Whether `0074`/`0077`/`0078`/`0079` are applied in `fhrmsrumsraprvutrpeo` — needs E1.
* Whether the retention cron runs — needs E3/E4 (see `docs/OWNER_SECURITY_EVIDENCE_PACK.md`).
* Live RLS/Storage/PostgREST behaviour and the multi-connection concurrency guarantees — PGlite is single-connection.
* Whether PR #107's renumbering (to 0080+) has happened.

## 11. Failed reads rendered as facts (third pass, 2026-10-24)

### 11.1 The defect, stated precisely

PostgREST returns `{ data: null, error }` on failure. A page written as
`const { data } = await supabase.from('x')…` drops the error, and the empty
branch then makes a **factual claim about the operator's or customer's data**
that was never actually read:

| Read fails because… | page told the user |
| --- | --- |
| `42703` (schema drift after an unapplied migration) | "No return requests yet" |
| RLS denial / expired session | "No commission records yet" |
| statement timeout / network | "Nothing to dispatch" |
| any of the above on a detail page | "404 — this no longer exists" |

Two consequences, both real: the operator concludes there is no work (a
dispatch queue or moderation queue that looks empty) or that data was deleted;
and the underlying fault is invisible, because a tidy empty state is
indistinguishable from a working system.

This is **not** the same class as §6's detail-page/404 defect (already fixed and
pinned by `tests/detail-pages-read-failure.test.ts`), but it has the same root
cause: `{ data }` instead of `{ data, error }`.

### 11.2 How the population was measured

Static classifier over every `page.tsx` under `app/{admin,retailer,staff,salesman,seller}`
that calls `.from()`/`.rpc()`:

* **104** pages issue database reads.
* **39** already mention an error (`error`, `failed`, `failureMessage`,
  `throwIfReadFailed`, `errors.*`) — either directly or through a shared loader.
* **65** did not. Of those 65, a manual read-by-read review (the classifier
  over-reports: several are write-only forms or use loaders that already handle
  errors) identified the genuine list/queue/detail reads.

Script: `scripts/patch_read_failure.py` exists so each file is patched
independently — an earlier batch script asserted its import anchor *after*
substituting, so one file without that import silently dropped its own edit and
aborted the remaining files. That failure mode is why the fixes below were
applied in four small batches, each followed by a typecheck.

### 11.3 Two remediations, chosen deliberately

1. **Render a notice** — pages that must stay usable (they show other,
   successfully-read content, or the operator needs the form) use
   `components/ui/read-failure-notice.tsx`: `role="alert"`, rose-50 card,
   "this is a read failure, not an empty list — nothing has been deleted",
   and the PostgREST message in small mono for diagnosis. Used where an
   operator would otherwise be misled **and** still needs the page.
2. **Throw** — work queues and money-evidence lists (`staff/orders`,
   `staff/inventory`, `salesman/collections`, `admin/delivered`,
   `admin/inventory/products`, `retailer/coupons`, `retailer/support`) throw
   `… could not be loaded [<code>]: <message>`, which lands in the existing
   `app/error.tsx` / `app/retailer/error.tsx` boundary with a retry. This is
   the pattern `lib/delivery/queries.ts#fetchDeliveryDetail` already used.

Neither remediation invents data, changes a query, weakens RLS, or alters the
visual design; both only replace a false statement with a true one.

### 11.4 Fixed in this branch (files)

| File | Was | Now |
| --- | --- | --- |
| `components/ui/read-failure-notice.tsx` | (new) | shared notice component |
| `lib/admin/sellers-query.ts#listOffers` | `if (error) return { offers: [], total: 0 }` | returns `failed` / `failureMessage` (same contract as `listSellers`) |
| `lib/delivery/queries.ts#listOpenDeliveriesForUser` | dropped `error` | throws with code |
| `lib/delivery/queries.ts#listRecentDeliveriesForUser` | dropped `error` | throws with code |
| `app/admin/coupons/page.tsx` | "No coupons yet" on failure | notice |
| `app/admin/returns/page.tsx` | "No return requests yet" | notice |
| `app/admin/offers/page.tsx` | "No offers to review" | notice (moderation queue) |
| `app/admin/wallets/page.tsx` | silent empty credit table | notice + "balances are NOT authoritative" |
| `app/admin/targets/page.tsx` | "No team members yet" / "No targets set yet" | notice |
| `app/admin/commissions/page.tsx` | "No team members yet" / "No commission records yet" | notice |
| `app/admin/pricing/page.tsx` | "No active products yet" / "No prices set yet" | notice |
| `app/admin/pricing/schemes/page.tsx` | "No schemes yet" | notice |
| `app/admin/delivered/page.tsx` | "No completed deliveries yet" | throws |
| `app/admin/inventory/products/page.tsx` | "No matching products" | throws |
| `app/retailer/coupons/page.tsx` | "No coupons right now" | throws |
| `app/retailer/support/page.tsx` | "No support tickets yet" | throws |
| `app/salesman/targets/page.tsx` | "No active targets" | notice |
| `app/salesman/collections/page.tsx` | "No collections recorded yet" | throws |
| `app/staff/orders/page.tsx` | "Nothing to dispatch" | throws |
| `app/staff/inventory/page.tsx` | "No inventory recorded yet" | throws |

Regression tests: `tests/list-pages-read-failure.test.tsx` (12 cases) and
`tests/queue-loaders-read-failure.test.tsx` (4 cases). Every case asserts both
directions — the failure is surfaced **and** a successful empty read still shows
the true empty state — because a one-sided test would also pass a regression
that always shows an error.

### 11.5 Deliberately NOT changed (with the reason)

| Files | Why left alone |
| --- | --- |
| `app/retailer/orders/[id]/page.tsx`, `…/[id]/invoice/page.tsx`, `app/retailer/catalog/[id]/page.tsx` | Owned by open PR #107 / #42. Hunk-level handoff in `docs/HANDOFF_TO_PR_OWNERS.md`; #107's invoice page already carries the fix. |
| `app/retailer/orders/page.tsx`, `app/retailer/notifications/page.tsx`, `app/retailer/schemes/page.tsx` | **Reverted** from this branch: all three are rebuilt by open PR #42 (`orders` also in #107), so a patch written against `main` would conflict on the exact lines. Verified byte-identical to `origin/main`; exact patch for their owner in `docs/HANDOFF_TO_PR_OWNERS.md` §"PR #42 — three more retailer pages". |
| `app/admin/inventory/page.tsx` (6 reads), `…/inventory/reports/page.tsx` (8), `…/reports/page.tsx` (6), `app/admin/command-center/page.tsx` (5), `app/retailer/catalog/page.tsx` (6), `app/admin/pricing/page.tsx` secondary option lists | Multi-read dashboards. Each read needs an individual decision about whether the page stays usable when that one read fails (e.g. a failed *area* list must not hide a successful *product* list). Blanket-editing them would trade a false empty state for a needlessly dead page. Listed as follow-up work, not silently skipped. |
| `app/admin/attendance`, `audit-logs`, `follow-ups`, `routes`, `support`, `team`, `visits`, `warehouses`, `inventory/*` (batches, grn, low-stock, movements, transfers), `retailer/{account,cart,categories,favorites,quick-order}`, `salesman/{attendance,commissions,dcr,follow-ups,orders,profile,retailers,routes,visits}`, `staff/deliveries` (loader throws) | Remaining population from §11.2. Same defect, lower consequence per page (read-mostly reports and self-service forms). Fixing them is mechanical but each needs the render-vs-throw decision above; doing it blind across 35 files in one commit is exactly the kind of change this audit exists to prevent. |

`app/staff/deliveries` and `app/salesman/deliveries` are **already covered**:
their shared loader now throws (see §11.4).

## Appendix A — reproduction

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm run typecheck
corepack pnpm run lint
corepack pnpm exec vitest run               # 155 files / 2693 tests (third pass)
NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co \
NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder \
NEXT_PUBLIC_SITE_URL=https://placeholder.example \
SUPABASE_SERVICE_ROLE_KEY=placeholder corepack pnpm run build
```
Third-pass gate (executed 2026-10-24, after the §11 fixes): typecheck 0 errors,
lint clean, **155 files / 2693 tests passed**, production build compiled.
CI remains BLOCKED (GitHub billing — see §0), so these local runs are the only
executable evidence.

Migration replay and catalog queries: `tests/helpers/pg-harness.ts` boots
PGlite (PostgreSQL 16) and applies every migration in `supabase/migrations`;
`tests/privilege-hardening-db.test.ts` asserts the 0078 privilege posture by
executing SQL, not by reading text.
