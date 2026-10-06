# Android build verification — native UI redesign change set

Branch: `arena/01a100c2-maharani-mart` · change set: the native shopping redesign
(see `docs/NATIVE_UI_REDESIGN.md`) · recorded 2026-10-03.

> **Historical snapshot.** Sections 1–7 below record the Phase D UI-redesign branch
> and checks as they stood on 2026-10-03; the branch name and its old checklist are
> not instructions for the current Arena session. Phase E is being developed on
> `arena/01a10274-maharani-mart`. Its current web checks and Android blocker are
> recorded in `docs/NATIVE_UI_REDESIGN.md` §10. On 2026-10-04,
> `./gradlew testDebugUnitTest lintDebug assembleDebug` was attempted from `android/`
> and exited before Gradle started: `JAVA_HOME` is unset and no `java` executable
> exists. `ANDROID_HOME`/`ANDROID_SDK_ROOT`, common SDK directories and the local
> Gradle wrapper distribution cache are also absent; the Android tasks and APK
> therefore remain unverified.

## 0. Bottom line

**No debug APK was produced. Nothing in `android/` has been compiled.**

`./gradlew testDebugUnitTest lintDebug assembleDebug` could not be *started* in
this environment: there is no JVM, no Android SDK, and no network route to the
Gradle distribution or to any Maven repository. `kotlinc` has never run against
these sources, so no claim of "Kotlin compiles" is made anywhere in this change
set. Everything that did run is listed in §6 — it is TypeScript/Vitest (Node is
available) plus static analysis of the Kotlin. **Static analysis is not
compilation**, and §5 states exactly what it can and cannot prove.

Two real compile errors were nevertheless found and fixed by that static analysis
(§5) — which is the honest summary of this document: the code is audited, not
built.

---

## 1. Toolchain probe — requirement, command, observed result

Required by the project (`android/gradle/libs.versions.toml`,
`android/app/build.gradle.kts`, `docs/NATIVE_ANDROID_MIGRATION_PLAN.md` §1):
JDK **17**, Gradle **9.1.0** (wrapper), AGP **9.0.1**, Kotlin **2.4.20**,
KSP **2.3.10**, Hilt **2.60.1**, Compose UI/foundation **1.10.3** + Material 3
**1.4.0**, Navigation **2.9.7**, Coil **3.4.0**, `compileSdk`/`targetSdk` **36**,
`minSdk` **24**, Build Tools **36.0.0**.

| Requirement | Probe | Result |
| --- | --- | --- |
| JDK 17+ (`java`, `javac`) | `command -v java javac jar keytool` | all **NOT FOUND** |
| any JVM on disk | `find / -xdev -maxdepth 7 -name java -o -name javac -o -name jre` | **no matches** |
| JDK via apt | `apt-get install -s openjdk-17-jdk-headless` | `E: Unable to locate package openjdk-17-jdk-headless` (no package lists) |
| JDK download | `curl -m 8 https://api.adoptium.net/v3/info/available_releases` · `https://corretto.aws/downloads/latest/amazon-corretto-17-x64-linux-jdk.tar.gz` · `https://download.java.net/` | exit **35**, `curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL` |
| Android SDK 36 | `echo $ANDROID_HOME $ANDROID_SDK_ROOT`; `ls -d ~/Android/Sdk /opt/android-sdk /usr/lib/android-sdk` | **unset / no such directory** |
| SDK tools | `command -v sdkmanager adb aapt2 apksigner zipalign` | all **NOT FOUND** |
| `android.jar` anywhere | `find / -xdev -maxdepth 5 -name android.jar -o -name platform-tools -type d` | **no matches** |
| SDK repository | `curl -m 8 https://dl.google.com/android/repository/repository2-3.xml` · `https://dl.google.com/dl/android/maven2/com/android/tools/build/gradle/9.0.1/gradle-9.0.1.pom` | exit **35** (SSL_ERROR_SYSCALL) |
| Gradle 9.1.0 | `command -v gradle`; `ls ~/.gradle`; wrapper files | no system Gradle, no cache; `gradlew` + `gradle-wrapper.jar` + `distributionUrl=…gradle-9.1.0-bin.zip` **are committed**, but `curl -m 8 https://services.gradle.org/distributions/gradle-9.1.0-bin.zip` → exit **35**, and there is no JVM to run the wrapper anyway |
| Maven artifacts | `curl -m 8` on `https://repo.maven.apache.org/maven2/`, `https://repo1.maven.org/maven2/`, `https://maven.google.com/`, `https://plugins.gradle.org/m2/` | all exit **35** ⇒ AGP, Kotlin/KGP, KSP, Hilt, Compose, Navigation, Coil cannot be resolved |
| What *is* reachable | `https://registry.npmjs.org/…` → **200**; `https://github.com/` → **200** | Node/npm works (that is how the web suite runs); `objects.githubusercontent.com`, `github-releases.githubusercontent.com`, `raw.githubusercontent.com`, `deb.debian.org` → exit **35** |

