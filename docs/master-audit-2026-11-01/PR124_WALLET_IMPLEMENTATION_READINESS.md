# PR #124 — Wallet accounting implementation readiness review

**Date:** 2026-11-05 · **Decision:** design review only; **NOT APPROVED FOR IMPLEMENTATION OR RELEASE**. PR #124 remains draft. This report proposes future work; no wallet application code or migrations were changed, no commit was pushed, no preview was triggered, and no financial transaction or database-data modification was run in this review.

## Evidence, access and limitations

- **[Repository]** means source/migration text was inspected in this checkout. This does not establish the version, configuration, scheduler, permissions, actual contents, or use in production. The direct-writer inventory below covers static literal references found by searching this repository; dynamic SQL, external integrations, database changes outside the repository, and deployed privileges still require runtime verification.
- **[Prior local]** means results reported by the previous investigation: the unchanged `tests/coin-refund-balance-db.test.ts` failed on a disposable PGlite database with migrations applied before this review; expected 0, actual −50,000 paise. The prior synthetic `tests/financial-design-prototype.pg.mjs` passed 9 scenarios including two independent PostgreSQL 18.6 sessions. The latter validates only a simplified, new fixture, not real schema, 17.x locks/privileges, partial historical state, stock, seller settlement or deployed code. No tests or transactions were run in this review.
- **[Live unknown]** A read-only aggregate query and a migration-history lookup against the sole authorized project `fhrmsrumsraprvutrpeo` both failed at the provider with PostgreSQL authentication error `28P01`. No aggregate data or migration history was returned. The project listing reports PostgreSQL 17, but that does not establish the deployed SQL or ledger records. The user should have the Supabase connection/database authentication reviewed; do not supply credentials in chat. No retry was attempted. Counts, incident magnitude, account impact, historical data completeness and scheduler activity are unknown.
- **[Proposal]** is an owner/accounting/security-reviewed design candidate, not an approved behavior or claim. Detailed findings in [PR124 financial investigation](PR124_FINANCIAL_INVESTIGATION.md) remain relevant; this report adds the retention, API/read-model and reconciliation analysis.

## A. Accounting convention and examples

**[Repository]** `retailer_wallet_ledger.amount_paise` is a positive integer; `debit` increases outstanding, `credit` decreases outstanding; `CREDIT_LIMIT_CHANGE` is non-money. `0031` calculates `opening + active debits − active credits` and `available = credit_limit − outstanding`. Negative outstanding represents a net credit, not a negative debit. `lib/coins/math.ts` / Kotlin clamp *spendable Coins* to `max(0, available)`; available itself can be negative under overdue conditions. No claim is made that a Coin is legal tender or that accounting/legal classification has been approved.

Assume opening ₹0 and funding/limit ₹1,000; amounts below are rupees. "Current" describes the source behavior when 0053/0067 applies and no earlier entries interfere; **not observed live**.

| Event | Rows / flags | Current outstanding / available | Proposed outstanding / available |
|---|---|---:|---:|
| Initial | none | 0 / 1,000 | 0 / 1,000 |
| Order debit | +500 debit | 500 / 500 | 500 / 500 |
| Full refund | +500 credit linked to debit, original flagged reversed | **−500 / 1,500** because the debit is omitted and credit counted | **0 / 1,000**: original and offset counted once each |
| Separate example: partial refund | +200 linked credit, original flagged reversed by child path | **−200 / 1,200**; the entire 500 is omitted | **300 / 700**: debit 500 less credit 200 |
| Another independently keyed ₹300 partial | Current 0067 marked the debit reversed and will no longer select it; no normal second partial | not supported by current path | 0 / 1,000 after total refunds = 500 |
| Retry same event and amount | same event key and payload | 0053 returns 0/no new entry for its deterministic key; existing row is not fully payload-validated | same result, no additional credit, validated original result |
| Two distinct ₹300 refunds racing for a ₹500 debit | distinct event keys | one-key-per-debit 0067 behavior is not a safe general partial-refund mechanism; other writers do not all share a lock | serialize, one ₹300 commits; competing ₹300 is rejected against remaining ₹200 |

A positive opening baseline or legitimate payment/manual credit changes these figures. Do not interpret a negative balance as proof of misconduct or cash loss. Parent/split, prior shortfalls, and seller allocation complicate event entitlement; no user-facing correction may be inferred from arithmetic alone.

