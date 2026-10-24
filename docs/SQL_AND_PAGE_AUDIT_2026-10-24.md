# SQL, migration and page audit — 2026-10-24

**Project in scope:** `fhrmsrumsraprvutrpeo` (Maharani-mart). The legacy project
`gbxhmffsbsfhdrfuwurx` / `maharanimaa` was not referenced, read or modified.

**Status of this document:** repository-only analysis plus executed evidence
from a disposable PostgreSQL 16 engine. **No production database, storage
bucket, secret, deployment or PR was touched.** Where a conclusion depends on
production state that this environment cannot read, it is labelled
`UNVERIFIED` and the missing evidence is named.

---

## 0. What this session could and could not see

| Capability | Available? | Consequence |
| --- | --- | --- |
| Repository read/write (this branch) | yes | full migration, page and test audit |
| `git` / `gh` (GitHub API read) | yes | PR ownership, branch state |
| Node 22 + pnpm 9.15.9 + installed deps | yes | typecheck, lint, 2 590 tests, `next build` |
| PGlite = **PostgreSQL 16 (WASM)** | yes | every migration applied and queried |
| Supabase CLI / access token / linked project | **no** | `supabase_migrations.schema_migrations` unreadable |
| Postgres connection string / service-role key | **no** (no `.env.local`) | no catalog read of the official project |
| Network to `*.supabase.co` | **no** (blocked) | cannot probe REST/Storage |
| Vercel project settings / env vars | **no** | cannot confirm which ref Preview/Production use |
| Storage object listings | **no** | banner object inventory is unverified |

Everything below that says "applied" means "applies cleanly, in order, to a
fresh PostgreSQL 16 database". It never means "applied to production".

---

## 1. Method (reproducible)

1. Enumerated all 75 files in `supabase/migrations`, 14 rollbacks, two audit
   scripts and `supabase/smoke-test.sql`; read the migration headers, the
   platform-facing SQL and the 0074/0077 review documents.
2. Stubbed the Supabase platform surface the migrations expect (`auth.users`,
   `auth.uid()`, `storage.buckets/objects`, `anon/authenticated/service_role`,
   Supabase's default privileges) and **applied every migration in filename
   order** to PGlite/PostgreSQL 16.
   - Result: **75/75 applied, 0 failures.**
3. Queried the resulting catalog for: RLS coverage, every policy, every
   `SECURITY DEFINER` function and its `search_path`, `EXECUTE` grants per API
   role, guard presence in function bodies, storage buckets and object
   policies, duplicate indexes, foreign keys, indexes on FK children.
4. Re-applied the **entire set a second time** on the same database to measure
   idempotency (the "partially applied, can I retry?" scenario).
5. Cross-checked application code against the schema: every `.from('table')`
   and `.rpc('fn')` in `app/`, `lib/`, `components/`.
6. Built the route inventory from the file tree, checked internal links,
   role gates per page/layout, and compared `middleware.ts` /
   `lib/auth/roles.ts` / layouts / page guards.
7. Executed the repo's own verification: typecheck, ESLint, Vitest (2 590
   tests) and a production `next build`, before and after the changes below.

Commands are listed in §8.

---

## 2. Migration inventory (all 75 files)

Legend — **Replay**: applies cleanly in order on PostgreSQL 16.
**Re-runnable**: a second application of that same file succeeds.
**Production status**: see §3 for why almost everything is `Unverified`.

| # | Migration | Purpose (from file header) | Replay | Re-runnable | Production status | Action |
| --- | --- | --- | :-: | :-: | --- | --- |
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

Also inspected, not migrations:

| File | Purpose | Verdict |
| --- | --- | --- |
| `supabase/audits/phase0_privileged_accounts_readonly.sql` | read-only privileged-account review (SEC-1/2/5/8), runs in a rolled-back READ ONLY transaction | correct: no writes, no demotions; **not run here** (needs project access) |
| `supabase/smoke-test.sql` | live RLS/role/trigger smoke test; writes fixtures inside one transaction and rolls back | **not run** — it writes; README forbids it against production |
| `supabase/rollbacks/*.sql` (14) | one down-migration per modern migration | 0074 and 0077 reviewed in detail; 0078 added in this branch |

### 2.1 Numbering

