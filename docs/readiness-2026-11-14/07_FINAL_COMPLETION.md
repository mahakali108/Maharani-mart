# PR #126 — final completion pass

Nothing here was applied to production, deployed or merged. The PR is a Draft.
Every result below was produced in the sandbox on the PR branch. Where a check
could not be run, it says **NOT DONE** and why.

## Verdict

**READY FOR INDEPENDENT REVIEW** — for the code, migrations and tests.

Two items of the brief are **NOT DONE** and the reviewer or owner must do them:

1. **Browser verification of the Vercel preview — NOT DONE.** The sandbox
   cannot reach `*.vercel.app` (connection refused by the network policy), and
   no test accounts exist. No login, retailer, seller, Super Admin, delivery,
   legal-page, cancellation or wallet journey was clicked through. Preview URL:
   `https://maharanitraders-git-arena-2cd4aa4b-70634d-mahakali108s-projects.vercel.app`
   (GitHub reports the Vercel deployment as successful; that is the only
   evidence held). The preview also talks to a database that does not have
   0094–0099, so delivery completion and the marketplace screen will report
   "not installed" there until a staging database has them.
2. **Cloudflare build log — NOT READ.** See "Cloudflare" below; the cause is
   reasoned from repository evidence, not from the build log.

The launch verdict in `00_LAUNCH_READINESS.md` is unchanged: **NOT READY TO LAUNCH**.

## 1. Atomic delivery completion (SEC-10, delivery part)

`completeDeliveryAction` used to make about ten separate writes. It now
validates the form, computes the OTP digest in Node, and makes **one** call:
`complete_delivery_atomic` (migration 0099). Inside one transaction the function:

| # | Requirement | Where |
|---|---|---|
| 1 | Locks order → delivery → delivery lines, always in that order | `for update` ×3 |
| 2 | Delivery open, order `dispatched` / `delivered` | `NOT_OPEN`, `ORDER_STATE` |
| 3 | Actor exists, is active, has the delivery role, is the assignee or an Admin | `NO_PERMISSION`, `NOT_ASSIGNED` |
| 4 | OTP: keyed digest computed on the server compared with the stored hash; the plain OTP and the secret never reach the database | `p_otp_digest` |
| 5 | Wrong attempts counted under the row lock; locked at 10; replay refused | `OTP_LOCKED`, `ALREADY_COMPLETED` |
| 6–7 | Every line checked against the original order item and quantity; delivered + missing + damaged = ordered | `SNAPSHOT_*`, `UNKNOWN_LINE`, `MISSING_LINES`, `DUPLICATE_LINES`, `QUANTITY_SPLIT` |
| 8 | Proof references must sit in this order's folder | `PROOF` |
| 9–10 | Quantities, completion fields, order status | same transaction |
| 11 | Shortfall credit computed by the database from the original order lines | `order_shortfall_coins` (0094) |
| 12 | Loyalty on delivered value; a reversal if points were already given on the full value | `_order_loyalty_points_due` |
| 13 | Return window snapshot; audit rows attributed to the delivery person | — |
| 14 | Any failure rolls everything back | one transaction |

Idempotency: the app sends a key (`dc1:` + SHA-256 of the request). A repeat
with the same key, actor and OTP returns the stored result and writes nothing.
Only `service_role` may execute the function; it re-verifies the actor itself.
The retailer is notified only after the call returns committed, and not on a replay.

A wrong OTP returns a result instead of raising, so the attempt count is
committed. A validation error is raised and is not counted as an OTP attempt.

**Deployment order matters:** the new app code fails closed with a clear
message if 0099 is absent. Apply 0099 before or with the app; roll the app back
before rolling 0099 back.

**Not changed:** return-to-warehouse and dispatch are still several writes
(SEC-10 remains open for those two).

## 2. Behavioural tests

