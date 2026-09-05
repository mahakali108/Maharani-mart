# Maa Kali B2B Ultra Platform — Enterprise Architecture

**Domain:** FMCG B2B Wholesale Distribution — Khagaria District
**Stack:** Next.js 14 (App Router) + Tailwind CSS + Supabase (Postgres, Auth, Storage, Edge Functions, Realtime) + Vercel
**State:** Production-ready, zero seed/demo data. Database boots empty. All content entered via Admin Panel.

---

## 1. Design Principles

1. **No hardcoded data anywhere.** No mock arrays, no placeholder products, no dummy retailers in code or seed files. Every list/grid renders an empty state until real data exists.
2. **Role-based access control (RBAC) enforced at the database layer** via Postgres Row Level Security (RLS) — not just hidden in the UI. A Retailer's Supabase session literally cannot query another retailer's orders, even if the frontend is bypassed.
3. **Multi-tenant-ready single business.** Structured so a second distribution branch/district could be added later without a schema rewrite (via `warehouses` / `areas`).
4. **AI features are real jobs, not decoration.** Predictions are computed by a scheduled Edge Function reading actual `orders`/`inventory_stock` rows and written to an `ai_predictions` table — if there's no order history yet, the dashboard shows "Not enough data yet," never a fake number.
5. **Every write is audited.** `audit_logs` captures who changed price/stock/order status and when — essential for a real wholesale business with money on the line.

---

## 2. User Roles & Permission Matrix

| Capability | Super Admin | Admin | Staff | Salesman | Retailer |
|---|---|---|---|---|---|
| Manage Admins/Staff | ✅ | ❌ | ❌ | ❌ | ❌ |
| Manage Products/Brands/Categories | ✅ | ✅ | ✅ (no delete) | ❌ | ❌ |
| Set Pricing/Schemes | ✅ | ✅ | ❌ | ❌ | ❌ |
| Manage Warehouse Stock | ✅ | ✅ | ✅ | ❌ | ❌ |
| Approve/Process Orders | ✅ | ✅ | ✅ | ❌ (collect only) | ❌ |
| Create Orders on Behalf of Retailer | ✅ | ✅ | ✅ | ✅ | — |
| Place Own Orders | ❌ | ❌ | ❌ | ❌ | ✅ |
| View All Reports | ✅ | ✅ | ✅ (limited) | own area only | own data only |
| Route/Visit Planning | ✅ | ✅ | ✅ | ✅ (own route) | ❌ |
| View Own Price List / Schemes | — | — | — | — | ✅ |

This matrix maps directly to Postgres RLS policies in `schema.sql` — see Section 5.

---

## 3. High-Level System Diagram

```
                         ┌───────────────────────────┐
                         │        Vercel (CDN)        │
                         │   Next.js 14 App Router     │
                         │  ┌─────────┬─────────────┐ │
                         │  │ /admin  │ /retailer   │ │
                         │  │ /staff  │ /salesman   │ │
                         │  └─────────┴─────────────┘ │
                         └──────────────┬─────────────┘
                                        │ Supabase JS Client (RLS-scoped)
                         ┌──────────────▼─────────────┐
                         │          Supabase            │
                         │ ┌─────────┐ ┌──────────────┐ │
                         │ │ Postgres│ │  Auth (JWT)   │ │
                         │ │  + RLS  │ │  + Roles      │ │
                         │ └─────────┘ └──────────────┘ │
                         │ ┌─────────┐ ┌──────────────┐ │
                         │ │ Storage │ │ Edge Functions│ │
                         │ │(images) │ │ AI + Notify   │ │
                         │ └─────────┘ └──────────────┘ │
                         └──────────────┬─────────────┘
                                        │
                     ┌──────────────────┼──────────────────┐
                     ▼                  ▼                  ▼
              WhatsApp Cloud API   SMS Gateway         pg_cron jobs
              (order updates)     (OTP/alerts)     (nightly AI predictions)
```

---

## 4. Module Breakdown

### 4.1 AI Dashboard
Computed nightly (and on-demand) by a Supabase Edge Function (`compute-ai-insights`), not client-side guesswork:

- **Daily Sales Prediction** — simple weighted moving average + day-of-week seasonality over `orders` (last 60 days). Falls back to "insufficient data" state (< 14 days of order history).
- **Top Selling Products** — materialized view `mv_top_products` refreshed nightly, ranked by qty sold in rolling 30-day window.
- **Low Stock Prediction** — average daily outward velocity per SKU vs. current `inventory_stock.quantity`, flags SKUs projected to hit zero within `lead_time_days` (configurable per product).
- **Customer Purchase Analysis** — RFM-style scoring (Recency, Frequency, Monetary) per retailer, stored in `retailer_insights`.

All of this is **empty and inert** until real orders exist — no synthetic numbers are ever generated.