* **0061 is missing.** `0062_seller_identity.sql` line 177 still refers to a
  "0054/0061 allowlist convention", so 0061 was planned and never committed.
  Nothing depends on it; do not invent it.
* **0075 / 0076 are deliberately absent** (holding 0075 for the on-hold
  retention archive and 0076 for the deferred banner `alt_text`). This branch
  therefore uses **0078**, not 0075/0076.
* **Numbering collision risk (open PR):** PR #107 adds
  `supabase/migrations/0059_india_compliance_safety.sql`. `0059` is already
  `0059_supplier_applications.sql` on `main`. If #107 is ever merged it must be
  renumbered (0079+) before application — two files cannot share a version.
  This session did **not** touch #107's files.

---

## 3. Applied / unapplied / partial / unverified

### 3.1 Status of the official project — `UNVERIFIED (category 5)`

I cannot assert the production migration history. The exact evidence missing:

| Missing evidence | Why it matters | How the owner obtains it |
| --- | --- | --- |
| `select version, name, inserted_at from supabase_migrations.schema_migrations order by version desc` | proves which versions the runner actually executed | query 1 of `supabase/audits/migration_and_security_verification_readonly.sql` |
| `information_schema.columns` for `public.banners` | proves 0074's columns/constraint/index/policies really exist | queries 3–4 |
| `pg_policies` / `pg_proc` snapshots | proves 0052/0057/0074/0078 posture | queries 5–8 |
| the `NEXT_PUBLIC_SUPABASE_URL` the deployed app actually uses | proves the target is `fhrmsrumsraprvutrpeo` and not a staging ref | Vercel → Project → Settings → Environment Variables |
| a verified backup/restore rehearsal | makes any future destructive step survivable | dashboard → Database → Backups |

The repository already states in `README.md` that **0070–0073 are unverified
remotely** and that 0074 is repo-only. Nothing in this session contradicts
that; nothing confirms it either. Treat the project's true version as unknown
until query 1 is attached.

### 3.2 Per-category verdicts

