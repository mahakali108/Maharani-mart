# PR #126 — final security and reliability repair

Date: 2026-11-14. Follows `07_FINAL_COMPLETION.md` and corrects two things in it.

Nothing here was applied to production, deployed or merged. The PR stays a
Draft. Every result was produced in the sandbox on the PR branch. Where a check
could not be run, it says **NOT DONE** / **NOT VERIFIED** and why.

## Verdict

**READY FOR INDEPENDENT REVIEW** for the code, migrations and tests (now 0094–0102; sections 18–25 are the latest pass and replace the figures in sections 15–17).
**NOT READY TO LAUNCH** (unchanged; see `00_LAUNCH_READINESS.md`).

Not verified in this pass, and a reviewer or the owner must do it:

- Browser check of the Vercel preview — **NOT VERIFIED** (section 9).
- Cloudflare build log — **NOT READ** (section 10).
- No staging database has 0094–0100, so nothing was exercised end to end
  through the deployed app.

## Corrections to the previous report

1. `07_FINAL_COMPLETION.md` said `complete_delivery_atomic` locked
   "order → delivery → delivery lines, always in that order". **That was wrong
   at commit `5993b16`.** The function did not take the three locks in one fixed
   order relative to the 0096 line guard, which locks the delivery row from a
   line write. Two sessions could wait on each other. It is fixed in SQL in
   this pass (section 2) and the sentence in report 07 now carries a correction.
2. Report 07 treated the delivery proof reference as verified. It was only
   checked for shape. A reference to a file that did not exist, or that somebody
   else uploaded, was accepted. Fixed in this pass (section 1).

## 1. Delivery proof is verified, not just well-formed (0099)

`complete_delivery_atomic` now refuses the completion unless every proof
reference (signature, photo) points to a real row in `storage.objects`:

- in the private bucket `delivery-proofs`, inside this order's own folder;
- a current file (not archived, not a delete marker);
- uploaded by the acting user, by the assigned delivery person, or by an active
  Admin / Super Admin — taken from the uploader recorded by Storage, never from
  metadata the client can set;
- otherwise `DELIVERY_COMPLETE:PROOF_MISSING` (22023) or
  `DELIVERY_COMPLETE:PROOF_OWNER` (42501), and nothing is written.

The migration checks up front that `storage.objects` and its `owner_id` /
`owner` columns exist and stops with a clear message if they do not.
`lib/delivery/completion.ts` maps both codes to plain messages.

Tests: 7 in `tests/delivery-completion-action-db.test.ts` (file does not
exist; another user's upload, including other staff, a salesman, a retailer and
no uploader; forged owner metadata, wrong bucket, archived and deleted
versions; Admin upload accepted, deactivated Admin's not; direct call to the
function; Storage policies agree with the function), and 4 on real PostgreSQL.

## 2. One lock order, and no deadlock between line writes and completion

Canonical order, used by every function in 0094–0100:

`orders → order_deliveries → order_delivery_items → credit accounts / wallet ledger → retailers (loyalty)`

A direct write to a delivery line already holds the line lock before its
trigger runs, so it cannot take the parent lock first. Making it wait behind a
completion is exactly the deadlock. The 0096 guard therefore now uses
`FOR SHARE … NOWAIT`: if the delivery is being completed, the line write is
refused immediately with `DELIVERY_GUARD:BUSY` (SQLSTATE 55P03, safe to retry).
It never waits, so it cannot be half of a deadlock.

Real PostgreSQL 17 evidence (`tests/pr126-fulfilment-and-locks.pg.mjs`):

- a **control** run with the old waiting guard reproduces the deadlock
  (PostgreSQL reports 40P01), proving the test can see the fault;
- with the corrected guard, 40 free-running rounds of completion against line
  writes: 0 deadlocks, every refused write is 55P03, totals exact.

A consequence, on purpose: an older test expected a line write to *wait* for
the completion. That expectation is obsolete and the test now expects the
immediate refusal (section 6).

## 3. Dispatch, failed delivery and return to warehouse are each one transaction (0100)

Before this pass each was several separate writes from the server action. A
failure half-way left stock deducted with no delivery task, or an order marked
returned with no refund.

New migration `0100_atomic_dispatch_failure_and_return.sql` (+ rollback):

