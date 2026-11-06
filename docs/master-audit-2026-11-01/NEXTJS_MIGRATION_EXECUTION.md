# Next.js 16 local migration — execution and test report

**Date:** 2026-11-03 local · **Branch:** `arena/2ab6a8a1-maharani-mart` · **HEAD:** `c1a3e1b52656761c728d1966603f4c8034a40f8e`
**Verdict: IMPLEMENTED LOCALLY, BUT NOT ACCEPTED / NOT RELEASE READY.** A feature-branch draft PR is now authorized for review, not merge or deployment. Full tests and lint fail and a financial-balance regression is confirmed. Historical results and restrictions below describe the time of those checks; the 2026-11-04 final addendum supersedes them.

## Scope and security verification

User explicitly approved Stage B's local migration scope. Before installing, branch/HEAD/status, Phase 1 test and package/lock hashes and audit documents were verified. Next official security news still showed only the *upcoming* Nov 3 release announcement; its complete advisories were not available in the checked feed. npm latest was `next@16.4.4`; GitHub Advisory API `affects` queries returned no entries for Next 16.4.4, React 19.3.1 or React DOM 19.3.1 at that time. The feed, advisories and versions **must be checked again before any future release**; zero query matches do not prove safety or include transitive dependencies. [Security news](https://nextjs.org/blog/security), [announcement](https://nextjs.org/blog/upcoming-nextjs-security-release-november-2026), [October update](https://nextjs.org/blog/nextjs-security-update-october-14-2026).

- `next`/`eslint-config-next`: 14.2.15 → **16.4.4**; React/React DOM 18.3.1 → **19.3.1**; React types 18 → **19.3.0**; ESLint 8.57.1 → **9.39.5**. Exact versions pinned; npm reports ESLint 9.39.5 deprecated/no longer supported. The approved target needs a follow-up supported ESLint version assessment, not a claim that it is supported.
- pnpm **9.15.9** retained, local Node **22.22.3**, TypeScript **5.9.3** retained; `package.json` Node engine now `>=20.9.0`. Supabase SSR 0.5.2 / Supabase JS 2.110.7 / Zod 3.25.76 and Vitest 2.1.9 direct lock resolutions retained. The lockfile has a large framework/tooling transitive diff; peer-resolution in the final frozen install succeeded, but a complete independent peer compatibility audit is still pending.
- No production Supabase access, real customer/order/payment/notification activity, production database writes/migrations, deployment, PR operation, commit, push or APK/AAB creation took place. Tests use mocks, fake identities and/or local PGlite; they do not prove live RLS. The local smoke server used fake Supabase config and has been stopped.

## Changes made

1. `lib/supabase/server.ts`: async request-cookie factory; migrated direct consumers and `ReturnType` annotations. The separate service-role client remains synchronous. Moved asynchronous default argument creation into `lib/compliance/evidence-storage.ts`, `lib/orders/quote-order.ts` and `lib/admin/banner-artwork.ts`, preserving optional caller-provided clients.
2. `lib/admin/supplier-actions.ts`: await `headers()` before deriving the same rate-limiter identity. Async `params`/`searchParams` were migrated in 99 exported framework handlers/pages in 95 files; affected direct-invocation test fixtures now use promise inputs. URL and intended mobile response contracts were not deliberately changed.
3. `package.json`: `next lint` → `eslint .`; new `eslint.config.mjs` uses Next 16 core-web-vitals and TypeScript flat configs; removed obsolete Next `eslint` config from `next.config.mjs`. `tsconfig.json` now has Next-required `react-jsx` and generated dev-type include. The old `.eslintrc.json` remains on disk but is not the active ESLint 9 flat config.
4. Middleware Edge-compatible convention retained rather than blindly switching to Node-only proxy. A newly written mocked regression reproduced two existing redirect-cookie failure cases: refreshed chunks and sign-out cookie removals were lost on new redirects. `lib/supabase/middleware.ts` now reflects later cookie changes onto its response; `middleware.ts` copies response cookies to redirects. New `tests/middleware-redirect-cookies.test.ts` and `tests/supabase-server-client.test.ts`, plus extended cookie tests, validate mock scenarios. This does not prove production session correctness.
5. `tests/retailer-enterprise-upgrade.test.ts` and `tests/support-tickets.test.ts` source assertions were updated to reflect awaited clients. Existing Phase 1 edits in `tests/tax-invoice-readiness.test.ts` and `tests/ordering-readiness-persistence-db.test.ts` have exactly the previously recorded hashes and were not overwritten.

