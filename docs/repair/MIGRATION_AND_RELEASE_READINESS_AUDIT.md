# Maharani Traders — Migration Reconciliation, Security & Release Readiness Audit

**Date:** 2026-11-16  
**Pull Request:** `#137` (`arena/db779fee-maharani-mart`)  
**Official Production Supabase Project (Read-Only Audited):** `fhrmsrumsraprvutrpeo` (`Maharani-mart`)  
**Legacy Project (Untouched):** `gbxhmffsbsfhdrfuwurx` (`maharanimaa`) — NEVER referenced or modified.  
**Production Changes Made:** **NONE** (read-only inspection only).

---

## 1. Proven Root Cause of `MIGRATIONS_FAILED` on `main`

- **GitHub Check Run Evidence:** Check run `#133450841369` (`Supabase Preview` on `main` `a99e8f65df5fe69fbe71384994c6da3cb4f2d786`) failed with the verbatim error:
  > `Remote migration versions not found in local migrations directory.`
- **Read-Only Live DB Evidence (`fhrmsrumsraprvutrpeo`):**
  - `supabase_migrations.schema_migrations` contains `0001` through `0102` (with documented historical gaps `0061`, `0075`, `0076`), followed by:
    - `version = '20261115155706'`, `name = '0103_security_advisor_remediation'` (6,296 bytes — matching local `supabase/migrations/0103_security_advisor_remediation.sql`).
  - Repository migrations use 4-digit sequential prefixes (`0001_...` through `0109_...`). Because the remote ledger stores `20261115155706` instead of `0103`, Supabase CLI's migration diff detects an unknown remote version that also sorts lexicographically AFTER `0104`–`0109`.
  - Migrations **`0104` through `0109` are NOT applied in production** (`site_pages`, `super_admin_bootstrap_allowlist`, `wholesale_pricing_rules` are absent, and `products.cost_price` remains selectable by `authenticated` because `0107` is unapplied — currently 0 live products / 0 live users).
- **PR #137 `Supabase Preview` Status:** Skipped (not failed) with verbatim message:
  > `This git branch is not associated with any Supabase Branch` (official Supabase org is on the Free plan; Supabase Branching requires Pro/paid upgrade).
- **CI Migration Validation Coverage:** Local disposable PostgreSQL 16 (`@electric-sql/pglite` PG 16 WASM) executes the full `0001`–`0109` migration chain, exact `0103` → `0104`–`0109` upgrade path, fresh-vs-upgrade parity, idempotent replay of `0109`, preflight fail-fast checks, and 11-surface rollback data-loss protection inside `corepack pnpm test` in GitHub Actions CI (`tests/migration-validation-0103-to-0109-db.test.ts`, `tests/phase3-business-control-db.test.ts`, `tests/phase3-rollback-protection-db.test.ts`, `tests/migration-catalog-invariants.test.ts`).

### Owner-Only Production Reconciliation & Rollout Runbook (DO NOT RUN WITHOUT OWNER APPROVAL + BACKUP)

1. Take a fresh logical backup of `fhrmsrumsraprvutrpeo` and confirm zero unexpected schema drift via `supabase/audits/migration_and_security_verification_readonly.sql`.
2. Reconcile the `0103` migration ledger entry using Supabase CLI (`supabase migration repair`) ONLY after verifying `20261115155706` matches `0103_security_advisor_remediation.sql` byte-for-byte:
   - Mark `20261115155706` as reverted in ledger metadata ONLY (do NOT execute `0103.down.sql`) and record `0103` as applied:
     ```bash
     supabase migration repair --status reverted 20261115155706
     supabase migration repair --status applied 0103
     ```
3. Run a dry-run (`supabase db push --dry-run`) and confirm ONLY `0104`, `0105`, `0106`, `0107`, `0108`, `0109` are queued in strict order.
4. Apply `0104`–`0109` in one coordinated maintenance window and immediately verify:
   - `has_column_privilege('authenticated', 'public.products', 'cost_price', 'SELECT') = false` (`0107`)
   - `has_column_privilege('authenticated', 'public.products', 'description', 'SELECT') = true` (`0109`)
   - `can_current_staff_read_profile(<any_uuid>) = false` as `anon` (`0109`)
   - All `membership_plans.is_active = false`, `membership_program_settings.program_enabled = false`, `ad_program_settings.seller_ads_enabled = false`, and `live_payment_collection_enabled = false`.

---

## 2. Unapplied Migration Inventory (`0104`–`0109`)