| Function | Does, in one transaction | Who |
|---|---|---|
| `dispatch_order_atomic` | stock deduction (`consume_order_stock`), order → `dispatched`, delivery task created or the same failed task reset, line snapshot | Super Admin, Admin, staff in scope |
| `fail_delivery_atomic` | delivery → `failed` with reason, order → `processing` | assignee or Admin |
| `return_delivery_to_warehouse_atomic` | stock back, delivery → `returned_to_warehouse`, order → `returned`, Coins refund, loyalty reversal | Super Admin, Admin, staff in scope |

All three: `SECURITY DEFINER`, fixed `search_path`, executable by the service
role only, check `auth.role() = 'service_role'`, and re-verify the acting
user's role, active flag and scope inside the database. Replays return the
first result and write nothing.

Three guard triggers stop the same changes being made around the functions:

- `guard_direct_order_fulfilment_transition` — no API role may set an order to
  `dispatched` or `returned`, or move it `dispatched → processing`, directly;
- `guard_direct_delivery_fulfilment_transition` — same for delivery `failed` /
  `returned_to_warehouse` / leaving `failed`;
- `guard_settled_delivery_lines` — once a delivery is delivered, partially
  delivered or returned, its quantities are final **for every API role,
  including Admin sessions and the service key**.

The third guard closes a real gap the race test found: the 0094 line guard
exempted trusted callers, so an Admin or the service key could rewrite a line
after the credit and the points had been calculated from it.

App changes: `lib/delivery/fulfilment.ts` (result checks and error mapping),
`dispatchOrderAction`, `recordFailedDeliveryAction`,
`recordReturnToWarehouseAction` each make one call. The generic Admin
"change order status" action refuses `dispatched` and `returned`. If 0100 is
not installed the actions say so (`FULFILMENT_NOT_INSTALLED`) and write
nothing.

**Known limitation, stated plainly.** Returning a delivery that already has a
shortfall Coins credit is refused before any write
(`DELIVERY_RETURN:RECONCILE`). The existing refund function (0088) refuses such
orders as ambiguous, so the old sequence could never finish correctly: it
marked the order returned and then failed the refund. Such a return now needs
manual reconciliation by an Admin. Building that reconciliation is not part of
this PR.

## 4. Behavioural tests added in this pass

| File | Kind | Count |
|---|---|---|
| `tests/pr126-fulfilment-and-locks.pg.mjs` | real PostgreSQL 17, many sessions | 31 |
| `tests/fulfilment-atomic-actions-db.test.ts` | server actions against a migrated database | 14 |
| `tests/delivery-completion-action-db.test.ts` | server action, proof checks | + 7 |
| `tests/pr126-migration-review-db.test.ts` | catalogue review (service-role-only functions; lock order) | + 2 |

What the real-PostgreSQL script proves, beyond section 2: 12 simultaneous
dispatches of one order produce exactly one dispatch and one stock deduction;
an injected failure at every write of dispatch / fail / return leaves no
partial state; 16 simultaneous returns, 5 rounds, produce exactly one stock
return, one refund and one points reversal; completion, failure and return
racing each other, 15 rounds, end in one consistent state; rollback of 0100
with data present, then re-apply, twice.

## 5. Migration and rollback review (0094–0100)

- 0096 and 0099 were **corrected in place**, with a dated note at the top of
  each file. This is safe only because 0094–0099 have been applied nowhere
  (live database is at 0093). If anyone has applied them to any database, tell
  the reviewer: the corrections would then need a new migration instead.
- 36 functions across the seven migrations: all have a fixed `search_path`,
  none is executable by PUBLIC, and the list of functions a signed-in user may
  call is pinned by a test (10 functions, unchanged in this pass).
- Rollbacks delete no data. The full chain 0100 → 0094 is applied in reverse
  order by a test; 0100 down / up with data was run twice on real PostgreSQL.
- Apply order: backup; 0094 → 0100 in order; deploy the app with or after
  them. Roll back in reverse order.

## 6. Existing tests changed in this pass, and why

No guard or assertion was weakened to make a test pass. Each change is one of
two kinds.

**Logic moved from the server action into SQL — assertion re-pointed to where
the logic now is:**

- `tests/deliveries-workflow.test.ts` — dispatch, failed, return and guard
  checks now read 0100 and the new function names.
- `tests/warehouse-resolver.test.ts` — stock deduction is inside
  `dispatch_order_atomic`.
- `tests/coins-refund-migration.test.ts`, `tests/payment-collections.test.ts` —
  the action no longer calls the shortfall reversal on return (see the
  limitation in section 3); the tests now assert the reversal branch still
  exists in 0094, that 0100 refuses before any write, and that the action has
  no wallet write of its own.

