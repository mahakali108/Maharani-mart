# Maharani AI Intelligence — Demand Forecasting & Business Copilot

This document describes the demand-forecasting capability added to Maharani
AI for authorized admin/staff users. It extends the existing Maharani AI
business agent (`lib/ai/`) with a transparent, explainable statistical
forecasting engine that reads **real, RLS-authorized business data** — never
fabricated values.

---

## 1. Architecture

```
Role workspace (admin/staff)
  -> POST /api/ai/chat  (authenticated actor + surface guard)
     -> AIProvider abstraction (existing: openai / gemini / openai-compatible)
        -> AI Service / Agent  (lib/ai/agent.ts)
           -> typed, allow-listed tools (lib/ai/tools/)
              -> Demand-forecast tools (lib/ai/tools/forecast.ts)
                 -> Forecast pipeline (lib/ai/forecast/index.ts)
                    -> Data layer (lib/ai/forecast/data.ts)  [RLS-scoped reads]
                       -> Supabase ai_product_demand_daily view + inventory views
                    -> Statistical engine (lib/ai/forecast/engine.ts)
                   -> Insights (lib/ai/forecast/insights.ts)
```

Key boundaries:

- The model receives **no database connection** and cannot run SQL.
- All forecast numbers come from the typed data layer and the pure engine.
- The data layer reads through the caller's cookie-bound Supabase client, so
  Postgres RLS still enforces row-level authorization for every read.
- Nothing in the forecast path performs a write to stock, prices, orders,
  credit, GST, or inventory. Recommendations are advisory.

---

## 2. Forecasting methodology

All calculations live in `lib/ai/forecast/engine.ts`, which is pure,
side-effect-free and unit-tested. It uses a transparent statistical approach
(no large ML dependency), structured so a future ML model can replace it
behind the same `forecastProduct()` interface.

For each eligible product the engine computes:

| Output | Method |
|---|---|
| Average daily rate | total units ÷ history days |
| Recent daily rate | mean of the most recent `safetyDays` |
| Base rate | Holt's **double exponential smoothing** blend with the recent rate |
| Trend direction | **least-squares linear regression** over the dense daily series; recent-vs-earlier % change |
| Seasonality | day-of-week factors when ≥ 7 × `minPerWeekday` period and a strong pattern exists |
| 7/30-day demand | base rate + trend, adjusted by future day-of-week seasonality |
| Stock-out date | available stock ÷ forecast rate, projected forward |
| Reorder quantity | target stock (max stock or demand × window + safety) − available |
| Confidence | bounded 0..1 score from data coverage, activity and stability — **not** from the model, so it stays an honest data-quality signal |

### Data quality labels

Every forecast is labelled so it is never mistaken for an exact fact:

- **`real`** — enough history and stable enough to report a trend.
- **`estimate`** — computed, but derived (e.g. limited history). All 7/30-day
  demand, stock-out and reorder figures are shown as estimates.
- **`insufficient`** — no usable history; the engine reports this instead of
  inventing a number. The fallback is a conservative average, never a
  fabricated prediction.

Confidence labels (`High` / `Medium` / `Low` / `Insufficient`) follow the
bounded score.

---

## 3. Data sources

The demand view `ai_product_demand_daily` (migration 0019) aggregates, in
Postgres:

- **Daily demand** = summed `order_items.quantity` from non-cancelled orders,
  grouped by product and day.
- **Cancellation context** — cancelled units are surfaced separately and
  never added to demand.
- **Return context** — returned units are surfaced separately and never added
  to demand.

It is gated to `is_staff_or_above()`, matching the existing
`inventory_product_totals` / `inventory_expiry_report` views:

- Retailer and salesman sessions get **zero rows** from this view.
- Staff/admin see authorized rows only.

Current stock snapshots come from the existing `inventory_product_totals`
view (available, reserved, on-hand, reorder level, max stock, min stock,
lead time). Expiry data comes from `inventory_expiry_report`.

---

## 4. Forecast output

For every eligible product the engine and the tools report:

- Current available stock
- 7-day expected demand (estimate)
- 30-day expected demand (estimate)
- Demand direction (Rising / Stable / Falling) and % change
- Confidence level and label
- Estimated stock-out date and risk (none/low/medium/high/critical)
- Recommended reorder quantity and reorder window
- Overstock warning (days of cover vs threshold / max stock)
- Dead-stock warning (stock present but weak recent demand)
- A human-readable, data-backed explanation + the exact data period

### Example narrative

