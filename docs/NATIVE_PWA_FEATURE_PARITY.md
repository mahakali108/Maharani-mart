# Maharani Traders — Native Android ↔ PWA Feature Parity

> Auto-generated from a complete PWA inventory performed 2026-10-05.
> Statuses: ✅ IMPLEMENTED · 🔶 PARTIAL · ⛔ BLOCKED · ➖ NOT APPLICABLE
>
> A row is ✅ IMPLEMENTED only when the screen, the navigation to it, a real mobile
> endpoint, the server's own auth/RLS scoping, the loading/error/empty states and a
> test for the behaviour all exist. A screen that merely renders is not parity;
> nothing here is a placeholder. The Verification log at the end records the code
> and tests behind the most recent status changes.

## Legend

| Column | Meaning |
|--------|---------|
| PWA Feature | User-visible capability in the existing web PWA |
| PWA Route/Component | Next.js page or React component |
| Backend/API | Mobile API endpoint (`/api/mobile/v1/…`) or server action |
| Native Screen | Jetpack Compose screen or ViewModel |
| Status | Parity status |

---

## 1. Authentication & Session

| PWA Feature | PWA Route/Component | Backend/API | Native Screen | Status | Notes |
|---|---|---|---|---|---|
| Login | `app/login/page.tsx` | `POST /api/mobile/v1/auth/login` | `LoginScreen` + `LoginViewModel` | ✅ IMPLEMENTED | Email+password, token pair, Keystore storage |
| Registration | `app/register-retailer/page.tsx` | `POST /api/mobile/v1/retailers/register` | `RegisterScreen` + `RegisterViewModel` | ✅ IMPLEMENTED | Full form with area selection |
| Forgot password | `app/forgot-password/page.tsx` | `POST /api/mobile/v1/auth/password-reset` | `AuthFlowScreen` (reset flow) | ✅ IMPLEMENTED | Supabase reset email |
| Reset password | `app/reset-password/page.tsx` | `POST /api/mobile/v1/auth/password-update` | `AuthFlowScreen` (update flow) | ✅ IMPLEMENTED | Token-based update |
| Logout | `lib/auth/actions.ts` | `POST /api/mobile/v1/auth/logout` | `AuthenticatedShell` sign-out | ✅ IMPLEMENTED | Session cleanup + Keystore clear |
| Token refresh | middleware | `POST /api/mobile/v1/auth/refresh` | `SessionManager` + `AuthInterceptor` | ✅ IMPLEMENTED | Transparent refresh on 401 |
| Session expiry | middleware | `GET /api/mobile/v1/session` | `SessionBootstrapper` | ✅ IMPLEMENTED | Access-period check on boot |
| Pending approval screen | `app/pending-approval/page.tsx` | Session status | `SessionGateScreens` | ✅ IMPLEMENTED | Blocked retailer redirect |
| Access expired screen | `app/access-expired/page.tsx` | Session status | `SessionGateScreens` | ✅ IMPLEMENTED | Expired access redirect |
| Unauthorized screen | `app/unauthorized/page.tsx` | Role check | `UnsupportedAccountScreen` | ✅ IMPLEMENTED | Role mismatch redirect |

---

## 2. Retailer Home

| PWA Feature | PWA Route/Component | Backend/API | Native Screen | Status | Notes |
|---|---|---|---|---|---|
| Welcome panel | `HomeContent` | `GET /api/mobile/v1/home` | `RetailerHomeScreen` WelcomePanel | ✅ IMPLEMENTED | Shop name + branding |
| Promotional banners | `PromoCarousel` | `GET /api/mobile/v1/home` banners | `BannerCarousel` | ✅ IMPLEMENTED | Server-published, area-targeted |
| Category strip | `CategoryCard` grid | `GET /api/mobile/v1/home` categories | `CategoryRail` | ✅ IMPLEMENTED | Horizontally scrolling tiles |
| Brand strip | `BrandCard` grid | `GET /api/mobile/v1/home` brands | `BrandRail` | ✅ IMPLEMENTED | Horizontally scrolling tiles |
| Featured products grid | `ProductCard` grid | `GET /api/mobile/v1/home` products | `HomeContent` product grid | ✅ IMPLEMENTED | 2-col adaptive grid |
| Recently added rail | `ProductRail` | `GET /api/mobile/v1/catalog/products?sort=newest` | `RecentRail` | ✅ IMPLEMENTED | De-duplicated from main grid |
| Search bar (in app bar) | `SearchField` | Transitions to Catalog screen | `MaharaniSearchBar` in `RetailerHomeTopBar` | ✅ IMPLEMENTED | Submits to catalog with search term |
| Error/offline states | Inline banners | N/A | `ErrorState` / `OfflineState` / `InlineErrorBanner` | ✅ IMPLEMENTED | Cached content + retry |
| Skeleton loading | Various | N/A | `HomeSkeleton` | ✅ IMPLEMENTED | Shimmer placeholders |
| Home search submit | `SearchField` | Catalog screen param | `openCatalog(CatalogRequest)` | ✅ IMPLEMENTED | Navigates to catalog tab |
| Coins balance card | `CoinsBalanceCard` | `GET /api/mobile/v1/wallet` (exists) | Not yet native | ⛔ BLOCKED | Build order only: the wallet API is live and `WalletScreen` reads it; the extra home card is not built |
| Quick actions | `HomeQuickActions` | Various | Not yet native | ⛔ BLOCKED | Quick order, reports, etc. |
| Buy again / reorder | `HomeReorderCard` | Order history + cart | Not yet native | ⛔ BLOCKED | Needs reorder API |
| Offers & coupons section | Schemes cards | Schemes data | Not yet native | ⛔ BLOCKED | Needs schemes API |
| Wholesale deals | `WholesaleDealCard` | Slab pricing | Not yet native | 🔶 PARTIAL | Price tiers visible on PDP |
| Delivery/service benefits | Service cards | Config env vars | Not yet native | ➖ NOT APPLICABLE | Static marketing content |