**A direct write that is now refused — the test asserts the refusal, then
performs the step the way the atomic functions do:**

- `tests/delivery-trust-and-loyalty-integrity-db.test.ts` (2 tests),
  `tests/loyalty-trigger-edge-cases.test.ts`, `tests/membership-db.test.ts` —
  the service role's direct `dispatched` / `returned` / `failed` write now
  expects `FULFILMENT_GUARD`. The loyalty rules they test are unchanged.
- `tests/pr126-review-fixes.pg.mjs` — the "line write waits" test now expects
  the immediate `DELIVERY_GUARD:BUSY` refusal.

**Coverage extended:** `tests/pr126-migration-review-db.test.ts` (now sees
0100: seven migrations, 36 functions), `tests/seller-agreement-gate-db.test.ts`
(rollback chain starts at 0100), `tests/helpers/pg-harness.ts` (a
`storage.objects` stand-in so proof checks can run).

## 7. Full checks, PR worktree against `main` (`80007cc`), same sandbox, same day

| Check | `main` | PR |
|---|---|---|
| Typecheck | pass | pass |
| Build | pass | pass |
| Lint | 48 errors, 40 warnings | 48 errors, 40 warnings |
| Test files | 198: 18 failed | 211: 18 failed |
| Tests | 3028: 11 failed, 213 skipped, 2804 passed | 3300: 11 failed, 213 skipped, 3076 passed |

The list of failing tests and files on the PR was compared with `main` by
`diff`: **identical**. No test that passes on `main` fails on the PR. The 11
failures and 48 lint errors exist on `main` and are not fixed here; they are
why the GitHub "Web checks" job is red.

## 8. Real PostgreSQL 17.11, migrations 0001–0100

| Script | Result |
|---|---|
| `tests/pr126-fulfilment-and-locks.pg.mjs` | 31 passed, 0 failed; deadlock victims outside the control run: 0 |
| `tests/pr126-delivery-completion.pg.mjs` | 25 passed, 0 failed |
| `tests/pr126-review-fixes.pg.mjs` | 18 passed, 0 failed |
| `tests/refund-ledger-real-postgres.pg.mjs` | 31 passed |

All four were re-run on the final worktree after the last code change, at full
round counts.

Logs: `docs/readiness-2026-11-14/evidence/`.

## 9. Vercel preview — NOT VERIFIED

The sandbox cannot reach `*.vercel.app`, the Vercel connector answered
"Access denied" for this project, and no test accounts exist. No page was
opened and no journey was clicked through. GitHub's report of the Vercel
check is given in the PR; it only says the build finished.

The preview also uses a database without 0094–0100, so dispatch, delivery
completion, failed delivery, return and the marketplace screen will answer
"not installed" there. That is the intended fail-closed behaviour, not a
working flow.

## 10. Cloudflare "Workers Builds: maharani-mart" — failing, cause not confirmed

The build log could not be read from here. What is known: the repository has
no Cloudflare configuration at all (no `wrangler` file, no adapter; only
`vercel.json`), on `main` or on this branch. A Cloudflare Workers project is
connected to the repository and tries to build every branch. The likely cause
is that connection, not this PR, but that is an inference.

Owner action: Cloudflare dashboard → Workers & Pages → `maharani-mart` →
Settings → Builds → disconnect the repository or turn off branch builds. If
Cloudflare hosting is actually wanted, that is separate work.

## 11. Remaining risks

- ~~`approveReturnAction` is still two separate writes.~~ **Fixed in section 12
  (migration 0101).**
- Returns of deliveries with a shortfall credit need manual reconciliation
  (section 3).
- 11 failing tests and 48 lint errors on `main`, including
  `api-privilege-hardening` (anonymous catalogue read), which may be a real
  defect.
- `zod` advisory; TCS/TDS not built; legal pages are drafts; owner details and
  GSTIN outstanding (`05_OWNER_CHECKLIST.md`).
- Everything in sections 1–5 was tested on PGlite and embedded PostgreSQL 17,
  not on a Supabase project. A staging run is still needed.

---

# Final blocker repair (added later the same day)

Sections 1–11 above describe the state at commit `c1dff87`. Sections 12–17
describe what changed after it. Where the two disagree, these sections win:
the migration range is now **0094–0101**, and the figures in sections 7 and 8
are superseded by section 15.

## 12. Return request approval and rejection are each one transaction (0101)

