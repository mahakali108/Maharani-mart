# PR #126 — final security and reliability repair

Date: 2026-11-14. Follows `07_FINAL_COMPLETION.md` and corrects two things in it.

Nothing here was applied to production, deployed or merged. The PR stays a
Draft. Every result was produced in the sandbox on the PR branch. Where a check
could not be run, it says **NOT DONE** / **NOT VERIFIED** and why.

## Verdict

**READY FOR INDEPENDENT REVIEW** for the code, migrations and tests.
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

- `approveReturnAction` (`lib/admin/returns-actions.ts`) is still two separate
  writes (stock return, then the request status). Not changed in this PR.
- Returns of deliveries with a shortfall credit need manual reconciliation
  (section 3).
- 11 failing tests and 48 lint errors on `main`, including
  `api-privilege-hardening` (anonymous catalogue read), which may be a real
  defect.
- `zod` advisory; TCS/TDS not built; legal pages are drafts; owner details and
  GSTIN outstanding (`05_OWNER_CHECKLIST.md`).
- Everything in sections 1–5 was tested on PGlite and embedded PostgreSQL 17,
  not on a Supabase project. A staging run is still needed.
