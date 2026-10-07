# Native UI redesign — the Maharani Traders shopping app

Status: implemented and CI-verified on branch `arena/581284a2-maharani-mart`
(web typecheck/lint/tests/build and the Android unit test + lint + debug APK job —
see §13 for the exact runs).
Scope: `android/` only. No backend file changed, no endpoint added, no wire
contract touched (`docs/NATIVE_ANDROID_API_CONTRACT.md` is still the authority).

This document records what was built, why it looks the way it does, and — where a
design idea needed data the API does not provide — what was left out on purpose.

---

## 1. What changed, in one paragraph

The Phase D catalogue screens were functional but looked like a form: a red app
bar, a plain text field, undifferentiated cards, one scrolling column. They are
now a shopping app. The retailer home is a shop front (branded gradient app bar
with a persistent search field, a banner carousel, category and brand rails, a
"Recently added" rail, then the real catalogue grid), the catalogue is a
responsive two-column grid under a pinned filter header with cursor pagination,
the product detail screen is a paged gallery over server-priced pack data, and
the shell has a real bottom bar (Home · Categories · Cart · Orders · Account)
plus a drawer for everything the role also owns. All of it renders the same
server data as before; nothing on a screen is invented.

---

## 2. Identity: Maharani red chrome, saffron accent, warm neutrals

