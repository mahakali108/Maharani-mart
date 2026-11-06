# Stage B — Next.js 16 compatibility review and implementation proposal

**Review date:** 2026-11-03 (owner local date). **Status:** compatibility review completed to the evidence limits below; **implementation NOT started or approved**.
**Branch:** `arena/2ab6a8a1-maharani-mart` · **HEAD:** `c1a3e1b52656761c728d1966603f4c8034a40f8e`.

## 1. Scope, baseline and evidence limits

The previous [Phase 2 audit](./PHASE_2_SECURITY_AUDIT.md), [supported-major proposal](./SUPPORTED_MAJOR_MIGRATION_PROPOSAL.md) and [master status](./MASTER_EXECUTION_STATUS.md) remain unchanged; use their historical evidence rather than repeating Phase 0/1/2A. The most recent baseline audits reported 41 production findings / 83 full affected-version findings; these numbers describe the **current lock**, not a hypothetical upgraded graph or verified production. Their findings and exit 1 must not be hidden. Both Phase 1 test edits and all existing reports are preserved.

This review used repo config/lockfile and static source searches, selected code-path reading, npm registry metadata, GitHub Advisory API and official Next/React/Supabase docs. `node_modules` is **absent in this session**; package-list commands cannot prove installed versions. The versions below are lockfile resolutions or registry metadata, not packages actually present. No candidate install, compilation, peer-resolution, tests, running app, Supabase connection, remote data, deployment, APK, commit, push or PR action occurred. Static search cannot prove every dynamic import, runtime behavior or exact future diff; generated route types and actual test results are needed before declaring compatibility. No secrets or environment values were read or recorded.

## 2. Exact proposed targets, with security freshness gate

| Component | Current (manifest → lock where relevant) | Proposed exact target / decision | Evidence and limits |
|---|---|---|---|
| Next | `14.2.15` → `14.2.15` | **`16.4.4`** and `eslint-config-next@16.4.4` | npm `latest` metadata at review; Node >=20.9, peer React 18.2+ or 19; Next's `postcss` dependency 8.5.23. Active LTS, not yet installed/audited. |
| React + DOM | `^18.3.1` → `18.3.1` both | **`react@19.3.1` + `react-dom@19.3.1`** together | Registry latest, React DOM peer `^19.3.1`; App Router bundles its own React canary internals. React 18 is documented as supported but deprecated by Next 16; 19 is a deliberate compatibility/security modernization, not a claim 18 cannot install. |
| React types | `@types/react` `18.3.31`; `@types/react-dom` `18.3.7` in lock | **`@types/react@19.3.0` + `@types/react-dom@19.3.0`** | Matching React 19 type majors; actual app/type peer resolution not tested. |
| ESLint | manifest `^8.57.1` → lock `8.57.1`; `next lint` | **`eslint@9.39.5`** + 16.4.4 config; standalone ESLint CLI / flat config | Matching config declares ESLint >=9; 9 chosen to avoid unrelated ESLint 10 major change. Must demonstrate equivalent intended rules and independent CI lint. Registry `latest` 10.14.0 is not the proposal. |
| TypeScript | `^5.6.3` → `5.9.3` | **retain 5.9.3 lock resolution**, no direct upgrade | Next minimum 5.1; 5.9.3 satisfies version floor. Effective typegen/CI compatibility remains untested. |
| pnpm / Node | pnpm `9.15.9`, manifest Node >=18.18; local/CI Node 22 | **retain pnpm 9.15.9**, change manifest engine to **`>=20.9.0`**; local/CI Node 22 | Version metadata permits these; complete frozen resolution/build not tested. Actual Vercel install/runtime is unknown and `vercel.json` says `npm install`; do not alter deployment config without separate approval. |
| Supabase / Zod / test stack | `@supabase/ssr@0.5.2`, `@supabase/supabase-js@2.110.7`, `zod@3.25.76`, `vitest@2.1.9` in lock | retain current direct versions; separate Zod/security work | Framework upgrade is **not** blanket permission to upgrade these. Detect and report any incidental lock changes; keep unchanged where possible. |