### 4.1b Maharani AI Demand Forecasting
An explainable, statistical demand-forecasting engine (`lib/ai/forecast/`) reads **real, RLS-authorized** order and inventory data through the caller's cookie-bound Supabase client and produces per-product 7/30-day demand estimates, demand direction, stock-out risk, reorder quantity, overstock/dead-stock warnings, and an honest confidence score. AI copilot tools (`get_demand_forecast`, `get_reorder_recommendation`, `get_inventory_risk`) are registered for admin/staff only and are read-only. The admin **Forecast** dashboard lives at `/admin/inventory/forecast`. Backed by the `ai_product_demand_daily` view (migration 0019). See `docs/ai-intelligence.md`.

### 4.2 Advanced Ordering
- **Smart Cart** — persists per-retailer in `cart_items`, survives across devices/sessions.
- **Reorder in One Click** — clones a past `order` + `order_items` into a new cart, re-validates current price & stock before checkout.
- **Bulk Order Upload** — retailer/staff uploads CSV (SKU code + qty), parsed via a `/api/orders/bulk-upload` route, validated row-by-row against live `products`/`inventory_stock`, errors returned inline (no partial silent failures).
- **Order History Analytics** — per-retailer and per-admin views over `orders`/`order_items`, no dummy rows.

### 4.3 Retailer App
- Personal price list = resolved view combining `price_lists` (base → area → retailer-specific → active scheme/festival override), computed via `get_effective_price(product_id, retailer_id)` SQL function.
- My Orders / My Schemes / New Launch Products (`products.is_new_launch = true`, admin-toggled) / Notification Center (`notifications` table, realtime via Supabase Realtime channel).
- **Size/variant switcher.** `product_packs` are the sellable sizes of a product (e.g. Baby Powder 50g/100g/200g). The product detail route accepts either the product id (classic links, cheapest pack preselected) or a pack id — the switcher renders real `<Link>`s to `/retailer/catalog/<packId>` so the URL identifies the selected variant and browser back works. Switching swaps the hero image (the pack's own `image_url`, falling back to the product gallery), MRP, GST-inclusive case price, units-per-case, that pack's quantity tiers and availability; cart/checkout/order keep operating per `pack_id` exactly as before. A pack may carry its own image, uploaded from the existing admin pack manager (`product_packs.image_url`, migration 0024).

### 4.4 Inventory System
- `warehouses`, `inventory_stock` (qty per warehouse per product), `stock_movements` (typed: inward/outward/damage/return/transfer/adjustment) — inventory quantity is **never** edited directly; it's always a derived sum of movements, giving a full audit trail.
- Live Inventory view subscribes to Supabase Realtime on `stock_movements`.
- **Known limitation (case vs piece units).** Stock is modelled per *product* in
  stock units, while `order_items.quantity` is now a count of pieces per billing
  unit. Nothing decrements stock from the split rows, and the FEFO allocation RPCs
  (migration `0017`) still read `order_items.quantity` as stock units, so for a
  multi-piece case they under-consume (1 case row = 1 instead of 40). This gap
  predates the case/loose work — the same mismatch existed when `quantity` held
  packs — and it is deliberately left unfixed here: inventing a per-case stock
  deduction would fabricate availability the warehouse has not recorded. Closing
  it needs a stock-unit decision per product (pieces vs cases) plus a migration of
  `inventory_*` rollups and the allocation RPCs, which is a warehouse-model
  change rather than a pricing change. Retailer-facing consequences stay bounded:
  ordering is never blocked by stock, and availability shown comes from the same
  product-level totals as before.

### 4.5 Pricing Engine — small-retailer B2B piece model

**Two concerns, cleanly separated.** The platform now serves a **small
retailer** who buys **individual PIECES**. The **case** is an INTERNAL
supplier/warehouse/stock-packing concept only, and must never reach the retailer
as a buying rule, a price or a requirement.

- **RETAILER selling price** (the only thing a retailer sees and pays) is
  derived from the variant's *loose-piece selling tiers*, keyed by the **total
  quantity**: quantity Q is billed at `Q × tier_rate(Q)`.
- **INTERNAL case / supplier / warehouse / cost** (`units_per_case`,
  `case_price`, supplier cost, admin margin, pack SKU) is kept intact for
  supplier purchasing, warehouse stock, internal costing and any future
  wholesale — but it is never rendered to a retailer.

The case+loose math remains inside `lib/retailer/case-pricing.ts` as the
internal engine; the retailer lens lives in
`lib/retailer/retailer-pricing.ts` → `calculateRetailerPiecePrice`, which is the
**only** function a retailer-facing price may come from.

```
Q     = retailer quantity (pieces)
rate  = tier_rate(Q)          // from loose-piece selling tiers, by total Q
total = Q × rate              // GST-inclusive; GST is extracted, never added
```

**Where it lives.**
- `lib/retailer/retailer-pricing.ts` → `calculateRetailerPiecePrice`: single
  authoritative retailer price. It uses integer paise so `Q × unitPrice ===
  lineTotal` exactly, extracts GST from the inclusive total, rejects
  zero/negative/non-integer/below-MOQ quantities, and extends the deepest tier
  for any quantity above the top slab so a retailer can order 80, 92, 200… pcs
  without a case boundary.
- `lib/retailer/case-pricing.ts` → `calculateCaseLoosePrice`: still the INTERNAL
  engine used by admin/supplier/warehouse and by the retailer-tier resolution
  helper. The case concept is not deleted — it is kept for internal concerns.

**Retailer freedom and honesty.** A retailer is never forced to buy a case: any
whole-piece quantity at or above the pack's MOQ is enterable (1, 6, 12, 20, 40,
80, 92…). The cart offers shortcuts as **suggestions** only, never restrictions.
The product page, cart, checkout and invoice show **only**: product name,
variant/size, MRP per piece, selling price per piece, quantity, the applicable
quantity tier, total piece quantity and the GST-inclusive total. No case price,
no case purchase price, no units-per-case buying requirement, no case SKU, no
supplier cost, no admin margin and no internal pack identifier is shown.

