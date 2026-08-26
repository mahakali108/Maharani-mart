# Maharani AI business agent

## Architecture

```text
Role workspace -> POST /api/ai/chat -> authenticated actor + surface guard
  -> provider-independent agent -> allow-listed typed tools
  -> existing services / caller-scoped Supabase client (RLS)
  -> validated tool result + visual cards -> streamed SSE response
```

The model receives no database connection and cannot generate or execute SQL. Tool arguments pass Zod validation; tool availability is filtered by authenticated role and workspace. Tools use the ordinary cookie-bound Supabase client, never the service-role client.

## Providers

`AIProvider` is implemented by an OpenAI Chat Completions-compatible streaming adapter. `AI_PROVIDER` may be `openai`, `gemini` (via Google's OpenAI-compatible endpoint), or `openai-compatible` with a custom `AI_BASE_URL`. A fully configured `AI_FALLBACK_*` provider is attempted once only when the primary provider fails before a validated result is produced.

The selected model must support streaming chat completions and function/tool calling. Image/audio controls are intentionally disabled because this implementation does not claim unsupported multimodal understanding.

## Action safety

- `READ`: executes automatically.
- `PREPARE`: produces read-only cart/reorder previews.
- `WRITE`: cart-only changes, requiring a signed, 10-minute confirmation token.
- `SENSITIVE`: rejected by the executor.

Confirmation tokens are actor/surface-bound and their nonces are consumed atomically once. Maharani AI exposes no order placement, status change, price, credit-limit, permission, inventory-mutation, or delete-business-data tools.

Every order/cart preview calls `quoteOrderForRetailer`, the same server-only validation path used by `createOrderForRetailer`. It re-reads pack state, MOQ, effective pricing, GST and credit. Cart writes reuse `cart-service.ts`. Credit arithmetic is centralized in `orders/credit.ts`.

## Data controls

- Retailer stock uses `get_retailer_product_availability`: aggregate active-product availability only; no warehouse, batch, cost or reservation details.
- Staff/admin inventory tools use existing RLS-protected stock, batch and expiry views.
- Retailer/order targets are session-pinned or still checked by existing RLS.
- No prompt, conversation, tool arguments/results, document, or credential is logged.
- Safe memory contains only allow-listed compact business preferences and can be reset. Chat context stays browser-side and is bounded to 12 messages / 12,000 characters.
- Scheme savings are not invented: the current schema has scheme price rows but no minimum/benefit formula or order attribution. The tool reports this limitation.

## Required migrations

Apply `supabase/migrations/0018_maharani_ai_security.sql`. It adds:

- `ai_business_memory` with owner-only RLS;
- metadata-only `ai_audit_logs`;
- distributed per-user rate-limit windows and RPC;
- one-time confirmation nonce storage and RPC;
- retailer-safe aggregate availability RPC.

Then apply `supabase/migrations/0019_ai_demand_forecast.sql` for the demand
forecasting capability:

- RLS-guarded `ai_product_demand_daily` view (staff+ only) aggregating real,
  non-cancelled order demand plus cancellation/return context;
- optional `ai_demand_forecasts` snapshot table for observability.

No existing authentication, pricing, GST, MOQ, credit, checkout, order-state or inventory mutation logic is changed. See [`ai-intelligence.md`](./ai-intelligence.md) for the full forecasting description.

## Environment

See `.env.local.example`. Required for AI responses:

- `AI_PROVIDER`
- `AI_API_KEY`
- `AI_MODEL`
- optional `AI_BASE_URL`
- `AI_ACTION_SIGNING_SECRET` (32+ chars; required for cart writes)
- optional complete `AI_FALLBACK_*` set
- optional `AI_MAX_OUTPUT_TOKENS`

All are server-only.

## Known source-data limitations

- "Best scheme" cannot be numerically ranked until a canonical eligibility/benefit formula exists.
- Scheme performance cannot be attributed because order rows do not store scheme attribution.
- Stock-out prediction is shown only when the existing `ai_predictions` job has written a fresh result.
- Invoices are the platform's existing order-generated tax invoices, not a separate invoice ledger.
- Reorder intervals are explicitly labeled estimates and require at least two purchase occurrences.

## Super Admin Command Center

The `/admin/command-center` dashboard (super_admin only, `command_center.view` permission) reuses this agent with the existing `admin` surface and adds eight read-only, zero-argument executive tools (`lib/ai/tools/super-admin.ts`) that are visible only to `super_admin`. Executive answers must label facts, metrics, forecasts and recommendations, and recommendations must state reason, expected impact, risk and required approval. The copilot never mutates data; the only write path in the feature is the smart-alerts server action, which reuses the existing notification pipeline with its link_url dedupe/cooldown pattern. See `docs/command-center.md`.