## B. Current versus proposed flow

**Current [Repository]:**

```
checkout (create_order_atomic[_v2]) -> account lock + ORDER_DEBIT per order/child
-> read 0031 active-only balance / mirror
cancellation -> order status update (own PostgREST transaction)
-> 0053 or 0067 refund RPC (a different transaction; credit + debit flag)
-> coupon/stock steps (other calls/triggers)
```

Partial delivery may separately append `REFUND_CREDIT`; return may mark that credit reversed without an offset entry. Admin direct payment/adjustment/reversal and collection verification have additional write paths. A single unique key does not unify these separate transactions. `restoreAndVerifyCancellationCoins` can verify a single matching flagged debit/credit but does not verify balance, and rejects multiple debits after status may have committed.

**Proposed [Proposal], decision points to settle with owner:** retain positive paise and direction. Represent every economic effect once in an append-only movement journal; an opposite linked movement corrects a source. `is_reversed` becomes display/derived metadata, not a second balance effect. A historical opening/checkpoint with evidence is included once; only fully classified migrated history can move to this model. Every refund has a stable authorized business-event identity and per-source allocation, bound to retailer, order/child, amount and currency. A retry with identical payload returns the verified prior result; a mismatch is rejected. The database transaction obtains globally agreed locks, revalidates state and refundable remainder, and atomically records event, allocations, ledger movement and applicable order/child/stock/coupon changes. A no-Coins cancellation is a valid zero-movement outcome; a request to credit a missing/foreign debit is an error. Shortfall plus returns require an explicit event entitlement/allocation policy before implementation.

This is a logical direction, not a recommendation to remove all `is_reversed` filters immediately. Doing that would miscount historical flag-only reversals and conflict with existing cleanup and UI behavior. Amount bounds are evaluated against the correct source and all prior effective refund/reinstatement events, not merely order grand total. Independently approve treatment of manual credits, account funding, legacy refunds, COD collections and seller settlement before finalizing.

## C. Affected functions and paths

### Writers and transitions — static inventory