| Migration | Purpose | Key Dependencies | Rollback Script |
|---|---|---|---|
| `0104_site_content_management.sql` | Super Admin managed legal/info pages (`site_pages`, versions, `published_page`) | `0001`–`0103` | `0104_site_content_management.down.sql` |
| `0105_seed_site_content.sql` | Seeds initial unpublished/template policy pages | `0104` | `0105_seed_site_content.down.sql` |
| `0106_first_super_admin_bootstrap.sql` | Controlled first Super Admin bootstrap allowlist & audit | `0001`, `0020` | `0106_first_super_admin_bootstrap.down.sql` |
| `0107_restore_cost_price_column_lockdown.sql` | Re-locks `products.cost_price` SELECT from `anon`/`authenticated` | `0001`, `0103` | Intentionally omitted (rolling back re-exposes wholesale cost prices) |
| `0108_publishing_integrity.sql` | Non-SECURITY DEFINER actor stamping on site content publishing | `0104` | `0108_publishing_integrity.down.sql` |
| `0109_phase3_business_control.sql` | Phase 3 business governance + Section 6 security hardening (`can_current_staff_read_profile`, `submit_supplier_application` DB rate limit, 13 trigger EXECUTE revocations) | `0001`, `0020`, `0037`, `0059`, `0060`, `0072`, `0080`, `0081`, `0083`, `0107` | `0109_phase3_business_control.down.sql` (11-surface data-loss protection, zero `CASCADE`, tx-local override disarm) |

---

## 3. Privacy-Preserving Replacement Design for `is_phone_registered(text)`

- **Current Risk (Verified in Live Production):** `public.is_phone_registered(p_phone text)` is `SECURITY DEFINER`, `search_path = public`, with `EXECUTE` granted to `PUBLIC`, `anon`, and `authenticated`. Any unauthenticated caller can probe `POST /rest/v1/rpc/is_phone_registered` to enumerate registered Indian mobile numbers in `public.profiles`.
- **Verified Real Callers (Repository-Wide):**
  1. `lib/auth/actions.ts:664` (`registerRetailerAction` — Next.js Server Action)
  2. `lib/admin/team-actions.ts:67` (`createStaffAction` — Next.js Server Action, already uses `createServiceRoleClient()`)
  3. `app/api/mobile/v1/retailers/register/route.ts:59` (`POST /api/mobile/v1/retailers/register` — Next.js Route Handler, already rate-limited)
  4. **Zero browser/client components and zero Android app files call `is_phone_registered` directly.**
- **Why Deferred From PR #137:** Removing `anon` `EXECUTE` requires coordinated changes to PR #136's `lib/auth/actions.ts`, `/api/mobile/v1/retailers/register`, and four existing contract test suites (`tests/mobile-auth.test.ts`, `tests/api-privilege-hardening.test.ts`, `tests/security-advisor-remediation-db.test.ts`, `tests/migration-catalog-invariants.test.ts`). Per scope rules, PR #136 dual-login/auth files were not modified.
- **Recommended 2-Step Privacy-Preserving Replacement (Dedicated Security PR):**
  1. **Eliminate client/anon phone probing:**
     - In `lib/admin/team-actions.ts`, check duplicate phones directly via `createServiceRoleClient()` (authenticated Super Admin/Admin only).
     - In `lib/auth/actions.ts` (`registerRetailerAction`) and `app/api/mobile/v1/retailers/register/route.ts`, remove the `anon` RPC pre-check and apply server-side rate limiting + rely on `handle_new_user()`'s atomic `phone_already_registered` check — returning an OWASP anti-enumeration response (*"If these details are eligible, check your email to continue or sign in with your existing account"*) or, if the business requires explicit UX feedback, perform the pre-check strictly server-side behind a durable rate limiter via `service_role`.
  2. **Revoke API `EXECUTE`:**
     ```sql
     alter function public.is_phone_registered(text) set search_path = pg_catalog, public, pg_temp;
     revoke all on function public.is_phone_registered(text) from public, anon, authenticated;
     grant execute on function public.is_phone_registered(text) to service_role;
     ```

---

## 4. Live Supabase Auth, Email OTP & SMTP Gaps (`fhrmsrumsraprvutrpeo` — Read-Only Audit)

