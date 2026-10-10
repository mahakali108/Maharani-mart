# Android release signing and distribution — Maharani Traders

**Status: BLOCKED on a real upload key. Nothing described here has been published or distributed.**

This is the runbook for turning the committed native project into an artifact a
shopkeeper can actually install, and the honest record of what still requires a
human being with credentials this repository must never contain.

It covers both channels the launch may use:

- **Direct APK** — sideloaded / shared with retailers. Achievable for 11 Oct 2026.
- **Google Play** — AAB through Play Console. **Not achievable for 11 Oct 2026 on a
  new personal developer account** — see §6 for the dated reason.

Guarded by `tests/android-release-versioning.test.ts`, which asserts the build
file, the CI workflow, `.gitignore` and this document stay in agreement.

---

## 1. Where the release actually stands today

| Fact | Status | Evidence |
| --- | --- | --- |
| Native Kotlin + Compose project, no WebView/Capacitor/PWA wrapper | **YES** | `tests/production-readiness.test.ts` §6 asserts the wrapper files stay deleted |
| Debug APK built and identity-verified in CI | **YES** | `aapt dump badging` → `package: name='com.maharanitraders.app'` |
| Release APK/AAB built by CI | **YES, but UNSIGNED** | built only to measure size; Gradle names it `app-release-unsigned.apk` |
| Release signing configured in the build | **YES** | `android/app/build.gradle.kts` reads four env vars |
| Signing material present in CI | **NO** | the four `ANDROID_RELEASE_*` secrets are not set |
| Signed, distributable artifact | **NO — BLOCKED** | no upload key exists; one must not be invented |
| Installed and used on a physical device | **NO — BLOCKED** | no device, emulator, JDK or Android SDK in the review sandbox |
| Play Console entry | **NO — not started** | no account access from this environment |

**An unsigned release APK is not a release.** Android refuses to install it
(`INSTALL_PARSE_FAILED_NO_CERTIFICATES`), and describing it as retailer-ready
would be false. CI now says so explicitly in the job summary rather than leaving
the artifact to be mistaken for a finished one.

### Measured artifacts (CI run 37959400861, head `d6ec741`)

Exact bytes, measured on the runner — not compressed ZIP sizes:

| Artifact | Bytes | Decimal MB | ≤ 30 MB target | Signing |
| --- | ---: | ---: | --- | --- |
| `app-debug.apk` | 16,371,253 | 16.37 | PASS | Gradle debug key — never distributable |
| `app-release-unsigned.apk` | 2,849,725 | 2.85 | PASS | **UNSIGNED — not distributable** |
| `app-release.aab` | 6,409,691 | 6.41 | PASS | **UNSIGNED — not distributable** |

The release APK shrank 12 bytes against the previously recorded 2,849,737, which
is the `versionName` change from `1.0.0-phase-b` to `1.0.0`. No code, dependency,
ABI or resource was removed to reach these numbers.

`applicationId` is asserted as `com.maharanitraders.app` by `aapt dump badging`,
and `versionName`/`versionCode` are now read back out of the artifact and
compared with `android/version.properties` (§2).

---

## 2. Version policy

`android/version.properties` is the **single source of truth**. The Gradle build
derives both values from it, so they cannot disagree:

```
versionName = "$VERSION_MAJOR.$VERSION_MINOR.$VERSION_PATCH"
versionCode = $VERSION_CODE
```

There is deliberately no way to hand-write a `versionName` in the build file. The
literal it replaced still read `1.0.0-phase-b` long after Phase B ended — exactly
the "must not ship" item in `docs/ANDROID_RELEASE_CHECKLIST.md` §1.

Current values: **versionName `1.0.0`, versionCode `1`**. Correct for the first
public release, because nothing has ever been distributed to a retailer before
it. If any build was ever installed on a real device outside CI, raise
`VERSION_CODE` above that build's code **before** releasing, or those devices
cannot update.

Rules:

| Rule | Why |
| --- | --- |
| `VERSION_CODE` strictly increases by 1 per release | A device offered a build whose code is ≤ the installed one refuses the update (`INSTALL_FAILED_VERSION_DOWNGRADE`). Play rejects a reused code outright. |
| Never derive the code from a date or CI run number | Both can repeat or go backwards; the code must be monotonic forever. |
| Bump the code in the same commit as the change being released | The artifact and its version move together, so a cherry-pick cannot ship stale numbers. |
| `versionName` is always plain `MAJOR.MINOR.PATCH` | No `-rc1`, `-beta`, `-SNAPSHOT`, `-phase-x`. A pre-release marker on a shopkeeper's phone is how a test build gets mistaken for a launch build. |
| Pre-release identity lives in the channel, not the string | Use the internal testing track, or a debug build, or an `applicationIdSuffix` — never the version a retailer reads. |
| `MAJOR` breaking workflow/API change · `MINOR` new feature · `PATCH` fix only | Standard semver, so release notes can be written from the diff. |

CI does not trust the properties file: the `Verify artifact version against the
declared version policy` step reads `versionCode`/`versionName` back **out of the
built APK** with `aapt dump badging` and fails on any mismatch.

---

## 3. Create the upload key (human step, one time)

Run this on a machine you control. **Never** in the repository, never in CI logs,
never in a chat message.

```bash
keytool -genkeypair -v \
  -keystore maharani-release.keystore \
  -alias maharani-release \
  -keyalg RSA -keysize 4096 \
  -validity 10950 \
  -dname "CN=Maharani Traders, O=Maharani Traders, L=Khagaria, ST=Bihar, C=IN"
```

- `-validity 10950` is ~30 years. Android requires a signing certificate valid
  beyond 2033; a key that expires strands every installed device.
- Keep **two** offline backups (encrypted drive + printed recovery sheet in a
  safe). Losing this key means the app can never be updated again — not "is
  inconvenient", but *cannot be updated*, on every device that has it.
- Store it outside the repository. `.gitignore` already blocks `*.keystore`,
  `*.jks`, `*.pem` and `local.properties`; `tests/android-release-versioning.test.ts`
  additionally walks `android/` and fails if any key-shaped file appears, and
  checks `git ls-files` for the same.

Then base64-encode it for CI:

```bash
base64 -w 0 maharani-release.keystore > keystore.b64   # Linux
base64 -i maharani-release.keystore | tr -d '\n' > keystore.b64   # macOS
```

---

## 4. Configure CI (human step)

Add these four repository secrets — Settings → Secrets and variables → Actions →
New repository secret. The names are exact; the build and the workflow both read
them.

| Secret | Value |
| --- | --- |
| `ANDROID_RELEASE_KEYSTORE_BASE64` | the single-line base64 from §3 |
| `ANDROID_RELEASE_KEYSTORE_PASSWORD` | the keystore password |
| `ANDROID_RELEASE_KEY_ALIAS` | `maharani-release` (or whatever `-alias` you used) |
| `ANDROID_RELEASE_KEY_PASSWORD` | the key password |

What happens automatically once they exist — no code change needed:

1. `Decode the release keystore when CI secrets provide one` writes the key to
   `/tmp/maharani-signing/release.keystore`, **outside the workspace**, mode
   `600` inside a mode-`700` directory, so it can never be committed or picked up
   by an artifact path. A malformed base64 secret fails loudly instead of signing
   with an empty file.
2. `Build the SIGNED release APK and AAB` re-runs `assembleRelease bundleRelease`
   with `RELEASE_KEYSTORE_PATH`, `RELEASE_KEYSTORE_PASSWORD`, `RELEASE_KEY_ALIAS`
   and `RELEASE_KEY_PASSWORD` in the environment — the exact four variables
   `android/app/build.gradle.kts` already reads.
3. `Verify the signed artifact with apksigner` asserts `app-release.apk` exists
   (Gradle only uses that name when signing is applied — an unsigned build is
   `app-release-unsigned.apk`), that `apksigner verify` prints `Verifies`, and
   that APK Signature Scheme **v2** is used. Only the public verdict, scheme
   lines, signer count and certificate SHA-256 digest are published.
4. `Destroy the decoded keystore` runs with `if: always()` and removes
   `/tmp/maharani-signing`.

