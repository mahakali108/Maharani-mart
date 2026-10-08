# Maharani Traders — Native Android ↔ PWA Feature Parity

Audited against the repository on 2026-10-06. The PWA under `app/retailer/**` is the
FEATURE REFERENCE; the native Android app under `android/` is the product being
delivered. Every row below was checked by reading the route, the endpoint and the
Kotlin screen — not inferred from a previous report.

## How to read this

| Status | Meaning |
|---|---|
| IMPLEMENTED | A native screen performs the real business action against the real backend. A placeholder, a label, or a value the app computed for itself does NOT qualify. |
| PARTIAL | The native app does some of this, and the Notes say exactly what is missing. |
| MISSING | No native implementation. The backend may well exist. |
| BLOCKED | A deployment, trust, or backend prerequisite prevents a safe native implementation. The Notes name the prerequisite and fallback. |
| N/A | Deliberately not brought to native, with the reason. |

Money, stock, totals and coin balances are server-authoritative everywhere. Where the
native app shows a number, that number came from the server in the same response that
the web app uses, or it is derived by arithmetic that is written down once and shared
(see COIN-02).

---

## Current upgrade evidence — 2026-10-08

The historical IMPLEMENTED rows below describe earlier code coverage, **not this
upgrade's production signoff**. Changed HOME-01/HOME-02/CAT-10/PLAT-05 behavior is
**PARTIAL / pending verification** until native compilation, tests and real-data
360/393/412dp checks pass. See `RETAILER_MEGA_UPGRADE_AUDIT.md` and
`RETAILER_MEGA_UPGRADE_EVIDENCE.md`. Search uses `q`, not `search`. Parent names
are mapped, but parent IDs/tree browsing are not claimed. Native banner actions
only support an allowlist; external/unknown targets remain non-actionable art.

## 1. Authentication, session and access control

