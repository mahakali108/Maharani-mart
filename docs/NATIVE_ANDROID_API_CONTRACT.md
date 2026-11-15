# Native Android — Mobile API Contract (`/api/mobile/v1`)

**Phase A deliverable 2 of 3.** Companion documents:
`docs/NATIVE_ANDROID_MIGRATION_AUDIT.md` (audit/classification) and
`docs/NATIVE_ANDROID_MIGRATION_PLAN.md` (phases, modules, acceptance tests).

> **Status legend.**
> **IMPLEMENTED** — code + tests exist on this branch and run in `vitest`.
> **PLANNED (phase X)** — contract agreed here, implemented in that phase.
> Nothing in this document may be presented to a user as working before it is
> IMPLEMENTED and covered by a test in this repository.

---

## 1. Principles

1. **The server is authoritative** for prices, discounts, GST, totals, stock,
   permissions, approval status and order state. The client sends *intent*
   (pack ids, quantities, notes, address id, idempotency key) and renders what the
   server returns.
2. **No Server Action is exposed as a mobile API.** Routes call the same server-only
   services the web calls (`lib/orders/*`, `lib/retailer/*`, `lib/warehouse/*`, …).
3. **All traffic is HTTPS + JSON.** No form posts, no cookies required, no HTML.
4. **Identity is derived from the verified access token**, never from a request body or
   query parameter (`role`, `user_id`, `retailer_id`, `approved`, `price` sent by a client
   are ignored or rejected).
5. **RLS stays the enforcement boundary.** User-scoped queries run with the caller's
   bearer token (`Authorization` header passed to PostgREST), so Supabase RLS applies
   exactly as it does for the web. Service-role clients are used only where the existing
   server code already does so deliberately (e.g. `complete_order_request`,
   phone→email resolution) and never for user-scoped reads.
6. **The Android app ships no Supabase key and no secret.** All auth (including token
   refresh) is proxied by `/api/mobile/v1/auth/*`, so the mobile binary contains only a
   base URL. This is a deliberate security-positive deviation from "anon key in the
   client": it keeps revocation, suspension checks and audit logging server-side.
7. **Money is transported as integer paise** (`*_paise`), never floats, and never as a
   client-computed total. Where an existing service returns rupees with 2 decimals, the
   route converts at the boundary (`Math.round(rupees * 100)`).
8. **Idempotency is server-side and persistent** (database-backed), not an in-memory
   cache, so it survives retries, process restarts and deploys.

### 1.1 Base path and versioning

- Base: `https://<api-host>/api/mobile/v1`
- Breaking changes require `/api/mobile/v2`. Additive fields are allowed within `v1`.
- `GET /api/health` (existing, public) remains the operational probe for the web/Vercel;
  the mobile-specific probe below returns a mobile-shaped body and never leaks driver
  errors.

### 1.2 Request conventions

| Concern | Rule |
| --- | --- |
| Auth header | `Authorization: Bearer <supabase-access-token>` (JWT). Missing/invalid/expired produce distinct codes. |
| Content type | `application/json; charset=utf-8`; body must be an object; malformed JSON → `400 invalid_json`. |
| Body size | Rejected above **32 KiB** (`413 payload_too_large`) before parsing. |
| Client metadata | Optional `X-App-Version`, `X-Platform: android` headers — logged for triage only, never used for authorization. |
| Idempotency | Mutating money/stock operations require `Idempotency-Key: <uuid v4>`. Reuse of a key with a *different* payload → `409 idempotency_conflict`. |
| Request id | Server returns `X-Request-Id` on every response; the same id appears in server logs. |
| Timestamps | ISO-8601 UTC (`2026-10-01T09:15:00.000Z`). Display-time conversion to IST happens on the device (`lib/datetime/india.ts` semantics are the reference). |
| Locale/currency | `₹` formatting is a client concern; state (`INR`) is implied. |

### 1.3 Response conventions

Success (single object):

```json
{ "data": { "…": "…" }, "requestId": "0f1c…" }
```

Success (collection — every list endpoint):

```json
{
  "data": [ { "id": "…" } ],
  "page": { "nextCursor": "eyJvIjo0OH0", "hasMore": true, "limit": 24 },
  "requestId": "0f1c…"
}
```

Error (always this shape, always sanitized):

```json
{
  "error": { "code": "insufficient_stock", "message": "Only 4 available", "details": { "packId": "…", "available": 4 } },
  "requestId": "0f1c…"
}
```

- `message` is safe to display to the end user; it never contains SQL, stack traces,
  hostnames, keys or Supabase/internal identifiers. Real causes are logged server-side
  with the request id.
- `details` is optional, typed, and never contains another user's data.

### 1.4 Error codes

