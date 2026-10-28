# Pre-production release gate — retailer categories, tier pricing, AI retention

**Branch:** `arena/d032106f-maharani-mart`
**Base:** `main` @ `3346181dcb6570a1c70517c086abc533bc474f7f`
**Verdict: NO-GO for production.** This pull request is **for review only**. Nothing
in it has been deployed, and no migration has been applied to any project.

This file exists so the reviewer can see, in one place, what must be true before
this branch may be merged and released, and what has not been verified.

---

## 1. Deployment dependency: schema BEFORE code

The application reads `product_tier_prices` (migration 0082) from the retailer
pricing path. `loadEffectiveCategoryPrices` **throws** when that read fails
rather than falling back to a possibly-wrong price, and the six retailer
surfaces — `cart`, `checkout`, `catalog/[id]`, `quick-order`,
`orders/[id]/reorder`, `salesman/orders/new` — await it without a `try/catch`.

**Consequence:** deploying this code against a database that has not yet applied
0082 takes retailer commerce down ("Couldn't load this page") while admin
screens quietly render zeros.

**Required order**

```
0081 → 0082 → 0083 → 0084      (database first, verified after each)
              ↓
     deploy application code  (only after all four are applied)
```

Record, after **each** migration, that the row counts of unrelated tables
(`orders`, `order_items`, `loyalty_ledger`, `retailer_memberships`, payments)
are unchanged, and that `membership_plans where is_active` is `0` after 0083.

Ordering rationale (from the files themselves):

| Migration | Depends on |
| --- | --- |
| `0081_retailer_categories_and_approval.sql` | `is_admin_or_above()`, `is_staff_or_above()`, `is_active_account()` (0052); `retailers`, `profiles`, `areas` |
| `0082_category_tier_pricing.sql` | the `retailer_category` enum from **0081**; `product_packs`, `product_pricing_tiers`, `seller_offers`, `coupons`, `orders`, `cart_items`; `create_order_atomic` (0056) and `create_order_atomic_v2` (0065), which it re-states |
| `0083_retire_paid_membership.sql` | `membership_plans`, `retailer_memberships`, `loyalty_ledger`, `record_loyalty_points`, `trg_order_delivered_loyalty` (0080) |
| `0084_ai_data_retention_14_days.sql` | the five AI tables (0018/0019); independent of 0081–0083 |

`0078` and `0079` are **not** prerequisites of these four (verified by replaying
all 81 migration files on PostgreSQL 16 without them being required).

---

## 2. Rollback scripts are incomplete — rehearse before release

The `.down.sql` files under `supabase/rollbacks/` are **review material, never
executed**. Three of the four cannot restore the prior state on their own:

| Script | Restores | Cannot restore (known gap) |
| --- | --- | --- |
| `0081` | Drops the 5 RPCs, 3 triggers and 2 helper functions, `retailer_approval_settings`, and `retailers.retailer_category` | **Every category assignment is lost**; the one-row-per-retailer backfill is not reversed, so re-applying 0081 afterwards fails on the `retailer_id` unique constraint; the enum is intentionally left behind |
| `0082` | Drops both validation/guard triggers, their functions and `pack_category_price_per_piece` | **Both checkout RPCs keep the category-price gate.** Restoring the 0056/0065 bodies is a manual extract — the script is not self-contained |
| `0083` | Re-activates `free`/`silver`/`gold` and restores the API grant | The loyalty-multiplier restoration is a **comment, not code**; any other plan id stays inactive |
| `0084` | Revokes and drops `run_ai_data_cleanup` | **Deletion is irreversible.** The rollback only stops future runs. A cron entry, if one had been armed, must be removed too |

**Gate:** a rollback *and re-apply* rehearsal in a disposable project is
required before release, with the residual state after each `.down.sql` written
down and accepted by the owner.

Also decide the apply tooling explicitly: none of `0081`–`0084` contains
`BEGIN/COMMIT`. `supabase db push` wraps each file in a transaction; `psql -f`
does not — a mid-file failure without a wrapper leaves a half-built feature.

---

## 3. Cron safety: the AI schedule is deliberately not registered

Migration 0084 creates a destructive, irreversible 14-day cleanup. **This PR
registers no `crons` entry for it.** `vercel.json` still schedules only the
pre-existing business retention job:

```json
"crons": [{ "path": "/api/cron/cleanup", "schedule": "0 2 * * *" }]
```

The route `app/api/cron/ai-cleanup/route.ts` ships fully implemented and fails
closed (503) when `CRON_SECRET` is unset, so even a manual call cannot run
without the secret.

Arming the schedule is a **separate, explicitly approved change**, and only
after all three of:

1. migration `0084` is applied to the target project;
2. one authorised `GET /api/cron/ai-cleanup?dry_run=1` run has been reviewed and
   its `eligible_rows` agree with an independent count;
3. the owner has given written sign-off.

`tests/cron-configuration.test.ts` locks this in: exactly one cron entry exists,
it is `/api/cron/cleanup` at `0 2 * * *`, and no scheduled path may reference
AI cleanup.

---

## 4. Evidence that is NOT in this repository (owner / DBA only)

None of the following has been performed, and nothing in this branch may be
read as proof of it:

| # | Evidence | Why it blocks release |
| --- | --- | --- |
| 1 | Backup/PITR status + a completed restore drill in a disposable project | Restore is currently unproven |
| 2 | Production RPC fingerprints (`md5(prosrc)`), ACLs, pinned `search_path` | Proves whether production drifted from the repo; 0082 *replaces* two checkout functions |
| 3 | Production migration ledger + confirmation the six target objects do not already exist | `create table if not exists` would silently keep a differently-shaped table |
| 4 | Real two-connection concurrency test | The local harness is single-connection; duplicate `p_request_key` behaviour is unproven live |
| 5 | Rollback/re-apply rehearsal (§2) | The scripts are incomplete by inspection |
| 6 | A green GitHub CI run | No workflow run exists for this branch (see §6) |
| 7 | CA opinion on GST/TCS/discount characterisation | TCS is configuration only and is **not deducted**; seller-funded discounts are **disabled** |
| 8 | Legal review of Terms/Privacy/Returns + Cosmetics/Legal Metrology evidence | No compliance claim is made by this change |

All hashes quoted elsewhere in the repo are **repository-derived** (a PostgreSQL
16 replay of the migration set), never production values.

---

## 5. Known limitations of the change

1. Category pricing applies to **Maharani own-stock lines only**. Seller offers
   keep their approved offer price and admin floor check, so a retailer category
   can never silently reduce a seller's settlement. Extending it needs the seller
   agreement and settlement math designed first.
2. Manual loyalty credit has **no admin screen** (the RPC and ledger remain).
3. `/retailer/membership` keeps its URL with new content (category + points).
4. `/admin/compliance` states configuration readiness only. Unset identity
   fields render "Owner Input Required"; no GSTIN, PAN, address, officer, phone,
   email or licence is invented anywhere.
5. Staff/salesmen can read the retailer **selling** prices they must quote to
   create an order. Seller cost and floor data are never in that table.

---

## 6. Test evidence

Local, on this branch (see the pull-request description for the exact commands
and exit codes). **Local results are not a GitHub CI run.** `ci.yml` triggers
only on pull requests into `main` and pushes to `main`, and recent `main` runs
complete with **zero steps executed** because of a GitHub billing/spending-limit
annotation. No remote CI result is claimed.

---

## 7. What this branch did NOT do

No migration applied to any project. No deployment. No cron enabled. No
production Supabase connection, SQL, secret read or data deletion. No merge.
