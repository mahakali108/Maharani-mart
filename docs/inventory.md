# Inventory Management — Architecture Notes

Added by migration `0017_inventory_batches_fefo_grn.sql` + companion server
actions/pages. Supabase (Postgres) remains the **only** primary database;
Turso remains an optional search cache and holds no inventory data.

## What exists

| Concern | Object |
|---|---|
| Product × warehouse totals | `inventory_stock` (pre-existing, extended with write policies) |
| Batch-level stock + expiry | `inventory_batches` |
| Goods Received Notes | `grns`, `grn_items` |
| FEFO reservations | `order_stock_allocations` |
| Inter-warehouse transfers | `stock_transfers`, `stock_transfer_items` |
| Configurable windows | `inventory_settings` (singleton), `products.min_stock/reorder_level/max_stock` |
| Ledger | `stock_movements` (extended: `batch_id`, `reference_type/id`, `previous/new_quantity`, `direction`, `releases_reserved`, `seq`) |
| Reporting views | `inventory_product_totals`, `inventory_expiry_report` |

## Invariants (enforced in Postgres, not in the UI)

1. **Single bookkeeping path** — every physical or reserved quantity change
   flows through a `stock_movements` row; the `apply_stock_movement` BEFORE
   INSERT trigger updates `inventory_stock` and, when present, the batch.
   Nothing edits quantities directly.
2. **Append-only ledger** — UPDATE/DELETE on `stock_movements` is blocked by
   trigger for every role except `service_role` (vetted corrections only),
   and RLS exposes no write policies for it either.
3. **Available quantity never negative** — CHECK constraints
   (`current_quantity >= 0`, `reserved_quantity >= 0`,
   `current_quantity >= reserved_quantity`, `inventory_stock.quantity >= 0`).
4. **FEFO is server-side** — allocation lives in `fefo_plan_for_product` +
   `reserve_order_stock`; expired batches are excluded (`expiry_date >=
   current_date` or NULL = non-expiring), earliest expiry first, never more
   than a batch's available quantity. Retailers/salesmen can neither read
   batches nor call the RPCs (`require_inventory_role()` + RLS).
5. **Idempotency** — repeated `confirm_grn`, `reserve_order_stock`,
   `consume_order_stock`, `execute_stock_transfer` calls are safe no-ops.
6. **Reservation release** — a DB trigger on `orders` fires
   `release_order_stock` for ANY cancellation path (admin, staff or retailer
   self-cancel), so reserved stock can never leak.

## Order lifecycle & stock

| Stage | Stock effect |
|---|---|
| Order created (retailer checkout / salesman) | none — pricing, GST, MOQ and credit validation unchanged (`lib/orders/create-order.ts`) |
| Warehouse assigned | none |
| Order **approved** | `reserve_order_stock` — atomic FEFO reservation; fails cleanly if insufficient → order stays pending |
| Cancelled / rejected / expired | trigger releases reservations (`SALE_RELEASE`) |
| **Dispatched** | `consume_order_stock` — consumes recorded allocations (`SALE`), releases matching reservations; legacy orders without allocations fall back to direct FEFO deduction |
| Returned (approved return request) | `return_order_stock` — stock returns to the batches it was dispatched from (`RETURN`) |

Reservation happens at approval (not at cart/checkout) because the serving
warehouse is only known once an admin assigns it — this keeps the existing
checkout, MOQ, credit-limit and pricing logic untouched while still making
oversell impossible at the commit point.

## GRN flow

1. Admin/staff creates a **draft** GRN with lines (product, batch number,
   mfg/expiry dates, received qty, unit cost) — no stock moves yet.
2. **Confirm** → `confirm_grn` RPC (one transaction): creates or merges the
   batch (duplicate batch numbers for the same product/warehouse merge;
   conflicting expiry data is rejected), books `GRN_RECEIPT` movements,
   stamps confirmed_by/at. Re-confirming never doubles stock.
3. **Cancel** is allowed only while the GRN is a draft.

## Transfers

`execute_stock_transfer` validates `available = current − reserved` per
source batch, then books paired `TRANSFER_OUT`/`TRANSFER_IN` movements
sharing the transfer id as `reference_id`. The destination receives a batch
row with the same batch number/expiry (merged if one already exists with a
matching expiry).

## Alerts

Low-stock notifications reuse the existing `notifications` pipeline with a
per-product dedupe (unread alert within `inventory_settings.low_stock_alert_cooldown_hours`,
default 24h) — raised after dispatches/adjustments, sent to active
admin/super_admin users. Expiry is surfaced on the Expiry dashboard with
configurable critical/warning windows (`inventory_settings`); expired stock
is never allocatable by FEFO.

## Legacy compatibility

Pre-batch `inventory_stock` balances remain sellable: when a product in a
warehouse has **no batches at all**, the first reservation folds the
un-batched balance into an auto-created `OPENING-*` batch (direct insert,
no double-counting movement). Once batches exist, gaps are treated as
expired/damaged stock and are never bridged into sellable stock.

## Role mapping (existing role model kept)

| Spec role | App role | Access |
|---|---|---|
| SUPER_ADMIN | `super_admin` | full |
| ADMIN | `admin` | full inventory + settings |
| WAREHOUSE_MANAGER | `staff` | batches, GRN, transfers, movements, write-offs (inventory.manage); settings read-only |
| SALES_EXECUTIVE | `salesman` | no direct inventory access (unchanged) |
| RETAILER | `retailer` | none — ordering uses FEFO internally; retailers see In Stock / Low Stock / Out of Stock only where the catalog already exposed availability |