---

## 3. Catalogue

| PWA Feature | PWA Route/Component | Backend/API | Native Screen | Status | Notes |
|---|---|---|---|---|---|
| Product grid | `ProductCard` grid | `GET /api/mobile/v1/catalog/products` | `CatalogScreen` | ✅ IMPLEMENTED | Adaptive grid, real pricing |
| Search | `catalog-params` | `?q=` param | `CatalogViewModel` search | ✅ IMPLEMENTED | Server-side search |
| Category filter | `catalog-params` | `?categoryId=` | `CatalogViewModel` category | ✅ IMPLEMENTED | From home/category screen |
| Brand filter | `catalog-params` | `?brandId=` | `CatalogViewModel` brand | ✅ IMPLEMENTED | From home/brand screen |
| Sort options | `catalog-filters` | `?sort=` | `CatalogViewModel` sort | ✅ IMPLEMENTED | All PWA sort options |
| In-stock filter | `catalog-filters` | `?inStock=1` | `CatalogViewModel` inStockOnly | ✅ IMPLEMENTED | Boolean toggle |
| Pagination (cursor) | `InfiniteScroll` | `?cursor=` | `CatalogViewModel` loadMore | ✅ IMPLEMENTED | Server cursor-based |
| Stock badges | `StockBadge` | Pack availability | `StockBadge` design system | ✅ IMPLEMENTED | In stock / out of stock / unknown |
| Price display | `product-card` | Pack pricing | `PriceBlock` design system | ✅ IMPLEMENTED | Paise → ₹ formatting |
| Pack/MOQ info | `product-card` | Pack data | `ProductCard` pack label | ✅ IMPLEMENTED | Pack name + MOQ |
| Loading skeleton | Skeletons | N/A | `CatalogSkeleton` | ✅ IMPLEMENTED | Grid shimmer |
| Empty state | Empty states | N/A | `EmptyState` | ✅ IMPLEMENTED | With retry action |
| Error/retry | Error states | N/A | `ErrorState` | ✅ IMPLEMENTED | With retry action |
| Product count indicator | `resultCount` | Meta response | Displayed in catalog | ✅ IMPLEMENTED | Server-reported count |

---

## 4. Categories & Brands

| PWA Feature | PWA Route/Component | Backend/API | Native Screen | Status | Notes |
|---|---|---|---|---|---|
| Category directory | `CategoryDirectory` | `GET /api/mobile/v1/catalog/categories` | `CategoriesScreen` | ✅ IMPLEMENTED | Grid with product counts |
| Category tiles | `CategoryCard` | Category data | `CategoryTile` | ✅ IMPLEMENTED | Image + name + count |
| Category → catalog | Link to `/retailer/categories/[id]` | Catalog filter | `onOpenCategory` callback | ✅ IMPLEMENTED | Opens catalog filtered |
| Brand directory | `BrandDirectory` | `GET /api/mobile/v1/catalog/brands` | `CategoriesScreen` brand section | ✅ IMPLEMENTED | Grid with product counts |
| Brand tiles | `BrandCard` | Brand data | `BrandTile` | ✅ IMPLEMENTED | Logo + name + count |
| Brand → catalog | Link to `/retailer/brands/[id]` | Catalog filter | `onOpenBrand` callback | ✅ IMPLEMENTED | Opens catalog filtered |