| HTTP | `code` | Meaning / client behaviour |
| --- | --- | --- |
| 400 | `invalid_json` | body not JSON → do not retry |
| 400 | `validation_failed` | `details.fields` maps field → message → show inline |
| 400 | `invalid_request` | missing/!malformed parameters |
| 401 | `missing_token` | no Authorization header → go to sign-in |
| 401 | `invalid_token` | JWT rejected by Supabase → clear session, sign-in |
| 401 | `expired_token` | JWT `exp` passed → refresh once, then sign-in |
| 403 | `forbidden` | authenticated but not permitted (role/ownership) |
| 403 | `account_inactive` | `profiles.is_active = false` → sign-in screen with reason |
| 403 | `account_suspended` | retailer `status = suspended` → sign-in with reason |
| 403 | `retailer_pending_approval` | retailer awaiting approval → pending-approval screen |
| 403 | `access_expired` | `user_access_periods` lapsed → access-expired screen |
| 404 | `not_found` | resource absent **or not visible to this caller** (never leak existence) |
| 409 | `idempotency_conflict` | key reused with different payload |
| 409 | `conflict` | state changed (e.g. order already cancelled) |
| 413 | `payload_too_large` | reject locally |
| 422 | `insufficient_stock` | `details.available` → show "Only X available" |
| 422 | `warehouse_configuration_error` | customer-safe copy (`warehouseConfigCustomerMessage`) |
| 422 | `coupon_invalid` | remove/replace coupon, retry |
| 422 | `minimum_order_quantity` | `details.minQuantity` |
| 429 | `rate_limited` | honour `Retry-After`; back off exponentially |
| 500 | `internal_error` | show retry; report request id |
| 503 | `database_unavailable` | retryable; offline/retry UI |

### 1.5 Pagination

- **Keyset/cursor** for every list (no offset/limit arithmetic), mirroring the web's
  infinite-scroll implementation (`lib/infinite-scroll/{cursor,keyset}.ts`):
  - request: `?limit=24&cursor=<opaque>`; `limit` clamped to `1…CATALOG_PAGE_SIZE`
    (`24`) and hard-capped by `CATALOG_MAX_ROWS` (`240`) per scroll session.
  - response: `page.nextCursor` (opaque, base64url, stable ordering key + id tiebreak),
    `page.hasMore`. Clients must not decode it; a non-advancing cursor means "stop"
    (same guard as the web).
- Admin/staff lists that are inherently bounded use the same envelope with a `limit`
  clamp of 50.

### 1.6 Rate limits (best-effort, documented honestly)

| Group | Limit | Scope |
| --- | --- | --- |
| `auth.login` | 10 / 5 min | per IP **and** per normalized identifier |
| `auth.refresh` | 60 / hour | per user |
| `auth.password_reset` | 5 / hour | per IP + identifier |
| `read.*` (catalog/orders/notifications) | 120 / min | per user |
| `write.cart` | 60 / min | per user |
| `write.orders` | 20 / 5 min | per user |
| `write.admin` | 120 / min | per admin user |

Implementation is an in-process token bucket (`lib/mobile/rate-limit.ts`). On Vercel's
serverless runtime this is **per instance, not global** — stated plainly here so nobody
assumes a hard global guarantee. A distributed limiter (Upstash/Postgres) is a follow-up
item, not a claim.

### 1.7 Authentication protocol (sessions)

```
POST /api/mobile/v1/auth/login      → { session, user, roles, nextStep }
POST /api/mobile/v1/auth/refresh    → rotated { session }      (server calls Supabase)
POST /api/mobile/v1/auth/logout     → revokes the refresh token server-side
```

- `session` = `{ accessToken, refreshToken, expiresAt, tokenType: "bearer" }`.
- The **client stores tokens only in Android Keystore-backed AES-GCM storage**
  (never plaintext preferences, never logs, never analytics).
- `expiresAt` is the JWT expiry; the client refreshes proactively (2-minute skew) and
  reactively on a single 401 `expired_token`, then retries the original request once.
- Refresh-token rotation (Supabase rotates on every refresh) is handled server-side: the
  client always stores the newest pair the server returns.
- Logout clears local storage even if the revoke call fails, and the app must never reuse
  a token after logout.
- Password reset uses the supported existing flow (`requestResetAction` semantics +
  Supabase recovery); the reset link opens the existing web reset page until Phase C
  decides whether a native deep-link hand-off is needed (decision recorded in the plan).

### 1.8 Identity resolution on the server (`requireMobileSession`)

Order of operations for every authenticated route (**IMPLEMENTED** in
`lib/mobile/auth.ts`):

1. Parse `Authorization: Bearer <token>`; missing → `401 missing_token`.
2. `supabase.auth.getUser(token)` (GoTrue verification) → invalid → `401 invalid_token`;
   expired → `401 expired_token`. **Never** trust a client-decoded JWT.
3. Load `profiles(id, role, is_active, phone, full_name)` for that user id.
   Absent profile or `is_active = false` → `403 account_inactive`.
4. Retailer-only gate: load `retailers(id, status, shop_name)`; `pending_approval`
   → `403 retailer_pending_approval`; `suspended` → `403 account_suspended`.
   Ordering of these two is deliberate: suspension outranks pending state.
