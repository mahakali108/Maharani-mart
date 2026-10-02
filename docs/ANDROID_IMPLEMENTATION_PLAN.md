# Maharani Traders — Native Android Implementation Plan (Phase A)

**Status:** Phase A deliverable. Written after a read-only inspection of the whole repository.
**Audit date:** 2026-10-02
**Audited revision:** `arena/01a0fb9b-maharani-mart` @ `77d4b99dd447300b4dc0154bf9b0f39a70304260`

Every claim below is either (a) a file/command result reproduced in §1, or (b) explicitly
marked **NOT VERIFIED** with the reason it could not be checked in this environment.
Nothing in this document was inferred from a previous session's notes without re-checking it.

Companion documents (pre-existing, still accurate — this file supersedes only their *plan*
sections, not their contracts):

- `docs/NATIVE_ANDROID_MIGRATION_AUDIT.md` — endpoint-by-endpoint page classification
- `docs/NATIVE_ANDROID_API_CONTRACT.md` — the `/api/mobile/v1` contract
- `docs/NATIVE_ANDROID_MIGRATION_PLAN.md` — the Phase A–H plan from the earlier session

---

## 1. Repository and environment audit (evidence)

### 1.1 Git state

| Item | Value |
| --- | --- |
| Current branch | `arena/01a0fb9b-maharani-mart` |
| HEAD | `77d4b99` "Update android-apk.yml" |
| Working tree | **clean** (`git status --short` → empty) |
| Stashes | none (`git stash list` → empty) |
| Uncommitted work | none |
| Remotes | `origin` → `https://github.com/mahakali108/Maharani-mart.git` |
| Tracked files | 936 |
| Clone depth | **shallow (depth 1)** — `git log --oneline \| wc -l` = 1 |

> **Preservation note.** The shallow clone means no earlier commit, branch or tag is present
> locally, and the ~20 `arena/*` remote branches were *not* fetched. No reset, rebase,
> force-push, branch deletion or merge will be performed. All work stays on
> `arena/01a0fb9b-maharani-mart`.

### 1.2 Permissions actually confirmed

| Capability | Result | Evidence |
| --- | --- | --- |
| Git push to this branch | **works** | `git push --dry-run origin arena/01a0fb9b-maharani-mart` → `* [new branch]` |
| GitHub API read | works | `gh api /installation/repositories` returns the repo |
| GitHub Actions read | works | `gh run list` returns history |
| Write to `.github/workflows/**` | **UNKNOWN — likely blocked** | documented as blocked in `docs/NATIVE_ANDROID_MIGRATION_PLAN.md` §5; cannot be re-tested without first pushing the branch (the Contents-API probe returns `404 Branch not found`) |
| Repo admin | not granted | `gh api repos/…` → `permissions: {admin:false, push:false}` (App installation tokens do not report collaborator permissions) |

### 1.3 Phased execution status as found (not as claimed by earlier docs)

| Phase | Claimed | **Actually verified now** |
| --- | --- | --- |
| A — Audit | done | ❌ this document is the first Phase A deliverable **for this session**; no `docs/ANDROID_IMPLEMENTATION_PLAN.md` existed |
| B — Native foundation | in progress | ✅ Gradle project + 7 modules + theme + session layer **exist as source**; ❌ **never compiled** — no green native CI run exists |
| C — Authentication | next | ❌ not started (no `feature/auth`, no auth endpoints) |
| D–H | pending | ❌ not started |

**The single most important finding: the native Android app has never been compiled or run.**
5,034 lines of Kotlin exist across 99 files with zero compiler verification. The only Android
CI that has ever run in this repository builds the **retired Capacitor WebView wrapper**.

### 1.4 Build environment available *in this sandbox*

