# Final live UX acceptance — 2026-10-08

## Overall: PARTIAL — not a declaration of complete live acceptance

Branch `arena/ff1279ad-maharani-mart`. Built commit `c85ac8a`. Actual CI run [37762817214](https://github.com/mahakali108/Maharani-mart/actions/runs/37762817214) completed successfully. Evidence runner [37764907724](https://github.com/mahakali108/Maharani-mart/actions/runs/37764907724) also completed successfully. Artifact/report inventory: `evidence/ANDROID_RUN_37762817214.md`.

## Automated

| Gate | Status | Evidence |
|---|---|---|
| Android unit tests | PASS | 413 tests, zero failures/ignored across 11 modules; app now has 65 tests |
| Rendered Compose | PASS | 33/33: original 21 plus Cart, server quote totals, populated Orders, actual shell at each requested width |
| Fatal lint | PASS | All modules zero errors/fatal; 26 non-fatal issues remain |
| Debug assembly + package identity | PASS | CI assembleDebug + aapt verifies `com.maharanitraders.app` |
| Unsigned release APK/AAB | PASS | assembleRelease/bundleRelease and nonempty artifact uploads |
| Web tests/typecheck/lint/build | PASS | All corresponding steps in final CI passed; no web implementation changed this turn |
| Local Android | BLOCKED | No Java/JDK, Android SDK, adb/emulator. Used actual Actions, not a repeated local failure |
| Local targeted web invocation | BLOCKED | Restored sandbox lacks node_modules; npm exec did not resolve project's vitest/config. No local pass claimed; final CI dependency installation and full web suite passed |

## APK measurement

Actual APKs downloaded and measured on runner, NOT compressed artifact ZIP sizes:

| APK | Previous bytes | Final bytes | Final decimal MB | Status |
|---|---:|---:|---:|---|
| app-debug.apk | 16,371,253 | 16,371,253 | 16.371253 | PASS |
| app-release-unsigned.apk | 2,849,737 | 2,849,737 | 2.849737 | PASS |

Both <30,000,000 bytes. No size optimization, feature removal, ABI removal or dependency downgrade performed. Artifacts: `maharani-traders-debug-apk`, `maharani-traders-release-artifacts`. Release is unsigned measurement output, not store-distribution approval.

## Changes and tests in this continuation

- CartContent now accepts immutable actions; production factory binds every action to the existing CartCheckoutViewModel. No fake repository/data introduced in production.
- Rendered Cart fixture: image slot, populated identity/price/stock/MOQ, usable increment/remove targets >=48dp, scroll-to-checkout CTA >=48dp and within viewport. Increment and checkout dispatch are asserted. Quantity/MOQ layout separated to avoid horizontal crowding; price column reserves Remove width.
- Totals are tested in the existing server quote panel. CartSnapshot does not publish subtotal/discount/GST/Coins/final total, so these are not fabricated in Cart. Three widths verify all seven quote labels.
- Populated Orders fixtures (test-only): number/date/status/total/item quantity; new explicit >=48dp `View order & reorder` CTA opens the existing detail/reorder flow. Does not silently reorder or use historical prices as current prices.
- Actual AuthenticatedShell rendering uses the real Scaffold, NavHost, app bars, drawer, bottom navigation, badge and padding with content supplied by internal null-by-default ShellRenderSource. Production supplies null and retains Hilt/API ViewModels. No fixture content or demo entrypoint in production.
- Three shell tests traverse Home→Shop→Brands→Orders→Cart→Home→Categories→Shop→PDP→back→Account, verify badge child semantics, selected bottom tabs, and PDP CTA >=48dp. Fixed Shop return from Categories to avoid restoring the category stack again. Account icon consistently routes to Account.
- Tests caught test-fixture compilation/tag and navigation-semantics issues; checks were not disabled. Final rerun is green.
- SessionManager A→logout→B regression now checks a scoped-store fixture containing orders/cart/favorites/addresses/Coins/notifications/saved carts is cleared before B. This is automated store-contract evidence, NOT a real-device Keystore/account integration proof.

## UI status and scope

| Surface | Automated | Live/visual |
|---|---|---|
| Home | PASS — discovery fixture, actual header/search/badge/navigation shell | BLOCKED — no live campaign/image/history accounts or reference screenshots |
| Catalog | PASS — rendered two-column grid/card/48dp controls; shell transition | PARTIAL — test shell supplies deterministic content; real category/brand query behavior remains covered by earlier repository/API tests |
| Categories | PASS — parent caption, directory, actual shell selected Shop state | BLOCKED — live admin-created category device flow |
| Brands | PASS — directory and actual shell selected Brands | BLOCKED — live admin-created brand device flow |
| PDP | PASS — all three >=48dp CTA checks and shell transition/back | PARTIAL — fixture imagery is fallback; no description field published in native model, no fake description added |
| Cart | PASS — populated rendered controls and reachable checkout at all widths | BLOCKED — live price/stock mutation/device flow |
| Orders | PASS — populated card + explicit detail/reorder CTA at all widths | BLOCKED — live own-order device flow |
| Account | PASS — routed profile with real shell chrome | BLOCKED — live persisted session/Keystore lifecycle |
| 360/393/412dp | PASS — 33 scoped rendered assertions | BLOCKED — exhaustive screenshots/font-scale/real-image visual QA |

These tests do not prove every pixel has no clipping, all imagery loads, or full visual equivalence to reference principles. They exercise actual Compose rendering, not tokens alone. Image fixtures are null URLs and intentionally test the fallback slot; no network imagery or marketing art is fabricated.

## Live acceptance — concrete blockers

| Flow | Status | Reason |
|---|---|---|
| Login→close→reopen→force-stop→restore/refresh/expiry | BLOCKED | No Android device/emulator/SDK and no authorized retailer test accounts |
| Logout→B real private-domain isolation | BLOCKED | Same missing device/accounts; unit tests cannot certify live Keystore and endpoint isolation |
| Admin Category create/edit/deactivate/reactivate→API→Android | BLOCKED | No authorized admin/retailer staging accounts, live backend credentials or device |
| Admin Brand equivalent | BLOCKED | Same unavailable authorized staging/device access |
| Home reference visual acceptance | BLOCKED | No supplied reference attachment available in this session; no live device screenshots |
| Full live shell/Cart/populated Orders | BLOCKED | No device/accounts; automated shell/content substitution explicitly not live E2E |

RLS/auth/token security remain unchanged. Passwords are not stored. Keystore-backed encrypted token storage remains intact. No production seeds, hardcoded product lists, secrets, wrapper or browser surfaces added.

## PR

PR #66 remains OPEN / NOT MERGED. Head `arena/01a0b519-maharani-mart`, base main. This session can push only `arena/ff1279ad-maharani-mart`; a PR's head cannot be edited to this branch through normal GitHub PR editing. No force push, PR rewrite, duplicate PR or merge. Per this turn's instruction PR #66 was left untouched (no new comment/body/diff edits). Current branch is ready for review.

Workspace continuity: restored file changes were committed and merged non-destructively with the existing remote session branch before adding tests. This was not a PR/main merge, reset or history rewrite.
