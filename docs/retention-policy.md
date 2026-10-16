# Data Retention & Cleanup — policy, eligibility matrix, runbook

> Implemented by migration `0055_data_retention_cleanup.sql`, the engine
> `public.run_data_cleanup`, `lib/retention/*` and the admin status page
> `/admin/cleanup`. This is an engineering classification/runbook, NOT an
> approved legal retention schedule or proof that a live deployment is safe.
>
> **SAFETY OVERRIDE (16 October 2026; UNAPPLIED PROPOSAL — NOT LIVE):**
> Migration `0059_india_compliance_safety.sql` proposes disabling all six `business_120`
> rules AND three evidence-bearing `temporary_90` targets (notifications,
> delivery logs and cleanup-run audit rows). The revised cron would refuse to
> run if any is still enabled or the registry read fails. Proof Storage buckets
> are removed from the code sweeper. These holds are pending an owner/Indian
> GST-practitioner/lawyer schedule; they do **not** establish a legal term.
> **No migration or deployment was performed for this audit.** A deployed
> pre-0059 scheduler may still delete financial rows: owner must pause the
> scheduled job without deleting data and verify its actual production state.

---

## 1. Principles

1. **Explicit classification only.** A table is cleanup-eligible only when it
   has a row in `data_retention_rules` **and** a hard-coded implementation in
   `run_data_cleanup`. Nothing is ever inferred from a table's age or name.
   An unknown or unlisted table is never touched.
2. **No age-based cleanup for master data.** Products, packs, catalog media,
   pricing, current stock and customer master records have no cleanup rules;
   the engine allow-list cannot target them. This is NOT a claim that an admin
   cannot explicitly delete a catalog item or document: those separate app
   paths and FK effects require their own review.
3. **Batched, bounded, deterministic.** Every DELETE is a small batch
   (`p_batch_size`, default 500) with a total cap per target per run
   (`p_max_rows_per_target`, default 20 000), ordered by the cutoff column.
   `DELETE FROM huge_table` never happens.
4. **Idempotent and retry-safe.** A second run deletes nothing twice. A
   partially failed run keeps its completed batches and is recorded; the next
   run retries the remainder.
5. **Foreign-key safe.** Child-first deletion for the order tree and nullable
   historical references elsewhere. No existing relationship was changed to
   `CASCADE` by this work — the pre-existing FK cascades are legacy engine behavior, not approval of deletion.
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
| Proposed after 0059 | Safety preflight; then `run_data_cleanup(false, 'cron')` for three unheld temporary targets only. No proof Storage sweep targets. **Not verified in production.** |
| Manual | Admin → Data Retention → **Run Dry-Run Audit** (never deletes) |

A crashed run leaves a `running` row behind; the next run marks rows stuck in
`running` for over an hour as `failed` with an `interrupted` error. **The
proposed 0059 hold also preserves those audit rows regardless of age.**

## 3. Cleanup eligibility matrix

