# Maharani Traders — Native Android ↔ PWA Feature Parity

Audited against the repository on 2026-10-05. The PWA under `app/retailer/**` is the
FEATURE REFERENCE; the native Android app under `android/` is the product being
delivered. Every row below was checked by reading the route, the endpoint and the
Kotlin screen — not inferred from a previous report.

## How to read this

| Status | Meaning |
|---|---|
| IMPLEMENTED | A native screen performs the real business action against the real backend. A placeholder, a label, or a value the app computed for itself does NOT qualify. |
| PARTIAL | The native app does some of this, and the Notes say exactly what is missing. |
| MISSING | No native implementation. The backend may well exist. |
| BLOCKED | Cannot be built natively without backend work that does not exist yet. The Notes state the work. |
| N/A | Deliberately not brought to native, with the reason. |

Money, stock, totals and coin balances are server-authoritative everywhere. Where the
native app shows a number, that number came from the server in the same response that
the web app uses, or it is derived by arithmetic that is written down once and shared
(see COIN-02).

---

## 1. Authentication, session and access control

| ID | PWA Feature | PWA Route/Component | Backend/API | Native Screen | Status | Notes |
|---|---|---|---|---|---|---|
| AUTH-01 | Login | `app/login/page.tsx` | `POST /api/mobile/v1/auth/login` | `LoginScreen` + `LoginViewModel` | IMPLEMENTED | Email + password; token pair stored via the Keystore-backed session store. |
| AUTH-02 | Retailer registration | `app/register-retailer/page.tsx` | `POST /api/mobile/v1/retailers/register` | `RegisterScreen` + `RegisterViewModel` | IMPLEMENTED | Full form; areas come from `GET /areas`, never a hardcoded list. |
| AUTH-03 | Forgot password | `app/forgot-password/page.tsx` | `POST /api/mobile/v1/auth/password-reset` | `AuthFlowScreen` | IMPLEMENTED | Triggers the Supabase reset mail. |
| AUTH-04 | Reset password | `app/reset-password/page.tsx` | `POST /api/mobile/v1/auth/password-update` | `AuthFlowScreen` | IMPLEMENTED | Token-based update. |
| AUTH-05 | Logout | `lib/auth/actions.ts` | `POST /api/mobile/v1/auth/logout` | `AuthenticatedShell` | IMPLEMENTED | Clears the stored session as well as the server session. |
| AUTH-06 | Silent token refresh | `middleware.ts` | `POST /api/mobile/v1/auth/refresh` | `SessionManager`, `AuthInterceptor` | IMPLEMENTED | Single-flight refresh on 401; the failed call is replayed once. |
| AUTH-07 | Session / role bootstrap | `middleware.ts` | `GET /api/mobile/v1/session` | `SessionBootstrapper`, `MaharaniRouter` | IMPLEMENTED | Role and workspace decide the destination set; the client never grants itself a workspace. |
| AUTH-08 | Pending-approval gate | `app/pending-approval/page.tsx` | session `gate` | `SessionGateScreens` | IMPLEMENTED | Driven by `ApiErrorCode.gate`, never by matching message text. |
| AUTH-09 | Access-expired gate | `app/access-expired/page.tsx` | session `gate` | `SessionGateScreens` | IMPLEMENTED | As above. |
| AUTH-10 | Account suspended / inactive | session guard | session `gate` | `SessionGateScreens` | IMPLEMENTED | As above. |

## 2. Home and discovery

