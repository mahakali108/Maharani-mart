# Independent review fixes — PR #126 — 14 November 2026

This file records the four fixes requested by the independent review and what
was actually proven for each. Nothing here has been applied to production,
merged or deployed. The verdict stays **NOT READY TO LAUNCH**.

## Summary

| Fix | Finding | Migration | Status | Proof |
|---|---|---|---|---|
| 1 | SEC-16 delivery snapshot tampering | 0096 | PASS (in PR, not applied live) | 34 database tests; 4 real-PostgreSQL tests incl. two lock races |
| 2 | SEC-06 split-order cancellation not atomic | 0097 | PASS (in PR, not applied live) | 27 database tests; 7 real-PostgreSQL multi-session tests; existing 31-test real-PostgreSQL script still passes |
| 3 | SEC-17 seller agreement not enforced | 0098 | PASS for the database gate; FAIL for the screens (see "Not done") | 20 database tests; 2 real-PostgreSQL tests; 8-role matrix |
| 4 | Vercel preview blocked | — | See section 4 | — |

## 1. SEC-16 (High) — delivery snapshot integrity — migration 0096

**Defect.** 0094 computed the shortfall refund and loyalty value from
`order_delivery_items.quantity_ordered`, a copy that delivery staff could
rewrite, re-point at another order line, delete or forge. A staff member could
therefore inflate or erase a refund.

**Repair.**
- The copy is now checked against the original order line
  (`coalesce(order_items.quantity_pieces, quantity)`) on every write; identity
  columns are immutable; lines cannot be deleted or forged by staff.
- Only the assigned person may record delivered / missing / damaged, only while
  the task is open, and the three must not exceed the ordered quantity.
- Completion is refused unless every line is fully accounted for.
- The guard locks the delivery row, so a quantity write and a completion cannot
  interleave.
- `completeDeliveryAction` also compares the snapshot with the order lines
  before any settlement and stops with a plain message if they differ.
- Re-dispatch resets the snapshot through the trusted writer.

## 2. SEC-06 (High) — atomic cancellation of split orders — migration 0097

**Defect.** `cancel_order_coins_atomic` refused split (multi-seller) orders, so
the app fell back to a two-step status change and refund. Closing one
sub-order was likewise several separate writes.

**Repair.**
- One transaction cancels the parent, every sub-order, restores stock, refunds
  every per-seller Coins debit and releases the coupon. Lock order is fixed
  (order → credit account → sub-orders by id) so sessions cannot deadlock.
- It refuses, changing nothing, when: a sub-order is already being fulfilled or
  settled; or the wallet debits do not add up to the sub-order Coins shares
  ("Split order cancellation requires reconciliation…").
- `close_sub_order_atomic` closes one sub-order the same way; closing the last
  one cancels the parent and releases the coupon once.
- Direct `cancelled` / `returned` status writes by any API role, including the
  service role, are refused (`CANCEL_GUARD`). The app no longer falls back to
  the two-step path when the database refuses; it falls back only when the
  function does not exist yet (app deployed before the migration).
- Residual risk R-2 in `02_SECURITY_AUDIT.md` is closed by this.

**Defect found on the way (0069).** The trigger function
`remoderate_seller_offer_terms` raised "An active seller membership is
required." on *any* offer update from a signed-in non-admin. A retailer
cancelling an order that contained seller stock could therefore never get the
stock put back. 0097 exempts stock-only changes. The function also had the
default PUBLIC execute grant; 0097 removes it (found by the real-PostgreSQL
catalogue check).

**Regression caught during this work.** The first version of 0097 cancelled a
split order whose sub-orders had no matching wallet debit. The existing
real-PostgreSQL script failed on it; the up-front reconciliation check was
added and a test written.

## 3. SEC-17 (High) — seller agreement and marketplace switch — migration 0098

**Defect.** Seller acceptance of the agreement was recorded but nothing
depended on it, and nothing stopped third-party offers going live before the
owner and the chartered accountant had signed off TCS/TDS handling.

**Repair.**
- A marketplace switch that ships **OFF**. Only a Super Admin can turn it on,
  and only with two distinct approval references (owner and CA). The log is
  append-only.
- While it is off, or while the seller's owner has not accepted the *current*
  agreement version, an offer cannot be created live, activated or approved,
  and seller stock cannot be put on an order. Deactivating, rejecting and stock
  movements are never blocked.
- The current version of each document is held in the database; accepting an
  out-of-date version is refused.
- The app checks the same gate before the write and fails closed.

## 4. Vercel preview

Root cause: the first commit on this branch was authored as
`Arena Agent <agent@arena.ai>`, which GitHub cannot match to an account, so
Vercel declined to build it. No Vercel setting or environment variable was
changed. The fix commit is authored and committed as the repository owner's
verified GitHub identity. Result on commit `78a570e`: the GitHub "Vercel" status changed from failure to
**success — "Deployment has completed"**.

Limits of that statement:
- It was read from the GitHub commit status. The Vercel connector refused the
  read ("Access denied"), so the deployment state and preview URL were not
  confirmed inside Vercel itself.
