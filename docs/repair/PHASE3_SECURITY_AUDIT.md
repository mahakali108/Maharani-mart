# Phase 3 — Security Audit Report

**Scope:** Maharani Traders Phase 3 — Super Admin Business Control, Seller Governance, Wholesale Pricing, Retailer Memberships, Banner & Paid Seller Ad Campaigns, and Audit Integrity  
**Migration Reviewed:** `supabase/migrations/0109_phase3_business_control.sql` + `supabase/rollbacks/0109_phase3_business_control.down.sql`  
**Date:** 2026-11-16  
**Verification Method:** Static code review + Automated Page/Server-Action contract tests + Real PostgreSQL 16 (PGlite) RLS, privilege, trigger, and rollback execution.

---

## 1. Role Model & Access Boundary Matrix

All existing roles (`super_admin`, `admin`, `staff`, `salesman`, `retailer`, `seller`, plus `anon`) are preserved without widening privileges.

| Resource / Action | `anon` | `retailer` | `seller` | `admin` | `super_admin` | Enforced At |
|---|---|---|---|---|---|---|
| Seller approve / reject / suspend / reinstate | Deny | Deny | Deny (no self-approve) | Deny (`0072` RLS) | Allow (audited) | Server Action + `0072` RLS + `0062`/`0086` triggers |
| Remove prohibited seller offer | Deny | Deny | Deny | Deny | Allow (mandatory reason >= 8 chars) | `requireSuperAdmin()` + RLS + `0109` moderation trigger |
| `products.description` SELECT | Column SELECT (RLS-bound) | Allow (published) | Allow (published) | Allow | Allow | `0109` column-level GRANT |
| `products.cost_price` SELECT | **DENY** | **DENY** | **DENY** | Via `SECURITY DEFINER` only | Via `SECURITY DEFINER` only | `0107` column lockdown (preserved & re-tested) |
| `product_moderation_history` | **DENY** (revoked) | Deny (RLS) | Read own seller only; no write | Read / Insert (actor-pinned) | Read / Insert (actor-pinned); **no UPDATE/DELETE** | `0109` RLS + append-only trigger |
| `wholesale_pricing_rules` / `seller_pricing_permissions` / `product_wholesale_limits` | **DENY** (revoked) | Deny | Read own permission only | Read only | Full CRUD (audited) | `requireSuperAdmin()` + `0109` RLS + trigger |
| Seller offer / slab discount & MOQ enforcement | N/A | N/A | Bounded by Super Admin caps | Bounded by Super Admin caps | Configures limits | `0109` `AFTER INSERT OR UPDATE` DB triggers |
| `membership_plans` write & `membership_program_settings` write | **DENY** | Deny | Deny | **Tightened to Deny** | Allow (cannot activate while `program_enabled = false`; live payment CHECK `= false`) | `requireSuperAdmin()` + `0109` RLS + trigger + CHECK |
| `get_retailer_membership_overview(uuid)` | **DENY** (revoked) | Own ID only (cross-tenant denied) | Own ID only | Any retailer | Any retailer | `SECURITY DEFINER` + `auth.uid()` check |
| `super_admin_assign_membership(...)` | **DENY** | **DENY** | **DENY** | **DENY** | Blocked while `program_enabled = false` | `SECURITY DEFINER` + `current_user_role() = 'super_admin'` |
| Legacy `admin_set_retailer_membership` | **REVOKED** | **REVOKED** | **REVOKED** | **REVOKED** | **REVOKED** | `0083` preserved |
| `seller_ad_campaigns` | **DENY** (revoked) | Approved+active+enabled only | Submit draft/pending + pause own only (no self-approve, no payment edit) | Read only | Moderate & offline payment track (approval blocked while `seller_ads_enabled = false`) | `requireSuperAdmin()` / `requireActiveSeller()` + `0109` RLS + trigger |
| `seller_ad_campaign_audit` | **DENY** (revoked) | Deny | Read own seller only | Deny | Read only; **append-only (no UPDATE/DELETE)** | `0109` RLS + trigger |
| `super_admin_audit_logs` | **REVOKED** (hardened in `0109`) | Deny | Deny | Deny | Read + Insert (`actor_id = auth.uid()` pinned); **append-only (no UPDATE/DELETE)** | `0020` RLS + `0109` REVOKE & triggers |

