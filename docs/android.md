# Maharani Traders — Android App

The Android app is a **Capacitor remote-URL wrapper**: a native
Android shell whose WebView loads the existing production Next.js +
Supabase deployment. It is a mobile client for the existing platform —
**zero business logic is duplicated in Android**. Pricing, GST, MOQ,
credit, inventory, schemes, ordering, and every authorization decision
continue to run server-side exactly as on the web.

| | |
|---|---|
| App name | Maharani Traders |
| Package ID | `com.maharanitraders.app` |
| versionName | taken from `package.json` (`version`) |
| versionCode | GitHub Actions run number (monotonically increasing) |
| Web source | `server.url` in `capacitor.config.ts` |
| Debug output | `Maharani-Traders-debug.apk` (workflow artifact) |
| Release output | `Maharani-Traders-release.aab` (**unsigned**; produced once `docs/android-workflow-apk-aab.yml` is applied — see below) |

## Why remote-URL (not a bundled static export)

`next.config.mjs` has no `output: 'export'`, and the platform depends
structurally on Server Components, Server Actions (`'use server'`
files under `lib/**`), `middleware.ts` (role routing, approval gating,
session refresh), and the server-only Supabase service-role client.
None of that can run inside a WebView with no server behind it. The
correct, non-destructive conversion is to point the native WebView at
the already-deployed site. See `AUDIT_ANDROID.md`.

## Production URL — single place to change

`PRODUCTION_URL` in **`capacitor.config.ts`** is the single source of
truth (overridable per-build with the `CAP_SERVER_URL` env var). If
the domain changes, update it there **and** the matching `RETRY_URL`
constant in `www/offline.html`, then rebuild.

> **REQUIRED VERCEL SETTING** — the app currently points at
> `https://maharani-mart-mahakali108s-projects.vercel.app`. Vercel
> **Deployment Protection must be disabled for Production**
> (Project → Settings → Deployment Protection → "Only Preview
> Deployments" or "Disabled"). While it is enabled, Vercel redirects
> every visitor — including the Android WebView — to a Vercel SSO
> login, so neither the app nor retailers can reach the site. Note
> that the previously configured `maharani-mart-one.vercel.app` alias
> now returns `DEPLOYMENT_NOT_FOUND` and was replaced during this
> conversion.

## How it is built

The native `android/` project is **never committed** (see
`.gitignore`); the GitHub Actions workflow
`.github/workflows/android-apk.yml` regenerates it from scratch on
every run:

1. `npm install` → `npx cap add android` → `npx cap sync android`
2. The **`capacitor:sync:after` hook** (`scripts/android-postsync.mjs`,
   wired in `package.json`) then runs automatically — in CI *and* in
   local builds — and:
   - copies the pre-rendered brand icons + splash screens from
     `resources/android-res/` (committed, all densities: launcher /
     round / adaptive-foreground icons for mdpi…xxxhdpi, adaptive
     background color `#c8102e`, and every `drawable[-night]-land/-port`
     splash density, light + dark) into the native res folder. A plain
     recursive copy — no network, no native image tooling — so it
     cannot silently fail in CI, and no placeholder icon ships in any
     build. Source masters (1024×1024 icons, 2732×2732 splashes) also
     live in `resources/` for regeneration.
   - stamps `versionName` from `package.json` and `versionCode` from
     `$ANDROID_VERSION_CODE` (default `1`)
   - writes `MainActivity.java` with back-button-aware navigation:
     hardware/gesture back walks the WebView history (Product →
     Catalog → previous page; at the root it backgrounds the app — it
     never logs the user out)
3. `./gradlew assembleDebug` produces the debug APK.

> **Workflow permission note:** the automation that prepared this
> conversion cannot push changes under `.github/workflows/**` (GitHub
> App token without the `workflows` permission), so the improved
> workflow that ALSO builds the release AAB is committed at
> **`docs/android-workflow-apk-aab.yml`**. To activate it:
> `git mv docs/android-workflow-apk-aab.yml .github/workflows/android-apk.yml`
> and push. Until then CI produces the debug APK only.

Trigger: push to `main` touching Android-related paths, or manually
(`Actions → Run workflow`, or
`gh workflow run android-apk.yml --ref <branch>`). Download the
artifacts from the run page or `gh run download <run-id>`.

Local builds are also possible on a machine with JDK 17 + the Android
SDK: `npx cap add android && pnpm android:build:debug` (or
`pnpm android:build:release` for the unsigned AAB).

## Release signing (required before Play upload)

`Maharani-Traders-release.aab` is intentionally **unsigned** — no fake
or throwaway keystore is created, and no signing secret exists in the
repository or workflow. To publish to Google Play you must, one time:

1. Create a private upload keystore (keep it out of git — `*.keystore`
   / `*.jks` are already gitignored):
   `keytool -genkey -v -keystore maharani-upload.keystore -alias upload -keyalg RSA -keysize 2048 -validity 10000`
2. Either sign locally
   (`jarsigner -keystore maharani-upload.keystore Maharani-Traders-release.aab upload`)
   or add the keystore (base64) + passwords as GitHub Actions
   **secrets** and extend the workflow with a signing step.
3. Upload the signed AAB to the Play Console; enroll in Play App
   Signing when prompted.

## Offline handling

`server.errorPath = 'offline.html'` — when the production URL cannot
be loaded (no internet / server unreachable) the WebView shows the
branded local screen in `www/offline.html`: “No internet connection.
Please check your connection and try again.” with a Retry button and
auto-retry when the OS reports connectivity is back. No cart or order
action is ever faked offline; in-flight actions simply fail exactly as
they would in a browser and can be retried by the user.

## Authentication & deep links

Login is Supabase email/password via server actions with cookie-based
sessions (`@supabase/ssr`). Sessions are HTTP cookies inside the
WebView, so login state survives app restarts until the session
expires, and logout works exactly as on the web. **No OAuth providers
are configured**, so no custom Android redirect scheme / deep link is
required. Password-reset and email-confirmation links in emails point
at `NEXT_PUBLIC_SITE_URL` and open in the device browser — the user
completes the reset there and then signs in inside the app; this is
the existing production behaviour, unchanged.

## Camera / barcode

The web platform stores product barcodes (EAN/UPC) as **typed text
fields** (admin product form, pack manager). There is **no camera
barcode-scanning feature in the existing web app**, so the Android app
requests **no camera permission** and adds no scanner. If live
scanning is added to the web app later, add `@capacitor/barcode-scanner`
(or the MLKit plugin) and the `CAMERA` permission at that point — not
before.

## Push notifications

**Native push notification integration: pending.** The existing
notification system is in-app (Supabase-backed notification lists and
badges rendered by the web UI); it works unchanged inside the WebView.
No FCM / `@capacitor/push-notifications` integration exists, and none
was faked. Adding real push later requires a Firebase project,
`google-services.json`, the `@capacitor/push-notifications` plugin,
and a server-side sender.

## Security notes

- The APK/AAB contains **no secrets**: no Supabase service-role key,
  no database password, no AI provider key, no webhook secret. The
  bundled files are only `www/index.html`, `www/offline.html`, and the
  Capacitor runtime; the app is configuration + a URL. The Supabase
  anon key is not even bundled — it reaches the WebView the same way
  it reaches any browser, from the server-rendered site.
- All authorization stays server-side (middleware + RLS + server
  actions). Nothing in the Android layer can widen a role's access.
- `androidScheme: 'https'`, `cleartext: false`,
  `allowMixedContent: false` — no plaintext HTTP anywhere.
- The only Android permission used is `INTERNET` (Capacitor default).