Exact tracked changed paths and newly created code/test files are listed in the appendix. Paths include the two pre-existing Phase 1 edits, not solely migration edits. All pre-existing untracked reports remain untouched.

## Executed checks and results

| Check | Result | Detail |
|---|---|---|
| Previous locked baseline install | PASS | `corepack pnpm install --frozen-lockfile`; package/lock hashes unchanged before migration. |
| Previous targeted baseline | PASS | Previous typecheck/lint passed; 13 auth/mobile/PWA test files, **257/257 tests passed**. Not a full-suite baseline. |
| Final lock consistency | PASS | `corepack pnpm install --frozen-lockfile --offline` after exact-pin lock regeneration. An earlier `--lockfile-only --offline` attempt failed due to missing local metadata; online lockfile-only regeneration then frozen offline install passed. |
| Generated route types / TypeScript | PASS | `corepack pnpm exec next typegen`, then final `corepack pnpm run typecheck`; Next typegen modified the required JSX mode and dev types include. |
| Next production build (local) | PASS | `NEXT_TELEMETRY_DISABLED=1 corepack pnpm run build`, Next 16.4.4 Turbopack; **121/121 static pages generated**. Middleware convention deprecation warning remains. No production deployment. |
| Targeted final tests | PASS | 23 files, **321 passed**, 0 failed, 0 skipped: includes auth/session, Android API contracts, PWA/service-worker, page route fixtures and both preserved Phase 1 tests. Most tests are mocked; PGlite is local. |
| Regression proving redirect handling | PASS after fix | New redirect-cookie tests failed 2/2 before code fix, then passed; 3 auth-focused files / **9 tests passed** after fix. |
| Full suite | **FAIL** | `env -i ... corepack pnpm test`: **169 test files passed, 18 failed; 2,737 tests passed, 12 failed, 213 skipped** (2,962 total). 11 suite setup failures caused many skips. No complete pre-migration full-suite run was executed, so failures cannot honestly all be labeled pre-existing. |
| ESLint | **FAIL** | `corepack pnpm run lint`: **66 errors, 42 warnings**. The new flat config checks `eslint .`, a broader scope than the previous `next lint`; its new React hooks/TypeScript recommendations flag source and tests. No rules/checks were disabled to force green. |
| Dependency audits | **FINDINGS / exit 1** | See counts below. Vulnerabilities remain; no audit-clean claim. |
| `git diff --check` | PASS | Whitespace check only; not a security review. |
| Local HTTP smoke | Partial / PASS for observed endpoints | Fake Supabase URL/key: `/login`, `/manifest.webmanifest`, `/offline.html` returned 200; unauthenticated `/api/mobile/v1/session` returned 401; `/retailer/home` returned 307 to login. `/privacy?source=notice` returned HTTP 200 containing a meta refresh / Next redirect digest to `/legal/privacy?source=notice`, **not an HTTP 308**. Compare against baseline/consumer requirements before release; unit tests alone do not establish HTTP redirect parity. |
| Real browser/PWA install, authenticated production auth/RLS, Android device/build and complete external security tests | NOT RUN | No live credentials/data or device used. No APK/AAB or deployment authorized. |

The full-suite failures require independent, careful follow-up without weakening food exclusion, authorization or database guards:

- Nine PGlite suites fail during setup with `CATALOG_CATEGORY_BLOCKED` for unclassified categories; one compliance flow setup reports `Food categories cannot be classified as Cosmetics or FMCG`; one stock authorization setup reports `SELLER_COMPLIANCE_REQUIRED`. These test against local in-memory PostgreSQL only. SQL migration files were not changed in this task, but there is no full-suite pre-migration run proving exact historical status.
- Two `admin-taxonomy-db` cases expect rows currently hidden; `api-privilege-hardening` reports permission denied for `product_is_sale_eligible`. The local harness does not establish live database state.
- `security-phase0-app` has 3 product-pricing cases returning category-classification errors; `seller-marketplace-actions` has 2 cases returning product compliance-review errors. `phase-2d1-compliance-corrections` has 2 source-contract assertion failures; `phase-2d1-concurrency-contract` has 1. `public-information` expects lowercase `unpublished` while the legal document currently uses uppercase `UNPUBLISHED`. Review fixtures/contracts individually; do not simply weaken production enforcement or change assertions to hide real defects.
- Two migration-specific source-string assertion failures were corrected to assert the awaited client in `tests/retailer-enterprise-upgrade.test.ts` and `tests/support-tickets.test.ts`; the affected two files then passed 102/102 tests. The unrelated failures above remain open.

ESLint examples include `react-hooks/purity`, `react-hooks/static-components`, `react-hooks/immutability`, `react-hooks/set-state-in-effect`, `react-hooks/refs`, `@typescript-eslint/no-explicit-any` and `@typescript-eslint/no-require-imports`; examples occur in `app/admin/control-center/client.tsx`, `components/retailer/notification-list.tsx`, `components/ui/infinite-scroll.tsx` and tests. Fixing these comprehensively can require behavioral refactoring and additional tests. Do not downgrade severity/disable rules or exclude failing tests merely to obtain a green check.

## Dependency security comparison

| Audit | Before (last baseline) | After (final lock) |
|---|---|---|
| Production | 41: 4 critical, 16 high, 17 moderate, 4 low | **6**: 0 critical, 5 high, 1 moderate, 0 low |
| Full | 83 affected-version findings: 7 critical, 34 high, 37 moderate, 5 low | **35 affected-version findings**, in 34 records: 3 critical, 14 high, 17 moderate, 1 low |

After production findings include `nanoid` GHSA-2v37-7h3g-55p8, `browserslist` GHSA-c83g-rgw3-j3cx and GHSA-73wf-gq98-2v4g, `source-map-js` GHSA-68fv-2mgg-jv7q, Zod GHSA-mrhx-c7xc-m3w5 (all high) and `baseline-browser-mapping` GHSA-w5vr-8v7q-w6rv (moderate). Full audit includes critical development findings in Vitest / tinypool and a direct dev PostCSS finding. Exposure and affected deployment paths need verification; don't confuse dev-only with production or infer exploitation. No separate Zod 4 / transitive / unrelated dependency remediation was bundled.

## Open acceptance gates and rollback

1. Resolve lint errors without disabling checks and investigate every full-suite failure with safe isolated fixtures; maintain food exclusion and server-side authorization. Obtain a comparable baseline where necessary. Re-run complete suite and lint with exact totals.
2. Investigate the observed legal redirect status and test browser/service-worker updates, cookie refresh/sign-out on redirects, roles and authenticated Android API contracts with approved isolated infrastructure. PGlite and unit mocks do not prove production behavior.
3. Recheck the November security release, post-migration audits and ESLint support; address remaining approved advisories independently. Review `vercel.json`'s `npm install` against pnpm and the unknown deployed Node/runtime separately; no deployment config was changed.
4. Review all changes, including separately preserved Phase 1 edits and all untracked report/test/config files. The current session branch is fixed; independent PRs need separate provisioned sessions/branches. Push/PR, production deployment, merge, database writes and APK/AAB publishing remain separate authorization gates.
5. Local rollback if authorized: reverse only reviewed migration-specific code/config/lock hunks as a coherent unit, never reset/clean; preserve prior Phase 1 changes and audit docs. Re-run frozen install, tests and audit. Reverting to unsupported Next 14 restores known security risk. Production rollback requires separate approval.

## Appendix — exact changed paths

These are tracked paths changed against HEAD, including the two Phase 1 edits which existed before this migration; they are not all newly created by this task. Untracked files are listed separately.

