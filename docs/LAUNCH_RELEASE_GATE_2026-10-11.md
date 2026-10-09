# Launch release gate — target 11 October 2026

**Assessed 9 October 2026** against branch `arena/8e68e2eb-maharani-mart`, head
`d6ec741`, PR #100.

Every row is PASS, PARTIAL or BLOCKED with the evidence that decided it. Nothing
here is inferred from an older report: the CI runs, the live HTTP probe and the
local suites were all executed for this assessment, and the run ids are given so
any claim can be re-checked.

## Verdict

**NOT launch-ready.** Three gates are hard-blocked and at least one of them cannot
be cleared by engineering work:

1. **No signed release artifact** — no upload key exists. Needs the maintainer.
2. **No reference image** — the supplied concept image never arrived in this
   session, so the primary visual direction cannot be implemented or verified.
3. **Google Play production on 11 Oct is not achievable** for a new personal
   developer account — a 14-day closed test had to be live by ~27 September.
   This is a scheduling fact. Direct APK distribution can still make the date.

Everything that could be verified without a device, a keystore or credentials was
verified, and production itself is **healthy** — that gate is now PASS for the
first time, with evidence (§ Production health).

## The 16 gates

| # | Gate | Verdict | Evidence / exact blocker |
|---|---|---|---|
| 1 | Reference-style Home | **BLOCKED** | The supplied concept image was never attached to this session. Searched the message, the workspace and the repo: the only images present are launcher icons and splash assets under `resources/android-res/` and `public/icons/`. A visual direction cannot be matched to a blueprint that was not received. Existing home is implemented (`components/retailer/home-content.tsx`, `android/.../ui/RetailerHomeScreen.kt`) but `docs/RETAILER_MEGA_UPGRADE_AUDIT.md` records two genuine gaps: no offer-discovery rail/ticker, and the banner click callback is omitted. |
| 2 | Catalog, Categories, Brands | **PARTIAL** | Code paths and tests exist for all three on web (`app/retailer/{catalog,categories,brands}`), mobile API (`app/api/mobile/v1/catalog/*`) and Android (`:feature:catalog`). Live device flow BLOCKED. Known DTO gaps from the prior audit, still open: native category parent/child identity not published, brand description not published, catalog price/MOQ/offer filters absent from the mobile contract. |
| 3 | Website functionality | **PARTIAL** | Build-side PASS: typecheck, lint, 2204 tests and `next build` all green locally and in CI. Live-side PASS for reachability and authorization (11/11 probes). **BLOCKED** for interactive flows (login → catalog → add to cart → checkout → order): no authorized retailer credentials, and the sandbox has no browser and no egress to the app. |
| 4 | Android functionality | **PARTIAL** | CI run `37959400861` PASS (16m50s): `testDebugUnitTest` + `lintDebug` + `assembleDebug`, 413 unit tests and 33 rendered Compose tests across 11 modules, debug APK identity and version verified. **BLOCKED** on a physical device: no JDK, Android SDK, `adb` or emulator in the review sandbox. A green CI run is not proof of a device flow. |
| 5 | Cart and checkout | **PARTIAL** | Server-authoritative pricing/quote/checkout is unit- and DB-tested (`tests/checkout-atomic.test.ts`, `tests/mobile-checkout-atomic-db.test.ts`, `tests/reorder-stock-price.test.ts`, coupon and Coins tests). **BLOCKED** for a live order: creating one writes real production data and needs an authorized retailer account. Must not be done casually against production. |
| 6 | Admin Category/Brand flow | **PARTIAL** | `tests/admin-taxonomy-{query,data,db}.test.ts` pass, including the RLS-migrated DB test added by #99, and `tests/admin-master-data-actions.test.ts` covers the guarded actions. **BLOCKED** for the real path Admin → database → API → retailer UI: no authorized admin or retailer staging account, no live DB credentials, no device. |
| 7 | Session persistence | **PARTIAL** | Web: `@supabase/ssr` + `middleware.ts`; live-verified that `/retailer/home` and `/admin/dashboard` 307 to `/login` for an anonymous caller. Android: Keystore-backed token store, `SessionManager` refresh/replay, and account-scoped store wipe on logout are unit-tested. **BLOCKED** for real-device lifecycle: process death, force-stop, token refresh across an expiry boundary, and logout → second-account isolation. |
| 8 | Security | **PASS** | Live: 401 `missing_token` on `/api/mobile/v1/{session,cart,catalog/products,orders}` — authorization is enforced in production, not just in tests. 307 to `/login` on protected pages. Health endpoints return no driver detail (`tests/health-endpoint.test.ts`). No keystore or key file exists under `android/` and none is tracked by git; `.gitignore` covers `*.jks`, `*.keystore`, `*.pem`, `local.properties`. The new CI adds no secret beyond the automatic `GITHUB_TOKEN`, and a guard step fails the run if that changes. No passwords are stored anywhere in the flow. |
| 9 | Responsive rendered UI | **PARTIAL** | Android: 33 rendered Compose assertions at **360dp, 393dp and 412dp** (`RetailerRenderedLayoutTest.kt`, added by #99) pass in CI, exercising the real Scaffold, NavHost, app bars, drawer, bottom bar and badges — plus ≥48dp touch-target checks. Web: `tests/retailer-home-ui.test.tsx` (34), `tests/infinite-scroll-ui.test.tsx` (10), `tests/banners.test.tsx` (17). **BLOCKED** for exhaustive visual QA: no device screenshots, no font-scale sweep, no real network imagery. A JVM-rendered test is not a device. |
| 10 | Web tests and production build | **PASS** | CI run `37959394444`, job *Web typecheck, lint, tests, and build* — success in 3m16s. Locally: `pnpm typecheck` clean, `pnpm lint` clean (one pre-existing `<img>` warning in `components/admin/product-image-manager.tsx`, unchanged by this work), `pnpm test` **116 files / 2204 tests pass**, `pnpm build` succeeds. |
| 11 | Android tests and release build | **PASS** *(unsigned)* | CI run `37959400861` — success. Tests, fatal lint (`abortOnError = true`), `assembleDebug`, `assembleRelease`, `bundleRelease`. `aapt dump badging` asserts `com.maharanitraders.app`, and the new step reads `versionName`/`versionCode` back **out of the built APK** and compares them with `android/version.properties`: `1.0.0` / `1`. The release artifact is unsigned by design — see gate 14. |
| 12 | Actual CI status | **PASS, one check BLOCKED** | Passing: *Web typecheck, lint, tests, and build*; *Android unit tests, lint, and debug APK*; *Probe the live production deployment*; *Vercel Preview Comments*. **BLOCKED: `Vercel` preview deployment** — status `failure`, "Deployment was blocked", because the `arena-agent` GitHub identity is not a member of the `mahakali108's projects` Vercel team. This is an access problem, not a build failure: the same code builds cleanly in the GitHub web job. **Production is unaffected** — it deploys from `main`, pushed by the owner. Fix: add `arena-agent` to the Vercel team, or make the repo public, or have the maintainer push a commit from their own account. `Supabase Preview` reports `skipping`. |
| 13 | Production health | **PASS** | First real verification of production in this repository. Run `37959400920` (14s): **11/11 probes passed** against `https://maharanitraders.vercel.app` at 2026-10-09T16:28:55Z. Full table in § Production health below. |
| 14 | Signed release artifact | **BLOCKED** | No upload key exists, and one must not be invented: a key generated in CI would differ from any future real key, and every device that installed it could never be updated again. CI now reports this precisely — annotation `signed release BLOCKED`, naming all four missing secrets, with the signed build/verify/measure steps correctly `skipped` and the unsigned artifact never described as a release. Setup: `docs/ANDROID_RELEASE_SIGNING.md` §3–§4. |
| 15 | Publishing / distribution readiness | **PARTIAL** | Direct APK: fully documented and achievable for 11 Oct once signed. Google Play production on 11 Oct: **not achievable** for a new personal account (§ Google Play). Additionally **NOT VERIFIED**: 16 KB page-size alignment — the app ships 8 native `.so` files across four ABIs, so this requirement does apply and must be checked with `zipalign -c -P 16 -v 4` or the Play pre-launch report. No Play Console entry exists; nothing has been published or distributed. |
| 16 | Existing PR status | **PASS** | PR #99 (open, green, +1476/−202) was a strict descendant of `main` @ `4aff485` with zero commits unique to `main`, so it merged into this branch as a clean fast-forward — **all 27 original commit SHAs preserved**, nothing reset, rewritten or discarded. A safety tag `arena-safety/8e68e2eb-premerge-4aff485` marks the pre-merge HEAD. #99 is left **open and untouched**. PR #100 opened from this branch, explaining that it incorporates and supersedes #99. **Nothing was merged.** No force-push. |

## Production health

`scripts/production-health-probe.py`, run on a GitHub-hosted runner (the review
sandbox has no egress to the production host — verified, not assumed). Eleven
unauthenticated read-only GETs, no credentials sent, no data written, no response
body printed beyond allowlisted fields.

**PASS — 11/11 · probed 2026-10-09T16:28:55Z · slowest response 1801 ms**

| Launch gate | Path | Status | Expected | ms | Body fields read |
|---|---|---:|---|---:|---|
| Website opens | `/` | 200 | 200 | 1801 | — |
| Authentication works | `/login` | 200 | 200 | 380 | — |
| Health endpoints respond | `/api/health` | 200 | 200 | 657 | `status=ok`, `database=reachable`, `latencyMs=331` |
| Health endpoints respond | `/api/mobile/v1/health` | 200 | 200 | 621 | `status=ok`, `database=reachable`, `apiVersion=v1`, `latencyMs=316` |
| Session enforcement | `/retailer/home` | 307 | 307 | 128 | → `/login` |
| Admin permissions | `/admin/dashboard` | 307 | 307 | 63 | → `/login` |
| Authentication works | `/api/mobile/v1/session` | 401 | 401 | 289 | `code=missing_token` |
| Checkout authorization | `/api/mobile/v1/cart` | 401 | 401 | 353 | `code=missing_token` |
| Retailer data isolation | `/api/mobile/v1/catalog/products` | 401 | 401 | 290 | `code=missing_token` |
| Retailer data isolation | `/api/mobile/v1/orders` | 401 | 401 | 301 | `code=missing_token` |
| Critical APIs work | `/api/mobile/v1/auth/login` | 405 | 405 | 357 | `code=method_not_allowed` |

What this establishes: the site is up, **the database is reachable from
production** (both health endpoints report it independently, at 331 ms and
316 ms), the middleware session gate is live, and **every protected mobile API
refuses an anonymous caller with the application's own `missing_token` code** —
not an unrelated 401 from an edge or proxy, which is why the code is asserted and
not just the status.

The probe never POSTs to `/auth/login`: repeated login attempts would trip the
real rate limiter (10 / 5 min per IP and identifier) and could lock out a genuine
retailer. Route deployment is proven with a 405 instead.

**One performance observation, not a failure:** `/` took **1801 ms** while every
other route answered in 63–657 ms. That is the shape of a cold serverless
function on the first request of the run. Worth confirming with a second probe and
with Vercel's function metrics before launch; a 1.8 s first paint on the
storefront is a real conversion cost even if it is not an outage.

## Google Play: why 11 October is not reachable

Google Play's target-API rule took effect **31 August 2026** — new apps and
updates must target Android 16 (API 36). **This project already complies**
(`compileSdk` 36, `targetSdk` 36, AGP 9.0.1, Gradle 9.1.0, JDK 17), so target API
is not the blocker.

The blocker is the closed-testing requirement: a **personal** developer account
created after **13 November 2023** must run a closed test with **12+ testers
opted in for 14 continuous days** before it can even *apply* for production
access. Internal testing does not count. Afterwards the production-access
decision takes ~48 hours and production review up to 7 more days.

Counting back from 11 October 2026, that closed test had to be live by roughly
**27 September 2026**. Today is 9 October.

| Route | Viable for 11 Oct? |
|---|---|
| Direct APK distribution | **YES** — the only channel that can make the date |
| Play internal or closed testing track | **YES**, but that is not a public listing |
| Play production, new personal account | **NO** — the window has passed |
| Play production, organization account or personal account created before 13 Nov 2023 | **POSSIBLE** — exempt from the closed-test rule; still needs account verification, store listing, Data safety, content rating, privacy policy and review time |

**Which account type exists is a question only the maintainer can answer, and it
is the single fact that decides whether Play is reachable for the launch date.**

Sources: [Google Play target API 36 deadline](https://www.highcircl.com/en/blog/google-play-target-api-36-deadline-2026),
[policy summary](https://orangeoma.zendesk.com/hc/en-us/articles/21001579350172-Google-Play-s-Target-API-level-requirements-for-2026),
[closed-testing requirement](https://www.testerscommunity.com/blog/google-play-closed-testing-requirements-2026),
[verified numbers](https://primetestlab.com/blog/google-play-closed-testing-statistics),
[publishing guide](https://www.testerscommunity.com/guides/publish-app-google-play).
Play Console itself is authoritative; these are checked as of 9 October 2026.

## Measured artifacts

CI run `37959400861`, exact bytes measured on the runner:

| Artifact | Bytes | Decimal MB | ≤30 MB | Signing |
|---|---:|---:|---|---|
| `app-debug.apk` | 16,371,253 | 16.37 | PASS | Gradle debug key — never distributable |
| `app-release-unsigned.apk` | 2,849,725 | 2.85 | PASS | **UNSIGNED — not distributable** |
| `app-release.aab` | 6,409,691 | 6.41 | PASS | **UNSIGNED — not distributable** |

Identity and version verified from the artifact, not from the source:
`applicationId com.maharanitraders.app`, `versionName 1.0.0`, `versionCode 1`.
Native libraries: 8 `.so` across `arm64-v8a`, `armeabi-v7a`, `x86`, `x86_64`
(`libdatastore_shared_counter.so`, `libandroidx.graphics.path.so`).

## What would clear each blocker

| Blocker | Who | What |
|---|---|---|
| Reference image | Maintainer | Attach the concept image. Work resumes immediately; no visual direction will be invented in the meantime. |
| Signed release | Maintainer | Create the upload key (`docs/ANDROID_RELEASE_SIGNING.md` §3) and add the four `ANDROID_RELEASE_*` secrets (§4). CI then builds, `apksigner`-verifies and measures a signed artifact with no code change. |
| Vercel preview | Maintainer | Add `arena-agent` to the Vercel team, make the repo public, or push a commit from the owner account. |
| Live flows (login, cart, checkout, order, admin taxonomy, device lifecycle) | Maintainer | Authorized staging accounts plus one physical device, running the 14-step checklist in `docs/ANDROID_RELEASE_SIGNING.md` §7. |
| Play production on 11 Oct | Maintainer | Confirm the account type. If personal and created after 13 Nov 2023, choose direct APK for 11 Oct and start the closed test immediately for a later Play launch. |
| 16 KB page alignment | Anyone with build tools | `zipalign -c -P 16 -v 4 app-release.apk`, or read the Play pre-launch report. |

## Scope note

This assessment covers the P0 production-safety and release tranche only. **No
retailer-facing screen was changed** by this work, so no visual regression is
possible from it. The reference-image work (P1) is deliberately unstarted, not
unfinished.
