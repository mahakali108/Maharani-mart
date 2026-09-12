# Phase 1 — Codebase Audit & Feature Matrix

**Scope of this document:** exact inventory of the admin, staff, salesman, warehouse, order and
delivery features that already exist, what is genuinely missing, and the feature matrix that will
drive Phases 2–5. No application code was changed in Phase 1. This document is the phase gate —
coding starts only after it is reviewed.

---

## 0. Baseline verification (run before any work)

| Check | Command | Result |
|---|---|---|
| Typecheck | `pnpm typecheck` | ✅ clean |
| Lint | `pnpm lint` | ✅ passes (pre-existing `<img>` warnings only) |
| Production build | `pnpm build` | ✅ succeeds (Next.js 14.2.15) |
| Test suite | `pnpm test` | ✅ 34 files, 673 tests, all passing |

Stack: Next.js 14 App Router + Supabase (Postgres, Auth, RLS, Storage) + Tailwind + Capacitor
(Android wrapper; no Android build exists in this repo state — `android/` is not present, so no
APK claims are made now or later unless a real APK file exists).

---

## 1. Inventory snapshot (exact numbers)

| Item | Count | Where |
|---|---|---|
| Supabase migrations | 36 files | `supabase/migrations/0001…0036` |
| RLS `create policy` statements | 203 (several replaced by later migrations) | across migrations |
| Admin pages (`app/admin/**/page.tsx`) | 48 | see §2.1 |
| Staff pages (`app/staff/**`) | 4 (dashboard, inventory, inventory/ledger, orders, orders/[id], ai) | see §2.4 |
| Salesman pages (`app/salesman/**`) | 14 | see §2.5 |
| Retailer pages (`app/retailer/**`) | 30 | (context only — no new retailer convenience features planned) |
| Server actions / exported async server functions | 239 total; **106 in `lib/admin`**, 9 in `lib/salesman`, 1 in `lib/staff` (`dispatchOrderAction`), 9 retailer order-related | `lib/**` |
| Test files / tests | 34 files / 673 tests (vitest, node env, pure functions — **no DB/RLS integration tests exist**) | `tests/**` |
| Roles | `super_admin, admin, staff, salesman, retailer` | `lib/auth/roles.ts`, `lib/permissions/permissions.ts` |
| Order status enum | `pending, confirmed, processing, packed, dispatched, delivered, cancelled, returned` | migration `0001` |
| Storage buckets | `product-images, brand-logos, category-images, banners, retailer-avatars, retailer-documents` (private) | `0003/0016/0021`, `lib/media` |
| Service-role usage | Server-only `createServiceRoleClient()` (`lib/supabase/server.ts`), `lib/storage/usage.ts` (API route), `scripts/verify-storage-bucket.mjs`. No `SUPABASE_SERVICE_ROLE_KEY` in any client component (verified by grep). | — |

Key architectural facts that constrain the new work:

1. **Inventory is movement-sourced.** `inventory_stock` is a cached sum of `stock_movements`;
   never edited directly. FEFO batch allocation on approve, consumption on dispatch
   (`order_stock_allocations`, RPCs in `0017`). Stock is **product-level, not pack-level**
   (documented gap in `docs/warehouse-gaps.md`) — the new work must not fabricate per-variant stock.
2. **Wallet/credit ledger already exists and is paise-exact with idempotency keys**
   (`retailer_wallet_ledger`, `retailer_credit_accounts`, RPCs `0029–0031`). Payment collection
   must write through this ledger, not a parallel money table.
3. **`orders` already carries** `dispatched_by`, `dispatched_at`, `delivered_at`,
   `cancelled_reason`, and a `shipping_address` snapshot (`0009`, `0036`).
4. **Status history is auto-logged by DB trigger** (`0008`) — every future status path gets a
   history row for free; the `changed_by` comes from `auth.uid()`.
5. **Audit logging is trigger-based** on `products`, `price_lists`, `orders`,
   `return_requests`, `product_packs`, `product_pricing_tiers`, `grns`, `inventory_batches`,
   `stock_transfers`, retailer credit-limit changes — plus `super_admin_audit_logs` (`0020`).
6. **The permission engine** (`lib/permissions/permissions.ts`) already declares
   `orders.deliver` (staff ❌ / salesman ✅ today) — delivery-role permissions will be extended,
   not replaced.
7. **Middleware** enforces role routing (`/admin` → super_admin+admin, `/staff` → staff+admins,
   `/salesman` → salesman+admins) and the 7-day access-period gate; `/pending-approval` gate for
   retailers.

---

## 2. Existing features — exact, by area

### 2.1 Admin panel (48 pages, `app/admin/**`)

**Dashboard & analytics**

| Feature | Route | Implementation | Exists |
|---|---|---|---|
| Range-filtered KPI dashboard (sales, orders by status, catalog counts, outstanding) | `/admin/dashboard` | server component; today/7d/30d/custom ranges (IST day boundaries) | ✅ |
| Recent orders, top products, low-stock list, recent audit activity | `/admin/dashboard` | same page | ✅ |
| Command Center — 7 intelligence tabs (overview, sales, inventory, credit, retailers, salesmen, suppliers), risk center, action center, smart alerts, charts | `/admin/command-center` (super_admin only) | `lib/admin/command-center/*`, `runCommandCenterSmartAlerts` | ✅ |
| AI demand forecasting (7/30-day, stock-out risk, reorder qty) | `/admin/inventory/forecast` | `lib/ai/forecast/*`, migration `0019` | ✅ |
| AI Business Copilot (tool-calling, RLS-scoped) | `/admin/ai` | `lib/ai/*` | ✅ |
| Super-admin Control Center (user management, access periods, feature flags, maintenance mode, own audit log) | `/admin/control-center`, `/admin/control-center/users/[id]` | `lib/admin/control-center/*`, migration `0020` | ✅ |

**Retailer management (approval / KYC / credit / assignment)**