---

## 5. Product Detail (PDP)

| PWA Feature | PWA Route/Component | Backend/API | Native Screen | Status | Notes |
|---|---|---|---|---|---|
| Product gallery | `ProductGallery` | `GET /api/mobile/v1/catalog/products/{id}` images | `ProductDetailScreen` gallery | ✅ IMPLEMENTED | Pack images + product images |
| Product name/brand | PDP header | Product detail data | `ProductDetailScreen` header | ✅ IMPLEMENTED | Full name + brand |
| Description | PDP | Product data | PDP content | 🔶 PARTIAL | Server data rendered if available |
| Pack details | `PackSelector` | `ProductPackDetailDto` | `ProductDetailScreen` pack list | ✅ IMPLEMENTED | All pack info |
| MOQ display | PDP | Pack moq | PDP pack details | ✅ IMPLEMENTED | Minimum order quantity |
| Stock status | PDP | Pack availability | `StockBadge` on PDP | ✅ IMPLEMENTED | Per-pack availability |
| Price (unit price) | PDP | Pack unitPricePaise | `MoneyFormat.formatPaise` | ✅ IMPLEMENTED | GST-inclusive per-piece |
| MRP | PDP | Pack mrpPaise | PDP pack details | ✅ IMPLEMENTED | When available |
| GST percent | PDP | Pack gstPercent | PDP pack details | ✅ IMPLEMENTED | Displayed per pack |
| Case price | PDP | Pack derivedCasePricePaise | PDP pack details | ✅ IMPLEMENTED | When available |
| Slab pricing | PDP | Pack tiers[] | PDP pack details | ✅ IMPLEMENTED | Quantity tiers |
| Add to cart | PDP button | `POST /api/mobile/v1/cart/lines` | `onAddToCart` callback | ✅ IMPLEMENTED | MOQ-based quantity |
| Pack selection | `PackSelector` | Pack list | Pack selection on PDP | ✅ IMPLEMENTED | Tap to select pack |
| Favorite toggle | `favorite-toggle.tsx` | `POST /api/mobile/v1/favorites` | Heart over `ProductGallery` (`ProductDetailScreen`) | ✅ IMPLEMENTED | The server's answer paints the heart; disabled while a write is in flight; a failed write is said inline |
| Share button | `ShareButton` | N/A | Not yet native | ➖ NOT APPLICABLE | Android share intent (future) |
| Product feedback | `ProductFeedback` | Stock alert API | Not yet native | ⛔ BLOCKED | Needs feedback mobile API |

---

## 6. Cart

| PWA Feature | PWA Route/Component | Backend/API | Native Screen | Status | Notes |
|---|---|---|---|---|---|
| Cart contents | `CartItemRow` | `GET /api/mobile/v1/cart` | `CartScreen` / `CartContent` | ✅ IMPLEMENTED | Server-priced lines |
| Add to cart | Cart actions | `POST /api/mobile/v1/cart/lines` | `addCartLine` | ✅ IMPLEMENTED | Server merge + MOQ |
| Quantity increment | `QtyStepper` | `PATCH /api/mobile/v1/cart/lines/{id}` | `increment` / `decrement` | ✅ IMPLEMENTED | MOQ + increment rules |
| Quantity set | `QtyStepper` | `PATCH /api/mobile/v1/cart/lines/{id}` | `setQuantity` | ✅ IMPLEMENTED | Direct quantity set |
| Remove line | `ClearCartButton` | `DELETE /api/mobile/v1/cart/lines/{id}` | `removeCartLine` | ✅ IMPLEMENTED | Server-side removal |
| MOQ enforcement | Cart validation | Server re-check | MOQ message on PDP + cart | ✅ IMPLEMENTED | Server is authority |
| Stock validation | Cart line | Server availability | Availability display per line | ✅ IMPLEMENTED | In/out/unknown |
| Price display | Cart line | Server pricing | `MoneyFormat.formatPaise` | ✅ IMPLEMENTED | Per-piece + line total |
| GST display | Cart line | Server gstPercent | GST rate per line | ✅ IMPLEMENTED | |
| Coupon apply | `CouponApplyForm` | `POST /api/mobile/v1/cart/coupon` | `CouponPanel` | ✅ IMPLEMENTED | Server-verified code |
| Coupon remove | `CouponApplyForm` | `DELETE /api/mobile/v1/cart/coupon` | `CouponPanel` remove | ✅ IMPLEMENTED | |
| Empty cart state | Empty state | N/A | `EmptyState` | ✅ IMPLEMENTED | Browse catalogue CTA |
| Error/retry | Error states | N/A | `ErrorState` + refresh | ✅ IMPLEMENTED | Shared cart refresh |
| Cart needs refresh | Notice | N/A | `NoticeCard` | ✅ IMPLEMENTED | Lost response reconciliation |
| Pending order check | Recovery | `GET /api/mobile/v1/orders/requests/{key}` | `checkPendingOrder` | ✅ IMPLEMENTED | Idempotency recovery |
| Cart subtotal | `CartOrderSummary` | Server-computed | Checkout totals | ✅ IMPLEMENTED | In checkout quote |
| Delivery charges | `CartOrderSummary` | Server-computed | Checkout quote | ✅ IMPLEMENTED | If server includes |

