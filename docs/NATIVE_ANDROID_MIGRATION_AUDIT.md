# Native Android Migration — Repository & Architecture Audit

**Phase A deliverable 1 of 3.** Companion documents:
`docs/NATIVE_ANDROID_API_CONTRACT.md` (endpoint inventory) and
`docs/NATIVE_ANDROID_MIGRATION_PLAN.md` (module structure, phases, acceptance tests).

- **Branch:** `arena/01a0f75c-maharani-mart` (base commit `5b76aa0`, `main`)
- **Repository:** `https://github.com/mahakali108/Maharani-mart` (verified via `git remote -v`)
- **Audit date:** 2026-10-01
- **Objective being audited against:** replace the current Android delivery (a
  Capacitor *remote-URL WebView shell*) with a **native Kotlin / Jetpack Compose
  application** that talks to a versioned `/api/mobile/v1` surface, while
  preserving the existing Next.js + Supabase backend, RLS, roles and business rules.

> **Claim discipline.** Everything below is either (a) a file/command observation
> with its evidence, (b) an explicit decision, or (c) an explicit blocker. No feature
> is marked "done" because a screen or a document exists.

---

## 1. Executive summary

| Question | Finding |
| --- | --- |
| Is there an existing *native* Android project? | **No.** There is no committed `android/` source tree at all — `.gitignore` ignores `/android`, and CI generates a Capacitor project from scratch on every run. |
| What exists today for Android? | A **Capacitor remote-URL wrapper** (`capacitor.config.ts` → `server.url = https://maharani-mart-mahakali108s-projects.vercel.app`), a generated `MainActivity.java` heredoc inside the CI workflow, brand/launcher assets in `resources/`, an offline HTML screen in `www/`, and two Capacitor post-sync scripts. |
| Is the current shell acceptable as the final UI? | **No** — the stated objective forbids a PWA / website shortcut / WebView / Capacitor remote-URL shell as the final application UI. It must be replaced by native Compose screens. |
| Is there anything to preserve in the Android layer? | Only **identity and assets**: application id `com.maharanitraders.app`, app name `Maharani Traders`, launcher/splash brand assets, and the "offline / no internet" UX intent. No Android business logic exists to preserve. |
| Backend readiness for a mobile API | **Good.** Business rules already live in server-only TypeScript services (`lib/orders`, `lib/retailer`, `lib/warehouse`, `lib/coins`, …) that are independent of React and can be called from Route Handlers. There are currently only 6 API routes; everything else is Server Actions/Server Components. |
| Existing test baseline | **Green.** `node_modules/.bin/vitest run` → `Test Files 94 passed (94)`, `Tests 1780 passed (1780)`, 40.9 s, exit code 0 (run on this branch, 2026-10-01). |
| Can Android be compiled in this working environment? | **No.** See §8 — no JDK/Android SDK and Maven/Google endpoints are network-blocked here. Android build verification must run in GitHub Actions. |

**Migration shape (decided):** keep Next.js as the business layer, keep Supabase as
DB/Auth/Storage and RLS, add a versioned JSON API `/api/mobile/v1` that calls the
**existing validated server services**, and build a native Compose app that only
ever talks to that API. No business rule is re-implemented in Kotlin.

---

## 2. Discovery method (what was actually inspected)

| Area | Evidence inspected |
| --- | --- |
| Repo/CI | `git log`, `git remote -v`, `git branch -a`, `.gitignore`, `package.json`, `pnpm-lock.yaml` presence, `.github/workflows/android-apk.yml`, `vercel.json`, `next.config.mjs` |
| App routes | `find app -name page.tsx` → **127 pages** across `admin` (65), `retailer` (38), `salesman` (18), `staff` (9), public/auth (7) |
| API routes | `app/api/{health,webhooks,ai/chat,ai/memory,admin/storage-report,cron/cleanup}/route.ts` (6) |
| Server logic | 195 files under `lib/**` — `orders` (create/quote/state-machine/wallet-reversal/credit), `retailer` (catalog, pricing, cart, checkout, wallet, ledger, support, reports…), `warehouse`, `coins`, `coupons`, `delivery`, `notifications`, `retention`, `admin`, `salesman`, `staff`, `permissions`, `auth` |
| Auth/authz | `middleware.ts`, `lib/auth/{roles,session,helpers,actions}.ts`, `lib/permissions/permissions.ts`, `lib/admin/guard.ts`, `lib/salesman/guard.ts`, `lib/admin/control-center/guard.ts`, `docs/phone-auth.md`, `docs/role_permission_matrix.md` |
| DB | 55 migrations `supabase/migrations/0001…0055`, RPC inventory (§4.3), `types/database.types.ts` (2 382 lines), `supabase/audits/phase0_privileged_accounts_readonly.sql` |
| Tests | 94 test files incl. `tests/helpers/pg-harness.ts` (PGlite harness that applies **every** migration on a Supabase platform stub) and static source-scan guards (`tests/mobile-safety.test.ts`, `tests/production-readiness.test.ts`) |
| Android artifacts | `capacitor.config.ts`, `AUDIT_ANDROID.md`, `.github/workflows/android-apk.yml`, `scripts/android-postsync.mjs`, `scripts/android-resource-validation.mjs`, `www/{index,offline}.html`, `resources/**`, `resources/android-res/**`, `public/icons/**` |
| Environment | `node -v` (v22.22.3), `corepack`/pnpm 9.15.9, `pnpm install --frozen-lockfile` (exit 0), `vitest run` (exit 0), network reachability probes, `gh auth status` |