| Category | Files | Basis |
| --- | --- | --- |
| **1. Applied and verified** | **none** | verification requires the production catalog, which is unreachable |
| **2. Not applied (per repository documentation)** | `0074`, `0077` | their own headers and `docs/MIGRATION_APPLICATION_EVIDENCE.md` state they have never been applied; `0078` (new here) has never been applied anywhere |
| **3. Partially applied or schema drift** | **cannot be excluded** — specifically `0073` (see 4-S4) and any migration whose history row exists without its effects. Not detectable without query 1–4 | PGlite shows what *should* exist, not what does |
| **4. Conflicting, duplicated or unsafe** | `0055` (armed retention engine — S1), `0073` (not re-runnable — S4), `0001`–`0024` + `0073` (16 non-idempotent files — S9), `0059` (number collision with PR #107), `0061` (dangling reference), `0077` (unapproved bucket/columns) | executed second-pass test, header review, PR file lists |
| **5. Unable to verify** | the other 71 files | no production access — see §3.1 |

**No migration was marked "applied" because a file exists or because a
document claims it.** None is marked applied at all.

---

## 4. Root causes, ranked

### S1 — CRITICAL (data loss): the on-hold 120-day deletion engine is armed

* `0055_data_retention_cleanup.sql` seeds `data_retention_rules` with
  `enabled = true` for `orders` (120 d, cascade to items/status
  history/deliveries/coupon redemptions), `retailer_wallet_ledger` (coins /
  credit history), `payment_collections`, `return_requests`,
  `order_stock_allocations`, `stock_movements`.
* `run_data_cleanup(false, 'cron', …)` is service-role only and
  **`vercel.json` schedules it daily at 02:00 UTC** via
  `GET /api/cron/cleanup` (bearer `CRON_SECRET`).
* Consequence: if 0055 is applied and `CRON_SECRET` is set on the Vercel
  project, financial and order history older than 120 days is being deleted
  **now**, while the requirement says that window is on hold pending legal and
  accountant review.
* **Not changed by this session** — the instruction is explicit, and the files
  are owned by open PR #107. This is an owner decision:
  `vercel.json` cron removal or unsetting `CRON_SECRET` is the fail-safe stop;
  setting `enabled = false` for the `business_120` rows is the finer control.
  Both are production writes and need approval.

### S2 — HIGH: `main` already requires the unapplied migration 0074

* `lib/retailer/home-data.ts:173` and `lib/mobile/catalog-service.ts:512` both
  filter `.eq('status','published')` on `banners`.
* `app/admin/banners/page.tsx` selects `status, image_url_mobile`;
  `app/admin/banners/[id]/page.tsx` selects `*`; banner server actions
  **write** `status` and `image_url_mobile` (`lib/admin/banners-actions.ts`).
* If the project is at 0073, every one of those reads fails with PostgreSQL
  `42703` (`column does not exist`) and banner create/update fails outright.
  Retailer home degrades silently (its banner slot just disappears — it
  already tracks `errors.banners`); the admin list previously rendered
  *"No banners yet"*, which is indistinguishable from a working empty table.
* **Fixed in this branch (UI honesty only):** the admin banner page now shows
  an explicit "Banners could not be loaded" notice with the error text and a
  pointer to migration 0074, and no longer renders the empty state after a
  failed query. The schema itself is untouched.

### S3 — HIGH: two unguarded `SECURITY DEFINER` RPCs were callable by API roles

Measured on the full migration set (all functions returned by
`pg_proc` where `prosecdef`, not a trigger, granted to an API role, and whose
body contains **no** caller check):

| Function | Reachable by | What it exposed | Status |
| --- | --- | --- | --- |
| `fefo_plan_for_product(uuid, uuid, int)` | `anon` | per-warehouse batch IDs and available quantities for any product — inventory disclosure to a caller holding only the publishable key | **revoked in 0078** (owner approval pending) |
| `current_offer_floor_paise(uuid)` | `authenticated` | the confidential seller price floor of any pack id to any signed-in account | **revoked in 0078** (owner approval pending) |

Neither is called by any page, action, RLS policy or test; both are only used
from inside `SECURITY DEFINER` bodies (0017, 0063, 0065, 0069), which run as
the function owner and keep `EXECUTE`. `handle_new_user()` (a trigger
function, so it needs no `EXECUTE` grant) was also revoked as defence in depth.

Everything else that looked unguarded at first pass was checked by hand and is
safe: the wallet helpers call `_can_access_retailer_wallet`, coupon redemption
calls `_can_use_coupon_for_retailer`, `admin_pack_cost` returns `null` unless
`is_admin_or_above()`, `adjust_product_stock` calls `require_inventory_role()`,
and `can_current_staff_read_profile` is a boolean predicate evaluated *inside*
the `profiles` policy (revoking it would break staff policy evaluation).

### S4 — MEDIUM: 0073 is not re-runnable (retry hazard)

`0073_configured_delivery_pins.sql` uses bare `create policy` (×3) and
`create trigger` with no `if not exists` guard. A partially applied 0073 —
the classic "policy created, later statement failed" state — cannot be
retried: the retry dies on `policy "delivery_pins_admin_read" …
already exists`. Every other modern migration (0058–0072, 0074, 0077, 0078)
is re-runnable, so 0073 is the outlier. Remote state of 0073 is `UNVERIFIED`.
Do not "fix" it by editing the applied file; if a retry is ever needed, wrap
the three policies in `drop policy if exists` first, in a new forward
migration, with owner approval.

### S5 — MEDIUM: 35 admin pages had no defence-in-depth role gate

`middleware.ts` restricts `/admin/*` to `admin`/`super_admin`, but the admin
**layout** only called `requireUser()` — "somebody is signed in", not "this
somebody is an admin". 35 admin pages call no page-level guard of their own
(list in §5). RLS still protects the rows, so this was not an open door, but it
contradicted the layout's own comment and the pattern already used by the
staff and salesman layouts. **Fixed:** `app/admin/layout.tsx` now enforces
`isRoleAllowedForPath(user.role, '/admin')` and redirects to `/unauthorized`.

### S6 — MEDIUM: Storage was looser than the table for banner artwork

`staff_write_banners` / `staff_update_banners` (0003) grant Storage
insert/update to **staff**, while 0074 confines the `banners` **table** write
policy to `is_admin_or_above()` to match the application permission
`banners.manage` (admin + super_admin). A staff session could overwrite banner
artwork it is not allowed to reference from a row. **Prepared in 0078**
(policy names preserved so the replacement is a clean drop/create).

### S7 — MEDIUM: staff role is granted at signup, before email confirmation

`handle_new_user()` consumes a `staff_account_invites` row for the email and
assigns the staff/salesman role at `auth.users` insert time. It does not look
at `email_confirmed_at`. Safety therefore rests on GoTrue's **"Confirm email"**
setting: with it off, whoever signs up with an invited colleague's address
receives that role. Seller invitations are not affected (they require a
high-entropy nonce, 0072).
**Owner check:** Supabase → Authentication → Providers → Email → *Confirm
email* must be ON for the official project (cannot be read from here).

### S8 — HIGH (process): production schema status is unknown

Covered in §3.1. The single most useful next action is running the read-only
verification script and attaching its output.

### S9 — LOW: 16 of 75 migrations fail a second application

`0001, 0003, 0004, 0005, 0006, 0007, 0008, 0009, 0010, 0013, 0016, 0018,
0020, 0022, 0024, 0073` (see the table). All but 0073 are historical and were
never intended to be re-run; recording them matters because a "just replay every
file" recovery would fail. Correct recovery is: apply only versions missing
from `schema_migrations`.

### S10 — LOW: `is_phone_registered(text)` is anon-callable by design

It lets the public registration form pre-check a phone number, so anyone can
enumerate whether a phone is registered. 0057 recorded the open decision
(per-IP rate limiting) and this audit agrees; it is *not* changed here.

### S11 — INFO: findings that are **not** defects

* All 89 `public` tables have RLS enabled. There is no `DISABLE ROW LEVEL
  SECURITY` anywhere.
* 106 `SECURITY DEFINER` functions, **0** without a pinned `search_path`.
* 0 duplicate index definitions; 206 foreign keys.
* Three tables are intentionally policy-less (deny-all, service-role only):
  `cleanup_runs`, `data_retention_rules`, `supplier_application_rate_limits`.
  The admin retention page reads them through the service client after a
  permission check, which is correct.
* 33 write policies omit an explicit `WITH CHECK`. For `UPDATE`/`ALL`,
  PostgreSQL falls back to the `USING` expression, so these are **not** a
  widening — verified in the catalog, not assumed.
* Privilege escalation is blocked, and this was proven by execution: an
  *active* retailer calling `update profiles set role='super_admin'` gets
  `42501 Only a Super Admin can change an account role or active status.`
  (`trg_guard_profile_privileged_columns`); the same call for `is_active` is
  blocked; `full_name` on their own row is allowed. An unapproved retailer
  cannot even reach that point (`active_account_update` restrictive policy).
* The `banner-drafts` bucket (0077) does **not** exist in the analysed state
  because 0077 is unapplied; nothing in the app references
  `draft_image_path` / `draft_image_mobile_path`, and
  `types/database.types.ts` has no such columns — 0077's storage half is
  implemented (`lib/admin/banner-artwork.ts`, `lib/media`) but **no page or
  action calls it**, so applying 0077 alone would activate nothing.

---

## 5. Page and route audit

**Inventory (derived from the tree, not invented):** 151 pages, 69 route
handlers, 6 layouts, 16 `loading.tsx` (root + 15 segment boundaries),
8 `error.tsx` (4 shell-level + 4 segment boundaries) and 1 root
`not-found.tsx`.

| Group | Pages | Notes |
| --- | --- | --- |
| Public | `/` (redirect), `/login`, `/register-retailer`, `/register-seller`, `/register-supplier`, `/forgot-password`, `/reset-password`, `/about`, `/contact`, `/legal` + 4 legal pages, `/unauthorized`, `/access-expired`, `/pending-approval` | all render; supplier application is the only public write path and is rate-limited server-side |
| Admin / Super Admin | 62 pages (dashboard, orders, products, catalog, inventory ×11, sellers, suppliers, banners, coupons, wallets, team, targets, commissions, routes, areas, warehouses, deliveries, support, reports, notifications, audit logs, control-center ×2, cleanup, ai, attendance, visits, follow-ups, returns, pricing, delivered, collections, offers) | guard now enforced twice (middleware + layout); control-center additionally requires Super Admin |
| Retailer | 39 pages (home, catalog, product, categories, brands, search, cart, saved carts, checkout, orders + invoice/delivery/reorder, coupons, schemes, favorites, quick-order, reports, support, account ×6, notifications, ai, help) | layout blocks non-retailers and pending/suspended accounts before any query |
| Seller | 6 pages (`/seller`, dashboard, offers, orders, profile, status) | `requireSellerPage` + membership check in middleware; inactive sellers are pinned to `/seller/status` |
| Staff | 9 pages | layout enforces `isRoleAllowedForPath` |
| Salesman | 18 pages | layout enforces the same |
| Mobile API | 69 handlers under `/api/mobile/v1` (+ `/api/ai/*`, `/api/cron/cleanup`, `/api/health`, `/api/webhooks`, storage report) | all RPCs and tables they call exist in the migration set |

**Automated results**

* **0** tables or views referenced by `app/`+`lib/`+`components/` are missing
  from the migration set; **0** `.rpc()` targets are missing.
* **0** broken internal links across all 243 static `href="/…"` literals in `app/`, `components/`
  and `lib/` (dynamic/hrefs built from variables are out of scope for this check).
* **0** protected pages are reachable without *some* guard: each is covered by
  a role-checking layout or a page-level `require*()`.
* `middleware.ts` dead code: `isPublicPath()` and `PUBLIC_PATHS` are never
  used, and `PUBLIC_PATHS` omits `/register-supplier`, `/forgot-password`,
  `/legal/*` (harmless today because those prefixes are not protected).
  Reported, not changed — it is cosmetic and touches the auth path.
* No page-level errors, broken imports, `'use client'`-imports-server
  violations or secret exposure: typecheck, lint and `next build` are clean,
  and no client component imports a server client or the service-role key
  (`lib/admin/seller-actions.ts` is `'use server'`; `lib/delivery/otp.ts` is
  pure Node imported only from server modules — both would benefit from an
  explicit `import 'server-only'`, noted only).
* Route/UI state coverage: root + admin + retailer + salesman have
  `error.tsx`/`loading.tsx`; seller and staff inherit the root boundaries;
  `not-found.tsx` exists at the root. No route silently fabricates data — the
  empty states are real empty states, with the banner exception fixed in §4 S2.
* `/admin/banners` also lacked the `requirePermission('banners.manage')` that
  its sibling detail page has; the layout fix now covers it, and the form
  remains the only writer.

**Unavailable / not inspected here:** any behaviour that needs the live
project — real Supabase queries against real RLS, storage URLs, email flows,
OTP, Vercel runtime env and the actual banner objects. Read-only probes were
not possible (§0).

---

## 6. Banner & storage safeguards — what was and was not done

* **No object was listed, moved, copied, renamed or deleted.** Object
  inventory is `UNVERIFIED`; query 9 of the verification script returns counts
  only.
* Existing `banners` bucket is **public** (`public = true`) and its four
  policies are unchanged except the two staff-write policies narrowed in 0078.
  A public bucket is served by URL, so "unpublished banner" ≠ "private file" —
  that is exactly why 0077 proposed a private bucket, and why 0077 stays
  unapproved.
* `banner-drafts` bucket, `draft_image_path` and `draft_image_mobile_path`
  remain **unapproved and unapplied**. 0078 does not touch them.
* Copy-on-publish (`lib/admin/banner-artwork.ts`) was reviewed, not executed:
  it copies first and persists second, keeps the object path so a retry
  converges, and refuses to adopt a destination whose size/MIME differs from
  the source. It is not wired into any page or action, so no publish flow can
  currently depend on it.
* No signed URL is persisted; `lib/storage/signed-url.ts` mints them per
  render with a 15-minute TTL for draft previews.
* Pinned SDK: `@supabase/supabase-js` in `package.json` is `^2.45.4`; the
  lockfile resolves **2.110.7**. `storage.from(b).copy()` exists in both, but
  copy behaviour was **not** exercised against a real bucket.

---

## 7. Remediation plan and migration order

### 7.1 Done in this branch (narrow, verified, reversible)

| File | Change | Why |
| --- | --- | --- |
| `app/admin/layout.tsx` | added `isRoleAllowedForPath(user.role, '/admin')` + `/unauthorized` redirect | closes S5 for all 35 pages at once, same pattern as the staff/salesman layouts |
| `app/admin/banners/page.tsx` | capture the query error; render an explicit failure notice and suppress the empty state when the read failed | S2 — a broken query no longer looks like "no banners" |
| `supabase/migrations/0078_privilege_hardening.sql` | **new, forward-only, not applied**: revoke `EXECUTE` on `fefo_plan_for_product`, `current_offer_floor_paise`, `handle_new_user` from API roles; align the two banner storage write policies with `banners.manage` | S3, S6 |
| `supabase/rollbacks/0078_privilege_hardening.sql` | restore the exact pre-0078 grants and 0003 policies | reversible on staging |
| `supabase/audits/migration_and_security_verification_readonly.sql` | 10 read-only query blocks: history, numbering, 0074/0077 effects, grant posture, banner storage, RLS coverage, definer hygiene, COUNT-only object inventory, retention registry | produces the missing §3.1 evidence without writing anything |
| `tests/admin-layout-guard.test.ts` | 7 cases: admin/super_admin render, retailer/staff/salesman/seller redirect, guard propagation | pins the new layout gate |
| `tests/privilege-hardening-db.test.ts` | 11 cases executed on PostgreSQL 16: grants after 0078, owner/service_role still work, storage policy expressions, idempotency, rollback | proves the SQL, not the text |
| `docs/SQL_AND_PAGE_AUDIT_2026-10-24.md` | this report | deliverables A–E |

No historical migration was edited, renumbered or re-run. No table, column,
row, bucket, object or policy was dropped. RLS was never disabled.

### 7.2 Proposed order for the owner

1. **Freeze first (approval required).** Stop the armed retention engine:
   remove the `crons` entry from `vercel.json` **or** unset `CRON_SECRET`, and
   set `data_retention_rules.enabled = false` for `category = 'business_120'`.
   This is the only item that can destroy data while the review is pending.
2. **Produce evidence.** Run
   `supabase/audits/migration_and_security_verification_readonly.sql` against
   `fhrmsrumsraprvutrpeo`; attach queries 1–10. Confirm the deployed
   `NEXT_PUBLIC_SUPABASE_URL` is that ref and that Preview ≠ Production.
3. **Reconcile history.** Apply only versions missing from
   `schema_migrations`. If `0073` is half-applied, use the guarded retry from
   §4 S4 — never a blind replay of every file.
4. **0074 decision.** It is required by code already on `main` (S2). Staging
   rehearsal → `banners` snapshot → apply → verify `anon` cannot read a draft,
   staff cannot write, admin can publish, storefront + `/api/mobile/v1/home`
   agree → exercise the rollback → re-apply.
5. **0078 decision.** Independent of 0074 (it never references banner
   columns). Verify with the checks in the file's footer, then apply.
6. **0077** stays on hold until its owner review and until a publish flow
   actually uses the columns; applying it now would create an unused private
   bucket.
7. **0055 / 0075** remain on hold until the legal/accountant review closes.
8. **PR #107 (if it proceeds)** must renumber its `0059` file to 0079+ and
   rebase; it also owns `vercel.json`-adjacent retention files, so step 1 must
   be coordinated with that PR rather than applied twice.

---

## 8. Tests — run, passed, failed, not run

All commands were executed in this workspace on this branch.

| Check | Command | Result |
| --- | --- | --- |
| Type check (baseline) | `corepack pnpm run typecheck` | **pass** (exit 0) |
| Lint (baseline) | `corepack pnpm run lint` | **pass** — "No ESLint warnings or errors" |
| Full test suite (baseline) | `corepack pnpm run test` | **pass** — 144 files, 2 572 tests |
| Production build (baseline) | `pnpm run build` with placeholder Supabase env | **pass** — all 151 pages + 69 handlers compiled |
| Migrations, first application | PGlite PG16, all files in order | **pass** — 74/74 before this branch, 75/75 after |
| Migrations, second application | same DB, whole set again | **16 files fail on re-entry** (S9), all historical except 0073; 0078 does not |
| Catalog audit | `pg_policies` / `pg_proc` / `pg_index` / grants | 89 tables all RLS-on; 476 policies (444 public + 32 on `storage.objects`); 106 definer functions, 0 without `search_path`; 0 duplicate indexes |
| RPC/table cross-check | every `.from()` / `.rpc()` vs catalog | 0 missing |
| Link check | every `href="/…"` vs route tree | 0 broken (211 checked) |
| Type check (post-change) | `corepack pnpm run typecheck` | **pass** (exit 0) |
| Lint (post-change) | `corepack pnpm run lint` | **pass** |
| Full test suite (post-change) | `corepack pnpm run test` | **pass** — 146 files, 2 590 tests (+2 files / +18 cases vs baseline, ~1.3 s longer) |
| New tests only | `vitest run tests/privilege-hardening-db.test.ts tests/admin-layout-guard.test.ts` | **pass** — 18/18 |
| Production build (post-change) | `pnpm run build` | **pass** |
| SQL lint / static check | — | **not run: no tool** (no `sqlfluff`/`pg_format` in the repo or the sandbox) |
| Migration verification against real Supabase | — | **not run: no access** (see §0) |
| RLS / role tests against real PostgREST | — | **not run: no access**; PGlite role tests are the closest substitute and are honest about their limits (single connection, stubbed `auth`/`storage`) |
| Android build / device tests | — | **not run** — out of scope for this PWA repair |

**No existing failure was introduced:** the baseline was green and the
post-change run is green with only additive test files.

---

## 9. Remaining blockers

1. **Retention is armed in production-facing config** (S1). Until the owner
   disables it, 120-day deletion may be running. Nothing in this branch
   changes retention.
2. **Production schema state is unknown** (S8) — the whole status table is
   `Unverified` until the verification script is run.
3. **The app requires an unapplied migration** (S2, 0074). This is a
   deploy-order problem: `main` is only safe against a database that has 0074.
4. **0078 needs approval** before it can close S3/S6.
5. **Auth "Confirm email" setting** (S7) must be confirmed; it cannot be read
   from here.
6. **PR #42 / #45 / #66** remain open and conflicting; this session did not
   touch, merge, rebase or close them, nor any file they own. The banner
   components they own (`promo-banner.tsx`, `promo-carousel.tsx`,
   `lib/retailer/home-data.ts`, `tests/retailer-home-ui.test.tsx`) were read
   only.
7. **PR #107** owns retention files (`vercel.json` adjacent, `0055`-related
   code, `lib/retention/*`, `app/api/cron/cleanup`, `app/admin/cleanup`,
   `docs/retention-policy.md`, `tests/data-retention-cleanup.test.ts`, and its
   colliding `0059`). None of them was modified here.

