# Super Admin Command Center

Executive dashboard, intelligence tabs, and AI copilot surface for the `super_admin` role. The feature is read-only: it never writes business data except the smart-alerts notification action, which reuses the existing notification infrastructure.

Route: `/admin/command-center` (server-rendered, `force-dynamic`).

## Authorization (defense in depth)

1. **Middleware** — `middleware.ts` already restricts `/admin/*` to `super_admin` and `admin`.
2. **Page guard** — `app/admin/command-center/page.tsx` calls `requirePermission('command_center.view')`. The permission is granted to `super_admin` only (`lib/permissions/permissions.ts`), so regular admins, staff, salesmen and retailers are redirected to `/unauthorized`.
3. **RLS** — every query runs through the existing cookie-bound Supabase client, so row-level security applies unchanged. No RLS policy was added or modified.
4. **AI tool allowlist** — the eight executive AI tools are registered with `roles: ['super_admin']`, `surfaces: ['admin']`, `actionClass: 'READ'` and zero arguments. `toolsForContext` filters by role, surface and the existing permission inheritance mapping, and `executeBusinessTool` re-checks the allowlist on every call, so no other role can list or execute them.

## Data sources (all existing — no migration required)

| Section | Source |
| --- | --- |
| Business overview (sales, orders, revenue, credit, inventory value, low stock, expiring, dead stock, active counts) | `orders` (non-cancelled basis, matching existing reports), `order_items`, `retailers`, `profiles`, `inventory_product_totals` view, `inventory_expiry_report` view |
| Trends (14-day sales/orders, MoM, AOV, new/returning retailers, credit) | same as above, plus `retailers.approved_at/created_at` |
| Top performers (products, categories, brands, retailers, salesmen) | `order_items` joined to `products` |
| Risk center | forecast pipeline (`lib/ai/forecast`, 150 SKUs / 30 days), expiry view, credit calculator (`lib/orders/credit.ts` `calculateCreditPosition`), 7-day vs 30-day AOV anomaly check, `ai_audit_logs` + `notification_logs` for failed system operations |
| Sales intelligence | `orders` + `order_items` with server-side filters (date ≤ 90-day window, category, brand, product, retailer, salesman) — item-level basis uses `line_total` (product/brand/category filters), order-level basis uses `grand_total` |
| Retailer intelligence | `retailers` + `orders` (order frequency, AOV, last order, 60-day sales, credit utilization, active/inactive/new/high-value/declining tags) |
| Salesman intelligence | `orders.collected_by` + `profiles` (orders, sales, AOV, active-retailer count). Target-attainment columns are not shown because no target data exists. |
| Supplier & purchase intelligence | `grns` + `grn_items` (pending draft GRNs, confirmed 30-day value, per-supplier summary, successive receipt cost changes ≥ 0.5%) |
| Security & audit | `audit_logs` (trigger-populated), `ai_audit_logs`, `notification_logs`, `stock_movements` adjustments |

The forecast pipeline (`runForecastPipeline`) supplies stock-out risk, reorder quantity/window, overstock and dead-stock signals — the same engine rendered by `/admin/inventory/forecast`.

## Smart Alerts (the only write path)

`runCommandCenterSmartAlerts` (`lib/admin/command-center/actions.ts`, `'use server'`) re-checks `command_center.view` for the authenticated user, collects signals (low stock with configured reorder level, expiring batches, over-limit credit via the shared credit calculator, stock-out-critical forecasts, unusual large orders), and writes in-app notifications for active super-admin profiles via the existing `createInAppNotification`.

Deduplication reuses the established technique from `lib/inventory/alerts.ts` and `lib/inventory/forecast-alerts.ts`: the signal identity is encoded in `link_url` (`/admin/command-center/alerts?signal=kind:entityId`) and a signal already present as an unread notification within the 24-hour cooldown window is skipped. At most 15 signals per run.

## AI executive tools

Registered in `lib/ai/tools/super-admin.ts`, read-only, zero-argument, server-side:

`get_command_overview`, `get_business_risks`, `get_credit_risk_report`, `get_executive_action_plan`, `get_audit_activity`, `get_retailer_health_report`, `get_supplier_status`, `get_system_health`.

The copilot on the Command Center reuses the existing `MaharaniAIChat` client and `/api/ai/chat` route with the existing `admin` surface — no new surface, API route, provider wiring or environment variable was introduced. `buildSystemPrompt` adds an executive block for `super_admin` actors that requires labelling answers as VERIFIED database facts / calculated metrics / FORECASTS / recommendations, the recommendation format (reason, expected impact, risk, required approval), and treats all database text (names, notes, references) as UNTRUSTED DATA that is never instructions. Tool outputs are bounded and never include raw jsonb payloads, credentials or phone numbers.

## Honest limitations (no fake data is shown)

- **No payment/collection ledger exists** in the schema: `retailers.outstanding_balance` is only ever read by application code. Payment-trend and strict "overdue" indicators are therefore not computed; the credit section states this explicitly and the copilot tool reports `paymentTrendAvailable: false`. Over-limit and near-limit (≥ 80%) positions are real and reported.
- **No salesman targets** exist, so no attainment percentages are invented.
- **No supplier master table** — `grns.supplier_reference` is free text; the supplier section groups on that reference and says so.
- **No purchase-order due dates**, so "delayed supplier deliveries" are not tracked.
- Dead stock = stocked products with zero sales in the trailing 30 days.
- Charts are dependency-free hand-rolled SVG (the repository has no chart library; `ARCHITECTURE.md` mentions recharts but it is not in `package.json`).

## Files

- `lib/admin/command-center/` — `types.ts`, `compute.ts` (pure, unit-tested), `data.ts` (server-only fetch orchestration with per-section error isolation), `actions.ts` (smart-alerts server action)
- `app/admin/command-center/` — `page.tsx`, `loading.tsx` (skeletons), `error.tsx` (client error boundary)
- `components/command-center/` — tab shell, section components, SVG charts, shared primitives
- `lib/ai/tools/super-admin.ts` — executive tools
- Tests: `tests/command-center.test.ts` (compute, permissions, filters), `tests/super-admin-ai.test.ts` (tool authorization, injection protection, grounded failure)
