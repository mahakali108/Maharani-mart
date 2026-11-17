# Phase 3 — Verification & Test Report

**Branch:** `arena/db779fee-maharani-mart`  
**Date:** 2026-11-16  
**Runtime:** Node `v22.22.3`, `pnpm@9.15.9` (via `corepack pnpm`), Next.js `16.4.5` (Turbopack), Vitest `2.1.9`, PostgreSQL 16 via `@electric-sql/pglite@0.2.17`.

---

## 1. Exact Gate Results

| Verification Command | Result | Exact Counts / Notes |
|---|---|---|
| `corepack pnpm run typecheck` (`tsc --noEmit`) | **PASS** | 0 TypeScript errors |
| `corepack pnpm run lint` (`eslint .`) | **PASS** | 0 errors, 0 warnings |
| `corepack pnpm run test` (`vitest run`) | **PASS** | **236 / 236 test files passed**, **3,620 / 3,620 tests passed** (0 failed, 0 skipped; +3 new files / +37 new tests over `main` baseline 233 / 3,583) |
| `NEXT_TELEMETRY_DISABLED=1 corepack pnpm run build` | **PASS** | Compiled in 22.8s, TypeScript verified in 37.8s, 114/114 routes generated cleanly |

---

## 2. New Phase 3 Test Suites Added

1. **`tests/phase3-business-rules.test.ts` (15 tests — PASS)**
   - Wholesale pricing effective-limit composition (global + seller + pack, tightest wins)
   - Seller discount-disabled override (`maxDiscountPercent = 0`)
   - Offer MOQ minimum & max discount cap rejection
   - Custom wholesale slab disabled & slab discount cap rejection
   - Global/seller/pack input bounds + DB error code mapping
   - Membership immediate expiry stop (at exact `expiresAt` timestamp AND past `expiresAt` -> `0%` discounts, `benefitsActive = false`, `remainingSeconds = 0`)
   - Active membership validity calculation + capped order-value discount + minimum order value check
   - Plan configuration validation (`free` price locked to ₹0, `expiry_behavior = 'immediate_stop'`, `grace_period_days = 0`)
   - Paid seller ad URL safety (`javascript:`, `data:`, `http://`, `//` rejected) & schedule window validation (`endsAt > startsAt`)
   - Server Action authorization boundaries (`removeProhibitedOfferAction`, `markPackOutOfStockAction`, `updateGlobalWholesaleRulesAction`, `upsertSellerPricingPermissionAction`, `updateMembershipPlanConfigAction`, `reviewMembershipUpgradeRequestAction`, `moderateSellerAdCampaignAction`, `submitSellerAdCampaignAction`)
   - Page guard & no-live-payment contract verification across all new and updated routes

2. **`tests/phase3-business-control-db.test.ts` (10 tests — Real PostgreSQL 16 via PGlite — PASS)**
   - **Seller approval, rejection, suspension, activation & unauthorized seller actions:** Seller cannot self-approve (`UPDATE sellers SET status = 'active'`); regular `admin` cannot update `sellers`; `super_admin` approves (with `0086` compliance), suspends, and reinstates.
   - **Product description & `cost_price` column lockdown:** Authenticated retailer reads `products.description`; both `anon` and `authenticated` receive `permission denied` on `products.cost_price` (`0107` preserved).
   - **Product / offer moderation & immutable history:** Prohibited offer removal auto-logs `removed_prohibited` in `product_moderation_history`; `DELETE`/`UPDATE` blocked (`append-only`); seller cannot insert moderation history (`row-level security`).
   - **Stock validation & out-of-stock:** Retailer & seller blocked from `admin_set_product_pack_stock`; negative quantity rejected; Super Admin sets stock and marks pack out-of-stock (`0`).
   - **Wholesale pricing limits (server-side bypass prevention):** Non-Super Admin blocked from updating `wholesale_pricing_rules`; seller/pack cap > global cap rejected (`DISCOUNT_EXCEEDS_GLOBAL_LIMIT`); offer below MOQ rejected (`MOQ_BELOW_SUPER_ADMIN_MINIMUM`); offer discount above cap rejected (`DISCOUNT_EXCEEDS_MAX_LIMIT`); seller slab when disabled rejected (`SELLER_CUSTOM_SLABS_NOT_ALLOWED`); slab discount above cap rejected (`DISCOUNT_EXCEEDS_MAX_LIMIT`).
   - **Membership governance & immediate expiry enforcement:** `live_payment_collection_enabled = true` blocked by CHECK constraint; activating plan while `program_enabled = false` blocked (`MEMBERSHIP_PROGRAM_DISABLED`); `super_admin_assign_membership` blocked for non-Super Admin and while disabled; expired Silver record (`expires_at = now() - 5s`, raw `status = 'active'`) evaluated by `get_retailer_membership_overview` returns `is_expired: true`, `benefits_active: false`, `0%` effective discounts, `remaining_seconds: 0`, `tier: 'free'`; cross-tenant overview read denied (`Access denied`); retailer upgrade request blocked while disabled.
   - **Banner publishing audit & controlled paid seller ad campaigns:** `ad_program_settings.live_payment_collection_enabled = true` blocked by CHECK constraint; seller cannot insert pre-approved campaign; seller submits `pending_approval` campaign (auto-audited); seller cannot self-approve, activate, or modify `payment_status`; other seller cannot view campaign (tenant isolation); Super Admin approval blocked while `seller_ads_enabled = false` (`SELLER_ADS_DISABLED`); Super Admin rejection writes immutable `seller_ad_campaign_audit` (`DELETE` blocked as `append-only`); `banners` insert logged into `audit_logs` via `trg_audit_banners`.
   - **Anonymous access restriction:** `anon` receives `permission denied` on all 10 Phase 3 / Super Admin governance tables (`wholesale_pricing_rules`, `seller_pricing_permissions`, `product_wholesale_limits`, `product_moderation_history`, `membership_program_settings`, `membership_upgrade_requests`, `ad_program_settings`, `seller_ad_campaigns`, `seller_ad_campaign_audit`, `super_admin_audit_logs`).
   - **Role escalation prevention & Super Admin audit integrity:** `retailer` and `seller` blocked from updating `profiles.role`; Super Admin blocked from forging `super_admin_audit_logs.actor_id`; `UPDATE`/`DELETE` on `super_admin_audit_logs` blocked (`append-only`).
   - **Migration `0109` idempotency & guarded rollback:** Replaying `0109` UP succeeds with 0 errors; rollback refuses to run when Phase 3 tables contain data without `maharani.allow_data_loss = 'true'`; rollback succeeds cleanly when authorized and re-applying `0109` restores default singleton state.

