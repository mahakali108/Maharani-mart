# MAHARANI TRADERS — FINAL RED-FREE VISUAL AUDIT

**Audit date:** 16 October 2026<br>
**Branch / HEAD:** `arena/a6181eba-maharani-mart` / `cb6bd71`<br>
**Scope:** user-facing web storefront, admin UI, native Compose app, shared tokens, application chrome and checked branding assets.

> **Disposition:** source-level prohibited-colour audit **PASS**. Overall rendered visual approval is **NOT VERIFIED**: the available PNGs are static token fixtures, not captures of the real web/admin app or Android app.

## Status summary

| Area | Status | Evidence / limitation |
| --- | --- | --- |
| User-facing source colour audit | **PASS** | No prohibited red, wine, crimson, maroon, scarlet, burgundy, rose or red-family UI colour was found in the scanned source. No prohibited brand-colour exceptions were retained. |
| Tailwind, CSS variables, gradients, inline styles, SVG/vector source and Android colour resources | **PASS** | Red-family utility and literal scans pass. CSS gradient declarations and variable values were reviewed. No `.svg` asset files exist in the audited trees; inline SVG attributes, where present in source, are included in the source scan. Android XML colours/resources are in scope. |
| PWA / launcher / splash branding rasters | **PASS** | The design-system raster contract found no chromatic red/pink pixels at its configured audit threshold in the scanned icon and splash assets. This is an asset-pixel result, not a claim about future uploaded product/banner photos. |
| Pastel-pink boundary | **PASS** | Pink is retained as a light background token and the only live web use is the first category-shortcut tile in the five-tone rotation. No pink utility is used for text, buttons, active navigation, status, error, or branding. |
| Semantic status colours | **PASS** | Success/in-stock = mint; information = sky; warning = amber; configured offer = peach; error/unavailable = lavender/navy; out-of-stock = slate. No semantic status is coloured red. |
| Key web/admin/native visual roles | **PASS — source mapping** | Primary actions and links map to violet; page/card surfaces use ivory/white; active navigation uses violet with lavender selection; product and status accents use approved semantic families. Dynamic artwork is excluded from this source-only result. |
| Existing changed-path integrity | **PASS** | At this red-free audit’s completion, all original 276 inventoried changed paths were retained; five additional tracked UI source paths, one stale documentation correction and this report brought the inventory to 283. The later `FINAL_VISUAL_ACCEPTANCE.md` adds one untracked report; the current inventory therefore lists 284 paths. No deletion, rename, unresolved conflict, commit, push, deployment or Actions run was made. |
| Focused color / UI regression tests | **PASS** | 5 files, 80 tests passed; details below. |
| Full regression suite | **PASS** | 128 files, 2,349 tests passed. |
| Typecheck / lint / web production build | **PASS** | `tsc --noEmit` passed. Lint and build each retain one non-fatal `<img>` optimization warning. Build generated all 114 static pages. |
| Android Gradle compilation / lint / unit tests / APK | **BLOCKED** | `./gradlew testDebugUnitTest lintDebug assembleDebug` stopped before Gradle because `JAVA_HOME` is unset and `java` is absent. Android SDK tools are also unavailable. No APK was produced or verified. |
| Actual rendered web/admin screenshots and reference comparison | **NOT VERIFIED** | No browser-rendered app capture or authenticated production capture is available. Existing screenshots are static fixtures. |
| Actual Android screenshot / device-specific visual check | **NOT VERIFIED** | No emulator/device capture is available; the Android toolchain is blocked. |
| Final visual approval | **NOT VERIFIED** | Source colours are clean, but the requested runtime/reference screenshot evidence is not available. |

## Findings and classification

### 1. Prohibited branding colour — none found

The scan found no actual UI use of red, dark red, wine, crimson, maroon, scarlet, burgundy, rose, saturated red-pink, or a red-dominant gradient in the audited web, admin, native, token, or checked branding-asset sources. No prohibited brand colour was silently exempted as an error or status state.

The source contract scans user-facing `app/`, `components/`, `lib/`, `public/`, Android app resources, Compose design-system and feature sources, `resources/`, and `tailwind.config.ts`. It checks Tailwind colour utilities, hex and Android `0x` literals, RGB/HSL forms, named CSS/SVG colours, inline styles, gradient declarations, CSS custom-property values, Compose `Color` constants, XML resources, and red-alert markers. The raster contract scans PWA icons, Android launcher/splash resources and the checked branding assets. The source check permits clearly light pastel pink; the raster check uses a higher lightness cutoff to avoid mistaking near-white pastel edges for prohibited branding.

A filesystem search found **zero `.svg` files** under `app/`, `components/`, `lib/`, `public/`, `android/` and `resources/`. This is recorded as “none present,” not as an uninspected exemption.

### 2. Permitted soft pastel pink — restricted use

The canonical `pastelPink` token family contains these light background values, mirrored into generated web CSS and Compose Kotlin:

| Token | Value | Classification |
| --- | --- | --- |
| `pastelPink.50` | `#FFFAFD` | Permitted soft pastel pink surface |
| `pastelPink.100` | `#FDF2F8` | Permitted soft pastel pink surface |
| `pastelPink.200` | `#F9E2EF` | Permitted soft pastel pink surface |
| `pastelPink.300` | `#F0D5E5` | Permitted soft pastel pink surface |
| `pastelPink.400` | `#E7D2E8` | Permitted soft pastel pink surface |

`surface.beauty` maps to `pastelPink.100` for the optional beauty/personal-care surface. The only current web rendering use is `app/globals.css:175`: the first category shortcut in a five-family rotation receives `--palette-pastel-pink-100`; the shortcut text remains slate/navy. The other shortcut surfaces rotate through mint, lavender, peach and sky. `tailwind.config.ts` retains the legacy `blush` alias to this same pastel family, but the UI source has no `bg-blush-*`, `text-blush-*`, `border-blush-*`, or equivalent utility use. A contract test now fails if those utilities are reintroduced in UI source.

The three PNGs in `docs/visual-review/` also show a labelled token-family pink swatch; they are static fixtures, not application screenshots or product assets.

### 3. Essential semantic states — no red exception

These are semantic findings, not branding-colour exceptions:

- **Positive / in stock / completed:** mint (`components/retailer/product-card.tsx`, `android/core/designsystem/.../StockBadge.kt`, admin status maps).
- **Information / delivery:** sky (`RetailerShell` delivery-area affordance and shared semantic tokens).
- **Warning / unknown availability / expiry:** amber, accompanied by status text (`StockBadge.kt`, admin status maps and warning components).
- **Configured offer:** peach (`components/retailer/promo-banner.tsx`, `OfferBadge`, native offer surfaces).
- **Error / validation / unavailable:** neutral lavender and navy; the shared `error` aliases and Compose `colorScheme.error` do not resolve to red (`design/tokens.json`, generated CSS, `Theme.kt`).
- **Out of stock:** neutral slate and explicit wording, not red (`product-card.tsx`, `StockBadge.kt`).
- **Cancelled / rejected / suspended:** violet, lavender or slate status treatments; these are not red-alert styles (`components/admin/status-badge.tsx`, `lib/admin/control-center/types.ts`).

### Non-rendering word matches — not UI colour findings

A literal search also finds words such as “red” in comments, test assertions and historical documentation. These do not represent rendered colour values and were not treated as a UI exemption:

| Reference | Classification / disposition |
| --- | --- |
| `android/core/designsystem/src/main/kotlin/com/maharanitraders/core/designsystem/theme/Theme.kt:20`, `Color.kt:202`, `ExtraColors.kt:41` | Source comments explicitly document neutral/non-red error and warning roles; no red colour is defined there. |
| `android/feature/engagement/build.gradle.kts:62` | “Went red” describes a previous Gradle/compiler diagnostic, not a colour or UI state. |
| `docs/PREMIUM_REDESIGN_2026-10-10.md` | Historical red/wine-first palette record, explicitly marked superseded by `docs/design-system.md`; not current styling guidance. |
| `docs/wallet-credit-ledger.md` | Its retailer UI section had stale red/green wording. It was corrected to match the current coin screen: violet debit, mint credit, amber available balance, and neutral spent balance. This was a documentation discrepancy, not a live red UI finding. |

### 4. Key component colour-role verification

| Surface | Source reviewed | Source-level result |
| --- | --- | --- |
| Primary buttons / quick-add actions | `components/ui/button.tsx`, `components/retailer/product-card.tsx`, native Material theme | `primary` / `action` resolve to violet; text on primary is white. |
| Prices | `components/retailer/product-card.tsx`, `app/retailer/catalog/[id]/page.tsx`, native `PriceBlock.kt` | Retail product-card price is violet; detail/native price text uses approved high-contrast navy/slate. Savings use mint. No red price treatment remains. |
| Retailer header, links and desktop active nav | `components/layout/retailer-shell.tsx` | White header, ivory page, navy/slate labels, violet brand/action/hover/active underline. |
| Mobile and catalogue selected nav | `components/layout/mobile-bottom-nav.tsx`, `components/retailer/catalogue-nav.tsx`, native `CatalogTabStrip.kt` | Violet selected text/icon/indicator with lavender selected surface; no pink active-nav fill. |
| Category shortcuts | `app/globals.css`, `components/retailer/category-card.tsx` | Token-based five-colour rotation; pastel pink is confined to one pale shortcut background, with navy text. |
| Product cards and badges | `components/retailer/product-card.tsx`, `CatalogComponents.kt`, `StockBadge.kt` | White/ivory cards; navy text; violet prices/actions; mint stock/savings; lavender “New”; peach/amber offers; slate unavailable state. |
| Promotion banner | `components/retailer/promo-banner.tsx`, `PromoCarousel` | Peach backing and border, violet CTA. Actual `imageUrl` artwork is server-configured and was not available for pixel review. |
| Admin navigation and state | `components/layout/sidebar.tsx`, `components/admin/status-badge.tsx`, `lib/admin/control-center/types.ts` | Active navigation is violet; operational states use mint/amber/sky/slate or neutral lavender/navy error aliases. |
| Native shell and selected navigation | `Theme.kt`, `ExtraColors.kt`, `AuthenticatedShell.kt` | Violet app-bar/action and selected icon/text; lavender selected indicator; ivory/white surfaces and navy/slate text. |