| Path/function | Existing repository behavior and risks |
|---|---|
| `supabase/migrations/0031_wallet_outstanding_opening_baseline.sql`: `check_and_debit_retailer_wallet` | Row-locks retailer credit account, checks available balance and writes debit; checks a nullable idempotency key before and after lock. Existing key lookup returns an id without complete payload equality validation. Grants changed later by `0056`; verify effective deployed grants. |
| `supabase/migrations/0082_category_tier_pricing.sql`: `create_order_atomic`, `create_order_atomic_v2`; earlier versions `0056`, `0065` | Atomic order creation, stock/coupon and debit inside DB; v2 splits debits by child. Order-request advisory lock and fingerprint differ from refund idempotency. Replay sums only non-reversed debits. Never assume the older definition is active; inspect installed version. |
| `lib/orders/create-order.ts`, `lib/retailer/checkout-actions.ts`, `lib/mobile/commerce-service.ts`, `lib/salesman/order-creation-actions.ts`, `lib/coins/server.ts` | Web/mobile/salesman order submission, quote or debit helpers; checkout and recovery expose existing amount/snapshot contracts. Search all callers and actual grants before removing a helper. |
| `supabase/migrations/0053_order_coin_refund.sql`: `refund_order_coins` | Restricts status/actor, selects first debit, writes credit + flags original in one RPC. `reversal:<debit>` and unique `idempotency_key` suppress identical-key duplicates but do not validate conflict payload or cover other keys/writers. No-debit and already reversed return 0. Actor and no-session/service-role semantics require security review. |
| `lib/orders/wallet-reversal.ts`, `lib/orders/cancellation-coins.ts`, `lib/retailer/order-actions.ts`, `app/api/mobile/v1/orders/[id]/cancel/route.ts`, `lib/admin/orders-actions.ts` | Parent status and wallet RPC are not one transaction. Strict cancellation disallows legacy fallback; non-cancellation callers may still insert and flag in separate requests. The single-debit verifier does not check final balance and cannot safely process split debits. |
| `supabase/migrations/0067_seller_settlement.sql`: `refund_sub_order_coins`; `lib/admin/sub-order-actions.ts`; seller/status functions in `0066`/`0069` | Child debit `FOR UPDATE`, one source-key, flags whole debit even for a partial credit; parent/child aggregation and inventory status are separate paths. Admin child status, stock and refund calls have separate boundaries and some results are ignored. Seller-initiated child status paths must be traced end-to-end; no universal atomicity claim. |
| `0053`: `order_shortfall_coins`; `lib/delivery/delivery-actions.ts` | Credit for shortfall keyed to delivery; it bounds against order total rather than proving remaining source debit. Reversal currently flags the credit with no opposite money row. A missing-function direct-insert fallback exists. Return-to-warehouse invokes full order reversal and shortfall reversal separately, and the first result is not checked. |
| `lib/admin/wallet-actions.ts`: `recordPaymentAction`, `recordAdjustmentAction`, `reverseTransactionAction`, `setCreditLimitAction` | Direct inserts for payment, arbitrary allowed direction/type adjustment, opposite-direction admin reversal followed by separate flag update. Client-provided keys optional; generated timestamp/random keys do not inherently deduplicate a new retry. Funding updates are not a monetary movement. Reversal conflicts may be treated as success without validating all fields. |
| `lib/admin/collections-actions.ts`: `verifyCollectionAction` / `rejectCollectionAction`; `lib/salesman/collection-actions.ts` | Pending collection verification inserts `PAYMENT_CREDIT` key `collection:<id>` then separately updates status/link. A concurrent reject or failure between steps can leave mismatched state; a duplicate-key relink checks id but not full source payload. Field collection is not automatically a verified payment. |
| `0029`: `audit_credit_limit_change`, `sync_retailer_outstanding_balance` | Limit-change audit row is non-money; mirror trigger runs after ledger insert/update/delete. Check transaction order, error propagation and constraint behavior when changing account funding to zero. |
| `0055_data_retention_cleanup.sql`: `run_data_cleanup`; `app/api/cron/cleanup/route.ts`; `lib/admin/cleanup-actions.ts`; `vercel.json` | Repository-defined general cleanup includes an initially enabled 120-day `coins_ledger` rule: folds active delta into mutable opening balance, unlinks remaining reversal references and deletes old rows. Cron route is configured in source, conditional on actual deployment/secret; live execution and rule state unknown. The function writes `cleanup_runs` **even in dry-run mode**, so do not call it during a read-only assessment. `0084` AI-only cleanup explicitly does not replace general cleanup. |

**Important immutability conclusion:** retailer wallet is not strictly immutable even though its table comment says so: authorized updates of flags exist and 0055 contains deletion/unlinking. The separately defined `seller_ledger` and `collection_allocations` have update/delete-blocking triggers (`0067`); privileged bypass/retention and live installation remain to be verified. A truly immutable design conflicts with existing financial retention, privacy, business-record and legal requirements and needs owner + qualified counsel approval; do not silently disable/change a live cleanup job.

### Readers, APIs, seller settlement and reporting