3. **`tests/phase3-rollback-protection-db.test.ts` (12 tests — Real PostgreSQL 16 via PGlite — PASS)**
   - **Zero `CASCADE` drops:** Verifies executable SQL in `0109_phase3_business_control.down.sql` contains zero `CASCADE` clauses.
   - **Per-surface preflight data-loss protection (11/11 protected surfaces verified individually on isolated clean post-`0109` DBs):**
     - Non-empty `products.description` blocks destructive rollback.
     - Non-default or operator-edited `wholesale_pricing_rules` (including notes/`updated_by`-only edits) blocks rollback.
     - `seller_pricing_permissions` rows block rollback.
     - `product_wholesale_limits` rows block rollback.
     - Customized `membership_plans` Phase 3 configuration columns (`product_discount_percent`, `order_value_discount_percent`, `min_order_value_paise`, `max_discount_paise`, `eligibility_rules`, `renewal_mode`) block rollback.
     - Non-default or operator-edited `membership_program_settings` blocks rollback.
     - `membership_upgrade_requests` rows block rollback.
     - Non-default or operator-edited `ad_program_settings` (placement rules, slot limits, notes/`updated_by`) blocks rollback.
     - `product_moderation_history`, `seller_ad_campaigns`, and `seller_ad_campaign_audit` remain protected and block rollback.
   - **Atomicity, no-`CASCADE` enforcement, clean empty rollback, idempotent retry & re-apply:** External dependent view on `wholesale_pricing_rules` causes rollback to fail cleanly with zero partial drops (Step 5/4/3 objects all remain intact); once removed, clean empty rollback succeeds with 0 warnings and removes all 9 Phase 3 tables, 9 columns, and 15 functions while preserving pre-existing `products`/`sellers`/`membership_plans` rows, `0083` inactive state, and `0107` `products.cost_price` lockdown; retrying rollback a second time succeeds cleanly; re-applying `0109` restores all tables, columns, defaults, and privileges cleanly.
   - **Explicit authorized transaction-local override contract:** Bare `SET LOCAL` outside a transaction and invalid values (`'yes'`) are refused with full itemized counts across all 11 surfaces; `BEGIN; SET LOCAL maharani.allow_data_loss = 'true'; <rollback>; COMMIT;` emits a captured PostgreSQL `WARNING` message itemizing every affected surface, preserves pre-existing `products`, `membership_plans`, and `super_admin_audit_logs` rows, and immediately disarms `maharani.allow_data_loss` so subsequent rollbacks refuse again.

---

## 3. Existing Contract & Regression Suites Verified Passing

All repository-wide automated security, migration, and UI contract suites ran and passed with zero regressions:
- `tests/migration-catalog-invariants.test.ts` (14/14 PASS — RLS on every table, `SECURITY DEFINER` `search_path` pins, exact 11 storage buckets)
- `tests/migration-reservations.test.ts` (6/6 PASS — contiguous migration numbering through `0109`)
- `tests/page-guard-consistency.test.ts` (9/9 PASS — page redirect guards vs throwing action guards)
- `tests/server-action-surface.test.ts` (4/4 PASS — every exported `'use server'` action enforces auth guard)
- `tests/design-system-contract.test.ts` (14/14 PASS — zero prohibited red colors)
- `tests/admin-layout-guard.test.ts` (7/7 PASS)
- `tests/dashboard-upgrade.test.ts` (37/37 PASS — honest KPIs, zero fake stats, cookie-bound RLS reads)
- `tests/membership-db.test.ts` (11/11 PASS) & `tests/membership-page-error.test.tsx` (3/3 PASS)
- `tests/seller-marketplace-db.test.ts` (21/21 PASS) & `tests/seller-marketplace-actions.test.ts` (22/22 PASS)
- `tests/security-phase0-db.test.ts` (57/57 PASS) & `tests/security-advisor-remediation-db.test.ts` (8/8 PASS)
- `tests/site-content-db.test.ts` (18/18 PASS) & `tests/site-content-release.test.ts` (5/5 PASS)
- `tests/publishing-integrity-0108-db.test.ts` (14/14 PASS) & `tests/super-admin-bootstrap-db.test.ts` (10/10 PASS)

---

## 4. What Was NOT Tested Against Production

Per strict safety policy:
- No migrations (`0104`–`0109`) were executed on production Supabase (`fhrmsrumsraprvutrpeo`).
- No production Auth users, RLS policies, environment variables, or Vercel deployments were modified.
- No live seller accounts, paid membership plans, paid seller ads, or live payment collections were activated.