---

## 10. Exact manual steps requiring owner approval

1. Disable/neutralise the scheduled cleanup (delete the cron entry or unset
   `CRON_SECRET`; optionally `update data_retention_rules set enabled = false
   where category = 'business_120'`). **Production write.**
2. Run the read-only verification script against `fhrmsrumsraprvutrpeo` and
   attach queries 1–10.
3. Confirm Vercel Preview and Production resolve to the same project ref (if
   they do, no write test may run against Preview).
4. Take a `banners` snapshot and record `pg_policies` for `banners` before
   applying 0074; rehearse on staging, including the rollback, then re-apply.
5. Apply `0074_banner_lifecycle_and_variants.sql` **only after** step 4 —
   the web app already depends on it.
6. Apply `0078_privilege_hardening.sql` after its footer checks pass on
   staging; keep `supabase/rollbacks/0078_privilege_hardening.sql` ready.
7. Keep `0077` unapplied and the 120-day retention (0055/0075) on hold.
8. Confirm Supabase Auth → Email → *Confirm email* is ON, or accept the
   staff-invite risk in S7.
9. Regenerate `types/database.types.ts` from the project **after** 0074 and
   0078 are applied, and drop the `as never` casts around
   `status`/`image_url_mobile`/`fefo_plan_for_product` at that point.

---

### Appendix — how to reproduce the executed evidence

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm run typecheck && corepack pnpm run lint && corepack pnpm run test
NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co \
NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder \
NEXT_PUBLIC_SITE_URL=https://placeholder.example \
SUPABASE_SERVICE_ROLE_KEY=placeholder corepack pnpm run build
# migrations + catalog queries: tests/helpers/pg-harness.ts boots PGlite (PG16)
# and tests/privilege-hardening-db.test.ts runs the 0078 assertions.
```
