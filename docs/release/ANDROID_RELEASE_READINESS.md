# Android release readiness

**Prepared:** 16 November 2026.
**Status: NOT READY to distribute.** No APK was built by this review, no keystore
exists in this repository or in CI, no device or emulator run has ever happened, and
nothing was published to Play Console.

**Companions:** `docs/ANDROID_RELEASE_SIGNING.md` (the signing runbook — read it
before doing anything here), `docs/ANDROID_RELEASE_CHECKLIST.md`,
`docs/ANDROID_BUILD_VERIFICATION.md`, `docs/NATIVE_ANDROID_API_CONTRACT.md`.

---

## 1. What the Android app actually is, in this release

The native Kotlin/Compose project under `android/` is built **manually**. The
workflow `.github/workflows/android-apk.yml` is `workflow_dispatch` only — it has no
`push` or `pull_request` trigger, deliberately, because the product ships as a web
PWA and the native tree is maintained as a diagnostic path:

* `testDebugUnitTest`, `lintDebug`, `assembleDebug` — one Gradle invocation;
* the debug APK is signed with Gradle's throwaway debug key (never distributable);
* an **unsigned** release APK and AAB are built only to measure size;
* a job step reports `READY-TO-SIGN` or `BLOCKED` from the presence of four secrets.

So "Android release readiness" here means two different things, and this document
keeps them apart:

| | Meaning | State |
|---|---|---|
| **A** | A debug APK you can install on your own phone today | achievable — §2 |
| **B** | A signed artifact a retailer can install, or a Play Store release | **blocked** — §4 |

## 2. Installing a debug build on a physical device (works today)

CI, manual run (Actions → "Native Android Debug APK" → Run workflow) produces
`app-debug.apk` as an artifact. Locally, with a JDK 17 and the Android SDK for API 36:

```bash
cd android
./gradlew --no-daemon assembleDebug          # → app/build/outputs/apk/debug/app-debug.apk

# install on a connected device
adb install -r app/build/outputs/apk/debug/app-debug.apk

# point it at something other than production, if needed
./gradlew --no-daemon assembleDebug -PmaharaniApiBaseUrl=https://staging.example/
```

Notes that matter for testing this release:

* the default API base URL is `https://maharanitraders.vercel.app/`, so a debug build
  talks to **production** unless overridden — check what is deployed before
  concluding that a screen is broken;
* `versionName`/`versionCode` come only from `android/version.properties`
  (today `1.0.0` / `1`); a device refuses an APK whose `versionCode` is not higher
  than the installed one;