> Forecast over 60 day(s): 12 product(s) analysed, average confidence 74%.
> 🔴 3 product(s) may run out of stock. 📦 4 product(s) need a reorder.
> 📈 2 product(s) show rising demand.

Each product card lists its own `Source:` (the data period and row count) and
marks estimates vs verified values.

---

## 5. AI Copilot tools

New typed, READ-only tools are registered for staff/admin surfaces only and
are filtered by existing `reports.view.*` permissions:

| Tool | Purpose |
|---|---|
| `get_demand_forecast` | Explainable 7/30-day demand forecast with risk + reorder quantity |
| `get_reorder_recommendation` | Demand-based reorder quantity; never creates a purchase order |
| `get_inventory_risk` | Current stock-out / overstock / dead-stock / expiry risk picture |

They are **not** registered for retailer or salesman surfaces, so a retailer
cannot request admin-level inventory intelligence. No tool writes to the
database; `actionClass` is always `READ`.

The admin AI quick actions (`app/admin/ai/page.tsx`) now include demand
forecast prompts, and the inventory sub-nav includes a **Forecast** tab
(`/admin/inventory/forecast`).

---

## 6. Security model

- **Role gating**: forecast tools and the dashboard require `reports.view.all`
  (admin/super_admin) or staff with `inventory.view` / `reports.view.*`.
- **RLS**: every read is through the caller's RLS-scoped client. The demand
  view and stock/expiry views gate rows to staff+.
- **No unrestricted DB access**: the AI only gets structured results from
  typed tools; it cannot generate SQL.
- **No secrets**: provider keys, service-role key and signing secrets remain
  server-only and are never exposed to the browser.
- **No AI writes**: stock, prices, credit, orders, GST and inventory are never
  modified by the AI. Reorder recommendations require an existing authorized
  workflow and explicit confirmation before any action.

---

## 7. Business alerts & insights

`lib/inventory/forecast-alerts.ts` produces in-app notifications for admins
from demand-based signals (stock-out risk, reorder-needed, overstock,
dead-stock). It reuses the existing notification infrastructure and the same
`link_url` deduplication + cooldown technique as the existing low-stock
alerts, so signals are not re-notified repeatedly.

`lib/ai/forecast/insights.ts` turns a forecast summary into traceable,
human-readable insights (e.g. "Cooking Oil 1L demand is rising, +18%"),
each carrying the exact data basis.

---

## 8. Fallback / error handling

- If the AI provider is unavailable, `runMaharaniAgent` yields
  `"Maharani AI is temporarily unavailable."` and the normal dashboard
  analytics continue to work.
- If forecast data is insufficient, the engine reports `insufficient` /
  a conservative estimate and the tools return a clear notice — never a
  fabricated number.
- If the analytics view is missing or a DB read fails, the tool returns a
  graceful "could not be computed" message without throwing.

---

## 9. Migration

Apply `supabase/migrations/0019_ai_demand_forecast.sql`. It is purely
additive and idempotent:

- Creates the `ai_product_demand_daily` **view** (RLS-gated, staff+ only).
- Creates the optional `ai_demand_forecasts` **snapshot** table (staff+ read,
  staff+ insert, admin delete) for observability — never used to mutate
  business data.
- Adds indexes on both.
- Adds no duplicate tables/functions; reuses `products`, `orders`,
  `order_items`, `order_stock_allocations`, `inventory_product_totals`,
  `inventory_expiry_report`.

No existing table, column, policy or trigger is modified, dropped or
weakened.

---

## 10. Testing

New tests cover:

- forecast statistical primitives (moving/weighted average, exponential
  smoothing, Holt, linear regression, seasonality)
- rising / falling / stable demand classification
- stock-out prediction and reorder recommendation
- confidence calculation
- insufficient-data and no-data handling (no fabricated forecast)
- overstock and dead-stock detection
- forecast tool authorization and retailer/salesman isolation
- data grounding (no invented facts)
- narrative and insight generation traceability

Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.

---

## 11. Known limitations

- The forecast is an **estimate** driven by recent order history; it is not a
  guarantee of future sales.
- Seasonality detection requires a multi-week history with a strong pattern.
- Reorder recommendations depend on configured `max_stock` (or a computed
  target) and the demand rate; they are advisory and respect configured stock
  thresholds as the source of truth for immediate action.
- Scheme performance attribution is still not possible because order rows do
  not store scheme attribution (unchanged limitation).
- The demand forecast does not itself create purchase orders — that remains
  an existing authorized workflow with explicit confirmation.