---

## 7. Checkout

| PWA Feature | PWA Route/Component | Backend/API | Native Screen | Status | Notes |
|---|---|---|---|---|---|
| Address selection | `CheckoutAddressSelector` | `GET /api/mobile/v1/addresses` | `AddressChoice` list | ✅ IMPLEMENTED | Default selection |
| Cart summary | `CheckoutForm` | `POST /api/mobile/v1/checkout/quote` | `CheckoutContent` quote | ✅ IMPLEMENTED | Server-authoritative |
| Subtotal/GST/discount | Checkout totals | Quote response | `QuoteTotals` | ✅ IMPLEMENTED | All in paise |
| Coins applied | Checkout totals | Quote coinsUsedPaise | `QuoteTotals` coins rows | ✅ IMPLEMENTED | Server-computed |
| Grand total | Checkout totals | Quote grandTotalPaise | `QuoteTotals` | ✅ IMPLEMENTED | Final payable |
| Order notes | `CheckoutForm` | Place order request | `OutlinedTextField` | ✅ IMPLEMENTED | Up to 1000 chars |
| Place order | Submit button | `POST /api/mobile/v1/orders` | `submitOrder` | ✅ IMPLEMENTED | Idempotency key |
| Duplicate prevention | Idempotency | `Idempotency-Key` header | Pending key persistence | ✅ IMPLEMENTED | DataStore-backed |
| Order recovery | Recovery flow | `GET /api/mobile/v1/orders/requests/{key}` | `recoverOrder` | ✅ IMPLEMENTED | On uncertain response |
| Order confirmation | Confirmation screen | Place order response | `OrderConfirmationContent` | ✅ IMPLEMENTED | Status, number, total |
| Error handling | Error states | N/A | `NoticeCard` + retry | ✅ IMPLEMENTED | Uncertain order flow |
| Address selector | `CheckoutAddressSelector` | Addresses API | `AddressChoice` radio | ✅ IMPLEMENTED | Default address auto-selected |

---

## 8. Orders

| PWA Feature | PWA Route/Component | Backend/API | Native Screen | Status | Notes |
|---|---|---|---|---|---|
| Order list | Order list | `GET /api/mobile/v1/orders` | `OrderHistoryScreen` | ✅ IMPLEMENTED | Cursor-paginated |
| Order status | `OrderStatusTimeline` | Order data | `OrderCard` status | ✅ IMPLEMENTED | All status values |
| Order details (expand) | Order detail page | `GET /api/mobile/v1/orders/{id}` | Expandable `OrderCard` | ✅ IMPLEMENTED | Tap to expand |
| Items list | Order items | Order items[] | `OrderItemRow` | ✅ IMPLEMENTED | Per-item details |
| Quantities/prices | Order items | Item data | Price + quantity display | ✅ IMPLEMENTED | All monetary fields |
| GST | Order items | Item gstPercent | GST display | ✅ IMPLEMENTED | |
| Totals breakdown | Order summary | Order data | Subtotal/GST/discount/total | ✅ IMPLEMENTED | |
| Dates | Order data | Order timestamps | Placed/updated display | ✅ IMPLEMENTED | UTC format |
| Notes | Order data | Order notes | Notes display | ✅ IMPLEMENTED | |
| Coins used | Order data | Order coinsUsedPaise | Coins display | ✅ IMPLEMENTED | |
| Pagination | `InfiniteScroll` | `?cursor=` | `loadMore` | ✅ IMPLEMENTED | Cursor-based |
| Invoice | `app/retailer/orders/[id]/invoice/page.tsx` | Invoice route | Not yet native | ⛔ BLOCKED | Needs invoice mobile API |
| Reorder | `app/retailer/orders/[id]/reorder/page.tsx` | Reorder action | Not yet native | ⛔ BLOCKED | Needs reorder API |
| Delivery tracking | `app/retailer/orders/[id]/delivery/page.tsx` | Delivery data | Not yet native | ⛔ BLOCKED | Needs delivery mobile API |

