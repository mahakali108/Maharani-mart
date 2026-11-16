# MAHARANI TRADERS — COMPLETE A TO Z MASTER AUDIT

**Audit Date:** 2026-11-16 (UTC)  
**Repository:** `mahakali108/Maharani-mart`  
**Branch Inspected:** `main` at commit `ecf1731c6a91c34e6dd956e3f3526bf4503f08aa` (via `arena/8b4db142-maharani-mart`)  
**Official Supabase Project:** `Maharani-mart` (`fhrmsrumsraprvutrpeo`)  
**Production Website:** `https://maharanitraders.vercel.app`  
**Audit Mode:** STRICT READ-ONLY (no files edited, no migrations applied, no data modified)

---

## 1. Executive Summary

Maharani Traders (`Ajay General`) has an extensive, well-architected codebase (Next.js 16.4.5, React 19, TypeScript, Supabase PostgreSQL 17.11, and a native Kotlin/Compose Android app). However, **the platform is NOT READY for production launch**.

Key reasons:
1. **Web CI is currently FAILING on `main`** (`Unit and integration tests` failed on run `43837455809` after PR #134 merged).
2. **Live Supabase database (`fhrmsrumsraprvutrpeo`) is behind `main`**: Migrations `0104`, `0105`, and `0106` are present in `supabase/migrations/` but **NOT applied** to live Supabase (which stops at `0103_security_advisor_remediation`).
3. **Zero live data / uninitialized production**: `profiles` = 0 rows, `products` = 0 rows, `orders` = 0 rows. No Super Admin, Retailer, or Seller account exists in live Supabase.
4. **Critical Auth misconfiguration in live Supabase**: `site_url` is still `http://localhost:3000`, `uri_allow_list` is empty `""`, `smtp_host` is `null` (default Supabase mailer limited to 2 emails/hour), `external_phone_enabled` is `false`, `security_captcha_enabled` is `false`, and `password_min_length` is `6`.
5. **Legal & Compliance incomplete**: Only `seller-agreement` v1.0 is published in `legal_document_current_versions`. Privacy Policy, Terms & Conditions, Refund/Cancellation Policy, Shipping Policy, and GSTIN/Grievance Officer details are not yet published/verified by owner/CA/advocate.
6. **Vercel & Live Website**: Vercel connector returned `Access denied` (token lacks scope), and sandbox outbound network blocks `maharanitraders.vercel.app`, so live Vercel deployment/env-var/HTTP status is **NOT VERIFIED** (though GitHub's `Production health` workflow passed on `main`).

**Overall Launch Readiness:** **NOT READY / BLOCKED**

---

## 2. Current Project Status

- **Codebase:** Rich B2B wholesale PWA + Native Android client (`/api/mobile/v1`).
- **Database Schema:** 110 `public` tables, all with RLS enabled (`rowsecurity = true`); 6 `public` views, all with `security_invoker = true`; 187 `SECURITY DEFINER` functions with `search_path` configured.
- **Third-Party Marketplace:** Safely gated/disabled (`marketplace_launch_approvals` = 0 rows).
- **Online Payments:** Not wired (`app/api/webhooks/route.ts` is an architecture stub; COD/credit/manual collection flows exist).

---

## 3. GitHub and PR Status

- **Default Branch:** `main`
- **Latest Commit on `main`:** `ecf1731c6a91c34e6dd956e3f3526bf4503f08aa` (`Merge pull request #134 from mahakali108/arena/1c8f9eed-maharani-mart`)
- **PR #134 Status:** **MERGED** at `2026-11-16T09:11:00Z` into `main`. Title: *"Website content module: managed pages, native legal screens, audited migrations 0104/0105"*. Latest merged code is present in `main`.
- **Open PRs (7):**
  - `#107` — Draft: India compliance safety holds and production verification handoff
  - `#66` — fix(retailer): improve mobile catalog browsing and banners
  - `#45` — fix: retailer UI redesign and phone OTP login
  - `#42` — Retailer UI/UX redesign pass
  - `#31` — Maharani Traders pricing upgrade and SKU cleanup
  - `#21` — Android app: Capacitor wrapper (obsolete/superseded by native Android)
  - `#7` — Add Firebase Cloud Storage for images
- **CI / Workflows Status:**
  - `Web CI` (`43837455809` on `main`, `2026-11-16T09:11:03Z`): **FAILED** at step `Unit and integration tests`.
  - `Production health` (`43837455781` on `main`, `2026-11-16T09:11:03Z`): **SUCCESS**.
  - `Native Android Debug APK` (`43816902144` on PR #134): **SUCCESS**.
  - `Android artifact evidence` (`43819452742` on `main`): **SKIPPED**.
- **Duplicate/Conflicting Migrations:** None found by numeric prefix (`ls -1 supabase/migrations/ | sed 's/_.*//' | sort | uniq -d` returned empty).

---

## 4. Vercel and Website Status

- **Vercel Connector:** `Access denied` (token lacks required permissions/team scope). Deployment list, production commit SHA, preview deployments, environment variable names, and build/runtime logs are **NOT VERIFIED**.
- **Live Website (`https://maharanitraders.vercel.app`):** Direct HTTP probing from sandbox is blocked by outbound network policy (`NOT VERIFIED`). However, GitHub Actions `Production health` workflow (`43837455781`) passed on `main` at `2026-11-16T09:11:03Z`.
- **PWA & Config Verified in Repo:**
  - `app/manifest.ts` and `public/sw.js` exist.
  - `next.config.mjs` configures HTTP 308 permanent redirects from `/privacy`, `/terms`, `/shipping`, `/returns` to `/legal/<slug>` and allows `*.supabase.co` storage images.
  - `app/api/health/route.ts` (`force-dynamic`) checks Supabase `areas` table connectivity and returns 200/503/500 without leaking SQL details.
  - `app/api/webhooks/route.ts` uses `timingSafeEqual` on `x-webhook-secret` and is currently a Phase 2+ stub.

---

## 5. Supabase Status (`fhrmsrumsraprvutrpeo`)

- **Service Health:** All services (`auth`, `db`, `db_postgres_user`, `pooler`, `realtime`, `rest`, `storage`, `pg_bouncer`) report `ACTIVE_HEALTHY`.
- **PostgreSQL Version:** `PostgreSQL 17.11 on x86_64-pc-linux-gnu`.
- **Auth Configuration Issues:**
  - `site_url`: `http://localhost:3000` (**CRITICAL**: must be `https://maharanitraders.vercel.app`).
  - `uri_allow_list`: `""` (empty — auth redirects to production/preview URLs will fail).
  - `smtp_host`: `null` (using default Supabase mailer, capped at `rate_limit_email_sent: 2`/hour).
  - `external_phone_enabled`: `false` (Phone OTP login is disabled).
  - `security_captcha_enabled`: `false`.
  - `password_min_length`: `6`.
- **Storage Buckets (11):**
  - Public (5): `avatars`, `banners`, `brand-logos`, `category-images`, `product-images`.
  - Private (6): `banner-drafts`, `compliance-evidence`, `delivery-proofs`, `payment-proofs`, `retailer-documents`, `supplier-documents` (all with MIME-type and size restrictions).

---

## 6. Database and Migration Status

- **Live Applied Migrations:** `0001` through `0103_security_advisor_remediation` (`20261115155706`).
- **Pending Migrations (in `main` repo, NOT in live Supabase):**
  1. `0104_site_content_management.sql`
  2. `0105_seed_site_content.sql`
  3. `0106_first_super_admin_bootstrap.sql`
- **RLS & Security Posture:**
  - 110/110 `public` tables have `rowsecurity = true`.
  - 6/6 `public` views have `security_invoker = true`.
  - 187 `SECURITY DEFINER` functions all have explicit `search_path` (`public, pg_temp`, `public`, or `pg_catalog`).

---

## 7–9. Feature Matrices (Retailer, Seller, Super Admin)

| Module | Feature | UI Exists | Backend Exists | Tested | Status |
| --- | --- | --- | --- | --- | --- |
| **Auth** | Email/Password Login & Signup | Yes | Yes | Partial | PARTIAL (Auth `site_url` is localhost) |
| **Auth** | Phone OTP Login | Partial | No (`external_phone_enabled=false`) | No | BLOCKED |
| **Auth** | Super Admin Bootstrap | Yes | Migration `0106` pending | No | BLOCKED |
| **Retailer** | Dashboard, Home, Catalog, Search, Filters | Yes | Yes | CI Failing | PARTIAL |
| **Retailer** | Cart, Quick Order, Quantity Slabs, MOQ | Yes | Yes | CI Failing | PARTIAL |
| **Retailer** | Checkout, Addresses, Delivery PINs | Yes | Yes | CI Failing | PARTIAL |
| **Retailer** | Orders, History, Cancellation, Returns | Yes | Yes | CI Failing | PARTIAL |
| **Retailer** | Wallet, Loyalty Coins, Coupons, Schemes | Yes | Yes | CI Failing | PARTIAL |
| **Retailer** | Membership Plans (Free/Silver/Gold) | Yes | Yes (paid retired in `0083`) | CI Failing | PARTIAL |
| **Retailer** | Online Payments | No | No (stub only) | No | MISSING |
| **Seller** | Invite-only Registration & Approval | Yes | Yes | No | PARTIAL |
| **Seller** | Dashboard, Offers, Orders, Profile, Status | Yes | Yes | No | PARTIAL |
| **Seller** | Marketplace Live Trading | Gated | Gated (`0` approvals) | No | BLOCKED (Legal/Tax) |
| **Admin** | Dashboard, Command/Control Center | Yes | Yes | No | PARTIAL |
| **Admin** | Catalog, Products, Categories, Brands, Inventory | Yes | Yes | No | PARTIAL |
| **Admin** | Orders, Delivered, Returns, Collections, Wallets | Yes | Yes | No | PARTIAL |
| **Admin** | Retailers, Applications, Sellers, Suppliers, Team | Yes | Yes | No | PARTIAL |
| **Admin** | Website Content (`/admin/content`) | Yes | Migration `0104`/`0105` pending | No | BLOCKED |
| **Admin** | Compliance, Audit Logs, Reports, AI | Yes | Yes | No | PARTIAL |

---

## 10. Marketplace and Wholesale Status

- **Own-stock vs Marketplace:** Separated at schema level (`seller_offers`, `sub_orders`, `marketplace_launch_approvals`).
- **Marketplace Gate:** `third_party_offers_enabled` and `marketplace_launch_approvals` (0 rows) keep third-party seller trading **disabled** until legal/tax approvals are recorded.
- **Atomic RPCs:** `create_order_atomic_v2`, `atomic_split_order_cancellation` (`0097`), `atomic_delivery_completion` (`0099`), `atomic_dispatch_failure_and_return` (`0100`), `atomic_return_request_resolution` (`0101`) are present in live DB.

---

## 11. Payments, Wallet and Refunds

- **Online Payment Gateway:** Not integrated (`app/api/webhooks/route.ts` is a stub).
- **Wallet & Refund Integrity:** Hardened in migrations `0088`–`0092` (`refund_ledger_integrity`, `atomic_manual_wallet_reversal`, `refund_replay_and_child_share_guard`).
- **COD / Credit:** Supported in schema (`retailer_credit_accounts`, `payment_collections`).

---

## 12. Legal and Compliance Status (India — Bihar Proprietorship)

- **Business:** Ajay General (brand: Maharani Traders), Cosmetics & FMCG only (Food disabled).
- **Published Legal Docs in Live DB:** Only `seller-agreement` v1.0 (`published_by: null`).
- **Missing / Unverified:**
  - Privacy Policy, Terms & Conditions, Refund/Cancellation Policy, Shipping Policy not published in `legal_document_current_versions`.
  - GSTIN verification, Grievance Officer name/contact, HSN/GST invoice numbering, and CA/Advocate sign-off on TCS (Sec 52) / TDS (Sec 194-O) before enabling third-party sellers.

---

## 13. Security Findings

| Severity | Finding | Location / Evidence | Impact | Recommended Fix |
| --- | --- | --- | --- | --- |
| **CRITICAL** | Supabase `site_url` set to `http://localhost:3000` & empty `uri_allow_list` | Supabase Auth Config | Auth emails/redirects break in production | Set `site_url` to `https://maharanitraders.vercel.app` and configure `uri_allow_list` |
| **HIGH** | Default Supabase SMTP (`null`) with 2 emails/hr limit | Supabase Auth Config | Signup/reset emails will fail under any real traffic | Configure custom SMTP (Resend/SES/etc.) |
| **HIGH** | Web CI failing on `main` (`Unit and integration tests`) | GitHub Actions `43837455809` | Unverified regressions in `main` | Fix failing unit/integration tests |
| **MEDIUM** | `password_min_length = 6`, CAPTCHA disabled | Supabase Auth Config | Weak passwords & bot signup risk | Increase min length to 8+ and enable CAPTCHA |
| **INFO** | RLS, `security_invoker` views, `SECURITY DEFINER` `search_path` | Live Supabase DB | Properly hardened (110 tables, 6 views, 187 funcs) | Maintain via CI checks |

---

## 14. Android Status

- **Project:** Native Kotlin/Jetpack Compose app under `android/` (`AUDIT_ANDROID.md` confirms Capacitor wrapper was retired).
- **CI:** `Native Android Debug APK` passed on PR #134 (`43816902144`). `Android artifact evidence` was skipped on `main`.
- **Release Readiness:** Debug APK builds; release signing/keystore, Play Store listing, and physical-device QA are **NOT VERIFIED / NOT READY**.

---

## 15. Testing Results

- **Local Sandbox:** `node_modules` not installed; `pnpm` not in PATH. Local `vitest` / `tsc` / `eslint` could not run (`NOT VERIFIED` locally).
- **GitHub Actions (`main` @ `ecf1731`):**
  - `Web CI`: **FAILED** at `Unit and integration tests` (run `43837455809`).
  - `Production health`: **PASSED** (run `43837455781`).
  - `Native Android Debug APK`: **PASSED** on PR #134 (`43816902144`).

---

## 16–20. Blockers, Owner Actions & Next Plan

### Production Blockers
1. **Pending SQL Migrations (`0104`, `0105`, `0106`)** not applied to live Supabase `fhrmsrumsraprvutrpeo`.
2. **Web CI failing** on `main` (`Unit and integration tests`).
3. **Supabase Auth `site_url`** is `http://localhost:3000` and no custom SMTP is configured.
4. **Zero live data** (no Super Admin user, no products, no delivery areas seeded).
5. **Legal documents** (Privacy, Terms, Returns, Shipping) not published in `legal_document_current_versions`.
6. **Vercel deployment & env vars** unverified due to connector permission error.

### Owner-Only Actions
- Provide verified GSTIN, Grievance Officer details, and CA/Advocate sign-off.
- Configure custom SMTP & production `site_url` in Supabase Auth.
- Bootstrap first Super Admin account after applying `0106`.
- Grant Vercel token scope if automated Vercel auditing is needed.

### Prioritized Next Development Plan
1. Fix failing `Unit and integration tests` in `Web CI` on `main`.
2. Apply migrations `0104`, `0105`, `0106` to `fhrmsrumsraprvutrpeo`.
3. Update Supabase Auth (`site_url`, `uri_allow_list`, custom SMTP, password policy).
4. Bootstrap Super Admin, seed initial Cosmetics/FMCG catalog & Gaya/Bihar delivery PINs.
5. Publish legal documents via `/admin/content` & `/admin/compliance`.
6. Verify Vercel production deployment & run end-to-end smoke tests.