| Feature | Route / action | Exists |
|---|---|---|
| Retailer list + **pending-approval queue section** | `/admin/retailers` | ✅ |
| Approve / suspend / reject / reactivate retailer | `approveRetailerAction`, `suspendRetailerAction`, `rejectRetailerAction`, `reactivateRetailerAction` (`lib/admin/retailers-actions.ts`) | ✅ |
| KYC documents (private bucket, signed URLs, add/delete) | `retailer_documents` (migration `0006`), `components/admin/retailer-documents-manager.tsx` | ✅ |
| Credit limit + overdue limit management (reason-required, audited) | `setCreditLimitAction` (`lib/admin/wallet-actions.ts`) | ✅ |
| Wallet payment recording (cash/bank/UPI/cheque), adjustments, reversal | `recordPaymentAction`, `recordAdjustmentAction`, `reverseTransactionAction` | ✅ |
| Salesman assignment / area reassignment | `assignSalesmanToRetailerAction`, `reassignRetailerAreaAction` | ✅ |
| Wallets list + retailer ledger detail | `/admin/wallets`, `/admin/wallets/[id]` | ✅ |

**Staff & salesman management**

| Feature | Route / action | Exists |
|---|---|---|
| Team list (staff + salesmen), create (super_admin only), edit, toggle active | `/admin/team`, `/admin/team/new`, `/admin/team/[id]`; `createStaffAction`, `updateStaffAction`, `toggleStaffActiveAction` | ✅ |
| Area / warehouse assignment per staff | `staff_assignments` (migration `0001`, RLS `0013`) — written by team actions | ✅ (data model only — **not enforced on orders/inventory reads**, see §3) |
| Attendance view (per-day, all users) | `/admin/attendance` | ✅ view only |
| Visits view (per-day) | `/admin/visits` | ✅ view only |
| Salesman intelligence (performance) | Command Center `salesmen` tab (super_admin only) | ✅ partial |
| Targets, commission/incentive tracking, staff performance page | — | ❌ none |

**Products / SKU / barcode / batch / expiry / inventory**

| Feature | Route / action | Exists |
|---|---|---|
| Product CRUD, activation, delete (admin+) | `/admin/products`, `/admin/products/new`, `/admin/products/[id]` | ✅ |
| Product packs (variants), case/loose tier pricing, pack images, duplicate/reorder | `savePackPricingAction` etc. | ✅ |
| Barcode field (product + pack) — display/record only, **no scanning, no label printing** | `products.barcode`, `product_packs.barcode` | ✅ field |
| SKU code optional (`0023`) | `pack_sku_code` | ✅ |
| Categories & brands CRUD | `/admin/catalog/**` | ✅ |
| Live inventory per warehouse, recent movements, manual adjustment, thresholds | `/admin/inventory` | ✅ |
| Movements ledger | `/admin/inventory/movements` | ✅ |
| GRN (draft → confirm → cancel) | `/admin/inventory/grn/**`, `lib/admin/grn-actions.ts` | ✅ |
| Batches + expiry report (FEFO) | `/admin/inventory/batches`, `/admin/inventory/expiry` | ✅ |
| Low stock + forecast | `/admin/inventory/low-stock`, `/admin/inventory/forecast` | ✅ |
| Stock transfers between warehouses (create/execute/cancel) | `/admin/inventory/transfers`, `lib/admin/transfer-actions.ts` | ✅ |
| Inventory reports + expiry-window settings | `/admin/inventory/reports`, `/admin/inventory/settings` (`updateInventorySettingsAction`) | ✅ |
| Batch loss recording | `recordBatchLossAction` | ✅ |
| **Area-level stock view** | — | ❌ none (only per-warehouse) |

**Pricing & schemes**

| Feature | Route / action | Exists |
|---|---|---|
| Price lists scoped base / area / retailer, priority, activate/deactivate | `/admin/pricing`, `lib/admin/pricing-actions.ts` | ✅ |
| Effective-price preview | `previewEffectivePriceAction` | ✅ |
| Case + loose-piece tier pricing engine | `lib/retailer/case-pricing.ts`, `retailer-pricing.ts` | ✅ |
| **Scheme / festival scheme management UI** | — | ❌ **no UI at all** (`schemes` table + RLS exist since `0001`/`0013`; retailer app and AI read it, but nothing in the admin can create or edit a scheme; `createPriceListAction` deliberately blocks `scheme`/`festival` scopes) |

**Order lifecycle**

| Feature | Route / action | Exists |
|---|---|---|
| Orders list (search by number, status filter, pagination) | `/admin/orders` | ✅ |
| Order detail + items + status history | `/admin/orders/[id]` | ✅ |
| Assign warehouse (pending only) | `assignWarehouseAction` | ✅ |
| Approve order (atomic FEFO reservation via `reserve_order_stock`) | `approveOrderAction` | ✅ |
| Advance status processing → packed | `updateOrderStatusAction` | ⚠️ exists but **accepts any status — no server-side transition validation** (see §3) |
| Dispatch (consume stock via `consume_order_stock`, low-stock alerts) | `dispatchOrderAction` (`lib/staff/dispatch-actions.ts`) — staff+ | ✅ |
| Cancel (DB-triggered reservation release + wallet ORDER_REVERSAL) | `cancelOrderAction` | ✅ |
| Mark delivered (salesman: own/assigned retailers; note appended to `orders.notes`) | `markDeliveredAction` (`lib/salesman/orders-actions.ts`) | ✅ minimal |
| Returns: approve (stock back to batches) / reject | `/admin/returns`, `lib/admin/returns-actions.ts` | ✅ (note: approving a return does **not** set `orders.status='returned'` — order stays `delivered`) |
| Delivered-orders module, delivery assignment, OTP, proof, partial delivery, failed delivery, return-to-warehouse | — | ❌ none |

**Reports / CSV / print / notifications / audit**

| Feature | Route | Exists |
|---|---|---|
| Sales reports: retailer-wise, area-wise, product-wise, salesman-wise (date range) | `/admin/reports` | ✅ |
| Inventory reports | `/admin/inventory/reports` | ✅ |
| Retailer statement CSV | `app/retailer/reports/statement/route.ts` (retailer-facing only) | ✅ |
| **Admin CSV / Excel export** | — | ❌ none |
| **Admin print views** | — | ❌ none (only a retailer `print-button` component exists) |
| Notification log viewer | `/admin/notifications` | ✅ |
| **Admin notification composer / broadcast** | — | ❌ none (`createInAppNotification` exists as a library fn only) |
| Audit log viewer (all tables, sensitive-key redaction) | `/admin/audit-logs` | ✅ |
| Banners CRUD | `/admin/banners/**` | ✅ |
| Areas / warehouses / routes CRUD | `/admin/areas/**`, `/admin/warehouses/**`, `/admin/routes/**` | ✅ |

