# Maharani Traders — Supported Next.js major migration proposal

**तारीख:** 2026-11-02 (owner local date) · **स्थिति:** केवल प्रस्ताव / किसी implementation की स्वीकृति नहीं।
**Branch:** `arena/2ab6a8a1-maharani-mart` · **HEAD:** `c1a3e1b52656761c728d1966603f4c8034a40f8e`.

## 1. आधार और सुरक्षा सीमा

Phase 1 के दो test edits और `docs/master-audit-2026-11-01/` के पहले से untracked documents सुरक्षित हैं। इस जाँच में कोई package install/upgrade, app code edit, lockfile change, Supabase connection/SQL, production access/configuration, deployment, Android build, commit, push या PR नहीं किया गया। **एकमात्र नया deliverable यह proposal है।** Registry metadata, repository files और आधिकारिक documentation read-only देखी गई। कोई candidate build, upgrade या regression test नहीं चलाया गया।

Phase 1 का पूर्व evidence: local typecheck/lint/build और 10 targeted tests पास थे; पूरा suite और वास्तविक Supabase/device परीक्षण नहीं हुए। Phase 2 Stage A का पिछले audit snapshot: production 41 findings (4 critical / 16 high / 17 moderate / 4 low), full 83 affected-version findings; audit **इस proposal में दोबारा नहीं चलाया गया**। [PHASE_2_SECURITY_AUDIT.md](./PHASE_2_SECURITY_AUDIT.md) में पूरी सूची, वास्तविक version ranges और exposure सीमाएँ देखें। Source/lock में reported vulnerable version होने का अर्थ production exploitation नहीं है।

## 2. विकल्पों की तुलना और recommendation

| विषय | A. अस्थायी 14.2.35 patch | B. Next 15.5.28 | C. Next 16.4.1 — अनुशंसित दीर्घकालिक लक्ष्य |
|---|---|---|---|
| Support | **14.x unsupported**; production समाधान नहीं | Maintenance LTS; security releases **31 Jan 2027** तक, इसलिए छोटा window | Active LTS; version-specific support/patches फिर जाँचें |
| प्रमुख Next advisories | Stage A semver simulation में 34 मौजूदा Next advisory ranges में 25 अब भी match; उनमें 3 critical | Stage A के 34 current Next ranges में 0 match — **simulated, नए lock पर audit नहीं** | वही 0 match — **simulated, नए lock पर audit नहीं** |
| PostCSS | Next अपने साथ 8.4.31 exact रखता है | Registry metadata के अनुसार 8.4.31 exact रहता है | Registry metadata: 8.5.23; nanoid/source-map-js जैसे transitive versions पुनः audit आवश्यक |
| React / React DOM | मौजूदा 18.3.1 साथ रख सकते हैं | App Router upgrade guide React 19 न्यूनतम बताती है; React/DOM और types साथ upgrade प्रस्तावित | React 18.2+ peer और docs में supported लेकिन **deprecated**; React 19 recommended, दोनों साथ upgrade प्रस्तावित |
| Node / lint | वर्तमान Node >=18.18 manifest | Next package engine `^18.18.0 || ^19.8.0 || >=20`; मौजूदा ESLint 8 peer compatible | Node >=20.9; `next lint` हट चुका; matching eslint-config-next 16.4.1 के लिए ESLint >=9, lint migration आवश्यक |
| Code / जोखिम | सबसे छोटा diff, लेकिन residual risk अधिक | async request APIs/React migration; बहुत से कॉल sites; अगले major की deadline जल्द | B के सभी बदलाव + lint, bundler, middleware/proxy, image/cache compatibility; अधिक upfront regression risk |
| निष्कर्ष | केवल owner risk acceptance के साथ bridge; release sign-off नहीं | छोटा supported bridge, लेकिन PostCSS और 2027 deadline अलग से हल करनी होगी | अलग approval के बाद isolated Next 16 migration की अनुशंसा; production readiness test और professional/security gates के बाद ही |