Registry peer checks: `lucide-react@0.454.0`'s `^19.0.0-rc` range admits stable 19.3.1 by npm semver; `@testing-library/react@16.3.3` and `@vercel/analytics@2.0.1` declare React 19 support. These checks do not guarantee behavior; inspect the entire resolved graph after approval. `@supabase/ssr@0.5.2` peer requires `@supabase/supabase-js ^2.43.4`, and lock 2.110.7 meets that declared range; SSR API runtime behavior is still unverified.

**Time-sensitive hold:** [Next's Nov 3 security release announcement](https://nextjs.org/blog/upcoming-nextjs-security-release-november-2026) promises fixes for seven medium vulnerabilities. At review, the announcement was available but the full release/advisories were not confirmed from the official security feed. Recheck official release/advisories and npm tags immediately before any implementation. If 16.4.4 is affected or a relevant newer patch appears, **do not silently install the stale target**; report the exact new version and revised evidence for owner decision. The GitHub Advisory API `affects=next@16.4.4` returned 0 matching records at review (control `next@14.2.15` returned 34); `react@19.3.1` and `react-dom@19.3.1` also returned 0. This query is not a full dependency audit, proof of immunity, or coverage of undisclosed/new advisories. Oct fixes include [SVG/image and Server Action issues](https://nextjs.org/blog/nextjs-security-update-october-14-2026). Production host, sharp/glibc version, mitigation and actual exploitability remain unknown.

Next 15.5.28 is a fallback only if an actual Next 16 blocker demonstrates a meaningful need. It has maintenance security support only through **2027-01-31**, uses `postcss@8.4.31`, and still needs async migration; choosing it is a separate scope decision, not an automatic downgrade. Next 14 remains unsupported; a 14 patch-only bridge is not release-ready. Sources: [support policy](https://nextjs.org/support-policy), [Next 15 guide](https://nextjs.org/docs/app/guides/upgrading/version-15), [Next 16 guide](https://nextjs.org/docs/app/guides/upgrading/version-16), [React version guidance](https://nextjs.org/docs/messages/react-version), [React 19 upgrade](https://react.dev/blog/2024/04/25/react-19-upgrade-guide).

## 3. Source-level breaking-change review, risk and file scope

Risk is migration/regression risk, **not** a finding that a production vulnerability is currently exploitable. Exact changed-file inventory requires implementation and generated type checks. Detailed candidate paths are below and in the prior proposal; import counts are candidates, not edit counts.

| Area and exact source evidence | Impact / proposed treatment | Risk |
|---|---|---|
| App Router / Pages | `app/` has 270 tracked files; no tracked `pages/` or `src/pages/` files found. `"use client"`/`"use server"` source matches appear in 174/96 files (text search, not component counts). | Preserve server/client boundaries and all existing server authorization; no Pages Router rewrite. Search is not proof no generated/external route exists. | High |
| Cookies & server factory | `lib/supabase/server.ts:12` uses synchronous `cookies()` in synchronous `createClient()`. 272 source files directly import the server module; 99 files match `ReturnType<typeof createClient>` text. | Next 16 removes synchronous access. Make only the user-session factory async, await cookie store and propagate awaited calls through real callers and inferred types; use `Awaited<ReturnType<typeof createClient>>` or a clear independent type after verifying imports. Do not accidentally convert separate synchronous `createServiceRoleClient()` or change its privilege model. Check tests mocking factory and callback contexts. | Critical to correctness/auth |
| Async headers | `lib/admin/supplier-actions.ts:74` calls `headers().get(...)`. | Await request headers without changing rate-limit identity, server validation or supplier response semantics. | High |
| Dynamic framework params | `app/api/mobile/v1/orders/[id]/route.ts` reads synchronous `params.id` and uses `ReturnType<typeof createClient>`; direct convention search found 36 dynamic page/layout/route paths, while broad params/searchParams scan found 109 paths and 15 mobile routes. | Async params/searchParams in Next 16 route/page/layout and generateMetadata; await in async functions or React `use` in synchronous client components as appropriate. `new URL(request.url).searchParams` is ordinary URL API, not an async framework prop. Broad matches include false positives; regex can also miss aliases. Update test fixtures that invoke route handlers directly to pass promise params. | High |
| Middleware and sessions | `middleware.ts`, `lib/supabase/middleware.ts`, `app/auth/callback/route.ts`; refresh uses `getUser`, accumulates cookie chunks. Several redirects return a new `NextResponse` without explicitly copying pending cookies. | `middleware` convention is deprecated, but Next 16 `proxy` is Node-only; do not blindly rename or change runtime. Keep existing convention initially, test matcher, server-side auth, login/recovery/logout, chunked refresh, redirects and sign-out. Investigate redirect cookie propagation as an existing risk; no claim of reproduced bug. Keep DB/RLS logic unchanged. | Critical |
| React 19 | `components/auth/login-form.tsx`, `components/auth/register-retailer-form.tsx`, `components/retailer/security-forms.tsx`, many admin forms: 35 text-matching files use `useFormState`. | Hook remains available but deprecated; avoid mass rewrite to `useActionState` unless typing or tests prove necessary. Test form state, pending/errors and hydration. Audit React 19 ref callback return types, `useRef`, JSX typings and peer graph. Selected searches found no ReactDOM.render/hydrate/findDOMNode or empty `useRef()` pattern, not a complete semantic proof. | High |
| Cache & actions | `lib/staff/pick-pack-actions.ts`, `lib/seller/actions.ts`, `lib/salesman/orders-actions.ts` and other modules use `revalidatePath`; 54 files matched cache/revalidation text. No direct `revalidateTag(` or `unstable_cache(` match in searched app/lib/components/middleware/config. | Next 15 uncaches default fetch/GET and changes client navigation cache; Next 16 changes navigation/prefetch and `revalidateTag` signature. Retest account isolation, cache freshness, read-your-writes, revalidation after cart/inventory/admin actions. Do not enable Cache Components or React Compiler as part of migration. | High |
| Images | `next.config.mjs`, `components/media/stored-image.tsx` and 11 other exact `next/image` import files listed below; many use `unoptimized`. | 16 changes quality default `[75]`, local image query rules, minimum TTL 60s → 4h, image sizes, private-IP restrictions and max redirects. Inspect actual generated URLs and direct optimizer response; preserve remote allowlist and do not relax SSRF defenses. Compare image freshness/quality with approved fixtures. | Medium/high |
| PWA / browser navigation | `public/sw.js`, `components/pwa/ServiceWorkerRegister.tsx`, `app/manifest.ts`, `app/layout.tsx`; `app/globals.css:27` sets global `scroll-behavior: smooth`. | SW intentionally caches allowlisted public assets only, API/Supabase/navigation network-only. Verify new RSC/prefetch and SW update/rollback do not cache private responses, including cross-account navigation. Next 16 no longer overrides smooth scroll for route changes; evaluate `data-scroll-behavior="smooth"` in `app/layout.tsx` to restore prior behavior **only if verified needed**; respect reduced-motion CSS. | High privacy / medium UX |
| Runtime / bundler / lint | `package.json`, `.eslintrc.json`, `next.config.mjs`, `tsconfig.json`, `.github/workflows/ci.yml`, `vercel.json`. | Next 16 removes `next lint` and `next.config` `eslint` option, and build no longer lints. Proposed separate ESLint 9 CLI + flat config must preserve rule coverage; remove obsolete Next config property. Turbopack is default dev/build; current Next config has no custom webpack, but test real bundle and use `--webpack` only for an evidence-backed reviewed compatibility fallback. Node runtime policy and `npm install` vs pnpm lock mismatch remain deployment blockers until independently reviewed. | High |
| Other published changes | Source scan found no `experimental-edge`, `experimental_ppr`, removed `next/amp`, `next/config`, `@next/font`, `unstable_rootParams`, `generateSitemaps` / `generateImageMetadata`, Pages data functions or parallel `@slot` directories under searched paths. | No automatic edits implied. Review dynamic metadata and route conventions with generated types. Retest next/image, old runtime flags, removed config and dependency/plugin-generated config; absence of text matches is bounded evidence only. | Low/unknown |
| Environment / secrets | Server-only access in `lib/supabase/server.ts`, `lib/admin/supplier-rate-limit.ts`; public runtime paths in `lib/auth/actions.ts` and app pages. | Next 16 removes runtime config APIs, none found in scan; verify server-only keys remain server-side, public URL evaluation timing/build-time bundling, auth redirect behavior. Do not expose values or modify production settings. | High |
| Android contract | 55 `app/api/mobile/v1` handlers; 15 params-text candidates in the prior proposal. Kotlin client `android/core/network/src/main/kotlin/com/maharanitraders/core/network/MaharaniApi.kt`. | Keep URLs, methods, bearer auth, status/error envelopes, fields, idempotency, pagination and headers identical; test with mocks/fixtures and no real orders. Do not rewrite Kotlin or build APK/AAB as part of migration. | Critical |

## 4. Proposed implementation sequence — requires one explicit approval

1. Recheck official security release/versions, branch/HEAD/status and files; preserve two existing Phase 1 edits and every audit document. Because `node_modules` is absent, restore **only current lock** with `corepack pnpm install --frozen-lockfile` in local environment after implementation approval. Run the relevant safe baseline tests after inspecting environment/network behavior; report gaps, do not connect production or print secrets. If unexpected user changes, peer conflicts, security-release changes or unsafe test setup occur, stop the affected step and report evidence.
2. Scope dependency changes precisely to the target table above. Preserve pnpm 9.15.9 and unrelated direct dependency versions; no `update`, `audit fix`, forced peers or broad codemod. Review package/lock diff and unexpected transitive movement; check actual peers. Avoid separate version upgrades unless strictly necessary and explicitly covered by approval.
3. Remove obsolete Next `eslint` config, replace `next lint` with reviewed CLI/flat-config, preserve separate CI lint and rule parity. Align Node engine; do not modify `vercel.json`, Vercel settings or deployed runtime without separate approval. No deployment.
4. Convert async cookies and headers, propagate calls/types carefully; inspect synchronous service-role consumers separately. Convert framework params and their direct-handler tests; do not change URL contracts. Recheck `next typegen` and build-generated route types as part of approved validation.
5. Validate auth refresh/redirect/logout, role boundaries and source mocks, API compatibility, PWA and image behavior before claiming success. Leave middleware convention intact unless evidence and reviewed approved scope justify a runtime-safe alternative. No schema changes, new Supabase migrations or behavior refactor.
6. Run the matrix below, record exact totals/exits and audit before/after, inspect diff for unintended dependency bumps/secrets and report unresolved risk. On genuine blockers capture exact error and continue independent safe tasks only within the approved phase; do not silently bypass checks.

### Required test and security evidence after approval

| Area | Evidence / exact examples | Pass requirements and boundaries |
|---|---|---|
| Toolchain | `corepack pnpm install --frozen-lockfile`; `corepack pnpm run typecheck`; `corepack pnpm run lint`; `corepack pnpm test`; `corepack pnpm run build`; `git diff --check` | Run a safe baseline, then after migration; collect exits and exact Vitest passed/failed/skipped totals. Build is not lint. `tsconfig.json` existing typecheck alone is not proof all generated route contracts work; also build/typegen. No formatter script exists. |
| Session / roles | `tests/auth-login.test.ts`, `tests/auth-session-cookies.test.ts`, `tests/authenticate.test.ts`, `tests/admin-layout-guard.test.ts`, `tests/page-permission-guards.test.ts`, `tests/supplier-actions-f1.test.ts` | Cookies/chunks/redirects, login/logout/recovery, inactive/suspended/pending, tenant and server-side permissions. Mocks are not live RLS verification. |
| Mobile | `tests/mobile-api-foundation.test.ts`, `tests/mobile-auth.test.ts`, `tests/mobile-catalog-api.test.ts`, `tests/mobile-commerce-api.test.ts`, `tests/mobile-order-invoice.test.ts`, `tests/mobile-address-routes.test.ts` | Compare response/status/header/error and auth behavior before/after including dynamic route params, idempotency and retailer isolation; no Kotlin/APK changes. |
| Commerce / images / PWA | `tests/checkout-atomic.test.ts`, `tests/catalog-loading.test.tsx`, `tests/media-upload-preview.test.tsx`, `tests/pwa.test.ts`, `tests/service-worker-register.test.tsx`, `tests/pwa-install-standalone.test.ts`, `tests/pwa-ci.test.ts` | Catalog, checkout, images, API/PWA network-only/private-data cache and offline flow. Real browser/device/service-worker checks may require separate isolated test setup and must be marked blocked/not run if unavailable. |
| Security | `corepack pnpm audit --prod --json`; `corepack pnpm audit --json`; inspect actual tree/lock, secrets and dependency delta | Compare with baseline 41 / 83; measure newly introduced and remaining advisories separately. Existing Zod, dev/test and unrelated findings need independent remediation; no audit-clean assumption. No production exploitation testing. |
| Local integration / UI | A safe isolated local environment and synthetic identities only, if explicitly available and tests are permitted. | No production credentials, real transactions, notifications, SQL writes to production or live RLS assertions. PGlite/mocks must be labeled. |

CI and local results must be reported as passed/failed/skipped/not run/blocked; the full regression, real Supabase RLS and physical Android validation require their own approval and setup. A good local build alone is not release approval.

### Rollback

Keep the exact pre-migration tracked/untracked snapshots and review changes by path/hunk. Revert only migration-specific source/config/package and lockfile hunks as a coherent unit; never `git reset --hard`, clean, overwrite user data or remove the two Phase 1 edits/reports. Re-run frozen install and relevant tests/audits against the reverted tree when authorized. Reintroducing unsupported Next 14 reintroduces risks. Any remote rollback/deployment is a **separate approval**, not part of local rollback.

## 5. Subsequent phases and PR isolation — preparation, not authorization

- Zod 4: create separate inventory/matrix and implementation proposal; no automatic migration with Next. `lib/ai/safety/confirmation.ts` has single-argument `z.record`, `lib/admin/banners-actions.ts` uses `errorMap`, `app/api/ai/chat/route.ts` exposes flattened errors. Approve Zod work separately.
- Dependency security: run fresh production/full audits after an approved Next change; investigate actual dependency paths for Next, React, PostCSS, nanoid, source-map-js, Zod, Vitest and workers. No unsupported overrides or broad upgrades.
- Application security and Supabase: source/isolated verification before fixes; official project `fhrmsrumsraprvutrpeo` only after separately authorized identity-verified read-only access. No live data writes or legacy target. Existing migration files are not proof of deployed RLS/security.
- Marketplace, homepage/PWA and Kotlin retailer Android follow their own reviews/approvals; exclude food; do not implement paid membership until owner resolves previous retirement versus Free/Silver/Gold. Android must remain retailer-only; no APK/AAB publishing without separate approval.
- Full regression and documented release gates follow. This session is fixed to branch `arena/2ab6a8a1-maharani-mart`; no new feature branch may be created here. To keep independent PRs isolated, use separately provisioned Arena sessions/branches rather than combining unrelated work. Push/PR strategy: review exact scoped diffs and secret scan, check existing PR conflicts/CI and require the relevant explicit owner authorization; never merge/close/overwrite existing PRs or deploy without their own approval.

## Appendix — exact static-scan candidates, not guaranteed edits

The prior [proposal](./SUPPORTED_MAJOR_MIGRATION_PROPOSAL.md#appendix-a--exact-source-scan-inventory-of-review-candidates) lists all 272 SSR import consumers, 109 broad framework-param candidates, 15 mobile params matches and 99 `ReturnType` matches. The following supplemental exact paths were obtained from the current source tree. Test matches include source-string checks and mocks; not all are guaranteed to require editing.

### Dynamic convention candidates (directly under a dynamic segment): 36 files

```text
app/admin/areas/[id]/page.tsx
app/admin/banners/[id]/page.tsx
app/admin/catalog/brands/[id]/page.tsx
app/admin/catalog/categories/[id]/page.tsx
app/admin/control-center/users/[id]/page.tsx
app/admin/coupons/[id]/page.tsx
app/admin/delivered/[orderId]/page.tsx
app/admin/inventory/grn/[id]/page.tsx
app/admin/orders/[id]/page.tsx
app/admin/products/[id]/page.tsx
app/admin/retailers/[id]/page.tsx
app/admin/routes/[id]/page.tsx
app/admin/sellers/[id]/page.tsx
app/admin/suppliers/applications/[id]/page.tsx
app/admin/support/[id]/page.tsx
app/admin/team/[id]/page.tsx
app/admin/wallets/[id]/page.tsx
app/admin/warehouses/[id]/page.tsx
app/api/mobile/v1/addresses/[addressId]/route.ts
app/api/mobile/v1/cart/lines/[lineId]/route.ts
app/api/mobile/v1/catalog/products/[id]/route.ts
app/api/mobile/v1/orders/[id]/route.ts
app/api/mobile/v1/orders/requests/[requestKey]/route.ts
app/api/mobile/v1/saved-carts/[id]/route.ts
app/api/mobile/v1/saved-carts/items/[itemId]/route.ts
app/api/mobile/v1/support/tickets/[id]/route.ts
app/retailer/brands/[id]/page.tsx
app/retailer/catalog/[id]/page.tsx
app/retailer/categories/[id]/page.tsx
app/retailer/orders/[id]/page.tsx
app/retailer/support/[id]/page.tsx
app/salesman/deliveries/[orderId]/page.tsx
app/salesman/orders/[id]/page.tsx
app/salesman/retailers/[id]/page.tsx
app/staff/deliveries/[orderId]/page.tsx
app/staff/orders/[id]/page.tsx
```

### Next image import consumers: 12 files

```text
app/admin/banners/page.tsx
app/retailer/catalog/page.tsx
app/retailer/checkout/page.tsx
app/retailer/orders/[id]/page.tsx
components/ai/maharani-ai-chat.tsx
components/media/stored-image.tsx
components/retailer/compare-grid.tsx
components/retailer/frequent-product-card.tsx
components/retailer/promo-banner.tsx
components/retailer/quick-order-row.tsx
components/retailer/reorder-form.tsx
components/salesman/order-builder.tsx
```

### Tests coupled to server-client, cookies, middleware or Next config: 29 files

```text
tests/admin-coupons-actions.test.ts
tests/admin-layout-guard.test.ts
tests/admin-master-data-actions.test.ts
tests/admin-page-error-states.test.tsx
tests/ai-cleanup-route.test.ts
tests/auth-login.test.ts
tests/business-settings-authorization.test.ts
tests/checkout-atomic.test.ts
tests/coins-order-flow.test.ts
tests/compliance-contacts.test.ts
tests/district-management.test.ts
tests/health-endpoint.test.ts
tests/list-pages-read-failure.test.tsx
tests/mobile-api-foundation.test.ts
tests/mobile-retailer-upgrade-api.test.ts
tests/order-launch-readiness.test.ts
tests/order-request-replay.test.ts
tests/page-guard-consistency.test.ts
tests/public-information.test.ts
tests/queue-loaders-read-failure.test.tsx
tests/retailer-enterprise-upgrade.test.ts
tests/retailer-home-actions.test.ts
tests/retailer-home-auth.test.ts
tests/retailer-statement-exports.test.ts
tests/saran-district.test.ts
tests/security-phase0-app.test.ts
tests/seller-marketplace-actions.test.ts
tests/seller-marketplace-db.test.ts
tests/supplier-actions-f1.test.ts
```

### React useFormState / useActionState text matches: 35 files

```text
components/admin/area-edit-form.tsx
components/admin/area-form.tsx
components/admin/banner-edit-form.tsx
components/admin/banner-form.tsx
components/admin/batch-loss-form.tsx
components/admin/brand-edit-form.tsx
components/admin/brand-form.tsx
components/admin/category-edit-form.tsx
components/admin/category-form.tsx
components/admin/delivery-pin-form.tsx
components/admin/grn-form.tsx
components/admin/inventory-settings-form.tsx
components/admin/price-list-form.tsx
components/admin/price-preview-form.tsx
components/admin/product-bulk-panel.tsx
components/admin/product-form.tsx
components/admin/product-pack-manager.tsx
components/admin/product-thresholds-form.tsx
components/admin/retailer-area-reassign-form.tsx
components/admin/route-create-form.tsx
components/admin/salesman-assignment-form.tsx
components/admin/staff-edit-form.tsx
components/admin/staff-form.tsx
components/admin/stock-adjustment-form.tsx
components/admin/transfer-form.tsx
components/admin/warehouse-edit-form.tsx
components/admin/warehouse-form.tsx
components/auth/forgot-password-form.tsx
components/auth/login-form.tsx
components/auth/register-retailer-form.tsx
components/auth/resend-confirmation-form.tsx
components/auth/reset-password-form.tsx
components/retailer/notification-prefs-form.tsx
components/retailer/profile-edit-forms.tsx
components/retailer/security-forms.tsx
```
