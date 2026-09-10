# Maharani Traders — Android Debug APK: download, install & smoke test

> This APK was built by the repo's own GitHub Actions workflow
> (`.github/workflows/android-apk.yml`) on GitHub-hosted runners, because the
> Arena sandbox network is locked to `github.com` + npm only (no JDK, no Android
> SDK, and the Google/Gradle/Maven and artifact-storage hosts are all blocked),
> so no Gradle build or install could run inside the sandbox.

## What was built

| Field | Value |
|---|---|
| APK file (inside the build) | `android/app/build/outputs/apk/debug/app-debug.apk` |
| APK type | **Debug** (signed with Gradle's auto-generated debug keystore — no production signing credentials) |
| Application ID / package | `com.maharanitraders.app` |
| App name | **Maharani Traders** |
| versionName / versionCode | `0.1.0` / `1` |
| Artifact size | 7,220,401 bytes (`maharani-traders-debug-apk` zip; the `.apk` inside unzips slightly smaller) |
| Build result | ✅ BUILD SUCCESSFUL (all workflow steps green) |
| Source commit | `0a8168c64dca6650000c10f9b1b3437b99a9c061` — the exact base of branch `arena/01a08c18-maharani-mart` |
| Exact build command | `npx cap add android && npx cap sync android && cd android && ./gradlew assembleDebug --no-daemon` |

## 1. Download the APK

- Open the successful run:
  <https://github.com/mahakali108/Maharani-mart/actions/runs/34497312237>
- Scroll to **Artifacts** → download **`maharani-traders-debug-apk`** (a zip).
- Unzip it → you get **`app-debug.apk`**.
- (Artifact does not expire until **2026-12-09**.)

## 2. Install on an Android phone

**Option A — sideload directly on the phone**
1. Copy `app-debug.apk` to the phone (USB, Drive, email, etc.).
2. Open it with the Files app → allow "Install unknown apps" for that app → **Install**.
3. Launch **Maharani Traders** from the app drawer.

**Option B — via `adb` from a computer (with USB debugging on)**
```bash
adb install -r app-debug.apk
# verify it's installed:
adb shell pm list packages | grep maharanitraders     # -> package:com.maharanitraders.app
# launch it:
adb shell monkey -p com.maharanitraders.app -c android.intent.category.LAUNCHER 1
```

## 3. Smoke-test checklist (maps to the build requirements)

Note: this is a **remote-URL Capacitor wrapper** — the WebView loads the live
production site. So it needs an internet connection; the branded offline screen
appears only if the server is unreachable.

- [ ] **Installs & launches** — app opens to the Maharani Traders login/home without crashing.
- [ ] **App name** — launcher label reads exactly **Maharani Traders**.
- [ ] **Mobile width** — layout renders at phone width with no content cut off.
- [ ] **No pinch zoom** — two-finger pinch does NOT scale the page.
- [ ] **No double-tap zoom** — double-tapping text/images does NOT zoom.
- [ ] **No page-level horizontal scroll** — you cannot swipe the whole page sideways at any screen width; only intentionally-scrollable wide tables scroll within their own box.
- [ ] **Safe areas** — top header and bottom nav are not hidden under the notch / status bar / gesture bar (content respects the insets).
- [ ] **Android back button** — hardware/gesture Back navigates within the app's history (e.g. Product → Catalog → previous page) and only backgrounds the app when there's no history left; it does NOT log you out.

If all boxes pass, the debug APK is verified for phone testing.