| Area/files | Impact to review |
|---|---|
| `0031` outstanding and `0029` mirror; `lib/retailer/wallet.ts`, `lib/retailer/wallet-math.ts`, `lib/coins/server.ts` | `getRetailerOutstandingPaise` can fall back to `retailers.outstanding_balance` if RPC fails; this can mask errors/stale mirror. `getOrderCoinMovement` sums only unflagged debits and sets `refunded` true on any reversal, so partial/split semantics need redesign. `coins_balance_after_paise` is an order-time snapshot, not current balance. |
| `app/admin/wallets/page.tsx`, `app/admin/wallets/[id]/page.tsx`, `app/salesman/retailers/page.tsx`, `lib/admin/dashboard/data.ts`, `lib/admin/dashboard/compute.ts` | Each has independent ledger filtering/aggregation. Wallet detail calculates purported outstanding from **only the latest 100** rows; list queries may also face server row caps. Salesman page sums non-reversed debits but not credits when debits exist. Dashboard payment totals omit flagged credits. These may disagree with the canonical RPC even apart from this refund defect; use a complete authoritative aggregation/read model rather than a paginated display subset. |
| `lib/retailer/ledger.ts`, `lib/retailer/reports.ts`, `app/retailer/account/ledger`, `app/api/mobile/v1/reports/*` | Legacy order-history/mirror view is not a running wallet ledger; its prose predates later payment tables. Purchase reports derive order totals separately. Reconcile definitions, cutoffs, cancelled/returned treatment, statement exports, timestamps and mirror consistency rather than claiming all are currently ledger-backed. |
| `0067`: `allocate_payment_collection`, `collection_allocations`, `seller_ledger`, `seller_payouts` | Retailer wallet and seller AP are separate planes. Allocation locks collection and suborder, writes allocation and seller ALLOCATION; idempotency key is generated from a new allocation id, with uniqueness on `(payment_collection_id, sub_order_id)`, so retry semantics require review. The 0067 function body does not itself check `payment_collections.status = 'verified'`, despite its introductory description; inspect any caller gate and effective deployed definition before concluding whether an unverified collection could be allocated. A retailer refund does not by itself demonstrate seller payable/payout correction. Commission/payout posting basis was undecided in source; table presence is not proof of live payouts. Owner/accountant must decide refund/return allocation, seller settlement corrections and tax treatment; never infer seller payment from Coins restoration. |
| `app/api/mobile/v1/wallet/{route.ts,ledger/route.ts}`, `app/api/mobile/v1/orders/[id]/{route.ts,cancel/route.ts}`, `app/api/mobile/v1/orders/requests/[requestKey]/route.ts`, `lib/mobile/order-data.ts` | Preserve response envelopes, auth/ownership and integer-paise field names. Cancellation currently returns `{ok:true}` or 409/503; status can already be cancelled when 503 occurs. Order detail may omit movement fields on read failure while request recovery fails closed. Retry semantics, event outcome and errors need documented compatibility tests. |
| `android/core/network/.../dto/{EngagementDtos,CommerceDtos}.kt`, `MaharaniApi.kt`, `android/feature/engagement/.../{EngagementRepository,EngagementModels,ui/WalletScreen}.kt`, `android/feature/orders/.../{RetailerOrderActionsRepository,ui/OrderDetailScreen}.kt` | DTO has signed `Long` `creditLimitPaise`, `outstandingPaise`, `availablePaise`, ledger `isReversed`; Android discards server `availablePaise` and recomputes `max(0,funded−spent)`. Wallet UI shows reversed flag, order detail labels any `coinsRefunded=true` as refunded. Partial refunds may mislead unless API semantics and installed-client behavior are explicitly preserved/versioned. Keep retailer-only scope; no APK/AAB is produced by this review. |

## D. Historical reconciliation plan — no changes authorized

1. **Establish actual state first.** An authorized DBA should independently verify project identity, schema/migration fingerprints and effective function bodies, runtime grants/RLS and retention/scheduler state. The attempted read-only connection failed; no live records were inspected here. Avoid sensitive row exports; use least-privilege read-only access, aggregate first, controlled per-account investigation only as approved.
2. Obtain an auditable point-in-time snapshot and identify retention gaps. `0055` may already have folded/deleted historical rows and severed links; cleanup logs themselves are retained 90 days per repository. Current opening may contain both original balance and folded history. A complete immutable reconstruction may be **impossible from the current DB alone**; locate verified backups, statements or source records and flag unknown provenance. Do not subtract/recreate missing credits by inference.
3. Classify each retained movement/event: valid full linked offset, partial, multiple debits, duplicate key/source, orphan/wrong owner/order/direction, flagged debit without linked credit, flagged credit with no opposite entry (including legitimate shortfall convention), deleted-source link, same event across parent/child, collection status/link mismatch, manual/funding and refund/return conflicts. Review seller allocation independently; classify temporal overlapping shortfall and returned orders. A nullable `reversal_of` is not automatically fraud because retention may unlink it.
4. Compute two side-by-side, read-only projections at one consistent snapshot: current **source-equivalent** balance and a candidate event-classified balance with a documented baseline. Calculate delta and risk for each account; compare legacy mirror, wallet endpoint, direct admin/salesman aggregations, order snapshots, collection totals and seller settlement. Frozen baseline is already influenced by any historical cleanup, so do **not** simply sum every old row or apply `+ debit` to all flagged rows. Account for negative balances, valid outstanding and legitimate credits. Keep pre/post source counts and a provenance record.
5. Produce a restricted exception queue and independently approved per-account mapping, evidence, legal retention and adjustment policy. Cases with incomplete or conflicting history stay unresolved/blocked, not automatically credited or debited. No owner funds, customer balance or seller payable is corrected until specific accounting and operational authorization. Evidence and least-privilege access should be preserved; avoid inventing an obligation or GST/tax position.