---

## 2. Security Defects Discovered & Fixed During Phase 3 Testing & Independent Review

Writing real PostgreSQL 16 (PGlite) adversarial tests plus the independent PR #137 rollback review caught **six genuine defects** before merge; all six were fixed and verified with regression tests:

1. **`SECURITY DEFINER` `current_user` bypass in `enforce_seller_ad_campaign_rules()` (HIGH — Caught & Fixed):**
   - Initially checked `current_user in ('authenticated', 'anon')` inside a `SECURITY DEFINER` trigger. Because PostgreSQL sets `current_user` to the function owner (`postgres`) inside `SECURITY DEFINER`, an authenticated seller could fall into the Super Admin branch (still blocked by `SELLER_ADS_DISABLED`, but would have bypassed anti-self-approval if ads were later enabled).
   - **Fix:** Switched the check to `(current_setting('role', true) in ('authenticated', 'anon') or auth.uid() is not null) and not v_is_super`. Verified in PostgreSQL 16 that sellers are explicitly rejected with `Sellers can only submit unapproved draft/pending campaigns` and `Sellers cannot activate / self-approve`.
2. **Incomplete Rollback Data-Loss Preflight & Non-Atomic Retry in `0109_phase3_business_control.down.sql` (CRITICAL — Caught in Independent PR #137 Review & Fixed):**
   - The initial rollback only guarded `product_moderation_history`, `seller_ad_campaigns`, `seller_ad_campaign_audit`, and `membership_upgrade_requests`, leaving `products.description`, `wholesale_pricing_rules`, `seller_pricing_permissions`, `product_wholesale_limits`, `membership_program_settings`, `ad_program_settings`, and the 8 added `membership_plans` configuration columns unprotected from silent deletion. It also executed DDL statements outside a single atomic block and called `DROP TRIGGER` on tables that might already be absent on retry.
   - **Fix:** Rewrote `supabase/rollbacks/0109_phase3_business_control.down.sql` as a single atomic `DO $rollback_0109$` block with zero `CASCADE` drops:
     - Guards all **11** Phase 3 data surfaces (`products.description`, `product_moderation_history`, `wholesale_pricing_rules` non-default/edited rows, `seller_pricing_permissions`, `product_wholesale_limits`, all 8 added `membership_plans` Phase 3 configuration columns checked dynamically via `information_schema.columns`, `membership_program_settings` non-default/edited rows, `membership_upgrade_requests`, `ad_program_settings` non-default/edited rows, `seller_ad_campaigns`, and `seller_ad_campaign_audit`).
     - Refuses (`SQLSTATE 23514`) with an itemized count of every affected source unless explicitly overridden inside a transaction via `BEGIN; SET LOCAL maharani.allow_data_loss = 'true'; ... COMMIT;`.
     - On authorized override, emits an itemized `RAISE WARNING` listing every record count that will be permanently deleted, executes all teardowns cleanly without `CASCADE` (preserving all pre-existing data, `0083` membership retirement, `0107` `cost_price` lockdown, and `super_admin_audit_logs` rows + `anon`/`UPDATE`/`DELETE` revocations), and immediately disarms the flag via `RESET maharani.allow_data_loss;`.
     - Guards every table- and column-scoped check/drop for safe idempotent retry and zero partial rollback on failure (verified in `tests/phase3-rollback-protection-db.test.ts`).
3. **Legacy `anon` grant on `super_admin_audit_logs` from Migration `0020` (MEDIUM — Caught & Fixed):**
   - `0020_super_admin_control_center.sql` enabled RLS on `super_admin_audit_logs` but did not revoke table grants from `public`/`anon`, and did not prevent `UPDATE`/`DELETE` or `actor_id` spoofing.
   - **Fix:** `0109` revokes all privileges from `public, anon`, revokes `UPDATE, DELETE` from `authenticated`, adds `trg_guard_super_admin_audit_insert` (non-`SECURITY DEFINER`, pins `actor_id = auth.uid()`), and adds `trg_prevent_sa_audit_mutation` (`42501` append-only).
4. **`BEFORE INSERT` Trigger Ordering vs RLS Error Disclosure (MEDIUM — Caught & Fixed):**
   - `BEFORE INSERT` wholesale limit triggers ran before RLS `WITH CHECK`, returning a discount-limit message to unauthorized `staff` callers instead of a clean RLS rejection.
   - **Fix:** Moved `trg_enforce_seller_offer_wholesale_limits`, `trg_enforce_seller_tier_wholesale_limits`, `trg_enforce_product_tier_wholesale_limits`, and `trg_guard_membership_plan_changes` to `AFTER INSERT OR UPDATE`. Unauthorized callers fail RLS first; authorized writes are validated atomically and rolled back on limit violation.
5. **Missing Page-Level Permission Guards on `/admin/pricing` and `/admin/banners` (MEDIUM — Caught & Fixed):**
   - Both pages previously relied on `/admin` middleware without explicit `requirePagePermission(...)` checks (unlike `/admin/banners/[id]` and `/admin/pricing/tiers`).
   - **Fix:** Added `requirePagePermission('pricing.manage')` to `app/admin/pricing/page.tsx` and `requirePagePermission('banners.manage')` to `app/admin/banners/page.tsx`, and guarded all 3 new Super Admin routes (`/admin/pricing/wholesale`, `/admin/memberships`, `/admin/banners/campaigns`) with `requireSuperAdminPage()`.
6. **Cross-Migration Rollback Coupling (`0109` -> `0104` `is_super_admin()`) (LOW/OPERATIONAL — Caught & Fixed):**
   - Referencing `0104`'s `is_super_admin()` inside `0109` RLS policies prevented `0104.down.sql` from rolling back cleanly in isolation.
   - **Fix:** Standardized `0109` to use `public.current_user_role() = 'super_admin'` (defined in `0001_init.sql`, matching `0020`, `0072`, `0086`, and `0098`). Verified `site-content-db.test.ts` and `site-content-release.test.ts` pass 100%.
7. **Unchecked Caller Role in `public.can_current_staff_read_profile(uuid)` (HIGH — Caught in Final Audit & Fixed in `0109`):**
   - Pre-existing `0037` helper was `SECURITY DEFINER` with `PUBLIC`/`anon`/`authenticated` `EXECUTE` (required for `profiles_self_select` policy evaluation) but lacked a caller-role guard, allowing any `anon`, `retailer`, `seller`, or `salesman` caller to probe whether an arbitrary UUID belonged to `super_admin`/`admin`/`staff`/`salesman` via direct PostgREST RPC.
   - **Fix:** Added `and public.is_staff_or_above()` + `set search_path = pg_catalog, public, pg_temp` inside `0109` Section 6.2 (restored cleanly in `0109.down.sql`). Verified in PostgreSQL 16 that `anon`, `retailer`, and `seller` always receive `false` for staff/admin/super_admin UUIDs while `staff` retains assigned-scope access.
8. **Direct-PostgREST Rate-Limit Bypass on `public.submit_supplier_application(...)` (HIGH — Caught in Final Audit & Fixed in `0109`):**
   - `0060` enforced rate limiting only in the Next.js server action via `service_role`, leaving direct `anon` PostgREST RPC calls to `submit_supplier_application` unthrottled.
   - **Fix:** Added durable DB-level anti-abuse rate limiting inside `submit_supplier_application(...)` (`0109` Section 6.3) using `0060`'s `consume_supplier_application_rate_limit` with SHA-256 hashes (5/10min per phone hash in `supplier-rpc-phone` + 30/10min global API burst ceiling in `supplier-rpc-burst`; zero raw phone numbers stored; exact 11-arg signature & `search_path = public, pg_temp` preserved; restored cleanly in `0109.down.sql`).
9. **Unrevoked `EXECUTE` on 13 Internal `0109` Trigger Functions (MEDIUM — Caught in Final Audit & Fixed in `0109`):**
   - PostgreSQL/Supabase default privileges granted `EXECUTE` to `public`/`anon`/`authenticated` on new trigger handlers.
   - **Fix:** Explicitly revoked `ALL ON FUNCTION ... FROM public, anon, authenticated` on all 13 `0109` trigger functions (`0109` Section 6.1) and asserted zero API privileges in `tests/phase3-business-control-db.test.ts`.
10. **Wholesale Pricing Compounded-Discount & Rounding Boundary Bypass (HIGH — Caught in Final Audit & Fixed in `0109` & `lib/admin/wholesale-pricing-rules.ts`):**
    - `enforce_seller_tier_wholesale_limits()` previously validated slab discounts only against `seller_offers.unit_price_paise` (allowing stacked offer + slab discounts to exceed Super Admin's cap relative to `product_packs.base_price`), and 2-decimal rounding allowed sub-basis-point overages (e.g., `10.0033%` rounding to `10.00%`).
    - **Fix:** Enforced exact rational inequalities across all 3 pricing triggers and `exceedsDiscountCap(...)`, plus combined slab-vs-pack-base validation in `enforce_seller_tier_wholesale_limits()` and `validateSellerSlabAgainstLimits(...)`.
11. **Unauthorized External Phishing Links, Protocol-Relative URLs (`//`), & HTML Copy in `seller_ad_campaigns` (HIGH — Caught in Final Audit & Fixed in `0109` & `lib/admin/ad-campaign-rules.ts`):**
    - `destination_url LIKE '/%'` previously permitted `//evil.com` and arbitrary external `https://` URLs.
    - **Fix:** Restricted `seller_ad_campaigns.destination_url` strictly to internal retailer routes (`^/retailer($|/|\?)`, rejecting external links, `//`, `..`, `\`, whitespace/control chars, `/admin`, `/api`), hardened `artwork_url`, and rejected `<`/`>` HTML markup in `title` and `headline` at both DB CHECK and TypeScript layers.
12. **Membership Overview Inactive-Program Discount Guard & Assignment Eligibility Enforcement (MEDIUM — Caught in Final Audit & Fixed in `0109`):**
    - `get_retailer_membership_overview(uuid)` now gates non-free benefits & effective discounts on BOTH `program_enabled = true` AND `mp.is_active = true` AND non-expired; `super_admin_assign_membership(...)` now verifies retailer existence, `requireApprovedRetailer`, and `allowedCategories` eligibility rules server-side.

---

## 3. Additional Security Controls Verified

- **No Browser-Trusted Roles / IDs:** Every Server Action calls `requireSuperAdmin()`, `requirePermission(...)`, or `requireActiveSeller()` and derives `actor.id` / `seller.id` strictly from the verified Supabase session + database lookup.
- **No Service-Role Bypass on Dashboards:** `app/admin/dashboard/page.tsx` and `lib/admin/dashboard/data.ts` strictly use the cookie-bound `createClient()` (never `createServiceRoleClient`).
- **XSS / Phishing / Unsafe URL Prevention on Campaigns:** `isSafeCampaignDestinationUrl` and SQL `CHECK` constraints restrict ad click targets strictly to internal `/retailer` paths and forbid `//`, `..`, external domains, HTML `<`/`>`, `javascript:`, `data:`, and `http://`.
- **No Payment Credentials or Live Collection:** Both `membership_program_settings.live_payment_collection_enabled` and `ad_program_settings.live_payment_collection_enabled` carry PostgreSQL `CHECK (live_payment_collection_enabled = false)` constraints. No third-party payment keys or checkout webhooks were added.
- **Zero Storage Bucket Drift:** Verified exact 11 buckets remain unchanged (`tests/migration-catalog-invariants.test.ts`).
- **Zero `SECURITY DEFINER` Unpinned `search_path`:** Every new `SECURITY DEFINER` function pins `set search_path = public, pg_temp` (or `pg_catalog, public, pg_temp`) and revokes `PUBLIC`/`anon` execute privileges where applicable (`tests/migration-catalog-invariants.test.ts` 14/14 PASS).

---

## 4. Function-by-Function Security Disposition (Externally Executable Functions)

| Function | Live `fhrmsrumsraprvutrpeo` State | Risk | Action in PR #137 |
|---|---|---|---|
| `can_current_staff_read_profile(uuid)` | `anon`/`auth`/`PUBLIC` `EXECUTE`, no caller role check | **HIGH** — anonymous/non-staff staff-UUID enumeration | **FIXED in `0109`** (`is_staff_or_above()` guard + `pg_catalog, public, pg_temp`; restored in `0109.down.sql`) |
| `submit_supplier_application(text x 11)` | `anon`/`auth` `EXECUTE` (no `PUBLIC`), app-only rate limit | **HIGH** — direct PostgREST spam bypass | **FIXED in `0109`** (durable DB-level SHA-256 rate limiter via `0060`; exact signature preserved; restored in `0109.down.sql`) |
| `current_user_role()` | `anon`/`auth`/`PUBLIC` `EXECUTE`, `auth.uid()`-bound, `search_path=public` | **LOW / SAFE** — required by `PUBLIC` RLS policies; returns `NULL` for `anon` | **RETAINED** (justified RLS dependency; no cross-user leakage) |
| `is_admin_or_above()` | `anon`/`auth`/`PUBLIC` `EXECUTE`, `auth.uid()`-bound, `search_path=public` | **LOW / SAFE** — required by `PUBLIC` RLS policies; returns `false` for `anon` | **RETAINED** (justified RLS dependency; no cross-user leakage) |
| `is_phone_registered(text)` | `anon`/`auth`/`PUBLIC` `EXECUTE`, `search_path=public`, queries `profiles.phone` | **MEDIUM–HIGH** — unauthenticated phone-number enumeration oracle | **DOCUMENTED FOR COORDINATED FOLLOW-UP** (called server-side only by `lib/auth/actions.ts`, `lib/admin/team-actions.ts`, and `/api/mobile/v1/retailers/register`; modifying PR #136's `lib/auth/actions.ts` and mobile route contracts requires a separate owner-approved PR — full privacy-preserving replacement design in `docs/repair/MIGRATION_AND_RELEASE_READINESS_AUDIT.md`) |
| 10 other `anon`-exec `SECURITY DEFINER` RLS predicates | `auth.uid()`-bound (`is_staff_or_above`, `is_area_assigned_to_current_staff`, etc.) | **LOW / SAFE** — required by `PUBLIC` RLS policies; return `false` for `anon` | **RETAINED** (audited individually; zero cross-tenant leakage) |
| 13 new `0109` trigger functions | N/A (new in `0109`) | **MEDIUM** if left with default grants | **REVOKED** from `public, anon, authenticated` in `0109` Section 6.1 |

---

## 5. Open Pre-Existing Items (Documented Honestly, Owner Action Required)

1. **`MIGRATIONS_FAILED` on `main` (`a99e8f6`):** Proven from GitHub check-run `#133450841369` (`Remote migration versions not found in local migrations directory.`): live `fhrmsrumsraprvutrpeo` recorded `0103_security_advisor_remediation` as version `20261115155706` instead of `0103`. Requires owner-coordinated migration history reconciliation before applying `0104`–`0109` (runbook in `docs/repair/MIGRATION_AND_RELEASE_READINESS_AUDIT.md`).
2. **Unapplied Production Migrations (`0104`–`0109`) & Live `products.cost_price` Exposure:** Live `fhrmsrumsraprvutrpeo` remains cleanly at `0103` (`products.cost_price` is selectable by `authenticated`, 0 live products/users). Applying `0104`–`0109` after owner approval closes `cost_price` (`0107`) and applies Phase 3 + Section 6 security hardening (`0109`).
3. **`pg_net` Extension in `public` Schema:** Live Supabase Security Advisor warning (`extension_in_public`). Non-relocatable extension; requires scheduled maintenance recreate into `extensions` schema if owner wishes to clear advisory.
4. **Live `data_retention_rules` 120-Day Deletion of Commercial Records (`business_120`):** Live production has 6 `business_120` rules enabled (`orders`, `payment_collections`, `retailer_wallet_ledger`, `return_requests`, `stock_movements`, `order_stock_allocations`). Under Indian CGST Act Section 36 (72-month retention), owner must disable or archive before live commercial GST invoicing.
5. **Vercel Connector Scope (`limited: true`):** Direct Vercel project API/env/plan reads were denied by token scope; preview deployment status was verified via GitHub Deployments/Commit Statuses API, and Vercel plan commercial-use compliance must be verified by the owner directly.
