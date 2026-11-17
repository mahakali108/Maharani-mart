# Phase 3 — Super Admin Business Control, Seller Governance & Marketplace Operations Report

**Repository:** `mahakali108/Maharani-mart`  
**Branch:** `arena/db779fee-maharani-mart` (branched from `main` at `a99e8f65df5fe69fbe71384994c6da3cb4f2d786`)  
**Official Production Supabase Project (Read-Only Verified):** `Maharani-mart` (`fhrmsrumsraprvutrpeo`, region `ap-south-1`, `ACTIVE_HEALTHY`)  
**Legacy Supabase Project (Untouched & Excluded):** `maharanimaa` (`gbxhmffsbsfhdrfuwurx`)  
**Live Website / PWA Target:** `https://maharanitraders.vercel.app` (Vercel project `maharanitraders`)  
**Date:** 2026-11-16  
**Status:** Local implementation & full verification complete; **NOT deployed to production**, **NOT merged to `main`**, **NO production SQL/migrations executed** (awaiting explicit owner approval).

---

## 1. Phase 2 Verification & Baseline Audit

Before writing any Phase 3 code, Phase 2 and the current `main` baseline (`a99e8f6`, PR #136 merge) were verified:

1. **PR #136 & Dual-Login Separation:**
   - PR #136 merged on `2026-11-16T16:42:12Z` containing Phase 2 Super Admin Website Content Manager (`0104`–`0108`) and Dual Login (Email + Password & Email OTP via Gmail SMTP, commit `86128b18`).
   - Dual-login files (`lib/auth/{otp-rules,sign-in-gate,actions,helpers}.ts`, `components/auth/{email-otp-form,login-form}.tsx`, `supabase/templates/otp-signin.{html,txt}`) were kept untouched and not duplicated.
   - PR #125 was already merged (`2026-11-14`) and left untouched.
   - 7 older open PRs (#107, #66, #45, #42, #31, #21, #7) had no merge conflicts with this branch.
2. **Phase 2 Deliverables Checked:**
   - `docs/repair/PHASE2_SUPER_ADMIN_CONTENT_REPORT.md` and `docs/repair/SUPER_ADMIN_FIRST_BOOTSTRAP_GUIDE.md` are present and complete.
   - Actual Phase 2 code (`/admin/content`, `lib/admin/site-content-actions.ts`, `supabase/migrations/0104`–`0108`, `tests/publishing-integrity-0108-db.test.ts`, `tests/super-admin-bootstrap-db.test.ts`) passed 100% locally.
   - **Production Rollout Status of Phase 2 (Read-Only Check):** Official Supabase project `fhrmsrumsraprvutrpeo` currently has migrations applied through `0102` + `20261115155706` (`0103`). Migrations `0104`–`0108` are **not yet applied in production** (correctly awaiting owner approval).
   - **GitHub Checks on `a99e8f6`:** `Web checks` = SUCCESS, `Probe the live production deployment` = SUCCESS, `Vercel` = SUCCESS. `Supabase Preview` = FAILURE (pre-existing `0103` migration timestamp mismatch in Supabase Preview branch — documented honestly, not caused by Phase 3).
   - **Vercel Connector Check:** Connector token is scoped `"limited": true` (`mahakali1`), returning `Access denied` on project inspection APIs; production deployment status was verified via GitHub commit status (`Vercel: success`) and live health probe (`Probe the live production deployment: success`).
3. **Baseline Local Gates (`a99e8f6`):**
   - `typecheck`: PASS
   - `lint`: PASS
   - `test`: 233 files / 3,583 tests PASS
   - `next build`: PASS

---

## 2. Phase 3 Implementation Summary (Modules A–F)

All Phase 3 additions preserve existing architecture, authentication, roles (`retailer`, `seller`, `admin`, `super_admin`, plus `staff`/`salesman`), design system tokens (zero prohibited red colors), and existing test contracts.

### Database Migration (`0109`) & Guarded Rollback
- **`supabase/migrations/0109_phase3_business_control.sql`** (idempotent, ordered after `0108`, zero dependency on `0104` rollback objects)
- **`supabase/rollbacks/0109_phase3_business_control.down.sql`** (single atomic `DO $rollback_0109$` block, zero `CASCADE` drops, safe idempotent retry, explicit itemized preflight data-loss protection across all 11 Phase 3 data surfaces: `products.description`, `product_moderation_history`, `wholesale_pricing_rules` non-default/edited rows, `seller_pricing_permissions`, `product_wholesale_limits`, all 8 added `membership_plans` Phase 3 configuration columns, `membership_program_settings` non-default/edited rows, `membership_upgrade_requests`, `ad_program_settings` non-default/edited rows, `seller_ad_campaigns`, and `seller_ad_campaign_audit`. Requires explicit transaction-local `BEGIN; SET LOCAL maharani.allow_data_loss = 'true'; ... COMMIT;` to force destructive teardown, emits an itemized `RAISE WARNING` listing every record being deleted, and immediately disarms `maharani.allow_data_loss` on completion. Removes all 9 Phase 3 tables, 9 columns, 7 constraints, 8 indexes, 19 table policies, 24 triggers, and 15 functions while restoring `0080` `membership_plans` policies and preserving all pre-existing business data, `0083` membership retirement, `0107` `cost_price` lockdown, and `super_admin_audit_logs` records/hardening.)

Key schema additions:
1. `products.description` (nullable `text`, max 2000 chars) + explicit `grant select (description) on public.products to anon, authenticated` preserving `0107`'s column-level `cost_price` lockdown.
2. `product_moderation_history` (append-only table + actor-pinning trigger + automatic trigger `trg_log_seller_offer_moderation_event` on `seller_offers`).
3. `wholesale_pricing_rules` (singleton global guardrails), `seller_pricing_permissions`, `product_wholesale_limits`, and `AFTER INSERT OR UPDATE` server-side enforcement triggers on `seller_offers`, `seller_offer_tiers`, and `product_pricing_tiers`.
4. Additive governance columns on `membership_plans` (`product_discount_percent`, `order_value_discount_percent`, `min_order_value_paise`, `max_discount_paise`, `eligibility_rules`, `expiry_behavior = 'immediate_stop'`, `grace_period_days = 0`, `renewal_mode`), `membership_program_settings` (`program_enabled = false`, `live_payment_collection_enabled = false` CHECK constraint), `membership_upgrade_requests`, `get_retailer_membership_overview(uuid)` (authoritative immediate-stop expiry evaluator), and owner-gated `super_admin_assign_membership(...)` (legacy `admin_set_retailer_membership` stays REVOKED).
5. `ad_program_settings` (`seller_ads_enabled = false`, `live_payment_collection_enabled = false` CHECK constraint), `seller_ad_campaigns` (strict anti-self-approval + owner-gate triggers), and immutable `seller_ad_campaign_audit`.
6. Audit integrity hardening: `super_admin_audit_logs` revoked from `anon`, `UPDATE`/`DELETE` revoked & blocked by append-only trigger, `actor_id` pinned to `auth.uid()`; `banners` attached to `log_audit()`; safe `log_phase3_governance_audit()` attached to non-UUID-PK governance tables.

---

### Module A — Seller Management
- **Files:** `lib/admin/super-admin-audit.ts`, `lib/admin/seller-actions.ts`, `lib/admin/offer-actions.ts`, `lib/admin/sellers-query.ts`, `components/admin/offer-row-actions.tsx`, `app/admin/sellers/[id]/page.tsx`.
- **Capabilities delivered:**
  - View registered sellers, compliance checklist, and private uploaded verification documents (`seller_compliance_reviews`, `seller_compliance_evidence`) on `/admin/sellers/[id]`.
  - Approve / reject pending applications, suspend (drain mode) / reinstate sellers — restricted to `super_admin` server-side and in DB RLS (`0072`) with `super_admin_audit_logs` recording.
  - Real DB seller order & sales statistics from `sub_orders` and `seller_ledger` (honest zeros when none exist).
  - Real DB seller action & offer moderation timeline (`audit_logs` + `product_moderation_history`) plus direct link to seller wholesale pricing permissions.
  - Added Super Admin **`removeProhibitedOfferAction`** (`[PROHIBITED]` removal) + fixed latent UI bug in `OfferRowActions` where rejection reason input was hidden for `pending`/`approved` offers.
- **Launch Gate:** Marketplace seller registration/publishing (`0098` `marketplace_launch_state`) remains **DISABLED**.

### Module B — Product & Catalogue Management
- **Files:** `lib/admin/products-actions.ts`, `components/admin/product-form.tsx`, `components/admin/product-pack-stock-editor.tsx`, `app/admin/products/[id]/page.tsx`.
- **Capabilities delivered:**
  - Added validated product `description` field (<= 2000 chars) to create/edit product workflows while preserving `0107` `cost_price` security boundaries.
  - Added server-guarded **`markPackOutOfStockAction`** (zeroes pack stock via audited `admin_set_product_pack_stock`, appends `marked_out_of_stock` into `product_moderation_history`, logs `super_admin_audit_logs`) and one-click **Out of stock** button in `ProductPackStockEditor`.
  - Added **Moderation & availability history** panel on `/admin/products/[id]` reading live `product_moderation_history` entries + link to `/admin/offers`.

### Module C — Wholesale Pricing Control
- **Files:** `lib/admin/wholesale-pricing-rules.ts`, `lib/admin/wholesale-pricing-query.ts`, `lib/admin/wholesale-pricing-actions.ts`, `components/admin/wholesale-pricing-control.tsx`, `app/admin/pricing/wholesale/page.tsx`, `app/admin/pricing/page.tsx`.
- **Capabilities delivered:**
  - Dedicated Super Admin console at `/admin/pricing/wholesale` (`requireSuperAdminPage()`).
  - Configure global wholesale rules (default MOQ, max discount %, minimum order value, seller custom slabs permission, pack floor enforcement).
  - Configure per-seller pricing permissions (custom slabs toggle, discounts toggle, seller max discount cap <= global cap, min MOQ override).
  - Configure per-pack wholesale limits (min MOQ, max discount cap <= global cap, allow seller slabs).
  - Server-side DB triggers block sellers from bypassing MOQ minimums, discount caps, or disabled custom slabs (`DISCOUNT_EXCEEDS_MAX_LIMIT`, `MOQ_BELOW_SUPER_ADMIN_MINIMUM`, `SELLER_CUSTOM_SLABS_NOT_ALLOWED`).
  - Added `requirePagePermission('pricing.manage')` guard to `/admin/pricing`.

### Module D — Retailer Membership Management (Free, Silver, Gold)
- **Files:** `lib/membership/rules.ts`, `lib/admin/membership-query.ts`, `lib/admin/membership-actions.ts`, `components/admin/membership-manager.tsx`, `app/admin/memberships/page.tsx`, `components/retailer/retailer-membership-overview.tsx`, `app/retailer/membership/page.tsx`.
- **Capabilities delivered:**
  - Super Admin configuration console at `/admin/memberships` (`requireSuperAdminPage()`) for Free, Silver, and Gold plans: plan name, planned price, duration, benefits, product discount %, order-value discount %, min order value, max discount cap, eligibility rules, renewal settings (`disabled` | `manual_owner_approval`), and locked immediate-stop expiry (`expiry_behavior = 'immediate_stop'`, `grace_period_days = 0`).
  - Retailer dashboard view on `/retailer/membership` powered by `get_retailer_membership_overview(retailer_id)` showing current plan, active benefits, expiry date, remaining validity, configured tier previews, and membership history — preserving the retained loyalty points ledger and `ReadFailureNotice` error handling.
  - **Immediate stop on expiry:** Both PostgreSQL (`get_retailer_membership_overview`) and TypeScript (`evaluateMembershipBenefits`, `computeMembershipOrderDiscountPaise`) immediately drop effective discounts to `0%` and mark `benefitsActive = false` at `expires_at <= now()`.
  - **Safety Gate:** All membership plans remain `is_active = false`, `program_enabled = false`, `live_payment_collection_enabled = false`, checkout discount remains retired (`0083`), and zero payment provider credentials exist.

### Module E — Banner & Advertisement Management
- **Files:** `app/admin/banners/page.tsx`, `lib/admin/ad-campaign-rules.ts`, `lib/admin/ad-campaign-query.ts`, `lib/admin/ad-campaign-actions.ts`, `components/admin/ad-campaigns-manager.tsx`, `app/admin/banners/campaigns/page.tsx`, `components/seller/seller-campaigns-panel.tsx`, `app/seller/campaigns/page.tsx`, `app/seller/layout.tsx`.
- **Capabilities delivered:**
  - Existing homepage banner CRUD (desktop + mobile artwork, destination links, IST schedule, sort order, draft/published toggle, preview before publishing) hardened with `requirePagePermission('banners.manage')` and `trg_audit_banners`.
  - Controlled paid seller ad campaign workflow prepared at `/admin/banners/campaigns` (`requireSuperAdminPage()`) and `/seller/campaigns` (`requireSellerPage()`): seller submission, live creative preview, Super Admin placement rules & slot limits, approve/reject/pause moderation, offline budget/payment status tracking, and immutable `seller_ad_campaign_audit`.
  - **Safety Gate:** `ad_program_settings.seller_ads_enabled = false` and `live_payment_collection_enabled = false` by default; DB triggers reject campaign approval/activation while disabled and prevent seller self-approval or payment status tampering.

### Module F — Super Admin Dashboard & Navigation
- **Files:** `lib/admin/dashboard/types.ts`, `lib/admin/dashboard/data.ts`, `components/admin/dashboard-view.tsx`, `components/layout/admin-shell.tsx`.
- **Capabilities delivered:**
  - Added real RLS-scoped `businessOperations` panel on `/admin/dashboard` (visible to Super Admin via `visibility.commandCenter`, cookie-bound client only — never service role):
    - Total sellers, active sellers, pending seller approvals
    - Pending product/offer reviews (seller offers + product compliance reviews)
    - Active membership plans & active unexpired retailer membership records
    - Active published homepage banners, active paid seller ads, pending seller ad submissions
    - Recent Super Admin governance activity from `super_admin_audit_logs`
  - Existing real-DB metrics retained honestly (total retailers, total products, orders, revenue only from real non-cancelled order records, zero/empty/unavailable states — zero fake charts or hardcoded numbers).
  - Added Super Admin-only sidebar navigation links (`Wholesale Pricing`, `Memberships`, `Ad Campaigns`) in `AdminShell`.

---

## 3. Explicit Delivery Status & Owner-Approval Gate

| Area | Status | Notes |
|---|---|---|
| Phase 2 code & local test verification | **Completed** | Verified on `a99e8f6`; production migrations `0104`–`0108` remain awaiting owner approval |
| Phase 3 Modules A–F code, migration `0109` + rollback, UI, server actions | **Completed (Local / PR)** | All 6 modules implemented cleanly on `arena/db779fee-maharani-mart` |
| Typecheck, ESLint, Full Test Suite (236 files / 3,622 tests), Next.js Build | **Completed (PASS)** | 0 errors, 0 failures (includes 14 rollback data-loss protection & atomicity DB tests covering all 8 `membership_plans` Phase 3 columns) |
| Vercel API project inspection | **Blocked (Token Scope)** | Vercel connector token is `"limited": true`; deployment health confirmed via GitHub status & live probe |
| Supabase Preview CI check on `main` | **Pre-existing Failure** | `0103` timestamp mismatch on Supabase Preview branch (predates Phase 3) |
| Production DB migrations (`0104`–`0109`) | **Awaiting Owner Approval — NOT Executed** | Strictly prohibited without explicit owner go-ahead |
| Production deployment / PR merge | **Not Deployed / Not Merged** | PR opened for review; merge requires owner approval |
| Live seller marketplace / live memberships / paid seller ads / payment collection | **Disabled — Awaiting Owner & Legal Approval** | Hard-gated OFF in DB & UI |