### 2.4 Staff (warehouse) — `app/staff/**`

| Feature | Route / action | Exists |
|---|---|---|
| Staff dashboard (orders today, pending, dispatch queue, dispatched today) | `/staff/dashboard` | ✅ |
| Staff orders list + order detail with "Items to pack" pick list | `/staff/orders`, `/staff/orders/[id]` | ✅ |
| Dispatch order | `dispatchOrderAction` (permission `orders.dispatch`) | ✅ |
| Staff inventory (live stock + ledger) | `/staff/inventory`, `/staff/inventory/ledger` | ✅ |
| Warehouse Copilot (AI) | `/staff/ai` | ✅ |
| **Pick/pack status actions (processing → packed)** | — | ❌ staff cannot advance pick/pack states (only the admin panel can) |
| **Assigned deliveries / delivery execution** | — | ❌ none |
| Staff shell nav: Dashboard, AI, Inventory, Orders | `components/layout/staff-shell.tsx` | ✅ |

### 2.5 Salesman (Sales Executive) — `app/salesman/**`

| Feature | Route / action | Exists |
|---|---|---|
| Dashboard (assigned retailers, orders collected today, visits, order value, awaiting-delivery count) | `/salesman/dashboard` | ✅ |
| Assigned retailers list + detail (unassigned → 404, RLS + app filter) | `/salesman/retailers/[id]` | ✅ |
| Visit check-in / check-out with geolocation, skip visit | `checkInVisitAction`, `checkOutVisitAction`, `skipVisitAction` | ✅ |
| Route plan view + stop reorder (own routes) | `/salesman/routes`, `reorderRouteStopAction` | ✅ |
| Retailer order creation (pack + pieces quantities, server-priced) | `/salesman/orders/new`, `createSalesmanOrderAction` → `createOrderForRetailer` | ✅ |
| Own orders list + detail; mark delivered (dispatched only, own/assigned) | `/salesman/orders/[id]`, `markDeliveredAction` | ✅ |
| Attendance punch in/out with geolocation (IST work-date) | `lib/salesman/attendance-actions.ts` | ✅ |
| Daily call report (attendance, visits, orders per date) | `/salesman/dcr` | ✅ |
| **Payment collection + proof upload** | — | ❌ none (`lib/salesman` has zero payment code) |
| **Sales/collection targets, commission/incentive tracking** | — | ❌ none |
| **Follow-up reminders** | — | ❌ none |
| Offline-safe drafts | — | ❌ **no offline/draft infrastructure exists anywhere in the app** (no localStorage/draft code in the order builder) → per the "where already compatible" rule, this stays out of scope; documented, not built |

### 2.6 Retailer (context — required delivered route only)

Exists today: order list/detail with status timeline, invoice page, reorder page, return requests
(delivered orders only), checkout with address-book selection and `shipping_address` snapshot,
ledger + statement CSV. Missing: **`/retailer/orders/[orderId]/delivery`** (delivery details +
proof + return window + reorder) — required by the delivered module. No other retailer
convenience features will be added.

---

## 3. Missing features — consolidated gap list (what Phases 2–5 will build)

1. **Order state machine** — `updateOrderStatusAction` performs no transition validation
   (any status → any status with `orders.approve`). The UI encodes `confirmed→processing→packed`
   but the server does not. No DB-level guard either.
2. **Delivered module (all 5 routes)** — `/admin/delivered`, `/admin/delivered/[orderId]`,
   `/staff/deliveries`, `/staff/deliveries/[orderId]`, `/retailer/orders/[orderId]/delivery` do
   not exist.
3. **Delivery data model** — no delivery staff assignment, no delivery OTP, no receiver name at
   delivery (only address-book receiver at order time), no signature/photo proof, no
   ordered/delivered/missing/damaged quantity records, no delivery-notes field (today's note is
   appended to `orders.notes`), no return window, no failed-delivery / partial-delivery /
   return-to-warehouse states.
4. **Staff assignment enforcement** — `staff_assignments` rows exist but staff RLS is global
   (`is_staff_or_above()` on orders/inventory). Requirement: staff limited to assigned
   areas/warehouses → needs scoped RLS + a guaranteed-assignment rule in team management.
5. **Staff pick/pack workflow actions** (processing → packed from the staff console).
6. **Area stock operations** — no area-level stock aggregation view.
7. **Scheme management UI** — no admin CRUD for `schemes` (table + RLS already exist).
8. **Salesman payment collection with proof** — none; must write through the existing wallet
   ledger (`PAYMENT_CREDIT`) and support photo proof (new private bucket).
9. **Targets / commissions / incentives** — no tables, no UI.
10. **Follow-up reminders** — none.
11. **Staff performance & attendance analytics pages** (admin) — only Command Center's salesman
    tab (super_admin) exists.
12. **Admin CSV export and print** — none (single retailer-facing CSV route exists).
13. **Admin notification composer / broadcast** — none.
14. **Unified approval queues** — retailer approvals and returns live on their own pages; no
    queues for payment-proof verification or delivery-proof review.
15. **Test coverage for actions/permissions/RLS** — the 673 tests are pure-function tests; there
    are no tests for server-action permission guards or status transitions (to be added as
    unit-testable guards + pure state-machine module, since no test DB harness exists).
16. **Barcode/label support** — barcode is a stored field only; no label export/print.

---

## 4. Feature matrix

Legend — **Existing**: implemented and verified in code today. **New**: to be built in Phases 2–5.
Migration numbers for New items follow the phase-ordered plan in §5. RLS names for New
items are planned policy names. Test column lists the planned test file (`tests/…`) or existing
coverage. "—" means not applicable.

### 4.1 Admin — dashboard & analytics