---

## 3. Existing Android surface — detailed findings

### 3.1 `capacitor.config.ts` (remote-URL shell)

- `appId: 'com.maharanitraders.app'`, `appName: 'Maharani Traders'`, `webDir: 'www'`.
- `server.url` defaults to `https://maharani-mart-mahakali108s-projects.vercel.app`
  (overridable by `CAP_SERVER_URL`), `cleartext: false`, `allowMixedContent: false`,
  `errorPath: 'offline.html'`.
- The file documents that the earlier alias `maharani-mart-one.vercel.app` returned
  `DEPLOYMENT_NOT_FOUND`, i.e. the shell already shipped a **stale/broken target once**.
- `AUDIT_ANDROID.md` (committed earlier) contains **false claims** for the current
  state, e.g. "Everything else already works via the live site … since the wrapper
  loads that site directly" and "No existing logo/icon asset: zero image assets exist
  anywhere" — both are contradicted by the repo now (`resources/**` contains 5 PNGs;
  `resources/android-res/**` contains 42 generated assets). Treat that document as
  historical, not authoritative.

### 3.2 CI (`.github/workflows/android-apk.yml`)

Runs on `main` pushes touching the wrapper, then: `npm install` → `npx cap add android`
→ `npx cap sync android` → writes `MainActivity.java` (WebView back-button handling)
→ `./gradlew assembleDebug` → uploads `app-debug.apk`. **The `android/` project is
never committed**; the workflow name and artifact both describe the wrapper.

> **Status after the Phase B change:** this workflow has been replaced by the native
> pipeline described in the plan (§5). It no longer runs `cap add android`; it builds the
> committed `android/` project, runs its unit tests and lint, uploads the debug APK, and
> uploads a signed AAB only when the four `RELEASE_*` secrets are configured. The text
> below is the pre-change snapshot that motivated the replacement.

Consequences for this migration:

1. The workflow must be replaced by a native build (unit tests + lint + debug APK,
   optional release) or CI will keep producing the shell.
2. Because `android/` is git-ignored, a committed native project requires a
   deliberate `.gitignore` change (keep ignoring build output, keystores, `local.properties`).

### 3.3 Assets available for native branding (no invented logo needed)

| Path | Contents | Reuse |
| --- | --- | --- |
| `resources/icon-only.png` (836 KB), `resources/icon-foreground.png` (437 KB), `resources/icon-background.png` (16 KB) | source brand icon | adaptive icon source |
| `resources/splash.png` (334 KB), `resources/splash-dark.png` (1.2 MB) | splash art | splash screen |
| `resources/android-res/mipmap-{m,h,xh,xxh,xxx}dpi/ic_launcher{,_round,_foreground}.png` | 5 densities, ready to use | **directly reusable** as native launcher icons |
| `resources/android-res/values/ic_launcher_background.xml` | adaptive-icon background colour | direct reuse |
| `resources/android-res/drawable*/splash.png` (port/land/night, 5 densities each) | splash per density/orientation | splash assets or a single `core-splashscreen` window background |
| `public/icons/{icon-192,icon-512,icon-maskable-512}.png`, `apple-touch-icon.png`, `favicon.ico` | PWA icons | reference only |
| `public/banners/`, `public/logos/` | **empty** | banner art is DB-driven (`banners.image_url`), not repo files |
| `www/{index,offline}.html`, `public/offline.html`, `public/sw.js` | shell/PWA scaffolding | superseded; keep until the native app ships |

**Decision:** reuse `resources/android-res/mipmap-*` + `values/ic_launcher_background.xml`
as-is for Phase B launcher icons, and the existing splash PNG for the native splash.
No religious or invented mark is introduced. Any branding change needs owner approval.

### 3.4 Test coupling to the Capacitor shell (must be updated deliberately, not silently)

| Test | Assertion | Impact of migration |
| --- | --- | --- |
| `tests/mobile-safety.test.ts:121-125` | `capacitor.config.ts` contains `appId` and `android` | passes unchanged while the file is kept |
| `tests/production-readiness.test.ts:276-288` | `capacitor.config.ts` contains `Maharani Traders`, `androidScheme`, no `supabase.co`/`SUPABASE_URL`; `package.json` scripts `cap:sync`, `android:build:debug`, `android:build:release` exist | keep the config file and the three script names; **repoint** the two `android:build:*` scripts at the native project |
| `tests/pdp-*`, `tests/retailer-*` (source scans) | do not reference Android | unaffected |

`scripts/android-postsync.mjs` and `scripts/android-resource-validation.mjs` are
Capacitor post-sync hooks (`cap sync` runs them). With a native project they become
dead code; they are left in place this phase (removing them is a follow-up that must
land together with the test updates above).

---

## 4. Backend surface the mobile API must reuse

### 4.1 Authentication & authorization (existing)

- **Roles** (`lib/auth/roles.ts`): `super_admin | admin | staff | salesman | retailer`;
  home routes `ROLE_HOME`; path gates `ROLE_ROUTE_PREFIXES`
  (`/admin` → super_admin|admin, `/staff` → staff|admin|super_admin,
  `/salesman` → salesman|admin|super_admin, `/retailer` → retailer).
