# Native Android Migration Plan (Phases A–H)

**Phase A deliverable 3 of 3.** Companion documents:
`docs/NATIVE_ANDROID_MIGRATION_AUDIT.md` and `docs/NATIVE_ANDROID_API_CONTRACT.md`.

Target: **Maharani Traders** — a native Kotlin + Jetpack Compose Android app that uses the
existing Next.js + Supabase backend through `/api/mobile/v1`, preserving every existing
business rule, role, RLS policy and data set.

---

## 1. Toolchain decision (verified, not guessed)

The Android project cannot be compiled inside this working session (no JDK/Android SDK,
Maven/Google hosts blocked — see audit §8), so **every version below was verified against
live sources** rather than assumed:

| Component | Pinned | Evidence |
| --- | --- | --- |
| Android Gradle Plugin | **9.0.1** | `developer.android.com/build/releases/agp-9-0-0-release-notes`: AGP 9.0 min/default **Gradle 9.1.0**, **JDK 17**, SDK Build Tools 36.0.0, KGP min/default **2.2.10**, **max API level 36.1** |
| Gradle wrapper | **9.1.0** (`gradle-9.1.0-bin.zip`) | AGP 9.0.1 compatibility table + the reference project's wrapper (`gradle-9.1.0-bin.zip`) |
| `compileSdk` / `targetSdk` | **36** / **36** | Google Play requires new apps **and updates** to target API 36 from 2026-08-31 (extension to 2026-11-01); AGP 9.0.1 supports up to 36.1 |
| `minSdk` | **24** | reasonably modern floor; no business need for lower |
| JDK | **17** (source/target 17) | AGP 9 requirement; Gradle 9 supports it |
| Kotlin (+ Compose compiler plugin) | **2.3.10** | `skydoves/pokedex-compose` version catalog (AGP 9.0.1 project that builds in CI) |
| KSP | **2.3.5** | same catalog (KSP now has its own version line) |
| Hilt (DI) | **2.59.1** (`hilt-android`, `hilt-compiler`, `hilt-android-testing`, plugin) | same catalog |
| Compose | UI/foundation/runtime **1.10.3**, Material 3 **1.4.0** | same catalog (deliberately **not** the newest BOM: Compose 1.12/BOM 2026.08+ raises `compileSdk` to 37, which AGP 9.0.1 does not support) |
| Navigation Compose | **2.9.7** | same catalog |
| Lifecycle / ViewModel Compose | **2.10.0** | same catalog |
| Activity Compose | **1.12.4** | same catalog |
| Core KTX / SplashScreen / DataStore | **1.17.0 / 1.2.0 / 1.2.0** | same catalog |
| Retrofit (+ BOM) / OkHttp (+ BOM) | **3.0.0 / 5.3.2** | same catalog; official `com.squareup.retrofit2:converter-kotlinx-serialization` (no third-party converter) |
| kotlinx-serialization-json / coroutines | **1.10.0 / 1.10.2** | same catalog |
| Tests | JUnit 4.13.2, Turbine 1.2.1, `kotlinx-coroutines-test`, MockWebServer (`com.squareup.okhttp3:mockwebserver`), AndroidX test ext-junit 1.2.1, espresso 3.5.1 | same catalog |
| Image loading | Coil **3.6.3** (`coil-compose` + `coil-network-okhttp`) | `openclaw/openclaw` Android catalog (AGP 9.4.1 project) — introduced in Phase D |

**AGP 9 note (deliberate, documented opt-out):** AGP 9 introduces a new DSL; the app sets
`android.newDsl=false` in `android/gradle.properties` to stay on the classic DSL while
AGP 10 migration work is planned (this mirrors what the reference AGP 9 project does).
Removing the opt-out is a tracked follow-up before AGP 10.

**Gradle wrapper JAR:** committed in this change. It was fetched from the official
`gradle/gradle` tag `v9.1.0` via the GitHub contents API because
`services.gradle.org`/`raw.githubusercontent.com` are blocked in this sandbox; CI and
local developers download the distribution from `services.gradle.org` normally (the
wrapper URL is unchanged).

**Deliberately NOT upgraded:** `next`, `react`, `@supabase/*`, Tailwind and every other web
dependency stay exactly as they are on `main`.

---

## 2. Android module structure

### 2.1 As built in Phase B