| # | Feature | Existing/New | Role | Route | Server action | Migration | RLS policy | Test |
|---|---|---|---|---|---|---|---|---|
| 1 | KPI dashboard w/ date ranges | Existing | admin+ | `/admin/dashboard` | — | 0001 | orders_select | dashboard-upgrade.test.ts |
| 2 | Command Center (7 tabs, risk, alerts) | Existing | super_admin | `/admin/command-center` | runCommandCenterSmartAlerts | 0019/0020 | staff+ RLS | command-center.test.ts |
| 3 | AI demand forecast | Existing | admin+ | `/admin/inventory/forecast` | — | 0019 | inventory_staff | forecast.test.ts |
| 4 | Delivered-order analytics (delivery TAT, partial/failed rate, on-time %) | New | admin+ | `/admin/delivered` | — (server component) | 0043 (tables) | order_deliveries_admin_read | delivered-analytics.test.ts |
| 5 | Staff performance dashboard (orders, collections, target attainment, attendance %) | New | admin+ | `/admin/team/performance` | — (server component) | 0038 (targets) | staff_targets_admin_read | staff-performance.test.ts |
| 6 | Area-wise stock & sales overview | New | admin+ | `/admin/areas/[id]` (stock tab) | — | 0041 (view) | view over inventory_stock RLS | area-stock.test.ts |

### 4.2 Admin — retailer approval, KYC, credit, assignment

| # | Feature | Existing/New | Role | Route | Server action | Migration | RLS policy | Test |
|---|---|---|---|---|---|---|---|---|
| 7 | Retailer approval queue + approve/suspend/reject/reactivate | Existing | admin+ | `/admin/retailers` | approveRetailerAction etc. | 0001 | retailers_admin_update | — (Phase 5 adds) |
| 8 | KYC document upload/view/delete (private bucket) | Existing | admin+ | `/admin/retailers/[id]` | addRetailerDocumentAction | 0006 | retailer_documents (0013) | wallet-gallery-verification.test.ts (bucket) |
| 9 | Credit limit + overdue management | Existing | admin+ | `/admin/wallets/[id]` | setCreditLimitAction | 0029–0031 | wallet RPC guards (0030) | wallet-ledger.test.ts |
| 10 | Wallet payments / adjustments / reversals | Existing | admin+ | `/admin/wallets/[id]` | recordPaymentAction etc. | 0029–0031 | retailer_wallet_ledger policies | wallet-ledger.test.ts |
| 11 | Salesman/area assignment | Existing | admin+ | `/admin/retailers/[id]` | assignSalesmanToRetailerAction | 0001/0014 | retailers_admin_update | — |
| 12 | Payment-collection verification queue (proof review → verify/reject) | New | admin+ | `/admin/collections` | verifyCollectionAction, rejectCollectionAction | 0044 | payment_collections_admin_update | payment-collections.test.ts |

### 4.3 Admin — staff & sales-executive management

| # | Feature | Existing/New | Role | Route | Server action | Migration | RLS policy | Test |
|---|---|---|---|---|---|---|---|---|
| 13 | Team CRUD + activation | Existing | super_admin (create), admin (edit) | `/admin/team/**` | createStaffAction etc. | 0001/0013 | staff_assignments_admin_write | — |
| 14 | Area/warehouse assignment per staff | Existing | admin+ | `/admin/team/[id]` | updateStaffAction | 0001/0013 | staff_assignments policies | — |
| 15 | Assignment-scoped staff access (orders/retailers/inventory by area or warehouse) | New | staff | — (RLS-level) | — | 0037 | orders_staff_assigned_read (replaces global staff branch) | staff-scope-rls.test.ts (guard predicates) |
| 16 | Attendance view | Existing | admin+ | `/admin/attendance` | — | 0001 | attendance_owner_or_staff | — |
| 17 | Attendance analytics (monthly summary, %, late count) | New | admin+ | `/admin/attendance` (summary mode) | — | — (aggregation) | attendance_owner_or_staff | attendance-analytics.test.ts |
| 18 | Targets: set monthly sales/collection/order/visit/new-retailer targets per staff | New | admin+ | `/admin/team/[id]` (targets) + `/admin/targets` | setStaffTargetAction, deactivateStaffTargetAction | 0038 | staff_targets_admin_write, staff_targets_self_read | staff-targets.test.ts |
| 19 | Target attainment report (actual vs target per period) | New | admin+ | `/admin/targets` | — | 0038 | staff_targets_admin_read | staff-targets.test.ts |
| 20 | Commission rules + generated commission records (draft → approved → paid) | New | admin+ | `/admin/commissions` | approveCommissionAction, markCommissionPaidAction | 0038 | staff_commissions policies | commissions.test.ts |
| 21 | Staff performance page (per-staff orders, sales, collections, visits, targets) | New | admin+ | `/admin/team/[id]` (performance) / `/admin/team/performance` | — | 0044/0038 | read via existing + new policies | staff-performance.test.ts |
| 22 | Visits view | Existing | admin+ | `/admin/visits` | — | 0001 | visits_owner_or_staff | — |
| 23 | Follow-up oversight (all open follow-ups, overdue list) | New | admin+ | `/admin/follow-ups` | — | 0039 | follow_ups_admin_read | follow-ups.test.ts |

### 4.4 Admin — products, SKU, barcode, batch, expiry, inventory

| # | Feature | Existing/New | Role | Route | Server action | Migration | RLS policy | Test |
|---|---|---|---|---|---|---|---|---|
| 24 | Product CRUD + packs + images | Existing | staff+ (delete: admin+) | `/admin/products/**` | products-actions (20 actions) | 0001–0028 | products_* | production-readiness.test.ts (parts) |
| 25 | Case/loose tier pricing editor | Existing | admin+ | `/admin/products/[id]` | savePackPricingAction | 0022/0026 | product_pricing_tiers | case-pricing.test.ts |
| 26 | Barcode field (product/pack) | Existing (field) | staff+ | `/admin/products/[id]` | — | 0004 | products_* | — |
| 27 | Barcode/SKU label data export (CSV per product/pack for label printing) | New | admin+ | `/admin/reports/barcodes` (route handler) | — | — | products_* | barcode-export.test.ts |
| 28 | Batches + expiry report (FEFO) | Existing | staff+ | `/admin/inventory/batches`, `/expiry` | — | 0017 | inventory_batches_staff_read | — |
| 29 | GRN draft→confirm→cancel | Existing | staff+ | `/admin/inventory/grn/**` | grn-actions | 0017 | grns_staff_read | — |
| 30 | Stock transfers | Existing | staff+ | `/admin/inventory/transfers` | transfer-actions | 0017 | stock_transfers RLS | — |
| 31 | Manual stock adjustment + thresholds + settings | Existing | staff+ / admin+ | `/admin/inventory` | inventory-actions | 0001/0017 | stock_movements_staff_write | — |
| 32 | Batch loss recording | Existing | staff+ | `/admin/inventory/batches` | recordBatchLossAction | 0017 | inventory_batches | — |
| 33 | Inventory CSV export (stock, movements, expiry) | New | admin+ | `/admin/inventory/reports` (route handlers) | — | — | inventory_staff | csv-export.test.ts |

