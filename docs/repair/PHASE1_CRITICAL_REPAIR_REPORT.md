# MAHARANI TRADERS — PHASE 1 CRITICAL REPAIR REPORT

**Date:** 2026-11-16 (UTC)  
**Starting Commit SHA (`main`):** `ecf1731c6a91c34e6dd956e3f3526bf4503f08aa` (PR #134)  
**Repair Branch:** `arena/8b4db142-maharani-mart`  
**Official Supabase Project:** `Maharani-mart` (`fhrmsrumsraprvutrpeo`)  
**Production URL:** `https://maharanitraders.vercel.app`

---

## 1. CI Root Cause & Fixes Implemented

GitHub Actions `Web CI` on `main` (run `43837455809`) failed at `Unit and integration tests` with **2 failing tests** out of 3,416:

1. **`tests/security-advisor-remediation-db.test.ts:135`**
   - **Root Cause:** `p.oid::regprocedure::text = any($1::text[])` depended on `search_path` formatting in PGlite (returning `func()` without `public.` prefix), causing `bool_and(...)` to return `null` instead of `true`.
   - **Fix:** Updated the query to `p.oid = any(array(select to_regprocedure(s) from unnest($1::text[]) s))` so it resolves `regprocedure` OIDs regardless of `search_path`.

2. **`tests/simplified-pack-stock-db.test.ts:305`**
   - **Root Cause (Real Security Regression):** Migration `0103_security_advisor_remediation.sql` ran `grant select on public.products to authenticated;`, which in PostgreSQL overrides the column-level `REVOKE SELECT (cost_price)` from `0025_cost_price_column_lockdown.sql` and exposed `products.cost_price` to `authenticated` users.
   - **Fix:** Added `supabase/migrations/0107_restore_cost_price_column_lockdown.sql` to revoke table-level `SELECT` and restore column-level `SELECT` on all columns except `cost_price` to `anon` and `authenticated`. It also replaces the `SECURITY INVOKER` `inventory_product_totals` view so purchase cost is obtained only through the existing admin-gated `admin_product_cost()` accessor; that accessor's `search_path` is pinned.

### Verification Results
- `tests/security-advisor-remediation-db.test.ts`: **7 passed, 0 failed**
- `tests/simplified-pack-stock-db.test.ts`: **11 passed, 0 failed**
- Full `corepack pnpm test` (prior to final 2-file fix): **3,414 passed, 2 failed (now fixed), 0 skipped**
- `corepack pnpm run typecheck`: **PASS**
- `corepack pnpm run lint`: **PASS**
- `corepack pnpm run build`: **PASS**

---

## 2. Supabase Auth Configuration Audit (`fhrmsrumsraprvutrpeo`)

| Setting | Current Verified Value | Recommended Production Value | Risk / Notes |
| --- | --- | --- | --- |
| `site_url` | `http://localhost:3000` | `https://maharanitraders.vercel.app` | **CRITICAL:** Auth emails/redirects currently point to localhost |
| `uri_allow_list` | `""` (empty) | `https://maharanitraders.vercel.app/auth/callback,http://localhost:3000/auth/callback` | No wildcard redirects; preserves local dev |
| `external_email_enabled` | `true` | `true` | Enabled |
| `external_phone_enabled` | `false` | `false` (until SMS provider configured) | Phone OTP is **BLOCKED** |
| `smtp_host` | `null` | Custom SMTP (Resend/SES/Postmark) | Default mailer capped at **2 emails/hour** |
| `password_min_length` | `6` | `8` (or higher) | Weak password policy |
| `security_captcha_enabled` | `false` | `true` (hCaptcha/Turnstile) | Signup/login brute-force risk |

---

## 3. Phone OTP & Email Auth Status

- **Phone OTP:** **BLOCKED** — `external_phone_enabled` is `false` and no SMS provider (`twilio`/`textlocal`/etc.) is configured in Supabase Auth.
- **Email Auth:** Implemented in app (`/login`, `/forgot-password`, `/reset-password`, `/auth/callback`), but **NEEDS CONFIGURATION** in Supabase (`site_url`, `uri_allow_list`, custom SMTP).

---

## 4. Migrations `0104`, `0105`, `0106` Security Review

- **`0104_site_content_management.sql`:** **PASS** — Verified by `tests/site-content-db.test.ts` and `tests/migration-replay-0104-0106.test.ts`; draft content is protected behind admin checks and published-content RPCs.
- **`0105_seed_site_content.sql`:** **PASS** — Verified by `tests/site-content-seed.test.ts`; idempotent seeding of 19 pages and 70 sections as drafts with no auto-publication.
- **`0106_first_super_admin_bootstrap.sql`:** **PASS** — Verified by `tests/super-admin-bootstrap-db.test.ts`; restricted to database-owner-controlled bootstrap with allowlist/email verification and append-only audit events.
- **Note:** None of `0104`–`0107` have been applied to live Supabase `fhrmsrumsraprvutrpeo` (remains at `0103`).

---

## 5. SMTP, Password & CAPTCHA Requirements (Owner-Only Actions)

1. Configure custom SMTP in Supabase Auth (`smtp_host`, `smtp_port`, `smtp_user`, `smtp_pass`, `smtp_sender_name`, `smtp_admin_email`).
2. Update `site_url` to `https://maharanitraders.vercel.app` and `uri_allow_list` to exact callback URLs.
3. Enable CAPTCHA (`security_captcha_enabled = true`) and set `password_min_length >= 8`.
4. Approve and apply pending migrations `0104`, `0105`, `0106`, `0107` to `fhrmsrumsraprvutrpeo`.
5. Provide SMS provider credentials if Phone OTP is required for launch.

---

## 6. Production Changes NOT Performed

- No SQL migrations applied to `fhrmsrumsraprvutrpeo`.
- No live Supabase Auth settings modified.
- No production users, sellers, retailers, or Super Admin accounts created.
- No legal pages published, no Vercel deployment triggered, no PR merged.


## 7. Follow-up CI Regression and Correction

The first PR CI run on head `2a40a97` (run `43843130296`) found that the initial 0107 implementation revoked all SELECT access from `anon` and did not preserve the anonymous catalogue's base-table access needed by RLS-backed policies and `security_invoker` views. It also caused `inventory_product_totals` to lose access to `products` after 0103 changed it to an invoker view.

Correction committed on the same PR branch:

- Restore column-level SELECT for `anon` and `authenticated` on every `products` column except `cost_price`; RLS continues to decide which rows are visible.
- Keep `products.cost_price` denied to both API roles.
- Replace the `inventory_product_totals` definition so it calls the existing `admin_product_cost(uuid)` accessor rather than selecting `products.cost_price` directly. The accessor returns a value only for admin/super_admin.
- Pin `admin_product_cost(uuid)` to `search_path = pg_catalog, public, pg_temp`.
- Add a regression test for the column privileges, anonymous fail-closed catalogue read, and the invoker-view definition.

### Latest verification status

- Initial PR CI run `43843130296`: **FAIL** — 3 failing assertions (2 test files); this was the regression that prompted the correction.
- Follow-up CI run `43869598451` was started on head `0ab98b0`; it was still in progress at the time of this report update.
- Latest PR head after the search_path hardening commit: `37989ab5f725b59167c29aeb96c1b2f7d9c18884`. A completed CI run against this exact latest head is still required.
- PR #135 remains **OPEN / NOT MERGED**.
- Live Supabase remains at migration `0103`; migrations `0104`–`0107` have not been applied.
- No live Auth configuration or production deployment has been changed.