* uninstall the previous build if you changed the signing key: Android rejects an
  update signed by a different key (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`).

## 3. The native "About / Legal" screen and this release

`MaharaniRoutes.LEGAL` and `LEGAL_PAGE` (`legal`, `legal/{slug}`) render a list fetched
from **`GET /api/mobile/v1/pages`**, which reads `public.published_pages()` — the same
function the website uses. The app keeps no page list of its own.

Consequences to check on a device, in this order:

1. **Before the web deploy**: the endpoint exists in the old build and returns the
   old list; the app works.
2. **After the deploy, before stage 1**: the endpoint answers
   `database_unavailable` (the tables do not exist yet) — the screen shows an error,
   not a crash. This is the state to avoid by applying the migrations first.
3. **After stage 1**: nine entries (About, Contact and seven policies). Tapping any
   of them must show the published text.
4. **After stage 2 / option B in `STAGE1_PAGE_REVIEW.md` §1.1**: nineteen entries.

The route tests (`android/app/src/test/kotlin/.../navigation/LegalRoutesTest.kt`)
prove the route pattern and slug safety; they cannot prove the endpoint returns what
the screen needs. That is a device test, listed below.

## 4. Signing and CI secrets — instructions only, no credentials invented

Nothing exists yet: no keystore, no Play Console entry, no upload key. Do **not**
generate one casually — a lost upload key means you can never update the app under
the same listing.

**What the build reads** (`android/app/build.gradle.kts`, environment only, never the
repository):

```
RELEASE_KEYSTORE_PATH        path to the .jks file on the build machine
RELEASE_KEYSTORE_PASSWORD
RELEASE_KEY_ALIAS
RELEASE_KEY_PASSWORD
```

**What CI reads** (`.github/workflows/android-apk.yml`):

```
ANDROID_RELEASE_KEYSTORE_BASE64     the keystore, base64-encoded, as a secret
ANDROID_RELEASE_KEYSTORE_PASSWORD
ANDROID_RELEASE_KEY_ALIAS
ANDROID_RELEASE_KEY_PASSWORD
```

The CI job only *checks whether those four secrets are non-empty* to print
`READY-TO-SIGN` / `BLOCKED`; it never signs. Sizes and the unsigned-artifact check are
in `docs/ANDROID_RELEASE_SIGNING.md` §1.

**Steps for the owner, when they decide to distribute** (full detail in
`docs/ANDROID_RELEASE_SIGNING.md`):

1. Create the upload keystore once, with `keytool`, choosing your own passwords;
   store it outside the repository and back it up in two places.
2. Add the four `ANDROID_RELEASE_*` repository secrets (Settings → Secrets and
   variables → Actions) with those values. Never commit the keystore or the
   passwords; never paste them into an issue, a chat or a document.
3. Bump `VERSION_CODE` in `android/version.properties` in the same commit as the
   change being released.
4. Produce the signed artifact on your own machine (the workflow does not sign):
   build `bundleRelease` with the four `RELEASE_*` variables exported, then verify
   with `apksigner verify --print-certs` / `jarsigner -verify`.
5. Keep the signed artifact and its `versionCode` recorded; Play Console requires a
   higher `versionCode` for every upload.

If any of this is done by someone else, they must be the holder of the key — the
repository is not the place for it.

## 5. Physical-device test cases for this release

None of these has ever been executed. Each is a claim waiting to be tested; mark
"not run" until someone runs it.

### Install and identity

| # | Case | Expected | Run |
|---|---|---|---|
| A1 | Install the debug APK on a clean device (Android 7.0 / API 24 minimum) | installs, launches to splash then sign-in | ☐ |
| A2 | Settings → Apps → version | `1.0.0`, package `com.maharanitraders.app` | ☐ |
| A3 | Install over an older build with a higher `versionCode` | installs and keeps the session | ☐ |
| A4 | Airplane mode, cold start | an explicit offline message, no crash, no blank screen | ☐ |

### Sign-in and session

| # | Case | Expected | Run |
|---|---|---|---|
| B1 | Retailer sign-in with a valid account | reaches the home shell | ☐ |
| B2 | Wrong password 3× | rate-limited / clear error, no crash | ☐ |
| B3 | Sign out, relaunch | returns to sign-in; no stale session | ☐ |
| B4 | Revoke the account (backend), relaunch | signed out cleanly | ☐ |

### Policies & information (the new surface)

| # | Case | Expected | Run |
|---|---|---|---|
| C1 | Open Help → Policies & information, before sign-in | the list loads (public endpoint) | ☐ |
| C2 | After stage 1 | exactly nine entries | ☐ |
| C3 | Tap Terms | title, effective date, v1.0, full text | ☐ |
| C4 | Tap Privacy | four sections, contact block | ☐ |
| C5 | Tap a page that is still a draft (e.g. Cookies after stage 1 only) | it is absent from the list — never an empty or broken screen | ☐ |
| C6 | Tap phone / email in a page | opens dialler / mail app with the right target | ☐ |
| C7 | Rotate the device on a page | text survives rotation, scroll position acceptable | ☐ |
| C8 | Back from a page | returns to the list, not to the dashboard | ☐ |
| C9 | Deep link `legal/terms` | opens the page directly | ☐ |

### The gates (only if the registry option changes)

| # | Case | Expected | Run |
|---|---|---|---|
| D1 | Retailer account with documents pending | acceptance card lists the required documents, each link opens a readable page | ☐ |
| D2 | Accept, then relaunch | pending count decreases, nothing re-prompts | ☐ |
| D3 | Seller invitation flow | agreement readable before accepting (requires `seller-agreement` to be published) | ☐ |

D3 is the case that fails today if stage 2 has not run: the seller agreement is
already registered for acceptance but its page is a draft.

## 6. What is blocked, and why

| Item | Blocked by |
|---|---|
| A signed retailer-installable APK | no upload key exists; it must be created by the owner, not invented |
| Play Console release | no Play Console entry, no developer account access from this environment; a new personal account also has a review wait |
| Any device or emulator evidence | none has been run — not in CI, not in this review. Every device table above is unticked |
| `/api/mobile/v1/pages` verified live | it cannot be until the migrations and stage 1 are applied and the app is deployed |

## 7. Honest summary for the report

The Android app is **buildable and testable today** (debug APK, manual CI dispatch),
**not distributable** (no key), and **not device-verified** (nothing has ever run on a
phone). Nothing in this release changes that status; what this release *does* change
is that the app's policy pages now depend on the website's published state, so the
order `migrations → stage 1 → deploy` protects the app as much as the website.

| Decision | Tick | Name | Date |
|---|---|---|---|
| Create the upload keystore and the four CI secrets | ☐ | | |
| Commission a device test pass (§5) | ☐ | | |
| Open a Play Console entry | ☐ | | |

Owner signature: ______________________  Date: ____________