```
android/
├── settings.gradle.kts                 # module graph + repositories
├── build.gradle.kts                    # plugin aliases (apply false)
├── gradle.properties                   # AGP 9 classic-DSL opt-out, JVM args
├── gradle/libs.versions.toml           # single pinned version catalog
├── gradle/wrapper/…, gradlew, gradlew.bat
├── app/                                # application module: manifest, Application, MainActivity, navigation host, splash
├── core/common/                        # coroutine dispatchers, Result/AppError, connectivity
├── core/model/                         # domain models: UserRole, SessionUser, RetailerStatus, NavigationPolicy, money value objects
├── core/network/                       # OkHttp + Retrofit + kotlinx-serialization, auth/error interceptors, ApiResult, `MaharaniApi`, DTOs
├── core/auth/                          # SessionStore (Keystore AES-GCM), SessionManager (restore/refresh/logout), AuthRepository
├── core/datastore/                     # DataStore for non-sensitive preferences only
└── core/designsystem/                  # Material 3 theme (brand colours), typography, state surfaces (loading/empty/offline/error/retry), placeholders
```

### 2.2 Module mapping to the requested structure (and the two deliberate deferrals)

| Requested | Status in Phase B | Reason |
| --- | --- | --- |
| `app` | created | — |
| `core/network`, `core/auth`, `core/model`, `core/common`, `core/designsystem` | created | needed by the shell |
| `core/database` | **deferred to Phase D (evidence-gated)** | The objective says to use Room only where persistent structured caching is genuinely required. Phase B has no structured cache; adding an empty Room module would be dead code. Phase D adds `core/database` **only if** the catalog cache proves necessary, and records the decision. Non-sensitive preferences live in `core/datastore` (DataStore). |
| `feature/auth` | **deferred to Phase C** | Sign-in cannot be honestly implemented before the auth endpoints exist; the shell therefore shows an explicit "not signed in" state and never fakes a login. |
| `feature/{catalog,cart,checkout,orders,coins,retailer,sales,warehouse,admin,notifications}` | **one per phase (D–G)** | Each is created with its real screen when its API contract lands, per the audit table in §5 of the audit. Creating ten empty modules now would be scaffolding without substance. |

### 2.3 Architectural rules (enforced by review + tests)

- Single source of truth: `SessionManager` owns auth state; features observe it via
  `StateFlow`, never by calling the network from a composable.
- No network in composables: everything flows ViewModel → repository → `MaharaniApi`.
- Lifecycle-aware collection (`collectAsStateWithLifecycle`), explicit `UiState`
  (`Loading` / `Empty` / `Offline` / `Error(retryable)` / `Content`).
- Errors are typed (`AppError`) and mapped from the API's error codes; unknown codes
  degrade to a generic retryable error, never to a fabricated success.
- Money crosses the API as integer paise; formatting lives in the design system
  (`₹` + Indian grouping), not in business logic.
- No secrets in `BuildConfig`: only `MAHARANI_API_BASE_URL` (per build type) exists.
- The app is **online-first**; no queued mutation replay. Connectivity loss shows offline
  states (and later, read-only cached catalog) — never a faked order.

---

## 3. Phases, deliverables, exit criteria

| Phase | Deliverable | Exit criteria (evidence) | Status now |
| --- | --- | --- | --- |
| **A** | Audit, API contract, plan (these three documents) | Documents committed; classification covers every existing page area; security register complete | **Done in this change** |
| **B** | Mobile API foundation (`lib/mobile/*`, `GET /health`, `GET /session`) + native Android foundation (Gradle project, modules, theme, splash, navigation shell, Keystore session storage, CI job) | Backend tests green in vitest; Android CI job runs unit tests + lint + `assembleDebug`; web suite still 1 780/1 780 | **Done in this change** (CI result recorded in the PR) |
| **C** | Authentication: login (phone/email), refresh, logout, password reset, registration, pending-approval, suspended/expired screens, role-aware routing wired to real data | Endpoint tests (auth boundary matrix) + Android session tests; manual verification against the deployed API recorded honestly | Next |
| **D** | Catalog, categories, brands, search, filtering, infinite scroll, compact PDP with packs/MOQ/tier pricing, favorites, image caching | Endpoint tests + Compose UI tests; PDP keeps the compact design (no duplicate price blocks / Buy Now) | Pending |
| **E** | Cart, quote, checkout, orders, cancellation/returns/reorder, invoices, delivery view; idempotency + atomic stock end-to-end | Order idempotency, insufficient-stock, cancellation-restoration and coin tests; no client-calculated totals anywhere | Pending |
| **F** | Coins, notifications, banners, wallet/ledger, profile/addresses, support | Endpoint tests + UI states incl. banner fallback (no hardcoded ids) | Pending |
| **G** | Sales, warehouse, admin, super-admin (permission-gated, read-only retention status/dry-run) | Role-boundary tests; super-admin-only endpoints unreachable by `admin`; BLOCKED items reported, never faked | Pending |
| **H** | Integration testing, security audit (RLS/authorization review, exported components, TLS, logging), release preparation (signed AAB only when signing is configured), Play prerequisites documented | Security checklist items ticked with evidence; release build runs only with provided signing; no publish claim | Pending |