| Data | Table | Proposed classification (not live) | Auto-delete after 0059? | Notes |
| --- | --- | --- | --- | --- |
| Products | `products` | Permanent | **NO** | names, descriptions, SKU, barcode/EAN, HSN, GST config, MOQ, metadata |
| Product Packs | `product_packs` | Permanent | **NO** | pack sizes, pack pricing config, **`stock_quantity` (current stock)** |
| Product Images | `product_images`, `product_pack_images` + Storage `product-images` | Permanent | **NO** | never deleted because of upload age |
| Categories / Brands | `categories`, `brands` | Permanent | **NO** | |
| Pricing | `product_pricing_tiers`, `price_lists`, `schemes` | Permanent | **NO** | |
| Current Stock | `inventory_stock`, `inventory_batches` | Permanent/current | **NO** | legacy warehouse current quantities stay |
| Warehouses / legacy structures | `warehouses`, `stock_movements` table, `grns`, `stock_transfers`, … | On hold | **NO — proposed** | Historical movement/allocation rule would pause only after 0059 |
| Retailers / profiles | `retailers`, `profiles`, `retailer_credit_accounts` | Permanent | **NO** | active customer master is never deleted because of order age |
| Abandoned cart lines | `cart_items` | 90 days | YES | cutoff `updated_at`; session shopping state |
| Notifications | `notifications` | Hold: evidence term TBD | **NO — proposed 0059 hold** | 0055's `expired_notifications` 90-day rule may erase order/payment/complaint communications |
| Notification logs | `notification_logs` | Hold: evidence term TBD | **NO — proposed 0059 hold** | prior 90-day provider log rule; do not confuse with a verified CERT-In 180-day ICT-log program |
| Expired staff invites | `staff_account_invites` | 90 days | YES | cutoff `expires_at`; dead signup tokens (live invites are 15 min) |
| AI rate-limit windows | `ai_rate_limit_windows` | 90 days | YES | cutoff `window_started_at`; spent processing windows |
| Cleanup audit logs | `cleanup_runs` | Hold: evidence term TBD | **NO — proposed 0059 hold** | 0055's 90-day rule may erase evidence of earlier destructive runs |
| **Orders** | `orders` | Hold: owner/CA term TBD | **NO — proposed 0059 hold (not live)** | cutoff `placed_at`; cascades remove `order_items`, `order_status_history`, `order_deliveries` + items, `coupon_redemptions` |
| **Order Items** | `order_items` | Hold: owner/CA term TBD | **NO — proposed 0059 hold (not live)** | counted in the `orders` run breakdown |
| **Payments** | `payment_collections` | Hold: owner/CA term TBD | **NO — proposed 0059 hold (not live)** | cutoff `created_at`; `order_id` is `on delete set null` |
| **Refunds** | `retailer_wallet_ledger` rows (`REFUND_CREDIT`, `ORDER_REVERSAL`) | Hold: owner/CA term TBD | **NO — proposed 0059 hold (not live)** | no standalone refunds table exists; refunds live in the ledger |
| **Returns** | `return_requests` | Hold: owner/CA term TBD | **NO — proposed 0059 hold (not live)** | cutoff `requested_at`; also deleted child-first with a parent order |
| **Coins Ledger** | `retailer_wallet_ledger` | Hold: owner/CA term TBD | **NO — proposed 0059 hold (not live)** | cutoff `created_at`; balance delta folded first (§5) |
| **Historical Credit** | `retailer_wallet_ledger` credit/debit rows | Hold: owner/CA term TBD | **NO — proposed 0059 hold (not live)** | same table/rows as the coins ledger; historical records preserved until an approved retention rule, never "corrected" |
| **Historical Inventory** | `stock_movements`, `order_stock_allocations` | Hold: owner/CA term TBD | **NO — proposed 0059 hold (not live)** | cutoff `created_at`; current `inventory_stock`/`inventory_batches` untouched |
| **GST Records** | GST columns on `orders` / `order_items` | Hold: owner/CA term TBD | **NO — proposed 0059 hold (not live)** | **no standalone GST table exists** in this schema; GST/tax rows are order-scoped and are reported under the `orders` breakdown as `gst_records` |
| Financial records | the categories above | Hold: owner/CA term TBD | **NO — proposed 0059 hold (not live)** | `staff_commissions` and other liabilities are **not** in the approved category and are kept |

For an **enabled** temporary rule, only rows past its cutoff are eligible;
proposed 0059 holds notifications, delivery logs and cleanup-run logs
regardless of age. A clock cutoff alone is not a lawful retention decision.

## 4. Order-tree deletion (FK audit — **dormant**)

The following describes the **legacy engine**, not an approved purge. The six
business targets would be disabled only **after separately applying 0059**;
production status was not checked, and this audit approves no order deletion.

Verified foreign keys on `orders` and how each is handled (nothing was
re-pointed to `CASCADE`):

| Child | FK | Handling |
| --- | --- | --- |
| `order_items` | `on delete cascade` (0001) | existing FK cascade in legacy engine; NOT retention approval |
| `order_status_history` | `on delete cascade` (0001) | existing FK cascade in legacy engine; NOT retention approval |
| `order_deliveries` / `order_delivery_items` | `on delete cascade` (0043) | existing FK cascade in legacy engine; NOT retention approval |
| `coupon_redemptions` | `on delete cascade` (0051) | existing FK cascade in legacy engine; NOT retention approval |
| `return_requests` | **NO ACTION** (0009) | child-first delete before the order |
| `order_stock_allocations` | `on delete cascade` (0017) | explicit child-first delete (belt & braces) |
| `visits.order_id` | nullable, NO ACTION | nullable historical reference → set to `NULL` |
| `payment_collections.order_id` | nullable, `on delete set null` | young payments survive with `NULL`; their own 120-day rule applies |
| `follow_ups.order_id` | `on delete set null` (0039) | pre-existing |
| `support_tickets.order_id` | `on delete set null` (0048) | pre-existing |
| `stock_movements.reference_order_id` | soft reference (no FK) | untouched |
| `retailer_wallet_ledger.reference_id` | soft reference (no FK) | ledger rows handled by their own rule |

**Separate unclosed evidence path:** `0051.coupons_admin_delete` permits an
admin API DELETE of a coupon. `coupon_redemptions.coupon_id ON DELETE CASCADE`
then erases redemption history and `orders.coupon_id ON DELETE SET NULL` clears
the order's FK, even though the cron's age rules are paused. The proposed 0059
RPC revoke does **not** close this path. Do not delete coupons; a separately
reviewed DB hold and isolated authorization/FK test are needed.

