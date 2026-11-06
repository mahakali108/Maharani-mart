# Maharani Traders — Master execution status and gated plan

**Snapshot:** 2026-11-02, owner local date. **Status:** planning only; no implementation, PR or deployment authorized by this report.
**Branch / HEAD:** `arena/2ab6a8a1-maharani-mart` / `c1a3e1b52656761c728d1966603f4c8034a40f8e`.

## Verified baseline

- Existing tracked edits are precisely the two Phase 1 test fixes in `tests/tax-invoice-readiness.test.ts` and `tests/ordering-readiness-persistence-db.test.ts`; their contents match the previously recorded hashes. Existing 12 untracked audit reports were present before this report was created. `package.json` and `pnpm-lock.yaml` match previous hashes. `git ls-files -u` was empty; `git diff --check` passed.
- `next@14.2.15`, resolved React/DOM 18.3.1, `zod@3.25.76`, pnpm 9.15.9, local Node 22.22.3. Local/CI environment is not proof of the deployed versions or Vercel Node configuration.
- Re-ran `corepack pnpm audit --prod --json`: exit 1, **41** affected-version findings (4 critical, 16 high, 17 moderate, 4 low). `corepack pnpm audit --json`: exit 1, **83** affected-version findings (7 critical, 34 high, 37 moderate, 5 low), in 80 advisory records. These are dependency inventory findings, not proof of production exploitation; remediation and actual deployed tree remain unverified. Same counts as the earlier snapshot.
- Historical Phase 1 evidence: local typecheck, lint and build succeeded, 10/10 targeted tests passed, build generated 142 static pages. This turn did not rerun those checks or run the full suite, browser, real RLS or Android tests. Their status is **not run**, not passed.
- On this read-only recheck, npm registry `latest` tags were Next / eslint-config-next **16.4.4**, React / React DOM **19.3.1**, and Zod **4.6.7**. These differ from some older proposal candidates; registry tags alone do not establish suitability, complete security coverage or compatibility. No version is approved or installed. Next 14 is unsupported, 15 maintenance security support is scheduled through 2027-01-31 and 16 is active LTS: [official policy](https://nextjs.org/support-policy). Next announced a [2026-11-03 security release](https://nextjs.org/blog/upcoming-nextjs-security-release-november-2026); reassess the release, advisories and tags immediately before seeking implementation approval.
- No Supabase connection, SQL, production request, deployment, package install/change, commit, push, PR modification, APK or paid service action was performed for this status. Existing reports are historical snapshots; this document does not overwrite or silently revise them.

## Completed work and remaining stages

| Gate / phase | State and dependencies | Approval / outputs |
|---|---|---|
| Phase 0 baseline | Completed as a scoped source/documentation audit, not comprehensive security or legal certification. | Existing baseline, architecture, legal, costs and testing reports preserved. |
| Phase 1 | Two scoped test fixes and targeted local checks previously completed. No new CI evidence or full-suite claim. | Preserve both fixes; review their separate inclusion before any PR. |
| Phase 2 Stage A | Dependency audit completed; both audits re-run above. No dependency remediation performed. | `PHASE_2_SECURITY_AUDIT.md`; old patch-only Stage B remains unapproved. |
| A baseline recheck | Completed for this snapshot; production and live schema are unknown. | This status report; no implied authorization of further work. |
| B / Phase 3: supported-major plan | Existing `SUPPORTED_MAJOR_MIGRATION_PROPOSAL.md` is preliminary. Complete version-current, source/compatibility and exact change/test/rollback review before requesting implementation approval. | **Separate approval for the next planning stage requested.** Registry and advisories must be rechecked, especially Nov 3 release. |
| C / Phase 3: Next implementation | Pending B review and explicit target/scope approval. Prefer supported Next 16 unless evidence supports a 15 bridge. Preserve React/Supabase/PWA/mobile behavior. | Separate implementation approval; only approved dependency and source changes. Report in new `NEXTJS_MIGRATION_EXECUTION.md`. |
| D / Phase 4: Zod 4 | Separate inventory, matrix and plan; no bundled Zod change in C. | Separate approval for implementation; `ZOD4_MIGRATION.md`. |
| E / Phase 5: dependency remediation | After Next/Zod decisions, fresh audits and dependency-path assessment; incremental approved fixes only. | Separate approval; `SECURITY_REMEDIATION.md`; audit before/after. |
| F / Phase 6: application security | Server-side auth, role/tenant isolation, upload/input/CSRF/XSS and marketplace controls; distinguish source evidence from actual exploitation. | Audit/fixes separately scoped; fixes require approval. No production exploits. |
| G / Phase 7: Supabase | Source review first; owner-confirmed target and individually authorized read-only live inspection before any live queries; no legacy target. | `SUPABASE_REMEDIATION_PLAN.md` with exact reviewed SQL, impact/rollback if evidence supports it; production writes require separate approval. |
| H / Phase 8: marketplace | Depends on access/security and schema evidence. Food excluded; seller invitation and controls enforced server-side. Membership conflict requires owner decision. | Separate approval for improvements; `MARKETPLACE_AUDIT.md`. |
| I / Phase 9: website/PWA | Audit current homepage before design; berry/pink marketing surfaces only, preserve existing violet elsewhere. Depends on migrated auth/PWA behavior and approved scope. | Separate approval for changes. |
| J / Phase 10: Android | Inspect existing Kotlin/Compose retailer-only app and its API contracts after web/API changes; no Flutter or second app. | `ANDROID_RETAILER_AUDIT.md`; app changes and APK/AAB build/release separately approved. |
| K / Phases 11–13: full regression and release readiness | After approved implementations: exact totals, skipped/blocked results, security, isolated DB/RLS, browser/PWA and device testing; legal and operations sign-off. | Separate full-regression approval; `REGRESSION_TEST_REPORT.md` and `RELEASE_READINESS.md`. No release certification from source checks alone. |
| L / Phase 12: push and PR | Reinspect conflicts and CI; prepare scoped PR description and `GITHUB_PR_PLAN.md`. | Push and PR creation each require separate owner approval. Merge (M), database writes and production deploy/release (N) all require additional explicit approvals. |

**Dependency order:** B → C → independently planned/approved D → separately approved E → F/G review and separately approved remediation → H → I → J → K → L → M → N. After each phase stop for its gate. Where useful, safe planning can describe a later phase, but no later implementation is implicitly authorized. Database verification is not a prerequisite to merely drafting B; it is a release and security acceptance dependency.

## GitHub PRs: current read-only snapshot

All seven listed PRs are **OPEN**, target `main`, and GitHub reports `CONFLICTING` / `DIRTY`. These labels show mergeability, not exact conflict hunks. No PR was changed. Old green preview checks do not establish current build or release readiness.

| PR | Source branch | Relevant scope, collisions and observed checks |
|---|---|---|
| #107 | `arena/34c79b62-maharani-mart` | Compliance/Android/API, 72 files. Adds `supabase/migrations/0059_india_compliance_safety.sql`, colliding by migration number with current `supabase/migrations/0059_supplier_applications.sql`. Historical web/production-probe/Vercel checks failed; Android checks skipped. |
| #66 | `arena/01a0b519-maharani-mart` | Retailer catalog/banners, 21 files; overlaps #42 on 8 files and #31 on 3. Vercel status succeeded, Supabase preview skipped; no web CI conclusion shown. |
| #45 | `arena/01a07f36-maharani-mart` | Retailer UI / phone OTP, 8 files; overlaps #42 at `app/retailer/home/page.tsx`. Vercel status succeeded, Supabase preview skipped; no web CI conclusion shown. |
| #42 | `arena/01a07a86-maharani-mart` | Retailer redesign, 27 files; overlaps #31 on 8 files and #66 on 8. Vercel status succeeded, Supabase preview skipped; no web CI conclusion shown. |
| #31 | `arena/01a05bd7-maharani-mart` | Pricing/SKU, 49 files, includes `supabase/migrations/0023_sku_code_optional.sql`, same path already in current checkout: compare SQL and history before any action. Vercel status succeeded, Supabase preview skipped; no web CI conclusion shown. |
| #21 | `arena/01a04718-maharani-mart` | Capacitor wrapper, 25 files; modifies `package.json` and `pnpm-lock.yaml` and conflicts with native-app direction unless separately reviewed. Vercel status succeeded, Supabase preview skipped; no web CI conclusion shown. |
| #7 | `arena/01a01536-maharani-mart` | Firebase storage, 50 files; modifies `next.config.mjs`, `package.json`, `pnpm-lock.yaml`; conflicts with current Supabase/no-Firebase direction unless owner changes scope. Vercel status succeeded; no web CI conclusion shown. |

Actual conflicting hunks, migration equivalence and CI causes need separate review. Do not merge, close, rebase, or overwrite these branches automatically. Refresh metadata just before any decision.

## Likely changed files, not an approved change list

The exhaustive source-match inventories and distinction between candidates and proven edits are in `SUPPORTED_MAJOR_MIGRATION_PROPOSAL.md`. Exact files must be confirmed after approval; no source edits are made now.

- Next migration: `package.json`, `pnpm-lock.yaml`, `lib/supabase/server.ts`, its potentially affected consumers and `ReturnType` references, `lib/admin/supplier-actions.ts`, affected framework dynamic route/page/handler files such as `app/api/mobile/v1/orders/[id]/route.ts` and relevant targeted tests. Inventory: 272 direct SSR-client import files, 109 `params`/`searchParams` page/route candidates and 15 mobile dynamic handler candidates; counts are static matches, not required edit totals.
- Next 16 lint/runtime: `.eslintrc.json`, potentially a new `eslint.config.*`, `next.config.mjs`, perhaps `.github/workflows/ci.yml`; `middleware.ts` / `lib/supabase/middleware.ts` only if review proves needed. Next 16 deprecates middleware convention but Node-only proxy is not a blind Edge replacement. Changes to `vercel.json` or remote deployment configuration need separate approval.
- Behavior-preservation review: `app/auth/callback/route.ts`, `public/sw.js`, `components/pwa/ServiceWorkerRegister.tsx`, `app/manifest.ts`, `app/layout.tsx`, `components/media/stored-image.tsx`, `lib/mobile/http.ts`; inspect relevant auth, mobile API, PWA, commerce and role tests. Any edits require the approved migration scope.
- Zod work, independently approved: `package.json`, `pnpm-lock.yaml`, and schema/test candidates including `lib/ai/safety/confirmation.ts`, `lib/admin/banners-actions.ts`, `app/api/ai/chat/route.ts`; 73 static Zod import files are listed in the existing proposal.
- Later database, Android, website and PR changes are not yet known: plan exact paths after evidence and approvals, not by assuming a migration or release is needed.

Rollback for a future approved migration: retain pre-change package/lock/source snapshots and undo only reviewed migration-specific hunks as a coherent unit; preserve the Phase 1 test edits and all audit documents. Re-test/audit the reverted state. A production rollback is a separate operational action requiring authorization; reverting to an unsupported vulnerable version has security consequences.

## Branch constraint and decisions

This Arena session is fixed to `arena/2ab6a8a1-maharani-mart`; creating or switching to the suggested new feature branches is not available in this session. The existing session branch can serve as the dedicated working branch. Independent unrelated PRs may require separately provisioned Arena sessions/branches; do not mix them merely to circumvent this constraint. No commit, push or PR is authorized now.

Owner decisions needed later: approve B planning, then the selected Next/React/Node/lint implementation and tests separately; resolve retired paid membership versus Free/Silver/Gold; authorize and independently verify official Supabase project/environment before read-only access; decide historical PR disposition; separately approve each implementation, full regression, push/PR, merge and deployment. Preserve cosmetics/non-food-only scope, retailer-only Android and seller invitation by Super Admin. Legal/tax sign-off and actual food-exclusion/RLS enforcement are outstanding.