Each phase ends with a report: files changed, commands actually run with results,
incomplete features, blockers, new API contracts and architectural decisions. The app stays
buildable at every phase boundary.

---

## 4. Migration order and dependencies

```
A (docs) → B (API foundation + Android foundation + CI)
          → C (auth)  ─┬→ D (catalog/PDP) → E (cart/checkout/orders) → F (coins/notifications/banners/profile)
                       └→ G (sales/warehouse/admin — depends on C, and on E for order actions)
                                                                    → H (hardening + release prep)
```

Rules:

1. No feature module starts before its endpoints exist and are tested.
2. Backend routes are added in the smallest coherent set and must not change existing web
   behaviour (`pnpm test` gates every backend change).
3. Database migrations: **none in Phase A/B**. Any future migration is a separate,
   reviewed change; it is never applied to production automatically.
4. The Capacitor shell is retired only when the native app covers the same role flows
   (Phase G end), at which point `capacitor.config.ts`, `www/`, the post-sync scripts and
   the three test assertions that reference them are updated together — deliberately, in
   one reviewable change.

---

## 5. CI plan

The native pipeline is written, reviewed and stored as
**`docs/android-workflow-native.yml`**. It is not yet active in
`.github/workflows/android-apk.yml`, because the GitHub App that pushes this branch is not
granted the `workflows` permission — GitHub rejects any commit that touches
`.github/workflows/**`:

```
! [remote rejected] arena/01a0f75c-maharani-mart -> arena/01a0f75c-maharani-mart
  (refusing to allow a GitHub App to create or update workflow
   `.github/workflows/android-apk.yml` without `workflows` permission)
```

Activating it is one command (this mirrors how `docs/android-workflow-apk-aab.yml` was
kept before being promoted):

```bash
cp docs/android-workflow-native.yml .github/workflows/android-apk.yml
git add .github/workflows/android-apk.yml && git commit -m "ci(android): native pipeline"
```

Until then, CI continues to build the legacy Capacitor wrapper; **that path is untouched by
this change** and the committed native project is unaffected. The active workflow still
lacks the native job, so the first Android compile has not run yet — see §10.

The pipeline has two independent jobs, both triggered by PRs and pushes that touch
`android/**`, `lib/mobile/**`, `lib/permissions/**`, `app/api/mobile/**`, `package.json`,
`pnpm-lock.yaml` or the workflow itself.

**Job `android`** (as implemented and reviewed in this change):

1. `actions/checkout@v7.0.1`
2. `actions/setup-java@v6.0.1` — temurin **17**
3. `android-actions/setup-android@v4.0.4` — provides the SDK used by `compileSdk`/`targetSdk` 36
4. `gradle/actions/setup-gradle@v6.4.0` — caching + the wrapper for every later step
5. `chmod +x android/gradlew`
6. `./gradlew --no-daemon testDebugUnitTest` — JVM unit tests for all modules
7. `./gradlew --no-daemon lintDebug` — Android Lint (non-fatal while the shell is growing;
   flipped to `abortOnError = true` in Phase H)
8. `./gradlew --no-daemon assembleDebug` — debug APK (Gradle's auto-generated debug
   keystore; no secret involved)
