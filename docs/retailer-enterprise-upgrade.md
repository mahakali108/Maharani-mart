# Retailer Enterprise Upgrade — Audit & Implementation Plan

**Scope:** the retailer-facing surface (`/retailer/**`), the pricing/order pipeline it
depends on, and the database privileges that back them.
**Method:** full repository audit first, then the smallest set of changes that closes a
*verified* gap. Nothing was rewritten; existing business logic is preserved.

---

## 1. What the audit found already implemented (deliberately NOT rewritten)

| Area | Where it lives | Verdict |
|---|---|---|
| Case-based pricing engine | `lib/retailer/case-pricing.ts` (`caseLineBreakdown`, `piecePriceFromCase`, `gstComponentFromInclusive`, `pickApplicableTier`, `validateTiers`) | Correct. Case price is authoritative, piece price derived, GST **extracted** from an inclusive price, never added. |
| Server-authoritative quote/order | `lib/orders/quote-order.ts` (`quoteOrderForRetailer`), `lib/orders/create-order.ts` (`createOrderForRetailer`) | Correct. Re-quotes immediately before every write; revalidates retailer status, pack/product active flags, MOQ, tiers, overrides, credit. No client price is ever accepted. |
| Credit rules | `lib/orders/credit.ts` (`calculateCreditPosition`) | Correct, enforced server-side in `createOrderForRetailer`. |
| Effective price / overrides | `lib/retailer/effective-price.ts` | Single implementation shared by catalog, detail, cart, checkout, quote. |
| Variants (packs) | `product_packs` + `product_pricing_tiers`, `lib/retailer/variants.ts`, `components/retailer/variant-switcher.tsx`, `pack-selector.tsx` | Correct. Variant route `/retailer/catalog/<packId>`, image priority = pack image → parent gallery, best-value badge only when ≥ ₹0.005/piece cheaper. |
| Retailer home | `app/retailer/home/page.tsx` | Banners (active + area + date window), categories, brands, rails — all real data. |
| Catalog | `app/retailer/catalog/page.tsx`, `components/retailer/catalog-filters.tsx` | Search + category/brand/price/discount/MOQ/fav/new/offers filters + 7 sorts. |
| Cart / checkout | `app/retailer/cart`, `app/retailer/checkout`, `lib/retailer/cart-service.ts` | Tier price, case breakdown, savings, GST-inclusive totals, MOQ + availability validation. |
| Order center | `app/retailer/orders`, `[id]`, `[id]/invoice`, `[id]/reorder` | All 8 schema statuses, filters, pagination, status timeline, invoice, reorder with full revalidation. |
| Wishlist | `retailer_favorites` (migration 0015) | Product-level **by design** — documented in the migration. Preserved. |
| Notifications | `notifications` + `notification_logs`, `lib/notifications/notify.ts`, wired into order status changes | RLS owner-scoped; status transitions already notify. |
| Bottom nav | `components/layout/mobile-bottom-nav.tsx` | Home / Categories / Brands / Cart / Account, cart badge, active route, `env(safe-area-inset-bottom)`. |
| Auth / middleware / RLS | `middleware.ts`, `lib/auth/*`, 24 migrations | Role routing, approval gate, access-period gate; RLS enabled on every table. |

Baseline before any change: `tsc --noEmit` clean, `next lint` clean, **257 tests passing**,
`next build` clean, all retailer routes server-rendered (`ƒ`) — no authenticated HTML is
statically cached, so no cross-retailer cache leak exists.

---

## 2. Verified gaps this branch closes

Each item below was confirmed by reading the code/schema, not inferred from docs.

### G1 — Catalog fetched the entire product table (no pagination)
`app/retailer/catalog/page.tsx` selected **every** active product with a heavy nested
payload (`brands` + `product_images` + all `product_packs`) and then filtered/sorted in
memory. Response size grew without bound with the catalog.
**Fix:** real pagination. Two honest modes, because price/discount/MOQ filters depend on
per-retailer resolved prices that cannot be pushed into SQL without changing results:
* **DB-paginated** (`.range()` + `count: 'exact'`) when the active sort is DB-expressible
  and no derived-price filter is active — the default browse path.