```text
app/access-expired/page.tsx
app/admin/areas/[id]/page.tsx
app/admin/areas/page.tsx
app/admin/attendance/page.tsx
app/admin/audit-logs/page.tsx
app/admin/banners/[id]/page.tsx
app/admin/banners/page.tsx
app/admin/catalog/brands/[id]/page.tsx
app/admin/catalog/brands/page.tsx
app/admin/catalog/categories/[id]/page.tsx
app/admin/catalog/categories/page.tsx
app/admin/catalog/page.tsx
app/admin/collections/page.tsx
app/admin/command-center/page.tsx
app/admin/commissions/page.tsx
app/admin/control-center/page.tsx
app/admin/control-center/users/[id]/page.tsx
app/admin/coupons/[id]/page.tsx
app/admin/coupons/new/page.tsx
app/admin/coupons/page.tsx
app/admin/dashboard/page.tsx
app/admin/delivered/[orderId]/page.tsx
app/admin/delivered/export/route.ts
app/admin/delivered/page.tsx
app/admin/follow-ups/page.tsx
app/admin/inventory/batches/page.tsx
app/admin/inventory/expiry/page.tsx
app/admin/inventory/forecast/page.tsx
app/admin/inventory/grn/[id]/page.tsx
app/admin/inventory/grn/new/page.tsx
app/admin/inventory/grn/page.tsx
app/admin/inventory/ledger/page.tsx
app/admin/inventory/low-stock/page.tsx
app/admin/inventory/movements/page.tsx
app/admin/inventory/page.tsx
app/admin/inventory/products/page.tsx
app/admin/inventory/reports/export/route.ts
app/admin/inventory/reports/page.tsx
app/admin/inventory/transfers/page.tsx
app/admin/notifications/page.tsx
app/admin/offers/page.tsx
app/admin/orders/[id]/page.tsx
app/admin/orders/page.tsx
app/admin/pricing/page.tsx
app/admin/pricing/schemes/page.tsx
app/admin/pricing/tiers/page.tsx
app/admin/products/[id]/page.tsx
app/admin/products/export/route.ts
app/admin/products/import/page.tsx
app/admin/products/new/page.tsx
app/admin/products/page.tsx
app/admin/reports/barcodes/route.ts
app/admin/reports/page.tsx
app/admin/retailer-applications/page.tsx
app/admin/retailers/[id]/page.tsx
app/admin/retailers/page.tsx
app/admin/returns/page.tsx
app/admin/routes/[id]/page.tsx
app/admin/routes/page.tsx
app/admin/sellers/[id]/page.tsx
app/admin/sellers/page.tsx
app/admin/suppliers/applications/[id]/page.tsx
app/admin/suppliers/applications/page.tsx
app/admin/suppliers/page.tsx
app/admin/support/[id]/page.tsx
app/admin/support/page.tsx
app/admin/targets/page.tsx
app/admin/team/[id]/page.tsx
app/admin/team/new/page.tsx
app/admin/team/page.tsx
app/admin/visits/page.tsx
app/admin/wallets/[id]/page.tsx
app/admin/wallets/page.tsx
app/admin/warehouses/[id]/page.tsx
app/admin/warehouses/page.tsx
app/api/admin/storage-report/route.ts
app/api/ai/chat/route.ts
app/api/ai/memory/route.ts
app/api/health/route.ts
app/api/mobile/v1/addresses/[addressId]/default/route.ts
app/api/mobile/v1/addresses/[addressId]/route.ts
app/api/mobile/v1/cart/coupon/route.ts
app/api/mobile/v1/cart/lines/[lineId]/route.ts
app/api/mobile/v1/cart/lines/route.ts
app/api/mobile/v1/catalog/products/[id]/route.ts
app/api/mobile/v1/health/route.ts
app/api/mobile/v1/orders/[id]/cancel/route.ts
app/api/mobile/v1/orders/[id]/delivery/route.ts
app/api/mobile/v1/orders/[id]/invoice/route.ts
app/api/mobile/v1/orders/[id]/return/route.ts
app/api/mobile/v1/orders/[id]/route.ts
app/api/mobile/v1/orders/requests/[requestKey]/route.ts
app/api/mobile/v1/orders/route.ts
app/api/mobile/v1/reports/route.ts
app/api/mobile/v1/reports/statement/route.ts
app/api/mobile/v1/saved-carts/[id]/restore/route.ts
app/api/mobile/v1/saved-carts/[id]/route.ts
app/api/mobile/v1/saved-carts/items/[itemId]/restore/route.ts
app/api/mobile/v1/saved-carts/items/[itemId]/route.ts
app/api/mobile/v1/support/tickets/[id]/route.ts
app/api/mobile/v1/wallet/ledger/route.ts
app/api/mobile/v1/wallet/route.ts
app/auth/callback/route.ts
app/login/page.tsx
app/page.tsx
app/privacy/page.tsx
app/register-retailer/page.tsx
app/reset-password/page.tsx
app/retailer/account/addresses/page.tsx
app/retailer/account/edit/page.tsx
app/retailer/account/ledger/page.tsx
app/retailer/account/notification-preferences/page.tsx
app/retailer/account/page.tsx
app/retailer/account/security/page.tsx
app/retailer/brands/[id]/page.tsx
app/retailer/brands/page.tsx
app/retailer/cart/page.tsx
app/retailer/cart/saved/page.tsx
app/retailer/catalog/[id]/page.tsx
app/retailer/catalog/page.tsx
app/retailer/categories/[id]/page.tsx
app/retailer/categories/page.tsx
app/retailer/checkout/page.tsx
app/retailer/coupons/page.tsx
app/retailer/favorites/page.tsx
app/retailer/help/page.tsx
app/retailer/home/page.tsx
app/retailer/layout.tsx
app/retailer/membership/page.tsx
app/retailer/notifications/page.tsx
app/retailer/orders/[id]/delivery/page.tsx
app/retailer/orders/[id]/invoice/download/route.ts
app/retailer/orders/[id]/invoice/page.tsx
app/retailer/orders/[id]/page.tsx
app/retailer/orders/[id]/reorder/page.tsx
app/retailer/orders/page.tsx
app/retailer/quick-order/page.tsx
app/retailer/reports/page.tsx
app/retailer/reports/statement/route.ts
app/retailer/schemes/page.tsx
app/retailer/support/[id]/page.tsx
app/retailer/support/new/page.tsx
app/retailer/support/page.tsx
app/returns/page.tsx
app/salesman/attendance/page.tsx
app/salesman/collections/page.tsx
app/salesman/commissions/page.tsx
app/salesman/dashboard/page.tsx
app/salesman/dcr/page.tsx
app/salesman/deliveries/[orderId]/page.tsx
app/salesman/follow-ups/page.tsx
app/salesman/orders/[id]/page.tsx
app/salesman/orders/new/page.tsx
app/salesman/orders/page.tsx
app/salesman/profile/page.tsx
app/salesman/retailers/[id]/page.tsx
app/salesman/retailers/page.tsx
app/salesman/routes/page.tsx
app/salesman/targets/page.tsx
app/salesman/visits/page.tsx
app/shipping/page.tsx
app/staff/dashboard/page.tsx
app/staff/deliveries/[orderId]/page.tsx
app/staff/deliveries/page.tsx
app/staff/inventory/ledger/page.tsx
app/staff/inventory/page.tsx
app/staff/orders/[id]/page.tsx
app/staff/orders/page.tsx
app/terms/page.tsx
components/inventory/stock-ledger-list.tsx
lib/admin/banner-artwork.ts
lib/admin/banners-actions.ts
lib/admin/business-settings/actions.ts
lib/admin/business-settings/server.ts
lib/admin/catalog-data.ts
lib/admin/collections-actions.ts
lib/admin/command-center/actions.ts
lib/admin/command-center/data.ts
lib/admin/commissions-actions.ts
lib/admin/control-center/actions.ts
lib/admin/cost-access.ts
lib/admin/coupons-actions.ts
lib/admin/dashboard/data.ts
lib/admin/delivery-actions.ts
lib/admin/grn-actions.ts
lib/admin/inventory-actions.ts
lib/admin/master-data-actions.ts
lib/admin/notifications-actions.ts
lib/admin/offer-actions.ts
lib/admin/orders-actions.ts
lib/admin/pack-seed.ts
lib/admin/pricing-actions.ts
lib/admin/product-import-actions.ts
lib/admin/product-media.ts
lib/admin/products-actions.ts
lib/admin/products-bulk-actions.ts
lib/admin/retailer-approval-actions.ts
lib/admin/retailers-actions.ts
lib/admin/returns-actions.ts
lib/admin/routes-actions.ts
lib/admin/schemes-actions.ts
lib/admin/seller-actions.ts
lib/admin/sellers-query.ts
lib/admin/sub-order-actions.ts
lib/admin/supplier-actions.ts
lib/admin/suppliers-data.ts
lib/admin/support-actions.ts
lib/admin/target-actuals.ts
lib/admin/targets-actions.ts
lib/admin/taxonomy-data.ts
lib/admin/team-actions.ts
lib/admin/tier-pricing-actions.ts
lib/admin/transfer-actions.ts
lib/admin/wallet-actions.ts
lib/ai/agent.ts
lib/ai/authenticate.ts
lib/ai/forecast/data.ts
lib/ai/forecast/index.ts
lib/ai/memory/business-memory.ts
lib/ai/observability.ts
lib/ai/types.ts
lib/auth/actions.ts
lib/auth/session.ts
lib/coins/server.ts
lib/compliance/catalog-compliance.ts
lib/compliance/evidence-storage.ts
lib/config/delivery-serviceability.ts
lib/coupons/actions.ts
lib/coupons/cart-lines.ts
lib/coupons/validate.ts
lib/delivery/delivery-actions.ts
lib/delivery/queries.ts
lib/inventory/alerts.ts
lib/inventory/forecast-alerts.ts
lib/media/supabase.ts
lib/membership/server.ts
lib/mobile/catalog-service.ts
lib/mobile/commerce-service.ts
lib/mobile/quick-order-service.ts
lib/mobile/search-service.ts
lib/notifications/notify.ts
lib/orders/create-order.ts
lib/orders/quote-order.ts
lib/orders/wallet-reversal.ts
lib/retailer/address-actions.ts
lib/retailer/brand-detail.ts
lib/retailer/bulk-order-actions.ts
lib/retailer/cart-actions.ts
lib/retailer/cart-merge.ts
lib/retailer/cart-rpc.ts
lib/retailer/cart-service.ts
lib/retailer/cart-validation.ts
lib/retailer/catalog-batches.ts
lib/retailer/catalog.ts
lib/retailer/category-detail.ts
lib/retailer/category-pricing.ts
lib/retailer/checkout-actions.ts
lib/retailer/effective-price.ts
lib/retailer/favorite-actions.ts
lib/retailer/home-data.ts
lib/retailer/ledger.ts
lib/retailer/marketplace-offers.ts
lib/retailer/notification-actions.ts
lib/retailer/order-actions.ts
lib/retailer/personalization.ts
lib/retailer/pricing-data.ts
lib/retailer/product-feedback-actions.ts
lib/retailer/profile-actions.ts
lib/retailer/reports.ts
lib/retailer/saved-cart-actions.ts
lib/retailer/search-actions.ts
lib/retailer/shopping-context.ts
lib/retailer/support-actions.ts
lib/retailer/taxonomy-counts.ts
lib/retailer/wallet.ts
lib/salesman/attendance-actions.ts
lib/salesman/collection-actions.ts
lib/salesman/followup-actions.ts
lib/salesman/order-creation-actions.ts
lib/salesman/orders-actions.ts
lib/salesman/routes-actions.ts
lib/salesman/visits-actions.ts
lib/seller/actions.ts
lib/seller/guard.ts
lib/seller/queries.ts
lib/staff/dispatch-actions.ts
lib/staff/pick-pack-actions.ts
lib/storage/signed-url.ts
lib/supabase/middleware.ts
lib/supabase/server.ts
lib/warehouse/resolver.ts
middleware.ts
next.config.mjs
package.json
pnpm-lock.yaml
tests/admin-page-error-states.test.tsx
tests/auth-session-cookies.test.ts
tests/legal-canonical-redirects.test.ts
tests/list-pages-read-failure.test.tsx
tests/mobile-address-routes.test.ts
tests/mobile-catalog-api.test.ts
tests/mobile-commerce-api.test.ts
tests/mobile-order-delivery.test.ts
tests/mobile-order-invoice.test.ts
tests/mobile-retailer-upgrade-api.test.ts
tests/ordering-readiness-persistence-db.test.ts
tests/queue-loaders-read-failure.test.tsx
tests/retailer-enterprise-upgrade.test.ts
tests/support-tickets.test.ts
tests/tax-invoice-readiness.test.ts
tsconfig.json
```

