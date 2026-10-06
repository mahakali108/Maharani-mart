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

## 1. Authentication, session and access control

| ID | PWA Feature | PWA Route/Component | Backend/API | Native Screen | Status | Notes |
|---|---|---|---|---|---|---|
| AUTH-01 | Login | `app/login/page.tsx` | `POST /api/mobile/v1/auth/login` | `LoginScreen` + `LoginViewModel` | IMPLEMENTED | Email + password; token pair stored via the Keystore-backed session store. |
| AUTH-02 | Retailer registration | `app/register-retailer/page.tsx` | `POST /api/mobile/v1/retailers/register` | `RegisterScreen` + `RegisterViewModel` | IMPLEMENTED | Full form; areas come from `GET /areas`, never a hardcoded list. |
| AUTH-03 | Forgot password request | `app/forgot-password/page.tsx` | `POST /api/mobile/v1/auth/password-reset` | `PasswordResetScreen` + `PasswordResetViewModel` from `LoginScreen` | IMPLEMENTED | Validates the email locally, submits to the enumeration-safe endpoint and shows the same generic response whether an account exists or not. The email's recovery URL intentionally opens in the external browser; see AUTH-04/AUTH-13. |
| AUTH-04 | Complete password reset from the emailed link | `app/reset-password/page.tsx` | `POST /api/mobile/v1/auth/password-update` | External browser fallback from `PasswordResetScreen` | PARTIAL | A retailer can request the recovery email natively, but the emailed Supabase recovery link finishes on the secure PWA reset page because this app has no verified App Link/recovery-code handoff. Signed-in password rotation is fully native under ACC-04. |
| AUTH-05 | Logout | `lib/auth/actions.ts` | `POST /api/mobile/v1/auth/logout` | `AuthenticatedShell` | IMPLEMENTED | Clears the stored session as well as the server session. |
| AUTH-06 | Silent token refresh | `middleware.ts` | `POST /api/mobile/v1/auth/refresh` | `SessionManager`, `AuthInterceptor` | IMPLEMENTED | Single-flight refresh on 401; the failed call is replayed once. |
| AUTH-07 | Session / role bootstrap | `middleware.ts` | `GET /api/mobile/v1/session` | `SessionBootstrapper`, `MaharaniRouter` | IMPLEMENTED | Role and workspace decide the destination set; the client never grants itself a workspace. |
| AUTH-08 | Pending-approval gate | `app/pending-approval/page.tsx` | session `gate` | `SessionGateScreens` | IMPLEMENTED | Driven by `ApiErrorCode.gate`, never by matching message text. |
| AUTH-09 | Access-expired gate | `app/access-expired/page.tsx` | session `gate` | `SessionGateScreens` | IMPLEMENTED | As above. |
| AUTH-10 | Account suspended / inactive | session guard | session `gate` | `SessionGateScreens` | IMPLEMENTED | As above. |
| AUTH-11 | Session survives restarts | web cookie session | `GET /session`, `POST /auth/refresh` | `SessionManager` + `KeystoreTokenStore` | IMPLEMENTED | The token pair is written by `KeystoreTokenStore` (AES-256-GCM under a non-exportable AndroidKeyStore key; ciphertext in `filesDir`, never a plaintext preference) and read back on every cold start, so a session outlives activity recreation, process death, relaunch and device restart. Restore verifies with `GET /session` **with the stored token published to the request interceptor first** — the defect this change fixes: the verify call used to run anonymously, answer 401 and wipe a perfectly good session, which is why every cold start landed on sign-in. A token the server rejects as expired is refreshed once through `POST /auth/refresh` and retried; a refresh the server rejects as terminal clears the session, while a network failure keeps it and reports offline. No email or password is ever stored — only the server's token pair. |
| AUTH-12 | Session-scoped state isolation | web per-request session | — | `SessionScopedStore` set in `SessionManager` | IMPLEMENTED | Favourites (`FavoritesStore`), cart count (`CartCountStore`) and unread badge (`UnreadStore`) are process-wide singletons. Each implements `SessionScopedStore`, contributes itself to the Hilt multibound `Set<SessionScopedStore>`, and is emptied by `SessionManager` whenever the published state leaves `Authenticated` (sign-out, terminal refresh failure, gate rejection) and before a new sign-in is adopted. Without it the next account on the same device inherited the previous account's hearts and badges until something happened to reload them. |
| AUTH-13 | Recovery-link App Link handoff | Supabase recovery email → `/auth/callback?next=/reset-password` | verified Android App Link + native recovery token exchange | — | BLOCKED | There is no verified `assetlinks.json`/App Link association or native recovery callback/token-exchange path in this deployment. Until the domain owner configures and verifies that capability, the supported recovery link stays in the external browser; no WebView or unverified custom-scheme shortcut is used. |
| AUTH-14 | Sign out all devices | `app/retailer/account/security/page.tsx` | `POST /api/mobile/v1/auth/logout-all` | `SecurityScreen` + `SecurityViewModel` | IMPLEMENTED | GoTrue global refresh-token revocation is called with the verified bearer session; the local Keystore session is then cleared. |

