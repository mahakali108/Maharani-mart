# Maharani Traders — Android release checklist (Phase H gate)

**What this document is:** the gate list that must be satisfied before a release build is signed,
uploaded or offered to any real shop. It is **not** a record of finished work. Items are ticked
only where a CI run or a test is cited; everything else is unstarted, and the release phase
(Phase H) has not begun.

## 0. Where the build actually stands

| Fact | Status |
| --- | --- |
| Debug APK built by CI | **YES** — run `37003248313` (head `4b2fe64`), artifact `maharani-traders-debug-apk`, 13,710,210 bytes |
| Package id asserted by the build | **YES** — `aapt dump badging` matched `package: name='com.maharanitraders.app'` in the same run |
| Kotlin unit tests executing in CI | **YES** — `testDebugUnitTest` passes for every module |
| Release AAB / signed bundle | **NO** — never built; there is no signing key in CI, deliberately |
| Installed and used on a device | **NO** — never done |
| Play Console entry | **NO** — not started |

## 1. Build and toolchain gates

- [ ] `versionName` / `versionCode` policy — the app currently reports `1.0.0-phase-b`, which must not ship.
- [ ] `abortOnError = true` — lint is advisory today (Phase H decision), so it cannot fail a build yet.
- [ ] Triage every lint warning and every Kotlin compiler warning currently waived.
- [ ] Release build type verified: R8/minify rules, no reflective serializer or Hilt entry point stripped.
- [ ] Reproducibility: the same commit produces the same artifact.

## 2. Signing and secrets

- [ ] Upload key generated and stored outside the repository; `RELEASE_KEYSTORE_PATH`, `RELEASE_KEYSTORE_PASSWORD`, `RELEASE_KEY_ALIAS`, `RELEASE_KEY_PASSWORD` supplied only as CI secrets.
- [ ] Play App Signing enrolled; the upload key is not the app-signing key.
- [ ] Verified no secret ships in the APK — the only compiled-in configuration is the API base URL, which is not a secret.
- [ ] Supabase service-role key and any provider credential remain server-side, reachable only through `/api/mobile/v1`.

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