| ID | PWA Feature | PWA Route/Component | Backend/API | Native Screen | Status | Notes |
|---|---|---|---|---|---|---|
| HOME-01 | Retailer home | `app/retailer/home/page.tsx` | `GET /api/mobile/v1/home` | `RetailerHomeScreen` + `HomeViewModel` | IMPLEMENTED | Banners, category rail, product rails — all server rows. |
| HOME-02 | Promotional banners | `app/retailer/home` | `GET /home` | `BannerCarousel` | IMPLEMENTED | Renders only banners the server returned; no placeholder art. |
| HOME-03 | Search | `app/retailer/catalog` search field | `GET /catalog/products?search=` | `CatalogScreen` filter bar | IMPLEMENTED | Debounced; the query is sent to the server, never filtered client-side. |
| HOME-04 | Category directory | `app/retailer/categories/page.tsx` | `GET /catalog/categories` | `CategoriesScreen` + `CategoriesViewModel` | IMPLEMENTED | Tapping a category opens the catalogue filtered by it. |
| HOME-05 | Category landing page | `app/retailer/categories/[id]/page.tsx` | `GET /catalog/products?categoryId=` | `CatalogScreen` (filtered) | IMPLEMENTED | Same list, pre-filtered, rather than a second screen that could price differently. |
| HOME-06 | Brand directory | `app/retailer/brands/page.tsx` | `GET /catalog/brands` | — | MISSING | The endpoint and the DTO exist and `CatalogQuery.brandId` is wired; only the brand-picker screen is absent. The catalogue can already be filtered by brand programmatically. |
| HOME-07 | Brand landing page | `app/retailer/brands/[id]/page.tsx` | `GET /catalog/products?brandId=` | `CatalogScreen` (filtered) | PARTIAL | Reachable only once something sets `brandId`; with HOME-06 missing there is no in-app way to pick a brand. |

## 3. Catalogue and product detail

| ID | PWA Feature | PWA Route/Component | Backend/API | Native Screen | Status | Notes |
|---|---|---|---|---|---|---|
| CAT-01 | Product list | `app/retailer/catalog/page.tsx` | `GET /catalog/products` | `CatalogScreen` + `CatalogViewModel` | IMPLEMENTED | Opaque-cursor paging with a repeated-cursor stall guard. |
| CAT-02 | Sort | catalog sort control | `?sort=` | `CatalogScreen` | IMPLEMENTED | Server-side sort; the app does not reorder a page locally. |
| CAT-03 | In-stock filter | catalog filter | `?inStock=1` | `CatalogScreen` | IMPLEMENTED | Single-warehouse model: In Stock / Out of Stock only. |
| CAT-04 | Product detail | `app/retailer/catalog/[id]/page.tsx` | `GET /catalog/products/{id}` | `ProductDetailScreen` + `ProductDetailViewModel` | IMPLEMENTED | Gallery, facts, pack selector, stock badge. |
| CAT-05 | Pack / MOQ rules | PDP pack selector | pack payload on the detail row | `ProductDetailScreen` | IMPLEMENTED | MOQ and increment come from the server pack; the quantity stepper enforces them. |
| CAT-06 | Stock badge | PDP + cards | `availability` on the pack | `StockBadge` | IMPLEMENTED | In Stock / Out of Stock only — no FEFO, GRN or multi-warehouse anywhere in the native app. |
| CAT-07 | Add to cart from PDP | PDP | `POST /cart/lines` | `ProductDetailScreen` → `CartCheckoutViewModel` | IMPLEMENTED | Server re-prices; the response replaces the local cart. |
| CAT-08 | Quick order | `app/retailer/quick-order/page.tsx` | `GET /api/mobile/v1/quick-order`, `POST /quick-order/match` | `QuickOrderScreen` + `QuickOrderViewModel` | IMPLEMENTED | Name search and pasted-list matcher over the real catalogue, priced for the caller by the same engine the cart and checkout use. Every add goes through `POST /cart/lines` (the `mutate_retailer_cart_line` RPC revalidates MOQ, quantity bounds and pack activity) and any order still commits through the existing atomic checkout, whose 0054 triggers reject a stale or out-of-stock quote — quick order creates no order of its own and cannot be laxer than any other surface. The matcher itself never writes, and a line that matches nothing answers with its own error instead of a guess. |

## 4. Favourites

