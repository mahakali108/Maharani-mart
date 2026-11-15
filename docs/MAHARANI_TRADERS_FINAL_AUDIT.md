# Maharani Traders — final audit summary (PR #126)

Date: 2026-11-14. This file is the short index. The detail is in
`docs/readiness-2026-11-14/` (`00`–`08`); the latest state is in
`08_SECURITY_RELIABILITY_REPAIR.md`, sections 18–25.

Nothing in PR #126 has been merged, deployed, or applied to the live database.
The live project (`fhrmsrumsraprvutrpeo`) is at migration `0093`.

## Verdict

- **Code review: ready**, subject to GitHub CI on the pushed commit (see the PR
  description). Locally nothing fails and nothing is skipped.
- **Preview / staging: NOT VERIFIED.** No database has 0094–0102; the preview
  was not opened in a browser.
- **Launch: NOT READY.** See "Open" below.

## What PR #126 changes (migrations 0094–0102)

| Migration | What it does |
|---|---|
| 0094 | Delivery trust: shortfall Coins computed by the database, loyalty points only from verified delivery |
| 0095 | Legal document acceptance records |
| 0096 | Delivery line guard (full quantity accounted, no deadlock with completion) |
| 0097 | Atomic order cancellation and sub-order closing with Coins refund |
| 0098 | Seller agreement gate; marketplace switch, OFF by default, needs owner and CA approval |
| 0099 | Delivery completion in one transaction; proof file verified in private storage |
| 0100 | Dispatch, failed delivery and return to warehouse, each one transaction; direct status writes blocked |
| 0101 | Return request approval and rejection, each one transaction; old stock-return route closed; per-line record for legacy stock returns |
| 0102 | Anonymous reads of products, packs and sellers return nothing instead of a permission error (policies only) |

Apply in order, 0094 → 0102. Each has a rollback in `supabase/rollbacks/`;
roll back in reverse order. No rollback deletes data.

## Return requests (0101)

- Approval restores stock, sets the status, and writes history and audit in one
  transaction. A failure anywhere undoes all of it.
- Repeats and simultaneous clicks restore stock once.
- Admin and Super Admin only, checked by the database.
- Approval moves no money. Rejection moves nothing.
- Returns of goods already settled by a shortfall credit are refused and need
  manual handling (report 08, section 13).
- An order with the same product on two lines (legacy stock mode) now returns
  each line once. Before this fix the second line was wrongly refused
  (report 08, section 18).

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

Same sandbox and commands for both columns.

| Check | `main` (`80007cc`) | PR |
|---|---|---|
| Typecheck | pass | pass |
| Lint | 48 errors, 40 warnings | 0 errors, 0 warnings |
| Tests | 198 files; 3028 tests: 11 failed, 213 skipped, 2804 passed | 213 files; 3328 tests: 3328 passed, 0 failed, 0 skipped |
| Build | pass | pass |

Real PostgreSQL 17.11, migrations 0001–0102, failed 0 and skipped 0 in each:
return requests 27, fulfilment and locks 31, delivery completion 25, review
fixes 18, refund ledger 31. Deadlock victims 0. Logs:
`docs/readiness-2026-11-14/evidence/`. These scripts are not part of GitHub CI.

GitHub "Web CI" runs typecheck, lint, tests and build. With lint clean it no
longer stops before the tests. Its result for the pushed commit is in the PR
description.

How the 11 failing tests and 48 lint errors were resolved: report 08, sections
19 and 20. Three were real defects (anonymous catalogue read, lost
re-moderation after a tier change, one assertion that asserted nothing).

## Open

Owner and CA decisions:

- Refund rule for approved returns (today: stock only, no Coins).
- Whether the catalogue may be seen without signing in (today: no; 0102 makes
  the anonymous answer an empty list instead of an error).
- Rules for returns after a shortfall credit (report 08, section 13).
- Legal pages are drafts; owner identity and GSTIN outstanding
  (`readiness-2026-11-14/05_OWNER_CHECKLIST.md`).
- TCS/TDS handling is not built.
- Cloudflare project builds every branch and fails; disconnect it or turn off
  branch builds.

Engineering:

- `main` still has 48 lint errors and 11 failing tests until this PR is merged.
- No staging database with 0094–0102; no end-to-end run through a deployed
  app; preview not checked in a browser.
- No return flow for seller-fulfilled lines.
- `zod` advisory.
