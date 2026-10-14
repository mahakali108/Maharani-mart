# Maharani Traders redesign and district review

Review date: 14 October 2026. Branch: `arena/af7f872f-maharani-mart`.
Starting HEAD/base: `68f53eb4c6fd8043b2bffdb36a07d5ed2686fd8c`; default PR base: `main`.
The initial working tree was clean. Earlier merged work, pricing/order logic, authentication and production URL (`https://maharanitraders.vercel.app`) are preserved. No database migration, seed, deployment, release or manual Actions dispatch was performed.

## Implemented scope

- Removed the stale retailer CSS rules that forced primary colours to blue. Shared tokens now use Maharani `#C8102E`, ivory, blush, mint, lavender, peach and sky. Added explicit heading/panel primitives, reduced-motion support and print shell handling.
- Re-composed the actual `HomeContent` used by `/retailer/home`: two-column editorial hero, real shop/address context, catalogue/reorder entry points, offers/quick-order tiles, independent search and quick actions. No manufactured products, stock, prices, promotions or orders.
- Retailer header/footer and mobile Catalogue navigation; categories and brands remain reachable as first-class catalogue modes, with active-state tests. Existing search/sort/filter data logic remains intact.
- Product/category/brand cards, merchant promotion banner, product gallery/purchase-panel layout, cart prices and 44px quantity controls. Pack/MOQ/GST/stock/pricing calculations are unchanged.
- Cart → checkout → order-placed progress, order summary responsive layout, invoice navigation and print framing, light quick-order/reorder headers.
- Reusable authentication frame on login, registration, forgot/reset password. Public error/approval/unavailable/offline surfaces refreshed.
- Account/profile/address panels, coin balance card and secondary retailer route headings/panels refreshed. This is **not** a claim that every secondary page was rebuilt: AI is copy/shared-shell only; category detail/delivery detail primarily adopt shared headings; retained loading boundaries use shared components/tokens.
- Admin area creation/editing suggestions come from stored districts. Added district filters to area/retailer lists, district labels in retailer detail and reassignment, and explicit warnings about assignment scope.

Complete route and district inventories: [routes](REDESIGN_ROUTE_INVENTORY.md), [district references](REDESIGN_DISTRICT_INVENTORY.md).

## District behavior and safeguards

- Registration selects a district to narrow real active areas; only `areaId` is submitted. No area is silently preselected. Changing district clears the old selected area.
- Existing assignments, legacy districts and inactive current areas remain visible. Inactive areas cannot be newly assigned. The reassignment form remounts when the persisted retailer/area changes.
- Admin reassignment validates UUIDs and active area, requires `retailers.approve`, verifies the update returned a row and invalidates dependent views. Area create/edit requires `master_data.manage`, validates trimmed bounded names, and reports missing/forbidden records rather than fake success.
- Shared district validation is used by web/native address parsers. Optional address districts have no Saran default. Unique form IDs prevent labels targeting another open address editor.
- Profile editing shows the stored verified service area read-only; corrections go through admin/support. Address editing stays independently owner-scoped.
- Executed PostgreSQL/PGlite tests apply all existing migrations: registration derives district from the selected area; admin reassignment survives fresh caller transactions; district filtering works; retailers cannot reassign themselves or modify the directory; another retailer cannot read/update/take ownership of an address. PGlite is not live GoTrue, production Supabase, or a concurrency test.
- No production data was available to justify corrections, deduplication or rewriting old spellings. Existing records are preserved verbatim unless an authorized user explicitly edits them later.

## Verification record (exact scope matters)

All commands ran at repository root using Node 22 / pinned pnpm 9.15.9.

| Command | Exit | Result |
|---|---:|---|
| `corepack pnpm install --frozen-lockfile` | 0 | Lockfile preserved |
| `corepack pnpm test` on untouched starting tree | 1 | Previously reported 124 files: 2,306 passed, 1 failed (Android secret-name allowlist) |
| `corepack pnpm test` during implementation | 1 | 124 files: 2,298 passed, 9 failed; 8 outdated UI expectations plus the same baseline Android test. The 8 UI expectations were subsequently updated and their suites pass below. |
| `corepack pnpm typecheck` (resumed final code) | 0 | No TypeScript errors |
| `corepack pnpm lint` (resumed final code) | 0 | One existing `@next/next/no-img-element` warning, `components/admin/product-image-manager.tsx:110` |
| `corepack pnpm build` (earlier implementation snapshot) | 0 | Production build compiled; 114 static pages generated. Later district feedback/fixture/small UI refinements were typechecked/linted, not rebuilt at the user's request to avoid repeating expensive checks. |
| Targeted 13-suite command below | 0 | **295 passed / 13 files**, including **34 new district tests** |
| Separate district + Android diagnostic command below | 1 | **67 passed / 1 failed** across 4 files; only baseline Android allowlist test failed |
| `git diff --check` | 0 | No whitespace errors |