**Three independent blockers.** Even if a JDK were somehow installed, the build
would still fail twice more: Gradle cannot download its own distribution or the
Android Gradle Plugin, and there is no `platforms;android-36/android.jar` to
compile against. This is why no further installation attempts were made — the
same dead ends (npm-packaged JREs, `kotlin-compiler` JARs, tree-sitter native
builds) were already exhausted earlier in this work and are recorded in
`docs/NATIVE_ANDROID_MIGRATION_PLAN.md` §"not run" notes.

---

## 2. Path A — GitHub Actions (already in the repo; no workflow change needed)

`.github/workflows/android-apk.yml` ("Native Android Debug APK") already runs
exactly the requested command. Its `android` job (after a `web` job that runs
`pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`):

1. `gradle/actions/wrapper-validation` on the committed wrapper;
2. `actions/setup-java@v6.0.1` → **temurin 17**;
3. `android-actions/setup-android@v4.0.4`, then
   `sdkmanager "platforms;android-36" "build-tools;36.0.0"`;
4. `gradle/actions/setup-gradle@v6.4.0` (build cache);
5. `./gradlew --no-daemon --version` and asserts the output contains
   `Gradle 9.1.0`;
6. `./gradlew --no-daemon --stacktrace testDebugUnitTest lintDebug assembleDebug`
   (working directory `android`), tee'd to `/tmp/gradle.log`;
7. on failure: re-emits `e:` / `w:` Kotlin diagnostics, `* What went wrong:`,
   `Caused by:` lines and the failing JUnit cases (parsed from
   `android/**/build/test-results/**/*.xml`) as **check annotations**, and posts
   the same bundle as a PR comment (`### Android CI diagnostics — <sha>`);
8. verifies APK identity:
   `"$ANDROID_HOME/build-tools/36.0.0/aapt" dump badging android/app/build/outputs/apk/debug/app-debug.apk`
   must contain `package: name='com.maharanitraders.app'`;
9. uploads artifacts `maharani-traders-debug-apk`
   (`android/app/build/outputs/apk/debug/app-debug.apk`),
   `android-build-diagnostics`, and `android-reports`
   (`android/**/build/reports`).

**How to trigger it for this change set.** The workflow fires on `push` /
`pull_request` touching `android/**`, `tests/**`, `app/api/mobile/**`,
`lib/mobile/**`, `lib/permissions/**`, `package.json`, `pnpm-lock.yaml`, and on
`workflow_dispatch`. So either:

- push `arena/01a100c2-maharani-mart` and open a PR (this session is not
  permitted to commit or push — a human has to do it), or
- Actions → **Native Android Debug APK** → *Run workflow* → branch
  `arena/01a100c2-maharani-mart`.

No workflow edit is required, and none was made: `tests/production-readiness.test.ts`
asserts against this file, and the automation token here does not carry the
`workflows` permission anyway (documented at the top of
`docs/android-workflow-apk-aab.yml`).

**Where the verdict lives.** The `android` job's "Run Android unit tests, lint,
and assemble debug APK" step; on failure the annotations and the PR comment carry
the compiler errors; on success the `maharani-traders-debug-apk` artifact is the
proof the APK exists.

---

## 3. Path B — a machine with the toolchain

Install once:

| Component | Version | Notes |
| --- | --- | --- |
| JDK | **17** (Temurin) | `sourceCompatibility`/`targetCompatibility`/`jvmTarget` are 17 |
| Android SDK | `platforms;android-36`, `build-tools;36.0.0`, `platform-tools` | export `ANDROID_HOME`, or write `sdk.dir=…` into `android/local.properties` (that file is deliberately absent from the repo) |
| Gradle | **none** | the committed wrapper fetches 9.1.0 on first run (≈150 MB, plus ≈1–2 GB of dependencies) |

Then:

```bash
git fetch origin arena/01a100c2-maharani-mart
git switch arena/01a100c2-maharani-mart        # do not merge/rebase/reset
cd android
./gradlew --version                             # must print Gradle 9.1.0 on JVM 17.x
./gradlew --no-daemon --stacktrace testDebugUnitTest lintDebug assembleDebug
```

The same three tasks are wrapped as npm scripts at the repo root:
`npm run android:test`, `npm run android:lint`, `npm run android:build:debug`.

Pointing the build at a backend (optional; defaults live in
`android/app/build.gradle.kts:17-19` → `BuildConfig.API_BASE_URL`):

```bash
./gradlew assembleDebug -PmaharaniApiBaseUrl=https://your-deployment.example/
```

Confirm the APK really exists and is the right app — do not trust the Gradle exit
code alone:

```bash
ls -l android/app/build/outputs/apk/debug/app-debug.apk
"$ANDROID_HOME/build-tools/36.0.0/aapt" dump badging \
  android/app/build/outputs/apk/debug/app-debug.apk | head -3
#   package: name='com.maharanitraders.app' versionCode='…' versionName='…'
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

Reports to read if something fails:

- unit tests: `android/**/build/reports/tests/testDebugUnitTest/index.html`
- lint: `android/**/build/reports/lint-results-debug.html`
- Kotlin diagnostics: lines starting `e: ` (errors) / `w: ` (warnings) in the
  Gradle output.

---

## 4. If compilation fails, look here first (risk register for this change set)

Ordered by likelihood. These are the places where a signature or scope assumption
is most likely to be wrong, because they are the newest code and cannot be
type-checked here.

1. **Material 3 1.4.0 named-argument drift.**
   `FilterChipDefaults.filterChipColors(containerColor=, selectedContainerColor=, selectedLabelColor=)`
   and `NavigationBarItemDefaults.colors(indicatorColor=, selectedIconColor=, …)`
   (`CatalogScreen.kt`, `AuthenticatedShell.kt`), `TopAppBarDefaults.topAppBarColors(…)`,
   `Surface(onClick=…)` (`ProductCard.kt`, `CategoryTile.kt`, `PackSelector` in
   `ProductDetailScreen.kt`), `HorizontalDivider`.
2. **Scope receivers for `weight`.** 17 call sites use `Modifier.weight(1f[, fill = false])`
   (`PriceBlock.kt`, `ProductCard.kt` ×2, `CatalogScreen.kt` ×2,
   `ProductDetailScreen.kt` ×6, `MaharaniSearchBar.kt`, `SectionHeader.kt`,
   `Skeletons.kt`, `AuthenticatedShell.kt`, `AccountScreen.kt`,
   `RetailerHomeScreen.kt`) and 4 use `Modifier.align(Alignment.*)`
   (`ProductDetailScreen.kt` ×2, `BannerCarousel.kt`, `ProductCard.kt`). Each was
   hand-verified to sit inside `RowScope`/`ColumnScope`/`BoxScope` respectively;
   an error here means a scope mismatch, not a missing import.
3. **Pager API.** `rememberPagerState(pageCount = { … })` + `HorizontalPager`
   (`ProductDetailScreen.kt` gallery, `BannerCarousel.kt`) — stable in foundation
   1.10.3, no opt-in expected.
4. **Experimental opt-ins.** `@OptIn(ExperimentalMaterial3Api::class)` on
   `RoutedShell` covers `TopAppBar` / `ModalNavigationDrawer`. If `kotlinc` asks
   for another opt-in, add the annotation — do not delete the component.
5. **`CatalogSort.entries`** (`CatalogScreen.kt` sort menu) requires Kotlin ≥1.9;
   the project pins 2.4.20, so this is only a risk if the toolchain is older than
   documented.
6. **Hilt/KSP graph.** `CategoriesViewModel` is a new `@HiltViewModel` with
   `@Inject constructor(repository: CatalogRepository)`, mirroring
   `HomeViewModel`/`CatalogViewModel` exactly; no new module, qualifier or binding
   was added. KSP failures would most likely be *duplicate* bindings, and none
   were introduced. Static analysis cannot verify any of this — KSP only runs
   under Gradle.
7. **Navigation destinations.** `CATEGORIES` and `ACCOUNT` were added to
   `MaharaniCatalog` with `phase = null`, and `MaharaniRouterTest`'s two "built"
   sets were updated in the same change. A test failure there means the
   destination/screen mapping drifted, not that a screen is broken.
8. **Resources/themes.** Only `BrandSplash.kt` changed colour (Compose-side, pinned
   to `MaharaniPalette.BrandRed600`). `themes.xml`, the splash drawable and
   `@mipmap/ic_launcher` are untouched, and `tests/android-project-integrity.test.ts`
   still asserts them (green).

---

## 5. Static verification performed here, and its exact limits

Ran (all reproducible in this sandbox):

| Check | Scope | Result |
| --- | --- | --- |
| Tree-sitter parse (`web-tree-sitter@0.20.8` + `tree-sitter-kotlin.wasm`) | all 111 `.kt` files | 0 real problems; the 2 reported are the grammar's known inability to parse `fun interface` (`core/common/…/TimeSource.kt`, `core/network/…/AuthInterceptor.kt`), both pre-existing and valid Kotlin |
| Reference audit | 33 changed files | every `com.maharanitraders.*` import resolves to a real top-level declaration; every `MaharaniDimens.*`, `MaharaniThemeTokens.colors.*`, `MaharaniPalette.*`, typography role, test-tag constant and enum member used resolves; no duplicate top-level declarations in any package (only the legal `label()` overload set) |
| Compose audit | 33 changed files | Modifier-extension imports, unresolved Compose class references, `@Composable` presence on every function that calls a composable |
| Compose audit — **mutation-tested** | planted probe file | a deliberately broken file (missing `clip`, `testTag`, `RoundedCornerShape` imports + a composable call from a non-`@Composable` function) was flagged **4/4**; the probe was deleted and `git status -uall` confirms it is gone |
| Scope review | 17 `weight` + 4 `align` sites | all inside the correct `RowScope` / `ColumnScope` / `BoxScope` |

**Bugs this found and that were fixed:**

- `feature/catalog/ui/components/ProductGrid.kt` used `Modifier.fillMaxWidth()`
  with no `androidx.compose.foundation.layout.fillMaxWidth` import →
  `error: unresolved reference: fillMaxWidth`. **Fixed** (import added). This file
  had escaped earlier audits because `git status --porcelain` collapses an
  untracked *directory* (`ui/components/`) into one line; re-running with
  `-uall` brought all five component files into scope.
- `core/designsystem/components/MaharaniSearchBar.kt` referenced
  `tokens.onAppBarFieldHint`, a token that does not exist → unresolved reference.
  **Fixed** to `tokens.appBarFieldHint`.
- Two missing `androidx.compose.foundation.background` imports
  (`BannerCarousel.kt`, `RetailerHomeScreen.kt`). **Fixed.**

**What none of this proves.** No type inference, no overload resolution, no
nullability/smart-cast checking, no KSP/Hilt validation, no resource linking
(aapt2), no desugaring/dexing (d8), no lint, no R8. A file can pass every check
above and still fail `kotlinc` — for example on an ambiguous overload, a
`Modifier` extension resolved against the wrong scope, or a Hilt binding error.
Treat §2/§3 as the only path to a real verdict.

---

## 6. Phase D evidence recorded on 2026-10-03

| Command | Result |
| --- | --- |
| `npm run typecheck` (`tsc --noEmit`) | clean, no output |
| `npx vitest run` (whole suite) | **98 files / 1951 tests passed** |
| `npx vitest run tests/android-project-integrity.test.ts` | **23/23 passed** (token declarations, cross-module Gradle deps, test-double completeness, Coil ceiling, no `material-icons-*`, no WebView/Capacitor, manifest/theme/network-config invariants) |
| `npx vitest run tests/mobile-safety.test.ts` | **6/6 passed** |
| `next lint` / `next build` | **not run** — no web or backend file changed in this change set; CI runs both in the `web` job anyway |
| `./gradlew testDebugUnitTest lintDebug assembleDebug` | **not run** — see §1 |
| Debug APK | **does not exist**; `android/app/build/` was never created |

---

## 7. Original Phase D reviewer sign-off checklist (historical)

- [ ] CI `android` job green on `arena/01a100c2-maharani-mart`
- [ ] `maharani-traders-debug-apk` artifact downloaded, `aapt dump badging` shows
      `package: name='com.maharanitraders.app'`
- [ ] Installed on an API 24 and an API 36 device/emulator
- [ ] Walked Home → Categories → Catalogue → PDP → Account against a real backend
      (banners, categories, brands, products, per-pack pricing, stock, slabs)
- [ ] Exercised offline, server-500 and empty-catalogue states
- [ ] Checked dark mode, a 360dp-wide window and a tablet window
- [ ] TalkBack over a product card, the stock badge and the search field
- [ ] Confirmed the PDP has no add-to-cart and the cart/orders tabs show the
      honest Phase-E placeholder

---

## 8. Addendum — the 2026-10-06 session + catalogue change set

This addendum supersedes §4.6 above (which named `CategoriesViewModel`, a file
this change set deletes).

### What changed

- **Session persistence (the defect).** `SessionManager.restore()` published the
  stored access token to `ActiveTokenHolder` *after* `GET /api/mobile/v1/session`
  had been called. The verify call is bearer-authenticated by the interceptor
  reading that holder, so every cold start verified anonymously, took a 401, and
  wiped a valid session — which is why the app asked for a password on every
  launch. The token is now published before the verify call.
- **Runtime refresh.** A request that answers `401 invalid_token` is retried once
  after `TokenRefreshCoordinator` exchanges the refresh token (single-flight, no
  recursion, no retry on transport failures or on requests that carried no
  token). The launch path still refreshes once and treats a refused refresh token
  as terminal while a network failure keeps the stored pair.
- **Per-account isolation.** `core:common` declares `SessionScopedStore`; the
  session layer clears every contributed store whenever the published state is not
  `Authenticated` and before a new account is accepted. `FavoritesStore`,
  `CartCountStore` and `UnreadStore` are the implementors.
- **One catalogue.** `CatalogScreen` + `CatalogViewModel` now own the Products,
  Categories and Brands panes (`CatalogTabStrip`, `DirectoryCards`). The former
  `CategoriesScreen`, `CategoriesViewModel` and `CategoriesViewModelTest` are
  deleted, and the drawer's Categories entry opens the catalogue on its pane.
- **Shell.** The bottom bar's second tab is `CATALOG`; `AccountScreen` gained real
  shortcuts (orders, favourites, quick order, coins, coupons, notifications) and
  the home rails' "View all" opens the catalogue on the pane it summarises.

### Verification status, and what is NOT verified here

| Check | Result |
| --- | --- |
| `tests/android-project-integrity.test.ts` (static Kotlin gates) | **green** |
| `tests/parity-doc-totals.test.ts` | **green** |
| `pnpm typecheck` / `next lint` / `pnpm test` / `next build` | run in this change set; results in the PR body |
| `./gradlew testDebugUnitTest lintDebug assembleDebug` | **not run in this environment** — the sandbox has no JDK, no Android SDK and cannot reach `services.gradle.org`, `dl.google.com` or Maven Central. The `android-apk.yml` job is the compiler of record for this change, and no Kotlin build result is claimed unless that job is green. |

The new Kotlin unit tests that CI runs are
`android/core/auth/src/test/…/SessionManagerTest.kt` (token published before the
verify call; refresh success/refusal/offline; a second account cannot inherit the
first account's scoped state),
`android/core/network/src/test/…/ApiCallExecutorTest.kt` (one retry after a
refresh; no retry without a new token; no retry on transport failure),
`android/core/network/src/test/…/TokenRefreshCoordinatorTest.kt` (single-flight,
no recursion, reset, no refresher) and
`android/feature/catalog/src/test/…/CatalogViewModelTest.kt` (categories load,
brands load, category filter, brand filter, pane navigation, device-side
narrowing, empty taxonomy, per-pane failure and retry, pagination, de-duplication).
