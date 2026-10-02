# Android/Capacitor compatibility audit — SUPERSEDED

> **This document is obsolete and is kept only for history.**
>
> It concluded that a **Capacitor remote-URL WebView wrapper** was the correct
> Android approach. That conclusion has been **reversed**: the project
> requirement is a real native Android application, and a WebView shell that
> loads the production website is explicitly not acceptable as the app.
>
> The wrapper has now been **retired** — `capacitor.config.ts`, `www/`,
> `scripts/android-postsync.mjs`, `scripts/android-resource-validation.mjs`,
> the `cap:*` npm scripts and the `@capacitor/*` dependencies are gone, and the
> active CI workflow builds the native project.

**Read instead:**

| Document | Purpose |
| --- | --- |
| [`docs/ANDROID_IMPLEMENTATION_PLAN.md`](docs/ANDROID_IMPLEMENTATION_PLAN.md) | current audit, verified state, risks, file-by-file plan, honest status |
| [`docs/NATIVE_ANDROID_API_CONTRACT.md`](docs/NATIVE_ANDROID_API_CONTRACT.md) | the `/api/mobile/v1` contract the app uses |
| [`docs/NATIVE_ANDROID_MIGRATION_AUDIT.md`](docs/NATIVE_ANDROID_MIGRATION_AUDIT.md) | feature-by-feature page classification |
| [`docs/NATIVE_ANDROID_MIGRATION_PLAN.md`](docs/NATIVE_ANDROID_MIGRATION_PLAN.md) | phases A–H and toolchain evidence |

---

## Why the original analysis was still partly right

Three findings in this file remain valid and are preserved:

1. **`next.config.mjs` has no `output: 'export'`, and the app is structurally
   server-dependent** — Server Components, 40+ `'use server'` modules,
   `middleware.ts`, and `lib/supabase/server.ts`'s cookie sessions plus a
   service-role admin client. A *bundled static export inside a WebView* is not
   viable. That is still true, and it is exactly why the native app uses the
   server's HTTP API (`/api/mobile/v1`) rather than bundling the site.
2. **No brand logo/icon asset existed at the time.** The launcher icons now
   committed under `android/app/src/main/res/mipmap-*` are the app's real icons.
3. **Back-button behaviour must be handled natively.** In the native app this is
   ordinary Navigation Compose back handling — no `WebView.canGoBack()` shim.

## What was wrong

The jump from "static export is not viable" to "therefore embed the live website
in a WebView" treated *the website in a shell* as equivalent to *a native app*.
It is not: it ships a browser chrome experience, cannot use native navigation,
notifications, camera or file pickers properly, and cannot be reviewed as a real
Android application. The correct path — a native client over a versioned,
authenticated HTTP API, reusing the same Supabase database, RLS policies and
server-side business rules — is what the project now does.