| Tool | Present | Consequence |
| --- | --- | --- |
| JDK | ❌ `java: command not found`, `JAVA_HOME` unset | Gradle cannot run |
| Android SDK | ❌ `ANDROID_HOME`/`ANDROID_SDK_ROOT` unset, no SDK on disk | no `aapt`, no `platforms;android-36` |
| Maven Central / `dl.google.com` / `services.gradle.org` | ❌ **blocked** (`curl` → TLS `SSL_ERROR_SYSCALL`, exit 000) | dependencies cannot be downloaded even if a JDK were installed |
| `github.com`, `registry.npmjs.org` | ✅ reachable | git push, `gh`, npm, vitest all work |
| Node 22.22.3 / corepack / pnpm 9.15.9 | ✅ | web-side work is fully testable |
| CPU / RAM / disk | 2 vCPU / 3.9 GB / 20 GB free | usable for vitest, not for an Android build |

> **Hard conclusion:** `assembleDebug` **cannot** be produced or verified in this sandbox.
> GitHub Actions is the **only** possible build path for the APK, and Maven/Google hosts are
> blocked locally, so local Kotlin compilation is not merely inconvenient — it is impossible.

### 1.5 Web/backend inventory

| Item | Finding |
| --- | --- |
| Framework | Next.js **14.2.15** App Router, React 18.3.1, TypeScript 5.6.3, Tailwind 3.4.14 |
| Route handlers | 8 (`app/api/**`) — including `app/api/health`, `app/api/cron/cleanup`, `app/api/webhooks`, `app/api/ai/**` |
| Mobile API | `app/api/mobile/v1/{health,session}/route.ts` — **2 endpoints only** |
| Mobile helpers | `lib/mobile/{auth,http,pagination,rate-limit,supabase,index}.ts` (1,076 LOC incl. checkout/cart actions) |
| Server actions | 40+ `'use server'` modules under `lib/**` |
| Auth | Supabase GoTrue via `@supabase/ssr` cookies + `middleware.ts` (session refresh, role routing, approval gating, access-period checks) |
| Roles | `lib/auth/roles.ts` → `super_admin \| admin \| staff \| salesman \| retailer` |
| Permissions | `lib/permissions/permissions.ts` — ~50 typed permissions, `permissionsForRole()` |
| Pages | **130** `page.tsx` (retailer 31, staff 8, salesman 18, admin ~50, auth ~8) |
| Migrations | **55** (`0001_init` … `0055_data_retention_cleanup`) |
| Tests | **96 files / 1,826 tests** |

The master prompt's five business roles map onto the existing model exactly:

| Master prompt role | Existing role |
| --- | --- |
| Retailer / Kirana owner | `retailer` |
| Sales Executive / Field Rep | `salesman` |
| Warehouse Operations Staff / Manager | `staff` |
| Admin | `admin` |
| Super Admin | `super_admin` |

No new role is introduced, and no role name is invented.

### 1.6 Web verification actually executed in this session

```
corepack pnpm install --frozen-lockfile   → Done (pnpm 9.15.9), exit 0
corepack pnpm run typecheck               → tsc --noEmit, exit 0
corepack pnpm test                        → 96 files / 1826 tests passed, exit 0, 38.3s
  ✓ tests/mobile-api-foundation.test.ts (41 tests)
  ✓ tests/mobile-safety.test.ts (6 tests)
  ✓ tests/android-project-integrity.test.ts (5 tests)
```

This is **Node-level** evidence only. It proves the TypeScript compiles, the mobile
foundation's contracts hold in jsdom/mocks, and the Kotlin sources are structurally
self-consistent (imports resolve, resources exist). It proves **nothing** about whether the
Kotlin compiles.

### 1.7 Backend business-rule inventory (the rules Android must obey)