| Suite | In `pnpm test`? | Result |
|---|---|---|
| `tests/delivery-completion-action-db.test.ts` — the real server action against the real 0099 function (PostgreSQL 16, PGlite) | Yes | 32 passed |
| `tests/pr126-delivery-completion.pg.mjs` — real PostgreSQL 17.11, many sessions | **No — run by hand** | 25 passed, 0 failed (run 4 times) |
| `tests/pr126-review-fixes.pg.mjs` — re-run on 0001–0099 | **No — run by hand** | 18 passed, 0 failed (run 3 times after the fix below) |
| `tests/refund-ledger-real-postgres.pg.mjs` — re-run on 0001–0099 | **No — run by hand** | 31 passed |

Logs: `evidence/pr126-delivery-completion.real-postgres.log`,
`evidence/pr126-review-fixes.real-postgres.log`, `evidence/refund-ledger.real-postgres.log`.
To run: `npm install --prefix /tmp/pgdeps embedded-postgres@17.11.0-beta.19 pg`, then
`NODE_PATH=/tmp/pgdeps/node_modules node tests/<file>`. They are not wired into
CI because they download a PostgreSQL binary.

Each case the brief listed, and where it is proven:

| Case | PGlite (in `pnpm test`) | Real PostgreSQL |
|---|---|---|
| Valid OTP completes | yes | yes |
| Invalid OTP refused, counted, locks at 10 | yes | 40 simultaneous wrong OTPs → exactly 10 counted |
| Unassigned staff refused | yes | yes |
| Another order's proof refused | yes | — |
| Missing / duplicated lines refused | yes | — |
| Tampered quantities / snapshot refused | yes | — |
| Duplicate completion → no second credit | yes | yes |
| Simultaneous attempts → exactly one settlement | serialised only (PGlite has one connection) | 24 sessions × 10 rounds |
| Wallet failure rolls back delivery and order | yes | yes |
| Order-update failure rolls back all | yes | yes |
| Loyalty failure rolls back all | yes | yes |
| Lost response then retry → no duplicate | yes | yes |
| Completion racing an Admin cancellation; no deadlock in 20 rounds | — | yes |

Mutation check (done once, by hand, then reverted): switching off the OTP
comparison, the assignee check, the quantity-split check and the snapshot check
in 0099 each made at least one test fail. The replay-actor check was not mutated.

## 3. Marketplace approval screen

- **Super Admin:** `/admin/marketplace-launch` (menu: "Marketplace Launch", Super
  Admin only). Shows the status, the full approval history, and the Seller
  Agreement version in the build against the version the database enforces. One
  form records a decision: enabling needs an owner approval reference, a CA
  approval reference, a reason and a typed confirmation; disabling needs a
  reason only. A second form makes the build's agreement version the enforced one.
- **No bypass:** both actions run as the signed-in Super Admin and call the 0098
  functions. The service role is not used (and the database refuses it). The
  version published is read from the server's register, never from the form.
  No reference is pre-filled; nothing was entered by me.
- **Sellers:** dashboard, offers and profile pages show one of: "The marketplace
  is not open to sellers yet", "The current Seller Agreement needs to be
  accepted" (owner is sent to accept; a team member is told only the owner can),
  or a neutral "cannot go live right now" if the status cannot be read.
- **Default:** OFF. No decision on record = closed.
- Tests: `tests/marketplace-launch-ui-db.test.tsx`, 34 passed, real actions
  against real 0098. Includes "the app believes Super Admin but the database
  session is an Admin → refused by the database".

Limit: publishing a *new* agreement version needs a developer to change the
text and version in `lib/legal/documents.ts` first. That is deliberate — the
enforced version must have text — but it is not a self-service editor.

## 4. Migration and rollback review (0094–0099)

Executable in `tests/pr126-migration-review-db.test.ts` (8 passed, in `pnpm test`).

| Check | Result |
|---|---|
| Order 0094 → 0099 unbroken, each with a rollback | PASS |
| All 29 functions have `search_path = public, pg_temp` | PASS |
| No PUBLIC execute; no anon execute on any SECURITY DEFINER function | PASS |
| Signed-in sessions can call exactly 10 named functions, each of which checks the caller | PASS |
| Service role cannot record a marketplace approval or call internal helpers | PASS |
| New tables: RLS on; anon nothing; signed-in SELECT at most | PASS |
| Whole chain rolled back 0099 → 0094 and re-applied, twice, on one database | PASS |
| Rollbacks delete no rows and drop no columns | PASS **after the fixes below** |