9. `actions/upload-artifact@v7.0.1` — `app-debug.apk`, plus test/lint reports (`if: always()`)
10. **Optional signed release bundle**: when the four `RELEASE_*` secrets are present, the
    keystore is decoded into `$RUNNER_TEMP`, `bundleRelease` runs and the AAB is uploaded.
    When they are absent the step is skipped and the job prints an explicit notice — the
    absence is never reported as a release.

All action versions above were verified against their published tags (see the evidence list
in §1) rather than copied from an older workflow.

**Job `backend`**: `corepack enable` (pnpm is pinned by `packageManager`),
`pnpm install --frozen-lockfile`, `pnpm run typecheck`, `pnpm exec vitest run` — the full
web suite **plus** the mobile API contract tests. This is the guard that the migration
never breaks the existing web application.

Honest CI caveats to be stated in every phase report:

- A green CI build is not device verification. Real-device checks (splash, back
  navigation, keyboard/insets, process death) are manual and must be reported as such.
- The release bundle requires secrets that only the repository owner can provide.
- Live-service behaviour (real Supabase project, real Vercel deployment, deployment
  protection) cannot be exercised by CI without credentials; unverified items are listed
  explicitly instead of being assumed.

---

## 6. Configuration & environment

| Setting | Where | Notes |
| --- | --- | --- |
| API base URL | `android/app/build.gradle.kts`: `BuildConfig.API_BASE_URL`, overridable with `-PmaharaniApiBaseUrl=https://host/` | **Not a secret.** Default is the deployed HTTPS API. `ApiBaseUrlContract` rejects anything that is not absolute https (plain http is allowed only for `localhost`/`127.0.0.1`/`10.0.2.2`, which only the debug network security config permits) and normalises the trailing `/` Retrofit requires. No datastore project URL/key is compiled in — all auth flows through the API (see contract §1). |
| Release signing | CI secrets only (`RELEASE_KEYSTORE_BASE64`, …) | Keystores/`local.properties` stay git-ignored |
| Server env | Existing deployment env (`NEXT_PUBLIC_SUPABASE_*`, `SUPABASE_SERVICE_ROLE_KEY`, …) | Unchanged; never duplicated into the app |
| Local development | `cd android && ./gradlew …` after installing JDK 17 + Android SDK 36 | The Gradle wrapper is committed, so no `gradle wrapper` step is needed |

---

## 7. Exact acceptance tests (commands)

**Backend / web (this repository):**

```bash
corepack enable pnpm && pnpm install --frozen-lockfile
pnpm typecheck                                  # tsc --noEmit
pnpm test                                       # full vitest suite (Phase B result: 95 files / 1 821 tests)
node_modules/.bin/vitest run tests/mobile-api-foundation.test.ts   # new Phase B contract tests
pnpm build                                      # Next.js production build
```

**Android (CI, or locally with JDK 17 + SDK 36):** the wrapper runs every module's unit
tests; this sandbox has no JDK/Android SDK, so these commands were NOT executed locally and
must be read as the CI contract, not as a local result.

```bash
cd android
./gradlew --no-daemon testDebugUnitTest   # model, common, network, auth, datastore, designsystem, app
./gradlew --no-daemon lintDebug           # Android Lint
./gradlew --no-daemon assembleDebug       # debug APK
./gradlew --no-daemon bundleRelease       # only with signing configured (RELEASE_* env vars)
```

**Security assertions that must keep passing (static, in the existing suite):**

- no Supabase key or secret anywhere under `android/` (`NEXT_PUBLIC_`, `SUPABASE_`,
  `service_role`, `SERVICE_ROLE`, private keys) — new test in `tests/mobile-api-foundation.test.ts`;
- no `WebView`/`android.webkit` usage in the Android sources except the documented
  absence note (asserted by the same test);
- cleartext traffic disabled in the release manifest;
- exported components limited to the launcher activity.

---

## 8. Risks specific to the migration order

| Risk | Mitigation |
| --- | --- |
| Extracting services for the API changes web behaviour | Reuse services without modifying web actions; `pnpm test` (1 780 tests) gates each change |
| Version drift (AGP/Compose/Kotlin) breaking CI | All versions pinned in one catalog with the evidence table above; upgrades are separate reviewed changes |
| API surface creep | Endpoints are added only with a contract row in the API document and tests; no speculative endpoints |
| Role logic duplicated in Kotlin | The app renders `navigation.permissions` from `/session`; server re-checks every call |
| Android-only "quick fixes" bypassing server rules | Code review checklist + the contract's invariants section; no service-role path from the app |
| Test/dev environment cannot build Android locally | CI is the build environment; blockers reported honestly in each phase |