## 2. Home and discovery

| ID | PWA Feature | PWA Route/Component | Backend/API | Native Screen | Status | Notes |
|---|---|---|---|---|---|---|
| HOME-01 | Retailer home | `app/retailer/home/page.tsx` | `GET /api/mobile/v1/home` | `RetailerHomeScreen` + `HomeViewModel` | IMPLEMENTED | Banners, category rail, product rails — all server rows. |
| HOME-02 | Promotional banners | `app/retailer/home` | `GET /home` | `BannerCarousel` | IMPLEMENTED | Renders only banners the server returned; no placeholder art. |
| HOME-03 | Search | `app/retailer/catalog` search field | `GET /catalog/products?search=` | `CatalogScreen` filter bar | IMPLEMENTED | Debounced; the query is sent to the server, never filtered client-side. |
| HOME-04 | Category directory | `app/retailer/categories/page.tsx` | `GET /catalog/categories` | `CatalogScreen` Categories pane (`CatalogViewModel`) | IMPLEMENTED | The catalogue's Categories pane, reached from the home rail, the drawer's "Categories" entry and the bottom bar's Catalog tab. Every tile is a real published category with its real image and the server's own `productCount` when the server counted one; a missing count is omitted rather than rounded to "0 items". Tapping one applies the filter and switches to the Products pane. |
| HOME-05 | Category landing page | `app/retailer/categories/[id]/page.tsx` | `GET /catalog/products?categoryId=` | `CatalogScreen` (filtered) | IMPLEMENTED | Same list, pre-filtered, rather than a second screen that could price differently. |
| HOME-06 | Brand directory | `app/retailer/brands/page.tsx` | `GET /catalog/brands` | `CatalogScreen` Brands pane (`CatalogViewModel`) | IMPLEMENTED | The brands endpoint is read in parallel with categories when the catalogue opens, and its rows fill both the home brand rail and the catalogue's Brands pane. The pane narrows on the device (a filter field over the names the server already sent, so typing costs no request) and shows a real logo where the server sent one, the real name, and the server's `productCount` when present. Each pane reports its own read: a categories outage cannot put an error on the Brands pane, and whichever read succeeded is kept. Tapping a brand opens the Products pane filtered by `brandId`, with the brand name carried as the chip label. |
| HOME-07 | Brand landing page | `app/retailer/brands/[id]/page.tsx` | `GET /catalog/products?brandId=` | `CatalogScreen` (filtered) | IMPLEMENTED | Tapping a brand tile opens the catalogue pre-filtered by `brandId`, with the brand name as the filter label — the same single-screen choice HOME-05 makes for categories. |

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
| CAT-09 | Categories and Brands in one catalogue | `app/retailer/{categories,brands}` | `GET /catalog/categories`, `GET /catalog/brands` | `CatalogScreen` + `CatalogTabStrip` + `CatalogViewModel` | IMPLEMENTED | One destination with three panes — `[Products] [Categories] [Brands]` — rather than two disconnected directory implementations. The taxonomy is read once per visit (both endpoints in parallel) and narrowed on the device; a pane switch costs no request and a filter change costs exactly one. The pane state, loading flag, failure and empty state are per pane, so the panel that succeeded is never blanked by the one that failed. This replaced the separate `CategoriesScreen`/`CategoriesViewModel`, whose only entry points now open this screen on its Categories pane. |

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
| CART-07 | Saved carts and save for later | `app/retailer/cart/saved/page.tsx` | `GET/POST /api/mobile/v1/saved-carts`, `PATCH/DELETE /saved-carts/{id}`, restore and item routes | `SavedCartsScreen` + `SavedCartsViewModel`; Cart line action | IMPLEMENTED | Named lists and the reserved Save for later list keep pack ids/quantities only. Owner filters and RLS scope reads/writes; restore revalidates live pack/product activity, MOQ and cart rules before merging. No saved price, stock or total is carried forward. |
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
| ORD-02 | Order detail | `app/retailer/orders/[id]/page.tsx` | `GET /orders/{id}` | `OrderDetailScreen` + `OrderDetailViewModel` (route `orders/{orderId}`) | IMPLEMENTED | Every history row opens a real detail destination that calls the detail endpoint, so the screen shows the server's record rather than the list payload. The detail response now also carries the order's status history (the same rows the web timeline reads) and this order's Coins movement when the ledger read succeeds; the app computes neither. |
| ORD-03 | Invoice | `app/retailer/orders/[id]/invoice/page.tsx` | `GET /api/mobile/v1/orders/{id}/invoice` | `OrderInvoiceScreen` + `InvoiceViewModel` | IMPLEMENTED | The endpoint folds the stored order rows with the web invoice's own helpers (`toInvoiceDisplayLines`, `classifyTaxSplit`, `computeInvoiceTaxLines`) and answers in paise, so no GST arithmetic exists in Kotlin. The screen prints the server's `taxMode` columns — CGST + SGST, IGST, or the stored unsplit total — verbatim; the printed grand total is the stored one. Ownership is checked before any child row is read, and a malformed or foreign id is a 404. |
| ORD-04 | Reorder | `app/retailer/orders/[id]/reorder/page.tsx` | `POST /cart/lines` | `OrderDetailScreen` reorder action + `OrderDetailViewModel.reorder()` | IMPLEMENTED | Replays each line's stored piece count (never its row count) into the real cart, one `POST /cart/lines` per line, so the cart RPC revalidates MOQ, quantity bounds and pack activity and re-prices every line. A line whose pack no longer exists is skipped and said so; a mid-way failure keeps the lines the server already accepted, re-reads the server badge count and reports the error rather than claiming nothing happened. |
| ORD-05 | Delivery tracking | `app/retailer/orders/[id]/delivery/page.tsx` | `GET /api/mobile/v1/orders/{id}/delivery` | `OrderDeliveryScreen` + `DeliveryViewModel` | IMPLEMENTED | The endpoint reads the same dossier as the web page (`fetchDeliveryDetail`), resolves proof object paths to short-lived signed URLs using the caller's own RLS client, and returns the server's inclusive `returnWindowOpen` decision — the app never compares dates. The screen is read-only because RLS grants retailers read-only access to delivery rows. |
| ORD-06 | Cancel a pending order | `app/retailer/orders/[id]` action | `POST /api/mobile/v1/orders/{id}/cancel` | `OrderDetailScreen` + `OrderActionsViewModel` | IMPLEMENTED | The update is constrained to the verified retailer's own `pending` order. Existing database state/stock behavior runs; Coins reversal is idempotent and coupon redemption is released server-side. Processing orders cannot be cancelled. |
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
| ACC-04 | Security / change password | `app/retailer/account/security/page.tsx` | `POST /api/mobile/v1/auth/password-change` | `SecurityScreen` + `SecurityViewModel` | IMPLEMENTED | Native in-account rotation first re-authenticates the current password through GoTrue and verifies the returned user id equals the bearer caller before updating. No service-role password mutation. Email recovery-link completion is tracked separately in AUTH-04/AUTH-13. |
| ACC-05 | Sign out | account page | `POST /auth/logout` | `AuthenticatedShell` | IMPLEMENTED | |
| ACC-06 | Request data export | `app/retailer/account/security/page.tsx` | `GET/POST /api/mobile/v1/account/requests` | `SecurityScreen` + `SecurityViewModel` | IMPLEMENTED | Creates an owner-stamped staff-review request; it does not claim to export data immediately. Recent statuses are read from the same owner-scoped rows. |
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
| PLAT-05 | Central bottom navigation | web header nav | — | `AuthenticatedShell` bottom bar | IMPLEMENTED | Home / Catalog / Cart / Orders / Account. Catalog — not a second Categories tab — is the discovery tab, because the catalogue contains the Categories and Brands panes; the drawer's Categories entry opens the same screen on its pane. |
| PLAT-04 | Android CI | — | — | `.github/workflows/android-apk.yml` | IMPLEMENTED | JDK 17, SDK 36, build-tools 36.0.0, repo Gradle wrapper; runs `testDebugUnitTest lintDebug assembleDebug` and uploads the lint report and the debug APK. |

---

## Totals

| Status | Count |
|---|---|
| IMPLEMENTED | 83 |
| PARTIAL | 2 |
| MISSING | 0 |
| BLOCKED | 1 |
| N/A | 1 |
| **Total rows** | **87** |

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

1. **No add-to-cart on the catalogue card.** The card shows brand, name, pack size,
   MOQ, live price, stock and the favourite toggle. Adding to the cart happens on the
   product detail (CAT-07), where the server pack and MOQ are known; the card does not
   pretend to own that mutation.
2. **No schemes/offer rail on home.** Schemes and coupons have real native destinations
   (PROMO-04 and PROMO-01), but the home screen has no such rail. It shows only server
   data and never fabricates a "Today's offers" promotion.
3. **Recovery-link completion stays in the HTTPS browser flow** (AUTH-04/AUTH-13)
   until the production domain's verified App Link and the reviewed native token
   handoff exist. In-account password rotation is already native (ACC-04).
4. **A new delivery address cannot be added mid-checkout** (CHK-07 PARTIAL). Create or
   edit it in the native address book first, then select it during checkout.
5. **The Categories/Brands panes narrow on-device.** The server's catalogue search is
   for products; these panes filter only the taxonomy rows the server already sent
   rather than inventing a separate search endpoint.

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