5. Access period: for roles other than `super_admin`, the newest
   `user_access_periods` row with status `active|expiring_soon|unlimited` must be
   unlimited or have `expires_at` in the future; otherwise `403 access_expired`.
   No row = allowed (mirrors `middleware.ts` backward compatibility).
6. Route-level authorization: `can(role, permission)` / ownership checks
   (`orders.view.own` + `retailer_id = session.userId`). Role mismatch → `403 forbidden`.

Returned session object (server-internal, never serialized raw):

```ts
{ userId, email, role, isActive, retailer: { status, shopName } | null,
  access: { status, expiresAt } | null, accessToken, supabase }
```

---

## 2. Endpoint inventory

### 2.1 IMPLEMENTED on this branch (Phase B)

| Method | Path | Auth | Returns |
| --- | --- | --- | --- |
| `GET` | `/api/mobile/v1/health` | none | `{ status, database, serverTime, apiVersion }`; 503 `database_unavailable` when the DB probe fails; never echoes driver errors |
| `GET` | `/api/mobile/v1/session` | bearer | `{ user, retailer, access, navigation }` — the role-aware bootstrap the app uses after sign-in/restore |

`GET /api/mobile/v1/session` response:

```json
{
  "data": {
    "user": {
      "id": "uuid",
      "email": "…",
      "role": "retailer",
      "fullName": "…",
      "phone": "98…",
      "isActive": true
    },
    "retailer": { "status": "active", "shopName": "…" },
    "access": { "status": "active", "expiresAt": "2026-10-08T00:00:00.000Z" },
    "navigation": {
      "homeRoute": "/retailer/home",
      "workspaces": ["retailer"],
      "permissions": ["orders.create", "orders.view.own", "products.view", "…"]
    }
  },
  "requestId": "0f1c2d3e"
}
```

- `retailer.status` is the **database enum value verbatim** (`active` |
  `pending_approval` | `suspended`, `types/database.types.ts`), never a prettified label:
  display copy belongs to the client, and a client must not have to invert a label to learn
  the state. `retailer` is `null` for non-retailer roles; `access` is `null` for
  `super_admin` and when no access-period row exists (the rule matches `middleware.ts`).
- `homeRoute` comes from `ROLE_HOME` (`lib/auth/roles.ts`); `workspaces` from
  `ROLE_ROUTE_PREFIXES`; `permissions` from `permissionsForRole()` in
  `lib/permissions/permissions.ts` — **the Android app must not hardcode a copy of the
  role matrix**; it renders what the server sends and treats it as UX only.
- The endpoint returns data for the caller only; there is no `?userId=` parameter. Query
  parameters on the URL are ignored, so a crafted `?role=super_admin` changes nothing
  (asserted by a test).
- **Fail-closed ordering** (each step asserted by a test): unverified token →
  `401 missing_token` / `invalid_token` / `expired_token`; no profile row or
  `is_active = false` → `403 account_inactive`; a role value the API does not recognise →
  `403 forbidden` (it must never flow into `ROLE_HOME`/permission lookups); retailer
  `suspended` → `403 account_suspended`; any other non-active retailer status →
  `403 retailer_pending_approval`; lapsed access period → `403 access_expired`.
- The app treats a payload it cannot route (unknown role, blank `homeRoute`) as
  "unsupported account" on the client side as well — two independent fail-closed checks.

### 2.2 IMPLEMENTED — Phase C (authentication & registration)

> All six routes below exist under `app/api/mobile/v1/` and are covered by
> `tests/mobile-auth.test.ts`. The heading previously said PLANNED; the
> endpoints shipped and the label was never updated.

| Method | Path | Auth | Request | Response | Notes |
| --- | --- | --- | --- | --- | --- |
| POST | `/auth/login` | none | `{ identifier, password }` (identifier = 10-digit phone **or** email) | `{ session, user, nextStep }` | Server normalizes the phone (`normalizePhone`), resolves profile → auth email (service role, no enumeration), calls `signInWithPassword`. Generic `401 invalid_credentials` for unknown phone / missing email / wrong password; distinct `403 email_not_confirmed` only when the account resolves and is unconfirmed (required for recovery UX). `nextStep ∈ {app, pending_approval, access_expired}`. Rate limit `auth.login`. |
| POST | `/auth/refresh` | refresh token in body **or** bearer | `{ refreshToken }` | `{ session }` | Server calls Supabase `refreshSession`; on failure → `401 invalid_token` (client signs out). |
| POST | `/auth/logout` | bearer | `{}` | `{ ok: true }` | Revokes the refresh token server-side; local wipe is unconditional on the client. |
| POST | `/auth/password-reset` | none | `{ email }` | `{ ok: true }` | Always the same response (no account enumeration). |
| POST | `/auth/password-update` | bearer | `{ password, confirmPassword }` | `{ ok: true }` | ≥ 8 chars; mirrors `updatePasswordAction` validation. |
| POST | `/retailers/register` | none | registration payload (shop name, owner, phone, address, GSTIN?) | `{ ok: true }` | Mirrors `app/register-retailer` validation (`lib/auth/actions.ts`, migration `0012` phone-conflict handling). Duplicate phone → `409 conflict` with a safe message. New account lands in `pending_approval`. |