### 4.5 Admin & staff — warehouse / area stock operations

| # | Feature | Existing/New | Role | Route | Server action | Migration | RLS policy | Test |
|---|---|---|---|---|---|---|---|---|
| 34 | Warehouses CRUD | Existing | admin+ | `/admin/warehouses/**` | master-data-actions | 0001 | warehouses RLS | — |
| 35 | Live per-warehouse stock | Existing | staff+ | `/admin/inventory`, `/staff/inventory` | — | 0001 | inventory_staff | — |
| 36 | Staff pick/pack actions (processing → packed, warehouse-assigned only) | New | staff | `/staff/orders/[id]` | markProcessingAction, markPackedAction | — (state machine 0042) | orders_staff_assigned_update | order-state-machine.test.ts |
| 37 | Area stock view (aggregate stock by area via warehouse→area) | New | admin+ | `/admin/areas/[id]` | — | 0041 (view `inventory_area_totals`) | security_invoker view over inventory RLS | area-stock.test.ts |
| 38 | Area stock transfer visibility (transfers filtered by area) | New | admin+ | `/admin/inventory/transfers?area=` | — | — | stock_transfers RLS | area-stock.test.ts |
| 39 | Dispatch with delivery-task creation + delivery assignment | New | staff+ | `/staff/orders/[id]` | dispatchOrderAction (extended) | 0043 | order_deliveries policies | deliveries-workflow.test.ts |

### 4.6 Admin — pricing & schemes

| # | Feature | Existing/New | Role | Route | Server action | Migration | RLS policy | Test |
|---|---|---|---|---|---|---|---|---|
| 40 | Price lists base/area/retailer + preview | Existing | admin+ | `/admin/pricing` | pricing-actions | 0001 | price_lists_* | pricing-reconciliation.test.ts (engine) |
| 41 | Scheme CRUD (create/edit/deactivate, festival flag, validity window) | New | admin+ | `/admin/pricing/schemes` | createSchemeAction, updateSchemeAction, toggleSchemeAction | — (table+RLS exist since 0001/0013; add audit trigger) | schemes_read/_staff_insert/_staff_update/_admin_delete (exist) | schemes.test.ts |
| 42 | Scheme-scoped price lists (link price rows to a scheme) | New | admin+ | `/admin/pricing` (scheme scope enabled) | createPriceListAction (scope extended) | — | price_lists_admin | schemes.test.ts |

### 4.7 Admin — order lifecycle

| # | Feature | Existing/New | Role | Route | Server action | Migration | RLS policy | Test |
|---|---|---|---|---|---|---|---|---|
| 43 | Orders list/detail/status history | Existing | admin+ | `/admin/orders/**` | — | 0001/0008 | orders_select, order_status_history_retailer_read | — |
| 44 | Assign warehouse / approve (reserve) / cancel | Existing | staff+ | `/admin/orders/[id]` | orders-actions | 0009/0017 | orders_update_staff | — |
| 45 | Validated status transitions (state machine: server + DB trigger) | New | all staff+ paths | — | shared `lib/orders/state-machine.ts` used by every status action | 0042 (BEFORE UPDATE trigger `enforce_order_status_transitions`) | DB-level | order-state-machine.test.ts |
| 46 | Failed-delivery flow (record reason, order → processing for re-attempt or cancel) | New | staff+/admin | `/staff/deliveries/[orderId]`, `/admin/delivered/[orderId]` | recordFailedDeliveryAction | 0042/0043 | order_deliveries_staff_assigned_update | deliveries-workflow.test.ts |
| 47 | Return-to-warehouse flow (undeliverable → stock back via `return_order_stock`, order status) | New | staff+ | `/staff/deliveries/[orderId]` | recordReturnToWarehouseAction | 0042/0043 | order_deliveries + orders_update_staff | deliveries-workflow.test.ts |
| 48 | Partial delivery (per-line delivered/missing/damaged qty, price-adjusted settlement) | New | staff+ | `/staff/deliveries/[orderId]` | completeDeliveryAction (partial mode) | 0043 | order_delivery_items policies | deliveries-workflow.test.ts |
| 49 | Return window (configurable days, computed deadline, blocks returns after window) | New | admin+ sets, all read | `/admin/delivered/[orderId]`, `/retailer/orders/[id]/delivery` | setReturnWindowAction (platform setting) | 0043 (deadline column) + setting | read via delivered policies | return-window.test.ts |

### 4.8 Admin — payments, collections, credit, ledger reports

| # | Feature | Existing/New | Role | Route | Server action | Migration | RLS policy | Test |
|---|---|---|---|---|---|---|---|---|
| 50 | Wallet/ledger list + detail | Existing | admin+ | `/admin/wallets/**` | — | 0029–0031 | retailer_wallet_ledger policies | wallet-ledger.test.ts |
| 51 | Outstanding/overdue/credit overview | Existing | admin+ | `/admin/wallets`, Command Center credit tab | — | 0029–0031 | same | command-center.test.ts |
| 52 | Collection report (collected by salesman/period, method split, verified vs pending) | New | admin+ | `/admin/collections` (report tab) | — | 0044 | payment_collections_admin_read | collections-report.test.ts |
| 53 | Ledger report w/ CSV export | New | admin+ | `/admin/wallets/[id]` (export) | — | — | retailer_wallet_ledger | csv-export.test.ts |
| 54 | Invoice + payment status on delivered orders | New (view; data exists) | admin+ | `/admin/delivered/[orderId]` | — | — | joins orders + wallet | delivered-module.test.ts |

### 4.9 Admin — reports, CSV/print