**Defects found in this review and fixed:**

1. **0095 rollback dropped `legal_document_acceptances` and three columns**
   (data loss, with only a warning). It now keeps the table, rows and columns
   and removes API access instead. Tested with data present, twice, then re-applied.
2. **0098 rollback lost data on a second rollback.** The archive was created
   only if absent, so approvals recorded after a re-apply were dropped with the
   live table. It now appends to the archive every time, and also archives the
   published-version register. Tested.
3. **`third_party_offers_enabled()` was callable by any signed-in user**, which
   had needed a new allow-list entry in `tests/migration-catalog-invariants.test.ts`.
   The grant was removed (sellers use `seller_offer_gate_status`, which checks
   who is asking) and **that test file is now identical to `main`.**
4. **0099's idempotency table had RLS on but no policy**, which the same
   existing test flags. An explicit deny-all policy was added rather than
   extending the test's allow-list.

Still true and unavoidable: rolling back 0098 removes the database gate
(the app still refuses, failing closed). Rolling back 0094 re-opens SEC-02.

Live data: the live project had 0 users, orders and ledger rows when read on
14 Nov 2026. None of these migrations rewrites existing rows.

## 5. Existing tests: exact changes against `main`

| File | Change | Intent kept? |
|---|---|---|
| `tests/migration-catalog-invariants.test.ts` | **None — identical to `main`** (earlier allow-list entry removed, see 4.3) | Yes |
| `tests/atomic-cancellation-wiring.test.ts` | New file in this PR; nothing on `main` to weaken | n/a |
| `tests/sub-order-cancellation-safety.test.ts` | Two tests pinned the old three-call sequence (`set_sub_order_status` → `restore_sub_order_stock` → `refund_sub_order_coins`). They now expect the single `close_sub_order_atomic` call and still require a stock or Coins failure to be reported, never success. Four tests added (no legacy fallback; no success without a confirmed result; parent id sent; non-closing transitions unchanged). | Yes; behaviour proven in `atomic-split-cancellation-db.test.ts` (27) |
| `tests/deliveries-workflow.test.ts` (9 tests), `tests/delivery-trusted-writer-wiring.test.ts` (3), `tests/coins-refund-migration.test.ts` (1), `tests/payment-collections.test.ts` (1) | **These failed after the 0099 rewrite.** They search source text for the old in-app implementation (for example `verifyDeliveryOtp(orderId, input.otp, delivery.otp_hash)`). Each assertion was moved to the place the rule now lives (the 0099 / 0094 SQL) and several gained a stricter one (no `.from(` or direct write left in the action; exactly one RPC; the app sends no amount). No test was deleted. | Yes; behaviour proven in `delivery-completion-action-db.test.ts` |
| `tests/legal-acceptance-db.test.ts` | One test asserted the rollback **removes** the acceptance table. It now asserts the opposite: rows and columns kept, access removed (see 4.1). | Strengthened |
| `tests/pr126-review-fixes.pg.mjs` | One test was **flaky**: it required both direct status writes to be refused while racing the atomic call. When the atomic call commits first, the waiting direct write is a harmless no-op on an already-cancelled order, so the test failed in about half the runs. Replaced by three tests with a forced order (before / waiting-then-commit / waiting-then-rollback), each checking ledger, stock and coupon state. 16 → 18 tests. | Strengthened. This flakiness was in my own earlier test; the "16 passed" reported before was a lucky run. |

A reviewer should read the four source-text test files with care: they are
weaker evidence than the behavioural suites, by their nature.

## 6. Full checks, against `main` (`80007cc`)