**Ownership/role:** none of these accept a role, retailer id or approval flag. The
account's role comes from the database trigger (`handle_new_user`).

### 2.3 IMPLEMENTED — Phase D (catalog, search, product detail)

All six routes live under `app/api/mobile/v1/` and are covered by
`tests/mobile-catalog-api.test.ts` and `tests/mobile-catalog-search.test.ts`.
Every one of them runs the same gate as the
rest of the API: `newRequestId()` → `enforceRateLimit` → `requireMobileSession`
→ `requireMobileRole(session, ['retailer'])`, rate group `read.catalog`
(120/60s), `503 database_unavailable` when Supabase is unreachable and
`500 internal_error` through `logServerError`.

| Method | Path | Auth/role | Reuse |
| --- | --- | --- | --- |
| GET | `/catalog/products?q&categoryId&brandId&sort&minPrice&maxPrice&discount&maxMoq&inStock&new&offers&fav&cursor` | retailer | `loadCatalogBatch` (`lib/retailer/catalog-batches.ts`) → `lib/retailer/catalog.ts` pricing, `catalog-params.ts` (`CATALOG_SORTS`, `sanitizeSearchTerm`, `CATALOG_PAGE_SIZE = 24`, result cap 240) |
| GET | `/catalog/products/{id}` | retailer | product **or** pack id. `loadProductsByIds` + `priceCatalogPack` + `loadPackTiers` + gallery (`product_pack_images`, `product_packs.image_url`, `product_images`). A pack id marks that pack `selected: true`. |
| GET | `/catalog/categories` | retailer | `loadMobileTaxonomy` → `loadTaxonomyScope` (`lib/mobile/catalog-service.ts`); active rows by `sort_order`, plain columns, caller's RLS token |
| GET | `/catalog/brands` | retailer | the same read; active rows by `name` |
| GET | `/catalog/search?q=` | retailer | `loadCatalogSuggestions` (`lib/mobile/search-service.ts`) - the same four reads the storefront's own suggestion loader (`lib/retailer/search-actions.ts`) runs, under the caller's RLS token |
| GET | `/home` | retailer | `loadRetailerHome` — banners (`isBannerVisible` + `resolveBannerTarget`), categories, brands, and a discovery rail that is **the first batch of the real catalogue** (not a separately curated list), and the admin's live `schemes` rows (`toMobileHomeSchemes`) with `schemesUnavailable` |

**Query semantics.** `inStock`, `new`, `offers` and `fav` are explicit `=1`
flags and default off. `minPrice`/`maxPrice` are rupees; a negative value,
`minPrice > maxPrice`, a non-UUID `categoryId`/`brandId`, or an undecodable
`cursor` is `400 invalid_request` with the offending field named. An unknown
`sort` falls back to `recommended` instead of erroring, so an older app asking
for a sort a newer server dropped still gets a catalogue.