| # | Feature | Existing/New | Role | Route | Server action | Migration | RLS policy | Test |
|---|---|---|---|---|---|---|---|---|
| 55 | Sales reports (retailer/area/product/salesman) | Existing | admin+ | `/admin/reports` | — | 0001 | orders_select | — |
| 56 | CSV export: sales, orders, inventory, collections, delivered, targets, commissions | New | admin+ | `/admin/reports/*.csv` (route handlers, `text/csv`) | — | — | per-table RLS | csv-export.test.ts |
| 57 | Print views: order, delivery slip/challan, delivered proof, statement | New | admin+ | `/admin/orders/[id]/print`, `/admin/delivered/[orderId]` (print CSS) | — | — | per-table RLS | print-views.test.ts (render guards) |

### 4.10 Admin — notifications & approval queues

| # | Feature | Existing/New | Role | Route | Server action | Migration | RLS policy | Test |
|---|---|---|---|---|---|---|---|---|
| 58 | Notification log viewer | Existing | admin+ | `/admin/notifications` | — | 0001/0013 | notification_logs_owner_or_staff_read | — |
| 59 | In-app notification composer (roles/areas/retailer selection) | New | admin+ | `/admin/notifications` (composer) | broadcastNotificationAction | — | notifications_owner (insert via staff+ policy) | notifications.test.ts |
| 60 | Approval queue: retailer approvals | Existing | admin+ | `/admin/retailers` (pending section) | — | 0001 | — | — |
| 61 | Approval queue: return requests | Existing | staff+ | `/admin/returns` | approveReturnAction | 0009 | return_requests_staff_update | — |
| 62 | Approval queue: payment-collection verification | New | admin+ | `/admin/collections` (queue) | verifyCollectionAction | 0044 | payment_collections_admin_update | payment-collections.test.ts |
| 63 | Approval queue: delivery-proof review (missing OTP/proof flags) | New | admin+ | `/admin/delivered` (review filter) | — | 0043 | order_deliveries_admin_read | delivered-module.test.ts |

### 4.11 Admin — audit logs

| # | Feature | Existing/New | Role | Route | Server action | Migration | RLS policy | Test |
|---|---|---|---|---|---|---|---|---|
| 64 | Audit log viewer (trigger-based, redaction) | Existing | admin+ | `/admin/audit-logs` | — | 0001/0013 | audit via log_audit() security definer | — |
| 65 | Explicit semantic audit entries for status, delivery assignment, payment, delivery-proof changes | New | system | — | helper `recordAuditEvent()` used by new actions | 0037–0045 (triggers reuse `log_audit`) | audit_logs inserts | audit-events.test.ts |

### 4.12 Staff — warehouse ops

| # | Feature | Existing/New | Role | Route | Server action | Migration | RLS policy | Test |
|---|---|---|---|---|---|---|---|---|
| 66 | Dashboard counts | Existing | staff | `/staff/dashboard` | — | 0001 | orders_select | — |
| 67 | Pick list + dispatch | Existing | staff | `/staff/orders/[id]` | dispatchOrderAction | 0009/0017 | orders_update_staff | — |
| 68 | Pick/pack status actions | New | staff | `/staff/orders/[id]` | markProcessingAction, markPackedAction | 0042 | orders_staff_assigned_update | order-state-machine.test.ts |
| 69 | Assigned-deliveries work queue | New | staff (delivery role) | `/staff/deliveries` | — | 0043 | order_deliveries_staff_assigned_read | deliveries-workflow.test.ts |
| 70 | Delivery execution detail | New | staff | `/staff/deliveries/[orderId]` | completeDeliveryAction etc. | 0043 | order_deliveries_staff_assigned_update | deliveries-workflow.test.ts |

### 4.13 Delivery staff workflow (state machine for the delivery itself)

| # | Feature | Existing/New | Role | Route | Server action | Migration | RLS policy | Test |
|---|---|---|---|---|---|---|---|---|
| 71 | Delivery assignment (staff/salesman, assigned at dispatch, reassignable by admin) | New | admin/staff | `/admin/orders/[id]`, `/staff/deliveries` | assignDeliveryStaffAction, reassignDeliveryStaffAction | 0043 | order_deliveries_admin_update + audit | deliveries-workflow.test.ts |
| 72 | Delivery OTP generation (hashed, at dispatch) + verification | New | system/staff | — / `/staff/deliveries/[orderId]` | generateDeliveryOtp (RPC), verifyDeliveryOtpAction | 0043 | order_deliveries policies | delivery-otp.test.ts |
| 73 | Receiver name capture at delivery | New | staff | `/staff/deliveries/[orderId]` | completeDeliveryAction | 0043 | order_deliveries_staff_assigned_update | deliveries-workflow.test.ts |
| 74 | Signature proof upload (image, private bucket, signed URLs) | New | staff | `/staff/deliveries/[orderId]` | uploadDeliveryProofAction | 0043 + 0043 (bucket) | storage delivery-proofs policies | delivery-proof-upload.test.ts |
| 75 | Photo proof upload (same mechanism) | New | staff | same | same | 0043/0043 | same | delivery-proof-upload.test.ts |
| 76 | Per-line delivered / missing / damaged quantities | New | staff | same | completeDeliveryAction | 0043 | order_delivery_items policies | deliveries-workflow.test.ts |
| 77 | Delivery notes (structured field, not appended text) | New | staff | same | completeDeliveryAction | 0043 | order_deliveries policies | deliveries-workflow.test.ts |
| 78 | Dispatch + delivery timestamps display | Existing (data) / New (module UI) | all | delivered routes | — | 0009 | orders_select | delivered-module.test.ts |
| 79 | Failed delivery with reason | New | staff | same | recordFailedDeliveryAction | 0042/0043 | order_deliveries | deliveries-workflow.test.ts |
| 80 | Return-to-warehouse (stock back to batches) | New | staff | same | recordReturnToWarehouseAction | 0042/0043 | order_deliveries + return_order_stock | deliveries-workflow.test.ts |
| 81 | Retailer read-only delivery view + reorder action | New | retailer | `/retailer/orders/[orderId]/delivery` | reorder (exists: cart-merge path) | — | order_deliveries_retailer_read | delivered-module.test.ts |