**The defect.** `approveReturnAction` made two separate database calls: first
`return_order_stock` (stock back on the shelf), then an UPDATE of the request
to `approved`. If the second call failed, the stock was restored and the
request still said `requested`. The old stock function was also callable by
any staff session, with no request at all. For orders older than pack stock it
booked the same goods again on every call (shown as a control in the real
PostgreSQL run).

**The repair.** Migration `0101_atomic_return_request_resolution.sql` adds:

| Object | Purpose |
|---|---|
| `approve_return_request_atomic(request, actor, note)` | The whole approval in one transaction |
| `reject_return_request_atomic(request, actor, note)` | The whole rejection in one transaction |
| `return_request_events` | Append-only history, exactly one row per resolved request |
| `guard_return_request_write` (trigger) | No API role may UPDATE a request or insert one that is already resolved |
| `return_order_stock` | Re-created; **no** API role may call it any more |

What the approval does, in order, inside one transaction:

1. Refuses any caller other than the server (`service_role`). Reads the actor's
   role from `profiles` itself: active **Admin or Super Admin only**.
2. Locks the parent order, then the request (`orders → return_requests →
   order_items → stock rows`, the same parent-first order as 0094–0100).
3. Already approved → answers `replayed: true` and writes nothing. Already
   rejected → refused.
4. Checks the request belongs to the order and retailer, the order is
   `delivered`, and the item (if one is named) is a line of that order.
5. Refuses if the goods were settled with a shortfall credit
   (`RETURN_APPROVE:RECONCILE`), if a seller fulfils the line
   (`SELLER_RETURN`), if more would return than was delivered (`QUANTITY`), or
   if nothing is left to restore (`ALREADY_RESTORED`). All of this is decided
   before any stock moves.
6. Restores the stock, and checks the units restored equal the units computed.
7. Sets the request to `approved`, writes the history row and the audit log.
8. Commits. Any failure at any step undoes all of it.

Rejection is the same shape: Admin or Super Admin, a reason of 3–1000
characters, the status change and the history row together. It contains no
stock, wallet or loyalty statement at all (asserted from the function source).

**Money.** Approval refunds nothing and reverses no points. That is what the
application did before this change; no refund rule for approved returns has
been given, so none was invented. `return_request_events.refund_paise` is
constrained to 0. If the owner decides a refund is due, that is new work.

**Application.** `lib/admin/returns-actions.ts` is now: permission check, Admin
check, UUID check, one RPC. `lib/returns/resolution.ts` turns each database
code into a plain sentence. The retailer is notified only after the commit and
never on a replay. If 0101 is not installed, or the server key is missing, the
action refuses with a clear message and writes nothing.

**Screen.** `/admin/returns` now says approval moves stock only, hides the
buttons from staff, shows whether a request is for one item or the whole
order, and shows the amount and date of any shortfall credit already issued
for that order's delivery.

**Dependencies.** 0101 needs 0100 (`_fulfilment_actor_role`), 0054 / 0089
(pack stock), 0017 (legacy stock) and 0009 (`return_requests`). Apply 0094 →
0101 in order. Roll back 0101 before 0100. The rollback restores the 0054
function and its grants and copies the history into
`return_request_events_rollback_archive` before removing the table.

### Evidence

Real PostgreSQL 17.11, migrations 0001–0101, 19 passed, 0 failed, 0 deadlock
victims (`evidence/pr126-return-requests.real-postgres.log`):

| Required case | Result |
|---|---|
| Successful approval | Pack stock 7 → 10, request `approved`, one history row, audit log names the Admin, wallet and loyalty unchanged |
| Repeated approval | Same Admin, another Admin, Super Admin: `replayed: true`, nothing written, first approver kept |
| Simultaneous approvals | 16 at once on one request, 5 rounds: 1 fresh, 15 replays, stock restored once |
| Two requests for the same goods, approved together | 5 rounds: one restores, the other `ALREADY_RESTORED` |
| Failure between stock and status | Failure injected at `product_packs`, `order_items`, `return_requests`, `return_request_events`, `audit_logs`: full rollback every time; the retry works once |
| Invalid quantities and items | `QUANTITY`, `INVALID_ITEM`, `INVALID_REQUEST`, `ORDER_STATE:dispatched` |
| Unauthorised user | Staff, salesman, retailer, deactivated Admin, unknown id: `NO_PERMISSION` (42501) |
| Rejection | Reason required; no stock, Coins or points; replays; cannot be approved afterwards |
| Approve and reject at once | 15 rounds: exactly one resolution; stock moves only if approval won |
| Already refunded or reconciled | After return-to-warehouse: `ORDER_STATE:returned`. Shortfall credit: `RECONCILE`, credit untouched |
| Partial returns | Line, then whole order: only the remainder is restored; a third request is refused |
| Split orders | Maharani line restores pack stock; seller line refused; seller stock untouched |
| Old route | `return_order_stock` denied to every API role; direct UPDATE → `RETURN_GUARD`; history append-only |
| Consistency sweep | Every resolved request has one matching history row; restored never exceeds deducted; no wallet or loyalty row came from a return request |
| Rollback | With data present: rows kept, 0054 function restored; re-applied twice |