## E. Proposed safe migration / release sequence — future approval required

0. Resolve owner decisions: accounting convention and zero-Coins cancellation; refund/shortfall/return allocation; historical baseline/provenance; seller settlement and tax; retention/audit requirements; customer communication; security and operations sign-off. Obtain specific authorization before any database or operational change.
1. Finish design/permissions and inventory every actual writer—including scheduled cleanup, authenticated/admin/service role, external integrations and dynamic SQL. Make a compatibility plan for in-flight checkout/cancellation and current installed Android clients. Define deterministic global locks from existing retailer/order/child/account/debit/stock/coupon lock graph; show lock order across *all* writers and cleanup, test deadlocks/retries. Synthetic fixture lock order is not that proof.
2. Under explicit approval, back up and rehearse restore on an isolated production-like snapshot. Confirm legal retention. Reconcile source/mirror, event keys and seller allocations; decide how to gate or safely evolve conflicting cleanup without touching it during this review. Plan maintenance/fail-closed write barrier and preserve reads/uncertainty messaging.
3. Prepare additive, ordered, reversible-before-write schema/function migration(s) after the latest verified migration; never edit applied history. Add event/allocation identity, source ownership/remainder invariants, least-privilege transaction entry points, audit and proven immutability or formally approved archival/checkpoints. Validate existing incompatible rows separately; do not deploy a half-compatible writer. Keep explicit compatibility shims for deployed clients and define old-API retirement.
4. In a coordinated, authorized release window, quiesce all affected writes and scheduled cleanup, snapshot/reconcile, apply the approved schema/functions and compatible server release as one controlled cutover, handle old sessions/workers and verify final lock/writer closure. Exact deploy order depends on proven expand/contract compatibility; **there is no safe universal 'DB first' shortcut while old code can write under the old convention**. If compatible dual operation is impossible, keep the write barrier until both are ready.
5. Validate authorized read-only post-cutover checks, mirrors, parity, exception queue, transaction histories and client contracts before reopening writes. Follow a separately approved, idempotent per-account historical correction plan only after reconciliation and owner sign-off. Do not generate live test orders/refunds; production checks should be read-only.

### Rollback and recovery

- Before cutover or before any new-convention writes: abort, leave existing data unchanged, restore tested code/schema only if backward compatible, and verify from a snapshot. If write-barrier state changes were approved, document how to safely unwind them.
- After new writes or repair: freezing affected writes and preserving a point-in-time backup/log and audit is safer than reverting the old `is_reversed` logic. Reverting SQL in place can double-count new entries or lose refund state. Reconcile under an approved incident plan; choose a tested forward correction, compensating journal entry, or point-in-time restore **only with explicit operational/owner approval** and impact analysis. Coordinate seller allocation, stock, external effects and customer notification; a database rollback cannot undo external fulfilment or payments. Test recovery before release.

## F. Candidate production verification queries — **not executed**

These are read-only `SELECT` templates for a future authorized DBA to review and run against the **verified official** project with appropriate snapshot/statement timeout and least privilege. They return aggregates where possible; run in a read-only transaction/session controlled by the DBA, not through the app. Verify actual installed schema/columns first; missing objects/permissions and runtime differences must fail visibly. Never invoke cleanup—even `p_dry_run=true` writes audit rows. None of these counts establishes fraud, entitlement or a repair amount.

**1. Ledger type/flag inventory**

```sql
SELECT transaction_type, direction, is_reversed,
       count(*) AS rows, coalesce(sum(amount_paise), 0) AS amount_paise
FROM public.retailer_wallet_ledger
GROUP BY transaction_type, direction, is_reversed
ORDER BY transaction_type, direction, is_reversed;
```

**2. Retained order debits and linked credits — anomaly candidates, not final entitlement**