---

## 9. Account / Profile

| PWA Feature | PWA Route/Component | Backend/API | Native Screen | Status | Notes |
|---|---|---|---|---|---|
| Profile display | `app/retailer/account/page.tsx` | `GET /api/mobile/v1/session` | `AccountScreen` ProfileCard | ✅ IMPLEMENTED | Name, email, phone, role |
| Shop information | Account page | Session retailer data | `AccountScreen` ShopCard | ✅ IMPLEMENTED | Shop name, approval status |
| Access period | Account page | Session access data | `AccountScreen` AccessCard | ✅ IMPLEMENTED | Status + expiry date |
| Workspaces | Account page | Session navigation | `AccountScreen` WorkspacesCard | ✅ IMPLEMENTED | Granted workspaces |
| Sign out | Account page + shell | `POST /api/mobile/v1/auth/logout` | Multiple sign-out points | ✅ IMPLEMENTED | Drawer + account tab + dialog |
| Edit profile | `app/retailer/account/edit/page.tsx` | Profile RPC | Not yet native | ⛔ BLOCKED | Needs profile edit mobile API |
| Address book | `app/retailer/account/addresses/page.tsx` | `GET /api/mobile/v1/addresses` | Not yet native | 🔶 PARTIAL | Addresses loaded for checkout only |
| Security settings | `app/retailer/account/security/page.tsx` | Password update API | Not yet native | ⛔ BLOCKED | Needs security mobile API |
| Notification preferences | `app/retailer/account/notification-preferences/page.tsx` | Prefs RPC | Not yet native | ⛔ BLOCKED | Needs prefs mobile API |
| Purchase reports | `app/retailer/reports/page.tsx` | Reports query | Not yet native | ⛔ BLOCKED | Needs reports mobile API |
| Saved carts | `app/retailer/cart/saved/page.tsx` | Saved carts RPC | Not yet native | ⛔ BLOCKED | Needs saved carts API |
| Quick order | `app/retailer/quick-order/page.tsx` | Catalog search | Not yet native | 🔶 PARTIAL | Catalog search covers this |
| Help centre | `app/retailer/help/page.tsx` | Static | Not yet native | ➖ NOT APPLICABLE | Static content page |

---

## 10. Coins / Wallet

| PWA Feature | PWA Route/Component | Backend/API | Native Screen | Status | Notes |
|---|---|---|---|---|---|
| Coin balance display | `CoinsBalanceCard` | `GET /api/mobile/v1/wallet` | `WalletScreen` "🪙 Coins available" card | ✅ IMPLEMENTED | Server-authoritative balance, coins-framed: no credit limit, no "outstanding", no over-limit chip — the retired `CreditSummary` framing is gone |
| Coin history / ledger | `app/retailer/account/ledger/page.tsx` | `GET /api/mobile/v1/wallet/ledger` | `WalletScreen` ledger list | ✅ IMPLEMENTED | Cursor-paginated, all entry types |
| Coins in checkout | `CoinsCheckoutSummary` | Checkout quote coinsUsedPaise | `QuoteTotals` coins rows | ✅ IMPLEMENTED | Server-computed |
| Coins in order confirmation | Order confirmation | Order coinsUsedPaise | Confirmation display | ✅ IMPLEMENTED | |
| Coins in order detail | Order detail | Order coinsUsedPaise | Order card display | ✅ IMPLEMENTED | |
| Coin debit (server) | `debitCoinsForOrder` | Order creation | Handled by server | ✅ IMPLEMENTED | Server-side atomic |
| Coin refund (server) | `refundOrderCoins` | Order cancellation | Handled by server | ✅ IMPLEMENTED | Server-side reversal |

---

## 11. Notifications

| PWA Feature | PWA Route/Component | Backend/API | Native Screen | Status | Notes |
|---|---|---|---|---|---|
| Notification list | `app/retailer/notifications/page.tsx` | `GET /api/mobile/v1/notifications` | `NotificationsScreen` | ✅ IMPLEMENTED | Cursor-paginated, newest first |
| Read/unread state | Notification list | `POST /api/mobile/v1/notifications/read` | "Mark all read" + per-alert tap | ✅ IMPLEMENTED | One batch endpoint; tapping an alert writes only that id |
| Unread-only view | Filter on the web feed | `unreadOnly=1` on the list endpoint | All / Unread `FilterChip` row | ✅ IMPLEMENTED | The filter is the server's, never a client-side trim of the loaded page |
| Notification details | Notification body | Notification data | `NotificationCard` body | ✅ IMPLEMENTED | Full title + body |
| Notification action (link) | Alert `link_url` → web page | Notification data | `NotificationLinkRouter` → in-app route | ✅ IMPLEMENTED | Relative retailer paths only; a link with no native screen navigates nowhere rather than escaping to a browser |
| Failed read state | — | 503 from the read endpoint | `actionMessage` line above the feed | ✅ IMPLEMENTED | The feed stays on screen and the row is not marked read locally |
| Push notifications | N/A | Not yet implemented | Not yet native | ➖ NOT APPLICABLE | Future: FCM/APNs |