The real server actions against the real migrations (PGlite):
`tests/return-request-actions-db.test.ts`, 13 tests, all pass. They cover the
same cases through `approveReturnAction` / `rejectReturnAction`, plus: staff
stopped before any database call, a forged Admin role refused by the database,
missing server key, missing migration, and raw database text never shown.
PGlite has one connection, so concurrency is proven only by the real
PostgreSQL script.

## 13. Shortfall-credit returns stay blocked — owner decision needed

The refusal rule is kept in both places (`RETURN_APPROVE:RECONCILE` in 0101,
`DELIVERY_RETURN:RECONCILE` in 0100). No Coins are reversed or issued again.

A reconciliation workflow was **not** built. It cannot be defined safely
without rules that only the owner (with the CA) can give:

1. When goods are returned from a delivery that already got a shortfall
   credit, is any further refund due, and on what basis (per unit delivered,
   net of the credit, none)?
2. Is the earlier shortfall credit ever taken back, and when?
3. What happens to loyalty points earned on that delivery?
4. Who may approve it, and is a second approver needed?

Until those are answered, the manual route is:

- Open `/admin/returns`. The request shows the credit amount and date.
- Reject the request with a reason such as "handled manually, shortfall credit
  already issued".
- If goods physically came back, book them with the existing stock adjustment
  screen (`createStockAdjustmentAction`), with a note naming the order.
- If the owner decides money is due, record it with the existing wallet
  adjustment (`recordAdjustmentAction`), with a note naming the order and the
  earlier credit.

Both tools already write their own audit rows. A fully delivered line on the
same order is not affected and can be approved normally (tested).

## 14. Re-audit of 0094–0100

Applied anywhere? Checked read-only on `fhrmsrumsraprvutrpeo`: last migration
is `0093`, none of the PR's functions exist, there are no preview branches.
So 0094–0100 are applied nowhere known, and 0101 is a new forward migration.
None of 0094–0100 was edited in this pass.

| Point | State | Where it is checked |
|---|---|---|
| Proof exists in the private bucket, right order, right uploader | Intact | `delivery-completion-action-db`, real PG completion script |
| Completion is transactional | Intact | real PG completion script, 25/0 |
| Lock order, no deadlock | Intact | real PG locks script, 31/0, 0 victims |
| Direct protected status writes blocked | Intact | `FULFILMENT_GUARD` tests |
| Dispatch, failed delivery, return are atomic | Intact | `fulfilment-atomic-actions-db`, real PG |
| Delivered quantities final | Intact | `guard_settled_delivery_lines` tests |
| Marketplace switch off by default | Intact | checked after two rollback/re-apply rounds |
| Seller agreement, owner and CA approval | Intact | `seller-agreement-gate-db` |
| Grants, `search_path`, RLS | 42 functions, none open to PUBLIC, fixed `search_path`; signed-in sessions may call the same 10 as before; 0101 added none | `pr126-migration-review-db` |
| Rollback chain | 0101 → 0094 and back, twice | same file |

One thing found and fixed here: the first draft of 0101 used a trigger to block
`TRUNCATE` on the history table. The repository forbids that word in recent
migrations (`tests/premium-upgrade.test.ts`). The trigger was removed rather
than the test changed; API roles hold no truncate privilege on the table
(asserted on real PostgreSQL).

## 15. Full checks on the final code, against `main` (`80007cc`)

Same sandbox, same Node and pnpm, same commands (`pnpm test`, `pnpm typecheck`,
`pnpm lint`, `pnpm build`).

| Check | `main` | PR (final) |
|---|---|---|
| Typecheck | pass | pass |
| Build | pass | pass |
| Lint | 48 errors, 40 warnings | 48 errors, 40 warnings |
| Test files | 198: 18 failed | 212: 18 failed, 194 passed |
| Tests | 3028: 11 failed, 213 skipped, 2804 passed | 3314: 11 failed, 213 skipped, 3090 passed |