| Setting | Current Live Production Value | Required Production Value (Owner Dashboard Action) |
|---|---|---|
| `site_url` | `http://localhost:3000` | Production HTTPS origin (`https://maharanitraders.vercel.app` or verified custom domain) |
| `uri_allow_list` | `""` (empty) | Production `/auth/callback` & `/auth/reset-password` HTTPS allowlist |
| Custom SMTP (`smtp_host`) | Unconfigured (built-in limiter: `2` emails/hr!) | Owner-configured SMTP (see `docs/repair/GMAIL_SMTP_OWNER_SETUP_GUIDE.md` or verified transactional SMTP such as Resend/Postmark/SES) |
| `mailer_otp_length` | `8` digits | **`6` digits** (matches PR #136 UI & `OTP_CODE_LENGTH = 6` in `lib/auth/otp-rules.ts`) |
| `mailer_otp_exp` | `3600` seconds (60 min) | **`600` seconds (10 min)** (recommended security window) |
| `mailer_templates_magic_link_content` | Default `{{ .ConfirmationURL }}` magic link | Apply `supabase/templates/otp-signin.html` (`{{ .Token }}` 6-digit code) |
| `password_hibp_enabled` | `false` | Enable HaveIBeenPwned leaked-password check (available on Pro; verify Free-plan availability) |

---

## 5. Legal, Tax & Business Readiness Checklist (Cosmetics & FMCG Only — No Food Sales)

- **Scope Lock Verified:** Cosmetics & non-food FMCG only (`categories` live food-blocked = `0`, zero food categories; marketplace seller registration/publishing, paid memberships, paid seller ads, and live payment collection remain **DISABLED**).
- **CRITICAL LIVE COMPLIANCE FINDING (`data_retention_rules`):**
  - Read-only inspection of `fhrmsrumsraprvutrpeo` confirmed **6 `business_120` rules are currently `enabled = true`** (`orders`, `payment_collections`, `retailer_wallet_ledger`, `return_requests`, `stock_movements`, `order_stock_allocations`, 120-day deletion via daily `/api/cron/cleanup`).
  - **Indian CGST Act, 2017 Section 36** requires retention of books of account, tax invoices, credit/debit notes, and payment records for **72 months (6 years)** from the due date of furnishing the annual return.
  - **Owner Action Required Before Live Commercial Orders:** Disable all `business_120` rules in `data_retention_rules` (or replace with immutable 6+ year cold archival) before issuing commercial GST invoices! (Currently 0 live orders exist, so zero data has been deleted.)
- **Pre-Launch Owner/CA/Legal Sign-Off Items (No Details Invented):**
  - [ ] Legal entity name, registered business address, and verified GSTIN configured in managed site pages (`0104`/`0105`).
  - [ ] Tax invoice numbering sequence, HSN codes & GST rate mapping verified by CA for every cosmetics/FMCG SKU.
  - [ ] Consumer Grievance Officer name, email, phone, and turnaround SLA published under Consumer Protection (E-Commerce) Rules, 2020.
  - [ ] Privacy Policy (DPDP Act 2023 notice/consent/erasure/retention alignment), Terms of Use, Refund/Cancellation/Delivery Policy published via `/admin/content` (currently `site_pages` is unapplied because `0104` is pending).
  - [ ] Prohibited/restricted goods controls (non-food cosmetics/FMCG, CDSCO/Legal Metrology MRP/batch/expiry/country-of-origin declarations verified per SKU).
  - [ ] **Future Marketplace Gate (Currently Disabled):** Seller Agreement, Seller KYC/GSTIN verification workflow, and Section 52 CGST TCS + Section 194-O Income Tax TDS review by CA before enabling `marketplace_launch_approvals` / `third_party_offers_enabled`.

---

## 6. Free-Plan & Resource Audit (`fhrmsrumsraprvutrpeo` + Vercel)

| Resource | Measured Value / Status | Free-Plan Limit / Notes |
|---|---|---|
| Supabase DB Size (`fhrmsrumsraprvutrpeo`) | **19.63 MB** | 500 MB Free limit (~3.9% used) |
| Supabase Auth Users / MAU | **0 users** (0 MAU) | 50,000 MAU Free limit |
| Supabase Storage | **11 buckets**, **0 objects** (0 bytes) | 1 GB Free limit |
| Supabase Edge Functions | **0 functions** | 500K invocations/mo Free limit |
| Supabase `cron.job` | **0 jobs** | N/A |
| Supabase Health (8 services) | All `ACTIVE_HEALTHY` (PostgreSQL 17.11) | Free org currently uses **2/2 active project slots** (`Maharani-mart` + legacy `maharanimaa` untouched) |
| Supabase Branching | Unavailable on Free plan | PR #137 `Supabase Preview` skips cleanly; local PG 16 CI covers migration testing at $0 cost |
| Vercel Plan / Commercial Use / Env Vars | **Unverified via API** (`limited: true` token denied project/env access) | **IMPORTANT OWNER CHECK:** Vercel's **Hobby (Free) plan prohibits commercial use** under Vercel's Fair Use Guidelines. Because Maharani Traders is a commercial B2B wholesale business, the owner MUST confirm the deployment is on **Vercel Pro** (or another commercial-permitted host) before live commercial launch! |
