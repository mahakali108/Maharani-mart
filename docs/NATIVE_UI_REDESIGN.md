# Native UI redesign — the Maharani Traders shopping app

Status: implemented on branch `arena/01a100c2-maharani-mart`, **not yet compiled**
(see [Verification](#verification-what-ran-and-what-could-not)).
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

## 2. Identity: blue commerce chrome, red brand, saffron accent

The web app uses two colours for two jobs (`tailwind.config.ts`): `primary`
`#C8102E` (the printed brand red — crown, wordmark, marketing surfaces) and
`action` `#2874F0` (the marketplace blue of shopping chrome). The native app now
does the same, and the split is deliberate rather than a rebrand:

| Surface | Colour | Why |
| --- | --- | --- |
| Launcher icon, system splash (`themes.xml` → `@color/brand_red`), in-app `BrandSplash` | Brand red `#C8102E` | The icon→splash→app handoff must read as one product. `BrandSplash` therefore pins `MaharaniPalette.BrandRed600` instead of following `colorScheme.primary`. |
| App bars, bottom bar selection, links, primary buttons, focus | Maharani blue (`ActionBlue*`) | Shopping chrome. Blue is the marketplace's "you can act here" colour and keeps long sessions calm. |
| "New launch", slab-rate highlight, small accents | Saffron (`Saffron*`) | A restrained warm accent for "worth a look", never for money or stock. |
| Errors, destructive actions, out-of-stock | Red / rose | Brand red doubles as the error colour, so red still means "stop". |
| Page background, card surfaces | Cool greys + white | Light, airy, high-contrast text. |

The Material 3 scheme in `theme/Theme.kt` is built from these palettes (light and
dark), so screens reference `MaterialTheme.colorScheme.*` or
`MaharaniThemeTokens.colors.*` — never a literal hex. The saffron scale and the
cool page greys are the one addition of the native brief: they are **design
tokens, not data**. No product, price, offer or stock value lives in a colour
file.

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

`theme/ExtraColors.kt` — tokens the Material scheme does not model: `action*`,
`inStock*` / `outOfStock*` / `warning*` (stock language), `brandMark*`,
`saffron*`, the app-bar gradient pair (`appBarStart`, `appBarEnd`, `onAppBar`,
`onAppBarMuted`, `appBarField`, `onAppBarField`, `appBarFieldHint`),
`skeletonBase` / `skeletonHighlight`, `imagePlaceholder` / `onImagePlaceholder`,
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
| `MaharaniSearchBar` | Rounded field, clear-text button, in-field spinner while `loading`, `onBar = true` variant for the blue app bar, IME search action, `testTag`. Never shows trending/fake suggestions. |
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

### 5.2 Categories tab (`CategoriesScreen` + `CategoriesViewModel`) — new

Data: `GET /api/mobile/v1/catalog/categories` and `/brands` (loaded
concurrently). Responsive grid of `CategoryCard`s with real names, real images
and the server's rolled-up active-product counts; a brand rail above when the
server published brands. Tapping a category or brand opens the catalogue scoped
to it.

The field at the top narrows the **already loaded** names on the device. It is a
directory filter, not a server search, and it cannot surface a category the
server did not send; it fires no request (pinned by
`CategoriesViewModelTest`).

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
`lineTotalAtMoqPaise`, MOQ / pcs-per-case / derived case price chips,
"Sold in whole cases only" when `allowLoosePieces` is false, and the pricing
engine's own `message` verbatim when it refused the pack) → pack selector →
slab-rate table → product facts (HSN, unit, GST, lead time, category, brand) →
the ordering note. A sticky bottom bar repeats price, pack, MOQ and stock.

**There is no "Add to cart" button.** Cart and checkout are Phase E; a control
that looks like it works but cannot place an order would be a lie, and the
migration contract forbids it. The screen says so once, plainly:

> Ordering from the app arrives with the cart & checkout phase. Until then the web
> workspace remains the order desk — the prices, slabs and stock on this screen are
> exactly what it will charge.

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
`SessionHomeScreen`. Two new destinations were added to the catalog —
`CATEGORIES` (`workspace = RETAILER`) and `ACCOUNT` (`workspace = null`, shared) —
both with `phase = null` because they are real screens now. `routes.first()` is
still `HOME`, and `MaharaniRouterTest`'s "built" sets were updated in the same
change (retailers now assert `CATEGORIES` and `ACCOUNT` are present; admins assert
`ACCOUNT` is present and `CATEGORIES` is not).

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

Nothing below was faked. Each row is a design idea from the brief that the current
wire contract (`docs/NATIVE_ANDROID_API_CONTRACT.md` §2.3) cannot support.

| Idea | Why it is not on screen | What the app does |
| --- | --- | --- |
| "Deliver to <area>" in the app bar | `/session` and `/home` carry no area name; `GET /areas` is the registration picker (`areaId` + name), not the retailer's own service area. | Shows the verified **shop name** instead — real data, same slot. Adding a `deliveryArea` field to `/session` or `/home` would enable the location chip with no client change beyond one line. |
| Notifications bell | No mobile notifications endpoint; the notifications destination is Phase F. | No bell. The `NOTIFICATIONS` destination stays in the drawer as a planned tab. |
| Cart badge / cart screen | No cart summary endpoint reachable from mobile. | `CART` tab renders `UnavailableFeatureState` ("Planned · Phase E"). The PDP has no add-to-cart. |
| Orders list / order detail | No mobile order-history endpoint. | `ORDERS` tab renders the same honest placeholder. |
| Maharani Coins | No coins endpoint for mobile. | Drawer entry, planned placeholder. |
| Search suggestions / trending | No suggestion endpoint; a client-side list would be invented data. | Search submits to the real catalogue query; the field shows clear-text and loading states only. |
| Ratings & reviews | Not in the catalogue contract. | Omitted entirely. |
| Favourites | `isFavorite` is readable on the wire but there is no write endpoint. | Read-only; no heart control that could silently fail. |
| Schemes / coupons / offers list | `hasOffer` is a boolean only; no offer detail endpoint. | `OfferBadge` reflects the boolean and nothing more. |
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

## 10. Verification — what ran and what could not

Ran in this environment:

| Check | Result |
| --- | --- |
| `npm run typecheck` (`tsc --noEmit`) | Clean. |
| `npx vitest run` (whole web suite) | 98 files / 1951 tests passed. |
| `tests/android-project-integrity.test.ts` | 23/23 passed — including "every `colors.<x>` / `MaharaniPalette.<X>` is declared", cross-module imports have Gradle deps, test doubles implement every interface member, Coil ceiling, no `material-icons`, no WebView/Capacitor, manifest/theme/network-config invariants. |
| `tests/mobile-safety.test.ts` | 6/6 passed. |
| Tree-sitter parse of every Kotlin file (`web-tree-sitter` + `tree-sitter-kotlin.wasm`) | 111 files parsed; the only 2 "problems" are the known grammar limitation on `fun interface` (`core/common/TimeSource.kt`, `core/network/AuthInterceptor.kt`), both pre-existing and both valid Kotlin. |
| Static cross-reference audit (script) | Every `MaharaniDimens.*`, `MaharaniThemeTokens.colors.*`, `MaharaniPalette.*`, typography role, tag constant, enum member and `com.maharanitraders.*` import used by the changed files resolves to a real declaration; no duplicate top-level declarations per package. |
| Compose audit (script, mutation-tested) | Modifier-extension imports, unresolved Compose class references and `@Composable` presence on every function that calls a composable. The auditor was validated against a planted broken file (flagged 4/4, then deleted). It found two real compile errors, both fixed: a missing `fillMaxWidth` import in `ui/components/ProductGrid.kt` and a non-existent token `tokens.onAppBarFieldHint` → `tokens.appBarFieldHint` in `MaharaniSearchBar.kt`. |
| Scope review | All 17 `Modifier.weight(...)` and 4 `Modifier.align(Alignment.*)` sites hand-verified inside `RowScope` / `ColumnScope` / `BoxScope`. |

Full probe evidence, the exact blocker, and step-by-step reproduction on GitHub
Actions or a local machine: **`docs/ANDROID_BUILD_VERIFICATION.md`**.

Could **not** run here, and therefore is **not** verified:

| Check | Why |
| --- | --- |
| `./gradlew assembleDebug` (debug APK) | No JDK, no Android SDK, no Gradle distribution in the sandbox, and Maven Central / Gradle services / Adoptium are unreachable, so nothing can be downloaded. |
| `./gradlew testDebugUnitTest` (JVM unit tests, incl. the new `CategoriesViewModelTest`) | Same reason. |
| `./gradlew lintDebug` | Same reason. |
| `next lint` / `next build` | Not required: **no backend, web or config file changed**. They were not run. |

A tree-sitter parse and a symbol cross-reference are *not* a Kotlin compile. The
new and rewritten Kotlin is unproven against `kotlinc`; expect to run the three
Gradle commands above on a machine with a JDK 17+ and the Android SDK before
trusting this build. The Compose APIs used are all stable in the pinned versions
(`composeUi 1.10.3`, `composeMaterial3 1.4.0`, `navigation-compose`,
`hilt-navigation-compose`, `coil-compose 3.4.0`), and no dependency was added.

---

## 11. Changed files

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
- `CategoriesViewModel.kt`, `ui/CategoriesScreen.kt`
- `src/test/…/CategoriesViewModelTest.kt`

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

## 12. Follow-ups for Phase E (cart & checkout)

1. Wire `CART` and `ORDERS` to real endpoints; the tabs, their icons and their
   routes already exist, so the switch is a `DestinationSurface` branch.
2. Add `Add to cart` on the PDP **only** with the cart endpoint: the sticky bottom
   bar already reserves the space, and the pack selector already carries the pack
   id the API needs.
3. `deliveryArea` on `/session` or `/home` → one line in `RetailerHomeTopBar`.
4. Search suggestions endpoint → `MaharaniSearchBar` already has a `loading` slot;
   a suggestion list should be a new component below the field, not a fabricated
   local list.
5. Favourite writes → the `isFavorite` flag is already mapped, so the heart is a
   repository call away.