**Per-variant.** Selling tiers, MRP, GST, image and availability all come from
the pack's own `product_packs` row and its own `product_pricing_tiers` rows
(migration 0026). Switching size swaps the displayed per-piece rate, MRP, image
and tier table; nothing is inherited or averaged across sizes.

**Persistence and reconciliation.** Each quote line is persisted as exactly
**one** `order_items` row, `quantity_unit = 'pieces'`, `unit_price = tier_rate`,
`line_total = Q × unit_price`, with a snapshot `quantity_pieces`. No case/loose
split, so `unit_price × quantity = line_total` holds exactly and no blended rate
can drift. `lib/orders/item-display.ts` is the single reader: it folds a pack's
rows back into a piece count for every view, and still renders a historical
case+loose split for rows written before the piece model.

**Gaps are explicit, never repriced.** If a pack has selling tiers but a
quantity is not covered by any of them (above MOQ and below the top slab), the
engine returns `orderable = false` and blocks at cart/checkout rather than
silently falling back. When a pack has **no** selling tiers, the retailer price
falls back to the server-resolved per-piece rate (the internal
`case_price / units_per_case`), so existing data prices identically — but that
fallback is computed server-side and only the per-piece number crosses to the
browser.

**Legacy rules.** `product_pricing_tiers` still carries `rule_type = 'loose'`
for retailer selling tiers; pre-existing `'default'` / `'bulk'` / `'case'` rows
are preserved for internal/historical meaning. `price_lists` overrides still
resolve to a case-price override, which the server converts to the per-piece
fallback before it reaches the retailer.

**Legacy columns.** GST-inclusive means the same thing everywhere: the legacy
`ptr` / `wholesale_price` / `base_price` columns on `product_packs` are kept only
for reports and were backfilled into `case_price` by migration
`0022_case_based_pricing.sql`; `base_price` continues to mirror MRP so old reads
do not change.

**Why a pack can show `Units/case = 1` (the "1 pc = 1 case" state).** `0004` created
`product_packs.units_per_case` with a default of 1, and the pre-case UI never asked
an admin for a case size — one pack row *was* one sellable case. Migrations `0022`
and `0026` deliberately preserved those values (no data is rewritten on upgrade),
so older catalog rows keep `units_per_case = 1` and therefore show
`per piece = case price` with a single legacy `default` tier (`1 → no limit`) until
an admin edits them. This is data, not a rendering bug: the UI reads the stored
row. To convert such a pack, open `/admin/products/<id> → Pack sizes & case
pricing`, set **Pcs per case** to the real case size (the editor flags the legacy
state when it is still 1), and add the loose-piece tiers; full cases keep billing
at `case_price` and the remainder follows the tiers immediately. A pack whose Qty
is legitimately 1 piece/case keeps working unchanged.

The requirement's reference configuration — `units_per_case = 80`
(internal only), selling tiers `1–6 = ₹30 · 7–12 = ₹28 · 13–20 = ₹27 ·
21–79 = ₹26` — is pinned by `tests/retailer-piece-pricing.test.ts`:

| Qty (pcs) | Rate/pc | Total |
| --- | --- | --- |
| 6 | ₹30 | ₹180 |
| 7 | ₹28 | ₹196 |
| 12 | ₹28 | ₹336 |
| 13 | ₹27 | ₹351 |
| 20 | ₹27 | ₹540 |
| 40 | ₹26 | ₹1,040 |
| 160 | ₹26 | ₹4,160 |


