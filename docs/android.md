# Maharani Traders — Android Application

This document describes the Android client for the Maharani Traders /
Maa Kali B2B Wholesale & Distribution platform.

## 1. Architecture

The Android app is a **Capacitor remote-URL WebView wrapper** around the
existing Next.js + Supabase platform. It is *not* a rewrite of the
business logic.

- The native Android shell is a WebView that loads the **live production
  site** (`server.url` in `capacitor.config.ts`).
- Every feature — login, Supabase auth, role routing, catalog, cart,
  checkout, orders, GST/MOQ/credit/pricing, schemes, notifications,
  Maharani AI, admin/command-center — runs exactly as it does on the web,
  because the WebView is literally loading the same server-rendered app.
- No business logic is duplicated inside Android. The server (Vercel) and
  Supabase (with RLS) remain authoritative.

Reasoning for not using a static export is documented in `AUDIT_ANDROID.md`.

## 2. Application identity

| Item      | Value                          |
|-----------|--------------------------------|
| App name  | `Maharani Traders`             |
| Package   | `com.maharanitraders.app`      |
| Version   | `1.0.0` (versionCode `1`)      |

Versioning is applied by `android-assets/apply.sh` into
`android/app/build.gradle` (`versionCode` / `versionName`). For future
releases, bump `VERSION_NAME` / `VERSION_CODE` in `apply.sh`.

## 3. Production URL

The verified production domain is:

```
https://maharani-mart-mahakali108s-projects.vercel.app
```

It is stored in **one place**: `capacitor.config.ts` → `server.url`.
To change domains later, update that single value and rebuild. No web
code, Supabase config, or auth architecture needs to change.

> **Important — Vercel Deployment Protection.** As of this build the
> Vercel project has **Deployment Protection (Authentication)** enabled,
> so anonymous requests (including the Android WebView) receive a Vercel
> login challenge instead of the app. To make the Android app load the
> live site, disable "Deployment Protection" for Production in the Vercel
> project settings (Settings → Deployment Protection), or configure the
> WebView accordingly.

## 4. Authentication

Login, logout, session persistence and expiry all use the existing
Supabase auth flow through the live site. The WebView keeps the cookie
session, so the app stays logged in across restarts until the session
expires.

- **No secrets are bundled.** The APK/AAB contain only the public client
  config used by the web app (`NEXT_PUBLIC_*`). The Supabase service-role
  key, database password, AI keys, webhook secret and Turso token are
  server-only environment variables and never appear in Android.
- **Role isolation is server-side** (`middleware.ts`, `profiles` RLS,
  server layouts). A user cannot select an unauthorized role by changing
  client state. The Android app does not alter this.

### Email-confirmation / OAuth redirects

The production site performs its auth callback at
`NEXT_PUBLIC_SITE_URL/auth/callback` in a normal browser. The Android
WebView shares that web session for password login. Email-confirmation
links opened in an external browser will authenticate that browser, not
the in-app WebView — a known limitation of any remote-URL WebView
wrapper. Password login works fully in-app. Deep-link handling for
OAuth/email flows is **not** implemented because changing the production
auth redirect behavior is out of scope (per the build instructions) and
the current flows do not require it.

## 5. Back-button handling

`MainActivity.java` (written by the CI workflow, not committed) makes the
Android back button navigate the WebView's own history first, and only
exit the app at the root. This means: product → catalog → previous page,
and modal → close modal all behave as expected, and pressing back at the
root of the app does not log the user out.

## 6. Icons and splash

Branded assets live in `android-assets/` and are applied by
`android-assets/apply.sh` (run in CI after `npx cap add android`):

- **Launcher icons** at all densities (`mdpi` 48, `hdpi` 72, `xhdpi` 96,
  `xxhdpi` 144, `xxxhdpi` 192) plus adaptive-icon foregrounds and a solid
  blue background.
- **Splash screen**: a white layer-list with a centred Maharani Traders
  logo. On Android 12+ the androidx `SplashScreen` shows the circular
  mark. No fake progress, no animation — it is dismissed as soon as the
  WebView paints the production site.

