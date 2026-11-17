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

---

## 3. Additional Security Controls Verified

- **No Browser-Trusted Roles / IDs:** Every Server Action calls `requireSuperAdmin()`, `requirePermission(...)`, or `requireActiveSeller()` and derives `actor.id` / `seller.id` strictly from the verified Supabase session + database lookup.
- **No Service-Role Bypass on Dashboards:** `app/admin/dashboard/page.tsx` and `lib/admin/dashboard/data.ts` strictly use the cookie-bound `createClient()` (never `createServiceRoleClient`).
- **XSS / Unsafe URL Prevention on Campaigns:** `isSafeCampaignUrl` and SQL `CHECK` constraints enforce `https://` or relative `/` paths only (`javascript:`, `data:`, `http://`, and protocol-relative `//` URLs are rejected).
- **No Payment Credentials or Live Collection:** Both `membership_program_settings.live_payment_collection_enabled` and `ad_program_settings.live_payment_collection_enabled` carry PostgreSQL `CHECK (live_payment_collection_enabled = false)` constraints. No third-party payment keys or checkout webhooks were added.
- **Zero Storage Bucket Drift:** Verified exact 11 buckets remain unchanged (`tests/migration-catalog-invariants.test.ts`).
- **Zero `SECURITY DEFINER` Unpinned `search_path`:** Every new `SECURITY DEFINER` function pins `set search_path = public, pg_temp` and revokes `PUBLIC`/`anon` execute privileges where applicable (`tests/migration-catalog-invariants.test.ts` 14/14 PASS).

---

## 4. Open Pre-Existing Items (Documented Honestly, Out of Phase 3 Scope)

1. **`Supabase Preview` CI Failure on `main` (`a99e8f6`):** Pre-existing migration `0103` timestamp mismatch between production Supabase history (`20261115155706`) and repository numbering. Requires owner-coordinated migration history reconciliation before production rollout.
2. **Unapplied Production Migrations (`0104`–`0108`, plus new `0109`):** Production database `fhrmsrumsraprvutrpeo` remains cleanly at `0103`; no production SQL was run.
3. **Vercel Connector Scope (`limited: true`):** Direct Vercel project API reads were denied by token scope; production web health was verified via GitHub checks and live health probe.