स्रोत: [Next support policy](https://nextjs.org/support-policy), [October 2026 security release](https://nextjs.org/blog/nextjs-security-update-october-14-2026), [15 guide](https://nextjs.org/docs/app/guides/upgrading/version-15), [16 guide](https://nextjs.org/docs/app/guides/upgrading/version-16), [React version support](https://nextjs.org/docs/messages/react-version). **3 November 2026** को Next ने seven medium findings के लिए नया release preannounce किया है; migration शुरू करने से पहले उसके advisories और वर्तमान stable versions दोबारा देखें: [announcement](https://nextjs.org/blog/upcoming-nextjs-security-release-november-2026). यहाँ exact versions **snapshot candidates** हैं, हमेशा सुरक्षित रहने का वादा नहीं।

### React 18 बनाम React 19: आवश्यक सावधानी

`npm view next@15.5.28` और `@16.4.1` दोनों के peer ranges `react`/`react-dom` `^18.2.0` स्वीकार करते हैं। लेकिन [Next 15 App Router upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-15) React/React DOM 19 को न्यूनतम बताती है और [Next 15 docs](https://nextjs.org/docs/15) App Router में bundled React canary और Pages Router में installed React का अंतर बताती हैं। इसलिए peer acceptance को App Router compatibility का प्रमाण न मानें; **Next 15 के लिए matching React 19 और types को plan करें**, और divergence होने पर पहले Next की version-matched guidance verify करें। Next 16 की [React support page](https://nextjs.org/docs/messages/react-version) React 18.2+ को supported पर deprecated बताती है; दीर्घकालिक योजना में 19 सुझाया गया है।

Registry में मौजूद candidate `react@19.2.9` + `react-dom@19.2.9`, `@types/react@19.2.18` + `@types/react-dom@19.2.7` हैं; **इनका install, audit, peer और application compatibility सत्यापित नहीं किया गया**। इन्हें implementation से पहले current advisories/registry के खिलाफ recheck करें; React 19 के विभिन्न releases में भी security patches हुए हैं। React/DOM versions को mismatch न करें। `useFormState` अभी कई auth/admin/retailer components में है; React 19 में deprecated है, तत्काल mass rewrite आवश्यक मानने के बजाय behavior/type tests करें। React 19 के refs, `useRef` और types समेत [official breaking changes](https://react.dev/blog/2024/04/25/react-19-upgrade-guide) पर परीक्षण जरूरी है। Existing React 18 और `@types/react` 18 UI behavior को बिना test बदलना जोखिमपूर्ण है।

## 3. Current architecture और concrete compatibility risks

| क्षेत्र | देखे गए exact स्रोत | migration प्रभाव / आवश्यक जाँच |
|---|---|---|
| Supabase SSR और cookies | `lib/supabase/server.ts`, `lib/supabase/client.ts`, `lib/supabase/middleware.ts`, `lib/auth/session.ts`, `app/auth/callback/route.ts` | `createClient()` अभी sync है और `cookies()` sync पढ़ता है; Next 15/16 में `await cookies()` और async factory/consumers की आवश्यकता हो सकती है। SSR से import वाले **272 files** source scan में मिले, पर सभी को edit करना जरूरी नहीं; `ReturnType<typeof createClient>` usages तथा callers अलग देखें। Cookie chunking, refresh, sign-out, redirect पर Set-Cookie propagation और PKCE test आवश्यक। Service role/DB/RLS semantics को बदलना प्रस्तावित नहीं। |
| headers | `lib/admin/supplier-actions.ts` | `headers().get(...)` async API के कारण बदलने की संभावना; rate-limit identity logic पहले और बाद test करें। |
| Middleware | `middleware.ts`, `lib/supabase/middleware.ts`; tests `tests/auth-session-cookies.test.ts`, `tests/public-information.test.ts`, `tests/admin-layout-guard.test.ts`, `tests/saran-district.test.ts` | Existing gate active profile/role/seller/retailer और session refresh करता है। Next 16 में `middleware` deprecated; `proxy.ts` Node-only है, Edge चाहिए तो existing middleware रखा जा सकता है। इसे बिना आवश्यकता rename न करें; Node/Edge, matcher, redirect cookie handling, user verification और independent server/RLS authorization test करें। Tests में hardcoded `middleware.ts` references हैं। |
| Dynamic pages/routes | `app/retailer/orders/[id]/page.tsx`, `app/retailer/catalog/[id]/page.tsx`, `app/admin/sellers/[id]/page.tsx`, `app/staff/orders/[id]/page.tsx` और नीचे inventory | 15 में `params`/page `searchParams` asynchronous हैं; 16 में migration पूरी करनी होगी। Query-string `new URL(request.url).searchParams` को framework prop से भ्रमित न करें। generated Next route types, `Awaited<...>` और exact call sites check करें। |
| Mobile API contract | `app/api/mobile/v1/orders/[id]/route.ts`, अन्य 14 dynamic API files नीचे; `docs/NATIVE_ANDROID_API_CONTRACT.md`, `lib/mobile/auth.ts`, `lib/mobile/http.ts` | Dynamic handler params await करते हुए **same** URL, methods, bearer authorization, status/error envelope, idempotency और response fields रखें। `ReturnType<typeof createClient>` in mobile route async factory बनने पर Promise type बन सकता है; `Awaited<ReturnType<...>>` या स्वतंत्र typed contract का सावधानी से परीक्षण आवश्यक। No Android code or APK change assumed. |
| Cache / PWA | `app/manifest.ts`, `app/layout.tsx`, `components/pwa/ServiceWorkerRegister.tsx`, `public/sw.js`, `next.config.mjs`, `components/media/stored-image.tsx` | 15 fetch/GET/client cache defaults बदलता है; personalized responses और image freshness जाँचें। 16 image caching/defaults और build bundler बदलते हैं। SW का network-only API/Supabase/navigation और static-only caching सुरक्षित रखें। Cross-account RSC/HTML, offline fallback और deploy-update/rollback browser tests अनिवार्य। |
| Lint/build | `package.json`, `.eslintrc.json`, `next.config.mjs`, `.github/workflows/ci.yml`, `vercel.json` | 16 में `next lint` हटाया गया और `next build` lint नहीं चलाता। ESLint 9/flat-config या documented compatibility setup, matching config और अलग lint command की जरूरत। CI Node 22/pnpm है; `vercel.json` में `npm install` है जबकि lock pnpm है — production behavior अज्ञात। CI/config changes, विशेषकर deployment config, अलग approval पर ही। |

`corepack pnpm` बनाए रखने में कोई ज्ञात framework requirement blocker नहीं, पर peer resolution और frozen lockfile सफल होने की पुष्टि actual isolated build के बाद ही होगी। Next 16 Node >=20.9 बनाम repo `package.json` का `>=18.18.0` mismatch है; local/CI Node 22 देखा गया, Vercel effective runtime नहीं। Runtime या deployment config को इस प्रस्ताव से बदलने की अनुमति नहीं।

## 4. Option-specific implementation and rollback plans — प्रस्ताव मात्र

### A. 14.2.35 temporary patch-only

- **Exact package candidates:** `next` 14.2.15 → 14.2.35 और `eslint-config-next` 14.2.15 → 14.2.35. Phase 2 की अलग अनुमति से direct dev `postcss` 8.5.19 → 8.5.23 और targeted transitive `nanoid` 3.3.16 → 3.3.18 / `source-map-js` 1.2.1 → 1.2.2 पर विचार; overrides बिना प्रमाण नहीं।
- **Expected files:** `package.json`, `pnpm-lock.yaml`; test files केवल यदि नई explicit approval मिले। Changes से पहले risk owner acceptance; pnpm resolution में unexpected unrelated changes हों तो stop।
- **Security coverage:** 9 of 34 previously reported Next ranges no longer match in semver-only calculation; 25 remain, including three critical. 14.x unsupported, Next PostCSS 8.4.31 और Zod finding remain; production deploy नहीं।
- **Steps:** patch versions and targeted frozen pnpm resolution → diff/peer check → test plan below → before/after audit → लिखित residual risk report। यह major migration का विकल्प नहीं।
- **Rollback:** केवल इस option से बने `package.json`/lockfile hunks को pre-change snapshot पर restore; Phase 1 test edits और audit docs untouched। No reset. Old version पर लौटने से advisories फिर आएँगी।

### B. Next 15.5.28 maintenance bridge

- **Exact candidates:** `next@15.5.28`, `eslint-config-next@15.5.28`; React/DOM और matching types candidate section 2 में; `pnpm@9.15.9` को रखें जब तक actual incompatibility न हो। Production package version freeze implementation समय पुनः जाँचें।
- **Expected files:** `package.json`, `pnpm-lock.yaml`, `lib/supabase/server.ts`, async factory consumers/types, `lib/admin/supplier-actions.ts`, relevant dynamic route/page/handler files, targeted tests। `middleware.ts` review/test; default रूप से rename नहीं। Exact complete diff अभी ज्ञात नहीं — Appendix के exact paths review candidates हैं, automatic edit list नहीं।
- **Security coverage:** Stage A के existing 34 Next advisory ranges को 15.5.28 ने simulation में नहीं match किया; newly published/version-specific advisories और full dependency graph अलग से audit करें। Next का `postcss@8.4.31`, Zod और dev findings बने रह सकते हैं। अगले **31 Jan 2027** के लिए Next 16 migration plan आवश्यक।
- **Steps:** isolated dependency/peer inventory → React compatibility → async cookies, headers, params/searchParams और callers को छोटे reviewable चरणों में migrate → session and Android contract tests → cache/security/PWA checks → frozen build/full tests/audit। No forced compatibility casts or disabled lint। DB schema या product logic न बदलें।
- **Rollback:** local scoped diff/lock hunks वापस; verified previous build-artifact/immutable release reference तथा owner-approved staging-only rollback test। Deployment/production rollback भी अलग owner approval है। New code को old deps के साथ आंशिक न छोड़ें; Phase 1 test edits तथा reports न हटें।

### C. Next 16.4.1 active LTS target

- **Exact candidates:** `next@16.4.1`, `eslint-config-next@16.4.1`; React/DOM/types candidate section 2; `eslint@9.39.5` registry candidate, compatible peer assessment और lint parity के बाद ही; Node >=20.9 (recommended verified 22) and pnpm 9.15.9 pending compatibility. No upgrade commands approved.
- **Expected files:** B के candidate files + `package.json` (`lint`, engines और आवश्यक build script), `.eslintrc.json` और संभव नया `eslint.config.*`, `next.config.mjs` का existing `eslint` option हटाने/अद्यतन करने हेतु यदि required, `.github/workflows/ci.yml` यदि separately approved, `middleware.ts`/`lib/supabase/middleware.ts` और tests केवल चयनित runtime/convention के अनुसार। A `proxy.ts` would be a proposed new file **only if approved after compatibility testing**; current source/tests को अंधाधुंध rename न करें। `vercel.json` या live Vercel settings अलग approval से पहले नहीं बदलेंगे।
- **Security coverage:** 16.4.1 current 34 legacy Next ranges की semver comparison में match नहीं; अक्टूबर का [SVG/Server Action release](https://nextjs.org/blog/nextjs-security-update-october-14-2026) इस version का आधार है। It declares PostCSS 8.5.23; actual new dependency graph, `sharp`/libheif, dev advisories और deployment protections unverified. November announcement के बाद candidate re-evaluate करें।
- **Steps:** Node and lint design → async API and React migration → preserve middleware/choose Edge vs Node → separate lint and test commands → Turbopack/webpack comparison (16 default Turbopack; existing `next.config.mjs` no custom webpack observed) → image/caching and PWA review → contract, security, compatibility and full audits → isolated staging evidence। No enabling Cache Components or React Compiler merely because available।
- **Rollback:** exact reviewed feature diff and associated pnpm lockfile as a single unit, scoped tests/config and metadata; retain earlier Phase 1 changes. Check old React/Next compatibility and privacy/cookie cache state in isolated staging. Never deploy an old vulnerable version without owner-authorized incident risk decision; production release and rollback need distinct approval.

## 5. Zod 3 → 4: अलग workstream, किसी framework option का bundled काम नहीं

- Current `zod@3.25.76`; production audit reports [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) high, patched range >=4.6.6. Version range is a package-level alert; oversized array exploitability and exact v3/v4 affected implementation not established. `lib/mobile/http.ts` 32 KiB validation happens **after request text is read**, so it is not a streaming limit. `lib/admin/transfer-actions.ts` and `lib/admin/grn-actions.ts` contain `z.array(...).safeParse(...)` without local array max; authorization/other input limits must be examined, not bypassed.
- Concrete incompatible/deprecated constructs: `lib/ai/safety/confirmation.ts` uses one-argument `z.record(z.unknown())`; `lib/admin/banners-actions.ts` uses `errorMap`; `app/api/ai/chat/route.ts` uses `error.flatten()`. Check all 73 `app`/`lib` import paths below plus error formatting, strictness, defaults, optionality, transforms, unions, refine and inferred types. Official [Zod migration guide](https://zod.dev/v4/changelog) identifies these changes.
- Candidate `zod@4.6.6` (registry present) is **not installed or tested**. A v4 package retaining `zod/v3` subpath does not by itself prove vulnerable v3 functionality is fixed; verify actual entrypoint, upstream patch and behavior, not just disappearance from audit.
- Proposed files: `package.json`, `pnpm-lock.yaml`, affected schema files and focused tests after scoped approval; exact edits only after a baseline/compatibility run. Tests: auth and registration validation; mobile API envelopes, size/array malicious-input boundaries in isolated harness, schema error response compatibility, admin seller/product/transfer validation, defaults/transforms, property/negative cases and full typecheck/build. Compare behavior and audit before/after.
- Rollback: restore only Zod migration hunks and prior lockfile resolution; preserve framework migration separately and Phase 1 work. Track remaining vulnerability and do not claim release readiness after rollback.

## 6. Validation matrix and acceptance gates for any future approved implementation

| Layer | Exact examples / checks | Acceptance evidence and limitations |
|---|---|---|
| Baseline and quality | `corepack pnpm install --frozen-lockfile`, `corepack pnpm run typecheck`, `corepack pnpm run lint`, `corepack pnpm test`, `NEXT_TELEMETRY_DISABLED=1 corepack pnpm run build`, `git diff --check`, prod/full audits | Exact commands/exits/counts and version hashes; full-suite baseline before migration and rerun after; format tool absent. Do not claim success from proposal. Inspect tests before execution for production access; skip/block unsafe integration tests. |
| Session / security | `tests/auth-login.test.ts`, `tests/auth-session-cookies.test.ts`, `tests/authenticate.test.ts`, `tests/page-permission-guards.test.ts`, `tests/seller-marketplace-actions.test.ts`, `tests/security.test.ts` | Login, registration, recovery, chunked cookies, refresh/redirect, logout, pending/suspended, seller/retailer isolation, anon/role escalation, middleware bypass; local mocks clearly marked, approved isolated real RLS tests separately. |
| Commerce / admin | `tests/checkout-atomic.test.ts`, `tests/catalog-loading.test.tsx`, `tests/tax-invoice-readiness.test.ts`, `tests/ordering-readiness-persistence-db.test.ts`, `tests/media-upload-preview.test.tsx` | Prices, stock, checkout idempotency, image uploads, ordering and invoice guards; PGlite is not real concurrency or live Supabase. Preserve existing Phase 1 test diffs. |
| Android API | `tests/mobile-api-foundation.test.ts`, `tests/mobile-auth.test.ts`, `tests/mobile-catalog-api.test.ts`, `tests/mobile-commerce-api.test.ts`, `tests/mobile-order-invoice.test.ts`, `tests/mobile-address-routes.test.ts` | Snapshot method/path/status/error/data shape and authorization for all 55 v1 routes including 15 dynamic-param handlers; no Kotlin code or app build necessary for first local API contract pass. Real device checks separately approved. |
| Browser/PWA | `tests/pwa.test.ts`, `tests/pwa-install-standalone.test.ts`, `tests/service-worker-register.test.tsx`; local browser privacy checks | Install/update/offline, cache isolation between users, no cached private API/HTML/RSC, image freshness and navigation. Test browser/device matrix in isolated environments. |
| Release | owner-reviewed deploy/rollback documentation | No production write, deploy, live payment, notification, real customer data or APK without separate approval; security and legal gates still apply. |

None of the future tests in this table ran for this proposal. Version comparisons are research, not successful upgrade evidence.

## 7. Approval decisions and non-negotiable limits

1. Choose A (temporary unsupported bridge), B (15 bridge with short support window), or C (16 active-LTS target). Recommendation: **C in an isolated, separately approved staged migration**, after reviewing the Nov 3 security release and a new full baseline. Owner may prefer B for reduced first-step risk but must approve later 16 migration and PostCSS exposure treatment.
2. Explicitly decide React 19/DOM/types candidate and ESLint 9/config migration if 16 selected. No forced peer resolution, secret exposure or public repo changes.
3. Zod migration is an independent proposal/approval; select timing and test isolation. Separate authorization for any storage or server behavior changes, migration, production access/deploy, Git commit/push and APK build.
4. Preserve Phase 1 test edits and all untracked audit documents; no branch switch, reset or overwrite. Work remains on the existing session branch.

## Appendix A — exact source-scan inventory of review candidates

The following generated path inventories are exact matches from the current checkout, **not promises that every file must change**. Dynamic route matches include some query-string references and false positives; verify signatures individually. Actual final changed-file list cannot be known until an approved migration is attempted and tested.

### Next server Supabase import consumers (272 files)

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
app/api/cron/ai-cleanup/route.ts
app/api/cron/cleanup/route.ts
app/api/health/route.ts
app/api/mobile/v1/cart/coupon/route.ts
app/api/mobile/v1/cart/lines/[lineId]/route.ts
app/api/mobile/v1/cart/lines/route.ts
app/api/mobile/v1/health/route.ts
app/api/mobile/v1/orders/[id]/delivery/route.ts
app/api/mobile/v1/orders/[id]/invoice/route.ts
app/api/mobile/v1/orders/[id]/route.ts
app/api/mobile/v1/orders/requests/[requestKey]/route.ts
app/api/mobile/v1/orders/route.ts
app/api/mobile/v1/reports/route.ts
app/api/mobile/v1/reports/statement/route.ts
app/api/mobile/v1/wallet/ledger/route.ts
app/api/mobile/v1/wallet/route.ts
app/api/webhooks/route.ts
app/auth/callback/route.ts
app/page.tsx
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
app/retailer/home/page.tsx
app/retailer/layout.tsx
app/retailer/membership/page.tsx
app/retailer/notifications/page.tsx
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
app/salesman/attendance/page.tsx
app/salesman/collections/page.tsx
app/salesman/commissions/page.tsx
app/salesman/dashboard/page.tsx
app/salesman/dcr/page.tsx
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
app/staff/dashboard/page.tsx
app/staff/deliveries/page.tsx
app/staff/inventory/page.tsx
app/staff/orders/[id]/page.tsx
app/staff/orders/page.tsx
components/inventory/stock-ledger-list.tsx
lib/admin/banner-artwork.ts
lib/admin/banners-actions.ts
lib/admin/business-settings/actions.ts
lib/admin/business-settings/server.ts
lib/admin/catalog-data.ts
lib/admin/cleanup-actions.ts
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
lib/compliance/ordering-readiness.ts
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
lib/storage/usage.ts
lib/warehouse/resolver.ts
```

### Dynamic route/page candidates including query-string false positives (109 files)

```text
app/admin/areas/[id]/page.tsx
app/admin/areas/page.tsx
app/admin/attendance/page.tsx
app/admin/audit-logs/page.tsx
app/admin/banners/[id]/page.tsx
app/admin/catalog/brands/[id]/page.tsx
app/admin/catalog/brands/page.tsx
app/admin/catalog/categories/[id]/page.tsx
app/admin/catalog/categories/page.tsx
app/admin/collections/page.tsx
app/admin/command-center/page.tsx
app/admin/control-center/users/[id]/page.tsx
app/admin/coupons/[id]/page.tsx
app/admin/dashboard/page.tsx
app/admin/delivered/[orderId]/page.tsx
app/admin/delivered/export/route.ts
app/admin/delivered/page.tsx
app/admin/follow-ups/page.tsx
app/admin/inventory/batches/page.tsx
app/admin/inventory/expiry/page.tsx
app/admin/inventory/forecast/page.tsx
app/admin/inventory/grn/[id]/page.tsx
app/admin/inventory/grn/page.tsx
app/admin/inventory/ledger/page.tsx
app/admin/inventory/low-stock/page.tsx
app/admin/inventory/movements/page.tsx
app/admin/inventory/products/page.tsx
app/admin/inventory/reports/export/route.ts
app/admin/inventory/reports/page.tsx
app/admin/notifications/page.tsx
app/admin/offers/page.tsx
app/admin/orders/[id]/page.tsx
app/admin/orders/page.tsx
app/admin/products/[id]/page.tsx
app/admin/products/export/route.ts
app/admin/products/page.tsx
app/admin/reports/page.tsx
app/admin/retailers/[id]/page.tsx
app/admin/retailers/page.tsx
app/admin/routes/[id]/page.tsx
app/admin/sellers/[id]/page.tsx
app/admin/sellers/page.tsx
app/admin/suppliers/applications/[id]/page.tsx
app/admin/suppliers/applications/page.tsx
app/admin/suppliers/page.tsx
app/admin/support/[id]/page.tsx
app/admin/support/page.tsx
app/admin/team/[id]/page.tsx
app/admin/visits/page.tsx
app/admin/wallets/[id]/page.tsx
app/admin/wallets/page.tsx
app/admin/warehouses/[id]/page.tsx
app/api/cron/ai-cleanup/route.ts
app/api/mobile/v1/addresses/[addressId]/default/route.ts
app/api/mobile/v1/addresses/[addressId]/route.ts
app/api/mobile/v1/cart/lines/[lineId]/route.ts
app/api/mobile/v1/catalog/products/[id]/route.ts
app/api/mobile/v1/catalog/products/route.ts
app/api/mobile/v1/catalog/search/route.ts
app/api/mobile/v1/notifications/route.ts
app/api/mobile/v1/orders/[id]/cancel/route.ts
app/api/mobile/v1/orders/[id]/delivery/route.ts
app/api/mobile/v1/orders/[id]/invoice/route.ts
app/api/mobile/v1/orders/[id]/return/route.ts
app/api/mobile/v1/orders/[id]/route.ts
app/api/mobile/v1/orders/requests/[requestKey]/route.ts
app/api/mobile/v1/orders/route.ts
app/api/mobile/v1/quick-order/route.ts
app/api/mobile/v1/reports/statement/route.ts
app/api/mobile/v1/saved-carts/[id]/restore/route.ts
app/api/mobile/v1/saved-carts/[id]/route.ts
app/api/mobile/v1/saved-carts/items/[itemId]/restore/route.ts
app/api/mobile/v1/saved-carts/items/[itemId]/route.ts
app/api/mobile/v1/support/tickets/[id]/route.ts
app/api/mobile/v1/support/tickets/route.ts
app/api/mobile/v1/wallet/ledger/route.ts
app/auth/callback/route.ts
app/login/page.tsx
app/privacy/page.tsx
app/reset-password/page.tsx
app/retailer/brands/[id]/page.tsx
app/retailer/brands/page.tsx
app/retailer/catalog/[id]/page.tsx
app/retailer/catalog/page.tsx
app/retailer/categories/[id]/page.tsx
app/retailer/help/page.tsx
app/retailer/orders/[id]/delivery/page.tsx
app/retailer/orders/[id]/invoice/download/route.ts
app/retailer/orders/[id]/invoice/page.tsx
app/retailer/orders/[id]/page.tsx
app/retailer/orders/[id]/reorder/page.tsx
app/retailer/orders/page.tsx
app/retailer/quick-order/page.tsx
app/retailer/reports/statement/route.ts
app/retailer/support/[id]/page.tsx
app/retailer/support/new/page.tsx
app/retailer/support/page.tsx
app/returns/page.tsx
app/salesman/dcr/page.tsx
app/salesman/deliveries/[orderId]/page.tsx
app/salesman/orders/[id]/page.tsx
app/salesman/orders/new/page.tsx
app/salesman/retailers/[id]/page.tsx
app/salesman/retailers/page.tsx
app/shipping/page.tsx
app/staff/deliveries/[orderId]/page.tsx
app/staff/inventory/ledger/page.tsx
app/staff/orders/[id]/page.tsx
app/terms/page.tsx
```

### Android v1 dynamic handler params (15 files)

```text
app/api/mobile/v1/addresses/[addressId]/default/route.ts
app/api/mobile/v1/addresses/[addressId]/route.ts
app/api/mobile/v1/cart/lines/[lineId]/route.ts
app/api/mobile/v1/catalog/products/[id]/route.ts
app/api/mobile/v1/orders/[id]/cancel/route.ts
app/api/mobile/v1/orders/[id]/delivery/route.ts
app/api/mobile/v1/orders/[id]/invoice/route.ts
app/api/mobile/v1/orders/[id]/return/route.ts
app/api/mobile/v1/orders/[id]/route.ts
app/api/mobile/v1/orders/requests/[requestKey]/route.ts
app/api/mobile/v1/saved-carts/[id]/restore/route.ts
app/api/mobile/v1/saved-carts/[id]/route.ts
app/api/mobile/v1/saved-carts/items/[itemId]/restore/route.ts
app/api/mobile/v1/saved-carts/items/[itemId]/route.ts
app/api/mobile/v1/support/tickets/[id]/route.ts
```

### Zod imports in application source (73 files)

```text
app/api/ai/chat/route.ts
app/api/ai/memory/route.ts
app/api/mobile/v1/account/requests/route.ts
app/api/mobile/v1/addresses/[addressId]/default/route.ts
app/api/mobile/v1/addresses/[addressId]/route.ts
app/api/mobile/v1/cart/coupon/route.ts
app/api/mobile/v1/cart/lines/[lineId]/route.ts
app/api/mobile/v1/cart/lines/route.ts
app/api/mobile/v1/checkout/quote/route.ts
app/api/mobile/v1/favorites/route.ts
app/api/mobile/v1/notifications/preferences/route.ts
app/api/mobile/v1/notifications/read/route.ts
app/api/mobile/v1/notifications/route.ts
app/api/mobile/v1/orders/[id]/cancel/route.ts
app/api/mobile/v1/orders/[id]/delivery/route.ts
app/api/mobile/v1/orders/[id]/invoice/route.ts
app/api/mobile/v1/orders/[id]/return/route.ts
app/api/mobile/v1/orders/[id]/route.ts
app/api/mobile/v1/orders/requests/[requestKey]/route.ts
app/api/mobile/v1/orders/route.ts
app/api/mobile/v1/profile/route.ts
app/api/mobile/v1/quick-order/match/route.ts
app/api/mobile/v1/saved-carts/[id]/restore/route.ts
app/api/mobile/v1/saved-carts/[id]/route.ts
app/api/mobile/v1/saved-carts/items/[itemId]/restore/route.ts
app/api/mobile/v1/saved-carts/items/[itemId]/route.ts
app/api/mobile/v1/saved-carts/items/route.ts
app/api/mobile/v1/saved-carts/route.ts
app/api/mobile/v1/support/tickets/[id]/route.ts
app/api/mobile/v1/support/tickets/route.ts
app/api/mobile/v1/wallet/ledger/route.ts
lib/admin/banners-actions.ts
lib/admin/business-settings/types.ts
lib/admin/coupons-actions.ts
lib/admin/delivery-actions.ts
lib/admin/grn-actions.ts
lib/admin/inventory-actions.ts
lib/admin/master-data-actions.ts
lib/admin/pricing-actions.ts
lib/admin/products-actions.ts
lib/admin/retailer-approval-actions.ts
lib/admin/retailers-actions.ts
lib/admin/routes-actions.ts
lib/admin/schemes-actions.ts
lib/admin/team-actions.ts
lib/admin/tier-pricing-actions.ts
lib/admin/transfer-actions.ts
lib/admin/wallet-actions.ts
lib/ai/config.ts
lib/ai/safety/confirmation.ts
lib/ai/tools/analytics.ts
lib/ai/tools/cart.ts
lib/ai/tools/control-center.ts
lib/ai/tools/discovery.ts
lib/ai/tools/forecast.ts
lib/ai/tools/inventory.ts
lib/ai/tools/memory.ts
lib/ai/tools/orders.ts
lib/ai/tools/products.ts
lib/ai/tools/scheme-discovery.ts
lib/ai/tools/schemes.ts
lib/ai/tools/super-admin.ts
lib/ai/types.ts
lib/areas/district.ts
lib/auth/actions.ts
lib/mobile/auth-api.ts
lib/mobile/http.ts
lib/notifications/broadcast.ts
lib/retailer/address-shared.ts
lib/retailer/product-feedback-actions.ts
lib/retailer/profile-actions.ts
lib/salesman/followup-actions.ts
lib/salesman/order-creation-actions.ts
```

### `ReturnType<typeof createClient>` references (99 files)

Matches may refer to different factories; inspect imports before changing types.

```text
app/admin/audit-logs/page.tsx
app/admin/collections/page.tsx
app/admin/command-center/page.tsx
app/admin/delivered/page.tsx
app/admin/inventory/batches/page.tsx
app/admin/inventory/grn/page.tsx
app/admin/inventory/movements/page.tsx
app/admin/inventory/products/page.tsx
app/admin/inventory/reports/page.tsx
app/admin/notifications/page.tsx
app/admin/orders/page.tsx
app/admin/products/page.tsx
app/admin/retailers/page.tsx
app/admin/support/page.tsx
app/admin/team/page.tsx
app/admin/visits/page.tsx
app/api/ai/chat/route.ts
app/api/mobile/v1/cart/coupon/route.ts
app/api/mobile/v1/cart/lines/[lineId]/route.ts
app/api/mobile/v1/cart/lines/route.ts
app/api/mobile/v1/orders/[id]/delivery/route.ts
app/api/mobile/v1/orders/[id]/invoice/route.ts
app/api/mobile/v1/orders/[id]/route.ts
app/api/mobile/v1/orders/requests/[requestKey]/route.ts
app/api/mobile/v1/orders/route.ts
app/api/mobile/v1/reports/route.ts
app/api/mobile/v1/reports/statement/route.ts
app/api/mobile/v1/wallet/ledger/route.ts
app/api/mobile/v1/wallet/route.ts
app/retailer/notifications/page.tsx
app/retailer/orders/page.tsx
app/retailer/support/page.tsx
app/salesman/collections/page.tsx
app/salesman/orders/page.tsx
app/salesman/retailers/page.tsx
app/salesman/visits/page.tsx
app/staff/inventory/page.tsx
app/staff/orders/page.tsx
components/inventory/stock-ledger-list.tsx
lib/admin/banner-artwork.ts
lib/admin/catalog-data.ts
lib/admin/collections-actions.ts
lib/admin/command-center/actions.ts
lib/admin/command-center/data.ts
lib/admin/cost-access.ts
lib/admin/dashboard/data.ts
lib/admin/pack-seed.ts
lib/admin/product-media.ts
lib/admin/products-actions.ts
lib/admin/seller-actions.ts
lib/admin/suppliers-data.ts
lib/admin/taxonomy-data.ts
lib/ai/agent.ts
lib/ai/authenticate.ts
lib/ai/forecast/data.ts
lib/ai/forecast/index.ts
lib/ai/memory/business-memory.ts
lib/ai/observability.ts
lib/ai/types.ts
lib/coins/server.ts
lib/compliance/catalog-compliance.ts
lib/compliance/evidence-storage.ts
lib/config/delivery-serviceability.ts
lib/coupons/cart-lines.ts
lib/coupons/validate.ts
lib/delivery/delivery-actions.ts
lib/delivery/queries.ts
lib/inventory/forecast-alerts.ts
lib/membership/server.ts
lib/mobile/catalog-service.ts
lib/mobile/commerce-service.ts
lib/mobile/quick-order-service.ts
lib/mobile/search-service.ts
lib/orders/create-order.ts
lib/orders/quote-order.ts
lib/orders/wallet-reversal.ts
lib/retailer/address-actions.ts
lib/retailer/brand-detail.ts
lib/retailer/cart-merge.ts
lib/retailer/cart-rpc.ts
lib/retailer/cart-service.ts
lib/retailer/cart-validation.ts
lib/retailer/catalog-batches.ts
lib/retailer/catalog.ts
lib/retailer/category-detail.ts
lib/retailer/category-pricing.ts
lib/retailer/effective-price.ts
lib/retailer/home-data.ts
lib/retailer/ledger.ts
lib/retailer/marketplace-offers.ts
lib/retailer/personalization.ts
lib/retailer/pricing-data.ts
lib/retailer/reports.ts
lib/retailer/support-actions.ts
lib/retailer/taxonomy-counts.ts
lib/retailer/wallet.ts
lib/salesman/followup-actions.ts
lib/storage/signed-url.ts
lib/warehouse/resolver.ts
```