```sql
WITH linked AS (
  SELECT d.id, d.retailer_id, d.amount_paise, d.is_reversed,
         count(c.id) AS linked_rows,
         count(c.id) FILTER (
           WHERE c.retailer_id IS DISTINCT FROM d.retailer_id
              OR c.direction <> 'credit'
              OR c.transaction_type <> 'ORDER_REVERSAL'
         ) AS suspicious_rows,
         coalesce(sum(c.amount_paise) FILTER (
           WHERE c.direction = 'credit' AND NOT c.is_reversed
         ), 0) AS active_linked_credit_paise
  FROM public.retailer_wallet_ledger d
  LEFT JOIN public.retailer_wallet_ledger c ON c.reversal_of = d.id
  WHERE d.transaction_type = 'ORDER_DEBIT' AND d.direction = 'debit'
  GROUP BY d.id, d.retailer_id, d.amount_paise, d.is_reversed
)
SELECT count(*) AS source_debits,
       count(*) FILTER (WHERE is_reversed AND linked_rows = 0) AS flagged_without_retained_link,
       count(*) FILTER (WHERE is_reversed AND active_linked_credit_paise > 0) AS flagged_with_active_credit,
       count(*) FILTER (WHERE active_linked_credit_paise > 0 AND active_linked_credit_paise < amount_paise) AS partial_candidate,
       count(*) FILTER (WHERE active_linked_credit_paise > amount_paise) AS over_linked_candidate,
       count(*) FILTER (WHERE linked_rows > 1) AS multiple_links,
       count(*) FILTER (WHERE suspicious_rows > 0) AS owner_direction_type_mismatch
FROM linked;
```

These joins count retained references only; `0055` may unlink/delete old sources, and shortfall credits do not necessarily use `reversal_of`. Examine cancelled/returned state, event identity, shortfalls and timestamps before interpreting a candidate. Note that a credit of another reference type may still be legitimate and a link can be reversed itself.

**3. Split order debit prevalence and unlinked reversals**

```sql
SELECT count(*) AS orders_with_multiple_retained_debits
FROM (
  SELECT retailer_id, reference_id
  FROM public.retailer_wallet_ledger
  WHERE transaction_type = 'ORDER_DEBIT'
    AND reference_type = 'order' AND reference_id IS NOT NULL
  GROUP BY retailer_id, reference_id HAVING count(*) > 1
) t;

SELECT count(*) AS reversal_rows_without_retained_link
FROM public.retailer_wallet_ledger
WHERE transaction_type = 'ORDER_REVERSAL' AND reversal_of IS NULL;
```

**4. Source-equivalent balance versus rupee mirror — accounts with a baseline only**

```sql
WITH delta AS (
  SELECT retailer_id,
         coalesce(sum(CASE WHEN direction='debit' THEN amount_paise
                           WHEN direction='credit' THEN -amount_paise END)
           FILTER (WHERE NOT is_reversed
                          AND transaction_type <> 'CREDIT_LIMIT_CHANGE'), 0) AS delta_paise
  FROM public.retailer_wallet_ledger GROUP BY retailer_id
), compared AS (
  SELECT a.opening_outstanding_paise + coalesce(d.delta_paise, 0) AS current_paise,
         round(coalesce(r.outstanding_balance, 0) * 100)::bigint AS mirror_paise
  FROM public.retailer_credit_accounts a
  JOIN public.retailers r ON r.id = a.retailer_id
  LEFT JOIN delta d ON d.retailer_id = a.retailer_id
)
SELECT count(*) AS accounts_compared,
       count(*) FILTER (WHERE current_paise <> mirror_paise) AS mirror_mismatches,
       count(*) FILTER (WHERE current_paise < 0) AS negative_outstanding_accounts
FROM compared;
```

This reproduces the **repository's current** account-backed arithmetic, not the proposed corrected balance; it does not cover the no-account fallback and it does not prove financial correctness. Snapshot timing, concurrent writes and actual deployed function definitions matter.

**5. Retention rules, evidence of cleanup and collection linkage — status counts only**

```sql
SELECT target_key, enabled, retention_days
FROM public.data_retention_rules
WHERE target_key IN ('coins_ledger', 'payment_records', 'orders');

SELECT dry_run, status, count(*) AS runs,
       min(started_at) AS earliest_retained_run,
       max(started_at) AS latest_retained_run
FROM public.cleanup_runs GROUP BY dry_run, status ORDER BY dry_run, status;

SELECT pc.status,
       count(*) AS collections,
       count(*) FILTER (WHERE pc.ledger_entry_id IS NULL) AS without_ledger_link,
       count(*) FILTER (WHERE pc.ledger_entry_id IS NOT NULL AND l.id IS NULL) AS dangling_link
FROM public.payment_collections pc
LEFT JOIN public.retailer_wallet_ledger l ON l.id = pc.ledger_entry_id
GROUP BY pc.status ORDER BY pc.status;
```

