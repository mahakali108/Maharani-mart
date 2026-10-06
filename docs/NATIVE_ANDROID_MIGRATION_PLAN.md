# Native Android Migration Plan (Phases A–H)

**Phase A deliverable 3 of 3.** Companion documents:
`docs/NATIVE_ANDROID_MIGRATION_AUDIT.md` and `docs/NATIVE_ANDROID_API_CONTRACT.md`.

**Status note (2026-10-05):** the phase statuses in §3 are the plan's original projection from
Phase A. What the native app implements and verifies today is recorded in
`docs/NATIVE_PWA_FEATURE_PARITY.md`; the endpoint contract in
`docs/NATIVE_ANDROID_API_CONTRACT.md` is kept current.

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
| Kotlin (+ Compose compiler plugin) | **2.4.20** | [JetBrains KGP compatibility table](https://kotlinlang.org/docs/gradle-configure-project.html): supports Gradle through 9.7.0 and AGP through 9.3.1, covering this project's 9.1.0 / 9.0.1 pins |
| KSP | **2.3.10** | [Kotlin KSP quickstart](https://kotlinlang.org/docs/ksp-quickstart.html) pairs KSP 2.3.10 with Kotlin 2.4.20 |
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

**AGP 9 opt-outs (deliberate and separate):** `android.newDsl=false` keeps the classic
Android DSL while AGP 10 migration work is planned. AGP 9 also enables built-in Kotlin by
default, which conflicts with this project's explicitly versioned
`org.jetbrains.kotlin.android` plugin; `android.builtInKotlin=false` opts out of that
built-in plugin as documented in [Android's migration guide](https://developer.android.com/build/migrate-to-built-in-kotlin#opt-out-of-built-in-kotlin).
Both properties are pinned in `android/gradle.properties`; the Kotlin plugin remains at
2.4.20, within its published AGP/Gradle compatibility range.

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
├── gradle.properties                   # AGP 9 DSL/Kotlin opt-outs, JVM args
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
| **B** | Mobile API foundation (`lib/mobile/*`, `GET /health`, `GET /session`) + native Android foundation (Gradle project, modules, theme, splash, navigation shell, Keystore session storage, CI job) | Backend/web checks green; native wrapper validation, Android unit tests, lint, and `assembleDebug` pass in an actual GitHub Actions run with the APK artifact uploaded | **In progress** — native Android CI is not active or verified yet |
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

The native pipeline template is stored as **`docs/android-workflow-native.yml`**. It is not
active in `.github/workflows/android-apk.yml`: the repository records that the GitHub App
for this branch lacks the `workflows` permission, and GitHub rejected a prior attempt to
update a workflow file. A maintainer with that permission can promote it with:

```bash
cp docs/android-workflow-native.yml .github/workflows/android-apk.yml
git add .github/workflows/android-apk.yml && git commit -m "ci(android): activate native Android checks"
```

The checked-in active workflow still runs `npx cap add android` and builds the legacy
Capacitor/WebView wrapper. It does not validate `android/`; it is deliberately not dispatched
for this task because that would not test the native app and would conflict with the native-UI
requirement. No native CI result or APK artifact exists yet.

The template runs web quality gates first, then Android; the Android job depends on the web
job so the APK is uploaded only after both sets of checks succeed. Pushes and pull requests
are filtered to Android, mobile API, test, package manifest/lockfile, and workflow-template paths.

**Job `web`** uses pinned Node.js 22 and the repository-pinned pnpm version, then runs frozen
install, typecheck, lint, the complete Vitest suite, and the Next.js production build. It needs
no production credentials.

**Job `android`** performs these checks in order:

1. `gradle/actions/wrapper-validation@v6.3.0` (pinned to commit
   `9c971963bec38e04b3d30dcc455b5382be2fdbfb`);
2. JDK **17** (Temurin) and Android SDK packages `platforms;android-36` and
   `build-tools;36.0.0`;
3. `./gradlew --version`, confirming the wrapper runs the pinned **Gradle 9.1.0**;
4. `./gradlew --no-daemon --stacktrace testDebugUnitTest lintDebug assembleDebug`;
5. APK existence and application ID verification using Build Tools `aapt`;
6. `actions/upload-artifact@v7.0.1` for the debug APK. The upload step has no `always()`
   condition and follows all checks, so failures do not produce an artifact.

All GitHub Actions references are pinned to published patch versions or, for wrapper
validation, an immutable commit SHA. The Phase B workflow contains no signing secrets, release
AAB, deployment or production operation.

Honest CI caveats to be stated in every phase report:

- A green CI build is not device verification. Real-device checks (splash, back
  navigation, keyboard/insets, process death) are manual and must be reported as such.
- Live-service behaviour (real Supabase project, real Vercel deployment, deployment
  protection) cannot be exercised by CI without credentials; unverified items are listed
  explicitly instead of being assumed.

---

## 6. Configuration & environment

| Setting | Where | Notes |
| --- | --- | --- |
| API base URL | `android/app/build.gradle.kts`: `BuildConfig.API_BASE_URL`, overridable with `-PmaharaniApiBaseUrl=https://host/` | **Not a secret.** Default is the existing deployed HTTPS API. `ApiBaseUrlContract` requires HTTPS by default and receives `BuildConfig.DEBUG` before allowing only local loopback/emulator HTTP; release network security config also denies all cleartext. Credentials, query strings, and fragments are rejected. No Supabase URL/key is compiled into the app. |
| Release signing | Not used by the Phase B workflow | Keystores/`local.properties` stay git-ignored; signed release output is a separately authorized later phase |
| Server env | Existing deployment env (`NEXT_PUBLIC_SUPABASE_*`, `SUPABASE_SERVICE_ROLE_KEY`, …) | Unchanged; never duplicated into the app |
| Local development | `cd android && ./gradlew …` after installing JDK 17 + Android SDK 36 | The Gradle wrapper is committed, so no `gradle wrapper` step is needed |

---

## 7. Exact acceptance tests (commands)

**Backend / web (this repository):**

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm run typecheck                     # tsc --noEmit
corepack pnpm run lint
corepack pnpm test                               # 96 files / 1,826 tests in this verification run
corepack pnpm exec vitest run tests/android-project-integrity.test.ts tests/mobile-api-foundation.test.ts
NEXT_TELEMETRY_DISABLED=1 corepack pnpm run build  # Next.js production build
```

**Android (CI, or locally with JDK 17 + SDK 36):** the wrapper runs every module's unit
tests. This sandbox has no JDK/Android SDK, so the Android Gradle tasks have NOT been
executed locally and the commands below are the verification contract, not a result.

```bash
cd android
./gradlew --version
./gradlew --no-daemon --stacktrace testDebugUnitTest lintDebug assembleDebug
```

A signed release AAB is deliberately outside Phase B and is not part of this workflow.

**Security assertions that must keep passing (static, in the existing suite):**

- no Supabase key or secret anywhere under `android/` (`NEXT_PUBLIC_`, `SUPABASE_`,
  `service_role`, `SERVICE_ROLE`, private keys) — new test in `tests/mobile-api-foundation.test.ts`;
- no `WebView`/`android.webkit` usage in the Android sources except the documented
  absence note (asserted by the same test);
- release `ApiBaseUrlContract` requires HTTPS and the main network-security config disables cleartext; debug-only local HTTP is explicitly gated by `BuildConfig.DEBUG`;
- normal system CA validation only (no custom trust manager/hostname verifier), with no cookies, redirect following, automatic connection retries, or HTTP logging interceptor;
- no auth token or service-role credential is placed in a URL, request log, or APK configuration;
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
- Add a native build/test/lint workflow template under `docs/` and document its promotion
  requirement; the active legacy workflow cannot be changed by this GitHub App. Repoint the
  `android:build:*` npm scripts at the native project.

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
| Dependency install | `corepack pnpm install --frozen-lockfile` | **passed** — lockfile up to date |
| Focused web/mobile/static checks | `corepack pnpm exec vitest run tests/android-project-integrity.test.ts tests/mobile-api-foundation.test.ts tests/mobile-safety.test.ts tests/production-readiness.test.ts` | **4 files / 75 tests passed** |
| Android project integrity/security assertions | Included above | **5 / 5 passed** — imports, module/build-script mapping, resources, and release transport/retry/logging invariants |
| Full web suite | `corepack pnpm test` | **96 files / 1,826 tests passed** |
| Type checking | `corepack pnpm run typecheck` (`tsc --noEmit`) | **passed** |
| Web lint | `corepack pnpm run lint` | **passed** with the existing `<img>` optimization warning in `components/admin/product-image-manager.tsx:110` |
| Next.js production build | `NEXT_TELEMETRY_DISABLED=1 corepack pnpm run build` | **passed**; same existing `<img>` warning |
| Android wrapper / unit tests / lint / APK | `cd android && ./gradlew --version` and `./gradlew --no-daemon --stacktrace testDebugUnitTest lintDebug assembleDebug` | **not run** — Java/JDK, Gradle, adb, and Android SDK tools are unavailable locally. The native workflow template is not active and no native GitHub Actions run exists; no APK artifact is available. |

Phase A/B baseline files already present on the branch:

- `docs/NATIVE_ANDROID_{MIGRATION_AUDIT,API_CONTRACT,MIGRATION_PLAN}.md`
- `lib/mobile/{http,supabase,auth,pagination,rate-limit,index}.ts` and
  `app/api/mobile/v1/{health,session}/route.ts`
- `tests/mobile-api-foundation.test.ts`, `tests/android-project-integrity.test.ts`
- `android/**` (Gradle wrapper + catalog, 7 modules, 57 Kotlin files; the current follow-up
  adds the network-policy unit test)
- `docs/android-workflow-native.yml` (native template). The active
  `.github/workflows/android-apk.yml` remains the legacy workflow because this integration
  lacks permission to update GitHub workflow files.
- Other baseline changes include `lib/permissions/permissions.ts`, `.gitignore`, and
  `package.json` (Android scripts repointed).

Blockers and unverified items carried forward (stated, not hidden):

1. **Nothing under `android/` has been compiled yet** — local Android tooling is absent and
   the native workflow template still needs promotion by a maintainer with workflow-write
   permission. The first real CI build may surface Kotlin/Gradle/API issues; static checks
   narrow that gap but do not replace compilation.
2. **Credential sign-in is not implemented** (Phase C); the current shell/session foundation
   must not be represented as a completed login flow.
3. **Live-service behaviour is unverified**: no request has been made against the deployed
   API or the Supabase project from this environment.
4. **No device/emulator run**: splash, insets, back navigation and process death are
   untested on hardware.
5. The Capacitor config and `cap:*` scripts remain (they are asserted by
   `tests/mobile-safety.test.ts` and `tests/production-readiness.test.ts`) and are retired in
   one deliberate change at the end of Phase G.