| ID | PWA Feature | PWA Route/Component | Backend/API | Native Screen | Status | Notes |
|---|---|---|---|---|---|---|
| FAV-01 | Save / unsave a product | `lib/retailer/favorite-actions.ts` | `POST /api/mobile/v1/favorites` | `FavoriteButton` on `ProductCard` and `ProductDetailScreen` | IMPLEMENTED | Server-authoritative: the heart shows what the toggle response returned, never an optimistic guess. A failed toggle keeps the old state and says why. |
| FAV-02 | Favourites list | `app/retailer/favorites/page.tsx` | `GET /catalog/products?fav=1` | `FavoritesScreen` + `FavoritesViewModel` | IMPLEMENTED | The real catalogue endpoint narrowed to favourites, so price, pack and stock match the catalogue exactly. |
| FAV-03 | Favourite state across screens | catalogue + PDP | `GET /api/mobile/v1/favorites` | `FavoritesStore` | IMPLEMENTED | One store, read by every surface. Before it loads, the `isFavorite` flag on each server row is used, so hearts never flash off on a cold start. |
| FAV-04 | Favourite count | favourites header | derived | `FavoritesScreen` count | IMPLEMENTED | Taken from the list's `resultCount` and the loaded id set; not guessed from the visible page. |

## 5. Cart

| ID | PWA Feature | PWA Route/Component | Backend/API | Native Screen | Status | Notes |
|---|---|---|---|---|---|---|
| CART-01 | View cart | `app/retailer/cart/page.tsx` | `GET /cart` | `CartScreen` + `CartCheckoutViewModel` | IMPLEMENTED | Every line is re-priced by the server on load. |
| CART-02 | Change quantity | cart stepper | `PATCH /cart/lines/{lineId}` | `CartScreen` | IMPLEMENTED | MOQ and increment enforced server-side; the response is the new truth. |
| CART-03 | Remove a line | cart | `DELETE /cart/lines/{lineId}` | `CartScreen` | IMPLEMENTED | |
| CART-04 | Apply a coupon | cart coupon box | `POST /cart/coupon` | `CartScreen` | IMPLEMENTED | The server validates and prices the coupon; the app never computes a discount. |
| CART-05 | Remove a coupon | cart | `DELETE /cart/coupon` | `CartScreen` | IMPLEMENTED | |
| CART-06 | Unavailable-line handling | cart warnings | `orderable`/`message` on each line | `CartScreen` | IMPLEMENTED | A non-orderable line blocks checkout and shows the server's reason. |
| CART-07 | Saved carts | `app/retailer/cart/saved/page.tsx` | server action | — | MISSING | No mobile endpoint exists for saved carts; the web feature uses a server action, not `/api/mobile/v1`. Adding it would need a new route plus RLS review. |
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
| CHK-07 | Add a new address during checkout | `app/retailer/account/addresses` | `POST /api/mobile/v1/addresses`, `PATCH`/`DELETE /addresses/{id}`, `POST /addresses/{id}/default` | `AddressBookScreen` (reached from Account) | PARTIAL | Full address CRUD now exists natively against real routes that reuse the web form's own `addressPayloadSchema`, with ownership by `id` + session retailer and RLS underneath. What is missing is only the entry point: the checkout step still lets the retailer SELECT a saved address, not add one mid-checkout, so a first-time address is created in the address book first. |

## 7. Orders

