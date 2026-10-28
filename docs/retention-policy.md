# Data Retention & Cleanup — policy, eligibility matrix, runbook

> Implemented by migration `0055_data_retention_cleanup.sql`, the engine
> `public.run_data_cleanup`, `lib/retention/*` and the admin status page
> `/admin/cleanup`. This document is the audit trail behind those rules:
> what is deleted, when, why, and what is protected forever.

---

## 1. Principles

1. **Explicit classification only.** A table is cleanup-eligible only when it
   has a row in `data_retention_rules` **and** a hard-coded implementation in
   `run_data_cleanup`. Nothing is ever inferred from a table's age or name.
   An unknown or unlisted table is never touched.
2. **Permanent data can never be deleted.** Products, product packs, pack
   stock, product images, categories, brands, SKU/barcode/EAN, pricing, MOQ,
   current stock and customer master records have no rules and are protected
   by an engine-level allow-list (each target implementation is hard-coded to
   its own table; a tampered rule row is refused and reported).
3. **Batched, bounded, deterministic.** Every DELETE is a small batch
   (`p_batch_size`, default 500) with a total cap per target per run
   (`p_max_rows_per_target`, default 20 000), ordered by the cutoff column.
   `DELETE FROM huge_table` never happens.
4. **Idempotent and retry-safe.** A second run deletes nothing twice. A
   partially failed run keeps its completed batches and is recorded; the next
   run retries the remainder.
5. **Foreign-key safe.** Child-first deletion for the order tree and nullable
   historical references elsewhere. No existing relationship was changed to
   `CASCADE` by this work — the pre-existing approved cascades are used.
6. **Balances are sacred.** Coins/credit ledger rows are folded into the
   account's frozen `opening_outstanding_paise` baseline in the same statement
   that deletes them, so `outstanding = opening + debits − credits` (0031
   model) is mathematically unchanged by purging history.
7. **Observable.** Every execution, including dry runs, writes a
   `cleanup_runs` audit row: run_id, timing, status, per-target counts,
   per-target errors. A failing category is never a silent success.
8. **Dry-run first.** `run_data_cleanup(p_dry_run => true)` only counts and
   plans. The admin page exposes **only** dry-run — there is no
   "delete everything" button. Production deletion is owned by the scheduler.

## 2. Scheduling

| Item | Value |
| --- | --- |
| Scheduler | Vercel Cron (`vercel.json` → `crons`) |
| Endpoint | `GET /api/cron/cleanup` |
| Schedule | daily 02:00 UTC (`0 2 * * *`) |
| Auth | `Authorization: Bearer ${CRON_SECRET}` (constant-time compare). If `CRON_SECRET` is unset the endpoint refuses to run (fail closed). |
| Executes | `run_data_cleanup(false, 'cron')` via the service-role client, then a bounded storage sweep of temporary buckets |
| Manual | Admin → Data Retention → **Run Dry-Run Audit** (never deletes) |

A crashed run leaves a `running` row behind; the next run marks rows stuck in
`running` for over an hour as `failed` with an `interrupted` error, so they are
observable and can age out of the log like any other record.

## 3. Cleanup eligibility matrix

| Data | Table | Retention | Delete? | Notes |
| --- | --- | --- | --- | --- |
| Products | `products` | Permanent | **NO** | names, descriptions, SKU, barcode/EAN, HSN, GST config, MOQ, metadata |
| Product Packs | `product_packs` | Permanent | **NO** | pack sizes, pack pricing config, **`stock_quantity` (current stock)** |
| Product Images | `product_images`, `product_pack_images` + Storage `product-images` | Permanent | **NO** | never deleted because of upload age |
| Categories / Brands | `categories`, `brands` | Permanent | **NO** | |
| Pricing | `product_pricing_tiers`, `price_lists`, `schemes` | Permanent | **NO** | |
| Current Stock | `inventory_stock`, `inventory_batches` | Permanent/current | **NO** | legacy warehouse current quantities stay |
| Warehouses / legacy structures | `warehouses`, `stock_movements` table, `grns`, `stock_transfers`, … | Structure permanent | **NO** (structure) | only old *history rows* of `stock_movements` / `order_stock_allocations` are eligible |
| Retailers / profiles | `retailers`, `profiles`, `retailer_credit_accounts` | Permanent | **NO** | active customer master is never deleted because of order age |
| Abandoned cart lines | `cart_items` | 90 days | YES | cutoff `updated_at`; session shopping state |
| Notifications | `notifications` | 90 days | YES | cutoff `created_at`; ephemeral messages |
| Notification logs | `notification_logs` | 90 days | YES | cutoff `created_at`; provider/system logs |
| Expired staff invites | `staff_account_invites` | 90 days | YES | cutoff `expires_at`; dead signup tokens (live invites are 15 min) |
| AI rate-limit windows | `ai_rate_limit_windows` | 14 days (AI engine) / 90 days (general engine) | YES | **0084**: the dedicated AI engine deletes at 14 days (cutoff `window_started_at`); the 90-day general rule remains as a safety net and is unchanged. See §10. |
| Cleanup audit logs | `cleanup_runs` | 90 days after completion | YES | a run is **never** deleted while still `running` (spec: never before completion) |
| **Orders** | `orders` | 120 days | YES | cutoff `placed_at`; cascades remove `order_items`, `order_status_history`, `order_deliveries` + items, `coupon_redemptions` |
| **Order Items** | `order_items` | 120 days (with order) | YES | counted in the `orders` run breakdown |
| **Payments** | `payment_collections` | 120 days | YES | cutoff `created_at`; `order_id` is `on delete set null` |
| **Refunds** | `retailer_wallet_ledger` rows (`REFUND_CREDIT`, `ORDER_REVERSAL`) | 120 days | YES | no standalone refunds table exists; refunds live in the ledger |
| **Returns** | `return_requests` | 120 days | YES | cutoff `requested_at`; also deleted child-first with a parent order |
| **Coins Ledger** | `retailer_wallet_ledger` | 120 days | YES | cutoff `created_at`; balance delta folded first (§5) |
| **Historical Credit** | `retailer_wallet_ledger` credit/debit rows | 120 days | YES | same table/rows as the coins ledger; historical records preserved until this cutoff, never "corrected" |
| **Historical Inventory** | `stock_movements`, `order_stock_allocations` | 120 days | YES | cutoff `created_at`; current `inventory_stock`/`inventory_batches` untouched |
| **GST Records** | GST columns on `orders` / `order_items` | 120 days (with order) | YES | **no standalone GST table exists** in this schema; GST/tax rows are order-scoped and are reported under the `orders` breakdown as `gst_records` |
| Approved financial records | the categories above | 120 days | YES | `staff_commissions` and other liabilities are **not** in the approved category and are kept |