- Failing tests and files: compared by `diff`, **identical** to `main`.
- Lint errors: compared per file and message, **identical** to `main`. The PR
  adds none. Every file added or changed in this pass is clean, with no
  suppression comment.
- Fixed in this pass: none of the baseline failures. They are in files this PR
  does not otherwise touch.

Baseline lint errors (on `main`, not fixed): 12 `no-explicit-any` in
`tests/production-probe.test.ts` and `tests/mobile-retailer-upgrade-api.test.ts`;
36 React render-purity errors in 14 existing files, including the cart,
checkout, notification list and infinite scroll. Fixing the 36 means changing
how those screens render. That was not done inside a database-integrity PR
with no browser available to check the result. It should be its own PR.

Baseline test failures (on `main`, not fixed): `security-phase0-app` (3),
`membership-db` (1), `api-privilege-hardening` (1, anonymous catalogue read —
may be a real defect), and 11 database suites that fail in set-up because the
shared `createPack` fixture is broken.

Real PostgreSQL 17.11, migrations 0001–0101, all re-run on the final code:

| Script | Result |
|---|---|
| `tests/pr126-return-requests.pg.mjs` | 19 passed, 0 failed, 0 deadlock victims |
| `tests/pr126-fulfilment-and-locks.pg.mjs` | 31 passed, 0 failed, 0 deadlock victims outside the control run |
| `tests/pr126-delivery-completion.pg.mjs` | 25 passed, 0 failed |
| `tests/pr126-review-fixes.pg.mjs` | 18 passed, 0 failed |
| `tests/refund-ledger-real-postgres.pg.mjs` | 31 passed |

Command, for each script:

```
mkdir /tmp/pgdeps && cd /tmp/pgdeps && npm install embedded-postgres@17.11.0-beta.19 pg
NODE_PATH=/tmp/pgdeps/node_modules node tests/<name>.pg.mjs
```

## 16. GitHub checks

"Web checks" runs typecheck → lint → test → build and stops at the first
failure. Lint fails on the 48 baseline errors, so **tests and build do not run
in CI. They are skipped, not passed.** The test and build results in section 15
come from the sandbox only. The same job fails the same way on `main`.

Cloudflare "Workers Builds" still fails (section 10). Vercel reports a finished
build; the preview was not opened (section 9).

## 17. What is still open

- Refund rule for approved returns, and the shortfall reconciliation rules
  (section 13) — owner and CA.
- 48 baseline lint errors keep CI red and stop CI from running tests.
- 11 baseline test failures.
- No staging database has 0094–0101. Nothing was exercised through a deployed
  app. Preview in a browser: **NOT VERIFIED**.
- Seller-fulfilled lines cannot be returned through a return request; they are
  refused. A seller return flow does not exist.
- `zod` advisory, TCS/TDS, legal drafts, owner details and GSTIN — unchanged.

---

# Release-review completion (latest pass, same day)

Started from pushed commit `d72237e`. The earlier findings were re-run, not
taken on trust. Nothing was applied to the live database (still at `0093`,
checked read-only), nothing was deployed or merged, the PR stays a Draft.
The commit that contains this section is named in the PR description.

Sections 15, 16 and 17 above describe the state **before** this pass and are
kept as history. The current figures are in section 23.

## 18. Same product on two lines of a legacy order — reproduced and fixed (0101)

**Reproduced.** In legacy inventory mode (orders that are not on pack stock),
`0101` decided whether a line was "already returned" by looking for a `return`
stock movement for the **order and product**. An order with the same product on
two lines (two packs of one product) therefore had its second, legitimate line
refused with `RETURN_APPROVE:ALREADY_RESTORED` after the first line was
approved. Evidence: the new tests failed on unmodified `d72237e`.

**Fix (0101 edited in place — it has never been applied anywhere).**

- New table `public.order_item_legacy_stock_returns`, one row per order line
  (primary key `order_item_id`), append-only, RLS on, Admin read only, no write
  grant to any API role. It records that a line's stock came back.
- The "what can still come back" calculation is now per order line.
- A product-level cap stays in force: across all lines of one product in one
  order, never more comes back than the lines took out, counting stock
  movements written before this table existed.
- Duplicate protection is unchanged in strength: a repeated approval, a second
  request for the same line, and a whole-order request after its lines were
  returned all restore nothing.
- Rollback archives the new table row for row before dropping it.