- **Middleware** (`middleware.ts`) enforces, per request: session refresh, redirect to
  `/login` when unauthenticated, `profiles.is_active` check (sign-out + `account_inactive`),
  **access-period** validity via `user_access_periods` (status in
  `active|expiring_soon|unlimited`, `expires_at` in the future; **super_admin exempt**;
  missing record = allowed for backward compatibility) → `/access-expired`,
  retailer `status = pending_approval` → `/pending-approval`,
  retailer `status = suspended` → sign-out + `account_suspended`,
  and `isRoleAllowedForPath` → `/unauthorized`.
- **Login methods** (`lib/auth/actions.ts`, `docs/phone-auth.md`): email+password
  (`loginAction`) and **phone+password** (`loginWithPhoneAction`): `normalizePhone()`
  (canonical 10-digit Indian mobile) → service-role lookup `profiles.phone → id` →
  `auth.admin.getUserById(id)` → `signInWithPassword({ email, password })`.
  Generic error for unknown phone/wrong password (no account enumeration).
  Password reset via `requestResetAction`; `updatePasswordAction` requires ≥ 8 chars.
- **Permissions engine** (`lib/permissions/permissions.ts`): `can/canAny/canAll/assertPermission`
  over ~50 permissions; role matrix is the single source of truth, with
  `coins.manage` restricted to admin/super_admin and `cleanup.view` to admin/super_admin.
- **Super-admin-only** surfaces guarded by `lib/admin/control-center/guard.ts`
  (`requireSuperAdmin`) — must stay super-admin-only in the app.

### 4.2 Retailer money/stock path (the invariants the app must not break)

- `lib/retailer/checkout-actions.ts::placeOrderAction(notes, addressId?)`:
  `requirePermission('orders.create')` → retailer-only → **cart claimed atomically**
  (`delete().eq(retailer_id).select('pack_id, quantity')`; empty ⇒ "cart is empty";
  duplicates race on the same rows so only one wins) → `restoreClaimedCart()` on any
  downstream failure → address resolved server-side (`retailer_addresses` owner-scoped,
  else `retailers.address`) → coupon read from the retailer's own active-coupon row
  (`loadActiveCouponForRetailer`, **never client-supplied**) → `createOrderForRetailer`
  → clear active coupon → revalidate paths → in-app notification (best-effort) →
  `redirect('/retailer/orders/{id}?placed=1')`.
- `lib/orders/create-order.ts::createOrderForRetailer`: optional `requestKey`
  (UUID v4 validated) for retry-safe salesman capture, `replayRequestKey()` returns the
  original result for a repeat submission, cross-checks `retailer_id`/`collected_by`,
  rejects cancelled/unfinished requests; re-quotes through `quoteOrderForRetailer`
  immediately before writing; **warehouse resolved server-side**; inserts the order,
  then order items (a DB trigger locks the pack, checks stock and decrements
  atomically — a failure cancels the order and restores stock); coupon redemption via
  `rpc('redeem_coupon')` with compensating cancel; coins via `debitCoinsForOrder`
  (idempotent on `order:<id>`) with compensating cancel; `complete_order_request` via
  service role to mark the request finished. `orderCreationErrorMessage()` maps
  `INSUFFICIENT_STOCK: Only X available…` to customer copy.
- `lib/orders/quote-order.ts::quoteOrderForRetailer({ retailerId, lines, supabase, couponCode })`
  is the authoritative price/GST/MOQ/availability read. **Server is authoritative for
  every money value.**
- `lib/warehouse/resolver.ts` + `lib/warehouse/config.ts`: exactly one active warehouse;
  0 → configuration error, 2+ → configuration error, never a random pick; no hardcoded
  UUID; customer-facing copy via `warehouseConfigCustomerMessage()`.
- `lib/coins/{math,server}.ts`: `COINS_PER_RUPEE = 1`, `coinDebitKey(orderId)`,
  `computeCoinPayment`, `getRetailerCoinPosition`, `quoteCoinPayment`,
  `getOrderCoinMovement`, `debitCoinsForOrder`, `refundOrderCoins` — balance mutations
  are server-side, atomic and idempotent.
- `lib/retailer/{catalog,case-pricing,effective-price,retailer-pricing,pricing-data}.ts`
  price packs (case/loose tiers, MOQ, overrides, offers) through one engine shared with
  checkout; `lib/retailer/availability.ts` maps the status-only availability RPC to
  In stock / Out of stock customer vocabulary.
- Legacy inventory (batches/GRN/FEFO) still exists for historical orders, dispatches,
  returns and reports (`docs/inventory.md`, `docs/warehouse-gaps.md`) — it must keep
  working for the web; **the new simple pack-stock order flow must not reintroduce FEFO or
  warehouse reservations** (migrations `0054_simplified_pack_stock.sql`, triggers
  `keep_order_stock_mode_immutable`, `keep_simple_stock_order_warehouse_server_resolved`).

### 4.3 Database functions available to server paths (55 migrations)