- **No page of the preview was opened.** The sandbox cannot reach
  `*.vercel.app`. Browser verification is therefore still NOT DONE.
- "Web checks" still fails at the Lint step (48 errors that exist on `main`);
  because lint fails first, CI never runs the tests or the build.
- A "Workers Builds: maharani-mart" (Cloudflare) check appeared on this commit
  and failed. It was not present on the previous commit or on `main`'s latest
  check list, its log is not readable from here, and it was not investigated.

## Real PostgreSQL results (PostgreSQL 17.11, migrations 0001–0098, several sessions)

Script: `tests/pr126-review-fixes.pg.mjs` — **16 passed, 0 failed**.
Log: `evidence/pr126-review-fixes.real-postgres.log`.

- Second cancelling session waits, then refunds nothing.
- First session rolls back; the waiting session performs the whole refund.
- 16 simultaneous sessions (retailer, admin, service) refund exactly once.
- Whole-order cancel, both sub-order closes and the legacy status call fired
  together, 25 rounds: no deadlock, exact totals.
- Two admins close the two sub-orders at once: parent cancelled once, coupon
  released once.
- A failing session changes nothing and does not affect the next one.
- A direct status write racing the atomic call is refused.
- Snapshot: staff cannot rewrite, re-point, delete or forge a line; completion
  and a staff quantity write wait on each other in both orders; refund and
  loyalty follow the original order quantity (₹1,000 / 10 pieces, 2 missing →
  ₹200 and 8 points).
- Two Super Admin switch decisions are serialised; history keeps both.
- Seller gate for every role, in all three states.
- 25-row permission matrix across anonymous, retailer, other retailer, delivery
  staff, other staff, admin, super-admin and service role.
- New objects: no anonymous execute, fixed `search_path`, RLS on new tables.
- Rollback 0098 → 0094 in order on a database holding data, then re-apply.

Existing script `tests/refund-ledger-real-postgres.pg.mjs` — **31 passed**
with 0096–0098 applied. Log: `evidence/refund-ledger.real-postgres.log`.

These scripts are not part of `pnpm test`; they need `embedded-postgres` and
`pg`, which are not project dependencies. They were run by hand in the sandbox.

Matrix cells shown in lower case (`y`, `.`) in the log were observed, not
asserted. Two are worth the owner's attention:
- Admin and super-admin filing a privacy request for themselves returned `.`
  (refused). The request types are for retailers; this is expected but unasserted.
- Admin, super-admin and service role can set `acknowledged_at` on a support
  ticket directly. That is by design for staff handling, but there is no
  audit trail of who set it.

## Independent second pass on these fixes

| Question | Result |
|---|---|
| Can any API role still change a refund through the snapshot? | No — refused for all 8 roles on real PostgreSQL. |
| Can a split order be refunded twice or half-cancelled? | Not reproduced under 16 sessions and 25 mixed rounds. |
| Does a refusal leave partial changes? | No — verified row by row after each refusal. |
| Does the app continue after a refusal? | No — three cancel paths return early; tested. |
| Can a seller go live with the switch off or without acceptance? | No — refused at the database for every role including service role. |
| Do the rollbacks work with data present? | Yes — 0098 → 0094 and back. The 0098 rollback keeps the approval log in an archive table. |
| Did the change widen any grant? | One: `third_party_offers_enabled()` is executable by signed-in users (a single true/false, no row data). Added to the reviewed allow-list in `tests/migration-catalog-invariants.test.ts` with the reason. |

## Tests rewritten, not just added

Stated plainly because changing an existing test deserves scrutiny:

- `tests/sub-order-cancellation-safety.test.ts` — two tests asserted the old
  multi-step sub-order close. They now assert the single atomic call and that
  no legacy fallback runs. Four tests added.
- `tests/atomic-cancellation-wiring.test.ts` — updated for the new
  cancelled / refused / unavailable outcome.
- `tests/mobile-retailer-upgrade-api.test.ts`,
  `tests/seller-marketplace-actions.test.ts` — mock set-up only (new export;
  gate mocked open so the existing offer tests still reach their assertions).
- `tests/migration-catalog-invariants.test.ts` — one allow-list entry (above).

## Not done

- **No Super Admin screen** for the marketplace switch or for publishing a new
  document version. The database functions exist and are tested; today they
  can only be called from SQL. Acceptable while the switch must stay off.
- **No seller-portal message** explaining the gate state before the seller
  tries to act; the seller sees the refusal message after trying.
- **`completeDeliveryAction` has no behavioural app test.** The new snapshot
  check is pinned by source-level assertions and by the database tests only.
- **No browser test** of any of this.
- TCS/TDS handling itself is still not built. The switch only prevents selling
  without it.
- Pre-existing failures (18 test files, lint) are unchanged and not repaired.

## Order of application (owner's decision; not done here)

Deploy the application first, take a backup, then apply
0094 → 0095 → 0096 → 0097 → 0098. Roll back in the reverse order using
`supabase/rollbacks/`. After 0097, any tool or script that writes
`status = 'cancelled'` directly will be refused and must use the functions.