**Tests on real PostgreSQL 17.11** (`tests/pr126-return-requests.pg.mjs`):
one order with two lines of one product; both restored exactly once; repeats
restore nothing; 8 rounds of simultaneous approvals restore once; partial
(single-line) returns; a failure injected at each write undoes everything;
movements written before 0101 are respected; rejection changes no stock, wallet
or loyalty row; rollback and re-apply with data present.

## 19. The 11 failing tests and the 11 suites that could not start

Each was examined. Outcome: **3 real defects fixed, the rest were tests written
before rules that the database now enforces.** No test was deleted or skipped.
Where a test's set-up was out of date it was changed to go through the route the
product now requires, and the original assertion was kept or made stricter.

Real defects fixed:

| Defect | Fix |
|---|---|
| Anonymous read of `products` / `product_packs` (and `product_images`, `product_pack_images`, `inventory_area_totals`, which read them) raised `permission denied for function product_is_sale_eligible`. Recorded in `0086` as a known unresolved issue. `sellers_select` had the same fault. | New migration `0102`: the same three policies, same expressions, now `TO authenticated`. Anonymous callers get **no rows and no error**. No function grant changed; nobody sees a row they could not see before. Whether the catalogue should be browsable without sign-in is an owner decision and was **not** taken. |
| A seller changing quantity tiers no longer sent the offer back for moderation. Cause: the stock-movement exemption added in this PR's `0097` also swallowed the re-moderation signal. | `0097` edited in place: the exemption does not apply when re-moderation was requested. |
| `tests/category-tier-pricing-db.test.ts` had an assertion written `.toBeNull` (no call), so it asserted nothing. | Now `.toBeNull()`; it passes. |

Out-of-date tests, by cause:

| Rule now enforced | Tests re-pointed |
|---|---|
| 0086/0087: a product is sold only from an owner-classified category, with a classification, evidence and an approved review; facts of a product on sale change only by deactivate → edit → re-review → activate | `security-phase0-db`, `mobile-checkout-atomic-db`, `simplified-pack-stock-db`, `data-retention-cleanup`, `security-definer-hardening-db`, `ai-retention`, `category-tier-pricing-db`, `api-execute-revocation-flows`, `admin-taxonomy-db`, `security-phase0-app` |
| 0086/0087/0098: a seller trades only after review, agreement acceptance and the marketplace switch | `seller-marketplace-db`, `release-stock-authorization`, `phase-2d1-compliance-flow-db` |
| 0092: a refund retry returns the first result and writes nothing | `seller-marketplace-db` |
| 0094: order-earned loyalty points come only from verified delivery | `membership-db` |
| 0097/0100/0101: cancel, dispatch and stock return only through the atomic functions | `release-stock-authorization`, `simplified-pack-stock-db` (each now also asserts the direct route is refused) |
| Source text wrapped differently from the pinned string | `phase-2d1-compliance-corrections`, `phase-2d1-concurrency-contract` |
| A fixture date (scheme ending 2026-11-05) had passed | `mobile-catalog-search` (clock pinned inside that suite) |

The shared fixture helper `tests/helpers/pg-harness.ts` now builds products and
sellers through the real review steps; it bypasses nothing.

## 20. Lint: 48 errors and 40 warnings → 0 and 0

No rule was disabled, no `eslint-disable` was added (five unused ones were
removed), the configuration is the same two presets, and no `any` was added.

- 12 `any` in two test files: replaced with real types.
- 36 React errors:
  - Components declared inside a component (control centre, user detail):
    moved to module level. The three control-centre tabs with form state were
    losing that state on every parent re-render; they now keep it.
  - Clock read during render in four **server** pages: taken from
    `lib/datetime/request-time.ts`, a documented once-per-request reading.
  - Totals summed by reassigning variables inside `.map` (cart, checkout): the
    map returns each line's figures and a loop sums them in the same order.
  - State set inside an effect (install prompt, search field, compare grid,
    product card, gallery, infinite scroll): replaced with derived values,
    render-time prop resets, or `useSyncExternalStore` for browser storage.
  - Refs written during render (infinite scroll): written in an effect that
    runs before the observer effect.
- 40 warnings: unused imports, variables and dead code removed.

Regression test: `tests/react-render-purity-regressions.test.tsx` (11 tests:
install prompt, search suggestions, compare selection, favourite flag). **The
same 11 tests also pass against the old components at `d72237e`**, which is the
evidence that behaviour did not change. Two intended differences: the compare
selection now also follows products loaded later by scrolling, and a dismissed
install prompt stays dismissed for the page even if storage refuses the write.

Not covered by a browser test: cart and checkout totals (server pages; covered
by typecheck, build and the existing pricing tests only).