If an existing table contains both permanent and temporary rows (e.g.
`notifications` for a still-active user), only rows past the cutoff are
eligible — the rule deletes by timestamp, never the whole table.

## 4. Order-tree deletion (FK audit)

Verified foreign keys on `orders` and how each is handled (nothing was
re-pointed to `CASCADE`):

| Child | FK | Handling |
| --- | --- | --- |
| `order_items` | `on delete cascade` (0001) | approved cascade |
| `order_status_history` | `on delete cascade` (0001) | approved cascade |
| `order_deliveries` / `order_delivery_items` | `on delete cascade` (0043) | approved cascade |
| `coupon_redemptions` | `on delete cascade` (0051) | approved cascade |
| `return_requests` | **NO ACTION** (0009) | child-first delete before the order |
| `order_stock_allocations` | `on delete cascade` (0017) | explicit child-first delete (belt & braces) |
| `visits.order_id` | nullable, NO ACTION | nullable historical reference → set to `NULL` |
| `payment_collections.order_id` | nullable, `on delete set null` | young payments survive with `NULL`; their own 120-day rule applies |
| `follow_ups.order_id` | `on delete set null` (0039) | pre-existing |
| `support_tickets.order_id` | `on delete set null` (0048) | pre-existing |
| `stock_movements.reference_order_id` | soft reference (no FK) | untouched |
| `retailer_wallet_ledger.reference_id` | soft reference (no FK) | ledger rows handled by their own rule |

Wallet self-reference `retailer_wallet_ledger.reversal_of` (NO ACTION): before
a batch delete, surviving rows that point at deleted rows are unlinked
(`reversal_of = NULL`) in the same statement — a nullable historical reference,
never a broken FK.

## 5. Coins / credit ledger purge — why balances don't move

`get_retailer_outstanding_paise` (0031) computes
`outstanding = opening_outstanding_paise + valid debits − valid credits`, where
"valid" excludes `CREDIT_LIMIT_CHANGE` and reversed rows. Before each batch of
ledger rows is deleted, its net balance delta (using the **same** validity
predicate) is added to the account's frozen `opening_outstanding_paise` in the
same SQL statement. The computed outstanding is therefore identical before and
after the purge — covered by tests
(`tests/data-retention-cleanup.test.ts`). Historical credit rows are preserved
until their 120-day cutoff and are never corrected or re-valued.

## 6. Storage buckets

| Bucket | Class | Auto-deleted? |
| --- | --- | --- |
| `product-images` | **permanent** | never (spec: product images must never be auto-deleted) |
| `brand-logos` | permanent | never |
| `category-images` | permanent | never |
| `banners` | permanent | never (admin manages lifecycle) |
| `avatars` | permanent | never |
| `retailer-documents` | permanent | never (KYC is customer master data) |
| `delivery-proofs` | temporary (120 days) | eligible after the delivery's 120-day window |
| `payment-proofs` | temporary (120 days) | eligible after the payment's 120-day window |

`lib/retention/storage-cleanup.ts` enforces this in code: the sweep only
visits buckets classified **temporary** (an unknown bucket is treated as
permanent), deletes in bounded batches, and refuses everything else. Product
images can never qualify for deletion, however old.

## 7. Dry-run & audit log

