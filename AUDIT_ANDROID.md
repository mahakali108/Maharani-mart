# Android/Capacitor compatibility audit

Performed before any files were changed, per the request. Findings:

## 1. Static export is not viable

`next.config.mjs` has no `output: 'export'`, and this project makes
heavy, structural use of things that cannot run as static files with
no server behind them:

- **Server Actions** — every `'use server'` file under `lib/**`
  (`lib/auth/actions.ts`, `lib/retailer/checkout-actions.ts`,
  `lib/admin/*-actions.ts`, etc.) — these execute on the server, not
  in the browser.
- **`middleware.ts`** — runs on every request to enforce role-based
  routing, retailer approval gating, and session refresh. Middleware
  does not run at all in a static export.
- **`lib/supabase/server.ts`** — cookie-based session handling via
  `next/headers`, plus a service-role admin client used for
  server-only operations (e.g. staff account creation). Both require
  a live Node server process.
- Numerous Server Components doing live Supabase queries per request
  (e.g. `app/retailer/catalog/page.tsx`, all of `app/admin/**`).

Attempting `output: 'export'` on this codebase would either fail the
build outright or silently break authentication, all server actions,
and most data fetching.

## 2. Conclusion: remote-URL Capacitor wrapper

Since the app is already deployed and working on Vercel, the correct
approach is a Capacitor **remote-URL wrapper** — a native Android
shell whose WebView loads the live production URL directly, via
`server.url` in `capacitor.config.ts`. This:

- Requires zero changes to the Next.js app, its routes, Supabase
  usage, or the Vercel deployment.
- Gets every feature "for free" exactly as it works on the web
  (login, RLS-governed queries, server actions, etc.) since it's
  literally the same server-rendered site, just inside a native app
  shell instead of a mobile browser tab.

**2026-08-28 update:** the original target URL
(`maharani-mart-one.vercel.app`) now returns `DEPLOYMENT_NOT_FOUND`.
The config was repointed at the current Vercel production alias
`https://maharani-mart-mahakali108s-projects.vercel.app`; Vercel
Deployment Protection must be disabled for Production for the app (or
any customer) to reach it — see docs/android.md.

## 3. Brand assets

Originally the repository contained zero image assets, so early debug
builds used Capacitor's placeholder icon. Real brand sources now live
in `resources/` (icon 1024×1024 + adaptive foreground/background,
splash 2732×2732 light/dark, brand red `#c8102e`), and the CI build
generates every required Android density from them via
`@capacitor/assets` — no placeholder icon ships in any build.

## 4. Everything else already works via the live site

Login, Supabase auth, retailer/admin/staff role routing, catalog,
product detail, cart, checkout, orders, alerts, and banners are all
existing, already-deployed features of the production site — since
the wrapper loads that site directly, none of them needed any
Android-specific code. What *did* need Android-specific handling
(back-button behavior) is implemented natively in `MainActivity.java`
by the GitHub Actions workflow — see `.github/workflows/android-apk.yml`.