New untracked migration code/test files:

```text
eslint.config.mjs
tests/middleware-redirect-cookies.test.ts
tests/supabase-server-client.test.ts
```

This report is the only new audit document in this stage; earlier audit documents remain untracked and preserved.


## Final stabilization addendum — 2026-11-04

**Decision: draft review only; DO NOT MERGE OR DEPLOY.** Existing history above is preserved and reflects earlier runs. Current branch is `arena/2ab6a8a1-maharani-mart`, base is `main`; no production service or data was changed. Official Supabase project reference is `fhrmsrumsraprvutrpeo`; no live project was accessed in these checks.

### Security patch and redirect parity

After the earlier 16.4.4 assessment, the [Next.js 16.4.5 release](https://github.com/vercel/next.js/releases/tag/v16.4.5) published seven security fixes. `next` and matching `eslint-config-next` were updated to **16.4.5**; React/React DOM remain 19.3.1. The new version retains Node >=20.9.0 and compatible React peer ranges. Changes were installed with pnpm 9.15.9 without forced peers/overrides, then frozen install, tests, typecheck and build were repeated. The release advisories cover cache-component scenarios, self-hosted response forwarding, image optimization and Edge route cookie headers; actual reachability/deployment topology has not been established and patched versions are not a claim of complete security. Middleware deprecation warning remains.

Four legacy paths (`/privacy`, `/terms`, `/shipping`, `/returns`) now use Next configuration-level permanent redirects. Local 16.4.5 HTTP checks returned **308** to their `/legal/...` destinations with both `source=notice&source=two` parameters retained; each of the seven canonical pages returned 200. This supersedes the earlier streamed HTTP 200/meta-refresh observation.

### Final checks on the patched lockfile

| Check | Result |
|---|---|
| `corepack pnpm install --frozen-lockfile` | PASS. |
| `corepack pnpm typecheck` | PASS. |
| Fake-Supabase production build | PASS, 123/123 static pages, Next 16.4.5; middleware deprecation warning. No deployment. |
| Full `corepack pnpm test` | **FAIL**: 173 files passed, 18 failed; 2,769 tests passed, 12 failed, 213 skipped. The new required-balance invariant is one additional failure; setup failures, visibility/privilege failures and stale/compliance fixture assertions remain. No full pre-migration baseline exists. |
| Full `corepack pnpm lint` | **FAIL**: 65 errors and 42 warnings; no rules disabled. |
| Focused auth/cookie, legal links, Android source contract, mobile, Coins | PASS: 10 files/93 tests; mock/source tests, not production authorization or a device test. Separate focused run passed 7 files/148 tests before the patch. In the final full run PWA, PWA CI, standalone and service-worker registration files passed (34 tests); marketplace DB setup skipped 21 and marketplace actions failed two, so marketplace is not verified. |
| Real local DB regression | **FAIL**: PGlite migration history + actual refund RPC: 50,000-paise order debit followed by refund yields outstanding **−50,000** instead of starting **0**. `tests/coin-refund-balance-db.test.ts` retains the correct invariant and fails intentionally until repaired. It is single-connection, not concurrency proof. |
| Browser smoke | PASS: 56 page/footer navigations at 320/375/768/1440 px plus login navigation, headless Chromium and fake Supabase; network blocked. Not authenticated live role, PWA install or real-device verification. |
| HTTP smoke | PASS: four 308 redirects preserve repeated query keys; seven policies 200; anonymous mobile session 401, protected retailer 307, manifest/offline 200. Fake Supabase only. |
| Android build/device | NOT RUN: Java and Android SDK absent. Source integrity tests passed; no APK/AAB built or released. |
| `git diff --check` | PASS at verification; not a security audit. |

### Dependency audit after patch

`pnpm audit --prod --json` exited 1: **0 critical, 5 high, 1 moderate** advisories. `pnpm audit --json` exited 1: **3 critical, 14 high, 17 moderate, 1 low**. Advisory counts are not unique vulnerable packages.

Production dependency paths and upstream fixes: `next@16.4.5 > postcss@8.5.23 > nanoid@3.3.16` (high, >=3.3.18); `next > styled-jsx > @babel/core > browserslist@4.28.6` (two high, >=4.28.7); `next > baseline-browser-mapping@2.10.43` (moderate, >=2.11.0); `next > postcss > source-map-js@1.2.1` (high, >=1.2.2); direct `zod@3.25.76` (high, >=4.6.6). Production dependency classification does not prove runtime exploitability: several are commonly build-time tools, and exploitability depends on attacker-controlled inputs. Zod 4 requires a separately tested major migration. No unverified overrides were added.

The three full-audit critical findings are development paths `vitest@2.1.9` (UI-server arbitrary file read/execution; >=3.2.6) and `vitest > tinypool@1.1.1` (two prototype-pollution/RCE gadgets; >=2.1.1 and >=2.1.2). Reachability depends on exposed dev/UI services or attacker-controlled options; not demonstrated in production. Full audit also flags Vite/esbuild, brace-expansion, dev PostCSS, minimatch and others. These need compatible version/reachability review; do not expose the test server or treat this branch as security-cleared. ESLint 9.39.5 remains reported deprecated by npm.

### Financial design and deployment/rollback gate

No new database migration is included: the current `0053` RPC reverses only the first debit; `0082` can generate multiple. Worse, `0031` excludes a debit once `is_reversed=true` while counting the associated reversal credit. The tested `0053` behavior therefore removes a 50,000-paise debit *and* subtracts its 50,000-paise credit, increasing available credit twice. The existing `tests/wallet-ledger.test.ts` even characterizes −500 rupees as current behavior; it is not evidence of correct accounting. Seller partial-refund `0067`, split orders, stock/coupon triggers, direct writes and historical mixed/partial reversals make a simple parent-status trigger unsafe. Current application checks are mitigation only: a cancellation status may commit before a failure is reported, and other marketplace/return paths are not universally covered.

Required follow-up, before any production change: agree on a single append-only accounting convention and historical reconciliation treatment with the owner/accounting reviewer; inventory every debit/refund producer and all full/partial parent and child transitions; design an authorized database transaction that serializes competing cancellations/ledger writes, locks in deterministic order, makes each eligible debit's reversal unique and linked, rejects inconsistent partial state, handles stock/coupon updates atomically, and verifies outstanding/available balances. Add a forward-ordered migration only after design, permissions, lock ordering, race safety, live-like multi-connection tests and reconciliation are independently reviewed. Re-run real PostgreSQL concurrent and failure-injection tests; PGlite serial replay does not establish concurrency. Do not automatically "repair" historical rows without audited per-account reconciliation.

Deployment remains **prohibited** in this task. A future authorized release must first resolve tests/lint/security/legal and financial blockers, rehearse forward migrations and reconciliation on a disposable database matching production, validate backup and recovery, review role permissions, then apply an approved migration before deploying application code that depends on it, and verify balances/stock/audit trails. If a future deployment fails, stop writes/traffic as appropriate and use a reviewed forward repair or backup recovery plan; do not blindly undo ledger entries or roll back a migration after financial writes. No actual production migration or rollback was performed.

Legal review remains pending: owner-reported active regular GST has not been verified against a certificate, and no GSTIN is published. Seller invoice/tax responsibilities, seller-facing terms, operational fulfillment and statutory rights require qualified legal/CA and owner review. Seven policy pages and marketplace remain enabled in this branch; that is not launch approval.
