# Android app-size audit — 2026-10

Professional size audit of the native Maharani Traders Android app
(`com.maharanitraders.app`, Kotlin + Jetpack Compose), performed measure-first
on CI-built artifacts. Every number below is a real byte count from
`scripts/android-apk-size-report.py` run in GitHub Actions — full breakdowns
live in the size-report comments on PR #98 and in each run's
`maharani-traders-release-artifacts` artifact.

**Verdict: `PASS — production artifact <= 30 MB`** (release APK 2.85 MB — an
order of magnitude under the 30 MB target; the "30 MB+" premise does not
reproduce on this codebase).

## Measured sizes

Baseline = commit `ccc3cf6` (measurement tooling only — **app code identical to
`main` @ `8b1c8bf`**). Optimized = commit `ff74cb4`.

| artifact | baseline | optimized | delta |
| --- | ---: | ---: | ---: |
| **debug APK** | 16,448,231 B (16.45 MB) | 16,352,566 B (16.35 MB) | −95,665 B (−0.58 %) |
| **release APK** (unsigned, R8) | 2,920,998 B (2.92 MB) | 2,847,649 B (2.85 MB) | −73,349 B (−2.51 %) |
| **release AAB** | 6,460,716 B (6.46 MB) | 6,403,114 B (6.40 MB) | −57,602 B (−0.89 %) |

Debug vs release is the essential distinction: the debug APK ships
**unminified** bytecode (21 dex files, 39.97 MB uncompressed classes) plus
debug tooling. The production release artifact — R8 full mode + resource
shrinking — is **2.85 MB**. The old CI debug artifact of ~15.7 MB (zip-wrapped)
was never "30 MB+" either; any 30 MB+ figure predates the native app (the
retired Capacitor wrapper bundled `www/`) or counts installed/OAT size, not
the APK.

## Size breakdown (optimized release APK — 2,847,649 B)

| contributor | compressed | share |
| --- | ---: | ---: |
| classes.dex (R8-shrunk code: Compose, Material3, Hilt, Retrofit/OkHttp, Coil, app) | 2,076,079 | 72.9 % |
| lib/ — 8 `.so` (see ABI audit) | 242,900 | 8.5 % |
| res/ — launcher WebP art + theme XML | 188,522 | 6.6 % |
| resources.arsc | 156,656 | 5.5 % |
| assets/ — OkHttp `PublicSuffixDatabase.list` + 2 small | 49,583 | 1.7 % |
| META-INF/ (signing + tiny metadata) | 26,664 | 0.9 % |
| manifest + misc | 1,901 | 0.1 % |

Hygiene checks (enforced by `tests/android-size-guardrails.test.ts`):
**0** bundled fonts, **0** JSON/raw data catalogs, **0** product images,
**0** duplicate zip entries. Production catalog data (products, categories,
brands, prices, images) comes exclusively from the Next.js + Supabase backend
via `/api/mobile/v1` — nothing is bundled.

## Optimizations performed

1. **Launcher art PNG → lossless WebP** (15 files). Pixel-identity verified
   file-by-file during conversion: 280,115 → 187,126 B uncompressed (−33.2 %),
   largest icon 71,507 → 44,648 B. Resource names unchanged (`@mipmap/…`
   references are extension-agnostic), so launcher, splash
   (`windowSplashScreenAnimatedIcon`) and adaptive icons render identically.
   Verified in-artifact: release `res/` fell 259,210 → 188,522 B compressed.
2. **Dependency audit — genuinely unused entries removed** (no runtime
   dependency touched):
   - catalog aliases never referenced by any module: `hilt-android-testing`,
     `kotlinx-coroutines-core` (core arrives transitively via
     coroutines-android);
   - test scaffolding with zero referencing sources (no androidTest source set
     exists anywhere): `androidx.test:core`, `androidx.test.ext:junit`,
     `espresso-core`.
   Every other declared dependency is used (Coil renders server imagery,
   Retrofit/OkHttp/serialization drive `/api/mobile/v1`, Hilt/Dagger power DI,
   DataStore keeps non-sensitive prefs, splashscreen/navigation/lifecycle wire
   the shell). Nothing removed for being unfamiliar.
3. **Release packaging hygiene** — exclude upstream `META-INF/LICENSE*`,
   `NOTICE*`, `DEPENDENCIES`, `AL2.0`, `LGPL2.1`, `INDEX.LIST` stubs (never
   read on-device). `META-INF/services/` is deliberately NOT excluded
   (ServiceLoader).
4. **`android.enableR8.fullMode=true` pinned explicitly** in
   `android/gradle.properties` (the AGP-8+ default, now self-documenting).
   Release keeps `isMinifyEnabled true` + `isShrinkResources true` +
   `proguard-android-optimize.txt`.