### 4.14 Sales executive (salesman)

| # | Feature | Existing/New | Role | Route | Server action | Migration | RLS policy | Test |
|---|---|---|---|---|---|---|---|---|
| 82 | Dashboard | Existing | salesman | `/salesman/dashboard` | — | 0001 | — | — |
| 83 | Assigned retailers (RLS-scoped) | Existing | salesman | `/salesman/retailers/**` | — | 0014 | retailers_select + assigned | — |
| 84 | Visit check-in/out + skip (geo) | Existing | salesman | `/salesman/visits`, `/routes` | visits-actions | 0001/0010 | visits_owner_or_staff | — |
| 85 | Order creation for retailer | Existing | salesman | `/salesman/orders/new` | createSalesmanOrderAction | 0014 | orders_insert | business-rules.test.ts (quote path) |
| 86 | Mark delivered (basic) | Existing | salesman | `/salesman/orders/[id]` | markDeliveredAction | 0009 | orders_salesman_update | — |
| 87 | Payment collection (own retailers, through wallet ledger) | New | salesman | `/salesman/retailers/[id]` (collect) | collectPaymentAction | 0044 | payment_collections_salesman_insert + wallet RPC | payment-collections.test.ts |
| 88 | Payment proof upload (photo) | New | salesman | same | uploadPaymentProofAction | 0044 + 0043 | storage payment-proofs policies | payment-collections.test.ts |
| 89 | Own targets view + progress | New | salesman | `/salesman/targets` | — | 0038 | staff_targets_self_read | staff-targets.test.ts |
| 90 | Own commission view | New | salesman | `/salesman/commissions` | — | 0038 | staff_commissions_self_read | commissions.test.ts |
| 91 | Follow-up reminders (create, complete, today view) | New | salesman | `/salesman/follow-ups` | createFollowUpAction, completeFollowUpAction | 0039 | follow_ups policies | follow-ups.test.ts |
| 92 | Salesman delivery queue (assigned deliveries) | New | salesman | `/salesman/deliveries` (mirrors staff module) | same delivery actions | 0043 | order_deliveries_salesman_assigned | deliveries-workflow.test.ts |
| 93 | Offline-safe drafts | **Not built — out of scope** | — | — | no existing offline/draft infrastructure anywhere in the app; per "where already compatible", nothing is compatible | — | — | — |

### 4.15 Delivered module (dedicated admin + staff + retailer)

| # | Feature | Existing/New | Role | Route | Server action | Migration | RLS policy | Test |
|---|---|---|---|---|---|---|---|---|
| 94 | `/admin/delivered` — delivered-orders list (filters: date, area, staff, status incl. partial/failed, payment state; CSV) | New | admin+ | `/admin/delivered` | — | 0043 | order_deliveries_admin_read | delivered-module.test.ts |
| 95 | `/admin/delivered/[orderId]` — full delivery dossier: address snapshot, assigned staff, dispatch/delivery timestamps, receiver, OTP verification record, signature/photo proof, ordered vs delivered vs missing vs damaged qty, notes, invoice & payment status, return window, reorder shortcut | New | admin+ | `/admin/delivered/[orderId]` | — | 0043 | order_deliveries_admin_read | delivered-module.test.ts |
| 96 | `/staff/deliveries` — assigned work queue | New | staff | `/staff/deliveries` | — | 0043 | order_deliveries_staff_assigned_read | deliveries-workflow.test.ts |
| 97 | `/staff/deliveries/[orderId]` — execution screen (OTP, receiver, proofs, quantities, partial/failed/RTO) | New | staff | `/staff/deliveries/[orderId]` | completeDeliveryAction, recordFailedDeliveryAction, recordReturnToWarehouseAction | 0043 | order_deliveries_staff_assigned_update | deliveries-workflow.test.ts |
| 98 | `/retailer/orders/[orderId]/delivery` — read-only delivery details + proof + return window + reorder | New | retailer | `/retailer/orders/[orderId]/delivery` | (reorder via existing cart-merge) | — | order_deliveries_retailer_read | delivered-module.test.ts |
| 99 | Delivery address snapshot on order | Existing | all | orders.shipping_address | — | 0036 | orders_select | — |
| 100 | Invoice view | Existing | retailer (admin has order detail) | `/retailer/orders/[id]/invoice` | — | 0007 | orders_select | — |
| 101 | Reorder action | Existing | retailer | `/retailer/orders/[id]/reorder` | cart merge | 0007 | cart_owner | — |
| 102 | Loading / empty / error / forbidden states on all new pages | New | all | all new routes | — | — | — | delivered-module.test.ts (guards) |

**Matrix totals: 102 numbered rows — 47 Existing, 54 New (1 explicitly out-of-scope).** Counting the
existing sub-features (106 admin server actions, 48 admin pages), the finished admin panel will
expose well over 100 serious operational features.

---

## 5. Planned migrations (all additive & rerunnable)

Every migration follows the repo conventions: `create table if not exists` / `add column if not
exists` / `drop policy if exists` + `create policy` / `drop trigger if exists` + `create trigger`;
zero data inserts; no destructive changes. Policy replacement (drop + recreate) is the established
pattern in this repo (see 0013, 0014) and is rerunnable by design.