**Before those secrets exist, every step above is skipped and the job behaves
exactly as it does today.** The summary reports `Signed release: BLOCKED — no
signing material is configured`, naming the missing secrets.

No secret value is ever echoed. Each is consumed through a step-level `env:`
block, and `tests/android-release-versioning.test.ts` fails if anyone ever
interpolates one into an `echo`/`printf`.

### Signing locally

```bash
export RELEASE_KEYSTORE_PATH=/absolute/path/maharani-release.keystore
export RELEASE_KEYSTORE_PASSWORD=…
export RELEASE_KEY_ALIAS=maharani-release
export RELEASE_KEY_PASSWORD=…
cd android && ./gradlew assembleRelease bundleRelease
"${ANDROID_HOME}/build-tools/36.0.0/apksigner" verify --print-certs \
  app/build/outputs/apk/release/app-release.apk
```

With the variables unset the build prints `Maharani release signing is NOT
configured …` and produces an unsigned artifact. That message names the
variables and never interpolates a value.

---

## 5. Direct APK distribution (achievable for 11 Oct 2026)

Use this channel if Play cannot complete its testing window in time (§6). It is a
real distribution channel, not a workaround, but every safeguard Play would have
provided is now yours.

**Requirements**

- [ ] Signed with the §3 key, verified by `apksigner verify` — never the Gradle
      debug key. A debug-signed build is trivially re-signable by anyone and must
      never leave CI.
- [ ] `BuildConfig.API_BASE_URL` points at `https://maharanitraders.vercel.app/`.
      `ApiBaseUrlContract` already rejects plain `http` for release builds and
      refuses the retired Vercel aliases, so a misconfigured host fails the build
      rather than silently downgrading the transport.
- [ ] HTTPS only, no cleartext traffic permitted in the release manifest.
- [ ] No debug-only configuration, no test data, no seeded catalogue.
- [ ] `versionCode` higher than anything previously handed out.

**Distribution**

- [ ] Serve the APK over HTTPS only (never a chat attachment that can be
      re-uploaded, never an unverified mirror).
- [ ] Publish the SHA-256 checksum alongside it and tell retailers how to check
      it. This is the only defence against a tampered copy.
- [ ] Keep every released APK and its checksum forever. You cannot produce a
      diff for an incident you cannot reproduce.

**Installation guidance for retailers** (write it in Hindi and English):

1. Open the link in Chrome on the phone.
2. Android will warn that the file may be harmful — this is normal for any app
   not installed from Play. Tap **Download anyway**.
3. Open the download. Android asks to allow **Install unknown apps** for Chrome —
   allow it, then return and tap **Install**.
4. On first launch, sign in with the same mobile number or email and password
   used on the website.

**Update strategy** — this is the part most often missed:

- There is no automatic update. Every release must be re-distributed and
  re-installed by hand.
- The new APK must have a **higher `versionCode`** or the install is refused.
- Signing must use the **same key**. A different key means Android treats it as a
  different app: the update fails, and the retailer must uninstall first — losing
  any locally cached session.
- Announce updates through the existing in-app notification feed and the WhatsApp
  channel, and state the version name so support can tell which build a retailer
  is on.
- Plan for old versions staying in the field indefinitely: the backend must keep
  serving the API contract older clients expect, or those shops stop ordering.

**Rollback**: re-distribute the previous APK. It will only install over a *lower*
versionCode, so a rollback means asking retailers to uninstall the bad build
first. This is a strong argument for testing each release on real devices before
distribution — which is currently BLOCKED (§7).

---

## 6. Google Play distribution

### The dated blocker