**Search contract (`/catalog/search?q=`).** The answer is
`{ query, searched, products[], brands[], categories[] }`, where `query` is the
**sanitized** term the server actually matched (`sanitizeSearchTerm`: it replaces
`% _ * , . ( ) " ' \` with spaces, collapses whitespace and caps the length at
80) and `searched` is `false` when the term was below `MOBILE_SEARCH_MIN_TERM`
(2 sanitized characters) - in which case all three arrays are empty and nothing
was read. `products[]` is `{ id, name, brandName, packName, imageUrl, matchKind }`
with `matchKind` one of `name` / `barcode` / `pack`, so a hit on a PACK barcode
says so and folds onto its parent product instead of listing a pack as though it
were one; limits are 6 products, 4 brands and 4 categories.

**The search route returns no price, no stock and no MOQ - ever.** That is a
contract, not an omission, and `tests/mobile-catalog-search.test.ts` asserts it:
a suggestion is a shortcut to the priced row, and a type-ahead that carried a
number would be a second copy of it that checkout could contradict. Anything
orderable is read from `/catalog/products` or `/catalog/products/{id}`.

A term of 2+ sanitized characters that matches nothing is `200` with
`searched: true` and three empty arrays - which the app must render as "no
match", distinctly from a `503 database_unavailable`, which it must render as a
failure with a Retry and never as an empty result.

**Home schemes (`/home`).** `schemes[]` is
`{ id, name, description, isFestival, startsAt, endsAt }`: the active rows inside
their own window, ordered by `ends_at` and capped at `MOBILE_HOME_SCHEME_LIMIT`
(6) - the same rows `GET /schemes` answers, so the home rail and the offers
screen cannot disagree. A scheme carries **no discount value**: in this backend a
scheme is a published campaign window whose pricing effect is already inside the
per-retailer rate the catalogue resolves, so a client that printed a percentage
here would be inventing one. `schemesUnavailable: true` means the schemes read
FAILED while the rest of `/home` succeeded; the two must stay apart, because an
empty list means "no offer is live" and a failed read must never be allowed to
say that.

**Taxonomy contract (`/catalog/categories`, `/catalog/brands`).**
`categories` is `{ id, name, imageUrl, parentName, productCount }` and `brands` is
`{ id, name, logoUrl, productCount }`. `productCount` is the number of ACTIVE
products the shop publishes for that category or brand, counted on the server
from real product rows; it is `null` when the count could not be completed, and
never a partial sum or a placeholder zero. An empty array means **the shop
publishes none** — a read that fails is `503 database_unavailable`, never
`200` with an empty body, so the app can tell "nothing here" apart from "this
did not load" and its Retry can actually change something. Counts are advisory
metadata: they never gate a filter, and the product list remains the authority
on what is orderable.

**There is no `limit` parameter.** The batch size is the server's
`CATALOG_PAGE_SIZE` (24) and keyset cursors are aligned to it; a client asking
for a different size would silently break the cursor. `page.limit` in the
response is the server reporting what it used.

The type-ahead endpoint the original Phase D list called
`/catalog/search/suggestions` **is now shipped**, as `GET /catalog/search` above.

**Still PLANNED from the original Phase D list** (deliberately not shipped):

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/catalog/products/by-ids` | Not implemented. Phase E cart and order APIs resolve their own current product/pack snapshots; this batch endpoint would be needed for a future reorder flow. |
| PUT/DELETE | `/favorites/{productId}` | `isFavorite` is **read** (`loadFavoriteIds`) and rendered, but cannot be written yet. |
| — | `/home` extras | Cart and recent orders keep their own dedicated endpoints rather than being folded into `/home`. `/home` returns `{ banners, categories, brands, products, nextCursor, schemes, schemesUnavailable }`; Coins home/history stay on `/wallet`. |

Contract details that matter:

- **Prices** are always server-computed for the requesting retailer
  (overrides / case-loose tiers / MOQ / offers) and returned **in integer
  paise** as
  `{ packId, packName, unitsPerCase, moq, unitPricePaise, mrpPaise, derivedCasePricePaise, tiers[], availability }`.
  There is no `effectiveCasePricePaise` field — the earlier draft name was never
  implemented. Every money field is nullable: an unpriced pack returns `null`,
  never `0`.
- `tiers[]` entries are `{ minQuantity, maxQuantity, pricePerPiecePaise }` with
  the bounds **in pieces**. It is the slab table the pricing engine actually
  used. A pack with no configured loose slabs returns an **empty** array and is
  priced from its case price — the app must not invent a slab.
- **`pack: null` on a catalogue card means the product has no active pack.** It
  is listed so the catalogue stays complete, but carries no price, no MOQ and no
  availability, and the app must not offer to order it.
- **Availability** is the two-state customer vocabulary (`in_stock` /
  `out_of_stock`) from `get_retailer_pack_availability`; exact stock counts are
  never exposed here. `unknown` is the DTO's third value for the case where
  availability could not be resolved, and is rendered as a neutral state rather
  than as "in stock".
- **Banners** come from the `banners` table with existing scheduling
  (`isBannerVisible`: starts_at/ends_at + area targeting) and `sort_order`/priority;
  multiple eligible banners are returned in order; an empty array means the client shows
  the existing fallback. No banner id is ever hardcoded in the app. A banner
  `linkUrl` that fails the server's safety check is returned as `null` rather
  than passed through.
- A product that is invisible to the caller, or an id that matches neither a
  product nor a pack, is `404 not_found` — the detail route does not leak
  existence across the RLS boundary.
- Packs without an active row are never returned; `MOQ` violations are rejected by the
  quote/order stages, not silently adjusted.
- Envelopes: the collection route uses `jsonOkPage`
  (`{ data: [...], page: { nextCursor, hasMore, limit }, meta: { resultCount, resultCapped }, requestId }`);
  detail, taxonomy and home use plain `jsonOk`.

**Client-side lock.** `android/core/network/.../dto/CatalogDtos.kt` mirrors these
shapes field for field, and `tests/mobile-catalog-api.test.ts` parses that Kotlin
source and asserts both directions of field agreement. A renamed server field is
therefore a failing web test, not a silently empty product card.

### 2.4 Phase E — Cart, checkout and order management (server API and native screens implemented; Android build/unit tests run in CI)

| Method | Path | Auth/role | Request | Implemented contract |
| --- | --- | --- | --- | --- |
| GET | `/cart` | active retailer, `orders.create` + `orders.view.own` | — | The caller's shared persisted cart, freshly priced by the server. No exact stock count or client-supplied money is returned. |
| POST | `/cart/lines` | active retailer, `orders.create` + `orders.view.own` | `{ packId, quantity }` | Adds a whole-piece quantity through the MOQ/active-pack/cart RPC; the server owns price and availability. |
| PATCH | `/cart/lines/{lineId}` | active retailer, `orders.create` + `orders.view.own` | `{ quantity }` | Sets the final whole-piece quantity; caller ownership, MOQ and compare-and-set are checked server-side. |
| DELETE | `/cart/lines/{lineId}` | active retailer, `orders.create` + `orders.view.own` | — | Removes only the caller's owned line. |
| POST/DELETE | `/cart/coupon` | active retailer, `orders.create` + `orders.view.own` | POST `{ code }`; DELETE has no body | Applies/removes the caller's active coupon pointer. The discount is revalidated from server coupon terms and cart lines at quote and again inside atomic order creation. |
| GET | `/addresses` | active retailer, `orders.create` + `orders.view.own` | — | Saved addresses plus the registered profile/shop address; checkout sends only a saved `addressId` or null. |
| POST | `/checkout/quote` | active retailer, `orders.create` + `orders.view.own` | `{ lines: [{ packId, quantity }], addressId? }` | Read-only quote over the exact persisted shared cart. Pricing, GST, coupon and Coins are server-computed; an applied coupon is read from the retailer's server-owned active-coupon row (not the body). Availability is status-only. |
| POST | `/orders` | active retailer, `orders.create` + `orders.view.own` + `Idempotency-Key` | `{ lines, notes?, addressId? }` | Requires the submitted pack/quantity lines to match the saved cart. A server-only PostgreSQL transaction rechecks current price/GST/MOQ/coupon/Coins/stock/eligibility, writes order and items, debits Coins, snapshots the post-debit wallet balance, completes the idempotency key and clears the exact cart atomically. A duplicate key returns the original order; no payment is collected. |
| GET | `/orders?cursor=` | retailer, `orders.view.own` | — | Paged actual order history, filtered to the authenticated retailer; status, timestamps, server totals and persisted item snapshots are returned. |
| GET | `/orders/{id}` | retailer, `orders.view.own` | — | One actual owner-scoped order with status, timestamps, totals and item snapshots, plus the order's status history and — when the wallet-ledger read succeeds — this order's Coins movement. A failed ledger read is logged against the request id and the order is still returned; the list payload is unchanged. |
| GET | `/orders/{id}/invoice` | retailer, `orders.view.own` | — | The order's GST invoice in integer paise, folded by the web invoice's own helpers (`toInvoiceDisplayLines`, `classifyTaxSplit`, `computeInvoiceTaxLines`); no tax arithmetic exists in the client. `taxMode` is `intra` ⇒ CGST + SGST, `inter` ⇒ IGST, otherwise `unsplit` and the client prints the STORED `gst_total`. Ownership is checked before any child row is read; a malformed or foreign id is a 404. |
| GET | `/orders/{id}/delivery` | retailer, `orders.view.own` | — | The delivery dossier from `fetchDeliveryDetail` (timeline, assignee, receiver, OTP-verified fact, ordered/delivered/short quantities, return window) plus proof object paths resolved to short-lived signed URLs with the caller's own RLS client. `returnWindowOpen` is the server's inclusive-deadline decision, so the client never compares dates. Read-only: retailers cannot write delivery rows. |
| POST | `/addresses` · `PATCH`/`DELETE` `/addresses/{addressId}` · `POST` `/addresses/{addressId}/default` | retailer, `orders.create` + `orders.view.own` | `addressPayloadSchema` (the web form's own zod schema); default route has no body | Owner-scoped address CRUD. Every write validates with the same schema the web form uses and answers with the refreshed list, so the client never guesses how the default-exclusivity rule reordered it. |
| GET | `/orders/requests/{requestKey}` | retailer, `orders.view.own` | — | Recovers a committed order after an uncertain POST. `coinsUsedPaise` is read from that order's wallet-ledger movement; `balanceAfterCoinsPaise` is the stored wallet balance immediately after the atomic debit (null for historical rows with no snapshot), **not** the amount left on the order. A miss is 404, an unfinished request is 409, and an unverifiable ledger read fails closed with 503. |

**Address and serviceability boundary.** Quote and order submission resolve the selected saved `addressId` against the authenticated retailer's own address rows, or resolve `null` to that retailer's current non-empty profile/shop address; the server freezes the resolved snapshot on the order. The current backend has no separate PIN-code/zone serviceability rule or API, so this slice does not claim geographic coverage or infer it from the retailer's pricing area. Any future coverage decision must be added as an authoritative server contract.

**Quantity semantics.** The shared retailer cart and quote model stores integer piece counts. Its increment is one piece, while MOQ is a separate piece-count minimum enforced by the server at cart mutation, quote and atomic order commit. `units_per_case` and the catalog `allow_loose_pieces` flag do not change this current retailer piece-cart increment; clients must not derive a case-size step from those catalog fields. The API accepts only the requested final quantity and revalidates it server-side.

**Money semantics.** All mobile money is integer paise. On a quote, `coinsBalancePaise` is the wallet/Coins balance before use, `coinsUsedPaise` is the server-authorized amount applied to this order, and `balanceAfterCoinsPaise` is the remaining wallet/Coins balance (`max(balance - used, 0)`). It is never `grandTotalPaise - coinsUsedPaise`; that difference is an amount remaining on the order, not a wallet balance. Order confirmation and recovery use a database snapshot captured after the actual debit. The server does not accept client totals, discount, stock, Coins, warehouse ids, or a payment method.

**Commit-time coupon validation.** The database transaction locks the active-coupon pointer and coupon row, verifies current code/status/window/retailer/minimum order value, resolves current product/category/brand scope from the order lines, and recomputes the eligible GST-exclusive subtotal and exact discount using current terms before writing. `redeem_coupon` then rechecks global/per-retailer limits and first-order eligibility under its lock. If a quote became stale, the transaction fails without order, stock, wallet, redemption or cart-clear effects.

**Not implemented in this Phase E native/API slice:** saved-cart endpoints, a whole-cart DELETE endpoint, and order cancellation/returns. Reorder has no endpoint of its own by design — the client replays an order's stored piece counts through `POST /cart/lines`, so the cart RPC revalidates MOQ, quantity bounds and pack activity and the server re-prices every line. Invoices and delivery tracking are implemented (above) by reusing the web queries and helpers rather than re-deriving tax or dates in Kotlin. The current native surface is cart, coupon application, address CRUD, server quote, idempotent placement/recovery, real order history/detail, invoice, delivery tracking and reorder.

**Explicit invariants:** historical customer credit/payable amount is not a payment method, no online/COD payment flow is exposed, no FEFO/warehouse reservation is reintroduced, no client-side stock mutation is allowed, and an offline/uncertain request is never queued for automatic replay with a new key.

### 2.4.1 IMPLEMENTED — published information pages (website content, migration 0104)

The Android app shows About Us, Contact Us and every policy from the **same
managed content the website serves**. There is no policy text in the app and no
page list in the Kotlin code, so a Super Admin publish is visible on both
surfaces without an app release.

| Method | Path | Auth/role | Server source |
| --- | --- | --- | --- |
| GET | `/api/mobile/v1/pages` | public (anonymous) | `public.published_pages()` via `createMobileAnonClient` |
| GET | `/api/mobile/v1/pages/{slug}` | public (anonymous) | `public.published_page(p_slug)` via `createMobileAnonClient` |

`GET /pages` → `{ data: { pages: [{ slug, kind, audience, navLabel, shortLabel, title, summary, version, effectiveDate }] }, requestId }`.

`GET /pages/{slug}` → `{ data: { slug, kind, audience, navLabel, title, eyebrow, intro,
version, effectiveDate, publishedAt, showContactDetails, relatedSlugs, sections: [{ heading,
paragraphs, bullets, tone, imageUrl, linkLabel, linkHref }] }, requestId }`.

Rules the app relies on (enforced server-side, tested in `tests/mobile-pages-api.test.ts`
and `tests/site-content-db.test.ts`):

- **PUBLISHED content only.** A draft page returns `404 not_found` with
  `details.reason = "unpublished"`; the app shows the same clean "This page is not
  available right now." state as the website. It learns nothing about the draft.
- An unknown slug returns `404 not_found` and a malformed slug is refused before
  any database call. A read failure returns `503 database_unavailable`, never an
  empty-but-successful page.
- Internal operator notices, admin notes, owner review decisions and publishing
  history are **never serialised** — they live in tables the anonymous role cannot
  read.
- Paragraph text may contain `[label](/path)`; the app renders the label as text
  and opens the path in the in-app page viewer. No HTML is sent.

### 2.5 PLANNED — Phase F (coins, notifications, banners, account)

| Method | Path | Auth/role | Reuse |
| --- | --- | --- | --- |
| GET | `/coins/balance` | retailer | `getRetailerCoinPosition` (`balance_paise`, earning rules) |
| GET | `/coins/transactions?cursor&limit` | retailer | coin ledger batches (25/page, same ordering as web) |
| GET | `/notifications?cursor&limit`, `POST /notifications/{id}/read`, `POST /notifications/read-all` | any role | `lib/notifications/notify.ts`, `notification-actions.ts` |
| GET | `/banners` | retailer | `banners` + scheduling/area targeting; `[]` ⇒ client fallback |
| GET | `/wallet/summary`, `/wallet/ledger?cursor&limit` | retailer | `getRetailerWalletSummary`, `getRetailerLedgerBatch` (batch 25, `cancelled` excluded, payment-gap notice preserved) |
| GET/PATCH | `/profile`, `/profile/notification-preferences` | any role | `lib/retailer/profile-actions.ts` |
| GET/POST | `/support/tickets`, `/support/tickets/{id}/messages` | retailer | `lib/retailer/support*.ts` |
| GET | `/reports/summary`, `/schemes` | retailer | `lib/retailer/{reports,schemes}` |

**Wallet/coins rules:** balances are read-only on the client; only server-side,
permission-gated admin endpoints (`coins.manage`) may adjust a balance, and every
movement keeps its ledger row. Refunds/reversals keep their idempotency keys
(`coinDebitKey(orderId)`, `order_shortfall_coins`).

### 2.6 PLANNED — Phase G (sales, warehouse, admin, super admin)

| Area | Endpoints (all permission-gated, ownership-scoped) | Reuse |
| --- | --- | --- |
| Sales | `GET /sales/retailers`, `GET /sales/retailers/{id}`, `POST /sales/visits`, `GET/POST /sales/follow-ups`, `GET /sales/routes`, `GET/POST /sales/attendance`, `GET /sales/targets`, `GET /sales/commissions`, `GET/POST /sales/collections`, `GET /sales/dcr`, `POST /sales/orders` | `lib/salesman/*`, `lib/delivery/settlement.ts` |
| Warehouse/staff | `GET /warehouse/queue`, `POST /warehouse/orders/{id}/pick`, `/pack`, `/dispatch`, `GET /warehouse/stock`, `POST /warehouse/stock/adjust`, delivery execution + OTP + proof | `lib/staff/{pick-pack,dispatch}-actions.ts`, `lib/delivery/*`, `admin_product_pack_stock`, `requireActiveWarehouse` |
| Admin | `GET /admin/retailers`, `POST /admin/retailers/{id}/approve|suspend`, `GET/POST/PATCH /admin/products`, `/admin/packs`, `/admin/stock`, `GET/PATCH /admin/orders/{id}`, `GET/POST/PATCH /admin/banners` (+ image upload via `lib/media/*`), `/admin/team`, `/admin/targets`, `/admin/reports/*`, `/admin/cleanup/status` (**read-only, dry-run**) | `lib/admin/*` |
| Super admin | `GET /admin/control-center/*` (privileged accounts, AI memory admin) | `requireSuperAdmin` semantics — **never** reachable by `admin` |

**Never exposed to mobile:** cleanup execution (`GET /api/cron/cleanup` stays
`CRON_SECRET`-only), service-role operations, permanent catalog/product-image deletion,
blind wallet-ledger deletion, or any "pretend it worked" stub. Where a feature cannot be
delivered (see the audit's BLOCKED rows), the endpoint is not created and the app shows
an honest unavailable state.

---

## 3. Shared server helpers (all **IMPLEMENTED** in Phase B)

| Module | Responsibility |
| --- | --- |
| `lib/mobile/http.ts` | `jsonOk`, `jsonError`, `parseJsonBody` (size + shape + zod), `requestId` header, sanitized error logging, `methodNotAllowed` |
| `lib/mobile/auth.ts` | `requireMobileSession`, `requireMobileRole`, `requireMobilePermission` (wraps `can()`), typed `MobileAuthFailure` |
| `lib/mobile/pagination.ts` | `parsePageParams` (limit clamp), `encodeCursor`/`decodeCursor` (base64url, opaque), `pageEnvelope` |
| `lib/mobile/rate-limit.ts` | `consumeRateLimit(group, key)` token bucket + `rateLimitResponse` with `Retry-After` |
| `lib/mobile/supabase.ts` | `createMobileSupabaseClient(accessToken)` — anon key + caller's bearer token (RLS-scoped), `persistSession: false` |
| `lib/mobile/index.ts` | barrel re-export (routes import from here) |

Every route handler is a thin composition: parse → authorize → call the existing service
→ shape the response. **No business rule is written in a route.**

## 4. Testing requirements per endpoint (independent of the Android UI)

Every IMPLEMENTED endpoint must have tests in `tests/` that run under the existing
vitest configuration (node environment, `@` and `server-only` aliases – see
`vitest.config.ts`):

1. Missing / malformed / expired / revoked token → correct code + status.
2. Each protected role: allowed roles pass, every other role → `403 forbidden`.
3. Ownership boundaries (retailer A cannot read/mutate retailer B's resource).
4. `pending_approval`, `suspended`, `inactive`, access-period-lapsed accounts.
5. Request schema validation (extra fields ignored, wrong types/limits rejected).
6. Price/GST recomputation — a client-sent total is ignored **and** the response equals
   the service's computation.
7. Insufficient stock → `insufficient_stock` with `details.available`; concurrent/
   repeated submissions cannot oversell (DB-trigger guarantees are asserted by the
   existing migration/trigger tests).
8. Duplicate idempotency key → the original order, never a second one; key reuse with a
   different payload → `409`.
9. Cancellation restores pack stock and refunds coins exactly once.
10. Coins: balance never changes from a read; debit/refund keyed and idempotent.
11. Rate limiting returns `429` + `Retry-After`, and sanitized error bodies in every case.
12. Response shape: money as integer paise, ISO-8601 timestamps, no internal identifiers,
    no SQL/driver text.

Phase B adds `tests/mobile-api-foundation.test.ts` — **41 tests, all passing** — covering
these requirements for the shared helpers, `GET /api/mobile/v1/health`,
`GET /api/mobile/v1/session`, and static security assertions on the Android sources
(no database key or service-role string, no embedded-browser usage, cleartext disabled,
a single exported component, no disabled TLS verification, no token logging).

Run it on its own with:

```bash
node_modules/.bin/vitest run tests/mobile-api-foundation.test.ts
```