Final regression command:

```sh
corepack pnpm exec vitest run tests/district-management.test.ts tests/district-management-db.test.ts tests/district-management-ui.test.tsx tests/retailer-home-ui.test.tsx tests/premium-redesign.test.ts tests/pdp-flipkart-style.test.ts tests/pwa.test.ts tests/saran-district.test.ts tests/mobile-address-crud.test.ts tests/mobile-address-routes.test.ts tests/security-phase0-app.test.ts tests/security-phase0-db.test.ts tests/retailer-enterprise-upgrade.test.ts
```

Diagnostic command:

```sh
corepack pnpm exec vitest run tests/district-management.test.ts tests/district-management-db.test.ts tests/district-management-ui.test.tsx tests/android-release-versioning.test.ts
```

The earlier “118 targeted tests” report referred to seven suites including UI/PWA tests, **not 118 district-only tests**. A subsequently added address-edit test initially failed because the query double generated a descriptive non-UUID ID; the fixture now supplies a database-shaped UUID before running the real edit parser. No production validation was relaxed.

### Pre-existing Android CI test failure

`tests/android-release-versioning.test.ts:319`, test `never echoes a secret value`, scans `secrets.<NAME>` in `.github/workflows/android-apk.yml`. Its allowlist contains `GITHUB_TOKEN` and four `ANDROID_RELEASE_*` names. The existing workflow additionally references `RELEASE_KEYSTORE`, `RELEASE_KEYSTORE_PASSWORD`, `RELEASE_KEY_ALIAS`, `RELEASE_KEY_PASSWORD` for readiness/log auditing (lines 348–351 and 644–646). The first unexpected name is `RELEASE_KEYSTORE`, producing:

`RELEASE_KEYSTORE is not a signing secret: expected false to be true`

This is an allowlist/naming mismatch, not evidence that a secret value was printed. No secret values were read or exposed. Both workflow and test remain unchanged in this PR; aligning signing configuration deserves a separate review rather than weakening an unrelated security check.

GitHub check-run `115746200076` says the job did not start because recent account payments failed or the spending limit needs to increase. No Actions dispatch/retry was performed. The commit uses `[skip ci]` to avoid consuming Actions minutes on this push; this does not change workflows or resolve account billing.

## Browser evidence and limits

A local production server bound to `0.0.0.0:3000` was started with a deliberately nonfunctional `https://preview.invalid` Supabase URL and noncredential preview key, supplied only in process environment (no env file committed). This permits public-page rendering, not authentication or commerce.

Playwright/Chromium checked `/login`, `/forgot-password`, `/register-retailer`, `/offline.html` at **320, 360, 768 and 1440 px**, all HTTP 200. Measured document/body widths matched each viewport. Login desktop/mobile and registration mobile screenshots were opened and visually reviewed. Registration correctly displayed directory-unavailable information; the final small refinement also disables registration when unavailable. `/retailer/home` without a session redirected to login. Screenshots are from the earlier successful build, not a post-final-refinement authenticated session.

**Not verified:** authenticated home/catalog/cart/checkout/admin screenshots, real signup/login/re-login, real saved-address reload, end-to-end purchase/invoice, live production Supabase RLS or schema deployment, Android native build/lint, real-device Android/tablet behavior. No fabricated authenticated preview or bypass was added. The final full web suite/build were not repeated after the last refinements; targeted tests, typecheck and lint are current.

## PR handling

Existing open PRs #42, #45 and #66 were inspected: older partial retailer UI/OTP/catalogue work on different branches. They were not modified or closed. This branch has a distinct current-base redesign + district implementation and had no existing PR. No merge, force-push, rebase or branch switch is part of this work.