Wallet self-reference `retailer_wallet_ledger.reversal_of` (NO ACTION): before
a batch delete, surviving rows that point at deleted rows are unlinked
(`reversal_of = NULL`) in the same statement — a nullable historical reference,
never a broken FK.

## 5. Coins / credit ledger purge — **dormant historical implementation**

This legacy code path is exercised only by explicit isolated tests; it is not
an approved production retention policy. Reconciliation is not a substitute
for keeping legally required account history.

`get_retailer_outstanding_paise` (0031) computes
`outstanding = opening_outstanding_paise + valid debits − valid credits`, where
"valid" excludes `CREDIT_LIMIT_CHANGE` and reversed rows. Before each batch of
ledger rows is deleted, its net balance delta (using the **same** validity
predicate) is added to the account's frozen `opening_outstanding_paise` in the
same SQL statement. Its expected balance invariant has a historical regression
in `tests/data-retention-cleanup.test.ts`, **not run in this audit**; preserving
a computed balance is not the same as preserving its source evidence. The legacy
engine's 120-day deletion of credit history is **on hold**, not endorsed.

## 6. Storage buckets

| Bucket | Class | Auto-deleted? |
| --- | --- | --- |
| `product-images` | **permanent** | never (spec: product images must never be auto-deleted) |
| `brand-logos` | permanent | never |
| `category-images` | permanent | never |
| `banners` | permanent | never (admin manages lifecycle) |
| `avatars` | permanent | never |
| `retailer-documents` | permanent | never (KYC is customer master data) |
| `delivery-proofs` | on hold | **NO** — age does not justify deletion |
| `payment-proofs` | on hold | **NO** — age does not justify deletion |

`lib/retention/storage-cleanup.ts` has **no** temporary bucket during this
hold; explicit proof-bucket sweeps are refused. Product images and proof objects
cannot qualify for automatic age-based deletion. Do not manually remove proof
objects while reviewing the legal schedule or any evidence preservation hold.

## 7. Dry-run & audit log

The legacy dry-run report describes each **enabled** target using its
`target_key`, `category`, `table`, `retention_days`, `cutoff`, `action`,
`eligible_rows` and `deleted_rows` fields. This is a schema description,
**not a record of a production run**. After 0059 is independently reviewed and
applied, held targets must not appear as eligible. Before then, verify live
rule state read-only; a dry run must never be interpreted as approval to purge.

Every run writes a `cleanup_runs` row:

```text
run_id:  <generated run identifier; not a production example>
status:  completed | completed_with_errors | failed
summary: per-category totals (temporary / 120_day), per-target counts
errors:  [{ target_key, message }]   (empty on success)
```

**Historical 0055 behavior, held by proposed 0059:** completed `cleanup_runs`
rows older than 90 days were eligible for deletion. The interim proposal
pauses this rule because older run summaries may evidence a financial purge.
A `running` row is never deleted; the engine may mark a stale run `failed`.

## 8. Runbook

* **See status:** Admin → Data Retention (`/admin/cleanup`, `cleanup.view`
  permission = admin/super_admin).
* **Audit without deleting:** "Run Dry-Run Audit" button (server action →
  `run_data_cleanup(true, 'manual')`).
* **Immediate owner action:** pause the existing production scheduled cleanup
  at the scheduler; do not run a dry-run or a destructive RPC to investigate.
  Inspect deployment/migration status and backups through approved read-only
  procedures. No safety migration was applied during this audit.
* **After a separately approved 0059 rollout:** only three unheld temporary
  targets via Vercel Cron. Keep `CRON_SECRET`; the endpoint must fail closed
  if either the business or evidence hold is absent. Check actual deployment.
* **A category failed:** the run row shows the error; the next tick retries the
  remainder. No manual intervention is required unless the error repeats.
* **Changing retention:** first obtain a signed owner/CA/lawyer schedule,
  investigate records already removed, archive required evidence and update the
  cron preflight and tests. Only then use a reviewed migration to change
  `data_retention_rules` (migration-managed: service role cannot alter through
  API). Never reactivate the old 120-day targets by simply toggling `enabled`.

## 9. What was deliberately NOT cleaned (and why)

* `retailer_saved_carts` / `retailer_saved_cart_items` — **named** saved carts
  (a reorder feature), not abandoned session state. Not "clearly temporary".
* `grns`, `grn_items`, `stock_transfers` — legacy operational documents; the
  approved 120-day list names inventory *history*, not receiving documents.
* `staff_commissions`, `staff_targets` — money owed to staff; deleting them
  could erase liabilities. Not in the approved financial cleanup category.
* `audit_logs`, `super_admin_audit_logs`, `ai_audit_logs` — audit trail.
* `ai_predictions`, `ai_demand_forecasts`, `retailer_insights` — derived data,
  not in any approved category.
* `retailer_account_requests`, `retailer_documents` — customer master/KYC.
* Everything in the permanent matrix (§3).
