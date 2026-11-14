# Security audit, repairs and independent review — 14 November 2026

Scope: repository `mahakali108/Maharani-mart` at `main` `80007cc`, and the live
Supabase project `fhrmsrumsraprvutrpeo` inspected **read-only** (catalogue
queries only; no row of business data was read, written or changed).

Nothing in this report was applied to production. Migrations 0094 and 0095 are
files in the pull request, tested on a disposable in-memory PostgreSQL 16
(PGlite) only.

## 1. Findings

Severity is the impact if the site were trading. The live database currently
holds **0 users, 0 orders, 0 ledger rows**, so none of these has been exploited.

| ID | Severity | Finding | Evidence | Status |
|---|---|---|---|---|
| SEC-01 | Critical | A delivery person could mark an order delivered **without the retailer's OTP** by writing to `order_deliveries` / `orders` through the Data API. RLS allowed the update and no trigger protected `otp_hash`, `otp_verified_at`, `delivery_status`, proof fields or assignment. | Policies read from live DB; reproduced in `tests/delivery-trust-and-loyalty-integrity-db.test.ts` | **Fixed in PR** (0094 + app). Not live until 0094 is applied. |
| SEC-02 | Critical | `record_loyalty_points()` checked `current_user is distinct from 'postgres'`. Inside a SECURITY DEFINER function `current_user` is always the owner, so the Admin check never ran: **any signed-in account could credit itself unlimited loyalty points**. Migration 0093 ("hardening") kept the same line. | Live DB: function owner `postgres`, `prosecdef = true`, EXECUTE granted to `authenticated`, broken check present. Reproduction test mints 100,000 points as a retailer on a database migrated to 0093. | **Fixed in PR** (0094 §5b). Live DB still vulnerable until applied. |
| SEC-03 | High | `order_shortfall_coins()` credited whatever amount the caller sent, and let any staff member reverse a credit. | Function body (0053); test "inflated amount ignored" | **Fixed in PR** (0094 §4): amount is computed from recorded delivery lines. |
| SEC-04 | Medium | Loyalty points were awarded on the full order total even when part of the order was not delivered. | Trigger body (0093); test: ₹2,000 order, 3 of 10 short → 14 points, not 20 | **Fixed in PR** (0094 §5). |
| SEC-05 | High | Legacy unkeyed SHA-256 delivery OTP hashes were still accepted. An unkeyed hash of a 6-digit code can be brute-forced by anyone who knows the order id. | `lib/delivery/otp.ts` | **Fixed in PR** (app). Safe: live DB has 0 deliveries. |
| SEC-06 | High | Order cancellation changed the status and refunded Coins in separate steps in three code paths; the atomic database function `cancel_order_coins_atomic` (0088) had no caller. | `lib/retailer/order-actions.ts`, `lib/admin/orders-actions.ts`, mobile cancel route | **Mitigated in PR**: all three paths try the atomic function first and still verify the ledger. See residual R-2. |
| SEC-07 | Medium | `anon` and `authenticated` hold TRUNCATE, REFERENCES and TRIGGER on public tables and views (158 TRUNCATE grants live). RLS does not restrict TRUNCATE. | Live `information_schema.table_privileges` | **Fixed in PR** (0094 §6). |
| SEC-08 | Medium | Partial-delivery settlement read `order_items.line_total` (rupees) as paise, so a shortfall refund would have been 100 times too small. | `lib/delivery/delivery-actions.ts`; column is `numeric(12,2)` rupees | **Fixed in PR** (app); DB function computes the same value independently. |
| SEC-09 | Medium | Staff and sales roles could set an order to `delivered` from the generic admin status action. | `updateOrderStatusAction` | **Fixed in PR** (app + 0094 trigger). |
| SEC-10 | Medium | Delivery completion, return-to-warehouse and dispatch are several separate writes, not one transaction. A failure midway leaves a state that needs manual repair. | `completeDeliveryAction`, `recordReturnToWarehouseAction`, `dispatchOrderAction` | **Open.** Each step is guarded and idempotent, but not atomic. |
| SEC-11 | Low | 4 views are not `security_invoker` and are granted to `anon`/`authenticated`: `ai_product_demand_daily`, `catalog_product_sales`, `inventory_expiry_report`, `inventory_product_totals`. They embed an `is_staff_or_above()` filter. | Live view definitions | **Open** (low). |
| SEC-12 | Low | 29 SECURITY DEFINER functions are executable by `anon`. Most are trigger functions (not callable as RPC) or RLS helpers. Two are deliberate public endpoints: `is_phone_registered` (allows phone-number enumeration) and `submit_supplier_application`. | Live `pg_proc` | **Open**: needs rate limiting review for `is_phone_registered`. |
| SEC-13 | Low | 26 UPDATE policies have no `WITH CHECK`; PostgreSQL then reuses the `USING` expression, so this is not a bypass, but it is implicit. `orders_retailer_cancel` lets a retailer cancel directly (non-atomically) through the Data API. | Live `pg_policies` | **Open.** |
| SEC-14 | High (dependency) | `pnpm audit --prod` reports 1 high advisory: `zod` 3.25.76 (GHSA-mrhx-c7xc-m3w5, patched in ≥ 4.6.6). The fix is a major-version upgrade. | `pnpm audit --prod` output | **Open.** Not attempted in this PR. |
| SEC-15 | Info | 5 tables have RLS enabled and no policy (deny-all to API roles). All 164 SECURITY DEFINER functions set `search_path`. No public table is without RLS. | Live catalogue query | Pass. |