Dry-run output per target (admin page / `run_data_cleanup(p_dry_run => true)`):

```json
{
  "target_key": "orders",
  "category": "business_120",
  "table": "orders",
  "retention_days": 120,
  "cutoff": "2026-06-02T12:00:00+00:00",
  "action": "DELETE",
  "eligible_rows": 152,
  "deleted_rows": 0
}
```

Every run writes a `cleanup_runs` row:

```text
run_id:  cleanup-2026-09-30-1a2b3c4d
status:  completed | completed_with_errors | failed
summary: per-category totals (temporary / 120_day), per-target counts
errors:  [{ target_key, message }]   (empty on success)
```

Log retention: completed `cleanup_runs` rows become eligible for the 90-day
`cleanup_run_logs` rule once `completed_at` is older than 90 days; a `running`
row is never deleted (and is force-finalized as `failed` if stale for an hour).

## 8. Runbook

* **See status:** Admin → Data Retention (`/admin/cleanup`, `cleanup.view`
  permission = admin/super_admin).
* **Audit without deleting:** "Run Dry-Run Audit" button (server action →
  `run_data_cleanup(true, 'manual')`).
* **Production deletion:** only the Vercel Cron tick. Set `CRON_SECRET` in the
  project env; the endpoint fails closed without it.
* **A category failed:** the run row shows the error; the next tick retries the
  remainder. No manual intervention is required unless the error repeats.
* **Changing retention:** a new migration must edit `data_retention_rules`
  (migration-managed: even the service role cannot alter it through the API).
  Rule rows never point at permanent tables; the engine refuses mismatches.

## 9. What was deliberately NOT cleaned (and why)

* `retailer_saved_carts` / `retailer_saved_cart_items` — **named** saved carts
  (a reorder feature), not abandoned session state. Not "clearly temporary".
* `grns`, `grn_items`, `stock_transfers` — legacy operational documents; the
  approved 120-day list names inventory *history*, not receiving documents.
* `staff_commissions`, `staff_targets` — money owed to staff; deleting them
  could erase liabilities. Not in the approved financial cleanup category.
* `audit_logs`, `super_admin_audit_logs` — **general security/audit evidence**;
  never touched by any cleanup, including the AI engine.
* `ai_audit_logs` — deliberately **NOT** part of this 90/120-day engine. It is
  covered by the separate AI-only 14-day rule in §10 (migration 0084).
* `ai_predictions`, `ai_demand_forecasts`, `retailer_insights` — derived data,
  not in any approved category **of this 90/120-day engine**. `ai_demand_forecasts`
  is covered by the separate AI-only 14-day rule in §10.
* `retailer_account_requests`, `retailer_documents` — customer master/KYC.
* Everything in the permanent matrix (§3).


---

## 10. AI-only 14-day retention (migration 0084)

The owner requires that **Super Admin AI data** — and only AI data — is deleted
automatically after **14 days**. This is a *separate* engine from the 90/120-day
business cleanup above; it does not modify `run_data_cleanup`, its registry or
its schedule.

| Store | Cutoff column | Rule |
| --- | --- | --- |
| `ai_audit_logs` | `created_at` | strictly older than 14 days |
| `ai_business_memory` | `updated_at` | strictly older than 14 days |
| `ai_rate_limit_windows` | `window_started_at` | strictly older than 14 days |
| `ai_confirmed_actions` | `consumed_at` | strictly older than 14 days |
| `ai_demand_forecasts` | `computed_at` | strictly older than 14 days |

* **Boundary:** a row exactly 14 days old is *kept*; it is eligible on the next
  run (the predicate is `< cutoff`, not `<=`). Timestamps are absolute
  (`timestamptz`), i.e. UTC instants.
* **Never touched:** every account, product, order, invoice/tax row, payment,
  refund, wallet/loyalty ledger, return, complaint, general audit record and
  Storage object. The engine's target list is a hard-coded allow-list of the
  five tables above — there is no dynamic SQL and no table name parameter.
* **Not stored:** prompts, responses, memory values or file contents. The run
  log (`ai_cleanup_runs`) records the cutoff, per-target row counts, status and
  errors only.
* **Audit retention:** run logs are themselves general operational evidence and
  are not deleted by the AI engine.
* **Schedule:** **none by default.** The route `/api/cron/ai-cleanup` exists and
  is guarded by `CRON_SECRET` (fails closed with 503 when unset), but this PR
  deliberately registers **no `crons` entry** for it in `vercel.json`, so
  deploying the application cannot start deleting AI data on its own. Arming it
  is a separate, explicitly approved change that requires, in this order:
  migration 0084 applied → one authorised `?dry_run=1` run reviewed → written
  owner sign-off → add `{ "path": "/api/cron/ai-cleanup", "schedule": "30 2 * * *" }`.
  The pre-existing `/api/cron/cleanup` schedule (`0 2 * * *`) is unchanged.
* **External AI providers:** the platform cannot promise deletion from a
  provider's own systems or backups; that depends on the provider's terms and
  is outside this control.