Logs may themselves be expired; existence of a rule or a run does not prove any specific ledger deletion. Pending/rejected collections normally need interpretation distinct from verified collections; a link may legitimately be null. Review effective foreign keys, order/suborder joins and retention history before deciding a mismatch.

## G. Required test matrix — acceptance criteria, not tests run now

| Area | Required cases / evidence |
|---|---|
| Sign and balances | Zero/nonzero opening, positive/negative outstanding, funding/overdue; debit ₹500 + full ₹500 = zero, partial ₹200 = ₹300; one-paise, bigint limits, rounding, no floating-point drift, available and clamped display. |
| Event integrity | Missing/foreign/wrong-type debit and wrong order/child rejected; valid zero-Coins cancellation succeeds without a refund; no > debit; repeated partials, exact exhaustion, zero/negative invalid; same key+payload replay once, altered payload/actor/order conflict; duplicate source links and key collision. |
| Historical | Flagged full credit, flag-only shortfall, partially credited flag, orphan/unlinked and retention-folded entries, duplicate/ambiguous keys, negative baselines, no account fallback, opening/mirror mismatch, already affected subsequent orders. No automatic repair of unverifiable cases. |
| Multi-session PostgreSQL | On a disposable DB matching deployed PG major with actual future schema and role/RLS, synchronized barriers for same/different keys, concurrent partials, checkout vs refund, child vs parent, cancellation vs return/shortfall, admin vs RPC, collection verify vs reject, cleanup vs writes. Check blocking/deadlock, consistent lock hierarchy, bounded retry, no lost/duplicate entries and exact commit state. The prior synthetic 18.6 tests are not enough. |
| Failure injection | Force errors after status, debit, credit, event allocation, stock/coupon, mirror and audit; DB abort/timeout/crash/connection loss before/after commit; retry and recovery must distinguish committed vs rolled back, with no falsely successful ledger row or success response. Test unknown outcomes explicitly. |
| Permissions | Authenticated owner, foreign retailer, staff, seller, inactive role, anonymous, service role; security-definer search_path, parameter spoofing, table writes and revoked helpers; prevent over-refunds and mutation via every entry point. Validate role behavior, not just mocked clients. |
| Marketplace and seller | Own stock/third-party split; multiple child debits, partial/full child and parent cancellations, seller transitions, return/shortfall combinations, stock restoration, allocation and seller AP remain reconciled with owner-approved policy; no duplicate payout or false seller reversal. |
| Immutability/retention | Prove authorized roles cannot alter journal money values or delete events outside approved archival; reconcile checkpoints/retention, unlinked history, scheduled cleanup interaction, backups/restores and audit continuity. Approve legal retention before implementation. |
| All clients/read models | SQL canonical balance vs mirror and all web/admin/salesman list/detail/statement/dashboard/export paths including >100/1,000 rows and paging; API field names/errors/status/retry; Android DTO serialization, negative values, partial labels, old installed version, network retry and order snapshot. Validate RLS isolation and fail-closed reads. |
| Integration and release | Preserve the original failing regression until it passes for the actual design; add full/partial/idempotency/reconciliation tests against the real future implementation, not only prototype; rerun complete suite/lint/build, security audit and supported Android unit/build/device tests; independent finance, legal, security and database review; controlled migration/recovery rehearsal. |

## H. Open owner decisions / go-no-go

1. Approve or reject the proposed append-only event model, plus treatment of flagged historical credits, partially fulfilled/returned goods and multi-child allocations.
2. Decide what can be established from retained data and independent records, who may approve an exception/adjustment, and how affected retailers are informed without inventing debts or credits.
3. Approve seller settlement/payout basis and refund effects separately from retailer Coins; resolve tax/invoice and statutory retention with qualified reviewers.
4. Approve retention architecture and how to avoid 0055 cleanup destroying required audit evidence; verify actual scheduler and live configuration before any operational action.
5. Specify API compatibility/versioning and how old Android versions behave for partial refunds, retry and ambiguous cancellation state.

Until these decisions, the connection issue, financial defect, full test/lint failures and security advisories are resolved and independently verified, **PR #124 remains draft; no merge or release**. This document is local-only because pushing could trigger Vercel previews. Await owner approval before implementing, creating a migration, performing a repair or publishing changes.
