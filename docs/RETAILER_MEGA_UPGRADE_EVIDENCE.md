# Retailer native upgrade evidence — 2026-10-08

## Status: PARTIAL — not accepted as complete

Baseline: `4aff485a8cb59fd4a12218f3d6a9d62ae97a6069`. Implementation commit: `0eb828c` on `arena/ff1279ad-maharani-mart`. Full audit: `RETAILER_MEGA_UPGRADE_AUDIT.md`.

## Changed in this iteration
- Home: discovery ahead of dashboard, horizontal authorized shortcuts, admin banner-title information rail, native banner allowlist, real schemes campaign cards (no inferred discounts), header cart badge, explicit Maharani Traders identity.
- Navigation: Home / Catalog / Brands / Orders / Cart; Account via header/drawer. PDP app bar corrected.
- Comparison: maximum four; fifth refused. Corrected fact-table column indexing; published zero GST retained; 48dp comparison actions.
- Category parent names no longer discarded. This is not a complete parent-ID/tree browser.
- Optional newest-product failure now visible. Home emptiness includes brands.
- API reads: catalog search subquery/main query and taxonomy failures propagate instead of successful empty results.
- Added native routing, newest-failure, category mapping, zero-GST and cap tests; added catalog API failure tests.

## Already present, preserved rather than counted as new
Native Kotlin/Compose, semantic Material 3 theme, dense two-column cards, PDP and MOQ sheet, server-priced cart/checkout, coupons/Coins, Quick Order, order reorder, live-price Buy Again, favorites, saved carts, notifications, invoices/status, address/account/support screens. Admin category/brand CRUD already exists; targeted authorization/duplicate/database contract tests passed. No schema migration or new admin CRUD was justified by this audit.

## Verification
- `npm run typecheck`: PASS.
- `npm run lint`: PASS with existing `product-image-manager.tsx:110` no-img-element warning.
- `npm test` rerun: PASS, 114 files / 2,126 tests. First run had one incorrectly constructed new test (`search` rather than supported `q`); corrected and reran entire suite.
- Targeted catalog API/project-integrity/admin master-data/admin taxonomy DB: PASS, 4 files / 133 tests.
- `npm run build`: PASS.
- `git diff --check`: PASS.
- `./gradlew testDebugUnitTest lintDebug assembleDebug assembleRelease`: BLOCKED before Gradle, JAVA_HOME unset and no Java. SDK/emulator also absent. Native new tests are not claimed passing.
- Actual push-triggered Actions run: https://github.com/mahakali108/Maharani-mart/actions/runs/37735735162 — in progress at report time, not green evidence. Watch process writes `/home/user/verification/ci-result.json` when it finishes.

## Security and performance evidence boundaries
No Auth, token storage, authorization, RLS, pricing/stock/MOQ/GST/checkout authority changes. Existing session-scoped store clearing and owner/role checks remain intact. Web suite includes ownership/session/commerce/security regressions; this is not live User A→logout→User B RLS/device evidence. Banner URLs cannot launch an external browser through the new callback. Unsupported paths do not navigate.

Existing lazy layouts, cursor pagination and shared remote image loader preserved. Dashboard now guards duplicate in-flight loads and runs its three server reads concurrently; schemes rail capped at six. No generated artwork, datasets, wrapper or bundled marketing added. No actual scroll/memory/network measurements available. Dependency installation reported 18 vulnerabilities; no unsafe force-upgrade attempted.

## APK and device acceptance still outstanding
No fresh baseline or after debug/release APK artifacts available, therefore exact byte sizes, <=30MB release budget, nonempty artifact and packaged `com.maharanitraders.app` identity remain UNVERIFIED. Source applicationId is not artifact proof. No rendered 360/393/412dp or accessibility/device flow checks performed. Native compile/lint/tests, live admin→API→device campaigns, server checkout/reorder/Quick Order failure flows, session A/B logout isolation and screenshots are still required. This report deliberately does not mark the entire requested upgrade done.

## PR handling
Related open PR #66: https://github.com/mahakali108/Maharani-mart/pull/66 — OPEN / NOT MERGED. Its head is another session branch; this session is fixed to `arena/ff1279ad-maharani-mart` and cannot push the other head. No duplicate PR created and no PR merged. A comment links this branch's work/evidence; a comment does **not** update that PR's diff. Same-PR head integration remains blocked by the branch constraint.