5. **CI size measurement harness** — `scripts/android-apk-size-report.py`
   (stdlib-only) + workflow steps that build the unsigned release APK/AAB and
   publish exact byte sizes, compressed-size breakdowns, ABI/font/JSON/image
   hygiene checks and the ≤30 MB verdict on every relevant run.
6. **Guardrail tests** — `tests/android-size-guardrails.test.ts` locks the
   findings: minify+shrink stay on, no vendored `.so`/fonts/catalog data,
   icon budget ≤ 60 KB per file, no icon-pack/Glide/Firebase/analytics creep.

## Reviewed and intentionally unchanged

- **ProGuard/R8 keep rules** (`proguard-rules.pro`): kotlinx-serialization
  serializer keeps for the DTOs, Retrofit interface keeps, Hilt keeps —
  deliberate hardening for reflection-based paths. Tightening them further
  without on-device instrumentation coverage risks breaking login/session/
  checkout for a few hundred KB; not worth it at 2.85 MB.
- **Debug build stays unminified** (developer tooling, `ui-tooling` previews,
  readable stack traces). The acceptance target is the production artifact.
- **ABI strategy**: the only native code is what androidx ships —
  `libdatastore_shared_counter.so` (DataStore multiprocess safety) and
  `libandroidx.graphics.path.so`, both tiny (~51 KB / ~10 KB per ABI), present
  for arm64-v8a, armeabi-v7a, x86, x86_64. Retailer devices are covered by
  armeabi-v7a/arm64-v8a; x86/x86_64 serve emulators and CI — kept. At 8.5 % of
  a 2.85 MB APK, dropping ABIs would trade emulator/legacy coverage for
  ~125 KB. No ABI split is configured; see AAB strategy below.
- **Fonts**: none bundled. Hindi and English render through system fonts
  (Noto/Roboto fallback chain) — nothing to optimize or break.
- **Icons**: no icon library at all. The app draws its one glyph
  (`MaharaniIcons.Menu`) as vector paths — the 1.4 MB deprecated
  `material-icons` enum is deliberately absent.
- **Debug-only content in release**: debug network-security override
  (loopback cleartext) lives in `src/debug/` only; release is HTTPS-only,
  system trust anchors, non-logging, non-retrying (asserted by
  `tests/android-project-integrity.test.ts`). There are zero `Log`/`println`
  calls in app code to strip. Compose `ui-tooling` is `debugImplementation`.
- **Security**: the only compiled-in config is `API_BASE_URL` (non-secret).
  No Supabase URL/keys, service-role keys or tokens are in the APK (auth is
  proxied through `/api/mobile/v1/auth/…`); session tokens live in
  AndroidKeyStore-encrypted storage (AES-GCM). Nothing about the audit moved
  secrets into resources.

## APK vs AAB (Play distribution)

- `assembleRelease` universal APK: **2.85 MB** — what a sideload/direct
  download gets.
- `bundleRelease` AAB: **6.40 MB** — of which **3.92 MB is the R8 retrace
  map** (`BUNDLE-METADATA/…/proguard.map`) that Play strips before delivery.
- Estimated per-device Play delivery (base dex+res+assets + one ABI slice,
  further trimmed by density/locale splits): **~2.39 MB** to an arm64-v8a
  device. A universal APK size is NOT what every Play user downloads.

For Play, the AAB is the correct vehicle (automatic ABI/density/language
splits). For direct distribution the universal APK already contains all four
tiny ABI slices and is 2.85 MB — below any practical threshold.

## Feature preservation

No feature, screen, or dependency used at runtime was removed. Source scan
confirms all retailer surfaces intact: Login/Register/Forgot+Reset password/
Security, session persistence (KeystoreTokenStore) + restoration
(SessionBootstrapper), Catalog/Products/Categories/Brands/Search/Product
Detail, Favorites, Cart, Saved Carts, Quick Order, Buy Again, Comparison,
Checkout (CartCheckoutViewModel), Orders/Order Detail/Order Delivery/Order
Invoice/Reorder, Wallet (coins), Coupons, Notifications, Support, Address
book, Purchase reports. All 2,120 web/unit tests pass unchanged (including
2115 pre-existing + 5 new guardrails).

## How to re-measure

```bash
./gradlew assembleDebug assembleRelease bundleRelease
python3 scripts/android-apk-size-report.py \
  android/app/build/outputs/apk/debug/*.apk \
  android/app/build/outputs/apk/release/*.apk \
  android/app/build/outputs/bundle/release/*.aab
```

CI does the same on every `android/**` change and posts the report to the PR.