The native app is **red-primary**. Brand red `#C8102E` (`MaharaniPalette.BrandRed600`,
the same value as the printed brand, the launcher icon, the system splash and the
web's `primary`) is the single colour of the chrome: app bars, the selected
segment of the catalogue's segmented control, bottom-bar selection, links,
primary buttons, focus rings and progress.

This replaced an earlier split — *identity red, commerce chrome blue* — because
two brand colours on one screen made the app read as a marketplace skin rather
than as Maharani Traders: the shopper saw blue on every actionable surface, a
red wordmark above it, and a red splash before it, and the Categories/Brands
segments (blue-on-grey) were mistaken for disabled controls.

| Surface | Colour | Why |
| --- | --- | --- |
| Launcher icon, system splash (`themes.xml` → `@color/brand_red`), in-app `BrandSplash`, app bars, selected tab/segment, bottom-bar selection, links, primary buttons, focus | Brand red `#C8102E` (`BrandRed*`) | One colour for "this is Maharani" and "you can act here". The icon→splash→chrome handoff has no seam, and a selected control is unmistakable at arm's length in a shop. |
| Supporting surfaces (selected tiles, indicators, badges, soft blocks) | Brand red 50/100 (`BrandRed50`, `BrandRed100`) | The pink supporting tone; keeps a red selection from becoming a red screen. |
| "New launch", offers/highlights, secondary accents | Saffron (`Saffron*`) | The warm second accent for "worth a look". Never used for money, stock or a destructive action. |
| Errors, destructive actions, out-of-stock | Rose (`error`, `OutOfStockRose*`) | Failure and unavailability stay legible next to a red brand: they are rose-pink surfaces with deep rose ink, and out-of-stock is never rendered in the brand red. |
| Page background, card surfaces | Warm neutrals (`NeutralPage #F7F6F7`, `Neutral50–300`) + white cards | Light, airy, high-contrast text without the cool, blue-tinted greys that made the whole app look blue even where nothing was. |
| In stock | Green (`inStock`, `inStockSurface`) | The one green in the product grid, so "can I order it" is answered at a glance. |

The Material 3 scheme in `theme/Theme.kt` is built from these palettes (light and
dark), so screens reference `MaterialTheme.colorScheme.*` or
`MaharaniThemeTokens.colors.*` — never a literal hex. There is no blue anywhere
in the app layer: `MaharaniPalette` no longer defines an action-blue family at
all, so a blue control cannot be reintroduced by accident. (The **web**
storefront keeps its own `action` blue in `tailwind.config.ts`; that is a web
token, not an app one, and `tests/pdp-flipkart-style.test.ts` still pins it.)

`themes.xml` keeps `@drawable/ic_launcher_foreground`, `@color/brand_red` and
`postSplashScreenTheme` exactly as before — the launcher and splash identity is
unchanged, and the static guard in `tests/android-project-integrity.test.ts`
still asserts it.

---

## 3. Design tokens

`core/designsystem/theme/Dimensions.kt` — one source for every dimension, so a
card radius cannot drift between screens:

| Group | Values |
| --- | --- |
| Spacing | `spaceXxs 2` · `spaceXs 4` · `spaceSm 8` · `spaceMd 12` · `spaceLg 16` · `spaceXl 24` · `spaceXxl 32` |
| Layout | `pageGutter 16` · `cardGap 10` · `touchTarget 48` · `searchFieldHeight 46` · `bottomBarHeight 64` |
| Radii | `radiusCard 16` · `radiusTile 12` · `radiusField 26` · `radiusChip 8` · `radiusPill 999` |
| Media | `productImageRatio 1:1` · `railCardWidth 168` · `categoryTileWidth 88` · `categoryTileImage 64` · `brandTileWidth 84` · `bannerHeight 156` · `heroImageHeight 300` |
| Elevation | `cardElevation 1` · `appBarElevation 2` (flat, modern; depth comes from borders and tone) |

`theme/ExtraColors.kt` — tokens the Material scheme does not model: `action*` (= brand red),
`inStock*` / `outOfStock*` / `warning*` (stock language), `brandMark*`,
`saffron*`, the app-bar gradient pair (`appBarStart`, `appBarEnd`, `onAppBar`,
`onAppBarMuted`, `appBarField`, `onAppBarField`, `appBarFieldHint`),
`skeletonBase` / `skeletonHighlight` (neutral), `imagePlaceholder` /
`onImagePlaceholder` (neutral),
`scrim`. Light and dark values are both declared; dark mode is not an
afterthought bolted on with `copy(alpha = …)`.

`theme/Typography.kt` — the full M3 role scale (display/headline/title/body/label)
with tightened line heights for dense retail rows.

**Icons.** `material-icons-*` is deliberately *not* a dependency (see the note in
`gradle/libs.versions.toml`). `components/Glyphs.kt` draws the 15 needed marks on
a `Canvas` in a 24×24 grid — search, close, menu, back, chevron, home, category,
cart, orders, account, pin, crown, refresh, filter, sort — each with a content
description. They cost no APK weight, cannot disagree with the theme (they take a
`tint`), and are ordinary composables, so they work anywhere an icon slot does
(`NavigationBarItem.icon`, `FilterChip.trailingIcon`, …).

---

## 4. Reusable components

`:core:designsystem` (no Coil, no feature code — depends on `:core:model` only):

| Component | Contract |
| --- | --- |
| `MaharaniSearchBar` | Rounded field, clear-text button, in-field spinner while `loading`, `onBar = true` variant for the brand app bar, IME search action, `testTag`. On a
page the field is a soft neutral well with a hairline edge rather than a
shadowed white pill. Never shows trending/fake suggestions. |
| `SectionHeader` | Title + optional subtitle + optional `View all` action with a chevron. |
| `StockBadge` | Two-state pill with a status dot. `UNKNOWN` is styled as a **warning** and reads "Stock not confirmed" — it is never dressed as in-stock. `compact` for cards. |
| `FactChip` | Neutral wholesale fact (pack size, MOQ, pcs/case). Ellipsises rather than overflowing a narrow card. |
| `PriceBlock` | One price renderer for the whole app: `PriceEmphasis.Card` (rails, grid), `.Detail` (PDP hero), `.Compact` (dense rows). `null` → "Price unavailable" — **never ₹0**. An MRP is struck through only when the server actually sent one. |
| `PagerDots` | Gallery indicators (active dot widens). |
| `Skeletons` | `SkeletonSurface`, `SkeletonBlock`, `ProductCardSkeleton`, `ProductSkeleton` (alias, the deliverable name), `ProductGridSkeleton(columns, rows)`, `ProductRailSkeleton`, `CategoryRailSkeleton`, `BannerSkeleton`, `HomeSkeleton`. One shared 0.55→1 pulse keeps every skeleton on a screen breathing in step. |
| `StateSurfaces` (pre-existing) | `LoadingState`, `EmptyState`, `ErrorState`, `OfflineState`, `UnavailableFeatureState`. |
| `MoneyFormat` | `formatPaise` (full, grouped) and `formatPaiseShort` (chips/case prices). Integer paise in, string out; no arithmetic on money anywhere in the UI. |
| `labels/` | `CatalogLabels.kt` (`PackAvailability.label()`), `SessionLabels.kt` (role, workspace, retailer status). Customer-facing vocabulary in one place. |

`:feature:catalog/ui/components` (Coil lives here — `:core:designsystem` has no
image dependency, so image-bearing components cannot be pushed into it):

| Component | Contract |
| --- | --- |
| `ProductImage` | `SubcomposeAsyncImage` + Coil: skeleton while loading, a neutral initial-letter tile on `imagePlaceholder` when there is no URL or the fetch fails. Consistent aspect ratio, `contentDescription` from the product name. |
| `BannerCarousel` | `HorizontalPager` of the server's active banners, rounded, cropped, `PagerDots`, and an auto-advance that yields to a swipe already in progress; a rooted `linkUrl` is tappable, anything else is not. Empty list → the caller shows its own neutral panel. |
| `CategoryTile` / `BrandTile` / `CategoryCard` | Rail chips and grid cards over the real taxonomy; missing images degrade to the placeholder tile, never to a broken frame. |
| `ProductCard` | The atom of every rail and grid: image (dimmed when out of stock), brand, 2-line name, pack/unit chips, `PriceBlock`, `StockBadge`, server `isNewLaunch` / `hasOffer` badges. |
| `ProductGrid` + `LazyGridScope.productCardItems` | `GridCells.Adaptive(158.dp)` — two columns on a typical phone, more on a tablet — with an optional full-span `footer` slot used for the pagination footer. |
| `CatalogComponents` | `CatalogTags`, `NewLaunchBadge`, `OfferBadge`, `MetaLabel`. |

---

## 5. Screens

### 5.1 Retailer home (`RetailerHomeScreen` + `HomeViewModel`)

Data: `GET /api/mobile/v1/home` (banners, categories, brands, first catalogue
batch, `nextCursor`) **plus** one `GET /api/mobile/v1/catalog/products?sort=newest`
batch for "Recently added" — the same endpoint and the same server ordering the
web catalogue uses. The two requests run concurrently (`async`), and the rail
de-duplicates against the discovery batch by product id, so a shopper never sees
the same card twice on one screen.

Order on screen: banner carousel (or the neutral `WelcomePanel` when the server
published none) → *Shop by category* rail → *Shop by brand* rail → *Recently
added* rail → *Browse products* grid → the GST-inclusive pricing footnote.

States: skeleton on first load; offline and server-error get separate surfaces
with retry; a failed **refresh keeps the loaded content** and explains itself in
an inline banner above it; a genuinely empty shop says "Nothing to show yet".
A failure of the newest-first batch only hides that rail — one extra rail must not
be able to take the shop down.

The search field lives in the app bar (reference layout), is always visible, and
submits to the real catalogue search — no invented trending searches, no
client-side suggestion list.

### 5.2 Categories and Brands panes (`CatalogScreen` + `CatalogViewModel`) — as built

> **As built (2026-10-06).** The separate `CategoriesScreen`/`CategoriesViewModel`
> sketched below was not kept: two directories meant two implementations of the same
> selection, empty and failure states, and two places for a filter to behave
> differently. The shipped design is ONE catalogue with three panes —
> `[Products] [Categories] [Brands]` — implemented by `CatalogTabStrip`, the two
> directory panes inside `CatalogScreen`, and `CatalogViewModel`. `CategoriesScreen`,
> `CategoriesViewModel` and `CategoriesViewModelTest` no longer exist; the drawer's
> Categories entry opens `CatalogScreen` on its Categories pane. The paragraph below
> is kept as the design intent it was.

Data: `GET /api/mobile/v1/catalog/categories` and `/brands` (loaded
concurrently). Responsive grid of directory tiles (`CategoryCard`, `BrandCard`)
with real names, real images and the server's rolled-up active-product counts.
Tapping a category or brand applies that filter and switches to the Products
pane, so the selection is immediately visible in real products.

The field at the top narrows the **already loaded** names on the device. It is a
directory filter, not a server search, and it cannot surface a category the
server did not send; it fires no request (pinned by `CatalogViewModelTest` —
"reads the two directory endpoints once", "narrows the directory panes on the
device without a request").

### 5.3 Catalogue (`CatalogScreen` + `CatalogViewModel`)

Pinned header: `MaharaniSearchBar`, category `FilterChip` row, a sort menu (every
`CatalogSort` the server accepts, including `newest`), an "In stock" chip, and a
dismissible brand chip when a brand filter arrived from another screen. Below it,
one honest line: the server's exact `resultCount`, a disclosure when
`resultCapped` is true ("Showing the first matches only…"), and the active
category/brand scope.

Grid: `ProductGrid`, cursor pagination driven **only** by the server's `hasMore`
and opaque `nextCursor`; batches de-duplicated by id; a repeated cursor ends the
list. The footer says "Loading more products…", offers "Try loading more again" on
failure, and ends with "You have seen every product in this list." — an explicit
end instead of an endless spinner.

### 5.4 Product detail (`ProductDetailScreen` + `ProductDetailViewModel`)

Data: `GET /api/mobile/v1/catalog/products/{id}` — every active pack priced for
this retailer.

Layout: paged gallery (pack images, then product images) with dots and a `1/3`
counter → brand, name, category · unit → the pricing panel (per-piece rate,
server-struck MRP when present, GST percent, the **server-computed**
`lineTotalAtMoqPaise`, MOQ / pcs-per-case / derived case price chips, and the
server's MOQ and pricing-engine message verbatim when it refused the pack) → pack
selector → slab-rate table → product facts (HSN, unit, GST, lead time, category,
brand) → the ordering note. The sticky bottom bar repeats server price, pack, MOQ
and stock, then offers **Add _MOQ_ pieces to cart** only when price, MOQ and
availability are valid. The button submits only the selected pack id and piece
quantity; no money or stock data comes from the device. It writes to the same
persistent retailer cart as the web workspace. The shared cart accepts whole
piece quantities at a one-piece increment; MOQ is a separate minimum and
`allowLoosePieces` does not create a case-size step.

A cart-write timeout is treated as uncertain: the screen asks the shopper to
refresh the shared cart before another mutation, rather than replaying an add and
risking a duplicate quantity. Checkout gets a fresh server quote and the order
transaction rechecks current price, GST, coupon, Coins, eligibility, MOQ and
stock before it confirms.

Back navigation preserves catalogue context: the detail route is pushed on top of
the catalogue entry, the grid keeps its own `LazyGridState`, and the bottom bar
hides on the detail route so the shopper is reading a product, not a tab.

### 5.5 Account tab (`app/ui/AccountScreen.kt`) — new

The verified `SessionSnapshot`, rendered as a profile: initials avatar, name,
email, phone, role chip; the shop card (name, approval status) when the server
sent a retailer; the access card (status, expiry in UTC) when it sent an access
window; the workspaces the server's policy grants; sign out (the real session
controller's); and the app version from `BuildConfig`. No new endpoint, no
editable field, nothing fetched twice.

### 5.6 Shell (`AuthenticatedShell`)

`Scaffold` + `NavigationBar` + `ModalNavigationDrawer`, all driven by
`MaharaniRouter.resolveSession(snapshot)`:

- Bottom bar = the destinations the router allows, intersected with
  `Home · Categories · Cart · Orders · Account`, in catalog order. A retailer gets
  all five; an admin gets Home · Orders · Account. Nothing in the bar is
  hardcoded per role.
- The bar hides on `catalog/product/{id}`.
- The drawer keeps the destinations that are **not** tabs (Catalogue, Coins,
  Notifications, workspace screens) plus sign out.
- Retailer home gets the gradient shopping app bar (crown mark, "Maharani
  Traders", the verified shop name, account action, search field); every other
  route gets a plain M3 top bar with a back arrow on product detail.
- Unbuilt destinations render `UnavailableFeatureState` with their planned phase
  label — honest tabs, not fake features.

Role handling is unchanged: the retailer shopping home requires
`role == RETAILER` **and** the `CATALOG` grant; every other role keeps
`SessionHomeScreen`. Phase D added two destinations — `CATEGORIES`
(`workspace = RETAILER`) and `ACCOUNT` (`workspace = null`, shared) — both with
`phase = null` because they became real screens in that phase. Phase E later
activated the retailer `CART` and `ORDERS` destinations. `routes.first()` is
still `HOME`, and `MaharaniRouterTest`'s built sets were updated with each phase.

---

## 6. Data honesty rules (enforced by construction)

1. Prices are integer paise from the server; the UI formats, never computes. The
   only derived string is `formatPaiseShort` for chips.
2. `null` price → "Price unavailable". Never ₹0, never a dash that reads as free.
3. Stock is the two-state RPC vocabulary. `UNKNOWN` → "Stock not confirmed" in a
   warning tone. No stock counts exist in the API and none are shown.
4. No ratings, no review counts, no discount percentages, no "₹X off", no
   crossed-out price unless the server sent `mrpPaise`, no countdown, no
   "trending", no personalised "for you".
5. `isNewLaunch` and `hasOffer` are server booleans; the badges are labels, not
   marketing copy.
6. Banners are the admin's. With none active, the home shows a neutral branded
   panel that states how pricing works — it never invents a campaign.
7. Pagination truth: server `hasMore` + opaque cursor, dedupe by id, repeated
   cursor terminates the list.
8. A failed refresh keeps content and explains; a first-load failure shows an
   error; offline is its own state.
9. MOQ, pack size and units-per-case appear only when the pack row carries them.

---

## 7. Documented API gaps → what the UI does instead

Nothing below is faked. The first rows distinguish Phase E features now backed by
`docs/NATIVE_ANDROID_API_CONTRACT.md` §2.4 from endpoints that remain intentionally
outside this native slice.

| Idea | Contract status | What the app does |
| --- | --- | --- |
| "Deliver to <area>" in the app bar | `/session` and `/home` carry no area name; `GET /areas` is the registration picker, not the retailer's own service area. | Shows the verified **shop name**. Adding a `deliveryArea` field to `/session` or `/home` would enable a location chip later. |
| Cart badge / cart screen | Implemented: authenticated shared-cart read/mutation, MOQ validation, address choices, server quote, coupon pointer, and atomic idempotent order placement. No cart-count badge endpoint exists. | `CART` is a real tab; the PDP adds the selected pack at its MOQ. The UI never computes totals or stock and refreshes after an uncertain cart write. |
| Orders list / order detail | Implemented: owner-scoped history, detail and request-recovery reads. Cancellation, returns, reorder, invoice and delivery-tracking endpoints are not part of this API slice. | `ORDERS` shows actual server statuses, timestamps, totals and item snapshots. Unsupported actions are not simulated. |
| Notifications bell | No mobile notifications endpoint; the notifications destination is Phase F. | No bell. The `NOTIFICATIONS` destination stays in the drawer as a planned feature. |
| Maharani Coins | Checkout reuses the existing server Coins rule; a separate native wallet/ledger screen is not implemented. | Checkout shows only the server quote and committed order snapshot; no client debit or payment flow. |
| Search suggestions / trending | No suggestion endpoint; a client-side list would be invented data. | Search submits to the real catalogue query; the field shows clear-text and loading states only. |
| Ratings & reviews | Not in the catalogue contract. | Omitted entirely. |
| Favourites | `isFavorite` is readable on the wire but there is no write endpoint. | Read-only; no heart control that could silently fail. |
| Schemes / coupons / offers list | `hasOffer` is a boolean only; no offer detail endpoint. | `OfferBadge` reflects the boolean and nothing more. |
| Saved carts / cancel / return / reorder / invoice / tracking | Endpoints are not implemented in the native/API Phase E slice. | Not shown or simulated. |
| Pull to refresh | Kept out to avoid a half-gesture; refresh is an explicit retry/`load()` path. | Retry buttons in every error state; the home reloads on `load()`. |

---

## 8. Accessibility, responsiveness, motion

- Every interactive target is ≥ 48dp (`MaharaniDimens.touchTarget`; icon buttons
  are 40–48dp inside padded rows, chips and cards carry their own padding).
- Content descriptions on glyphs, images (`fallbackLabel`), stock badges
  (`availability.label()`) and the search field.
- System-bar insets: the shopping app bar draws edge-to-edge behind the status bar
  and pads its own content (`WindowInsets.statusBars.only(Top + Horizontal)`);
  `Scaffold` handles the rest, `NavigationBar` pads the gesture bar.
- Responsive: `GridCells.Adaptive(158.dp)` gives two columns on a 360dp phone and
  more on a tablet or landscape; rails scroll horizontally; long names clamp to
  two lines with ellipsis; weighted chips ellipsis instead of overflowing; prices
  use `weight(1f, fill = false)` so a large amount cannot push the stock badge off
  the card.
- Motion is restrained: one shared skeleton pulse, pager transitions, chip
  selection. No parallax, no autoplaying video, no shimmer sweep per item.
- Dark mode: every token has a dark value; no screen hardcodes a colour.

---

## 9. Performance

- Coil 3.4.0 (the pinned ceiling) with the application-wide `ImageLoader` in
  `MaharaniApplication`; `SubcomposeAsyncImage` so a placeholder never allocates a
  second bitmap pipeline.
- One `LazyVerticalGrid` per screen. Rails inside a grid are full-span `item`s
  containing a `LazyRow` — the only nesting, and it is horizontal-inside-vertical,
  which Compose handles without nested-scroll ambiguity.
- Pagination appends; it never re-fetches page one. Repeated cursors terminate.
- State is a single immutable `UiState` per ViewModel (`StateFlow` +
  `collectAsStateWithLifecycle`), so a screen recomposes on the fields it reads.
- `rememberPagerState`, `rememberLazyGridState`, `rememberSaveable` for the search
  text; no `LaunchedEffect` that re-runs per frame.

---

## 10. Verification — Phase E repository checks

Ran on the current Phase E worktree:

| Check | Result |
| --- | --- |
| `corepack pnpm run typecheck` | Passed (`tsc --noEmit`). |
| `npx --no-install vitest run` | Passed: 101 files / 1,991 tests, including mobile address ownership, commerce API, atomic checkout database, cart MOQ/quantity, retry/recovery and history coverage. |
| `npm run lint` | Passed. Existing warning only: `<img>` in `components/admin/product-image-manager.tsx:110`. |
| `npm run build` | Passed: Next.js production build, 114 pages generated; same existing `<img>` warning. |
| `git diff --check` | Passed. |
| `./gradlew testDebugUnitTest lintDebug assembleDebug` (from `android/`) | **Not run:** Gradle exits before task configuration because `JAVA_HOME` is unset and no `java` executable exists. `ANDROID_HOME` and `ANDROID_SDK_ROOT` are also unset, common SDK paths and the local Gradle wrapper distribution cache are absent. Gradle therefore did not reach SDK or network resolution; no APK or Android test/lint result is available. |

The PGlite database suite verifies transaction rollback, stock/MOQ/price/coupon/Coins
revalidation, exact cart clearing and replay. Its harness uses one database connection;
its scheduled duplicate-call test is not proof of contention between independent
PostgreSQL sessions. The advisory-lock concurrency contract still needs a multi-session
PostgreSQL integration check in CI or a configured environment.

A web typecheck/build or static Kotlin inspection is not an Android compile. The new
Kotlin/Compose code and Android unit tests remain unverified by Gradle until a compatible
JDK 17+ and Android SDK are available.

---

## 11. Phase D UI redesign changed files

The list below records the catalogue/home redesign before Phase E; the cart/order files
added by Phase E are described in `docs/NATIVE_ANDROID_API_CONTRACT.md` §2.4.

New — design system (`:core:designsystem`):

- `theme/Dimensions.kt`
- `components/Glyphs.kt`
- `components/MaharaniSearchBar.kt`
- `components/SectionHeader.kt`
- `components/StockBadge.kt` (`StockBadge`, `FactChip`, `STOCK_BADGE_TAG`)
- `components/PriceBlock.kt` (`PriceBlock`, `PriceEmphasis`, `PRICE_BLOCK_TAG`)
- `components/PagerDots.kt`
- `components/Skeletons.kt`
- `labels/CatalogLabels.kt`

New — feature (`:feature:catalog`):

- `ui/components/ProductImage.kt`, `BannerCarousel.kt`, `CategoryTile.kt`
  (`CategoryTile`, `BrandTile`, `CategoryCard`), `ProductCard.kt`, `ProductGrid.kt`
- `ui/components/CatalogTabStrip.kt`, `ui/components/DirectoryCards.kt`
  (`DirectoryAllCard`, `CategoryCard`, `BrandCard`)
- `CatalogTabs.kt` (`CatalogTab`), `src/test/…/CatalogViewModelTest.kt`

New — app (`:app`):

- `ui/AccountScreen.kt`

Rewritten:

- `ui/RetailerHomeScreen.kt`, `ui/CatalogScreen.kt`, `ui/ProductDetailScreen.kt`,
  `ui/CatalogComponents.kt`, `HomeViewModel.kt`
- `app/navigation/AuthenticatedShell.kt` (bottom bar, gradient shopping app bar,
  drawer split, new destinations)

Edited:

- `theme/Color.kt`, `theme/ExtraColors.kt`, `theme/Theme.kt`, `Money.kt`
  (`formatPaiseShort`)
- `CatalogViewModel.kt` (`brandLabel`, `selectBrand`, `clearFilters`)
- `app/navigation/MaharaniDestinations.kt` (`CATEGORIES`, `ACCOUNT`)
- `app/ui/BrandSplash.kt` (pinned to brand red)
- `app/src/test/…/MaharaniRouterTest.kt`, `feature/catalog/src/test/…/FakeCatalogApi.kt`
  (`brandsResult`, `nextCategoriesFailure`)

Deleted:

- `ui/ProductCardTile.kt` — superseded by `ui/components/ProductCard.kt` (one card
  implementation, not two).

---

## 12. Later work (not part of Phase E)

1. A verified `deliveryArea` field on `/session` or `/home` could replace the shop-name app-bar slot with a delivery-area chip.
2. A real search-suggestions endpoint could use `MaharaniSearchBar`'s loading slot; no local suggestion list should be fabricated.
3. Favourite writes need an authenticated backend endpoint; the current `isFavorite` field remains read-only.
4. Saved carts, whole-cart deletion, cancellation and returns need separately verified server
   contracts before they appear in the native app. Reorder, invoices and delivery tracking were
   added later against verified contracts — see `docs/NATIVE_PWA_FEATURE_PARITY.md` (ORD-03,
   ORD-04, ORD-05) for their current state.
5. A standalone Coins wallet/history screen belongs to later native work; checkout continues to use only the existing server-owned Coins calculation and debit rules.

---

## 13. The directory fix and the red-primary catalogue (latest change)

### 13.1 Why Categories and Brands showed nothing

Both taxonomy endpoints built their read with an **embedded aggregate and a
child filter**:

```
categories?select=id,name,image_url,parent_id,products(count)&products.is_active=eq.true
brands?select=id,name,logo_url,products(count)&products.is_active=eq.true
```

Three things are wrong with that, and only the third is visible in a browser:

1. `products(count)` is a **PostgREST aggregate embed**, and aggregates are
   opt-in per project (`db-aggregates-enabled`). Where they are not enabled the
   whole request fails, no rows come back.
2. A filter on an embedded resource narrows the *parent* rows as well, so an
   embed filter is not a safe way to count children.
3. The service mapped `data === null` (i.e. **the read failed**) to `[]`.

So a failing query became a successful, permanently empty directory: the
Categories and Brands panes rendered "no categories yet" at HTTP 200, and their
Retry re-read the same failing query, because as far as the client could tell
there was nothing to retry. The Products pane never used the aggregate, which is
exactly why only these two panes looked dead.

### 13.2 What it does now

- The taxonomy is read with **plain columns** (`id, name, image_url, parent_id` /
  `id, name, logo_url`), `is_active`, `order`, through the caller's own
  RLS-scoped bearer client — the same query shape every other read in this API
  already uses.
- A failed read **throws**, and the route answers `503 database_unavailable`
  with a message that asks the shopper to try again. An empty list now means
  exactly one thing: the shop publishes no categories (or no brands).
- `productCount` is derived from the shop's **real active product rows** by a
  bounded keyset scan (500 rows/page × 10 pages, two small columns). When the
  scan cannot complete, the count is `null` and the tile says "Tap to browse" —
  never a truncated sum, never an invented zero. A category with genuinely no
  products reports `0`.
- The product filter path is untouched: `loadCatalogBatch` still scopes a
  category to `id` + its published children and a brand to `eq('brand_id')`, so
  a parent category still shows everything under it.
- Authentication, retailer-role gating, RLS and the `read.catalog` rate limit are
  unchanged. The home screen keeps its deliberate asymmetry: a taxonomy outage
  degrades its two rails only.

### 13.3 The catalogue UI

| Requirement | How it is met |
| --- | --- |
| Real taxonomy, no fakes | Categories and Brands panes render exactly the rows the server returned, with the server's own names, images and counts. Nothing is hardcoded, mocked or estimated on the device. |
| Segmented control | `CatalogTabStrip`: one pill, three equal 48dp segments. Selected = filled brand red + white semibold label; unselected = muted ink on the neutral track. `Role.Tab` per segment, inside a `selectableGroup`, so it is announced as a tab set and never reads as a disabled button. |
| Always know where you are | Brand app bar (name never truncated) + the selected segment + the applied scope as a removable chip + a "Showing…" line under the count. |
| Category / brand tiles | 2-column grid, 96dp artwork band, two-line name, one server fact line. Selected state carries three cues (2dp primary border, primary-tinted surface, filled tick badge), so it survives colour-blindness and a screenshot. |
| Product grid | `GridCells.Adaptive(158.dp)` → exactly two columns at 360/393/412dp, 1:1 artwork band, centred `Fit` images on a light neutral surface, 2-line name, brand, pack chips, price, MOQ and stock state; one card geometry for the grid and its skeleton. |
| Filters and sort | "All" + every real category as chips, the applied brand as its own chip, a sort control that names the current order and opens the full list, and an in-stock switch that is filled when it is on. Every one of them performs a real request. |
| Favourites | 48dp control with a solid backing circle, filled heart in rose when saved, progress while the write is in flight, and one shared store, so the state survives navigation. |
| Bottom navigation | Home · Catalogue · Cart · Orders · Account, selected item in brand red with a pink indicator, server-driven cart badge, and the shell insets the content so the bar never covers the last row. |
| Loading / empty / error / retry | All three panes: skeletons while loading, "No products found" / "No categories yet" as *empty* (never an error), "No match" for a local filter with no hit, and `ErrorState`/`OfflineState` with a real retry that issues a fresh request. A failed *continuation* keeps the rows already on screen and retries the continuation, not the whole list. |

### 13.4 Files

Backend: `lib/mobile/catalog.ts`, `lib/mobile/catalog-service.ts`,
`app/api/mobile/v1/catalog/categories/route.ts`,
`app/api/mobile/v1/catalog/brands/route.ts`, `tests/mobile-catalog-api.test.ts`.

Android: `theme/Color.kt`, `theme/ExtraColors.kt`, `theme/Theme.kt`,
`theme/Dimensions.kt`, `components/MaharaniSearchBar.kt`, `components/Skeletons.kt`,
`feature/catalog/…/CatalogViewModel.kt`, `ui/CatalogScreen.kt`,
`ui/components/{CatalogTabStrip,DirectoryCards,ProductCard,ProductGrid,ProductImage}.kt`,
`feature/catalog/src/test/…/CatalogViewModelTest.kt`,
`app/navigation/AuthenticatedShell.kt`, `app/ui/BrandSplash.kt`.

### 13.5 What could not be verified here

There is no Android SDK, JDK or Gradle distribution in this working environment
(and no network route to the hosts that serve them), so unit tests, lint and the
APK are **not** run locally: they are run by `.github/workflows/android-apk.yml`
on the pushed commit, and the results — including compiler diagnostics and the
APK artifact — are reported in the pull request. The 360/393/412dp widths are
checked by layout arithmetic (two `Adaptive(158.dp)` columns at every one of
them, fixed 48dp targets, no fixed-width child wider than the viewport) rather
than on a device screen.
