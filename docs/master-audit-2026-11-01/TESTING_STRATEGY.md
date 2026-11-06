# Testing strategy and current evidence

2026-11-01. This phase read-only: no local dependencies installed, tests, build, formatting, device execution, production requests or database writes. No current coverage percentage exists. `tests/` has 189 tracked files including helpers/fixtures, not 189 executable suites. Some use mocks, static migration assertions or PGlite; real Supabase RLS, browser and device verification remain distinct.

## Baseline evidence (do not reinterpret as a full test run)

| Command | Total / passed / failed / skipped | Result |
|---|---|---|
| `git diff --check` before documents | N/A | Exit 0, clean tracked diff |
| `corepack pnpm audit --prod` | 41 advisory findings, not tests | Exit 1: 4 critical, 16 high, 17 moderate, 4 low; findings existed before changes |
| `pnpm audit --lockfile-only --prod` | N/A | Exit 127: pnpm absent from PATH |
| `corepack pnpm audit --lockfile-only --prod` | N/A | Exit 1: unsupported option |
| GitHub [Web CI main run 41325231751](https://github.com/mahakali108/Maharani-mart/actions/runs/41325231751) | no test cases executed; lint/tests/build skipped | Typecheck failed on two annotations: `tests/tax-invoice-readiness.test.ts:9` `NODE_ENV` missing in ProcessEnv; `tests/ordering-readiness-persistence-db.test.ts:93` string or undefined. Pre-existing. |
| Local typecheck, lint, unit, integration, build, Android, E2E, format, secret scan | 0 executed; pass/fail/skipped unknown | Not run: no node_modules and audit is read-only. No formatting or coverage script established. |

## After separate implementation approval

- Reproducible local bootstrap `corepack pnpm install --frozen-lockfile`, then `corepack pnpm run typecheck`, `corepack pnpm run lint`, `corepack pnpm test`, `corepack pnpm run build`, `corepack pnpm audit --prod`, `git diff --check`; document exit, environment, counts/failures/skips and whether pre-existing. Agree formatter rather than claiming a nonexistent script. Run an approved local secret scanner, suppress actual matches in reports and follow incident rotation procedure privately.
- Unit: quote, inclusive/exclusive GST/rounding/HSN, slabs/MOQ, inventory, category and seller price isolation, discount precedence/caps, loyalty ledger/reversal/expiry, membership expiry boundary and privileges. Include invalid/null/timezone/concurrency inputs and property tests.
- Isolated integration: authenticated/anonymous JWTs against disposable real Supabase with migrated schema and non-PII fixtures; RLS for retailer A/B and seller A/B, RPC EXECUTE grants/role inheritance/search_path, storage MIME/size/signed URL isolation, seller invite/approval, product compliance, idempotent concurrent orders/stock release and simulated settlement/refund. Never use production for mutation tests. Real test/sandbox payments only after approval, no live payments.
- Security: unauthorized and cross-tenant reads/writes, escalation, SQLi/XSS/CSRF, upload content sniffing/polyglot/size, rate limit, token expiry/revocation, session fixation, secret exposure and deep-link handling. Verify server-side super-admin checks, not just UI. Document threat model, assertions, setup and evidence; no exploit against production.
- E2E using isolated staging: retailer signup/login→catalog→cart→quote→checkout→sandbox/COD→tracking/invoice; seller invitation→listing→admin approval→suspension; returns/refund; membership upgrade/expiry if approved; discount/loyalty; deletion request and retention reconciliation. Use browser accessibility and mobile viewport checks. Mark blocked flows honestly until backend/deployment gates resolved.
- Android: JVM tests and lint independent of build plan where safely possible; UI/instrumentation/device and lifecycle, secure token persistence, navigation, accessibility, different Android versions/sizes, offline/network, recovery/deep link and checkout. Do not invoke `assembleDebug`, `bundleRelease`, the manual native workflow or other APK-generating steps without explicit owner build approval.
- CI: restore green typecheck before relying on CI. Capture actual job outcomes and skips; local test results do not imply GitHub CI or production health. Mutation/coverage reports are optional only after approved tooling and no coverage claims without collection.