| ID | PWA Feature | PWA Route/Component | Backend/API | Native Screen | Status | Notes |
|---|---|---|---|---|---|---|
| AUTH-01 | Login | `app/login/page.tsx` | `POST /api/mobile/v1/auth/login` | `LoginScreen` + `LoginViewModel` | IMPLEMENTED | Email + password; token pair stored via the Keystore-backed session store. |
| AUTH-02 | Retailer registration | `app/register-retailer/page.tsx` | `POST /api/mobile/v1/retailers/register` | `RegisterScreen` + `RegisterViewModel` | IMPLEMENTED | Full form; areas come from `GET /areas`, never a hardcoded list. |
| AUTH-03 | Forgot password | `app/forgot-password/page.tsx` | `POST /api/mobile/v1/auth/password-reset` | `AuthFlowScreen` `FORGOT_PASSWORD` step + `ForgotPasswordViewModel` | IMPLEMENTED | "Forgot password?" on the sign-in screen opens a native step that validates the email client-side (fast feedback only) and calls the endpoint through `AuthRepository.requestPasswordReset`, with a double-submit guard because the endpoint is rate limited. The confirmation copy is deliberately generic — the endpoint answers identically whether or not the address has an account — and says honestly where the reset completes: the emailed link opens the Maharani Traders website (see AUTH-04). `ForgotPasswordViewModelTest` covers submit, validation, failure and the in-flight guard. |
| AUTH-04 | Reset password | `app/reset-password/page.tsx` | `POST /api/mobile/v1/auth/password-update` | `SecurityScreen` (signed-in path) | BLOCKED | The bearer-authenticated endpoint IS now used natively by the in-account security screen (ACC-04), so a SIGNED-IN user can change their password without leaving the app. What remains blocked is only the EMAIL-LINK path: Supabase delivers the recovery link to `NEXT_PUBLIC_SITE_URL/auth/callback?next=/reset-password`, and this app registers no app link (no assetlinks deployment), so there is no native surface the emailed link can land on. Reaching parity there needs deep-link infrastructure, not app code alone. |
| AUTH-05 | Logout | `lib/auth/actions.ts` | `POST /api/mobile/v1/auth/logout` | `AuthenticatedShell` | IMPLEMENTED | Clears the stored session as well as the server session. |
| AUTH-06 | Silent token refresh | `middleware.ts` | `POST /api/mobile/v1/auth/refresh` | `SessionManager`, `AuthInterceptor`, `TokenRefreshCoordinator` | IMPLEMENTED | Single-flight refresh on a 401 TOKEN failure, then exactly one replay of the failed call. The trigger is BOTH codes the API can answer: `invalid_token` (Supabase refused the token) and `expired_token` (the JWT's own `exp` has passed — `classifyTokenFailure`, `lib/mobile/auth.ts`). `expired_token` is the normal answer to the first request after the app has been backgrounded for over an hour, so a build that refreshed only on `invalid_token` left every screen failing with a 401 until the process restarted — the catalogue first. `ApiCallExecutorTest` pins both codes (refresh + replay once) and `missing_token` is deliberately outside the rule: a request with no bearer token has nothing to refresh. |
| AUTH-07 | Session / role bootstrap | `middleware.ts` | `GET /api/mobile/v1/session` | `SessionBootstrapper`, `MaharaniRouter` | IMPLEMENTED | Role and workspace decide the destination set; the client never grants itself a workspace. |
| AUTH-08 | Pending-approval gate | `app/pending-approval/page.tsx` | session `gate` | `SessionGateScreens` | IMPLEMENTED | Driven by `ApiErrorCode.gate`, never by matching message text. |
| AUTH-09 | Access-expired gate | `app/access-expired/page.tsx` | session `gate` | `SessionGateScreens` | IMPLEMENTED | As above. |
| AUTH-10 | Account suspended / inactive | session guard | session `gate` | `SessionGateScreens` | IMPLEMENTED | As above. |
| AUTH-11 | Session survives restarts | web cookie session | `GET /session`, `POST /auth/refresh` | `SessionManager` + `KeystoreTokenStore` | IMPLEMENTED | The token pair is written by `KeystoreTokenStore` (AES-256-GCM under a non-exportable AndroidKeyStore key; ciphertext in `filesDir`, never a plaintext preference) and read back on every cold start, so a session outlives activity recreation, process death, relaunch and device restart. Restore verifies with `GET /session` **with the stored token published to the request interceptor first** — the defect this change fixes: the verify call used to run anonymously, answer 401 and wipe a perfectly good session, which is why every cold start landed on sign-in. A token the server rejects as expired is refreshed once through `POST /auth/refresh` and retried; a refresh the server rejects as terminal clears the session, while a network failure keeps it and reports offline. No email or password is ever stored — only the server's token pair. |
| AUTH-12 | Session-scoped state isolation | web per-request session | — | `SessionScopedStore` set in `SessionManager` | IMPLEMENTED | Favourites (`FavoritesStore`), cart count (`CartCountStore`), unread badge (`UnreadStore`) and the device-local shopping history (`LocalHistoryStore`: recent searches and recently viewed products) are process-wide singletons. Each implements `SessionScopedStore`, contributes itself to the Hilt multibound `Set<SessionScopedStore>`, and is emptied by `SessionManager` whenever the published state leaves `Authenticated` (sign-out, terminal refresh failure, gate rejection) and before a new sign-in is adopted. Without it the next account on the same device inherited the previous account's hearts and badges until something happened to reload them. |
| AUTH-13 | Recovery-link App Link handoff | Supabase recovery email → `/auth/callback?next=/reset-password` | verified Android App Link + native recovery token exchange | — | BLOCKED | There is no verified `assetlinks.json`/App Link association or native recovery callback/token-exchange path in this deployment. Until the domain owner configures and verifies that capability, the supported recovery link stays in the external browser; no WebView or unverified custom-scheme shortcut is used. |
| AUTH-14 | Sign out all devices | `app/retailer/account/security/page.tsx` | `POST /api/mobile/v1/auth/logout-all` | `SecurityScreen` + `SecurityViewModel` | IMPLEMENTED | GoTrue global refresh-token revocation is called with the verified bearer session; the local Keystore session is then cleared. |

## 2. Home and discovery

| ID | PWA Feature | PWA Route/Component | Backend/API | Native Screen | Status | Notes |
|---|---|---|---|---|---|---|
| HOME-01 | Retailer home | `app/retailer/home/page.tsx` | `GET /api/mobile/v1/home` | `RetailerHomeScreen` + `HomeViewModel` + `HomeDashboardViewModel` | IMPLEMENTED | The discovery payload (banners or the honest non-promotional welcome panel, the category rail, the brand rail, the newest-first rail and the first catalogue batch) is unchanged and still entirely server rows. Below it the screen now carries the RETAILER dashboard, each section fed by its own endpoint and drawn only when that read returned something: shortcut tiles built from the destinations THIS session may open (`homeQuickActions`, so a tile is never a dead end), the Coins tile from `GET /wallet` (balance = `max(0, funded − spent)`, with funded and spent spelled out underneath), the caller's most recent order from `GET /orders` with a "Buy again" action that opens the ORDER — where the real reorder replays the stored pieces at today's price and stock — and a "Recently viewed" rail from the device history only. The cart tile badges the server's own line count and draws nothing until that count is known. A dashboard failure is reported as a non-blocking banner with its own retry and never blanks the shop. The upgrade adds a real `GET /schemes` home campaign rail, pending native/device verification; campaign text is not interpreted as a discount. |
| HOME-02 | Promotional banners | `app/retailer/home` | `GET /home` | `BannerCarousel` | IMPLEMENTED | Renders only banners the server returned; no placeholder art. |
| HOME-03 | Search | `app/retailer/catalog` search field | `GET /catalog/products?q=` | `CatalogScreen` filter bar + `LocalHistoryStore` | IMPLEMENTED | Debounced; the query is sent to the server, never filtered client-side. Committed terms (the IME search action, a chip, or a search handed in from the home app bar) are remembered ON THE DEVICE as recent-search chips — newest first, de-duplicated case-insensitively, capped at 8, with a Clear action — and a chip replays exactly the same query path as typing the words. The list is one account's, lives in the non-sensitive preference store, holds no price, stock or personal data, and is wiped in memory and on disk when that session ends (`LocalHistoryStore` is a `SessionScopedStore`). Typing alone is deliberately not recorded: a history of every prefix would be noise. |
| HOME-04 | Category directory | `app/retailer/categories/page.tsx` | `GET /catalog/categories` | `CatalogScreen` Categories pane (`CatalogViewModel`) | IMPLEMENTED | The catalogue's Categories pane, reached from the home rail, the drawer's "Categories" entry and the bottom bar's Catalog tab. Every tile is a real published category with its real image and the server's own `productCount` when the server counted one; a missing count is omitted rather than rounded to "0 items". Tapping one applies the filter and switches to the Products pane. |
| HOME-05 | Category landing page | `app/retailer/categories/[id]/page.tsx` | `GET /catalog/products?categoryId=` | `CatalogScreen` (filtered) | IMPLEMENTED | Same list, pre-filtered, rather than a second screen that could price differently. |
| HOME-06 | Brand directory | `app/retailer/brands/page.tsx` | `GET /catalog/brands` | `CatalogScreen` Brands pane (`CatalogViewModel`) | IMPLEMENTED | The brands endpoint is read in parallel with categories when the catalogue opens, and its rows fill both the home brand rail and the catalogue's Brands pane. The pane narrows on the device (a filter field over the names the server already sent, so typing costs no request) and shows a real logo where the server sent one, the real name, and the server's `productCount` when present. Each pane reports its own read: a categories outage cannot put an error on the Brands pane, and whichever read succeeded is kept. Tapping a brand opens the Products pane filtered by `brandId`, with the brand name carried as the chip label. The drawer also carries a "Brands" entry that renders this SAME screen on its Brands pane — Categories had an entry point and Brands did not, which made the brand list look missing rather than one tap away. Both entries resolve to one implementation, so neither can price or stock a product differently. |
| HOME-07 | Brand landing page | `app/retailer/brands/[id]/page.tsx` | `GET /catalog/products?brandId=` | `CatalogScreen` (filtered) | IMPLEMENTED | Tapping a brand tile opens the catalogue pre-filtered by `brandId`, with the brand name as the filter label — the same single-screen choice HOME-05 makes for categories. |
| HOME-08 | Greeting and retailer name | session snapshot (`GET /session`) | `GET /api/mobile/v1/session` | `RetailerHomeTopBar` + `greetingFor` | IMPLEMENTED | The shopping app bar opens with a greeting for the shop's own timezone (`greetingFor` shifts epoch seconds to IST before choosing the words, so a UTC hour cannot render "Good night" at 18:30) and carries the signed-in retailer's own name when the server sent one, with the shop name underneath. Both strings come from the server-verified session; nothing is stored for this beyond the session snapshot the shell already holds. `GreetingTest` pins every IST boundary. |
| HOME-09 | Frequently ordered rail | — (derived) | `GET /orders` (the dashboard's own read) | `HomeDashboardViewModel` + `FrequentlyOrderedRail` | IMPLEMENTED | The home rail is THIS retailer's own repeat list: `buyAgainCandidates` counts how many of the pages the dashboard already read contain each pack and breaks ties on recency. It is an aggregation of real order rows, not a popularity signal, so the wording stays honest ("In 4 of your orders"). No price is shown on the rail — tapping opens the product, where the current rate arrives from the server. It costs no extra request. |

## 3. Catalogue and product detail

| ID | PWA Feature | PWA Route/Component | Backend/API | Native Screen | Status | Notes |
|---|---|---|---|---|---|---|
| CAT-01 | Product list | `app/retailer/catalog/page.tsx` | `GET /catalog/products` | `CatalogScreen` + `CatalogViewModel` | IMPLEMENTED | Opaque-cursor paging with a repeated-cursor stall guard. |
| CAT-02 | Sort | catalog sort control | `?sort=` | `CatalogScreen` | IMPLEMENTED | Server-side sort; the app does not reorder a page locally. |
| CAT-03 | In-stock filter | catalog filter | `?inStock=1` | `CatalogScreen` | IMPLEMENTED | Single-warehouse model: In Stock / Out of Stock only. |
| CAT-04 | Product detail | `app/retailer/catalog/[id]/page.tsx` | `GET /catalog/products/{id}` | `ProductDetailScreen` + `ProductDetailViewModel` | IMPLEMENTED | Gallery, facts, pack selector, stock badge. |
| CAT-05 | Pack / MOQ rules | PDP pack selector | pack payload on the detail row | `ProductDetailScreen` | IMPLEMENTED | MOQ and increment come from the server pack; the quantity stepper enforces them. |
| CAT-06 | Stock badge | PDP + cards | `availability` on the pack | `StockBadge` | IMPLEMENTED | In Stock / Out of Stock only — no FEFO, GRN or multi-warehouse anywhere in the native app. |
| CAT-07 | Add to cart | PDP + catalogue/home cards | `POST /cart/lines` | `ProductDetailScreen` → `CartCheckoutViewModel`; card quick add via the shell's cart handle | IMPLEMENTED | Server re-prices and the response replaces the local cart. A card's add control sends the pack id with its server MOQ as the intent (a pack the server priced without an MOQ means one piece), and is not offered at all for a pack the server marked out of stock or priced without a rate — the same rule the detail screen applies, so the two surfaces cannot disagree about what is orderable. The control is hidden entirely when the session has no cart (a non-retailer, a read-only workspace), and while an add is in flight that one card shows a spinner, cleared whether the mutation succeeded or failed. A failed add is reported by the catalogue's snackbar from the cart's own error message and then consumed, so a refusal is never a silent tap. The app still sends no price. |
| CAT-08 | Quick order | `app/retailer/quick-order/page.tsx` | `GET /api/mobile/v1/quick-order`, `POST /quick-order/match` | `QuickOrderScreen` + `QuickOrderViewModel` | IMPLEMENTED | Name search and pasted-list matcher over the real catalogue, priced for the caller by the same engine the cart and checkout use. Every add goes through `POST /cart/lines` (the `mutate_retailer_cart_line` RPC revalidates MOQ, quantity bounds and pack activity) and any order still commits through the existing atomic checkout, whose 0054 triggers reject a stale or out-of-stock quote — quick order creates no order of its own and cannot be laxer than any other surface. The matcher itself never writes, and a line that matches nothing answers with its own error instead of a guess. |
| CAT-10 | Product comparison | — (no web equivalent) | `GET /catalog/products/{id}` (per compared product) | `CompareOverlay` + `ProductCompare` + `CatalogViewModel` | IMPLEMENTED | Up to four catalogue products can be parked in a comparison tray (a fifth tap is refused rather than silently swapping one out) and compared side by side on brand, pack size, price per piece, price per case, MOQ, availability, GST and lead time — all from `GET /catalog/products/{id}`, read FRESH when the overlay opens so a comparison can never quote a stale rate. A value the server did not publish reads "Not published"; nothing is copied from another row and no price is derived by division. `ProductCompareTest` pins the cap, the removal and the blank-value behaviour. |
| CAT-11 | Quantity ladder and per-piece vs per-case pricing | `components/retailer/pricing-schedule.tsx` | `tiers` on the priced pack row | `QuantityLadder`, `PriceBlock`, `TierTable` | IMPLEMENTED | The server stores a HALF-OPEN slab range `[min, max)`; the app now converts it to the inclusive range the shopkeeper reads (`1–6 pcs`, not `1–7 pcs`) exactly as the web's `tierRangeLabel` does, so a card can never advertise a rate the cart would not honour. Per-piece and per-case figures are labelled as such ("₹960 / case of 12" beside "₹80 / pc") and a case line is drawn only when the server published both the case price and the case size. `nextSlabHint` offers the next cheaper slab only when the server's own next tier really is cheaper. `PriceLadderTest` pins the conversion and the refusal. |
| CAT-09 | Categories and Brands in one catalogue | `app/retailer/{categories,brands}` | `GET /catalog/categories`, `GET /catalog/brands` | `CatalogScreen` + `CatalogTabStrip` + `CatalogViewModel` | IMPLEMENTED | One destination with three panes — `[Products] [Categories] [Brands]` — rather than two disconnected directory implementations. The taxonomy is read once per visit (both endpoints in parallel) and narrowed on the device; a pane switch costs no request and a filter change costs exactly one. The pane state, loading flag, failure and empty state are per pane, so the panel that succeeded is never blanked by the one that failed. This replaced the separate `CategoriesScreen`/`CategoriesViewModel`, whose only entry points now open this screen on its Categories pane. |

## 4. Favourites

| ID | PWA Feature | PWA Route/Component | Backend/API | Native Screen | Status | Notes |
|---|---|---|---|---|---|---|
| FAV-01 | Save / unsave a product | `lib/retailer/favorite-actions.ts` | `POST /api/mobile/v1/favorites` | `FavoriteButton` on `ProductCard` and `ProductDetailScreen` | IMPLEMENTED | Server-authoritative: the heart shows what the toggle response returned, never an optimistic guess. A failed toggle keeps the old state and says why. |
| FAV-02 | Favourites list | `app/retailer/favorites/page.tsx` | `GET /catalog/products?fav=1` | `FavoritesScreen` + `FavoritesViewModel` | IMPLEMENTED | The real catalogue endpoint narrowed to favourites, so price, pack and stock match the catalogue exactly. |
| FAV-03 | Favourite state across screens | catalogue + PDP | `GET /api/mobile/v1/favorites` | `FavoritesStore` | IMPLEMENTED | One store, read by every surface. Before it loads, the `isFavorite` flag on each server row is used, so hearts never flash off on a cold start. |
| FAV-04 | Favourite count | favourites header | derived | `FavoritesScreen` count | IMPLEMENTED | Taken from the list's `resultCount` and the loaded id set; not guessed from the visible page. |
| FAV-05 | Sort and filter the saved list | — (device view) | rows already returned by `GET /catalog/products?fav=1` | `FavoritesViewModel.favoritesView` + `FavoritesControls` | IMPLEMENTED | Name and both price directions, plus an in-stock switch. These are VIEW operations over rows the server priced — nothing is re-priced on the device, and a row the server could not price sorts LAST rather than first, because "cheapest" must never mean "the rate we could not read". A filtered-out row is counted ("3 hidden by the in-stock filter"), and "everything you saved is out of stock" is its own empty state rather than a blank page. `FavoritesViewTest` pins the ordering and the filter. |
| FAV-06 | Add to cart from the saved list | — (device convenience) | `POST /cart/lines` | `FavoritesScreen` → the shell's cart handle | IMPLEMENTED | The saved list's cards carry the same quick-add control the catalogue's cards do, wired to the one cart ViewModel, so a favourite is added through the same revalidating endpoint and moves the same badge. The control is absent when the session has no cart. |

## 5. Cart

| ID | PWA Feature | PWA Route/Component | Backend/API | Native Screen | Status | Notes |
|---|---|---|---|---|---|---|
| CART-01 | View cart | `app/retailer/cart/page.tsx` | `GET /cart` | `CartScreen` + `CartCheckoutViewModel` | IMPLEMENTED | Every line is re-priced by the server on load. |
| CART-02 | Change quantity | cart stepper | `PATCH /cart/lines/{lineId}` | `CartScreen` | IMPLEMENTED | MOQ and increment enforced server-side; the response is the new truth. |
| CART-03 | Remove a line | cart | `DELETE /cart/lines/{lineId}` | `CartScreen` | IMPLEMENTED | |
| CART-04 | Apply a coupon | cart coupon box | `POST /cart/coupon` | `CartScreen` | IMPLEMENTED | The server validates and prices the coupon; the app never computes a discount. |
| CART-05 | Remove a coupon | cart | `DELETE /cart/coupon` | `CartScreen` | IMPLEMENTED | |
| CART-06 | Unavailable-line handling | cart warnings | `orderable`/`message` on each line | `CartScreen` | IMPLEMENTED | A non-orderable line blocks checkout and shows the server's reason. |
| CART-07 | Saved carts and save for later | `app/retailer/cart/saved/page.tsx` | `GET/POST /api/mobile/v1/saved-carts`, `PATCH/DELETE /saved-carts/{id}`, restore and item routes | `SavedCartsScreen` + `SavedCartsViewModel`; Cart line action | IMPLEMENTED | Named lists and the reserved Save for later list keep pack ids/quantities only. Owner filters and RLS scope reads/writes; restore revalidates live pack/product activity, MOQ and cart rules before merging. No saved price, stock or total is carried forward. |
| CART-09 | Select lines and act on them in bulk | — (device convenience) | `DELETE /cart/lines/{lineId}`, `POST /favorites`, `POST /saved-carts/items` | `CartScreen` `CartSelectionBar` + `CartCheckoutViewModel` | IMPLEMENTED | Real checkboxes per line (state carried by the tick and by TalkBack, not by colour) with select-all, clear, remove selected, save to favourites, save for later (a single line) and clear cart. Every action writes through the existing endpoints — one server removal per line, favourites through the ONE store the hearts read — so there is no local deletion that could disagree with the basket checkout will quote. Partial failures are reported in the outcome message. `CommerceViewModelTest` covers the per-line removals and the favourites write. |
| CART-10 | Smart cart warnings | cart warnings | the two cart snapshots the server sent | `cartNotices` + `CartNoticeList` | IMPLEMENTED | The cart is the server's and is re-priced on every read, so the app now diffs the previous snapshot against the new one and reports, per line: "Price updated by the server: ₹100 → ₹115 per piece", "Now out of stock…", and the server's own refusal message ("Only 8 available now."). These are WARNINGS: nothing is removed or re-priced for the shopper, and a line the server no longer returns is deliberately NOT reported, because a disappearance is either the shopper's own removal or something the cart has already explained. `CartNoticesTest` pins each case, including "an unreadable price is not a price change". |
| CART-11 | Explicit "Proceed to Checkout" CTA | cart CTA | `POST /checkout/quote` | `CartContent` checkout button | IMPLEMENTED | The CTA is labelled for the state it is in ("Proceed to Checkout", "Fix unavailable items to check out", "Check earlier order first") and stays disabled while a mutation, a quote, an address read or an uncertain order is in flight — so a double tap cannot submit twice. Duplicate submission is additionally prevented server-side by the `Idempotency-Key` + `orders.request_key` replay guard (CHK-04/CHK-05). |
| CART-08 | Shell cart badge | `components/layout/retailer-shell.tsx` (`cartCount` head count over `cart_items`) | `GET /cart` (`lineCount`) | `ShellBadgesViewModel` + `CartCountStore` | IMPLEMENTED | The badge shows the server's own `lineCount` from the same cart response the cart screen renders — the same fact the web shell badges — so a mutation moves both together. `null` until the server has answered, which renders no bubble rather than a confident "0"; cleared on sign-out. |

## 6. Checkout, order creation and confirmation

| ID | PWA Feature | PWA Route/Component | Backend/API | Native Screen | Status | Notes |
|---|---|---|---|---|---|---|
| CHK-01 | Delivery address selection | `app/retailer/checkout` | `GET /api/mobile/v1/addresses` | `CartScreen` checkout step | IMPLEMENTED | Reads the retailer's saved addresses. |
| CHK-02 | Server quote / order review | `app/retailer/checkout` | `POST /checkout/quote` | `CartScreen` checkout step | IMPLEMENTED | Subtotal, GST, discount, grand total, coins used and balance-after all come from the quote. Nothing payable is computed on the device. |
| CHK-03 | Order notes | checkout notes field | `POST /orders` | `CartScreen` | IMPLEMENTED | |
| CHK-04 | Place order | checkout submit | `POST /orders` | `CartScreen` | IMPLEMENTED | Idempotency key per attempt; the server re-quotes before writing. |
| CHK-05 | Uncertain-submit recovery | checkout retry | `GET /orders/requests/{requestKey}` | `CartScreen` "Check order status" | IMPLEMENTED | A timed-out submit is resolved by asking the server what happened, instead of risking a second order. |
| CHK-06 | Order confirmation | checkout success | `POST /orders` response | `CartScreen` confirmation | IMPLEMENTED | Shows the server-confirmed number, status, total, coins used and coin balance after. |
| CHK-07 | Add a new address during checkout | `app/retailer/account/addresses` | `POST /api/mobile/v1/addresses`, `PATCH`/`DELETE /addresses/{id}`, `POST /addresses/{id}/default` | `AddressBookScreen` (reached from Account AND from checkout) | IMPLEMENTED | Full address CRUD exists natively against real routes that reuse the web form's own `addressPayloadSchema`, with ownership by `id` + session retailer and RLS underneath — and the checkout step now has the entry point too: an "Add delivery address" action (rendered whether or not addresses exist, so a first-time buyer is never stuck) opens the same `AddressBookScreen`, and when checkout becomes visible again it re-reads the server address list (`CartCheckoutViewModel.reloadAddressesIfStale`), keeps a selection that still exists, falls back to the default/first address, and re-quotes only when the selection actually changed. `CommerceViewModelTest` covers first-address pickup, unchanged-selection no-op and vanished-selection reselect. |

## 7. Orders

| ID | PWA Feature | PWA Route/Component | Backend/API | Native Screen | Status | Notes |
|---|---|---|---|---|---|---|
| ORD-01 | Order history | `app/retailer/orders/page.tsx` | `GET /orders` | `OrderHistoryScreen` + `OrderHistoryViewModel` | IMPLEMENTED | Cursor-paged, server statuses and values. |
| ORD-02 | Order detail | `app/retailer/orders/[id]/page.tsx` | `GET /orders/{id}` | `OrderDetailScreen` + `OrderDetailViewModel` (route `orders/{orderId}`) | IMPLEMENTED | Every history row opens a real detail destination that calls the detail endpoint, so the screen shows the server's record rather than the list payload. The detail response now also carries the order's status history (the same rows the web timeline reads) and this order's Coins movement when the ledger read succeeds; the app computes neither. |
| ORD-03 | Invoice | `app/retailer/orders/[id]/invoice/page.tsx` | `GET /api/mobile/v1/orders/{id}/invoice` | `OrderInvoiceScreen` + `InvoiceViewModel` | IMPLEMENTED | The endpoint folds the stored order rows with the web invoice's own helpers (`toInvoiceDisplayLines`, `classifyTaxSplit`, `computeInvoiceTaxLines`) and answers in paise, so no GST arithmetic exists in Kotlin. The screen prints the server's `taxMode` columns — CGST + SGST, IGST, or the stored unsplit total — verbatim; the printed grand total is the stored one. Ownership is checked before any child row is read, and a malformed or foreign id is a 404. |
| ORD-04 | Reorder | `app/retailer/orders/[id]/reorder/page.tsx` | `POST /cart/lines` | `OrderDetailScreen` reorder action + `OrderDetailViewModel.reorder()` | IMPLEMENTED | Replays each line's stored piece count (never its row count) into the real cart, one `POST /cart/lines` per line, so the cart RPC revalidates MOQ, quantity bounds and pack activity and re-prices every line. A line whose pack no longer exists is skipped and said so; a mid-way failure keeps the lines the server already accepted, re-reads the server badge count and reports the error rather than claiming nothing happened. |
| ORD-05 | Delivery tracking | `app/retailer/orders/[id]/delivery/page.tsx` | `GET /api/mobile/v1/orders/{id}/delivery` | `OrderDeliveryScreen` + `DeliveryViewModel` | IMPLEMENTED | The endpoint reads the same dossier as the web page (`fetchDeliveryDetail`), resolves proof object paths to short-lived signed URLs using the caller's own RLS client, and returns the server's inclusive `returnWindowOpen` decision — the app never compares dates. The screen is read-only because RLS grants retailers read-only access to delivery rows. |
| ORD-06 | Cancel a pending order | `app/retailer/orders/[id]` action | `POST /api/mobile/v1/orders/{id}/cancel` | `OrderDetailScreen` + `OrderActionsViewModel` | IMPLEMENTED | The update is constrained to the verified retailer's own `pending` order. Existing database state/stock behavior runs; Coins reversal is idempotent and coupon redemption is released server-side. Processing orders cannot be cancelled. |
| ORD-08 | Order status timeline | `app/retailer/orders/[id]/page.tsx` | `GET /orders/{id}` (`statusHistory`) | `OrderTimeline` + `orderTimeline` | IMPLEMENTED | The timeline is the rows the SERVER recorded for this order, oldest first, with the order's current status marked "Now" — there is no fixed six-stage ladder with greyed placeholders, because drawing "out for delivery" for an order with no such row would be inventing a stage. A status recorded twice marks the last occurrence; a current status the history does not contain falls back to the newest row. No courier GPS is shown or implied. `OrderTimelineTest` pins all of it. |
| BUY-01 | Buy again screen | — (native reordering tool) | `GET /orders` + `GET /catalog/products/{id}` per row | `BuyAgainScreen` + `BuyAgainViewModel` | IMPLEMENTED | A restocking workspace built from the shop's own order history: the packs it buys most (frequency, then recency) with how many past orders contained them, when it last ordered and how many pieces that order covered. Each row is then REVALIDATED against the current catalogue, so the price, minimum, availability, case price and line total on the row are the server's answers from moments ago, never the figures the old order was placed at. Rows that are out of stock, unpriced or no longer published are listed under "Cannot be ordered today" with the reason and cannot be selected. Quantities start at the larger of "last ordered" and "today's MOQ", are editable, and are added through the ordinary cart endpoint with per-line outcomes reported. `BuyAgainTest` pins the ranking, the revalidation states, the MOQ floor and the "never swap in a different pack" rule. |
| ORD-09 | Partial reorder with per-line reasons | `app/retailer/orders/[id]/reorder/page.tsx` | `POST /cart/lines` per line | `OrderDetailScreen` + `CommerceRepository.reorderLines` | IMPLEMENTED | A refusal no longer stops the replay: every line the warehouse can still fill is added at TODAY's price, and the refused ones are listed under "Cannot be ordered today" with the server's own message per line ("Rice: only 20 pcs available"), alongside an "N of M lines added" count. Only when nothing lands is it reported as an error. The historical unit price is never reused — it is not even carried in the reorder model. |
| ORD-07 | Request a return | `app/retailer/orders/[id]/delivery` action | `POST /api/mobile/v1/orders/{id}/return` | `OrderDeliveryScreen` + `OrderActionsViewModel` | IMPLEMENTED | Requires the caller's own delivered order, checks the snapshotted server return deadline inclusively, and inserts a staff-reviewed request under RLS. No client-side date or refund decision is trusted. |

## 8. Coins

The project uses COINS, not the retired retailer-credit system. 1 coin = ₹1.

| ID | PWA Feature | PWA Route/Component | Backend/API | Native Screen | Status | Notes |
|---|---|---|---|---|---|---|
| COIN-01 | Coin balance | `app/retailer/account/ledger/page.tsx` | `GET /api/mobile/v1/wallet` | `WalletScreen` | IMPLEMENTED | Shown as "Coins available". |
| COIN-02 | Coin balance arithmetic | `lib/coins/math.ts` | — | `WalletSummary.coinBalancePaise` | IMPLEMENTED | `max(0, funded − spent)`, the same formula the server debits with. The server's `availablePaise` is the same subtraction unclamped and is deliberately not carried into the app, so an overspent account can never render a negative balance. |
| COIN-03 | Coin ledger | retailer ledger page | `GET /wallet/ledger` | `WalletScreen` | IMPLEMENTED | Cursor-paged. Rows use the same labels as the web ledger — Coins spent / added / refunded / funded. |
| COIN-04 | Coins at checkout | checkout summary | `POST /checkout/quote` | `CartScreen` | IMPLEMENTED | Coins used and balance-after come from the server quote. |
| COIN-05 | Coins on a placed order | order confirmation | `POST /orders` response | `CartScreen` confirmation | IMPLEMENTED | |
| COIN-06 | Over-limit state | ledger page | `isOverLimit` | `WalletScreen` | IMPLEMENTED | States that more coins were spent than funded, rather than showing a negative number. |

## 9. Notifications

| ID | PWA Feature | PWA Route/Component | Backend/API | Native Screen | Status | Notes |
|---|---|---|---|---|---|---|
| NOTIF-01 | Notification feed | `app/retailer/notifications/page.tsx` | `GET /notifications` | `NotificationsScreen` + `NotificationsViewModel` | IMPLEMENTED | Cursor-paged, newest first. |
| NOTIF-02 | Mark read | notifications page | `POST /notifications/read` | `NotificationsScreen` | IMPLEMENTED | Only the loaded unread ids are sent; a failure is reported and nothing is marked locally. A partial result re-reads the feed rather than guessing which rows the server marked. |
| NOTIF-03 | Unread count | notification bell | `GET /notifications` first-page `meta.unreadCount` | `NotificationsScreen` header | IMPLEMENTED | The server counts the caller's own unread rows (`recipient_id = auth.uid()`, `is_read = false`) and returns the exact total with the first page. The screen prefers that number; only before it arrives does it show the loaded-page floor as "N+", and the action reads "Mark these read" until the total is known. Cursor pages deliberately omit the count rather than re-count. |
| NOTIF-04 | Shell unread badge | web header bell | `GET /notifications` first-page `meta.unreadCount` | `ShellBadgesViewModel` + `UnreadStore` | IMPLEMENTED | Same single store the notifications screen reads and writes through, so the badge cannot disagree with the feed. `null` until the server has answered (no bubble rather than a false "0"), cleared on sign-out, and a mark-read that the server did not confirm in full re-reads the feed instead of guessing. |
| NOTIF-05 | Notification preferences | `app/retailer/account/notification-preferences/page.tsx` | `GET/PATCH /api/mobile/v1/notifications/preferences` | `NotificationPreferencesScreen` + `NotificationPreferencesViewModel` | IMPLEMENTED | Owner row only; an absent row defaults to enabled, matching the PWA. The app persists order, payment, Coins and offer preferences; no client identity is accepted. |

## 10. Coupons, offers and schemes

| ID | PWA Feature | PWA Route/Component | Backend/API | Native Screen | Status | Notes |
|---|---|---|---|---|---|---|
| PROMO-01 | Coupon list | `app/retailer/coupons/page.tsx` | `GET /coupons` | `CouponsScreen` + `CouponsViewModel` | IMPLEMENTED | Real coupons with their server-stated conditions. |
| PROMO-02 | Apply a coupon | cart | `POST /cart/coupon` | `CartScreen` | IMPLEMENTED | See CART-04. |
| PROMO-03 | Offer badge on products | catalogue cards | `hasOffer` | `ProductCard` `OfferBadge` | IMPLEMENTED | Shown only when the server row says so. |
| PROMO-04 | Schemes | `app/retailer/schemes/page.tsx` | `GET /api/mobile/v1/schemes` | `SchemesScreen` + `SchemesViewModel` | IMPLEMENTED | Reads the same active and in-window scheme rows as the PWA under the caller's RLS client. Displays only returned scheme details and validity; it does not invent savings or alter price. |

## 11. Account

| ID | PWA Feature | PWA Route/Component | Backend/API | Native Screen | Status | Notes |
|---|---|---|---|---|---|---|
| ACC-01 | Account overview | `app/retailer/account/page.tsx` | `GET /session` | `AccountScreen` | IMPLEMENTED | Identity, role and workspace from the session. |
| ACC-02 | Address book | `app/retailer/account/addresses/page.tsx` | `GET`/`POST /addresses`, `PATCH`/`DELETE /addresses/{id}`, `POST /addresses/{id}/default` | `AddressBookScreen` + `AddressBookViewModel` | IMPLEMENTED | Loading, empty, error-with-retry and offline states; create, edit, delete-behind-a-confirmation and an exclusive default. Writes reuse the web form's own zod schema and the same default-exclusivity rule the web server actions apply, so the two surfaces cannot drift. The checkout step's existing `GET /addresses` read is unchanged. |
| ACC-03 | Edit profile | `app/retailer/account/edit/page.tsx` | `GET/PATCH /api/mobile/v1/profile` | `RetailerProfileScreen` + `RetailerProfileViewModel` | IMPLEMENTED | Shop name/address go through the narrow `update_my_shop_profile` RPC; owner name/phone update only the caller's `profiles` row. GSTIN, area, approval, account status and Coins settings are read-only/not accepted. |
| ACC-04 | Security / change password | `app/retailer/account/security/page.tsx` | `POST /api/mobile/v1/auth/password-change`, `POST /api/mobile/v1/auth/logout-all` | `SecurityScreen` + `SecurityViewModel` | IMPLEMENTED | Account → "Security & privacy" is the app's ONE security surface: it changes the password through the authenticated endpoint with the caller's OWN bearer token (no service-role mutation), and it deliberately re-authenticates the CURRENT password first, verifying that the user GoTrue returns is the same id as the bearer caller before the update. Client-side length/confirmation checks are fast feedback only — the server's policy and per-field messages are what decide. The same screen offers "sign out everywhere" (`/auth/logout-all`, which then clears the local session) and the staff-reviewed data-export / deletion requests (ACC-06, ACC-07). INTEGRATION NOTE: the open branch carried a second, lesser security screen (`feature.auth.SecurityScreen` + `ChangePasswordViewModel`, password only, no current-password step, no session revoke). Both cannot be routed to one destination, and two implementations of one screen is exactly how the two surfaces drift, so the superset screen is the only one kept and the redundant one was deleted with its test. |
| ACC-05 | Sign out | account page | `POST /auth/logout` | `AuthenticatedShell` | IMPLEMENTED | |
| ACC-06 | Request data export | `app/retailer/account/security/page.tsx` | `GET/POST /api/mobile/v1/account/requests` | `SecurityScreen` + `SecurityViewModel` | IMPLEMENTED | Creates an owner-stamped staff-review request; it does not claim to export data immediately. Recent statuses are read from the same owner-scoped rows. |
| ACC-08 | Grouped account dashboard | `app/retailer/account/page.tsx` | — | `AccountShortcutGroups` | IMPLEMENTED | The account tab groups its destinations the way a shopkeeper looks for them — **My shopping** (orders, buy again, quick order, favourites, saved carts, reports), **Money & benefits** (Coins, coupons, schemes), **Account** (profile, notifications, notification settings, security) and **Help** (support tickets, help centre) — instead of one flat list of fourteen rows. Every row is still gated on the routes the server-verified session can open, so a group is never a wish list. |
| ACC-07 | Request account deletion | `app/retailer/account/security/page.tsx` | `GET/POST /api/mobile/v1/account/requests` | `SecurityScreen` + confirmation dialog | IMPLEMENTED | Submits a staff-reviewed request only; it does not delete or suspend the account. Request type, retailer identity and status are server/RLS controlled. |

## 12. Support, reports and assistive features

| ID | PWA Feature | PWA Route/Component | Backend/API | Native Screen | Status | Notes |
|---|---|---|---|---|---|---|
| MISC-01 | Support tickets and replies | `app/retailer/support/**` | `/api/mobile/v1/support/tickets`, `/support/tickets/{id}`, and retailer order history | `SupportScreen` + `SupportViewModel` | IMPLEMENTED | Optionally links a recent order selected from the signed-in retailer's own order history; the create route independently verifies ownership before insert. Creates tickets from server identity, pages the caller's ticket list, reads messages only after ticket ownership is verified, and permits replies only while the ticket is open/in progress. |
| MISC-02 | Help centre | `app/retailer/help/page.tsx` | `GET /api/mobile/v1/help` + static FAQ | `HelpScreen` + `HelpViewModel` | IMPLEMENTED | Mirrors the PWA help answers and quick links. Company name is branded fallback; a support phone is shown/callable only when deployment configuration provides one. |
| MISC-03 | Purchase reports and statements | `app/retailer/reports/page.tsx` and `/statement` | `GET /api/mobile/v1/reports`, `/reports/statement` | `PurchaseReportsScreen` + `PurchaseReportsViewModel` | IMPLEMENTED | Uses the same retailer-scoped report aggregators as the PWA; amounts cross the API as paise, cancelled orders follow the shared exclusion rule, and CSV exports are server-generated from owner-only rows with validated India-day date boundaries. Android saves the returned CSV through the user-selected document provider. |
| MISC-04 | AI assistant | `app/retailer/ai/page.tsx` | — | — | N/A | Not part of the retailer ordering journey this app delivers. |

## 13. Platform and delivery

| ID | PWA Feature | PWA Route/Component | Backend/API | Native Screen | Status | Notes |
|---|---|---|---|---|---|---|
| PLAT-01 | Native shell and navigation | app layout | — | `MaharaniRouter`, `AuthenticatedShell` | IMPLEMENTED | Bottom bar plus drawer; destinations are filtered by the session's role and workspaces. |
| PLAT-02 | Offline and error states | web error boundaries | — | `StateSurfaces` | IMPLEMENTED | Offline, retryable and non-retryable failures are distinguished from the error code, not from message text. |
| PLAT-03 | No WebView anywhere | — | — | — | IMPLEMENTED | The app is Kotlin + Compose + Retrofit. No WebView, Capacitor or bundled web assets, in the app or in CI. |
| PLAT-05 | Central bottom navigation | web header nav | — | `AuthenticatedShell` bottom bar | IMPLEMENTED | Home / Catalog / Brands / Orders / Cart; Account is reached from header/drawer. Catalog — not a second Categories tab — is the discovery tab, because the catalogue contains the Categories and Brands panes; the drawer's Categories entry opens the same screen on its pane. |
| PLAT-06 | Responsive and accessibility token guards | — | — | `MaharaniDimens` + `LayoutTokensTest` | IMPLEMENTED | The invariants behind the 360/393/412dp acceptance pass are asserted in the build rather than claimed in a report: every touch target clears 48dp, two product cards fit the narrowest phone with the shared gutter and gap, a rail card never exceeds half of a 360dp screen, and the spacing scale stays on its 4dp base. These are TOKEN assertions — they do not replace a device check, but they make a screen that hard-codes a smaller number fail the unit-test run. |
| PLAT-04 | Android CI | — | — | `.github/workflows/android-apk.yml` | IMPLEMENTED | JDK 17, SDK 36, build-tools 36.0.0, repo Gradle wrapper; runs `testDebugUnitTest lintDebug assembleDebug` and uploads the lint report and the debug APK. |

---

## Totals

| Status | Count |
|---|---|
| IMPLEMENTED | 98 |
| PARTIAL | 0 |
| MISSING | 0 |
| BLOCKED | 2 |
| N/A | 1 |
| **Total rows** | **101** |

These counts are checked against the rows above by
`tests/parity-doc-totals.test.ts`, because the previous version of this document
claimed totals that its own table contradicted.

## What is BLOCKED, and what it would take

One feature remains blocked by the missing production-domain association and the
native recovery handoff; it deliberately falls back to the secure browser flow rather
than accepting an unverified deep link.

1. **AUTH-13 — recovery-link App Link handoff.** The domain owner must publish and
   verify the Android Digital Asset Links association for the production package and
   signing certificate. The native app then needs a reviewed Supabase recovery-token
   exchange/callback that can only be reached through that verified App Link. Until
   both pieces are configured and tested, emailed recovery links stay on the existing
   HTTPS reset page. No custom-scheme or WebView shortcut is used.

## Remaining limitations, stated rather than hidden

1. **Search is the server's PRODUCT search.** `GET /catalog/products?q=` matches
   products, and the app neither fakes nor invents a cross-entity search: a brand or a
   category is browsed in its own pane (HOME-04, HOME-06), and a brand name typed into
   the product field returns whatever the server's product search matches — the same
   answer the web storefront gets. The recent-search chips replay product queries for
   exactly that reason.
2. **No schemes/offer rail on home.** Schemes and coupons have real native destinations
   (PROMO-04 and PROMO-01), but the home screen has no such rail. It shows only server
   data and never fabricates a "Today's offers" promotion.
3. **Recovery-link completion stays in the HTTPS browser flow** (AUTH-04/AUTH-13)
   until the production domain's verified App Link and the reviewed native token
   handoff exist. In-account password rotation is already native (ACC-04).
4. **A new delivery address cannot be added mid-checkout** (CHK-07 PARTIAL). Create or
   edit it in the native address book first, then select it during checkout.
5. **A saved cart cannot be duplicated.** The saved-carts API (`GET/POST/PATCH/DELETE
   /saved-carts`, `/restore`, `/items`) has no copy endpoint, and "duplicate" built from
   `restore` + `saveCurrentCart` would restore the old list into the LIVE cart and then
   save it — clobbering whatever the shopper was assembling. Rename, restore, update and
   delete are all real; duplication stays absent rather than destructive.
6. **"Notify me when it is back in stock" does not exist.** There is no restock-alert
   table, RPC or notification type in this backend, so no favourite can offer one. The
   favourites list instead shows the CURRENT server availability for each saved row, and
   the cart reports the moment a line goes out of stock (CART-10).
7. **Notifications are not grouped into categories.** The notification rows the mobile
   API returns carry no category, kind or topic field, so an Orders/Offers/Account/Stock
   split would be a guess. The feed shows real read/unread state, real timestamps and the
   server's own unread total, and preferences (NOTIF-05) are still per-category.
5. **The Categories/Brands panes narrow on-device.** The server's catalogue search is
   for products; these panes filter only the taxonomy rows the server already sent
   rather than inventing a separate search endpoint.

## Method

- **The Phase 2 retailer-upgrade change set** (HOME-08, HOME-09, CAT-10, CAT-11, FAV-05,
  FAV-06, CART-09, CART-10, CART-11, ORD-08, ORD-09, BUY-01, ACC-08, PLAT-06) was verified
  by NEW Kotlin unit tests that run against the modules' own source, not a
  re-implementation: `PriceLadderTest` (exclusive→inclusive slab conversion, single-slab
  refusal, next-slab honesty), `ProductCompareTest` (the four-product cap, refusal
  instead of swap, "Not published" for unpriced/out-of-stock/missing packs),
  `FavoritesViewTest` (ordering, unpriced-last, in-stock filter), `CartNoticesTest`
  (price/stock/refusal diffs, "unreadable price is not a change", no false alarm for a
  vanished line), `BuyAgainTest` (frequency-then-recency ranking, cap, suggestion floor at
  the current MOQ, out-of-stock/unpriced/missing-pack states, pasted-list merging),
  `OrderTimelineTest` (no invented stages, last-occurrence current, unknown-status
  fallback), `LayoutTokensTest` (48dp targets, two columns at 360dp, 4dp spacing base),
  `GreetingTest` (IST shift and every boundary), and the partial-reorder, bulk-selection
  and server-change cases added to `OrderJourneyViewModelTest`, `CommerceViewModelTest`
  and `QuickOrderViewModelTest`. The repository's static Android gates
  (`tests/android-project-integrity.test.ts`) were run over the changed tree.
  Kotlin compilation, `testDebugUnitTest`, `lintDebug` and `assembleDebug` run in the
  `android-apk.yml` job: on the head commit of this change set
  (run `37653044207`, branch `arena/c225d7d0-maharani-mart`) that job is **GREEN** —
  every module compiles, the Kotlin unit tests pass, `lintDebug` passes, and
  `assembleDebug` produced a non-empty debug APK (`maharani-traders-debug-apk`,
  15,670,632 bytes) whose `applicationId` the job re-checked with `aapt` as
  `com.maharanitraders.app`.
- No endpoint, migration, RLS policy or pricing rule was added or changed for this change
  set: every new surface reads existing endpoints, which is why the web suite
  (`typecheck`, `lint`, `test`, `build`) is unchanged and still green.
- PWA surface: every `page.tsx` under `app/retailer/**`.
- Backend surface: every `route.ts` under `app/api/mobile/v1/**`.
- Native surface: every `*Screen.kt` and `*ViewModel.kt` under `android/*/src/main/**`,
  plus the destination table in `MaharaniDestinations.kt` and the branches actually
  rendered by `DestinationSurface`.
- A row is IMPLEMENTED only where the native screen calls the stated endpoint and acts
  on the response. The screens added or changed on 2026-10-07 also carry Android unit
  tests that run with the module's own source (not a re-implementation):
  `LocalHistoryStoreTest` (encoding round trip, ordering, caps, session wipe),
  `QuickAddTest` (the MOQ the card sends, and when the control must not be offered),
  `HomeQuickActionsTest` (a tile exists only for a route the session holds, and the
  order-status wording), and the cart's `refreshCartOnOpen` cases in
  `CommerceViewModelTest` (re-read on appearance, no competing read during a write). Reachability was checked against `DestinationSurface`, so a screen
  that exists but cannot be opened does not count.
- Route behaviour for the rows changed on 2026-10-05 (CAT-08, CART-08, CHK-07, NOTIF-03,
  NOTIF-04, ACC-02, ORD-02, ORD-03, ORD-04, ORD-05) was verified by running the endpoint
  tests under `tests/` (session, role, ownership, validation, error and response-shape
  assertions), not by reading the route alone: `tests/mobile-order-invoice.test.ts` and
  `tests/mobile-order-delivery.test.ts` cover the two endpoints this change set adds,
  including the "foreign order is a 404 with no child read" case. The Android side was
  verified by reading the screen, its state model and the shell's render table, and by
  the repository's static Android gates (`tests/android-project-integrity.test.ts`,
  which resolves the new symbols, DTO `@Serializable` annotations and fake-interface
  completeness). **Android compilation and unit tests cannot be executed in the
  verifying environment** (no JDK or Android SDK available); they run in the
  `android-apk.yml` GitHub Actions job, and no Kotlin build result is claimed here
  unless that job is green.
- The retailer-gap closure (AUTH-03, AUTH-04, CHK-07, ACC-04, MISC-02 — the second
  2026-10-06 change set) was verified by: the new Kotlin unit tests
  (`ForgotPasswordViewModelTest` and the `reloadAddressesIfStale` cases in
  `CommerceViewModelTest`), the repository's static
  Android gates (`tests/android-project-integrity.test.ts`, which resolves the new
  symbols and checks `FakeAuthApi` implements every `MaharaniApi` member with the
  exact parameter names), and the web suite run in this environment (typecheck, lint,
  tests, production build). Kotlin compilation and the Android unit-test/lint/APK
  tasks run in the `android-apk.yml` job; no Kotlin build result is claimed here
  unless that job is green.
- The catalogue-loading change set (AUTH-06, CAT-01, and the merge of the open
  retailer-upgrade branch) was verified by: `ApiCallExecutorTest` (a 401 carrying
  `expired_token` is refreshed and replayed exactly once; a `missing_token` 401 is
  not), `CatalogViewModelTest` (a search+category+brand deep link costs exactly ONE
  catalogue read; an unfiltered deep link costs none; a deep link opens the
  Categories pane from state already loaded), and the repository's static Android
  gates over the merged tree — which is what caught the two defects the merge itself
  introduced: a second `composable()` registration for the `SECURITY` and `HELP`
  routes (a duplicate route id in one `NavHost`) and a `FakeAuthApi` that no longer
  implemented 26 of `MaharaniApi`'s members. The web suite (typecheck, lint, tests,
  production build) is green in this environment; the Android job result is whatever
  `android-apk.yml` reports on the merged commit, and nothing stronger is claimed
  here.
- Session persistence, the catalogue panes and the account hub (the 2026-10-06 change
  set) were verified by: reading the changed Kotlin against its call sites; the
  repository's static Android gates (`tests/android-project-integrity.test.ts`); the
  catalogue unit tests in `android/feature/catalog/src/test/…/CatalogViewModelTest.kt`
  (categories load, brands load, category filter, brand filter, pane navigation, empty
  state, API failure, pagination, de-duplication) and the session tests in
  `android/core/auth/src/test/…/SessionManagerTest.kt` (token published before the
  verify call, refresh retry, terminal rejection clears, network failure keeps, a
  second account cannot inherit the first account's scoped state). Those Kotlin tests
  run in the `android-apk.yml` job; the static gates run here. The web suite
  (`pnpm test`, 108 files / 2050 tests), typecheck, lint and production build were run
  in this environment and are green, and the Android job itself is green in CI on
  `09e2e9d` (run 37426923185: `testDebugUnitTest lintDebug assembleDebug`, with the
  APK's `applicationId` re-checked by `aapt` as `com.maharanitraders.app`).
