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

### 4.2 Advanced Ordering
- **Smart Cart** — persists per-retailer in `cart_items`, survives across devices/sessions.
- **Reorder in One Click** — clones a past `order` + `order_items` into a new cart, re-validates current price & stock before checkout.
- **Bulk Order Upload** — retailer/staff uploads CSV (SKU code + qty), parsed via a `/api/orders/bulk-upload` route, validated row-by-row against live `products`/`inventory_stock`, errors returned inline (no partial silent failures).
- **Order History Analytics** — per-retailer and per-admin views over `orders`/`order_items`, no dummy rows.

### 4.3 Retailer App
- Personal price list = resolved view combining `price_lists` (base → area → retailer-specific → active scheme/festival override), computed via `get_effective_price(product_id, retailer_id)` SQL function.
- My Orders / My Schemes / New Launch Products (`products.is_new_launch = true`, admin-toggled) / Notification Center (`notifications` table, realtime via Supabase Realtime channel).

### 4.4 Inventory System
- `warehouses`, `inventory_stock` (qty per warehouse per product), `stock_movements` (typed: inward/outward/damage/return/transfer/adjustment) — inventory quantity is **never** edited directly; it's always a derived sum of movements, giving a full audit trail.
- Live Inventory view subscribes to Supabase Realtime on `stock_movements`.

### 4.5 Pricing Engine
- `price_lists` table with `scope` enum (`base`, `area`, `retailer`, `scheme`, `festival`) and `priority` for override resolution, `valid_from`/`valid_to` for festival windows.
- `get_effective_price()` Postgres function resolves the correct price at order time — pricing logic lives in the DB, not scattered across frontend code, so it can't drift.

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