Google Play's target-API rule took effect **31 August 2026**: new apps and app
updates must target **Android 16 (API level 36)** or higher, with extensions
available only to **1 November 2026**
([HighCircl](https://www.highcircl.com/en/blog/google-play-target-api-36-deadline-2026),
[Creuto](https://creuto.com/target-api-level-36-google-play-deadline),
[OMA/Google policy summary](https://orangeoma.zendesk.com/hc/en-us/articles/21001579350172-Google-Play-s-Target-API-level-requirements-for-2026)).

**This project already complies**: `android/app/build.gradle.kts` sets
`compileSdk` 36 and `targetSdk` 36, and `android/gradle/libs.versions.toml` pins
AGP 9.0.1 / Gradle 9.1.0 / JDK 17 for exactly that reason. Target API is *not*
the blocker.

The blocker is the **closed-testing requirement**. A **personal** developer
account created after **13 November 2023** must run a closed test with at least
**12 testers opted in continuously for 14 days** before it can even *apply* for
production access; internal testing does not count
([Testers Community](https://www.testerscommunity.com/blog/google-play-closed-testing-requirements-2026),
[PrimeTestLab](https://primetestlab.com/blog/google-play-closed-testing-statistics)).
After qualifying, the production-access decision takes about 48 hours and
production review up to 7 more days
([publishing guide](https://www.testerscommunity.com/guides/publish-app-google-play)).

Counting back from **11 October 2026**, a 14-day closed test had to be live by
roughly **27 September 2026**. Today is 9 October 2026.

> **For a new personal Play account, a Play production launch on 11 October 2026
> is not achievable.** The window has already closed. This is a scheduling fact,
> not a code defect, and no amount of engineering here changes it.

The options, in order of practicality:

| Option | Viable for 11 Oct? | Notes |
| --- | --- | --- |
| Direct APK distribution (§5) | **YES** | The only channel that can make the date. |
| Play **internal** or **closed** testing track on 11 Oct | **YES, but not production** | Retailers opt in via a link; not a public listing. Needs a signed AAB (§4). |
| Play **production** on 11 Oct, new personal account | **NO** | 14-day closed test window has passed. |
| Play **production** on 11 Oct, organization account or personal account created before 13 Nov 2023 | **POSSIBLE** | Exempt from the closed-test rule; still needs account verification, store listing, all compliance forms, and review time. |

**Which account type exists is a question only the maintainer can answer.** It is
the single fact that decides whether Play is reachable for the launch date.

### Full Play checklist

Store and policy (these block the release *after* testing, so complete them
early — [reference](https://github.com/KingNarmar/horus_system/issues/199)):

- [ ] Organization or personal Play Console account, identity verified, $25 fee paid.
- [ ] **Android App Bundle** (.aab), not APK — new apps must publish as AAB.
- [ ] **Play App Signing** enrolled. The §3 key becomes the *upload* key; Google
      holds the *app signing* key. They are not the same key, and the upload key
      can be rotated without stranding devices.
- [ ] **Data safety** form, completed from the app's real data flows. This app
      collects a retailer's name, shop name, phone, address, order history and
      credit/Coins balance; it sends none of it to a third-party analytics SDK.
      Declare exactly that — do not claim encryption or deletion behaviour that
      has not been verified.
- [ ] **Privacy policy URL**, and the policy reachable in-app.
- [ ] **Account deletion**: this app creates accounts, so Play requires both an
      external deletion URL and an in-app deletion path. The existing
      account-request flow records a request for staff and never self-executes a
      deletion (`lib/retailer/profile-actions.ts`) — confirm that satisfies the
      current requirement before submitting.
- [ ] **Content rating** (IARC) questionnaire.
- [ ] **Target audience** and app category.
- [ ] Store listing: app name, short and full description, 512×512 icon,
      1024×500 feature graphic, ≥2 phone screenshots.
- [ ] Support contact and an incident runbook.
- [ ] Staged rollout plan: internal → closed → production percentage → 100%.
- [ ] Rollback plan: the previous AAB stays downloadable, and Play can halt a
      staged rollout.

Technical, already satisfied and worth re-verifying on the signed artifact:

- [x] `targetSdk = 36`, `compileSdk = 36`, `minSdk = 24`.
- [x] `applicationId = com.maharanitraders.app`.
- [x] R8 full mode + resource shrinking; `proguard-rules.pro` keep rules.
- [x] `lint { abortOnError = true }` — lint errors fail the build.
- [ ] Android 16 behaviour changes exercised on a real device: edge-to-edge
      insets (apps targeting 36 can no longer opt out) and predictive back.
      **BLOCKED** — no device.
- [ ] **16 KB page-size alignment — NOT VERIFIED, and it does apply.** Measured
      from the actual CI artifact, the app ships **8 native libraries** across
      four ABIs (`arm64-v8a`, `armeabi-v7a`, `x86`, `x86_64`), two each:
      `libdatastore_shared_counter.so` (androidx.datastore) and
      `libandroidx.graphics.path.so`. Devices running Android 15+ may use 16 KB
      memory pages, and an unaligned `.so` fails to load there. Verify with
      `zipalign -c -P 16 -v 4 app-release.apk`, or read the Play Console
      pre-launch report, before distributing. Do not assume compliance because
      the libraries come from AndroidX.

---

## 7. What is BLOCKED, and exactly why

| Gate | Status | Blocker |
| --- | --- | --- |
| Signed release artifact | **BLOCKED** | No upload key exists. One must not be invented or fabricated: a generated-in-CI key would be a *different* key from any future real one, and every device that installed it could never be updated again. |
| Install and launch on a device | **BLOCKED** | The review sandbox has no JDK, no Android SDK, no `adb` and no emulator. |
| Real-device navigation at 360/393/412 dp | **BLOCKED** | Same. Rendered Compose tests at those widths exist and pass, but a JVM-rendered test is not a device. |
| Session restore after process death / force-stop | **BLOCKED** | Needs a real Keystore and a real account lifecycle. `SessionManagerTest` proves the store contract, not the device behaviour. |
| Play Console submission status | **BLOCKED** | No Play Console access from this environment. |
| Live production HTTP verification | **MOVED TO CI** | The sandbox cannot reach `maharanitraders.vercel.app`. `.github/workflows/production-health.yml` runs the probe on a runner that can, and publishes status/latency/timestamp evidence. |

### Manual test checklist for whoever has a device

Run these against the **signed release** build, not a debug build, and record the
result next to each line. A CI green run is not a substitute for any of them.

1. **Install** the signed APK on a retail-grade Android phone (API 24 and API 36
   if available). Confirm no "unknown source" failure and no signature warning.
2. **Login** with a real approved retailer account. Confirm the catalogue loads
   with that retailer's own prices.
3. **Cold start** after force-stop. Confirm the session restores without
   re-entering the password, and that the cart badge is correct.
4. **Token refresh**: leave the app backgrounded past the access-token expiry,
   then return. Confirm no forced logout and no duplicated request.
5. **Search** a real product name, a barcode and a pack name. Confirm each
   resolves, and that a failed search reports a failure rather than "no results".
6. **Category and brand** created by an admin minutes earlier appear in the app
   with no reinstall — this is the Admin → DB → API → app path.
7. **Add to cart** at MOQ and below MOQ. Confirm the server rejects the below-MOQ
   quantity and the app surfaces the reason.
8. **Checkout** with a coupon and Coins redemption. Confirm the totals on screen
   match the server quote exactly, and match the website for the same basket.
9. **Place the order**, then confirm it appears in Orders with the right status,
   and that the website shows the same order.
10. **Cancel** an order that is still cancellable; confirm the Coins/credit
    reversal appears in the ledger.
11. **Logout**, then log in as a *different* retailer. Confirm none of the first
    retailer's cart, orders, favourites, addresses, Coins or notifications
    survive — this is the private-domain isolation check.
12. **Rotate the device** and change the system font scale to largest. Confirm no
    clipped price, no overlapping MOQ/quantity row, and every tap target still
    works.
13. **Offline**: enable airplane mode mid-session. Confirm a clear offline state,
    no crash, and no silently-lost cart mutation.
14. **Update**: install the next versionCode over the top. Confirm the session and
    cart survive and no uninstall was needed.

---

## 8. Never do these

- Never commit a keystore, a password, a `.jks`, or a base64 key to the repository
  — including in a "temporary" commit. History is forever.
- Never sign a distributed build with the Gradle debug key.
- Never hand an unsigned release artifact to a retailer or call it a release.
- Never reuse a `versionCode`.
- Never re-sign an app with a different key and expect existing installs to update.
- Never publish a Data safety or privacy claim that has not been verified in code.
- Never claim the app is "published" until a retailer can actually obtain it.
