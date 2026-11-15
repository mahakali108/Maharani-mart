# Test report — real results, 14 November 2026

> **Latest figures are in `07_FINAL_COMPLETION.md` §2 and §6** (210 files: 18 failed / 192 passed; 3270 tests: 11 failed / 3046 passed / 213 skipped; same 18 failing files as `main`). The table below is the earlier run and is kept for history.

All commands were run in the sandbox on the PR branch. Nothing was run against
production.

| Check | Command | Before (main `80007cc`) | After (this PR) | Status |
|---|---|---|---|---|
| Type check | `pnpm typecheck` | pass | pass | PASS |
| Unit / DB tests | `pnpm test` | 18 files failed, 180 passed; 11 tests failed, 2804 passed, 213 skipped | 18 files failed, 189 passed; 11 tests failed, 2972 passed, 213 skipped (same 18 files as before) | **FAIL (pre-existing)** |
| Lint | `pnpm lint` | 48 errors, 40 warnings | 48 errors, 40 warnings | **FAIL (pre-existing)** |
| Production build | `pnpm build` | not run | succeeds; all `/legal` routes generated | PASS |
| Dependency audit | `pnpm audit --prod` | not run | 1 high (`zod` < 4.6.6) | **FAIL** |
| Concurrency with multiple sessions | `node tests/pr126-review-fixes.pg.mjs`, `node tests/refund-ledger-real-postgres.pg.mjs` | — | PostgreSQL 17.11: 16 passed and 31 passed (run by hand; not in `pnpm test`) | PASS for cancellation, snapshot and seller gate only |
| Browser / end-to-end journey | — | — | not run (no browser in sandbox, no test accounts) | BLOCKED |
| Live production smoke test | — | — | not run by instruction | BLOCKED |

## The failing set is identical before and after

The list of failing tests on the PR branch was compared line by line with the
list on `main`: no test that passed before fails now, and none was removed.
70 new tests were added and pass.

Pre-existing failures (not fixed here):

- 11 database suites fail in set-up — `ai-retention`, `api-execute-revocation-flows`, `category-tier-pricing-db`, `data-retention-cleanup`, `mobile-checkout-atomic-db`, `security-definer-hardening-db`, `security-phase0-db`, `seller-marketplace-db`, `simplified-pack-stock-db`, `phase-2d1-compliance-flow-db`, `release-stock-authorization`. Cause seen in the ones inspected: the shared fixture creates products in categories that the 0086 compliance trigger now rejects. **This means a large part of the database security test suite is not currently giving any signal.** That is itself a launch blocker.
- Individual failures: `admin-taxonomy-db` (2), `api-privilege-hardening` (1: anon cannot execute `product_is_sale_eligible`, so anonymous catalogue reads fail — a possible real defect), `membership-db` (1), `mobile-catalog-search` (1), `phase-2d1-compliance-corrections` (2), `phase-2d1-concurrency-contract` (1), `security-phase0-app` (3).

These were classified from their error messages only; each needs its own fix.

## New tests in this PR

| File | Tests | Proves |
|---|---|---|
| `delivery-trust-and-loyalty-integrity-db.test.ts` | 24 | 0094 on PostgreSQL 16: OTP/assignment/proof/status guards, shortfall amount computed server-side, replay gives one credit, partial-delivery points, loyalty RPC exploit reproduced on 0093 and closed on 0094, privilege revokes, re-run and rollback |
| `legal-acceptance-db.test.ts` | 10 | 0095: own-user-only acceptance, database timestamp, append-only, RLS visibility, new request types, rollback refuses data loss |
| `legal-centre.test.tsx` | 19 | Every document A–Q registered once with version and dates; index lists all; no dead links; no placeholder text, invented GSTIN or unapproved time promise |
| `legal-acceptance-app.test.ts` | 4 | Versions come from the server registry, not the browser; nothing recorded without explicit confirmation |
| `atomic-cancellation-wiring.test.ts` | 7 | Atomic cancel counted as success only when the order reads cancelled; all three paths use it and still verify the ledger |
| `delivery-trusted-writer-wiring.test.ts` | 6 | OTP is verified before the trusted writer is obtained; writer fails closed |

Existing tests edited (3) are listed in `02_SECURITY_AUDIT.md` §3.
