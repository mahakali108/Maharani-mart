# Maharani Traders — final audit summary (PR #126)

Date: 2026-11-14. This file is the short index. The detail is in
`docs/readiness-2026-11-14/` (`00`–`08`); the latest state is in
`08_SECURITY_RELIABILITY_REPAIR.md`, sections 12–17.

Nothing in PR #126 has been merged, deployed, or applied to the live database.
The live project (`fhrmsrumsraprvutrpeo`) is at migration `0093`.

## Verdict

- **Code, migrations and tests: ready for independent final review.**
- **Launch: NOT READY.** See "Open" below.

## What PR #126 changes (migrations 0094–0101)

| Migration | What it does |
|---|---|
| 0094 | Delivery trust: shortfall Coins computed by the database, loyalty points only from verified delivery |
| 0095 | Legal document acceptance records |
| 0096 | Delivery line guard (full quantity accounted, no deadlock with completion) |
| 0097 | Atomic order cancellation and sub-order closing with Coins refund |
| 0098 | Seller agreement gate; marketplace switch, OFF by default, needs owner and CA approval |
| 0099 | Delivery completion in one transaction; proof file verified in private storage |
| 0100 | Dispatch, failed delivery and return to warehouse, each one transaction; direct status writes blocked |
| 0101 | Return request approval and rejection, each one transaction; old stock-return route closed |

Apply in order, 0094 → 0101. Each has a rollback in `supabase/rollbacks/`;
roll back in reverse order. No rollback deletes data.

## Return requests (0101)

- Approval restores stock, sets the status, and writes history and audit in one
  transaction. A failure anywhere undoes all of it.
- Repeats and simultaneous clicks restore stock once.
- Admin and Super Admin only, checked by the database.
- Approval moves no money. Rejection moves nothing.
- Returns of goods already settled by a shortfall credit are refused and need
  manual handling (report 08, section 13).

## Test commands

```
corepack pnpm install --frozen-lockfile
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build

mkdir /tmp/pgdeps && cd /tmp/pgdeps && npm install embedded-postgres@17.11.0-beta.19 pg
NODE_PATH=/tmp/pgdeps/node_modules node tests/pr126-return-requests.pg.mjs
NODE_PATH=/tmp/pgdeps/node_modules node tests/pr126-fulfilment-and-locks.pg.mjs
NODE_PATH=/tmp/pgdeps/node_modules node tests/pr126-delivery-completion.pg.mjs
NODE_PATH=/tmp/pgdeps/node_modules node tests/pr126-review-fixes.pg.mjs
NODE_PATH=/tmp/pgdeps/node_modules node tests/refund-ledger-real-postgres.pg.mjs
```

## Results on the final code

| Check | `main` (`80007cc`) | PR |
|---|---|---|
| Typecheck | pass | pass |
| Build | pass | pass |
| Lint | 48 errors | 48 errors (same ones) |
| Tests | 3028: 11 failed | 3314: 11 failed (same ones), 3090 passed |

Real PostgreSQL 17.11, migrations 0001–0101: return requests 19/0, fulfilment
and locks 31/0, delivery completion 25/0, review fixes 18/0, refund ledger 31
passed. Logs: `docs/readiness-2026-11-14/evidence/`.

GitHub "Web checks" is red at the lint step, as it is on `main`. Tests and
build are therefore skipped in CI, not passed; the results above are from the
sandbox.

## Open

Owner and CA decisions:

- Refund rule for approved returns (today: stock only, no Coins).
- Rules for returns after a shortfall credit (report 08, section 13).
- Legal pages are drafts; owner identity and GSTIN outstanding
  (`readiness-2026-11-14/05_OWNER_CHECKLIST.md`).
- TCS/TDS handling is not built.
- Cloudflare project builds every branch and fails; disconnect it or turn off
  branch builds.

Engineering:

- 48 lint errors and 11 failing tests on `main` (separate PR).
- No staging database with 0094–0101; no end-to-end run through a deployed
  app; preview not checked in a browser.
- No return flow for seller-fulfilled lines.
- `zod` advisory.