### 4.6 Reports
- Sales, Profit (needs `products.cost_price`, admin-only visibility), Staff Performance, Area Performance — all SQL views over real `orders`/`order_items`/`visits`/`attendance`. No canned report data.

### 4.7 Salesman Module
- `routes`, `route_customers` (ordered stop list), `visits` (check-in/out with geo-coordinates), `attendance` (daily punch in/out), `orders.collected_by` linking an order to the salesman who captured it in the field.

### 4.8 Notification System
- `notifications` (in-app), `notification_logs` (delivery log for WhatsApp/SMS with provider message ID + status).
- WhatsApp via **WhatsApp Cloud API** (Meta) — order confirmations, dispatch updates, scheme announcements.
- SMS via a gateway (e.g., MSG91/Twilio — swappable, see `lib/notifications/`) for OTP and low-connectivity fallback.
- Triggered by Postgres `pg_net`/Edge Function webhook on `orders` status change — event-driven, not polled.

---

## 5. Database Schema

See `schema.sql` — full DDL with enums, tables, indexes, RLS policies, and helper functions. Highlights:

- `profiles` extends `auth.users` 1:1, holds `role`.
- Every retailer-facing table has RLS: `retailer_id = auth.uid()` (or via a `retailers` join) for `SELECT`, and admins/staff bypass via `is_staff_or_above()` helper.
- `audit_logs` trigger-populated on `products`, `price_lists`, `inventory_stock`, `orders` for accountability.
- No `INSERT` seed statements — schema only.

---

## 6. Frontend Architecture (Next.js App Router)

```
app/
├── (auth)/
│   ├── login/
│   └── register-retailer/         # admin-approved onboarding, not self-serve into live pricing
├── (admin)/                       # Super Admin + Admin
│   ├── dashboard/                 # AI Dashboard cards + charts
│   ├── products/  categories/  brands/
│   ├── pricing/                   # price lists, schemes, festival pricing
│   ├── inventory/                 # warehouse stock, damage, returns
│   ├── orders/                    # approve/process/dispatch
│   ├── retailers/                 # approve, assign area, credit limit
│   ├── staff/  salesmen/          # (super admin only for staff CRUD)
│   ├── reports/
│   └── banners/                   # homepage banners for retailer app
├── (staff)/
│   ├── dashboard/
│   ├── orders/
│   └── inventory/
├── (salesman)/
│   ├── routes/
│   ├── visits/
│   ├── attendance/
│   └── orders/new/                # order capture in the field
├── (retailer)/
│   ├── home/                      # banners, new launches, schemes
│   ├── catalog/
│   ├── cart/
│   ├── orders/
│   └── notifications/
└── api/
    ├── orders/bulk-upload/
    ├── webhooks/whatsapp/
    └── cron/ai-insights/          # Vercel Cron → triggers Edge Function
```

- **Mobile-first**: Tailwind breakpoints designed bottom-up; retailer app is the primary mobile surface (Khagaria field usage, often on mid-range Android).
- **Theme**: Premium Red (`#C8102E` primary), White (`#FFFFFF`), Black (`#0B0B0B`) — tokens defined in `tailwind.config.ts`, no inline hex scattered in components.
- **Charts**: Recharts for dashboard analytics (sales trend, top products, area performance).
- **Empty states are first-class UI**, not an afterthought — every list component ships with a designed "No products yet — add your first product" / "No orders yet" state.

---

## 7. Deployment & Environments

- **Vercel**: `production` (main branch) + `preview` (PRs) — preview deployments point to a separate Supabase project so nobody tests against real retailer data.
- **Supabase**: separate `dev` and `production` projects; migrations tracked via Supabase CLI (`supabase/migrations/`), never hand-edited in the dashboard for prod.
- **Secrets**: WhatsApp/SMS API keys, Supabase service role key — Vercel env vars, never committed.
- **Cron**: Vercel Cron (`vercel.json`) hits `/api/cron/ai-insights` nightly at 2 AM IST → calls Supabase Edge Function with service-role auth.

---

## 8. Build Phases (recommended order)

1. **Foundation** — Supabase schema + RLS, Auth, role-based routing shell, theme tokens.
2. **Catalog & Inventory** — Admin CRUD for brands/categories/products/warehouses/stock (this is what unblocks everything else — platform is unusable until real products exist).
3. **Pricing Engine** — price lists + effective-price resolver.
4. **Ordering** — cart, checkout, order lifecycle, bulk upload.
5. **Retailer App polish** — home, schemes, notifications.
6. **Salesman Module** — routes, visits, attendance.
7. **Reports + AI Dashboard** — only meaningful once real order data exists.
8. **Notifications** — WhatsApp/SMS integration.

I'd recommend we build this phase-by-phase in code (starting with Phase 1) rather than all at once — that keeps every piece testable against your real Khagaria product/retailer data as it's entered, with nothing fake in between.