| Migration | Phase | Contents |
|---|---|---|
| `0037_staff_scope_policies.sql` | 2 | SECURITY DEFINER helpers (`is_area_assigned_to_current_staff`, `is_warehouse_assigned_to_current_staff`, `is_retailer_area_assigned_to_current_staff`) + assignment-scoped staff policies for `orders`, `order_items`, `retailers`, `profiles` (retailer rows only), `inventory_stock`, `stock_movements`, `inventory_batches`, `grns`, `grn_items`, `stock_transfers`, `return_requests`. Admin/super_admin and salesman branches preserved unchanged. A staff member with no assignment row sees nothing (confirmed decision D1). |
| `0038_staff_targets_commissions.sql` | 2 | `staff_targets` (user, period, metric, target_value, is_active) and `staff_commissions` (user, period, basis, rate, computed amount in paise, status draft/approved/paid) + RLS (admin manage, owner read) + audit triggers. |
| `0039_follow_ups.sql` | 2 | `follow_ups` (retailer, owner salesman, due_date, note, status open/done/cancelled, optional visit/order link) + RLS (salesman owner CRUD on assigned retailers, admin read) + audit trigger. |
| `0040_schemes_audit.sql` | 2 | Audit trigger for `schemes` (table + RLS already exist). |
| `0041_area_stock_view.sql` | 3 | `inventory_area_totals` view (join `inventory_stock` → `warehouses` → `areas`) with `security_invoker = true`. |
| `0042_order_state_machine.sql` | 4 | BEFORE UPDATE trigger `enforce_order_status_transitions` on `orders` validating OLD.status → NEW.status (retailer self-cancel pending→cancelled preserved; failed-delivery auto-reopen dispatched→processing per decision D3). No column changes. |
| `0043_deliveries_module.sql` | 4 | `order_deliveries` (delivery_status enum assigned/in_progress/delivered/partially_delivered/failed/returned_to_warehouse, assigned_staff_id (staff or salesman per D2), timestamps, receiver_name, otp_hash, otp_verified_at, signature_url, photo_url, delivery_notes, failure_reason, return_window_days, return_deadline, completed_by) + `order_delivery_items` (per order_item: ordered/delivered/missing/damaged quantities) + RLS (admin all; staff assigned; salesman assigned retailer/collected_by; retailer read own) + audit triggers. Partial delivery settles by wallet credit-back per D4. |
| `0044_payment_collections.sql` | 4 | `payment_collections` (retailer, optional order, amount paise, method, reference, proof_url, collected_by, status pending/verified/rejected, ledger link) + RLS + audit trigger; verified collections write a `PAYMENT_CREDIT` row through the existing wallet ledger. |
| `0045_delivery_proof_buckets.sql` | 4 | Private storage buckets `delivery-proofs`, `payment-proofs` + storage RLS policies (pattern of 0003/0016/0021) + `MEDIA_KINDS` additions (app code). |

No service-role keys are introduced anywhere; all new actions use the cookie-bound client and are
guarded by `requirePermission` + RLS.

## 6. Planned order state machine (Phase 4)

```
pending ──approve──▶ confirmed ──▶ processing ──▶ packed ──dispatch──▶ dispatched
   │                    │             │             │                     │
   │ (retailer self-    │             └── cancel (pre-dispatch) ─────────┤
   │  cancel allowed)   └───────────────────────────────────────────────┤
   ▼                                                                    ▼
cancelled ◀──────────────────────────────────────── (cancel w/ release) delivered
                                                                            │
                                             return approve (existing) ─────┤
                                                                            ▼
                                                                        delivered*
                          delivered ──(failed delivery)──▶ processing (re-attempt) or cancelled
                          delivered ──(return-to-warehouse)──▶ returned
```

Rules to encode in `lib/orders/state-machine.ts` (pure, unit-tested) **and** the DB trigger:

- `pending → confirmed` requires warehouse assigned (already enforced in action).
- `cancelled` reachable only from pre-dispatch states (+ retailer self-cancel `pending → cancelled`
  via the existing `orders_retailer_cancel` policy).
- `dispatched → delivered | partially_delivered` only via a completed delivery record with OTP
  verification; `dispatched → processing` only via failed-delivery with reason; `dispatched →
  returned` only via return-to-warehouse.
- Existing `returned` status becomes reachable (today nothing ever sets it — return approval keeps
  the order `delivered`; the state machine will set `returned` only for full return-to-warehouse,
  keeping per-item returns as today).
- Same-status updates are no-ops (allowed).

## 7. RLS design for new tables (summary)

- **admin/super_admin**: full CRUD on all new tables (`is_admin_or_above()`).
- **staff**: reads/writes scoped to `order_deliveries.assigned_staff_id = auth.uid()` and to
  orders whose `warehouse_id`/retailer `area_id` is in the caller's `staff_assignments`.
- **salesman**: scoped to own collected orders and retailers assigned via
  `retailers.assigned_salesman_id` (reuse `is_retailer_assigned_to_current_salesman` from 0014).
- **retailer**: read-only on their own deliveries/collections; **no insert/update/delete** on
  `order_deliveries`, `order_delivery_items`, `payment_collections`, `staff_targets`,
  `staff_commissions`, and no update path on `orders.status`, payment status, credit or wallet
  (existing wallet RPC guards in 0030 remain the money boundary).

## 8. Phase mapping (no coding before gate approval)

- **Phase 2 — admin core & staff permissions:** migrations 0040, 0042, 0044; scheme CRUD UI;
  targets, commissions, follow-ups; attendance/performance analytics; notification composer;
  approval queues (collections queue UI shell); permission-engine additions
  (`deliveries.view.assigned`, `deliveries.execute`, `collections.record`, `targets.manage`,
  `commissions.manage`, `followups.manage`).
- **Phase 3 — warehouse & inventory:** migration 0041; staff pick/pack actions; area stock view +
  area filters; inventory/barcode CSV exports.
- **Phase 4 — order lifecycle & delivered module:** migrations 0037, 0038, 0039, 0043; state
  machine; delivery assignment + OTP + proofs; partial/failed/RTO flows; all five required
  delivered routes; payment collection + proof upload.
- **Phase 5 — reports, audit logs & final testing:** collection/credit/ledger/delivered reports;
  CSV/print across admin; semantic audit entries verification; full test suite for every action,
  permission and transition; `pnpm typecheck && pnpm lint && pnpm build && pnpm test` all green;
  no auto-merge; PR left open for review.

## 9. Confirmed design decisions (locked before Phase 2)

| # | Decision | Choice |
|---|---|---|
| D1 | Staff assignment scoping | **Tighten now** — staff RLS scoped to `staff_assignments` (areas/warehouses) on orders, retailers, inventory and related tables; a staff member with no assignment sees nothing. Admin/super_admin unchanged. |
| D2 | Delivery executor | **Both staff and salesman** — deliveries assignable to either role; `/staff/deliveries` for staff, mirrored `/salesman/deliveries` for salesmen. |
| D3 | Failed delivery outcome | **Auto-reopen as `processing`** for re-attempt immediately; admin can still cancel or convert to return-to-warehouse. |
| D4 | Partial delivery settlement | **Credit back to wallet** — invoice settles on delivered quantities; missing/damaged lines credited back through the existing wallet ledger. |