| ID | PWA Feature | PWA Route/Component | Backend/API | Native Screen | Status | Notes |
|---|---|---|---|---|---|---|
| ORD-01 | Order history | `app/retailer/orders/page.tsx` | `GET /orders` | `OrderHistoryScreen` + `OrderHistoryViewModel` | IMPLEMENTED | Cursor-paged, server statuses and values. |
| ORD-02 | Order detail | `app/retailer/orders/[id]/page.tsx` | `GET /orders/{id}` | `OrderHistoryScreen` expandable row | PARTIAL | Items, address and notes are shown, but from the LIST payload. `GET /orders/{id}` and `MaharaniApi.orderDetail` both exist and nothing calls them; there is no addressable order-detail screen or route. |
| ORD-03 | Invoice | `app/retailer/orders/[id]/invoice/page.tsx` | — | — | BLOCKED | There is no mobile invoice endpoint. The tax split lives in TypeScript (`lib/retailer/invoice-tax.ts`, `invoice-display.ts`); re-deriving GST in Kotlin would create a second implementation of tax arithmetic, which is exactly the kind of duplication that eventually disagrees. The right fix is `GET /api/mobile/v1/orders/{id}/invoice` returning the already-computed lines. |
| ORD-04 | Reorder | `app/retailer/orders/[id]/reorder/page.tsx` | `POST /cart/lines` | — | MISSING | Buildable on existing endpoints by replaying each line into the cart; not implemented in this change set. |
| ORD-05 | Delivery tracking | `app/retailer/orders/[id]/delivery/page.tsx` | — | — | BLOCKED | No mobile endpoint exposes delivery events. Would need a route over the same data the web page reads. |

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
| NOTIF-05 | Notification preferences | `app/retailer/account/notification-preferences/page.tsx` | — | — | BLOCKED | No mobile endpoint for preferences. |

## 10. Coupons, offers and schemes

| ID | PWA Feature | PWA Route/Component | Backend/API | Native Screen | Status | Notes |
|---|---|---|---|---|---|---|
| PROMO-01 | Coupon list | `app/retailer/coupons/page.tsx` | `GET /coupons` | `CouponsScreen` + `CouponsViewModel` | IMPLEMENTED | Real coupons with their server-stated conditions. |
| PROMO-02 | Apply a coupon | cart | `POST /cart/coupon` | `CartScreen` | IMPLEMENTED | See CART-04. |
| PROMO-03 | Offer badge on products | catalogue cards | `hasOffer` | `ProductCard` `OfferBadge` | IMPLEMENTED | Shown only when the server row says so. |
| PROMO-04 | Schemes | `app/retailer/schemes/page.tsx` | — | — | BLOCKED | No mobile endpoint exposes schemes. Would need a route over the same source the web page reads. |

## 11. Account

| ID | PWA Feature | PWA Route/Component | Backend/API | Native Screen | Status | Notes |
|---|---|---|---|---|---|---|
| ACC-01 | Account overview | `app/retailer/account/page.tsx` | `GET /session` | `AccountScreen` | IMPLEMENTED | Identity, role and workspace from the session. |
| ACC-02 | Address book | `app/retailer/account/addresses/page.tsx` | `GET`/`POST /addresses`, `PATCH`/`DELETE /addresses/{id}`, `POST /addresses/{id}/default` | `AddressBookScreen` + `AddressBookViewModel` | IMPLEMENTED | Loading, empty, error-with-retry and offline states; create, edit, delete-behind-a-confirmation and an exclusive default. Writes reuse the web form's own zod schema and the same default-exclusivity rule the web server actions apply, so the two surfaces cannot drift. The checkout step's existing `GET /addresses` read is unchanged. |
| ACC-03 | Edit profile | `app/retailer/account/edit/page.tsx` | — | — | BLOCKED | No mobile profile-update endpoint. |
| ACC-04 | Security / change password | `app/retailer/account/security/page.tsx` | `POST /auth/password-update` | `AuthFlowScreen` | PARTIAL | The password-update call exists and is used in the reset flow; there is no in-account security screen. |
| ACC-05 | Sign out | account page | `POST /auth/logout` | `AuthenticatedShell` | IMPLEMENTED | |

## 12. Support, reports and assistive features

