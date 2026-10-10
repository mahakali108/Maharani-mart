# PWA launch verification — 10 October 2026

Scope: the Next.js web app as an installable PWA. The Android APK pipeline was
not needed for any of this work and was not used.

Base: `main` @ `0312a03` (merge of PR #100). Working branch
`arena/1969f2a4-maharani-mart`. The working tree was clean when the audit started.

Status labels: **VERIFIED** (executed, result recorded), **FIXED** (defect found
and fixed with a test that fails on the old code), **BLOCKED** (cannot be
verified here; exact next step given), **NOT CHANGED** (reviewed, deliberately
left alone).

## 1. Repository and PR state (audited, not assumed)

| Item | Finding | Status |
|---|---|---|
| Base commit | `0312a03`, same as `origin/main` at audit time | VERIFIED |
| PR #99 | Merged into PR #100 history; not an open PR | VERIFIED |
| PR #100 | Merged (launch gate, production probe, Android version policy) | VERIFIED |
| PR #101 | Open. Its *Web typecheck, lint, tests, and build* job did **not run**: the annotation reads "The job was not started because recent account payments have failed or your spending limit needs to be increased." This is an Actions billing block, not a code failure. | BLOCKED (billing) |
| Production URL | `https://maharanitraders.vercel.app` (from `production-health.yml`). From this sandbox the TLS handshake fails (`SSL_ERROR_SYSCALL`); egress is restricted to GitHub and package registries. | BLOCKED (sandbox egress) |

## 2. Local gates on the final tree

| Check | Result |
|---|---|
| `pnpm install --frozen-lockfile` | VERIFIED (lockfile consistent) |
| `pnpm typecheck` | VERIFIED — 0 errors |
| `pnpm lint` | VERIFIED — 0 errors; 1 pre-existing warning (`<img>` in `components/admin/product-image-manager.tsx`) |
| `pnpm test` | VERIFIED — **120 files / 2238 tests, all passing** (baseline on `main`: 116 files / 2207 tests) |
| `pnpm build` | VERIFIED — `next build` succeeds (run twice: before and after the service-worker fix) |

## 3. Fixes in this change

### 3.1 Service worker never registered (FIXED)
- **Root cause.** `ServiceWorkerRegister` waited only for the window `load` event.
  The app-router scripts are `async` and hydrate after `load`, so the listener
  never fired. Confirmed in headless Chromium: zero service-worker registrations
  on `/login`.
- **Impact.** No service worker meant no offline page and no browser install
  prompt. Chromium needs a registered service worker with a fetch handler before
  it fires `beforeinstallprompt`.
- **Fix.** Register immediately if `document.readyState === 'complete'`, otherwise
  wait for `load`. Test: `tests/service-worker-register.test.tsx` (4 tests).
- **Browser evidence (after fix).** `/sw.js` registered at scope `/`, state
  `activated`. With the server stopped, a navigation to `/retailer/orders` rendered
  the cached offline page ("Maharani Traders is offline.") and showed no account or
  catalogue data.

### 3.2 Login lost after token refresh (FIXED — root cause identified, production not yet re-observed)
- **Root cause.** `lib/supabase/middleware.ts` created a new `NextResponse` inside
  every cookie `set`/`remove` callback. `@supabase/ssr` calls those once per cookie.
  A session too large for one cookie is split into chunks (`sb-<ref>-auth-token.0`,
  `.1`, …). Each call discarded the cookies written before it, so only the last
  chunk reached the browser. The next request could not rebuild the session and the
  user was sent to `/login`.
- **Reproduced.** `tests/auth-session-cookies.test.ts` failed on the old code: only
  `sb-test-auth-token.1` was returned, and the stale-cookie removal was lost.
- **Fix.** Buffer the cookie writes and apply them to one response after the
  refresh. Result after fix: 4/4 pass.
- **Not verified.** Whether this is the cause of the reported repeated logins on
  real devices. It needs a real Supabase session that actually gets chunked, plus a
  device test. Listed under §6.

### 3.3 Five SECURITY DEFINER functions (FIXED, migration 0057)
Verified against the migration history:

| Function | Defined in | Problem before 0057 |
|---|---|---|
| `is_user_access_valid(uuid)` | 0020 | SECURITY DEFINER, no `search_path`, EXECUTE open to PUBLIC |
| `get_active_access(uuid)` | 0020 | same; any anon caller could read another user's access period |
| `is_feature_enabled_for_user(uuid, text)` | 0020 | same |
| `log_audit()` | 0001 | trigger function, no `search_path` |
| `log_order_status_change()` | 0008 | trigger function, no `search_path` |

- **Fix.** Pin `search_path = public, pg_temp` on all five. Revoke EXECUTE on the
  three access functions from PUBLIC, `anon` and `authenticated`, and grant it to
  `service_role` only. Nothing in `app/`, `lib/`, `components/`, `middleware.ts`,
  `scripts/` or any RLS policy calls them. The trigger functions keep their grants.
- **Test.** `tests/security-definer-hardening-db.test.ts` runs the migration on
  PGlite and impersonates `anon` and an authenticated retailer. With 0057 removed,
  15 of 17 tests fail (the two trigger tests pass either way). With 0057 applied,
  17/17 pass.
- **Not run against production.** The migration has not been applied to the live
  Supabase project. See §6.

### 3.4 Install prompt and manifest (FIXED, small)
- The install banner no longer shows when the app is already running standalone
  (`display-mode: standalone` or iOS `navigator.standalone`). It is dismissed
  permanently on `appinstalled`.
- The manifest now declares `id: "/"`, equal to `start_url`, so an installed copy
  keeps its identity across updates.
- Tests: `tests/pwa-install-standalone.test.ts` (6 tests).

### 3.5 Existing guard test updated
`tests/coins-refund-migration.test.ts` pins the highest migration number. It now
expects `57` (was `56`). The 0053 uniqueness and ordering checks are unchanged.

## 4. PWA checks that passed (VERIFIED, local production build)

| Check | Result |
|---|---|
| `/manifest.webmanifest` | 200, `application/manifest+json`, `display: standalone`, 4 icons |
| Icons | `icon-192.png` 192×192, `icon-512.png` 512×512, `icon-maskable-512.png` 512×512, `apple-touch-icon.png` 180×180 |
| `/sw.js` | 200, `application/javascript`, `Cache-Control: public, max-age=0` |
| `/offline.html` | 200, honest connectivity screen with Retry, no cached user data |
| Protected route, anonymous | `/retailer/home` → 307 to `/login?redirect=…` |
| Service worker, browser | Registered and activated (after fix 3.1) |
| Offline fallback, browser | Served from the service-worker cache when the server is down (after fix 3.1) |

The service worker's network-only rules (API, Supabase, non-GET, navigations) are
pinned by existing tests in `tests/pwa.test.ts`, which still pass.

## 5. Reviewed and deliberately NOT changed

- **Catalogue, cart, checkout, premium UI.** The repo's own launch document says
  visual changes are on hold until an approved concept image is supplied. No
  visual redesign was made. Existing catalogue, checkout and pricing tests were
  not re-verified against live data in this session.
- **`is_phone_registered(text)` (anon EXECUTE).** Allows phone-number enumeration
  without rate limiting. Callers are server-side (`lib/auth/actions.ts`,
  `lib/admin/team-actions.ts`, mobile register route), and the mobile route uses the
  anon key, so revoking anon would break registration. A safe fix needs a product
  decision and a rate-limited server route. Left in place. **Open risk.**
- **Service-worker update flow.** `skipWaiting` and `clients.claim` are used. The
  page is never reloaded automatically, so form and cart state is not discarded.
  Left as is.
- **Password change signs out every device** (`scope: 'global'`). This is a
  deliberate security behaviour, not a bug.
- **Secret scan.** The only matches for secret-shaped strings are redaction-test
  fixtures in `scripts/production-health-probe.py`. No real credentials were found
  in tracked files, and no `.env` file is tracked.

## 6. Blocked or unverified (exact next step for each)

| # | Item | Status | Next step |
|---|---|---|---|
| 1 | Live production health (`/`, `/manifest.webmanifest`, `/sw.js`, `/api/health`) | BLOCKED (sandbox cannot reach `vercel.app`) | Run the existing *Production health* workflow manually (`workflow_dispatch`) after this PR merges. It is one run, not a loop. |
| 2 | PR #101 web checks | BLOCKED (GitHub Actions billing) | Owner: resolve the payment/spending-limit issue in GitHub Billing. Do not rerun until then. |
| 3 | Repeated-login root cause on real devices | UNVERIFIED | After deploy: sign in on an Android Chrome PWA, wait for a refresh, close and relaunch the app, and confirm no login prompt. Repeat after an idle period longer than the access-token lifetime. |
| 4 | Install prompt and home-screen launch | UNVERIFIED on a device | Open the site in Android Chrome, confirm the install banner appears once, install, and confirm the app opens standalone. Headless Chromium here does not fire `beforeinstallprompt`. |
| 5 | Migration 0057 on the live database | BLOCKED (needs owner approval) | Review `supabase/migrations/0057_security_definer_hardening.sql`, then apply it through the normal migration path. Afterwards run `select proname, proconfig from pg_proc where proname in (...)` and confirm `anon` cannot execute `get_active_access`. Do not run against production without approval. |
| 6 | `is_phone_registered` enumeration | OPEN RISK | Product decision plus a rate-limited server route. |
| 7 | Live checkout and login flows | BLOCKED | Needs an authorised retailer test account and explicit approval. A live order writes real data. |
| 8 | Android APK and signed release | OUT OF SCOPE | Not needed for the PWA. |
| 9 | Visual redesign | ON HOLD | Needs the approved concept image from the owner. |
| 10 | Real-device responsive and accessibility QA | UNVERIFIED | Manual check on 360–412 px Android screens. Headless Chromium here was used only for PWA behaviour. |

## 7. Launch verdict

**Not yet confirmed ready for public launch.** The code-level gates pass locally,
and the PWA's install-readiness and offline behaviour are verified in a real
browser. Three items still have no evidence: live production health, the
session fix on a real device, and the live database migration. Public launch
should wait for items 1, 3 and 5 in §6.