| Check | `main` | This PR | Status |
|---|---|---|---|
| `pnpm typecheck` | pass | pass | PASS |
| `pnpm build` | — | exit 0; `/admin/marketplace-launch` built | PASS |
| `pnpm test` | 18 files failed | 210 files: 18 failed, 192 passed. 3270 tests: 11 failed, 3046 passed, 213 skipped | **FAIL — the same 18 files as `main`, none new, none fixed** |
| `pnpm lint` | 48 errors, 40 warnings | 48 errors, 40 warnings; none in files this PR added | **FAIL (same as `main`)** |

During this pass the suite showed 15 **new** failures after the 0099 rewrite
and one from the rollback change. All were fixed as described in section 5;
none is classed as pre-existing.

The 18 failing files on `main` are listed in `03_TEST_REPORT.md`. They are not
repaired here. Eleven are whole security suites that cannot start because a
test helper is broken — that remains a launch blocker.

GitHub "Web checks" fails at the Lint step for the reason above, so CI never
reaches typecheck, tests or build. Those were run in the sandbox only.

## 7. Deployment checks

**Vercel.** GitHub status `success` for the previous head. Browser
verification NOT DONE (see Verdict).

**Cloudflare "Workers Builds: maharani-mart".** Evidence:

- The check appears only on this PR's commits `78a570e` and `9c4834d`. It is
  absent from `main` (last 6 commits), from PR #125, and from this PR's first
  commit — so the Cloudflare connection was made, or its branch builds switched
  on, on 15 Nov 2026.
- It fails in under one second (start and end time identical), so no build ran.
- The repository has no `wrangler.toml` / `wrangler.jsonc`, no OpenNext or
  Cloudflare adapter, no Cloudflare dependency and no workflow that mentions
  it. `README.md` and `vercel.json` name Vercel as the only deployment target.
- The build log is in the owner's Cloudflare dashboard and could not be read.

Conclusion: on the repository's evidence Cloudflare is **not** an intended
target, and this PR did not break it. Nothing was added to make it pass,
because that would create a second deployment target outside this PR's scope.
**Recommended owner action:** Cloudflare dashboard → Workers & Pages →
`maharani-mart` → Settings → Builds → disconnect the Git repository (or turn
off non-production branch builds). If Cloudflare *is* wanted, that is a
separate, deliberate project.

## 8. Still needed from the owner or professionals

Unchanged from `05_OWNER_CHECKLIST.md`. Nothing below was invented or filled in:

- Legal entity, registered address, GSTIN.
- Grievance officer name and contact.
- Return / refund commitments, confirmed.
- Seller commission and the TCS / TDS treatment, from a Chartered Accountant. (TCS / TDS is not built.)
- Owner approval and CA approval for third-party selling. The switch is OFF.
- Advocate review of every legal page; they are drafts.

## 9. Remaining risks

- Nothing has been clicked through in a browser.
- 0094–0099 have never run on a Supabase project, only on PostgreSQL 16 (PGlite) and 17.11 (embedded). A staging run is needed before production.
- SEC-02 is live in production until 0094 is applied.
- Return-to-warehouse and dispatch are not transactional.
- 18 test files fail on `main` and here; 48 lint errors.
- `zod` advisory from the earlier audit is unaddressed.

## Files changed in this pass

Migrations: `0099_atomic_delivery_completion.sql` (new) + rollback; `0098_…sql`
(one grant removed); rollbacks `0095_….down.sql`, `0098_….down.sql` (no data loss).

App: `lib/delivery/completion.ts` (new), `lib/delivery/delivery-actions.ts`,
`lib/admin/marketplace/{actions,queries,validation}.ts` (new),
`app/admin/marketplace-launch/page.tsx` (new),
`components/admin/marketplace-launch-forms.tsx` (new),
`components/seller/seller-gate-notice.tsx` (new),
`app/seller/{dashboard,offers,profile}/page.tsx`, `components/layout/admin-shell.tsx`.

Tests: new `delivery-completion-action-db`, `marketplace-launch-ui-db`,
`pr126-migration-review-db`, `pr126-delivery-completion.pg.mjs`; changed as listed in section 5.