| ID | PWA Feature | PWA Route/Component | Backend/API | Native Screen | Status | Notes |
|---|---|---|---|---|---|---|
| MISC-01 | Support tickets | `app/retailer/support/**` | — | — | BLOCKED | No mobile endpoints for support threads. |
| MISC-02 | Help centre | `app/retailer/help/page.tsx` | static content | — | MISSING | Static content; no backend dependency. |
| MISC-03 | Reports | `app/retailer/reports/page.tsx` | — | — | BLOCKED | No mobile reporting endpoint. |
| MISC-04 | AI assistant | `app/retailer/ai/page.tsx` | — | — | N/A | Not part of the retailer ordering journey this app delivers. |

## 13. Platform and delivery

| ID | PWA Feature | PWA Route/Component | Backend/API | Native Screen | Status | Notes |
|---|---|---|---|---|---|---|
| PLAT-01 | Native shell and navigation | app layout | — | `MaharaniRouter`, `AuthenticatedShell` | IMPLEMENTED | Bottom bar plus drawer; destinations are filtered by the session's role and workspaces. |
| PLAT-02 | Offline and error states | web error boundaries | — | `StateSurfaces` | IMPLEMENTED | Offline, retryable and non-retryable failures are distinguished from the error code, not from message text. |
| PLAT-03 | No WebView anywhere | — | — | — | IMPLEMENTED | The app is Kotlin + Compose + Retrofit. No WebView, Capacitor or bundled web assets, in the app or in CI. |
| PLAT-04 | Android CI | — | — | `.github/workflows/android-apk.yml` | IMPLEMENTED | JDK 17, SDK 36, build-tools 36.0.0, repo Gradle wrapper; runs `testDebugUnitTest lintDebug assembleDebug` and uploads the lint report and the debug APK. |

---

## Totals

| Status | Count |
|---|---|
| IMPLEMENTED | 61 |
| PARTIAL | 4 |
| MISSING | 4 |
| BLOCKED | 7 |
| N/A | 1 |
| **Total rows** | **77** |

These counts are checked against the rows above by
`tests/parity-doc-totals.test.ts`, because the previous version of this document
claimed totals that its own table contradicted.

## What is BLOCKED, and what it would take

Each of these needs backend work that does not exist today. None of them is hidden
behind a placeholder screen in the app.

1. **ORD-03 — invoice.** Needs `GET /api/mobile/v1/orders/{id}/invoice` returning the
   lines already computed by `lib/retailer/invoice-tax.ts`. Re-deriving the GST split
   in Kotlin would duplicate tax arithmetic in a second language.
2. **ORD-05 — delivery tracking.** Needs a mobile route over the delivery events the
   web page reads.
3. **NOTIF-05 — notification preferences.** Needs read/write routes.
4. **PROMO-04 — schemes.** Needs a mobile route for scheme data.
5. **ACC-03 — profile editing.** Needs a mobile profile-update route.
6. **MISC-01 / MISC-03 — support and reports.** Need mobile routes.

## Method

- PWA surface: every `page.tsx` under `app/retailer/**`.
- Backend surface: every `route.ts` under `app/api/mobile/v1/**`.
- Native surface: every `*Screen.kt` and `*ViewModel.kt` under `android/*/src/main/**`,
  plus the destination table in `MaharaniDestinations.kt` and the branches actually
  rendered by `DestinationSurface`.
- A row is IMPLEMENTED only where the native screen calls the stated endpoint and acts
  on the response. Reachability was checked against `DestinationSurface`, so a screen
  that exists but cannot be opened does not count.
- Route behaviour for the rows changed on 2026-10-05 (CAT-08, CART-08, CHK-07, NOTIF-03,
  NOTIF-04, ACC-02) was verified by running the endpoint tests under `tests/` (session,
  role, ownership, validation, error and response-shape assertions), not by reading the
  route alone. The Android side was verified by reading the screen, its state model and
  the shell's render table. **Android compilation and unit tests could not be executed
  in the verifying environment** (no JDK or Android SDK available), so no Kotlin build
  result is claimed here; that gap is why the stale destination allow-list in
  `MaharaniRouterTest` was found by reading rather than by a failing run.