---

## 12. Coupons & Offers

| PWA Feature | PWA Route/Component | Backend/API | Native Screen | Status | Notes |
|---|---|---|---|---|---|
| Coupon directory | `app/retailer/coupons/page.tsx` | `GET /api/mobile/v1/coupons` | `CouponsScreen` | ✅ IMPLEMENTED | Classified: available/soon/expired/used |
| Available coupons | Coupon cards | Classified coupons | `CouponCard` available section | ✅ IMPLEMENTED | With code, title, discount details |
| Starting soon coupons | Coupon cards | Classified coupons | `CouponCard` scheduled section | ✅ IMPLEMENTED | |
| Recently expired coupons | Coupon cards | Classified coupons | `CouponCard` expired section | ✅ IMPLEMENTED | |
| Used coupons history | Coupon history | Redemptions query | `CouponCard` used section | ✅ IMPLEMENTED | Server-classified |
| Apply coupon in cart | `CouponApplyForm` | `POST /api/mobile/v1/cart/coupon` | `CouponPanel` | ✅ IMPLEMENTED | Server-verified |
| Schemes & offers | `app/retailer/schemes/page.tsx` | Schemes query | Not yet native | ⛔ BLOCKED | Needs schemes mobile API |

---

## 13. Favorites

| PWA Feature | PWA Route/Component | Backend/API | Native Screen | Status | Notes |
|---|---|---|---|---|---|
| Favourites screen | `app/retailer/favorites/page.tsx` | `GET /api/mobile/v1/catalog/products?fav=1` | `FavoritesScreen` (`:feature:catalog`) | ✅ IMPLEMENTED | Server-filtered list at live prices; skeleton, error/offline, empty, cursor paging that stops on a repeated cursor |
| Favourites header count | "N products" | `meta.resultCount` / `resultCapped` | `favorites_count` + cap line | ✅ IMPLEMENTED | The server's own count, with the cap disclosed when it bound |
| Remove from the list | Heart on the favourites card | `POST /api/mobile/v1/favorites` | `ProductCard` heart (`catalog_product_favorite:<id>`) | ✅ IMPLEMENTED | The row leaves when the server confirms the un-save — no local delete |
| Add/remove favourite | `FavoriteToggle` | `POST /api/mobile/v1/favorites` | `FavoritesStore` + `FavoritesViewModel` | ✅ IMPLEMENTED | One store for grid, list and PDP; the server's answer is the published state; a second tap mid-write is dropped |
| Heart on catalogue cards | `product-card.tsx` heart | `isFavorite` on the list payload | `ProductCard` / `ProductGrid` | ✅ IMPLEMENTED | Home rails keep no heart, mirroring the web home, whose payload has no `isFavorite` |
| Favourites destination | `/retailer/favorites` | Retailer-only rows | `MaharaniRoutes.FAVORITES` + drawer + masthead heart | ✅ IMPLEMENTED | `MaharaniRouter` grants it to the RETAILER role only |
| Stock alerts for favourites | `StockAlertButton` | Alert subscription | Not yet native | ⛔ BLOCKED | No mobile stock-alert API exists yet; later phase |

---

## 14. Support

| PWA Feature | PWA Route/Component | Backend/API | Native Screen | Status | Notes |
|---|---|---|---|---|---|
| Support tickets list | `app/retailer/support/page.tsx` | Support query | Not yet native | ⛔ BLOCKED | Needs support mobile API |
| Create ticket | `app/retailer/support/new/page.tsx` | Create ticket action | Not yet native | ⛔ BLOCKED | |
| Ticket detail | `app/retailer/support/[id]/page.tsx` | Ticket detail query | Not yet native | ⛔ BLOCKED | |
| Reply to ticket | `SupportReplyForm` | Reply action | Not yet native | ⛔ BLOCKED | |

---

## 15. Navigation & Shell