* **Bounded working set** (`CATALOG_MAX_ROWS = 240`, DB-ordered) when a derived-price
  filter/sort is active, then in-memory filter → sort → paginate. When the cap binds, the
  UI says so and asks the retailer to narrow the search instead of silently truncating.

### G2 — Internal SKU codes were displayed to retailers
`components/retailer/cart-item-row.tsx` rendered `SKU <pack_sku_code>`; the retailer
product page selected `pack_sku_code` into a client component's props (so the value was
shipped to the browser); the Maharani AI product card put `products.sku_code` in the
subtitle shown on the **retailer** surface.
Business rule 6 says internal SKU is not retailer-facing.
**Fix:** stop selecting/rendering it on retailer surfaces. The database columns
(`products.sku_code`, `product_packs.pack_sku_code`), the admin UI and the salesman order
builder are untouched — salesmen are internal staff, not retailers.
*Note:* `tests/sku-code-removal.test.ts` previously asserted the cart page keeps
`pack_sku_code`. That one assertion was inverted to enforce the new rule; the rest of the
file (column retention, types, migration 0023 safety) is unchanged.

### G3 — `cost_price` was readable by any authenticated user (security)
RLS is **row**-level. `products_read` / `product_packs_read` expose active rows to
retailers, and Supabase grants `authenticated` SELECT on all columns — so a retailer could
call PostgREST directly (`/rest/v1/products?select=cost_price`) and read purchase cost.
The app UI never asked for it, but the database allowed it. Violates business rule 5.
**Fix (migration 0025):** column-level `REVOKE SELECT (cost_price)` from `anon` and
`authenticated` on both tables, plus three `SECURITY DEFINER` accessors gated on
`is_admin_or_above()`. `/admin` is restricted to admin/super_admin (`lib/auth/roles.ts`),
so the three existing read sites are the only consumers and staff lose nothing.
INSERT/UPDATE privileges are untouched, so admin cost editing keeps working. Views
(`inventory_product_totals`) run as their owner and are unaffected.

### G4 — "Similar products" rail priced variants with `units_per_case = 1`
`getSimilarProductCards` hand-rolled a pack sub-select that omitted `units_per_case` and
`image_url`, while `toPricedCard` reads both. Result: the per-piece figure on that rail was
the **case** price (÷1) and the variant image never appeared.
**Fix:** use the shared `PRODUCT_CARD_SELECT` constant so the two can never drift again.
Same omission fixed in the AI catalog selects (`lib/ai/tools/products.ts`,
`discovery.ts`) for future correctness.

### G5 — No retailer ledger / financial history surface
**Schema reality:** `retailers.credit_limit` and `retailers.outstanding_balance` exist.
There is **no** payments, receipts, adjustments, due-date or credit-terms table anywhere in
the 24 migrations. Order charges *are* real and derivable from `orders`.
**Fix:** `/retailer/account/ledger` built only from real rows — the authoritative account
position (`calculateCreditPosition`) plus an itemised list of the retailer's own real order
charges. **Documented gap, not fabricated:** because payments/adjustments are not captured,
no running balance is computed (a running balance from orders alone would not reconcile
with `outstanding_balance` and would be a fabricated financial figure). The page states
this plainly. See §4 for the safest implementation path.

### G6 — Checkout/order detail showed no delivery address or settlement method
**Schema reality:** one `retailers.address` text column + `areas`. No address book, no
`payment_method`, no Net-15/Net-30 terms, no `due_date` on `orders` or `retailers`.
**Fix:** show the **real** registered delivery address (shop name, address, area, contact
phone) on checkout and order detail, and the **real** settlement position (credit account
when a limit is configured) using the existing `CreditSummary`. Net-15/Net-30 terms and
multi-address selection are **not** invented — documented as a schema gap in §4.

### G7 — "Clear cart" existed in the service layer but was unreachable
`clearRetailerCart` had no server action and no UI. **Fix:** `clearCartAction` + a button on
the cart page, owner-scoped exactly like the other cart mutations.

### G8 — Search ignored variant/size names and barcodes
`products.barcode` and `product_packs.barcode` exist (migration 0005) and `pack_name` *is*
the size (50g / 100g / 200g), but neither catalog search nor suggestions matched them.
**Fix:** catalog `.or()` clauses and `searchSuggestionsAction` now also match pack name and
barcode. RLS keeps inactive packs out of the match set automatically. Internal SKU is still
never a search field or a result label.