## Fixes made during this audit

The source audit found several old pale-pink accents outside category/lifestyle use, plus one invalid pastel-text shade. They were corrected without changing APIs, business logic, data, access control, or the shared token values:

- `components/layout/mobile-bottom-nav.tsx` and `components/retailer/catalogue-nav.tsx`: selected navigation backplates changed from blush to lavender.
- `components/auth/auth-frame.tsx`, `components/retailer/home-content.tsx`, `app/retailer/home/loading.tsx`, and `components/retailer/marketplace-skeleton.tsx`: identity/hero/loading surfaces changed from blush to lavender.
- `app/retailer/catalog/page.tsx`: catalogue hero and brand monogram changed to lavender.
- `app/retailer/catalog/[id]/page.tsx`: product-detail card border changed to neutral slate.
- `app/retailer/account/page.tsx`: the coupon shortcut changed from `bg-blush-50 text-blush-700` to `bg-peach-50 text-peach-800`. `blush-700` was outside the documented pastel-pink 50–400 scale and pink is not the offer role.
- `docs/wallet-credit-ledger.md`: stale retailer-facing red/green credit-ledger colour notes were replaced with the current coin screen’s amber, neutral, violet and mint roles.
- `tests/premium-redesign.test.ts` now asserts the lavender hero. `tests/design-system-contract.test.ts` covers pink-use boundaries and key web/admin/native role mappings in addition to source, token-parity, contrast, responsive, broken-image and branding-raster checks.

## Exact checks

| Check | Result |
| --- | --- |
| `corepack pnpm exec vitest run tests/design-system-contract.test.ts tests/premium-redesign.test.ts tests/control-center.test.ts tests/pdp-flipkart-style.test.ts tests/pwa.test.ts` | **PASS** — 5 files, 80 tests. |
| `corepack pnpm test` | **PASS** — 128 files, 2,349 tests. |
| `corepack pnpm typecheck` | **PASS** — `tsc --noEmit`. |
| `corepack pnpm lint` | **PASS with one warning** — `<img>` performance warning at `components/admin/product-image-manager.tsx:110`; no lint errors. |
| `corepack pnpm build` | **PASS** — Next.js 14.2.15 compiled and generated all 114 static pages; same non-fatal `<img>` warning. |
| `git diff --check` | **PASS** — no whitespace errors. |
| `cd android && ./gradlew testDebugUnitTest lintDebug assembleDebug` | **BLOCKED before Gradle starts** — `JAVA_HOME` is unset and no `java` command is available. `ANDROID_HOME` / `ANDROID_SDK_ROOT`, `javac`, `adb`, and `sdkmanager` are unavailable. **No APK was produced or verified.** |

**Resolved iteration failures:** the first focused run caught a stale `bg-blush-50` assertion in `tests/premium-redesign.test.ts` after the intended hero change, and a temporarily over-escaped regex in `tests/design-system-contract.test.ts`. Both were corrected; the final focused and full suites above pass. No test failure remains.

## Screenshots, reference comparison and remaining work

- `docs/visual-review/web-fixture.png`, `admin-fixture.png` and `native-fixture.png` are the only available images. They were visually inspected and are clearly labelled token fixtures; **none is a screenshot of the running web site, admin panel, emulator or production account**.
- The fixture images support a source/token palette review, but cannot prove rendered component states, dynamic banner/product imagery, viewport behaviour, device contrast or visual fidelity to an actual supplied reference image. Those comparisons are **NOT VERIFIED**.
- Banner and product artwork is server/storage content; any data-driven merchant brand artwork is also outside the available fixtures. No live production image or configured campaign image was available in this audit, so dynamic-content pixels remain **NOT VERIFIED**. The surrounding UI treatment and checked static launcher/splash branding assets pass.
- To close visual approval: capture the actual web/admin routes at representative mobile and desktop widths, capture the native screens on an emulator/device after the Android toolchain is available, and compare them with the supplied reference. Review live configured banner and product artwork separately; do not replace it with invented data.
- To close Android verification: provide a JDK and Android SDK, then rerun the documented Gradle test/lint/assemble command. Until then, compilation and APK generation remain **BLOCKED**.

No commit, push, deployment, merge, release, or GitHub Actions workflow was run for this audit.
