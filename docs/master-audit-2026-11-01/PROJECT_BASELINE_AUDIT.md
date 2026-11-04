# Project baseline audit

Date: 2026-11-01 UTC. Snapshot: `c1a3e1b52656761c728d1966603f4c8034a40f8e` on `arena/2ab6a8a1-maharani-mart`. **Release verdict: NOT READY; audit is evidence-limited, not a certification.** Documents in this directory are the only intended changes. No application code, production data, configuration, database, payment, notifications, migration, build, APK, deployment, PR or billing was changed. Historical statements are explicitly identified; none proves present production state.

## Method and limits

Read tracked inventory, package/config, selected source, migrations, tests, existing audits and GitHub metadata; researched official sources. This is a targeted architectural/security baseline, **not a line-by-line review of all 1,000+ files, complete database catalog audit, penetration test, live UX audit or legal opinion**. `node_modules` was absent; no installation or local suite was run during the read-only phase. Git history in the checkout is shallow/grafted; GitHub API provided recent commit subjects. No live Vercel or Supabase access was attempted; owner must confirm identity and authorize later read-only verification. Historical `docs/` reports can be stale or contradictory; inspect code and verify current conditions before acting.

## Verified repository facts

- At start `git status --short --branch`: clean, active session branch; `git ls-files -u` returned 0. No local merge conflict. Remote default `main` is private and `protected: false` (rulesets not independently checked).
- GitHub metadata: seven open PRs, #107, #66, #45, #42, #31, #21 and #7; all reported `CONFLICTING`/`DIRTY` at inspection. No merge/close. GitHub's state is time-sensitive. API pagination found many branches; no branch was switched. Most recent main commit is #123 merge; previous #122 and #121. Repo is personal-account owned, not an organization.
- `package.json`: Next.js **14.2.15**, React 18.3.1 range, TypeScript 5.6 range, Supabase SSR/client, Tailwind 3, Zod, PGlite and Vitest; pnpm 9.15.9 lockfile `pnpm-lock.yaml`; Node >=18.18, local Node 22.22.3. Next App Router, server components/actions, API handlers and `middleware.ts`; PWA has `app/manifest.ts`, `public/sw.js`, offline page. `next.config.mjs` permits public Supabase storage images.
- Tracked first-level inventory: app 270, components 211, lib 252, Android 278, tests 189, Supabase 106, docs 100. `supabase/migrations` contains 84 SQL files through 0087 (gaps 0061, 0075, 0076); types in `types/database.types.ts`, `inventory.types.ts`, `marketplace.types.ts`. Counts include files, not test cases or feature guarantees.
- `/` redirects anonymous users to login and authenticated users by role (`app/page.tsx`). Retailer homepage is `app/retailer/home/page.tsx`: no public marketing homepage currently at `/`. Marketing tokens coexist with other violet tokens; evaluate actual UI and contrast before redesign.
- Retailer web routes include catalog, product details, search, cart, checkout, orders, invoices, favorites, notifications, coupons, support, membership route and quick order. Seller web has dashboard, offers, orders, profile and status; `/register-seller` explicitly says Super Admin invitation only. Admin has seller, catalog, orders, inventory, returns, compliance, banners, retailers, audit and reporting routes. Existence is not proof of working end-to-end, governance authority or seller isolation. Staff and salesman experiences also exist; preserve them.
- Native Android Kotlin/Compose project exists, with catalog/auth/orders/engagement and `/api/mobile/v1` backend routes. `docs/NATIVE_PWA_FEATURE_PARITY.md` is a dated historical detailed parity assessment, not current device verification. No APK was created. Android pipeline is manual and *would build APKs and unsigned AAB if dispatched*; do not dispatch without owner approval.
- `app/retailer/membership/page.tsx` and 0083 explicitly retire paid memberships in favor of admin-assigned pricing categories and a points ledger. The request for paid Free/Silver/Gold conflicts with this prior decision; do not reactivate plans without explicit approval, policy and tax review. Seller category pricing is separately handled; no proof all discount/loyalty requirements work.
- Food exclusion has source-side checks (`lib/compliance/catalog-compliance.ts`, migration 0086), but 0086 is absent in the 2026-10-30 recorded remote history snapshot. **No claim that production blocks all food or that real catalog is clean.** Android `QuickOrderScreen.kt` suggests rice/oil, contradicting desired launch copy; do not assume these are actual products. Review source, tests, data and UI before release.
- Existing delivery gate, private evidence plans, legal routes, seller governance, RLS and atomic order RPCs exist in code/migrations; effective live enforcement is not established. See `SUPABASE_SECURITY_AUDIT.md`.

