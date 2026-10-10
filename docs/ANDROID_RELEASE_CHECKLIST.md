# Maharani Traders — Android release checklist (Phase H gate)

**What this document is:** the gate list that must be satisfied before a release build is signed,
uploaded or offered to any real shop. It is **not** a record of finished work. Items are ticked
only where a CI run or a test is cited; everything else is unstarted, and the release phase
(Phase H) has not begun.

> **Updated 9 October 2026** against CI run `37959400861` (head `d6ec741`, PR #100).
> §0 and §1 previously described a much older build; both are corrected below with
> measured evidence. The signing, device and Play gates are unchanged and still
> open — see `docs/ANDROID_RELEASE_SIGNING.md` for the runbook and
> `docs/LAUNCH_RELEASE_GATE_2026-10-11.md` for the full launch assessment.

## 0. Where the build actually stands

| Fact | Status |
| --- | --- |
| Debug APK built by CI | **YES** — run `37959400861`, artifact `maharani-traders-debug-apk`, **16,371,253 bytes** |
| Package id asserted from the built artifact | **YES** — `aapt dump badging` matched `package: name='com.maharanitraders.app'` |
| Version asserted from the built artifact | **YES** — `versionName='1.0.0' versionCode='1'`, compared against `android/version.properties` and failed on mismatch |
| Kotlin unit tests executing in CI | **YES** — `testDebugUnitTest` passes for every module (413 tests, 11 modules) |
| Rendered Compose tests at 360/393/412 dp | **YES** — `RetailerRenderedLayoutTest.kt`, 33 assertions |
| Lint as a hard gate | **YES** — `abortOnError = true`; `lintDebug` runs in the same invocation |
| Release APK / AAB built by CI | **YES, but UNSIGNED** — 2,849,725 and 6,409,691 bytes, built for size measurement |
| Signed release bundle | **NO — BLOCKED** — no upload key exists; CI reports `signed release BLOCKED` and names the four missing secrets |
| Installed and used on a device | **NO — BLOCKED** — no device, emulator, JDK or Android SDK in the review environment |
| Live production backend verified | **YES** — 11/11 unauthenticated probes against `https://maharanitraders.vercel.app`, run `37959400920` |
| Play Console entry | **NO** — not started |

## 1. Build and toolchain gates

- [x] `versionName` / `versionCode` policy — **DONE.** `android/version.properties` is the single
      source of truth; the build derives `versionName = MAJOR.MINOR.PATCH` and `versionCode` from it,
      so the `1.0.0-phase-b` marker can never return as a literal. CI reads the values back out of
      the built APK and fails on mismatch. Policy and rationale: `docs/ANDROID_RELEASE_SIGNING.md` §2;
      guarded by `tests/android-release-versioning.test.ts`.
- [x] `abortOnError = true` — **DONE.** Set in `android/app/build.gradle.kts`; `lintDebug` runs in CI
      and a lint error fails the build. (This line previously described lint as advisory.)
- [ ] Triage every lint warning and every Kotlin compiler warning currently waived. 26 non-fatal
      lint issues remain; `GradleDependency`, `AndroidGradlePluginVersion` and `NewerVersionAvailable`
      are still disabled.
- [ ] Release build type verified: R8/minify rules, no reflective serializer or Hilt entry point
      stripped. R8 full mode and resource shrinking are on and the artifact builds, but nothing has
      been *run* — an over-aggressive keep-rule failure only shows at runtime on a device.
- [ ] **16 KB page-size alignment — NOT VERIFIED, and it applies.** The artifact ships 8 native
      libraries across four ABIs. Check with `zipalign -c -P 16 -v 4 app-release.apk` or the Play
      pre-launch report.
- [ ] Reproducibility: the same commit produces the same artifact.

## 2. Signing and secrets

- [ ] **BLOCKED** — upload key generated and stored outside the repository; `RELEASE_KEYSTORE_PATH`,
      `RELEASE_KEYSTORE_PASSWORD`, `RELEASE_KEY_ALIAS`, `RELEASE_KEY_PASSWORD` supplied only as CI
      secrets. The build already reads all four, and CI already has the decode → build → `apksigner`
      verify → destroy path; it is inert until the secrets exist. No key may be invented: a
      CI-generated key would differ from any future real one and strand every device that installed it.
      Steps: `docs/ANDROID_RELEASE_SIGNING.md` §3–§4.
- [ ] **BLOCKED** — Play App Signing enrolled; the upload key is not the app-signing key.
- [x] Verified no secret ships in the APK — the only compiled-in configuration is the API base URL,
      which is not a secret. Asserted by `tests/mobile-api-foundation.test.ts` and
      `tests/android-release-versioning.test.ts`; no keystore or key file exists under `android/` and
      none is tracked by git.
- [x] Supabase service-role key and any provider credential remain server-side, reachable only
      through `/api/mobile/v1`. Live-verified: `/api/mobile/v1/{session,cart,catalog/products,orders}`
      all return 401 `missing_token` to an anonymous caller in production.

## 3. Security gates

- [ ] HTTPS-only transport re-verified on the release build (no cleartext, no redirect downgrade).
- [ ] No WebView, no Capacitor, no remote-URL shell in the shipped UI.
- [ ] Tokens only in Keystore-backed storage; no token in logs, preferences, backups or URLs.
- [ ] RLS and role gates re-verified against the release build's endpoints (server-side, not client-side).
- [ ] Rate limits and idempotency confirmed for every order/payment-adjacent mutation.

## 4. Functional gates (per phase, on a device, against staging)

- [ ] **Phase C** — sign-in, registration, pending approval, suspension, access expiry, refresh, sign-out, password reset. Implemented and unit-tested; never run against a live server.
- [ ] **Phase D** — catalog, search, product detail. Not started.
- [ ] **Phase E** — cart, checkout, order confirmation, order history. Not started.
- [ ] **Phase F** — notifications, wallet/coins. Not started.
- [ ] **Phase G** — staff and admin workspaces. Not started.

## 5. Quality gates

- [ ] Compose UI tests for the critical journeys.
- [ ] Offline / timeout / timeout-after-send matrix executed.
- [ ] Accessibility pass (TalkBack, touch targets, contrast).
- [ ] Performance pass (cold start, list scrolling, memory).
- [ ] Crash-free sessions confirmed on the staging build.

## 6. Release mechanics

- [ ] Release notes and changelog.
- [ ] Staged rollout plan (internal → closed → production).
- [ ] Rollback plan (previous AAB plus any server-side flags).
- [ ] Store assets: icon, feature graphic, screenshots, privacy-policy URL, data-safety form.
- [ ] Support contact and incident runbook.

## Explicitly not done

Every box above that is not marked **YES** in §0 is unstarted. There is no signed bundle, no Play
Console entry, no end-to-end run against live Supabase/Vercel, and no device install. Phase B is
verified in CI; Phase C is implemented and unit-tested only.