Storage: 34 policies on `storage.objects` reviewed. Private buckets
(`retailer-documents`, `delivery-proofs`, `payment-proofs`,
`supplier-documents`, `banner-drafts`, `compliance-evidence`) are gated by role
or ownership expressions. Public buckets hold only catalogue imagery and
avatars. No finding, but policy expressions longer than 150 characters were
truncated by the query and were **not fully read** — classify as partially
audited.

## 2. What was repaired in this PR

1. `supabase/migrations/0094_delivery_trust_and_loyalty_integrity.sql` — SEC-01, 02, 03, 04, 07, 09.
2. `lib/delivery/trusted-writer.ts`, `lib/delivery/delivery-actions.ts`, `lib/staff/dispatch-actions.ts` — protected delivery fields are written by a server-only trusted writer, **after** permission, assignee and OTP checks. Fails closed if the server key is missing.
3. `lib/delivery/otp.ts` — keyed hash only (SEC-05).
4. `lib/orders/cancellation-coins.ts` + three callers — atomic cancellation first (SEC-06).
5. `lib/admin/orders-actions.ts` — only Admin may mark delivered from the status screen (SEC-09).
6. Settlement unit fix (SEC-08).

## 3. Independent review of the repairs (second pass, finding by finding)

Done as a separate adversarial read of the final diff, asking "how would I get
round this?". It is a self-review by the same agent, **not** a third-party
penetration test; treat it accordingly.

| Check | Result |
|---|---|
| Can staff still complete a delivery over the Data API after 0094? | No. Status → delivered / partially_delivered, OTP fields, proof fields and order → delivered all raise `42501` for a non-admin API session (tests). |
| Can staff lower the OTP attempt counter to keep guessing? | No. Counter may only go up by one (test). |
| Can staff edit delivered quantities after completion to enlarge a refund? | No. `order_delivery_items` is locked once the delivery is completed (test). |
| Can staff **insert** a fresh `order_deliveries` row with an OTP they know? | The guard is on UPDATE only. Completion would still need the blocked status change, so the delivery cannot be completed this way. Insert policy was not changed. Residual, low. |
| Does the trusted writer widen access? | It uses the service-role key, which bypasses RLS. Every use is in a `'use server'` file, after the permission check, filtered by row id and expected status. A wiring test pins the order "verify OTP → obtain writer". A code path added later that skips the checks would not be stopped by the database. Residual R-1. |
| Is `record_loyalty_points` closed now? | Retailer, staff and anon are refused and nothing is written; Admin still works; ORDER_EARN stays trigger-only (tests). |
| Did the tests get weaker? | Two existing tests were edited, both stated here: `premium-upgrade.test.ts` (the "no truncate" hygiene check now ignores comments and the phrase `revoke truncate, references, trigger on`; a real `truncate` statement still fails) and `mobile-retailer-upgrade-api.test.ts` (module mock gained the new export). `detail-pages-read-failure.test.ts` allow-list gained the query-free legal page. No assertion was deleted. |
| Deployment order risk | Applying 0094 **before** deploying this app code would make staff delivery completion fail closed. Deploy the app first. |

## 4. Residual risks that block a "secure" verdict

- **R-1** Service-role use in delivery actions depends on code review discipline.
- **R-2** Cancellation falls back to the two-step path when the atomic function declines (for example split marketplace orders).
- **R-3** SEC-10 multi-step workflows are not transactional.
- **R-4** Concurrency was tested on a single-connection database, so truly simultaneous sessions were **not** exercised. Locking was reviewed by reading the SQL, and idempotency keys were tested by replay.
- **R-5** SEC-02 remains exploitable on the live database until 0094 is applied.
- **R-6** No external penetration test, no load test, no review of Vercel environment variables (not inspected, by instruction not changed).