---

## 9. Phase B scope statement (what this change does and does not claim)

**Does:**

- Add the audit/contract/plan documents.
- Add the mobile API foundation with `GET /api/mobile/v1/health` and
  `GET /api/mobile/v1/session`, plus tests exercising the auth/session boundary.
- Add the native Android project (Gradle + version catalog + wrapper + 7 modules) with:
  Material 3 theme, native splash + launcher icons from existing brand assets, role-aware
  navigation shell, Keystore-backed session storage, Retrofit/OkHttp network layer with
  typed errors, DataStore preferences, and unit tests for model/session/routing logic.
- Replace the Capacitor CI workflow with a native build/test/lint workflow, add a backend
  verification job, and repoint the `android:build:*` npm scripts at the native project.

**Does not (yet) claim:**

- Sign-in, catalog, cart, checkout, orders, coins, notifications, admin screens — those are
  Phases C–G; the shell shows explicit "not yet implemented" states instead of fake data.
- Any device-verified behaviour (nothing was run on a device or emulator).
- A signed release, a Play Store submission, push notifications or online payments.
- That the Capacitor wrapper is gone: the config and scripts remain (test-coupled) and are
  retired in one deliberate change at the end of Phase G.

---

## 10. Phase B — measured results (what was actually run)

| Gate | Command | Result |
| --- | --- | --- |
| Mobile API contract tests | `node_modules/.bin/vitest run tests/mobile-api-foundation.test.ts` | **41 / 41 passed** |
| Android project static integrity | `node_modules/.bin/vitest run tests/android-project-integrity.test.ts` | **4 / 4 passed** — every project `import` resolves to a declared symbol, every Gradle module has a build script, every referenced resource exists. Verified by mutation: a deliberately wrong import fails the check. |
| Existing web suite | `node_modules/.bin/vitest run` | **96 files / 1 825 tests passed** (baseline was 94 / 1 780; the delta is this change's two new files and 45 tests) |
| Type checking | `pnpm run typecheck` (`tsc --noEmit`) | clean |
| Android unit tests | `cd android && ./gradlew testDebugUnitTest` | **not run here** — no JDK/Android SDK in the working environment; executed by CI (job `android`) |
| Android lint / APK | `./gradlew lintDebug`, `./gradlew assembleDebug` | **not run here** — same reason; executed by CI |

Files added by this change (for review):

- `docs/NATIVE_ANDROID_{MIGRATION_AUDIT,API_CONTRACT,MIGRATION_PLAN}.md`
- `lib/mobile/{http,supabase,auth,pagination,rate-limit,index}.ts` (server-only helpers)
- `app/api/mobile/v1/{health,session}/route.ts`
- `tests/mobile-api-foundation.test.ts`, `tests/android-project-integrity.test.ts`
- `android/**` (Gradle wrapper + catalog, 7 modules, 57 Kotlin files of which 14 are tests,
  brand resources copied from `resources/android-res/`)
- modified: `lib/permissions/permissions.ts` (`permissionsForRole`, additive only),
  `.github/workflows/android-apk.yml`, `.gitignore`, `package.json` (Android scripts repointed)

Blockers and unverified items carried forward (stated, not hidden):

1. **Nothing under `android/` has been compiled yet** in this environment — CI is the first
   compile. Expect the first CI run to surface Kotlin/Gradle nits (type inference, Compose
   API details, dependency coordinates); treat them as Phase B follow-ups, not as a silent
   pass. `tests/android-project-integrity.test.ts` narrows the gap (it already caught two
   wrong `IoDispatcher` imports), but it is not a compiler.
2. **Sign-in does not exist yet** (Phase C), so the signed-in shell can only be reached by
   restoring a session created elsewhere. The gate screens say exactly that.
3. **Live-service behaviour is unverified**: no request has been made against the deployed
   API or the Supabase project from this environment.
4. **No device/emulator run**: splash, insets, back navigation and process death are
   untested on hardware.
5. The Capacitor config and `cap:*` scripts remain (they are asserted by
   `tests/mobile-safety.test.ts` and `tests/production-readiness.test.ts`) and are retired in
   one deliberate change at the end of Phase G.
