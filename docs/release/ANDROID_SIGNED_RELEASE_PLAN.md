# Android — signed build, exact secrets, device plan

**Prepared:** 16 November 2026. **No keystore was created, no APK was signed, no Play
Console action was taken, and no device run has ever happened.**
Runbook of record: `docs/ANDROID_RELEASE_SIGNING.md` (this document does not repeat
its size tables or its Play-account analysis — it points at them).

---

## 1. Where the build stands

| Fact | Value | Source |
|---|---|---|
| Application id | `com.maharanitraders.app` | `android/app/build.gradle.kts` |
| Version | `1.0.0`, `versionCode 1` | `android/version.properties` |
| SDK | minSdk 24, targetSdk 36, compileSdk 36 | build file |
| Default API base | `https://maharanitraders.vercel.app/` | build file |
| Debug APK | builds in CI on **manual** dispatch | `.github/workflows/android-apk.yml` |
| Release APK / AAB in CI | built **unsigned**, for size measurement only | same |
| Signing configured | yes, from four environment variables — none present | build file |
| Signed artifact | **none exists** | — |
| Play Console entry | **none** | — |
| Device / emulator run | **never** | — |

The workflow is deliberately `workflow_dispatch`-only: the product ships as a web PWA
and the native tree is maintained as a diagnostic path. That does not make a signed
build impossible — it makes it manual, which is the correct default for something that
needs a key.

---

## 2. Signed build — exact steps, no credentials invented

The build reads **environment variables only**; it never reads a keystore from the
repository:

```
RELEASE_KEYSTORE_PATH        absolute path to the .jks / .keystore on the build machine
RELEASE_KEYSTORE_PASSWORD
RELEASE_KEY_ALIAS
RELEASE_KEY_PASSWORD
```

CI *checks* four repository secrets (names only — values must never be committed,
pasted in chat, or added to a document):

```
ANDROID_RELEASE_KEYSTORE_BASE64      base64 of the keystore file
ANDROID_RELEASE_KEYSTORE_PASSWORD
ANDROID_RELEASE_KEY_ALIAS
ANDROID_RELEASE_KEY_PASSWORD
```

**Verified today:** all four are absent. The workflow prints
`BLOCKED — release keystore secrets not configured` and
`The release artifact in this run is UNSIGNED and must NOT be given to a retailer`.

### Steps (owner, once)

1. **Create the upload key** — exactly once, on a machine the owner controls, with
   their own passwords (`docs/ANDROID_RELEASE_SIGNING.md` §3 has the reviewed
   `keytool` invocation with `-validity 10950` and the backup rule). Never in this
   repository, never in CI.
2. **Back it up twice**, offline: an encrypted drive and a printed recovery sheet.
   Losing it means the app can never be updated on any device that installed it.
3. **Add the four `ANDROID_RELEASE_*` secrets** in GitHub → Settings → Secrets and
   variables → Actions. The base64 one is produced on the owner's machine from the
   keystore file.
4. **Bump `VERSION_CODE`** in the same commit as the change being released
   (`versionName` is derived from MAJOR.MINOR.PATCH, never hand-written).
5. **Build signed**, on the owner's machine (the workflow does not sign):

   ```bash
   cd android
   export RELEASE_KEYSTORE_PATH=/secure/path/maharani-release.keystore
   export RELEASE_KEYSTORE_PASSWORD=…      # owner's own value
   export RELEASE_KEY_ALIAS=maharani-release
   export RELEASE_KEY_PASSWORD=…
   ./gradlew assembleRelease bundleRelease
   "${ANDROID_HOME}/build-tools/36.0.0/apksigner" verify --print-certs \
     app/build/outputs/apk/release/app-release.apk
   ```

6. **Record** the artifact hash, `versionCode`, `versionName` and the certificate
   fingerprint in `docs/ANDROID_BUILD_VERIFICATION.md`.
7. **Only then** consider distribution. Play Store publication stays a separate,
   human-controlled step and is **out of scope for this release**.

---

## 3. Account and Help navigation — verified from the code

The native app reaches the policies from two places, both wired to the same managed
list — the app holds no policy text and no page list of its own:

| Entry point | Code | Route |
|---|---|---|
| Account tab → *About & policies* | `AccountScreen.kt` → `onOpenDestination(MaharaniRoutes.LEGAL)` | `legal` |
| Help → *Policies & information* | `AuthenticatedShell.kt` → `HelpScreen(onOpenLegal = …)` | `legal` |
| One document | `ManagedPageScreen` | `legal/{slug}` |

Backing evidence: `MaharaniRoutes.LEGAL` / `LEGAL_PAGE` in `MaharaniDestinations.kt`,
the composable registrations in `AuthenticatedShell.kt`,
`android/.../navigation/LegalRoutesTest.kt` (route pattern + slug safety), and
`GET /api/mobile/v1/pages`, which serves `published_pages()` — the same function the
website uses.

**Consequence for this release:** the app's list follows publication state. After
stage 1 it shows nine entries; after stage 2, nineteen. A draft is absent, never
empty and never a draft. That is by design and is the reason the deploy order in
`PUBLIC_PAGE_CONTINUITY.md` protects the app as well as the site.

---

## 4. Physical-device test plan

Every row is **untested**. Run against a debug build first (`adb install -r
app/build/outputs/apk/debug/app-debug.apk`) and, once a signed build exists, repeat
A1–A4 and C1–C9 against it — a debug build is not evidence about a release build.

### A. Install and identity

| # | Case | Expected |
|---|---|---|
| A1 | Clean install, Android 7.0 (API 24) and Android 15/16 | installs, launches, no crash |
| A2 | Settings → Apps → Maharani | version `1.0.0`, package `com.maharanitraders.app` |
| A3 | Install a build with a higher `versionCode` | installs, session survives |
| A4 | Install a build signed with a different key | fails with `INSTALL_FAILED_UPDATE_INCOMPATIBLE` (proof the key matters) |
| A5 | Airplane mode, cold start | explicit offline state, no blank screen |

### B. Sign-in and session

| # | Case | Expected |
|---|---|---|
| B1 | Retailer sign-in | reaches the home shell |
| B2 | Wrong password ×3 | rate-limited / clear error |
| B3 | Sign out, relaunch | sign-in screen, no stale session |
| B4 | Account deactivated server-side, relaunch | signed out cleanly |

### C. Policies and information (this release)

| # | Case | Expected |
|---|---|---|
| C1 | Help → Policies & information, before sign-in | list loads (public endpoint) |
| C2 | After stage 1 | exactly **9** entries |
| C3 | After stage 2 (or Plan A) | exactly **19** entries |
| C4 | Tap Terms | title, version 1.0, effective date, full text, contact block |
| C5 | Tap Privacy | four sections, contact block |
| C6 | Tap a stage-2 page during the gap | absent from the list — never an empty screen |
| C7 | Tap phone / email in a page | dialler / mail app with the right target |
| C8 | Rotate on a long page | text survives, no clipped content |
| C9 | Back from a document | returns to the list, not the dashboard |
| C10 | Deep link `legal/terms` | opens the document directly |
| C11 | Account tab → About & policies | same list as C1 (both entry points agree) |

### D. Acceptance (only if the registry option changes)

| # | Case | Expected |
|---|---|---|
| D1 | Retailer with pending documents | card lists them; each link opens a **readable** page |
| D2 | Accept, relaunch | pending count drops, no re-prompt |
| D3 | Seller invitation | agreement readable before accepting — fails today if stage 2 has not run |

---

## 5. What remains blocked

| Item | Blocked by | Owner action |
|---|---|---|
| Signed APK/AAB | no keystore, no secrets | §2 steps 1–5 |
| Play Store release | no Play Console entry, no developer account access here | out of scope |
| Device evidence | no device, emulator, JDK or Android SDK in this environment | commission the pass in §4 |
| `GET /api/mobile/v1/pages` verified live | migrations + stage 1 + deploy not done | follow `PUBLIC_PAGE_CONTINUITY.md` |

---

## 6. Approval

| Decision | Tick | Name | Date |
|---|---|---|---|
| Create the upload keystore and its two backups | ☐ | | |
| Add the four `ANDROID_RELEASE_*` secrets | ☐ | | |
| Run the device plan (§4) on a debug build | ☐ | | |
| Build and verify a signed artifact | ☐ | | |

Owner signature: ______________________  Date: ____________