### G9 — No "recently ordered / buy again" rail on home
`getBuyAgainCards` was implemented and tested-shaped but **never called**. Home's only
history rail was frequency-based. **Fix:** a real "Buy again" rail from the retailer's own
last non-cancelled order, rendered only when that history exists.

---

## 3. Explicit non-goals (no change, on purpose)

* **Pricing arithmetic** — untouched. `caseLineBreakdown` / `quoteOrderForRetailer` /
  `createOrderForRetailer` keep their exact semantics. This branch adds *tests* that pin
  them, not edits.
* **`retailer_favorites` is product-level**, per the reasoning recorded in migration 0015
  (a wishlist answers "which products does this shop reorder", pack choice happens at order
  time). Making it variant-aware would need a schema change and would orphan existing rows —
  no business need was demonstrated, so it is preserved.
* **Catalog card "from" price** sorts packs by *case* price, and the card labels it
  "Case price · GST inclusive" — internally consistent. Changing it to a per-piece sort
  would alter displayed prices across the app; out of scope.
* **Per-variant stock** stays hidden: inventory is product-level and staff-only under RLS
  (`inventory_staff`). A retailer-facing per-variant stock number would be both invented and
  a data leak. See `docs/warehouse-gaps.md`.
* **No new native/Capacitor dependency**, no change to `capacitor.config.ts`, `www/`,
  `scripts/android-*`, safe-area handling or the middleware matcher.

---

## 4. Documented schema gaps and the safest implementation path

These are **not** implemented, because implementing them without schema support would
require fabricating business data.

| Gap | Why it can't be done today | Safest path |
|---|---|---|
| **Itemised payments / receipts / adjustments** in the ledger | No table records money coming *in*. `retailers.outstanding_balance` is a single mutated number with no transaction history. | New `retailer_ledger_entries (id, retailer_id, entry_type enum('order_charge','payment','adjustment','credit_note'), amount, balance_after, reference_order_id, reference, created_by, created_at)` + RLS `retailer_id = auth.uid()` for SELECT, staff-only INSERT, index on `(retailer_id, created_at desc)`. Write entries from `createOrderForRetailer` and from a new admin "record payment" action, inside the same transaction as the `outstanding_balance` update. Only then can a running balance be shown truthfully. |
| **Overdue amount / due date** | No `due_date`, no payment-terms column anywhere. | Add `retailers.payment_terms_days int` + derive `due_at` per delivered order (or store `orders.due_at`). Overdue = sum of unpaid charges past `due_at` — requires the ledger table above first. |
| **Net-15 / Net-30 selection at checkout** | No terms model; credit is a single limit + balance. | Same as above; expose terms as a read-only "Your terms: Net-30" once `payment_terms_days` exists. Do **not** let the retailer choose terms client-side. |
| **Multiple delivery addresses / per-order address snapshot** | One `retailers.address` text column; `orders` stores no address, so a historical order can only show the *current* registered address. | New `retailer_addresses` table (owner-scoped RLS) + `orders.delivery_address_snapshot jsonb` written at order creation. Until then the UI labels the value "registered shop address" rather than implying it was captured at order time. |
| **Explicit `payment_method` on an order** | Column does not exist; settlement is implicitly the credit account. | Add `orders.payment_method enum('credit_account','cash_on_delivery','advance')` with a server-side default, never a client-chosen value that affects price. |
| **Column-level protection for other admin-only fields** | `cost_price` is now locked down (G3). `audit_logs.old_data/new_data` JSONB still contains full row snapshots, but the table is already staff-only by RLS, so it is not retailer-reachable. | If more column-level secrets are added later, follow the 0025 pattern: `REVOKE SELECT (col)` + a `SECURITY DEFINER` accessor gated on the right role. |

---

## 5. Verification performed

`tsc --noEmit` · `next lint` · `vitest run` · `next build` — see the PR description for
results. New tests pin: `unit_price × quantity = line_total` reconciliation across every
supported quantity/tier/GST combination, GST-inclusive extraction (no double-add), case-price
authority, MOQ, credit limits, catalog pagination math, and source-level guards for the
retailer SKU/cost-price rules and retailer data isolation.
