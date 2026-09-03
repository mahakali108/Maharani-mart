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

### 4.5 Pricing Engine — cases and loose pieces

**The rule, in one sentence:** a pack is priced by its **case price** for every
full case and by a **loose-piece tier** for the remaining pieces — and nothing
else. 40 pieces of a 40-piece case is never `40 × loose rate`, and 6 pieces is
never forced up to a case.

```
fullCases = floor(quantity / units_per_case)
looseQty  = quantity % units_per_case
total     = fullCases × case_price  +  looseQty × tier_price(looseQty)
```

Every price in this model is **GST-inclusive**, so the GST shown on an invoice is
*extracted* from these totals (`gstComponentFromInclusive`), never added.

**Where it lives.** One pure module owns the arithmetic:
`lib/retailer/case-pricing.ts` → `calculateCaseLoosePrice`. It is imported by the
authoritative server quote (`lib/orders/quote-order.ts`), order creation, the
cart service, every retailer screen (product page, cart, checkout), the order and
invoice views for all four roles, the AI tools, the salesman order builder and —
importantly — the **admin pricing editor**, which previews exactly what checkout
will charge because it calls the same function. There is deliberately no second
implementation: no screen multiplies a piece price by a quantity, and no client
supplies a price, a tier, a discount or a total.

Worked examples for `units_per_case = 40`, `case_price = ₹1,000`, loose tiers
`1–6 = ₹30 · 7–12 = ₹28 · 13–20 = ₹27 · 21–39 = ₹26`:

| Qty (pcs) | Split | Total |
| --- | --- | --- |
| 6 | 6 loose @ ₹30 | ₹180 |
| 12 | 12 loose @ ₹28 | ₹336 |
| 25 | 25 loose @ ₹26 | ₹650 |
| 39 | 39 loose @ ₹26 | ₹1,014 |
| 40 | **1 case** | ₹1,000 |
| 41 | 1 case + 1 loose @ ₹30 | ₹1,030 |
| 46 | 1 case + 6 loose @ ₹30 | ₹1,180 |
| 80 | 2 cases | ₹2,000 |
| 85 | 2 cases + 5 loose @ ₹30 | ₹2,150 |
| 92 | 2 cases + 12 loose @ ₹28 | ₹2,336 |

**Retailer freedom.** A retailer is never forced into a case: any whole-piece
quantity at or above the pack's MOQ is enterable, and the cart offers shortcuts
(1 pc, the MOQ, the top loose slab, 1 case, 2 cases) as *suggestions* built by
`suggestedQuantities`. The product page states both prices side by side ("Case
price" and "Loose price" via `components/retailer/pricing-schedule.tsx`), and the
cart line shows the arithmetic — `1 Case × ₹1,000.00 + 6 loose pcs × ₹30.00 =
₹1,180.00` — plus `Cases: 1 · Loose: 6`, which is repeated on the order page and
the invoice.

**Per-variant.** Case size, case price, loose tiers, MRP, GST, image and
availability all come from the pack's own row in `product_packs` and its own
`product_pricing_tiers` rows (migration 0026). Nothing is inherited or averaged
across sizes.

**Persistence and reconciliation.** A mixed line is stored as two `order_items`
rows — `quantity_unit = 'cases'` (quantity = number of cases, `unit_price` = case
price) and `quantity_unit = 'pieces'` (quantity = loose pieces, `unit_price` = the
tier rate) — each carrying a snapshot `quantity_pieces` and `units_per_case`. So
`unit_price × quantity = line_total` holds **exactly** on every row, the order
header totals are the sum of those rows, and no blended per-piece rate can drift.
`lib/orders/item-display.ts` is the single reader: it folds a pack's rows back
into `Cases / Loose / pieces` for every view (retailer, admin, staff picking,
salesman, AI), and treats rows written before the split as packs, so historical
orders and invoices render unchanged.

**Gaps are explicit, never repriced.** If a pack has loose tiers but a remainder
quantity is not covered by any of them, the engine returns **zero money** and
`orderable = false` with a message naming the covered ranges; the cart and
checkout block instead of silently falling back to another rate. Admins must
tick "save anyway" to persist such a configuration. When a pack has **no** loose
rows at all, the remainder is priced at the derived `case_price / units_per_case`,
which is exactly how packs behaved before this feature — so existing data prices
identically.

**Legacy rules.** `product_pricing_tiers` was extended, not duplicated:
`rule_type` gained `'loose'` (active loose rows are keyed by
`(product_pack_id, min_quantity)` and may never reach `units_per_case`), while the
pre-existing `'default'` / `'bulk'` / `'case'` rows keep working — a pack whose
loose set is curated has its overlapping legacy slabs deactivated by the admin
save, and an untouched pack keeps its old behaviour. `price_lists` overrides still
resolve to a **case-price** override for the product.

**Legacy columns.** GST-inclusive means the same thing everywhere: the legacy
`ptr` / `wholesale_price` / `base_price` columns on `product_packs` are kept only
for reports and were backfilled into `case_price` by migration
`0022_case_based_pricing.sql`; `base_price` continues to mirror MRP so old reads
do not change.


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