## Baseline test and security findings

| Command/evidence | Result |
|---|---|
| `git diff --check` before docs | exit 0; no tracked diff |
| `corepack pnpm audit --prod` | exit 1: 41 advisory findings: 4 critical, 16 high, 17 moderate, 4 low. Inventory, not exploit confirmation. Next 14.2.15 is flagged for middleware auth bypass [GHSA-f82v-jwr5-mffw](https://github.com/advisories/GHSA-f82v-jwr5-mffw), plus conditional AVIF/SVG optimization and Windows-hosted RCE advisories. Verify actual config/host/exposure before incident claims; select a maintained patched version considering every advisory, not only 14.2.25. |
| `pnpm audit --lockfile-only --prod` | exit 127: pnpm not on PATH; `corepack pnpm audit --lockfile-only --prod` exit 1 unsupported option. Successful audit invocation above uses committed lockfile, no install. |
| GitHub Web CI run [41325231751](https://github.com/mahakali108/Maharani-mart/actions/runs/41325231751) | **Failure on main**, same commit: checkout, setup, install succeeded; typecheck failed; lint/tests/build skipped. Check annotations report `tests/tax-invoice-readiness.test.ts:9` missing required `NODE_ENV` in `ProcessEnv`, and `tests/ordering-readiness-persistence-db.test.ts:93` string/undefined error. Existing before docs. The older claim that CI always runs zero steps is no longer current. |
| Local tests, local typecheck/lint/build/format, Android tests, E2E/RLS/security/secret scan | NOT RUN. 0 tests executed; passing/failing/skipped test-case counts unknown, not zero-pass evidence. No current coverage measurement. Existing tests include mocks, PGlite, unit and source-contract checks, not a substitute for isolated real Supabase or device tests. |

## Priority risks and next actions

1. **P0 security:** assess flagged Next.js advisories against actual deployment; plan controlled upgrade and regression/security tests. Do not rely on middleware alone for authorization.
2. **P0 operations/data:** code may require pending schema (notably 0082); ordering, product enforcement and seller controls must not be presumed live. Reconcile via owner-approved read-only evidence; no migration from this audit.
3. **P0 quality:** repair the two CI type errors in a separate approved phase; rerun full checks. The immediate first task should be an approved, narrowly scoped CI/security remediation plan with tests, coordinated with database drift verification before release.
4. **P0 legal:** no owner/CA/lawyer evidence of correct identities, invoices, product labels, payment flow or policies; ordering gate must remain closed until independently verified.
5. **P1 governance:** private main lacks observed branch protection; compensate with a mandatory manual review/owner-only merge and separately assess rulesets. Seven open conflicts need triage, not blind merges.
6. **P1 cost:** Vercel Hobby is non-commercial; existing plan is unverified. Hosting suitability cannot be inferred from an apparently free URL. See cost report.

## Decisions / assumptions

Business identity, GST registration, Gaya scope and product exclusions are **owner statements**, not independently verified records. Confirm actual legal name, GSTIN, addresses, contacts, operating workflow, project target, Vercel/Supabase plans and prior membership decision. No real names, GST numbers, secrets or customer records are reproduced here.
