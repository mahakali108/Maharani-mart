# Master Upgrade — Retailer Approval, Tier Pricing, Super Admin AI, AI-Only Retention

**Date:** 2026-10-27
**Branch:** `arena/d032106f-maharani-mart`
**Head at audit start:** `3346181dcb6570a1c70517c086abc533bc474f7f` (`main` merge of PR #118)
**Working tree at audit start:** clean
**Supabase project:** `fhrmsrumsraprvutrpeo` (only). The legacy project was never contacted.
**Production changes applied by this work:** **none** (no deploy, no migration, no cron, no setting, no data).

This document is the Phase A audit, the Phase B/C implementation record and the
evidence pack. Everything below is either (a) a fact read from the repository at
the commit above, (b) a local command result, or (c) an explicit statement that
something was NOT verified. Nothing is claimed that was not executed.

---

## 1. Read-only audit (Phase A)

### 1.1 Repository state

| Item | Finding |
| --- | --- |
| Branch / head | `arena/d032106f-maharani-mart` @ `3346181` (clean tree) |
| Open PRs (unchanged, not touched) | #107 compliance holds, #66 retailer catalog, #45 phone OTP, #42 retailer UI, #31 pricing/SKU, #21 Capacitor Android, #7 Firebase storage |
| Migrations found | `0001`–`0080` (gaps at 0061, 0075, 0076); `0078`/`0079` are marked **REVIEW ONLY / not applied** |
| Migration harness | `tests/helpers/pg-harness.ts` replays **every** migration on PGlite (PostgreSQL 16), so RLS/triggers/functions are executed in tests, not string-matched |
| Baseline tests | **163 files / 2749 tests passing** (`npx vitest run`) |
| Baseline typecheck | `npx tsc --noEmit` → clean |
| PWA / Android | Next.js 14 PWA; `android/` is historical and not part of delivery. **No APK/Flutter work done.** |

### 1.2 Paid membership — actual dependency map

| Dependency | Where | Finding |
| --- | --- | --- |
| Schema | `0080_retailer_memberships_and_loyalty.sql` | `membership_plans`, `retailer_memberships`, `loyalty_ledger`, RPCs `get_active_retailer_membership`, `admin_set_retailer_membership`, `get_retailer_loyalty_balance`, `record_loyalty_points`, trigger `trg_orders_delivered_loyalty` |
| Checkout discount | — | **No checkout caller existed.** `computeMembershipDiscount()` in `lib/membership/math.ts` is exported but never used by the quote, cart, coupon or order path. Membership discounts were a UI/marketing claim plus a DB field, never applied arithmetic. |
| Retailer UI | `app/retailer/membership/page.tsx`, `app/retailer/account/page.tsx` | Plan cards, prices, "Request Upgrade", subscription history |
| Admin UI | `app/admin/membership/page.tsx`, `components/layout/admin-shell.tsx` | Plan editing, assignment form |
| Actions | `lib/membership/actions.ts` | `adminAssignRetailerMembershipAction` (→ `admin_set_retailer_membership`), `adminRecordLoyaltyPointsAction` |
| Loyalty accrual | `trg_orders_delivered_loyalty` | Read `membership_plans.points_multiplier` at delivery |
| Scheduling | — | No cron/job touched the membership tables |

Conclusion: removing membership is a **UI + grant** change, not a pricing-math
change. Historical tables and rows are retained; nothing is deleted.

### 1.3 Pricing — where the authoritative price is computed today

* Retailer-facing engine: `lib/retailer/retailer-pricing.ts`
  (`calculateRetailerPiecePrice`) — GST-inclusive **per piece**.
* Tier source: `product_pricing_tiers` (quantity slabs, `rule_type`
  `default|case|bulk|loose`), loaded by `lib/retailer/pricing-data.ts`
  (`loadPackTiers`).
* Overrides: `price_lists` (retailer → area → pack `case_price`), resolved by
  `lib/retailer/effective-price.ts`.
* **Database revalidation:** `create_order_atomic` (0056) and
  `create_order_atomic_v2` (0065) each recompute the expected unit price per
  line and `raise 'ORDER_PRICE_CHANGED'` if the submitted price differs. The
  browser price is therefore already untrusted; the change in this branch adds
  the retailer-category price to that same server-side resolution.
* Seller lines: priced from `seller_offers.unit_price_paise` with an admin floor
  (`current_offer_floor_paise`).

### 1.4 Retailer approval — what already existed

* `retailers.status` enum: `pending_approval | active | suspended` (no `rejected`).
* `retailers_admin_update` RLS policy is admin-only (a retailer cannot update
  their own row), and middleware already redirects a `pending_approval`
  retailer to `/pending-approval` before any protected page, so an unapproved
  retailer cannot browse prices or check out.
* Admin actions (`lib/admin/retailers-actions.ts`) approved/suspended by direct
  `UPDATE` — **no reason, no previous/new values, no audit trail**.

### 1.5 AI data stores — audited (not assumed)

| Store | Exists? | Covered by the 14-day rule? |
| --- | --- | --- |
| `ai_audit_logs` (request id, user, surface, tool, duration, tokens, success) | yes (0018) | **yes** — AI processing/debug metadata, contains no prompts/responses |
| `ai_business_memory` (retailer AI preferences) | yes (0018) | **yes** — AI memory, re-learnable |
| `ai_rate_limit_windows` | yes (0018) | **yes** — temporary AI state |
| `ai_confirmed_actions` (one-time nonces) | yes (0018) | **yes** — replay protection with no value after 14 days |
| `ai_demand_forecasts` (AI forecast snapshots) | yes (0019) | **yes** — derived, recomputable observations, never used to mutate business data |
| AI chat history / conversation transcripts | **no such table** | N/A — conversation text is not persisted; the client sends bounded history per request |
| AI prompts / responses / files / caches | **no such store** | N/A — `lib/ai/observability.ts` writes metadata only |
| General `audit_logs`, `super_admin_audit_logs`, `cleanup_runs` | yes | **NO** — security/audit evidence, out of scope |

Existing general cleanup (`run_data_cleanup`, migration 0055, Vercel cron
`/api/cron/cleanup`) is **not modified**; it already deletes spent
`ai_rate_limit_windows` at 90 days and nothing else AI-related.

### 1.6 Risks identified before implementation

1. Re-stating `create_order_atomic(_v2)` is the only way to make a new price
   source authoritative without a second checkout implementation — risk of a
   transcription error → mitigated by generating the bodies mechanically from
   the original migrations and by boundary tests.
2. `retailers.status` has no `rejected` value; adding an enum value and using it
   in the same transaction is unsafe → rejected applications are stored on
   `retailer_applications.status` while the access gate stays
   `pending_approval`.
3. Retailer-category pricing must not repricing seller offers (settlement
   integrity) → it is applied only in the Maharani own-stock branch.
4. AI cleanup must not be able to touch non-AI tables → hard-coded allow-list,
   no dynamic SQL, separate function/registry/audit table.
5. Red/rose colours are banned by the design-system contract → new UI uses the
   sanctioned `warning`/`mint`/`primary` tokens.
6. Vercel Cron is deployment configuration: adding a cron entry only takes
   effect on deploy, which requires owner approval.

---

## 2. Implementation (Phase B) — files changed

### Database (all **review only**, not applied)

| Migration | Contents |
| --- | --- |
| `0081_retailer_categories_and_approval.sql` | `retailer_category` enum + `retailers.retailer_category`; `retailer_applications`; `retailer_approval_events` (append-only); `retailer_approval_settings` (SLA); RPCs `admin_review_retailer_application`, `admin_set_retailer_category`, `admin_set_retailer_access`, `admin_update_approval_settings`, `retailer_resubmit_application`; signup auto-application trigger; sensitive-column guard trigger; RLS |
| `0082_category_tier_pricing.sql` | `product_tier_prices` (unique per pack+category, `> 0`, numeric(12,2)); ordering trigger `gold ≤ silver ≤ general`; write guard; `pack_category_price_per_piece()`; re-stated `create_order_atomic` and `create_order_atomic_v2` with the category-price gate |
| `0083_retire_paid_membership.sql` | deactivates every plan; revokes the assignment RPC from all API roles; loyalty trigger no longer reads a membership multiplier |
| `0084_ai_data_retention_14_days.sql` | `ai_retention_rules`, `ai_cleanup_runs`, `run_ai_data_cleanup()` (service-role only) |

Rollbacks: `supabase/rollbacks/0081…0084.*.down.sql` (each marked REVIEW ONLY;
none deletes audit or business records by default).

### Application

| Area | Files |
| --- | --- |
| Category price rules | `lib/pricing/category-pricing.ts` (isomorphic: ordering, resolution, labels) |
| Category price reads | `lib/retailer/category-pricing.ts` (RLS-scoped loader) |
| Single pricing chokepoint | `lib/retailer/pricing-data.ts` — `loadPackTiers(supabase, packIds, retailerId)` now injects one synthetic tier at the category price, so catalog, cart, checkout preview, reorder, quick-order, coupon eligibility and the sales-order screen price identically |
| Call sites updated | `lib/orders/quote-order.ts` (both quote paths), `lib/retailer/catalog.ts`, `lib/retailer/cart-validation.ts`, `lib/coupons/cart-lines.ts`, `app/retailer/{cart,checkout,quick-order,catalog/[id],orders/[id]/reorder}`, `app/salesman/orders/new` |
| Existing admin actions re-pointed | `lib/admin/retailers-actions.ts` — approve/reject/suspend/reactivate now call the audited 0081 RPCs instead of a direct `UPDATE` |
| Admin: approvals | `app/admin/retailer-applications/page.tsx`, `components/admin/retailer-approval-panel.tsx`, `components/admin/retailer-approval-sla-form.tsx`, `lib/admin/retailer-approval-actions.ts` |
| Admin: category pricing | `app/admin/pricing/tiers/page.tsx`, `components/admin/category-price-editor.tsx`, `lib/admin/tier-pricing-actions.ts` |
| Admin: compliance | `app/admin/compliance/page.tsx`, `lib/compliance/checklist.ts` |
| Super Admin Control Center | `app/admin/control-center/page.tsx` — pending/overdue approvals, category-price count, owner-input count cards |
| Super Admin AI | `lib/ai/tools/super-admin.ts` — `get_retailer_approval_queue`, `get_category_price_comparison`, `get_compliance_readiness` (all `actionClass: 'READ'`, `roles: ['super_admin']`), permission mapping in `lib/ai/tools/index.ts`, quick actions in `app/admin/ai/page.tsx` |
| Membership retirement | deleted `app/admin/membership/page.tsx` + `lib/membership/actions.ts`; sidebar entry replaced; `app/retailer/membership/page.tsx` rewritten as "Pricing Category & Points"; `app/retailer/account/page.tsx` link copy |
| AI retention scheduler | `app/api/cron/ai-cleanup/route.ts` + `vercel.json` cron `30 2 * * *` (deploy-gated) |
| Tests | `tests/retailer-approval-db.test.ts`, `tests/category-tier-pricing-db.test.ts`, `tests/ai-retention.test.ts`, `tests/category-pricing-unit.test.ts`; updated `tests/membership-db.test.ts`, `tests/membership-page-error.test.tsx`, `tests/migration-catalog-invariants.test.ts` |

---

## 3. Security and RLS changes

| Control | Enforcement |
| --- | --- |
| Retailer cannot approve themselves | `admin_review_retailer_application` raises unless `is_admin_or_above()`; retailer `UPDATE` on `retailers` is already RLS-denied; guard trigger is depth 2 |
| Retailer cannot change their category | `product_tier_prices` and `retailers.retailer_category` are admin-only; `admin_set_retailer_category` re-checks the role; `guard_retailer_sensitive_columns` blocks non-admin status/category writes |
| Retailer cannot see another category's price | RLS on `product_tier_prices` exposes **general + own category** only to an *active, approved* retailer (a pending/suspended retailer sees no rows at all); admin sees all; salesmen/staff see the retailer selling prices they must quote to create an order — never seller cost or floor. The resolution helper never looks "up" from general |
| Price ordering | DB trigger `gold ≤ silver ≤ general` on every insert/update/delete; invalid values raise `CATEGORY_PRICE_ORDER_INVALID` |
| Browser price never trusted | both checkout RPCs recompute the price (now including the category price) and raise `ORDER_PRICE_CHANGED` on mismatch |
| Category change mid-checkout | the RPC re-reads the retailer's category inside the transaction; a stale quote fails closed (tested) |
| Seller settlement | category prices are never applied to `seller_offers`; the seller branch keeps its approved offer price + admin floor check |
| Approval audit | `retailer_approval_events` records actor, timestamp, previous/new status and category, reason; a trigger makes it append-only for every role |
| AI assistant privileges | read-only tools, `super_admin` only, RLS-scoped client, no SQL/shell/service-role, no write path; privileged actions stay in the existing authorized screens |
| AI cleanup isolation | service-role-only function; no API-role grant; five hard-coded tables; registry cross-check fails closed; no dynamic SQL |
| Existing protections preserved | 0078/0079 (not applied) remain untouched; no policy, grant or SECURITY DEFINER function was weakened |

---

## 4. Test evidence (local, executed)

```
npx vitest run        168 files / 2818 tests passed   (~105 s)
npx tsc --noEmit      clean
npx next lint         "No ESLint warnings or errors"
npx next build        succeeded (138/138 static pages, all routes compiled)
```

Remote CI: **not run for this branch.** `.github/workflows/ci.yml` triggers only
on pull requests into `main` and pushes to `main`, and the existing `main` runs
fail in ~3 seconds with the documented GitHub billing/spending-limit annotation
(see `docs/CI_ACTIONS_ZERO_COST.md`). No remote check is claimed as passing.

New behavioural coverage (executed on PostgreSQL 16 via PGlite, not string
matching):

* `retailer-approval-db.test.ts` (14) — auto-application, reason required,
  self-approval denied, staff denied, approval never grants Gold implicitly,
  category change audited with previous/new values, retailer self-change denied
  (RPC **and** direct write), audit trail append-only for every role,
  suspend/restore, "restore is not an approval shortcut", resubmission,
  configurable SLA, retailer sees only their own application.
* `category-tier-pricing-db.test.ts` (15) — ordering constraint, zero price
  rejected, retailer cannot write prices, per-category RLS visibility,
  own-category resolution + general fallback + cross-retailer denial, general/
  silver/gold checkout acceptance and rejection, category change mid-checkout,
  packs without category prices unaffected, helper not callable by an API role,
  deactivation fallback, coupon interaction.
* `ai-retention.test.ts` (10) — 13 d 23 h kept, **exactly 14 d kept**
  (strictly-older rule pinned inside one transaction), 14 d + 1 min deleted,
  dry run deletes nothing, idempotent repeats, batch cap, audit row without AI
  content, API roles cannot execute, **business/ledger/audit-account tables
  unchanged across a live run**, registry ↔ implementation consistency,
  90/120-day engine untouched.
* `category-pricing-unit.test.ts` (16) — pure ordering/resolution math in
  integer paise, and wiring contracts (every pricing call site passes a
  retailer id; both checkout RPCs consult the helper only in the own-stock
  branch; admin surfaces are permission-gated).

Existing suites that encoded the old paid-membership behaviour were rewritten
to the retired semantics (plans inactive, no API grant, base-rate loyalty), not
deleted.

**Not verified:** no test ran against the real Supabase project; PGlite is a
single connection, so multi-connection concurrency is asserted by sequential
replay and by the existing advisory-lock design, not by a true race.

---

## 5. Product behaviour after this change

* **Retailer categories** replace paid memberships. Assignment requires an admin,
  a written reason and produces an audit record. Gold is never implicit.
* **Pricing**: a pack with a category price is priced at that price for that
  retailer; other packs keep the existing slab/override/case rules untouched.
  Seller offers are never repriced.
* **Unapproved retailers** stay blocked by middleware and by the database
  (`status <> 'active'`), so no price or checkout access is possible.
* **Retailer screen** shows the assigned category and the retained loyalty
  points ledger — no plan, fee, renewal or expiry claim.
* **Loyalty** is retained as an append-only ledger. New accrual is 1 point per
  whole ₹100 (the ≤2× membership multiplier is retired). Existing balances are
  untouched and never converted to cash. Manual admin crediting no longer has
  a screen (see limitations).
* **Super Admin AI** can summarise approvals, category-price comparisons and
  compliance configuration readiness, in English or Hindi (the existing system
  prompt already enforces the verified/calculated/suggestion/unknown labels and
  treats retrieved data as untrusted). It cannot approve, price, publish,
  refund or delete.

---

## 6. AI data covered by the 14-day deletion — exact scope

Deleted when strictly older than `now() - interval '14 days'` (UTC instant):

| Table | Timestamp column | Why it is AI-only |
| --- | --- | --- |
| `ai_audit_logs` | `created_at` | AI request/tool metadata; no prompt or response text |
| `ai_business_memory` | `updated_at` | AI-stored preferences |
| `ai_rate_limit_windows` | `window_started_at` | AI rate-limit state |
| `ai_confirmed_actions` | `consumed_at` | AI one-time confirmation nonces |
| `ai_demand_forecasts` | `computed_at` | AI forecast snapshots (derived, recomputable) |

Excluded by construction (the engine contains no statement that can reach
them): profiles, retailers, sellers, seller offers, addresses, carts, products,
packs, price lists, pricing tiers, category prices, inventory/batches/GRN,
orders, order items, sub-orders, invoices/GST rows, payment collections,
refunds, wallet ledger, loyalty ledger, returns, support tickets,
notifications, `audit_logs`, `super_admin_audit_logs`,
`retailer_approval_events`, `cleanup_runs`, and every Storage bucket.

Proof that unrelated records are excluded: `ai-retention.test.ts` counts 14
business/ledger/audit tables before and after a live run and asserts equality.
Boundary semantics are pinned in the same file (a row exactly 14 days old
survives until it is strictly older).

External provider retention: the app calls an external model provider per
request. **No promise is made** that the provider (or its backups) deletes
anything at 14 days; that depends on the provider's terms and is not verified
here. Only platform-side storage is covered.

---

## 7. Legal readiness

See `docs/compliance/legal-readiness-2026-10-27.md` and `/admin/compliance`.
Status is expressed only as *Verified in platform*, *Owner Input Required*,
*CA Review Required*, *Legal Review Required* or *Not applicable*. The platform
does not claim compliance, and no GSTIN, address, officer name, phone number,
licence or verification result is fabricated. Unconfigured values render as
"Owner Input Required".

---

## 8. Known limitations and remaining risks

1. **Migrations are review-only.** Nothing is applied to `fhrmsrumsraprvutrpeo`.
   Feature code that calls `admin_*` RPCs (0081) will error until the owner
   approves applying 0081–0084, DB first.
2. **Seller-offer category pricing does not exist.** Category prices apply to
   Maharani own-stock lines only (a deliberate settlement-safety decision).
   If the owner wants category pricing on seller offers, the seller agreement,
   floor and settlement math must be designed first.
3. **Manual loyalty credit has no screen.** The ledger and RPC remain
   (`record_loyalty_points`), but the admin form lived on the retired
   membership page. A dedicated admin screen is a follow-up.
4. **`app/retailer/membership` keeps its URL** (renamed content) to avoid
   breaking existing links/bookmarks and the PWA cache; it can be renamed to
   `/retailer/pricing-category` later with a redirect.
5. **`/api/cron/ai-cleanup` only runs after deploy**; until then the AI
   retention is enforced by the function but not scheduled in production.
6. **Vercel plan limits** apply to cron frequency; a daily run is assumed.
7. **No real-database verification** of RLS/triggers, and **no true concurrency
   test** (PGlite is single-connection).
8. **Compliance sources must be re-verified**: the checklist links official
   portals but the applicability/commencement of each instrument needs the
   owner's CA/lawyer to confirm against the current text.
9. **The legal pages still need owner-supplied contact details**; the platform
   deliberately shows "Owner Input Required" rather than placeholders.

---

## 9. Rollback plan

| Level | Action |
| --- | --- |
| Code only | Revert this PR. Packs without category prices are unaffected; with prices present, the added gate is a no-op only if the table is empty, so prefer DB rollback with the code revert. |
| DB feature off | `supabase/rollbacks/0082…down.sql` (restore original checkout bodies, drop helpers). Keep `product_tier_prices` rows unless the owner decides otherwise. |
| Approvals off | `supabase/rollbacks/0081…down.sql` — drops the RPCs/triggers/column; audit and application rows are **retained by default**. |
| Membership back on | `supabase/rollbacks/0083…down.sql` — re-enables plans + grant + multiplier trigger (owner approval required). |
| AI retention off | `supabase/rollbacks/0084…down.sql` **and** remove the `vercel.json` cron entry, otherwise the scheduler keeps calling a dropped function. Deletion is irreversible. |
| Ordering | Apply in reverse: 0084 → 0083 → 0082 → 0081. Code first, then DB, per the deploy note in 0082. |

---

## 10. Actions NOT performed (production)

* No migration was applied to `fhrmsrumsraprvutrpeo` (or any project).
* No deployment, no Vercel project change, no cron enabled, no `CRON_SECRET`
  changed, no secret read or written.
* No production data was read, altered or deleted; no cleanup job was run.
* No production SQL/RLS/policy/grant was changed.
* No PR was merged, no branch other than this one was pushed, no PR was closed.
* No billing, plan or paid AI provider change.
* No Android/Flutter/APK work.
* No food category enabled.
