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

Since the app is already deployed and working at
`https://maharani-mart-one.vercel.app`, the correct approach is a
Capacitor **remote-URL wrapper** — a native Android shell whose
WebView loads that live URL directly, via `server.url` in
`capacitor.config.ts`. This:

- Requires zero changes to the Next.js app, its routes, Supabase
  usage, or the Vercel deployment.
- Gets every feature "for free" exactly as it works on the web
  (login, RLS-governed queries, server actions, etc.) since it's
  literally the same server-rendered site, just inside a native app
  shell instead of a mobile browser tab.

## 3. No existing logo/icon asset

Searched the entire repository (`find . -iname "*.svg" -o -iname
"*.png" -o -iname "*.jpg" -o -iname "*.ico"`, excluding
`node_modules`) — **zero image assets exist anywhere**, including
`public/logos/` (contains only a `.gitkeep`). Per instruction, no
brand logo was invented. The debug APK will use Capacitor's default
placeholder launcher icon until a real logo file is provided — see
the main report for what's needed to wire in a real one.

## 4. Everything else already works via the live site

Login, Supabase auth, retailer/admin/staff role routing, catalog,
product detail, cart, checkout, orders, alerts, and banners are all
existing, already-deployed features of the production site — since
the wrapper loads that site directly, none of them needed any
Android-specific code. What *did* need Android-specific handling
(back-button behavior) is implemented natively in `MainActivity.java`
by the GitHub Actions workflow — see `.github/workflows/android-apk.yml`.