## 21. Migration 0102 and migration order

`0102_anonymous_read_policies_fail_closed.sql` with
`supabase/rollbacks/0102_anonymous_read_policies_fail_closed.down.sql`.
Policies only; no data, no grants. The rollback restores the previous policies
(and with them the previous error).

Apply `0094 → 0102` in order. Roll back `0102 → 0094`. `0101` must be rolled
back before `0100`. Verified: the whole chain rolls back and re-applies twice
on one database (`tests/pr126-migration-review-db.test.ts`), and 0101 and 0102
roll back and re-apply with data present on real PostgreSQL.

## 22. Real PostgreSQL 17.11, migrations 0001–0102

| Script | Passed | Failed | Skipped |
|---|---|---|---|
| `pr126-return-requests.pg.mjs` | 27 | 0 | 0 |
| `pr126-fulfilment-and-locks.pg.mjs` | 31 | 0 | 0 |
| `pr126-delivery-completion.pg.mjs` | 25 | 0 | 0 |
| `pr126-review-fixes.pg.mjs` | 18 | 0 | 0 |
| `refund-ledger-real-postgres.pg.mjs` | 31 | 0 | 0 |

Deadlock victims: 0. Logs in `evidence/`. These scripts are **not** run by
GitHub Actions (they need a PostgreSQL binary the workflow does not install);
they are sandbox evidence a reviewer can reproduce with the commands in
section 15.

## 23. Full checks, in order, on the final code

| Step | Command | `main` (`80007cc`) | PR, final code |
|---|---|---|---|
| Typecheck | `corepack pnpm run typecheck` | pass | pass |
| Lint | `corepack pnpm run lint` | 48 errors, 40 warnings | **0 errors, 0 warnings** |
| Tests | `corepack pnpm test` | 198 files, 18 failed; 3028 tests: 11 failed, 213 skipped, 2804 passed | **213 files, 0 failed; 3328 tests: 3328 passed, 0 failed, 0 skipped** |
| Build | `corepack pnpm run build` | pass | pass |

Same sandbox, same commands. The `main` figures were measured earlier the same
day. The 213 tests that `main` skips sit behind suites that fail in set-up;
they now run.

## 24. GitHub, Vercel, Cloudflare

- **GitHub "Web CI"** runs typecheck → lint → tests → build. With lint clean it
  no longer stops at lint. The result for the pushed commit is recorded in the
  PR description, not here, because it only exists after the push.
- **Vercel**: preview build status is read from the commit's check runs. The
  sandbox cannot reach `*.vercel.app`, so the preview was **not opened in a
  browser — NOT VERIFIED**. No production deployment was made.
- **Cloudflare "Workers Builds: maharani-mart"**: this repository has no
  Cloudflare configuration (no `wrangler` file, no OpenNext adapter, no
  Cloudflare dependency); the app is deployed on Vercel. The check comes from a
  Cloudflare project connected to the repository and cannot pass as the
  repository stands. It was not disabled or changed. **Owner action:** in the
  Cloudflare dashboard, Workers & Pages → `maharani-mart` → Settings → Builds,
  disconnect the repository or turn off builds for non-production branches. The
  build log is not readable from here, so the exact error is **not confirmed**.

## 25. Three separate questions

**Code review readiness — yes.** Typecheck, lint, full tests and build pass
locally with nothing failing or skipped; migrations 0094–0102 and rollbacks are
tested on real PostgreSQL. Subject to GitHub CI being green on the pushed
commit (see the PR description).

**Preview / staging verification — not done.** No database has 0094–0102
applied, so no flow was exercised through a deployed app. The preview was not
opened in a browser. A reviewer needs a disposable Supabase project (not
`fhrmsrumsraprvutrpeo`) with 0001–0102 applied.

**Production launch readiness — no.** Still required:

- Owner + CA, in writing: refund rule for approved returns (today stock only,
  no Coins, no loyalty reversal); reconciliation rules for returns after a
  shortfall credit (section 13; those returns stay blocked); TCS/TDS handling
  (not built).
- Owner: legal identity, GSTIN, addresses, support details, final legal pages
  (`05_OWNER_CHECKLIST.md`); whether the catalogue may be seen without sign-in
  (today: no); the Cloudflare project.
- Marketplace seller offers stay OFF until owner and CA approvals are recorded
  and each seller has accepted the agreement (0098).
- Engineering: staging run, backup and rollout plan for 0094–0102, a return
  flow for seller-fulfilled lines (does not exist), the `zod` advisory.