`prepare_simple_stock_order_insert`, `deduct_simple_pack_stock_for_order_item`,
`consume_order_stock`, `restore_simple_stock_on_cancel`, `restore_simple_order_stock`,
`guard_simple_stock_order_item_update`, `keep_order_stock_mode_immutable`,
`keep_simple_stock_order_warehouse_server_resolved`, `complete_order_request`,
`order_shortfall_coins`, `refund_order_coins`, `get_retailer_pack_availability`,
`run_data_cleanup`, `guard_data_retention_rules_mutation`, `admin_product_pack_stock`,
`admin_set_product_pack_stock`, `admin_top_products`, `guard_admin_only_columns`,
`guard_profile_privileged_columns`, `handle_new_user`, `current_user_role`,
`current_jwt_role`, `is_active_account`, `is_admin_or_above`, `is_staff_or_above`,
`is_phone_registered`, `require_inventory_role`, `default_new_product_pack_stock`.

### 4.4 Existing HTTP endpoints (only 6)

| Route | Auth | Purpose | Mobile use |
| --- | --- | --- | --- |
| `GET /api/health` | none | DB reachability probe; `{status,database,latencyMs,timestamp}`; 503 degraded / 500 error, never echoes driver errors | reuse for **ops**; mobile gets its own probe (below) |
| `POST /api/webhooks` | `x-webhook-secret` (constant-time) | inbound provider callbacks; today only authenticates + acks (no provider wired) | no mobile role |
| `POST /api/ai/chat`, `POST /api/ai/memory` | AI auth (`lib/ai/authenticate.ts`) | Maharani AI | Phase G+ decision (not required) |
| `GET /api/admin/storage-report` | admin | storage usage | Phase G (admin) |
| `GET /api/cron/cleanup` | `CRON_SECRET` bearer, fail-closed | data-retention cleanup scheduler | **never** callable from Android; app may only *display* status/dry-run |

### 4.5 Environment contract (`.env.local.example`)

