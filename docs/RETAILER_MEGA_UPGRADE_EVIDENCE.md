# Retailer native upgrade evidence — 2026-10-08

## Overall: PARTIAL

**Latest continuation:** see `FINAL_LIVE_UX_ACCEPTANCE.md`. Run `37762817214`
passes 413 Android tests / 33 rendered checks and final builds, superseding the
older test counts and pending rendered gaps below. Exact current/baseline APK
bytes are in `evidence/ANDROID_RUN_37762817214.md`. Live session/admin/reference
visual acceptance remains BLOCKED. The rest of this file is prior-iteration
history, not the latest acceptance table.

Baseline: `4aff485a8cb59fd4a12218f3d6a9d62ae97a6069`. Session branch: `arena/ff1279ad-maharani-mart`. Audit: `RETAILER_MEGA_UPGRADE_AUDIT.md`. No feature was deleted, no reset/force-push/merge performed.

## Already integrated, preserved
Native Kotlin/Compose; real home/category/brand catalog, semantic Material 3 theme, two-column cards, PDP/MOQ sheet, server-authoritative cart/checkout, coupons/Coins, Quick Order, reorder/current-price Buy Again, comparison, favorites/saved carts, notifications, invoices/order status, addresses/account/support. Prior iteration added schemes discovery, native banner allowlist, header cart badge, Brands tab, four-product comparison and fixed table indexing/API failures. Existing code is not counted as new production acceptance.

## Finished in this continuation
- PASS: authoritative original CI inspected (`37735735162`), completed successful web + Android tests/debug/release assembly and debug package identity check.
- PASS: measured baseline/current APKs on a GitHub runner, not artifact ZIP estimates. Published API-accessible report in `evidence/ANDROID_RUN_37735735162.md`.
- PASS: added 21 JVM-rendered Compose regressions: Home, Catalog, Categories, Brands, PDP, Orders-empty, Account at each of 360/393/412dp. These exercise real production Compose surfaces with explicitly test-only fixtures.
- PASS: render checks caught PDP CTA at 40dp; fixed minimum height to 48dp without weakening the assertion. Run `37740368478` reported zero failing Android tests after correction.
- PASS: Catalog Categories/Brands controls moved above search. Parent name retained on Home and added to Catalog category cards.
- PASS: migrated PostgreSQL/RLS category/brand edit + deactivate/reactivate retailer retrieval tests, 11 taxonomy tests passing locally. Existing create/action/authorization/API tests preserved.
- PASS: converted native lint to abort on real errors. It exposed three existing connectivity permission errors. Corrected `ACCESS_NETWORK_STATE` declaration in the owning `core:common` library; latest CI pending below.

## Exact final artifact measurements (run 37741621723, implementation 42a7e5b)

| APK | Baseline bytes | Measured after bytes | After decimal MB | Status |
|---|---:|---:|---:|---|
| `app-debug.apk` | 16,352,566 | 16,371,253 | 16.371253 | PASS |
| `app-release-unsigned.apk` | 2,847,649 | 2,849,737 | 2.849737 | PASS |

Debug increase: 18,687 bytes; release increase: 2,088 bytes. Both below 30,000,000 bytes. Release is unsigned measurement output, not a distribution release. Artifact names: `maharani-traders-debug-apk`, `maharani-traders-release-artifacts`. Final measured artifact report: `evidence/ANDROID_RUN_37741621723.md`; subsequent commits only update documentation/evidence workflow.

Audit found eight .so entries (DataStore shared counter + AndroidX graphics path across four ABIs), 242,900 bytes; no bundled fonts/JSON data, no duplicate ZIP entries. Release contains 15 raster resource files (187,126 compressed bytes). R8/resource shrinking remains enabled; debug-only tooling preserved. No need to delete functionality for size. Previous script claim of zero native libraries is contradicted by measured inventory, which is authoritative.

## Tests and CI
- PASS: initial full web 114 files / 2,126 tests; typecheck/lint/production build.
- PASS: latest inspected web job `37740368478` completed all checks with two additional taxonomy tests (expected total 2,128; exact console total not yet retrieved).
- PASS: original Android reports contain 380 tests, zero failures. Final reports contain 401 tests (including all 21 rendered tests), zero failures/ignored. After new render tests: all test tasks completed with zero failing tests in run `37740368478`.
- PARTIAL: run `37739444606` failed three PDP size assertions; corrected. Run `37740368478` then failed fatal `:core:common:lintDebug` permission errors; corrected without suppression/baseline/check deletion.
- PASS: final run `37741621723` at commit `42a7e5b` completed successfully: web checks, native tests, fatal lint, debug assembly, debug package identity `com.maharanitraders.app`, unsigned release APK/AAB and uploads. Runner-side evidence run `37743746412` also completed successfully; all 11 modules report zero lint errors/fatal (24 non-fatal issues), 401 Android tests and zero failures/ignored.
- BLOCKED: local JDK/Android SDK unavailable. No repeated local Gradle attempt or local pass claim. Artifact/log redirect hosts are inaccessible here; runner-side evidence uses actual artifacts and reachable GitHub API. GitHub check annotations exposed root failures.

## Responsive and live acceptance boundaries
- PASS: 21 rendered fixture tests, including Catalog two-column bounds and 48dp tab/card/PDP CTA checks. Native Robolectric rendering, not merely token arithmetic.
- PARTIAL: Home tests check category discovery; Orders tests cover empty+Refresh, not populated cards. Account checks profile visibility. No claim of exhaustive no-clipping/no-overlap/font-scale/visual fidelity across full screens.
- BLOCKED: Cart rendering, full shell/header/bottom nav screenshots, populated Orders, device screenshots and supplied-reference comparison still outstanding. No visual reference attachment was present in this checkout/session.
- BLOCKED: live production admin UI→Supabase→API→Android and login→close/kill→restore→logout→User B tests require a device plus authorized test accounts/environment, not available here. No credentials or fake production records created.

## Admin/session/security
- PASS: admin create/edit/retailer visibility established in action/database/API tests, including migrated RLS. This is layered integration evidence, not a live device E2E claim. Existing UI edit forms bind real update actions. Safe hard-delete behavior not established, so no deletion added.
- PASS: original native session tests cover encrypted-store abstraction restore, token refresh, offline retention, rejected-token wipe, signout cache wipe and User B isolation. Keystore-backed production storage remains AES-256-GCM; no passwords stored or token security weakened.
- PARTIAL: tests do not prove Keystore restore under actual process death on a physical/emulated device.
- PASS: no RLS/auth/price/stock/MOQ/GST/checkout authority changes. Quick Order uncertain failures/reorder intent handling preserved. SKU is not published/supported; product/pack barcodes are supported. No pretend SKU support added.

## PR and parity
PR #66 https://github.com/mahakali108/Maharani-mart/pull/66: OPEN, NOT MERGED. Head `arena/01a0b519-maharani-mart` at `d361251`, base `main`; GitHub PR head cannot be retargeted to this branch through normal edit. Session constraints prohibit pushing the other head. No duplicate PR created or rewrite attempted. Current branch is ready for review; comments are evidence links, not a diff integration.

Parity remains PARTIAL for this upgrade's changed behavior and live/device acceptance. Historical IMPLEMENTED rows are not new signoff. Do not declare the mega upgrade complete until outstanding device/live/full-screen gates and final CI/artifact evidence pass.