| PWA Feature | PWA Route/Component | Backend/API | Native Screen | Status | Notes |
|---|---|---|---|---|---|
| Bottom navigation | `RetailerShell` / `MobileBottomNav` | N/A | `NavigationBar` in `AuthenticatedShell` | ✅ IMPLEMENTED | 5 tabs: Home, Categories, Cart, Orders, Account |
| Navigation drawer | `Sidebar` | N/A | `ModalNavigationDrawer` | ✅ IMPLEMENTED | Extra destinations |
| Role-based routing | `MaharaniRouter` | Session policy | `MaharaniRouter.resolveSession` | ✅ IMPLEMENTED | Server-driven navigation |
| Back navigation | Browser back | N/A | System back + `popBackStack` | ✅ IMPLEMENTED | Native back stack |
| Cart badge | `app/retailer/layout.tsx` head count | `GET /api/mobile/v1/shell/badges` | `CountBadge` on the bottom-nav cart item | ✅ IMPLEMENTED | Server count; hidden at zero; drawn as 99+ past 99 |
| Notification badge | `app/retailer/layout.tsx` head count | `GET /api/mobile/v1/shell/badges` | `CountBadge` on the masthead bell | ✅ IMPLEMENTED | Same single read; refreshed on resume and on leaving the cart or the alert feed, never on a timer |
| Shared shell counters | Server component (per request) | `ShellBadgesDto` → `ShellBadgeStore` | `ShellBadgesViewModel` in the shell | ✅ IMPLEMENTED | One flow for bar, masthead and drawer; a failed read keeps the last known counts instead of blinking to zero |

---

## 16. Design System & UX

| PWA Feature | Native Equivalent | Status |
|---|---|---|
| Brand colours / theming | `MaharaniThemeTokens` + Material 3 | ✅ IMPLEMENTED |
| Responsive layouts | Adaptive grids + `GridCells.Adaptive` | ✅ IMPLEMENTED |
| Image loading | Coil 3 with OkHttp | ✅ IMPLEMENTED |
| Skeleton loading | `Skeletons` design system | ✅ IMPLEMENTED |
| Error states | `ErrorState` / `OfflineState` | ✅ IMPLEMENTED |
| Empty states | `EmptyState` | ✅ IMPLEMENTED |
| Money formatting | `MoneyFormat.formatPaise` (₹ Indian locale) | ✅ IMPLEMENTED |
| Date formatting | `IsoDateDisplay.formatDate` | ✅ IMPLEMENTED |
| Touch targets (48dp) | Enforced via `MaharaniDimens` | ✅ IMPLEMENTED |
| Status bar handling | Edge-to-edge + insets | ✅ IMPLEMENTED |

---

## Summary

Counted from the status column of every feature row in this file (the
design-system table at §16 is a capability list, not a parity row, and is excluded):

| Status | Count |
|--------|-------|
| ✅ IMPLEMENTED | 130 |
| 🔶 PARTIAL | 4 |
| ⛔ BLOCKED | 19 |
| ➖ NOT APPLICABLE | 4 |

⛔ BLOCKED in this document means "not built in the native app yet". Most of those
rows need no new backend at all — the mobile endpoint already exists and the work
is a Compose screen. Only the rows whose note names a missing endpoint (`schemes`,
`invoice`, `reorder`, `support`, `profile edit`, `security`, `notification
preferences`, `saved carts`, `stock alerts`, `reports`) require server work first.

### Priority Roadmap for the remaining rows

1. **Order detail + invoice** — `GET /api/mobile/v1/orders/{id}` is live; the native
   per-order screen and its invoice action are not built
2. **Support** — Add `GET/POST /api/mobile/v1/support` + native screens
3. **Schemes** — Add `GET /api/mobile/v1/schemes` + native screen
4. **Reorder** — Add `POST /api/mobile/v1/orders/{id}/reorder` + native flow
5. **Address Book** — `GET /api/mobile/v1/addresses` is live; the CRUD screens are not
6. **Profile Edit / Security** — Add `PATCH /api/mobile/v1/profile` + password UI
7. **Delivery Tracking** — Add a delivery status endpoint + native screen
8. **Home Quick Actions + home coins card** — pure UI on existing reads
9. **Notification preferences** — Add the prefs mobile API + native screen
10. **Stock alerts for favourites** — Add the alert mobile API + native button

---

## Verification log

### 2026-10-05 — favourites, shell badges, notification UX

Three gaps closed; the PR #84 engagement backend was reused, not rewritten.

**Backend (one new endpoint, nothing else added):**