Required: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY` (**server-only**), `NEXT_PUBLIC_SITE_URL`, `WEBHOOK_SECRET`,
`CRON_SECRET`. Optional: `DELIVERY_OTP_SECRET`, Turso (`TURSO_DATABASE_URL`,
`TURSO_AUTH_TOKEN` — derived, disposable search cache only), `AI_*`,
`AI_ACTION_SIGNING_SECRET`, and `COMPANY_*` display values (phone/GSTIN/dispatch/
delivery copy — when unset the web deliberately shows nothing rather than inventing it).

**Mobile consequence:** the app must ship **no Supabase key and no secret**. The API base
URL is the only compiled-in configuration value (see `docs/NATIVE_ANDROID_MIGRATION_PLAN.md` §6).

---

## 5. Feature classification (mandated)

Legend — **REUSE**: existing authenticated API or reusable server service already
satisfies it · **NEW-API**: needs a thin authenticated mobile route over an existing
server service · **NATIVE**: Android-only work (UI, storage, lifecycle) · **CONFIG**:
requires manual configuration/external credentials/master data · **BLOCKED**: cannot be
delivered without a decision, credential or upstream change.

### 5.1 Cross-cutting

| # | Feature | Class | Reuse target | Phase |
| --- | --- | --- | --- | --- |
| 1 | Sign in (phone + password) | REUSE (logic) + NEW-API | `normalizePhone` + service-role phone→email resolution + `signInWithPassword` (`lib/auth/actions.ts`) | C |
| 2 | Sign in (email + password) | REUSE + NEW-API | `loginAction` logic | C |
| 3 | Session restore / refresh / logout | NEW-API + NATIVE | Supabase Auth session protocol (`/auth/v1/token?grant_type=refresh_token`), Keystore storage | B/C |
| 4 | Expired session handling | REUSE + NATIVE | `expires_at` on the session, 401 handling | C |
| 5 | Password recovery | REUSE + NEW-API | `requestResetAction`, `updatePasswordAction` | C |
| 6 | Pending retailer approval gate | REUSE | `retailers.status`, middleware rule | C |
| 7 | Suspended / deactivated account handling | REUSE | `profiles.is_active`, `retailers.status` | C |
| 8 | Access-period expiry (7-day system) | REUSE | `user_access_periods` (`/access-expired`) | C |
| 9 | Role-aware navigation | REUSE | `ROLE_HOME`, `ROLE_ROUTE_PREFIXES`, `permissions.ts` | B/C |
| 10 | 403/401 handling for unauthorized API calls | NEW-API + NATIVE | shared error envelope | B/C |

### 5.2 Retailer / Kirana owner

| # | Feature | Class | Reuse target | Phase |
| --- | --- | --- | --- | --- |
| 11 | Retailer registration | REUSE + NEW-API | `app/register-retailer` flow (`lib/auth/actions.ts` signup + `handle_new_user`) | C |
| 12 | Catalog list (categories, brands, filters, sort, infinite scroll) | REUSE + NEW-API | `lib/retailer/catalog.ts` (`PRODUCT_CARD_SELECT`, `toPricedCard`, `priceCatalogProducts`), `catalog-params.ts` (`CATALOG_SORTS`, page size 24, max 240), `lib/infinite-scroll/*` keyset cursor | D |
| 13 | Search + suggestions | REUSE + NEW-API | `lib/retailer/search-actions.ts`, `sanitizeSearchTerm` | D |
| 14 | Product detail (compact PDP) | REUSE + NEW-API + NATIVE | `loadProductsByIds`, `priceCatalogPack`, `nextTierHint`, `bestSlabOffer`, gallery/variant data (`lib/retailer/variants.ts`) — **preserve compact layout; no duplicate price blocks/Buy Now** | D |
| 15 | Packs, pack sizes, MOQ, tier pricing | REUSE | `case-pricing.ts`, `effective-price.ts`, `retailer-pricing.ts`, `pricing-data.ts` | D |
| 16 | Availability (In stock / Out of stock) | REUSE | `rpc get_retailer_pack_availability` via `loadCatalogAvailability` | D |
| 17 | Favorites | REUSE + NEW-API | `lib/retailer/favorite-actions.ts`, `loadFavoriteIds` | D |
| 18 | Cart (add/update/remove/clear, saved carts) | REUSE + NEW-API | `lib/retailer/cart-service.ts`, `cart-actions.ts`, `cart-merge.ts`, `saved-cart-actions.ts` | E |
| 19 | Buy now / quick order / bulk order | REUSE + NEW-API | `buyNowAction`, `bulk-order-actions.ts`, `quick-order` page logic | E |
| 20 | Coupons (list, apply, remove) | REUSE + NEW-API | `lib/coupons/{engine,validate,actions}.ts`, `coupon-directory.ts` | E |
| 21 | Checkout quote (server GST + totals + coins preview) | REUSE + NEW-API | `quoteOrderForRetailer`, `quoteCoinPayment` | E |
| 22 | Place order (idempotent, atomic stock) | REUSE + NEW-API | `placeOrderAction` cart-claim semantics or `createOrderForRetailer` + `request_key` | E |
| 23 | Order confirmation | REUSE + NATIVE | created order payload | E |
| 24 | Order history / details / status timeline | REUSE + NEW-API | `lib/orders/state-machine.ts`, `item-display.ts`, `order-tracking` | E |
| 25 | Cancel order (+ stock/coin restoration) | REUSE + NEW-API | `cancelOrderAction` (DB `restore_simple_stock_on_cancel`, `refund_order_coins`) | E |
| 26 | Return request | REUSE + NEW-API | `requestReturnAction`, `lib/delivery/return-window.ts` | E |
| 27 | Reorder | REUSE + NEW-API | `addReorderLinesToCartAction` | E |
| 28 | Invoice view | NATIVE (render) + REUSE | `lib/retailer/invoice-{display,html,tax}.ts` (server-computed split) | E |
| 29 | Coins balance + transactions | REUSE + NEW-API | `getRetailerCoinPosition`, `lib/retailer/wallet.ts` ledger batch | F |
| 30 | Notifications (in-app list, mark read) | REUSE + NEW-API | `lib/notifications/notify.ts`, `notification-actions.ts` | F |
| 31 | Banners (DB-driven, scheduled, multiple, fallback) | REUSE + NEW-API | `banners` table, `lib/retailer/banner-target.ts` (`isBannerVisible`, schedule instants) | F |
| 32 | Wallet / ledger / outstanding (historical credit) | REUSE + NEW-API | `lib/retailer/wallet.ts`, `ledger.ts` (batch 25, `cancelled` excluded) | F |
| 33 | Profile, addresses, security, notification prefs | REUSE + NEW-API | `lib/retailer/profile-actions.ts`, `address-actions.ts` | F |
| 34 | Support tickets | REUSE + NEW-API | `lib/retailer/support.ts`, `support-actions.ts` | F |
| 35 | Retailer reports / schemes | REUSE + NEW-API | `lib/retailer/reports.ts`, schemes pages | G |
| 36 | Maharani AI (retailer scope) | BLOCKED pending decision | `lib/ai/*` (streaming, signed cart confirmations) — needs product decision + provider credentials | G+ |

### 5.3 Sales executive

| # | Feature | Class | Reuse target | Phase |
| --- | --- | --- | --- | --- |
| 37 | Assigned retailers / retailer detail | REUSE + NEW-API | scoped RLS + `lib/salesman/*`, `docs/role_permission_matrix.md` | G |
| 38 | Order capture on behalf of a retailer (retry-safe) | REUSE + NEW-API | `createOrderForRetailer` + `requestKey` + `complete_order_request` | G |
| 39 | Visits, routes, follow-ups, DCR, attendance, targets, commissions | REUSE + NEW-API | `lib/salesman/*-actions.ts` | G |
| 40 | Collections / payment recording | REUSE + NEW-API | `lib/salesman/collection-actions.ts`, `lib/delivery/settlement.ts` | G |
| 41 | Deliveries (execute, OTP, proof) | REUSE + NEW-API | `lib/delivery/*`, `lib/staff/dispatch-actions.ts` | G |

### 5.4 Warehouse / staff

| # | Feature | Class | Reuse target | Phase |
| --- | --- | --- | --- | --- |
| 42 | Order queue, pick/pack, dispatch | REUSE + NEW-API | `lib/staff/{pick-pack-actions,dispatch-actions}.ts`, `lib/orders/state-machine.ts` | G |
| 43 | Stock view / adjustments (pack stock) | REUSE + NEW-API | `admin_product_pack_stock`, `admin_set_product_pack_stock`, `requireActiveWarehouse` | G |
| 44 | GRN / batches / transfers / ledger / low stock (legacy inventory) | REUSE + NEW-API | `lib/admin/{grn,inventory,transfer}-actions.ts` — **preserved for the web; not part of the new simple pack-stock flow** | G |
| 45 | Warehouse configuration error surfacing | REUSE | `classifyWarehouseConfig`, customer vs operator copy | B/G |

### 5.5 Admin / super admin

| # | Feature | Class | Reuse target | Phase |
| --- | --- | --- | --- | --- |
| 46 | Retailer approval & account management | REUSE + NEW-API | `lib/admin/retailers-actions.ts` | G |
| 47 | Products / packs / stock management | REUSE + NEW-API | `lib/admin/products-actions.ts`, `master-data-actions.ts`, `pack-seed.ts` | G |
| 48 | Orders & operational workflows | REUSE + NEW-API | `lib/admin/orders-actions.ts`, `returns-actions.ts`, `delivery/*` | G |
| 49 | Banner management (upload, schedule, priority, preview) | REUSE + NEW-API | `lib/admin/banners-actions.ts`, `lib/media/*` | G |
| 50 | Staff/sales team & targets/commissions | REUSE + NEW-API | `lib/admin/team-actions.ts`, `targets-actions.ts`, `commissions-actions.ts` | G |
| 51 | Reports/analytics/command center | REUSE + NEW-API | `lib/admin/{dashboard,command-center,reports}` | G |
| 52 | Data-retention status + dry-run | REUSE + NEW-API, **read-only** | `lib/retention/cleanup.ts` (`CleanupRunReport`), `app/admin/cleanup` | G |
| 53 | Execute cleanup | **BLOCKED by design** | cron-only (`CRON_SECRET`), never Android | — |
| 54 | Super-admin control center (privileged accounts, AI memory) | REUSE + NEW-API (super-admin gate) | `lib/admin/control-center/*`, `requireSuperAdmin` | G |
| 55 | Coupons / schemes / pricing configuration | REUSE + NEW-API | `lib/admin/{coupons,schemes,pricing}-actions.ts` | G |
| 56 | Support tickets administration, audit logs | REUSE + NEW-API | `lib/admin/{support-actions,audit}` | G |
| 57 | CSV import/export | REUSE (server) + BLOCKED (device file pickers) | `lib/admin/{csv,product-csv}.ts` | G |

### 5.6 Platform / non-functional

| # | Feature | Class | Notes | Phase |
| --- | --- | --- | --- | --- |
| 58 | Native splash + launcher icon | NATIVE | reuse `resources/android-res/**` | B |
| 59 | Material 3 theme, dark mode, status/nav bars | NATIVE | brand colours must come from existing UI tokens, not invented | B |
| 60 | Native navigation + Android back | NATIVE | Navigation Compose | B |
| 61 | Loading / empty / offline / retry / error states | NATIVE | shared state components | B |
| 62 | Image loading + caching + failure | NATIVE | Coil over HTTPS; Supabase Storage public URLs | D |
| 63 | Read-only catalog cache | NATIVE (**only if required**) | Room only when evidence shows a need | D |
| 64 | Connectivity awareness | NATIVE | no blind replay of financial/inventory mutations | B/E |
| 65 | Accessibility (touch targets, labels, font scaling) | NATIVE | tested in Compose UI tests | B–H |
| 66 | Offline ordering | **BLOCKED by design** | checkout/stock/auth/payments require server verification | — |
| 67 | Payments (online gateway) | **CONFIG/BLOCKED** | none wired today (collections + COD); must never be faked client-side | E/G |
| 68 | Push notifications (FCM) | **CONFIG** | no FCM project/credentials today; `notification_logs` supports `push` channel but no provider is wired | F |
| 69 | Play Store release (signed AAB) | **CONFIG** | needs Play account + upload key, both outside the repo | H |

---

## 6. Why the mobile API is a thin layer over existing services (and not something else)

1. **Not Server Actions.** They are private RPC over POST with encapsulated action ids,
   bound to the Next.js runtime and cookie session; exposing them as a mobile contract
   would freeze internal React conventions as public API (explicitly forbidden).
2. **Not direct PostgREST from Android.** RLS would indeed authorize reads, but the money
   and stock rules (tier pricing, GST, MOQ, coupons, coin debits, warehouse resolution,
   idempotent order completion) live in TypeScript services and DB triggers *behind*
   those services. Re-implementing them in Kotlin would duplicate business rules and
   create two sources of truth (forbidden).
3. **Not a rewrite of the web.** Every new mobile route calls the same service the web
   calls; where a service is currently entangled with cookies/`redirect()` (e.g.
   `placeOrderAction` ends with `redirect()`), the **service** is used directly from the
   route and the web action keeps its redirect behaviour.
4. **Isolation.** The mobile client authenticates with a Supabase **access token** sent as
   `Authorization: Bearer …`; the server verifies it with Supabase Auth and then runs
   queries in the user's RLS context. No service-role client is ever reachable from the app.

---

## 7. Security risk register

| # | Risk | Sev | Mitigation (enforced in this migration) |
| --- | --- | --- | --- |
| R1 | Service-role key or DB password reaching the APK | Critical | Mobile routes are the only privileged callers; the app ships **no Supabase key at all** (all auth proxied through `/api/mobile/v1/auth/*`); `SUPABASE_SERVICE_ROLE_KEY` stays in server-only modules; regression test asserts no `NEXT_PUBLIC_`/service key reference in Android sources and no secret in `BuildConfig` |
| R2 | Access/refresh tokens stolen from device storage or logs | High | Keystore AES-GCM-encrypted store (no plaintext prefs), token redaction in logging interceptor, no tokens in URLs/analytics, `allowBackup=false` |
| R3 | "Make Android work" by weakening RLS | Critical | RLS untouched; bearer token flows through PostgREST so policies stay the enforcement boundary; contract tests assert the API never uses a service-role client for user-scoped reads/writes |
| R4 | Client-calculated totals/price trusted | Critical | Server re-quotes on every write (`quoteOrderForRetailer`); the API accepts only pack ids + quantities (+ notes/address/coupon id) |
| R5 | Duplicate orders from double tap / retry / process death | Critical | Mobile `POST /orders` requires an `Idempotency-Key` mapped to `orders.request_key`, reusing the existing replay/`complete_order_request` machinery |
| R6 | Overselling / negative stock under concurrency | Critical | Unchanged: DB trigger on `order_items` insert locks the pack, checks and decrements atomically; the app never mutates stock |
| R7 | Role escalation via client-side navigation | High | Role-aware navigation is **UX only**; every protected route re-resolves role/permission server-side (`requireMobileSession` + `can()`), unknown/absent role ⇒ 403 |
| R8 | Pending/suspended/deactivated accounts still using the API | High | Session resolution returns typed 403 codes (`retailer_pending_approval`, `account_suspended`, `account_inactive`, `access_expired`) mirroring `middleware.ts` |
| R9 | Access-period bypass | High | `user_access_periods` evaluated server-side per request; super_admin exemption preserved |
| R10 | Rate-limit / brute-force on login | Medium | Per-IP+identifier token bucket on auth routes + generic error copy (no enumeration); serverless limitation documented honestly in the contract |
| R11 | Payments marked successful from the client | Critical | No online payment today; when one is added it must be verified server-side via provider callback (`/api/webhooks` with constant-time secret) — the client can never assert success |
| R12 | Retention/cleanup executed from the app | Critical | Android exposes status + dry-run only; execution stays cron-only behind `CRON_SECRET`; no wallet-ledger or permanent catalog/image deletion in app scope |
| R13 | Cleartext traffic / disabled TLS verification | High | Production `networkSecurityConfig` cleartext-disabled, default certificate validation, no `TrustManager` overrides; debug builds use the same HTTPS-only policy plus an optional local-dev override documented in the plan |
| R14 | Exported components / deep links | Medium | Single exported launcher activity; no exported services/receivers; deep links limited to the app's own HTTPS host (Phase H review with `android:exported` audit) |
| R15 | PII/sensitive data in logs and crash reports | Medium | No request/response body logging outside debug; no order/address/phone in logs; `BuildConfig.DEBUG`-gated HTTP logging only |
| R16 | Shipping a stale/broken shell target | Medium | Root cause today: remote-URL shell + already-broken Vercel alias. Native app has a single configured API base URL; deployment protection must be verified before Phase C sign-off |
| R17 | Signing keys committed | Critical | Keystores never committed (`.gitignore`), release signing only through CI secrets when provided; no release claim without a signed artifact |
| R18 | Web regression while extracting services | High | Web tests (1 780) are the gate; mobile routes reuse services without modifying web actions' behaviour |
| R19 | Access-token reuse after logout | Medium | Logout revokes the refresh token server-side (`/auth/v1/logout`) and wipes the local store; access tokens are short-lived (Supabase JWT `exp`) |
| R20 | Warehouse misconfiguration leaking internals to customers | Low | `warehouseConfigCustomerMessage()` for customer-facing errors; operator copy only in admin/staff scope |

---

## 8. Blockers, configuration and honest limitations

**Environment (this working session).**

- No JDK (`java`, `javac`, `gradle`, `kotlinc` absent), no Android SDK
  (`ANDROID_HOME`/`ANDROID_SDK_ROOT` empty), and these hosts are network-blocked from
  the sandbox: `dl.google.com`, `repo1.maven.org`, `services.gradle.org`,
  `raw.githubusercontent.com`, `cdn.jsdelivr.net`, `cdn.statically.io`,
  `mvnrepository.com`, `search.maven.org` (all HTTP 000/`SSL_ERROR_SYSCALL`).
- Reachable: `registry.npmjs.org`, `pypi.org`, `github.com`, `api.github.com`
  (authenticated `gh` as `arena-ai-coding-agent[bot]`), `codeload.github.com`.
- **Consequence:** no Gradle compile can be executed here. Android build/test/lint
  evidence must come from GitHub Actions; this audit and the plan therefore treat CI as
  the verification environment and never claim a local Android build. The Gradle wrapper
  files are fetched from `gradle/gradle` at the pinned tag through the GitHub contents API
  (the distribution itself is downloaded by CI).

**Genuine external configuration required (not secrets-in-repo):**

1. `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
   `NEXT_PUBLIC_SITE_URL` on the deployment (already required by the web app).
2. Vercel Deployment Protection must allow the mobile API host (the existing wrapper doc
   already flags this class of problem).
3. Play Console account + upload key/keystore for a signed AAB (outside the repo); CI can
   build a signed release only when those secrets are configured.
4. Master data: exactly **one active warehouse**; banners, categories, brands, packs and
   GST/HSN rows must exist for the app to show anything (the app must display the
   server's configuration error, not a fabricated catalog).
5. Database migrations: none are added by this phase. Any future migration is a separate,
   reviewed change and is **never** applied to production automatically.

**Known limitations to state honestly to stakeholders:**

- Payments are collections/COD only; there is no online gateway to integrate. The app
  must not display "payment successful" for anything the server has not confirmed.
- Push notifications have no provider (no FCM project). Phase F delivers in-app
  notifications from `notifications`; push remains blocked until credentials exist.
- Maharani AI on mobile is deliberately deferred (streaming contract, confirmation
  signing) and marked BLOCKED pending a product decision.
- The Capacitor shell remains in the repository during the migration (test-coupled);
  it is no longer the delivery path once CI builds the native app.

---

## 9. Acceptance criteria for the migration (from the objective) mapped to evidence

| # | Criterion | Evidence that will settle it |
| --- | --- | --- |
| 1 | Installed app uses native Compose screens | APK from CI + `android/` source; no `WebView` in the module graph (`grep -R "android.webkit"` = 0 hits outside documented exceptions) |
| 2 | No WebView/remote-site rendering of primary UI | same grep + manifest review |
| 3 | Auth, refresh, logout, role access against the existing backend | unit tests (session manager, token refresh) + CI integration notes against the deployed API |
| 4 | All required roles/workflows accounted for | the classification table in §5 (every existing page area mapped, BLOCKED items explicit) |
| 5 | Catalog/pack stock from the backend | API responses in tests come from server services over the real DB schema (PGlite/mocked) — no fixture catalog in the app |
| 6 | Server-calculated totals; atomic, idempotent stock | existing web tests (`tests/checkout-atomic.test.ts`, `tests/order-request-replay.test.ts`, `tests/simplified-pack-stock-db.test.ts`) + new mobile API tests |
| 7 | Coins/payment/refund/cancellation invariants preserved | `tests/coins-*.test.ts`, `tests/wallet-ledger.test.ts` + mobile API tests |
| 8 | RLS/authorization intact | `tests/security-phase0-*.test.ts`, `tests/staff-scope-rls.test.ts` unchanged and green |
| 9 | Android tests + build pass in CI | Android CI job logs |
| 10 | Web tests/builds still pass | `pnpm test`, `pnpm typecheck`, `pnpm build` logs |
| 11 | Unverified live-service behaviour identified | §8 + per-phase reports |
| 12 | Reproducible debug APK; signed AAB only with signing | CI artifacts |
| 13 | Documentation complete | the three Phase A documents + per-phase reports |

---

## 10. Immediate conclusion & recommended first change

The only correct first step is **not** to touch the Next.js app's behaviour. It is:

1. Write the audit, contract and plan (this document set).
2. Introduce the **mobile API foundation** — shared server helpers (session resolution
   from a bearer token, error envelope, pagination, rate limiting) plus two endpoints
   (`GET /api/mobile/v1/health`, `GET /api/mobile/v1/session`) with tests that run in the
   existing vitest harness.
3. Introduce the **native Android foundation** — Gradle/version-catalog project with
   `app`, `core/*` and the first shared modules, native splash/launcher/branding, the
   Material 3 design system, session storage (Keystore) and the role-aware navigation
   shell, all with unit tests.
4. Add the **Android CI job** that runs unit tests, lint and builds the debug APK, while
   keeping the web test suite green.

That is exactly Phase A + Phase B of the plan, and exactly what this change contains.

---

## 11. Phase B progress log (state of this branch, for review)

| Area | Status at the end of this change |
| --- | --- |
| Audit / API contract / plan documents | **done** (this file, `NATIVE_ANDROID_API_CONTRACT.md`, `NATIVE_ANDROID_MIGRATION_PLAN.md`) |
| Mobile API foundation (helpers + `health` + `session`) | **done and tested** — 41/41 in `tests/mobile-api-foundation.test.ts` |
| Native Android project skeleton (wrapper, catalog, 7 modules, brand resources) | **done** — committed under `android/` (`.gitignore` updated deliberately, per §3.2) |
| Network layer (Retrofit/OkHttp/Kotlin Serialization, typed errors, bearer interceptor) | **done** — unit tested (MockWebServer, no real network) |
| Session storage (Keystore AES-256-GCM) + session restore/verify | **done** — restore/verify tested; the Keystore device path is not yet device-verified |
| Design system (Material 3 theme from the existing palette, shared state surfaces) | **done** |
| Non-sensitive preferences (DataStore) | **done** |
| Role-aware navigation shell + honest "planned phase" surfaces | **done** — routing logic unit tested |
| Sign-in / token refresh | **not started** (Phase C). The shell states this to the user instead of showing a dead form |
| Feature screens (catalog, cart, checkout, orders, coins, notifications, staff/admin) | **not started** (Phases C–G), each rendering an explicit phase-labelled placeholder |
| Android compile/test/lint evidence | **pending the first CI run** — no JDK/SDK in the working environment (see §8) |
| Device verification | **not done** — no emulator/device available |