| Rule | Location | Android consequence |
| --- | --- | --- |
| Pack stock is authoritative; `> 0` = In stock, `0` = Out of stock | `0054_simplified_pack_stock.sql` | never compute stock client-side; use `get_retailer_pack_availability` |
| Exactly **one** active warehouse, resolved server-side | `0054`, trigger `trg_prepare_simple_stock_order_insert` | never send/hardcode a warehouse id; surface the `22023` config error verbatim |
| Stock deducted atomically at order-line insert; restored via per-line counters | `0054` | no client-side stock counting; idempotent retry only |
| `cost_price` and `product_packs.stock_quantity` are column-level revoked from `anon`/`authenticated` | `0054` | the app **cannot** read them; admin stock edits go through the role-checked RPC `admin_product_pack_stock` |
| Order idempotency via `orders.request_key` + `complete_order_request` (service-role only) | `0054` | order placement must send an idempotency key and must never retry blindly |
| Legacy FEFO / warehouse reservation retained for pre-0054 orders | `0017` | do **not** reintroduce FEFO into new flows |
| Admin-only column guard on prices/stock | `0052`, `0054` | staff screens must not expose price/stock edit controls |
| Coin ledger atomicity + refund | `0029`–`0031`, `0053` | coins are server-authoritative; no client-side balance math |
| Credit/outstanding ledger retained; credit removed from current checkout | `0031`, `0049` | show historical ledger read-only; do not add credit to checkout |
| Order state machine | `0042` | status transitions come from the server; the UI renders, never decides |
| Retention/cleanup is a separate, reviewed job | `0055`, `lib/retention/**` | **no** destructive job may be added by Android work |

### 1.8 Legacy Android artifacts still in the tree (must be reconciled, not deleted blindly)

| Path | What it is | Disposition |
| --- | --- | --- |
| `.github/workflows/android-apk.yml` | **was**: runs `npx cap add android`, builds a WebView shell | ✅ **DONE** — replaced by the native pipeline |
| `capacitor.config.ts` | remote-URL WebView wrapper config | ✅ **DONE** — deleted |
| `www/index.html`, `www/offline.html` | Capacitor web assets | ✅ **DONE** — deleted |
| `scripts/android-postsync.mjs`, `scripts/android-resource-validation.mjs` | Capacitor post-sync hooks | ✅ **DONE** — deleted |
| `package.json` `cap:*` scripts + 4 `@capacitor/*` deps | WebView wrapper wiring | ✅ **DONE** — removed, lockfile regenerated |
| `tests/*.test.ts` asserting the wrapper | `mobile-safety`, `production-readiness` | ✅ **DONE** — rewritten as *retirement* guards (they now fail if a wrapper file reappears) |
| `AUDIT_ANDROID.md` | the audit that concluded "WebView wrapper is correct" | ✅ **DONE** — replaced with a superseded notice |
| `public/sw.js`, `app/manifest.ts`, `tests/pwa.test.ts` | the **website's** PWA | **kept** — the website is not the Android deliverable, and no web code imports Capacitor |

`android/**` (the native project) is **committed and must be preserved** — this is not a
duplicate project, it is the real one. No second Android project was created.

---

### 1.9 What activating CI actually found (each root cause, in order)

The native project had never been compiled once. Turning the pipeline on produced a
different failure each time a cause was removed — recorded here because **none of these were
discoverable by reading the source**:

| # | Symptom | Root cause | Fix |
| --- | --- | --- | --- |
| 1 | Dependency resolution failed in every module using the icon library | `androidx.compose.material:material-icons-*` was **deprecated and stopped being published** after 1.7.x, so `version.ref = "composeUi"` (1.10.3) pointed at a version that does not exist. Material3 1.4.0 no longer pulls `material-icons-core` in implicitly. | catalog entry deleted, dependency removed from `:app` and `:feature:auth`; the single glyph is now a locally drawn `MenuIcon` (48 dp target, TalkBack label) |
| 2 | `A problem occurred configuring project ':app'` → `Failed to notify project evaluation listener` → **`project ':app' does not specify compileSdk`** + **`no com.google.dagger:hilt-android dependency was found`** | both messages were **false** — `compileSdk = 36` and `implementation(libs.hilt.android)` are both in `android/app/build.gradle.kts`. The real cause was `android.newDsl=false` in `gradle.properties`: under AGP 9's legacy DSL, `createAndroidTasks()` did not see the value the legacy extension had been given, and Hilt's dependency check then cascaded off the same broken model. | the legacy-DSL opt-out is **removed** (AGP 9's new DSL is the supported path; every module already used the property-style DSL). Hilt was also raised 2.59.1 → **2.60.1**, because 2.59.x verified the dependency through the retired `android-classes` transform (`google/dagger#5099`, `#5116`) — a genuine second bug, but **not** the cause of this message |

| 3 | `Failed to apply plugin 'org.jetbrains.kotlin.android'` → *"The plugin is not compatible with AGP's 9.0 new DSL"* | AGP 9's new DSL (the default) **cannot host the `kotlin-android` plugin at all**. The two `gradle.properties` flags are coupled: `newDsl=true` forces built-in Kotlin, while `newDsl=false` + `kotlin-android` was the combination that produced the false `compileSdk` error in row 2 — i.e. **neither opt-out combination works with AGP 9**. | migrated to **built-in Kotlin**: `org.jetbrains.kotlin.android` removed from all 8 modules, the root build file and the catalog; AGP compiles Kotlin itself. `kotlin { compilerOptions { jvmTarget } }` stays (it is the documented replacement for `android.kotlinOptions`), and KGP is raised from AGP's default 2.2.10 to the catalog's 2.4.20 via the documented `buildscript` classpath, because the Compose and serialization plugins are KGP plugins and must match the compiler exactly |

`android.builtInKotlin` and `android.newDsl` are now both absent: the project follows AGP 9's
defaults rather than opting out of them. `tests/android-project-integrity.test.ts` asserts the
KGP classpath pin and the catalog's Kotlin version cannot drift apart.

Two process lessons, both now enforced in the workflow:

1. **A failure that cannot be read is a failure that cannot be fixed.** Actions logs live in
   Azure blob storage, unreachable from here, so the job re-emits Gradle's own
   `What went wrong` block, all `Caused by` lines, all `e:` diagnostics and an AGP project-model
   probe as check annotations (`api.github.com`).
2. **Version pins are not evidence.** A pin can name a version that does not exist (icons) or a
   release whose AGP integration is broken (Hilt 2.59.x). Both had to be checked against the
   publisher's own release history before being believed.

---

## 2. What already works

**Backend / web (high confidence — 1,826 passing tests + 130 pages):**

1. Phone-or-email login, registration, retailer approval workflow, suspension, access periods.
2. Role-based routing enforced in `middleware.ts` **and** by Postgres RLS (defense in depth).
3. Catalog, categories, brands, cart, coupons, checkout, orders, invoices, wallet/coins ledger.
4. Staff and salesman workspaces (attendance, DCR, collections, targets, deliveries, visits).
5. Admin/super-admin workspaces (~50 pages) incl. banners, coupons, reports, audit logs.
6. Simplified pack-stock order pipeline with atomic deduction, restoration and idempotency (0054).
7. A tested mobile API foundation: envelope, error codes, pagination, rate limiting, bearer auth.

**Native Android (source only — compiles: NOT VERIFIED):**

1. Gradle 9.1.0 wrapper + AGP 9.0.1 + Kotlin 2.4.20 + Hilt + Retrofit/OkHttp + Compose M3,
   pinned in one version catalog.
2. Seven modules: `app`, `core/{common,model,network,auth,datastore,designsystem}`.
3. Keystore (AES-GCM) token storage, `SessionManager` restore/refresh/logout, `AuthInterceptor`.
4. Typed errors (`AppError`/`ApiErrorCode`), `ApiCallExecutor`, pagination helper, `UserRole`.
5. Material 3 brand theme, splash, session gate screens, role-aware navigation shell (2 routes).
6. Hardened manifest: cleartext disabled, backups disabled, one exported component, no WebView.
7. 12 Kotlin test classes mirroring the above.

---

## 3. Missing features (the real gap)

| Area | Missing |
| --- | --- |
| **Verification** | Any successful Gradle run. No compile, no lint, no unit-test execution, no APK. |
| **CI** | Native pipeline is an inactive file in `docs/`. Active workflow builds the prohibited wrapper. |
| **Auth (C)** | No login/refresh/logout/reset/registration endpoints; no `feature/auth`; app cannot sign in. |
| **Catalog (D)** | No catalog/search/PDP/categories/brands endpoints or screens; no images (Coil unused). |
| **Commerce (E)** | No cart, quote, checkout, orders, invoices endpoints or screens. Checkout is web-only. |
| **Engagement (F)** | No coins, notifications, banners, profile, addresses, support. |
| **Operations (G)** | No salesman, staff/warehouse, admin or super-admin screens or endpoints. |
| **Quality (H)** | No Compose UI tests, no offline/retry strategy beyond a state enum, no performance work. |
| **Release** | No signing config exercised, no release checklist, no Play prerequisites met. |

Roughly **~90 % of the product** is missing on the Android side. There is no honest way to
call this project near completion.

---

## 4. Security and data-integrity risks

| # | Risk | Severity | Mitigation already in place / required |
| --- | --- | --- | --- |
| S1 | **Unverified Kotlin**: 5k LOC never compiled — import/API errors, broken DI graph, runtime crashes on first install | **High** | activate CI; compile before adding features |
| S2 | Next.js Server Actions are not a public API; treating them as one would be brittle | Medium | use the versioned `/api/mobile/v1` contract (already the project's decision) |
| S3 | Service-role key must never reach the client | Critical | it does not today; `lib/mobile/supabase.ts` + `requireMobileSession` keep identity server-side. Must stay that way. |
| S4 | In-memory rate limiter is per-instance on Vercel (`lib/mobile/rate-limit.ts:8`) | Low | documented best-effort; **do not** claim it as a security control |
| S5 | `cost_price` / `stock_quantity` are column-revoked for `anon`/`authenticated` | — | the app must never expect these fields; admin stock edits only via `admin_product_pack_stock` |
| S6 | Order double-submission on retry | High | `orders.request_key` + `complete_order_request` (service-role only) — client must send a stable key and not auto-retry |
| S7 | Warehouse misconfiguration (`<> 1` active) surfaces as a raw `22023` | Medium | map to a distinct, user-visible configuration error; never fall back to a hardcoded warehouse |
| S8 | Legacy Capacitor wrapper keeps loading a live remote URL inside a WebView | Medium | retire at Phase G end; today's active CI still builds it |
| S9 | `capacitor.config.ts` documents that the previous production alias returns `DEPLOYMENT_NOT_FOUND` | Medium | verify the current API base URL in `ApiBaseUrlContract.kt` resolves before any on-device test |
| S10 | Session material on disk | High | mitigation present: Keystore AES-GCM store + `allowBackup=false` |
| S11 | Release build signing secrets | — | env-only in `app/build.gradle.kts`; never in Git. Keep. |
| S12 | Logging of tokens/PII | Medium | `AuthInterceptor` keeps tokens out of URLs; add a "no body logging" test when the first write endpoint lands |

No RLS policy, migration, table, report or business record will be modified by Android work.

---

## 5. Proposed Android architecture

Unchanged in spirit from `docs/NATIVE_ANDROID_MIGRATION_PLAN.md` §2 — this section records
what the audit **confirmed is the right shape** and adds the two rules this session will
enforce hardest.

```
android/
├── app/                    manifest, Application, MainActivity, DI, nav host, splash
├── core/common/            Dispatchers, AppResult/AppError, Connectivity, Policies
├── core/model/             UserRole, Session*, NavigationPolicy, money value objects
├── core/network/           Retrofit + OkHttp + kotlinx.serialization, MaharaniApi, DTOs,
│                           AuthInterceptor, ApiCallExecutor, ApiErrorMapper
├── core/auth/              SessionManager, KeystoreTokenStore, AuthRepository
├── core/datastore/         DataStore — NON-SENSITIVE preferences only
├── core/designsystem/      M3 theme, typography, Money/IsoDate formatters, state surfaces
└── feature/
    ├── auth/               C — login, register, pending approval, suspended, reset
    ├── catalog/            D — home, categories, brands, search, PDP with pack selection
    ├── cart/               E — cart, quantity/stock validation
    ├── checkout/           E — address, review, place order (idempotent), confirmation
    ├── orders/             E — history (paged), detail, status timeline, invoice
    ├── account/            F — profile, addresses, notifications, logout
    ├── engagement/         F — coins ledger, banners, support
    ├── salesman/           G — customers, orders, collections, visits, targets
    ├── staff/              G — fulfilment, inventory, deliveries
    └── admin/              G — approvals, catalog/stock, orders, banners, reports
```

**Rule 1 — the client never authorizes, calculates or mutates business state.**
Prices, discounts, GST, totals, stock, warehouse resolution, coin balances and role
permissions come from the server. The app renders `navigation.permissions` as **UX only**;
every call is re-checked server-side.

**Rule 2 — nothing is reported as success until the server says so.**
Order placement is idempotent (`request_key`) and is **never** auto-retried. A timeout is
reported as "unknown outcome — check order history", never as success.

Cross-cutting, and mandatory for every feature module:

- `ViewModel` → repository → `MaharaniApi`; no network, DB or business rule in a composable.
- `collectAsStateWithLifecycle` + a single `UiState` per screen
  (`Loading` / `Content` / `Empty` / `Offline` / `Error(retryable=false|true)`).
- Paging **cursor-based** (the backend's `pageEnvelope`), never offset-guessing.
- Money as integer paise end-to-end; formatting in the design system.
- Dark/light theme, dynamic colour off by default (brand fidelity), RTL-safe layouts.
- Accessibility: content descriptions, ≥48 dp targets, focus order, TalkBack labels.

---

## 6. File-by-file implementation plan

Legend: **C** = create, **M** = modify, **D** = delete (retirement, only with approval).

### Phase B — Verify the foundation (this session)

| Action | Path | Purpose | Status |
| --- | --- | --- | --- |
| M | `.github/workflows/android-apk.yml` | **replaced** the Capacitor build with the native pipeline: wrapper validation → JDK 17 → SDK 36 → `testDebugUnitTest lintDebug assembleDebug` → aapt package check → APK artifact | ✅ done (activate/verify pending push) |
| D | Capacitor wrapper files | see §1.8 | ✅ done |
| M | `android/app/build.gradle.kts` | lint `abortOnError` stays false until lint is clean, then flipped in Phase H | pending |
| M | `android/**` | fix whatever the first real compile reports | **in progress** — see §1.9; two configuration blockers found and fixed so far |

### Phase C — Authentication & roles

| Action | Path | Purpose | Status |
| --- | --- | --- | --- |
| C | `app/api/mobile/v1/auth/login/route.ts` | phone/email → GoTrue `signInWithPassword`, generic `401`, `nextStep` | ✅ written |
| C | `app/api/mobile/v1/auth/refresh/route.ts` | refresh-token rotation | ✅ written |
| C | `app/api/mobile/v1/auth/logout/route.ts` | server-side refresh-token revocation | ✅ written |
| C | `app/api/mobile/v1/auth/password-reset/route.ts` | no-enumeration reset | ✅ written |
| C | `app/api/mobile/v1/auth/password-update/route.ts` | authenticated password change | ✅ written |
| C | `app/api/mobile/v1/retailers/register/route.ts` | registration mirroring `lib/auth/actions.ts` validation | ✅ written |
| C | `app/api/mobile/v1/areas/route.ts` | the registration area picker; no invented area ids | ✅ written |
| M | `lib/mobile/{auth,http,index}.ts` | shared helpers for the above (no behaviour change to `session`) | ✅ written |
| C | `tests/mobile-auth.test.ts` | auth boundary matrix: anonymous, wrong role, pending, suspended, inactive, expired | ✅ **35 tests pass** |
| C | `android/core/auth/.../AuthRepository.kt` | login/refresh/logout against the contract | written, **uncompiled** |
| M | `android/core/network/.../MaharaniApi.kt` | +5 auth calls | written, **uncompiled** |
| C | `android/feature/auth/**` | login, register, pending-approval, reset screens + ViewModels | written, **uncompiled** |
| C | `android/feature/auth/src/test/**` | validation + ViewModel tests: duplicate-submit guard, field errors, area-load failure | 18 written, **never executed** |

### Phase D — Retailer commerce (catalog)

| Action | Path | Purpose |
| --- | --- | --- |
| C | `app/api/mobile/v1/{catalog,categories,brands,search,products/[id]}/route.ts` | paged catalog, filters, PDP with packs |
| C | `app/api/mobile/v1/banners/route.ts` | active banners, date+priority filtered |
| C | `tests/mobile-catalog.test.ts` | pagination, filtering, price/stock visibility, banner window |
| C | `android/feature/catalog/**` | home, categories, brand, search, PDP (compact: packs, MOQ, tier price, stock chip) |
| M | `android/core/network/.../dto/*` | catalog DTOs; add Coil image loading |

### Phase E — Cart, checkout, orders

| Action | Path | Purpose |
| --- | --- | --- |
| C | `app/api/mobile/v1/cart/**` | server-held cart, quantity + stock validation |
| C | `app/api/mobile/v1/orders/**` | quote, place (idempotent), list (paged), detail, invoice, cancel, reorder |
| C | `tests/mobile-orders.test.ts` | idempotency, insufficient stock, no client totals, cancellation restore |
| C | `android/feature/{cart,checkout,orders}/**` | full purchase journey + history + invoice |

### Phase F — Engagement

`coins`, `notifications`, `profile`, `addresses`, `support` endpoints + `feature/{account,engagement}`.

### Phase G — Sales, warehouse, admin

`salesman/**`, `staff/**`, `admin/**` endpoints and feature modules, each gated by
`requireMobilePermission` server-side; banner management with image upload, schedule, priority
and a safe fallback when no banner is active.

### Phase H — Hardening & release

Compose UI tests, offline/timeout/timeout-unknown matrix, accessibility pass, performance
pass, `abortOnError = true`, release checklist, signing guidance, Play Store prerequisites.

### Retirement (only with explicit approval, in one reviewable change)

**D** `capacitor.config.ts`, `www/`, `scripts/android-postsync.mjs`,
`scripts/android-resource-validation.mjs`, `package.json` `cap:*` scripts; **M** the five
Capacitor-asserting test files. Not before the native app covers the same role flows.

---

## 7. Build and test strategy

**Two-track, honestly separated.**

| Track | Where | What it proves |
| --- | --- | --- |
| Node/backend | this sandbox **and** CI | `tsc`, eslint, vitest (1,826 tests), route-handler contract tests, RLS/policy unit assertions |
| Android | GitHub Actions **only** | Kotlin compiles, unit tests pass, lint runs, `assembleDebug` produces a real APK with the right package id |

Unit-test success is never presented as integration or production verification. Things CI
cannot prove and that will be listed as **NOT VERIFIED** every time: device behaviour
(splash, back nav, insets, process death), real Supabase/Vercel behaviour (no credentials in
CI), and real order placement against production.

**Native CI job order** (this is `.github/workflows/android-apk.yml`, which replaced
the Capacitor build and is the active pipeline):

1. `gradle/actions/wrapper-validation` (pinned SHA) — wrapper integrity;
2. JDK 17 Temurin; Android SDK `platforms;android-36` + `build-tools;36.0.0`;
3. `./gradlew --version` — confirms Gradle 9.1.0 actually runs;
4. a diagnostic probe that records the AGP project model (see §1.9);
5. `./gradlew --no-daemon testDebugUnitTest lintDebug assembleDebug`;
6. `aapt` package-id assertion = `com.maharanitraders.app`, APK non-empty;
7. `actions/upload-artifact` — debug APK, **no `always()`**, so a failed build uploads nothing;
8. test/lint reports uploaded on failure for diagnosis.

Because Actions logs live in Azure blob storage and are not readable from every
environment, the job re-emits the root cause — Gradle's `What went wrong` block, every
`Caused by`, every `e:` Kotlin diagnostic and the Android model probe — as **check
annotations**, which `api.github.com` serves. That is what turned an invisible failure into
the two root causes in §1.9.

No signing secret is required for a debug APK. No production key is ever printed.

---

## 8. Blockers requiring human action

| # | Blocker | Why it matters | What is needed |
| --- | --- | --- | --- |
| **B1** | **No JDK/Android SDK here, and Maven/Google hosts are blocked** | the APK cannot be built or verified locally — CI is the only path | accept CI-as-verification, or provide a runner with SDK access |
| ~~B2~~ | ~~workflow write permission~~ | **RESOLVED** — the workflow permission claim was wrong (the underlying error was a branch-not-found 404). The native pipeline was pushed and runs. | — |
| ~~B3~~ | ~~push authorization~~ | **RESOLVED** — the user authorized pushing this branch and opening a PR ([#77](https://github.com/mahakali108/Maharani-mart/pull/77)). | — |
| ~~B4~~ | ~~Capacitor retirement~~ | **RESOLVED** — retired in one reviewable change; two tests now guard against it coming back. | — |
| **B5** | **No live backend credentials in CI** | RLS/authorization/stock concurrency can only be *unit*-tested, never integration-tested | a staging Supabase project + credentials, or accept unit-only evidence |
| **B6** | **Scope** | Phases D–G are ~90 % of the product and cannot be finished in one session | acknowledged as out of scope for this session |
| **B7** | **The Android build has still never gone green** | every claim about the Kotlin compiling, the tests passing or an APK existing rests on a pipeline that has not yet succeeded | keep iterating on CI; do not claim Phase B/C as *verified* until a run is read back green |

---

## 9. Acceptance criteria — honest position

The project is **not complete** and this document does not claim otherwise. Current status
against the master prompt's criteria:

| Criterion | Status |
| --- | --- |
| Genuine native Kotlin/Compose app | **PARTIAL** — real native source exists; compiles only once CI configuration succeeds |
| Verified package id `com.maharanitraders.app` | **NOT VERIFIED** (declared in Gradle + manifest; never asserted by a build) |
| Real authenticated backend integration | **PARTIAL** — the endpoints exist and are contract-tested (35 tests); the Android client is written but **never executed** |
| Server-enforced role permissions | **PASS (web)** — RLS + `middleware.ts` + `requireMobileSession`; Android side not started |
| Catalog/cart/checkout/orders on Android | **NOT STARTED** |
| Server-authoritative totals + safe stock | **PASS (backend, 0054)**; no Android client yet |
| Staff/admin flows on Android | **NOT STARTED** |
| Automated tests with honest limits | **PARTIAL** — 1,862 web tests pass; **zero** Kotlin tests have ever run |
| Android lint + Gradle results | **NOT VERIFIED** |
| Verified non-empty APK from Actions | **NOT VERIFIED** — blocked by B1/B2 |
| Build/troubleshooting docs | **PASS** (this file + the three companion docs) |
| No destructive changes, no exposed secrets | **PASS** — audit found none, and none will be introduced |

**Next action taken after this document:** Phase B verification — promote the native CI
workflow and get the first real compile result, subject to the blockers in §8.
