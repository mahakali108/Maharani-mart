# Admin ERP upgrade — Phase 1 audit & plan

**Branch:** `arena/01a0a585-maharani-mart` (from `main` @ `c2d05b09`)
**This PR implements:** Module 1 — Admin Dashboard only.
**Rule:** existing working features, RLS, GST/pricing/MOQ/stock/cart/orders/retailer isolation stay intact. No fake/mock production data. No duplicate tables, permissions, or notification systems.

Related prior work (reused, not rebuilt):

- Admin KPI dashboard at `/admin/dashboard` (PR #36)
- Super Admin Command Center at `/admin/command-center` (PR #17) — **super_admin only**
- Wallet ledger `0029–0031`, collections `0044`, support tickets `0048`, GST invoice split, deliveries `0043`, schemes UI, etc.

---

## 0. Current-branch inventory (exact)

| Item | Count |
|---|---|
| Admin pages `app/admin/**/page.tsx` | 48+ |
| Migrations | `0001`–`0049` |
| Permission engine | `lib/permissions/permissions.ts` |
| Roles on `/admin` | `super_admin`, `admin` (middleware + layout) |

No new tables are required for the dashboard. Every KPI below already has a real source.

---

## 1. Module audit (15 Phase-1 modules)

### 1. Admin Dashboard — **this PR**

| | |
|---|---|
| Route | `/admin/dashboard` |
| Exists | Yes — date-range sales/orders, retailer counts, outstanding total, recent orders, top products, low-stock (hidden when empty), recent audit |
| Missing (production-useful) | AOV + previous-period growth; cancelled/returned/packed counts; fulfillment rate; retailer active/suspended/new-in-range; inventory out-of-stock + empty state; credit utilization / over-limit; **payment summary**; **GST summary** (stored `gst_total`, no invented CGST/SGST); **top retailers**; pending returns/collections/tickets; **expiring batches**; **support-ticket summary**; **system alerts**; custom date UI; role-based section visibility; per-section unavailable state; top-product qty labelled as pieces (not “cases”) |
| Schema | None — reuse `orders`, `order_items`, `retailers`, `inventory_product_totals`, `inventory_expiry_report`, `retailer_wallet_ledger`, `payment_collections`, `support_tickets`, `return_requests`, `notification_logs`, `audit_logs` |
| Permissions | New `dashboard.view` (admin + super_admin). Sections gated with existing perms (`orders.view.all`, `inventory.view`, `retailers.manage_wallet`, `collections.verify`, `support.manage`, `command_center.view`, …) |

### 2. Retailer Management

| | |
|---|---|
| Routes | `/admin/retailers`, `/admin/retailers/[id]` |
| Exists | List + pending queue, approve/suspend/reject/reactivate, KYC docs, salesman/area assignment, credit via wallets |
| Missing (later) | Payment-proof verification is on `/admin/collections` (exists). Area-level retailer analytics, bulk KYC review, inactivity follow-up queue |

### 3. Product Catalog

| | |
|---|---|
| Routes | `/admin/products`, `/new`, `/[id]` |
| Exists | CRUD, packs, case/loose tiers, images, barcode field, activation |
| Missing (later) | Label/barcode print export exists at `/admin/reports/barcodes`. No scanner. Cost remains admin-RPC only (`0025`) |

### 4. Categories and Brands

| | |
|---|---|
| Routes | `/admin/catalog`, `/admin/catalog/brands/[id]`, `/admin/catalog/categories/[id]` |
| Exists | CRUD |
| Missing (later) | Category-level sales rollup on catalog page (reports already have product-wise) |

### 5. Pricing and Schemes

| | |
|---|---|
| Routes | `/admin/pricing`, `/admin/pricing/schemes` |
| Exists | Price lists (base/area/retailer), preview, scheme CRUD (post-0040) |
| Missing (later) | Festival scope on price lists was previously blocked; confirm scheme-scoped lists if still gated |

### 6. Inventory and Warehouses

| | |
|---|---|
| Routes | `/admin/inventory/**`, `/admin/warehouses/**` |
| Exists | Live stock, movements, GRN, batches, expiry, transfers, low-stock, forecast, settings |
| Missing (later) | Area stock view (`0041` view may already exist — wire UI if unused). Stock is product-level, not pack-level (`docs/warehouse-gaps.md`) — do not fabricate |

### 7. Orders and Fulfillment

| | |
|---|---|
| Routes | `/admin/orders`, `/admin/orders/[id]`, `/admin/delivered/**`, `/admin/returns` |
| Exists | List/detail, warehouse assign, approve (FEFO), dispatch, cancel, delivered module, returns |
| Missing (later) | Deeper delivery-proof review queue; print/challan |

### 8. Payments and Credit

| | |
|---|---|
| Routes | `/admin/wallets`, `/admin/wallets/[id]`, `/admin/collections` |
| Exists | Ledger, credit limit, Net-N terms (`0049`), field-collection verify |
| Missing (later) | Collection report by salesman; CSV export of ledger |

### 9. Suppliers and Purchase Orders

| | |
|---|---|
| Routes | GRN under `/admin/inventory/grn/**` |
| Exists | GRN draft → confirm → cancel. No supplier master table (supplier is a GRN reference string) |
| Missing (later) | Supplier master + PO document. Do not invent a parallel purchases table until required |

### 10. Staff and Role Permissions

| | |
|---|---|
| Routes | `/admin/team/**`, `/admin/targets`, `/admin/commissions`, `/admin/follow-ups`, `/admin/attendance`, `/admin/visits` |
| Exists | Team CRUD (super_admin create), targets, commissions, follow-ups, attendance/visits views, staff-scope RLS `0037` |
| Missing (later) | Staff performance dashboard page |

### 11. Reports and Analytics

| | |
|---|---|
| Routes | `/admin/reports`, inventory reports + CSV, barcode CSV, delivered export |
| Exists | Retailer/area/product/salesman sales, some CSVs |
| Missing (later) | GST period report, print views, more CSV surfaces |

### 12. Notifications

| | |
|---|---|
| Routes | `/admin/notifications` |
| Exists | Log viewer + composer (`broadcastNotificationAction`) |
| Missing (later) | Template library. Do **not** add a second notifications table |

### 13. Support Tickets

| | |
|---|---|
| Routes | `/admin/support`, `/admin/support/[id]` |
| Exists | Queue, reply, status workflow (`0048`) |
| Missing (later) | SLA timers, assignment. Dashboard only surfaces a summary |

### 14. Audit Logs

| | |
|---|---|
| Routes | `/admin/audit-logs` |
| Exists | Trigger-based `audit_logs` + super-admin control-center log |
| Missing (later) | Semantic filters. Dashboard keeps a recent-activity strip |

### 15. System Settings

| | |
|---|---|
| Routes | `/admin/control-center` (super_admin), inventory settings |
| Exists | Feature flags, access periods, maintenance |
| Missing (later) | Company GSTIN/settings UI (today `COMPANY_GSTIN` env). Not part of this PR |

---

## 2. Implementation plan (priority order)

| # | Module | This PR |
|---|---|---|
| 1 | Admin Dashboard | **Yes** |
| 2–15 | Remaining modules | No — later PRs, one module at a time |

Dashboard implementation (done in this PR):

1. Extract date-range, aggregations, and visibility into `lib/admin/dashboard/*` (unit-tested, no Supabase in compute).
2. Fetch through the cookie-bound RLS client only (`createClient()`, never service role).
3. Isolate section failures (`ok` / `empty` / `unavailable`) — never fabricate numbers.
4. Render a responsive admin dashboard with the required KPI groups.
5. Gate Command Center CTA with `command_center.view` (super_admin).
6. Add `dashboard.view` + matrix note. No migration.

---

## 3. Non-negotiables

- IST calendar-day bounds via `lib/datetime/india.ts` (same as reports / command center).
- Sales exclude `cancelled`; GST KPI uses stored `orders.gst_total` (inclusive). CGST/SGST/IGST is **not** guessed at dashboard level (needs both GSTINs per invoice — already on the invoice page).
- Payments: `PAYMENT_CREDIT` on `retailer_wallet_ledger` (authoritative collected); pending `payment_collections` are **not** added to collected (not yet in the wallet).
- Credit: `calculateCreditPosition` (same calculator as checkout).
- Top-product quantities counted in **pieces** (`rowPieces`), never labelled as cases.
- Retailer rows never cross accounts — admin reads are RLS `is_admin_or_above()`; no retailer_id is taken from the client.
- Window capped at 90 days; order fetch bounded at 5,000 rows.

---

## 4. Out of scope for this PR

Coding modules 2–15, new migrations, new notification buses, supplier master, barcode scanning, fake seed data, merging the PR.