## 7. Camera / barcode

Barcode/EAN scanning is handled by the existing web app when it uses it.
If/when the web app gains an in-page scanner that requires native camera
access, the matching Capacitor plugin (`@capacitor/camera`) and the
`CAMERA` permission can be added. Currently the Android manifest only
requests `INTERNET` — **no unnecessary permissions are requested.**

## 8. Notifications

The web app has in-app notifications, which work in the Android app
because it loads the live site. **Native push notifications are not
implemented** (no FCM). Implementing them is documented as pending — see
"Native push integration (pending)" below. In-app notifications are not
broken by the wrapper.

## 9. Network / offline

Because this is a remote-URL wrapper, when the device is offline the
WebView cannot reach the server and the browser's network error appears;
no order or cart action can be silently faked. A richer custom offline
banner would require an in-app service-worker / local fallback layer,
which is out of scope for the wrapper and is documented as pending.

## 10. Native push integration (pending)

- **Native push notifications: PENDING.** Requires Firebase Cloud
  Messaging (`google-services.json` + the FCM Capacitor plugin + a server
  token sender). This is not invented; it will be added as a separate
  task with its own credentials.
- **Custom offline screen: PENDING.** Requires a local cache/service
  layer that intercepts the WebView before the remote URL loads.

## 11. Building

Local Gradle builds need the Android SDK + JDK 17, and network access to
Google Maven / Maven Central. In this sandbox those egress hosts are
blocked, so builds are run on **GitHub Actions**.

### The full build workflow (activated in CI)

The complete, upgraded workflow (builds the debug APK **and** the release
AAB, applies the branded icons/splash via `android-assets/apply.sh`, and
renames outputs to `Maharani-Traders-debug.apk` /
`Maharani-Traders-release.aab`) is provided as a reference file:

```
docs/android-build.workflow.yml
```

> **Why it is not yet in `.github/workflows/`:** the automation account
> used to make these changes does **not** have GitHub `workflows`
> permission, so GitHub refused to let it create or update
> `.github/workflows/android-apk.yml` (a hard GitHub App permission
> limit). To activate the full build, copy/merge the contents of
> `docs/android-build.workflow.yml` into
> `.github/workflows/android-apk.yml` using an account that has
> `workflows` permission on the repo, then run it.

```bash
# one-time trigger (any branch)
gh workflow run android-apk.yml --ref <branch>

# watch / download artifacts
gh run watch
gh run download <run-id>
```

### The pre-existing workflow (still on the branch)

The repository's original `.github/workflows/android-apk.yml` (from
`main`) is unchanged. It builds a **debug APK** only, reads
`capacitor.config.ts` from the checked-out branch (so it picks up the
correct production URL), and does **not** apply the custom branding or
build the AAB. It can be dispatched on this branch to produce a real,
correctly-configured debug APK while the upgraded workflow is being
activated.

### Signing

- The **debug APK** is signed with Gradle's auto-generated debug keystore.
- The **release AAB** is built **unsigned**. To publish to Google Play
  you must sign it with a Play App Signing keystore. Required (not
  included, never committed):
  1. A release keystore (`.jks`) and its password/aliases — store in a
     secret, e.g. `ANDROID_RELEASE_KEYSTORE` / `ANDROID_RELEASE_KEYSTORE_PASSWORD`.
  2. Add a `signingConfigs { release { ... } }` block to
     `android/app/build.gradle` referencing those secrets.
  3. Configure **Play App Signing** in the Google Play Console.
  Keystores and passwords must never be committed to the repository.

## 12. Security

- Secrets exposed in APK/AAB: **NO** (verified — only public config).
- Service-role key exposed: **NO**.
- No client-side authorization bypass: role enforcement stays server-side.
- Android manifest requests only `INTERNET`.

## 13. Verification

Web: `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`
all pass. Android builds are produced by the CI workflow (see the main
report for artifact paths and status).