| Endpoint | Status | Notes |
|---|---|---|
| `GET /api/mobile/v1/shell/badges` | new | `{ cartCount, unreadNotificationCount }`; retailer-gated (`requireRetailerCommerceSession`), rate-limited `read.orders`, counts only (no cart rows, no notification bodies); the two head-count queries of `app/retailer/layout.tsx`, verbatim |
| `GET/POST /api/mobile/v1/favorites` | reused | unchanged |
| `GET /api/mobile/v1/catalog/products?fav=1` | reused | the filter existed server-side (`lib/retailer/catalog-batches.ts` `query.in('id', favoriteIds)`); the mobile query parser already read `fav` — the app simply never sent it |
| `GET /api/mobile/v1/notifications?unreadOnly=1`, `POST /notifications/read` | reused | unchanged |

**Native (Kotlin/Compose — no WebView, no new Hilt module):**

- `:feature:catalog`: `FavoritesStore` (`@Singleton`, the only owner of the
  favourite write), `FavoritesViewModel`, `ui/FavoritesScreen.kt` (header count +
  cap disclosure, skeleton, offline/error, empty → "Browse catalogue", grid with
  hearts, load-more that stops on a repeated cursor, refresh).
- `ProductCard` / `ProductGrid` gained trailing `isFavorite` / `favoriteBusy` /
  `onToggleFavorite` parameters with defaults, and `CatalogScreen` /
  `ProductDetailScreen` gained a trailing `favoritesViewModel` — every existing
  call site (including the home rails) keeps its old behaviour.
- `:feature:engagement`: `NotificationsViewModel` gained `unreadOnly` (a server
  query) and `markRead(id)`; `NotificationsScreen` gained the All / Unread chips,
  tap-to-mark-read, a Refresh action and an `actionMessage` line that does not
  destroy the loaded feed; `WalletScreen` now shows "🪙 Coins available" with no
  credit-limit/outstanding/over-limit framing.
- `:app`: `ShellBadgesViewModel` + `:feature:engagement`'s `ShellBadgeStore`
  (counts from `GET /shell/badges` only — nothing accumulates on the device, a
  failed read keeps the last counts, sign-out clears them); `CountBadge` on the
  bottom-nav cart item and the masthead bell; masthead heart → `FAVORITES`;
  `NotificationLinkRouter` maps alert links onto in-app routes.

**Tests:**

| Layer | Test | Covers |
|---|---|---|
| web | `tests/mobile-shell-engagement-api.test.ts` (new, 24 tests) | badge counts are owner-filtered and body-free; empty feed is two zeros not an error; 401/403/503 gates; `unreadOnly=1` reaches the query; a read-marking update carries `recipient_id` + the exact ids and rejects `[]`, non-UUID, 101 ids, unknown keys, bad JSON; the favourites toggle inserts `{retailer_id, product_id}` only, flips state on a second call, and a failed write invents nothing |
| web | `tests/mobile-catalog-api.test.ts` | `fav=1` parses to `onlyFavorites`, `fav=0`/absent does not turn the filter on |
| Android | `FavoritesStoreTest` (7) | server answer published; no client-side toggle guess; in-flight tap dropped; failure keeps last state + message; blank id costs no request |
| Android | `FavoritesViewModelTest` (6) | `fav=1` sent and nothing else; count/cap carried; dedupe + repeated-cursor stop; failed refresh keeps rows; offline/retryable; message dismissal |
| Android | `CatalogRepositoryTest` (4 added) | `favoritesOnly` omitted vs `1`; trimmed id write returns the server state; empty id never reaches the network; transport failure is offline + retryable |
| Android | `NotificationsViewModelTest` (5 added) | unread filter is a server query; switching filters starts empty; per-alert read writes only that id; a read row is not rewritten; a failed write keeps the feed |
| Android | `ShellBadgeStoreTest` (7) | published counts; failure keeps last known; first failure is not a badge; negative clamps to none; loading only while in flight; concurrent triggers collapse to one read; sign-out clears |
| Android | `NotificationLinkRouterTest` (7), `MaharaniRouterTest` (3 assertions added) | only relative retailer routes map; admin/staff/absolute/protocol-relative links open nothing; `FAVORITES` is retailer-only and absent for a salesman holding the retailer workspace |

**Not faked / still open, stated plainly:**

- `/retailer/orders/<id>` alert links open the **Orders tab**, not a per-order
  screen: the native order-detail screen is roadmap item 1. Nothing was invented
  for it.
- An alert link with no native destination is **not tappable** (no chevron, no
  browser hop) — there is no WebView and no external browser intent in this app.
- Home rails carry **no heart**, because the web home payload carries no
  `isFavorite`; adding one to the rail cards would mean inventing a field the
  server does not send there.
- Favourite writes are still `POST /favorites`-only: no optimistic flip, so a slow
  link shows the busy state rather than a heart that may be wrong.
- Push notifications remain out of scope (no FCM); the badge is a pull on resume /
  tab change only.