# Warehouse / inventory — what exists and what is genuinely missing

This document records the **real** state of the stock & warehouse implementation
after the production audit. It exists so nobody has to guess, and so nobody
invents inventory data to fill the gaps. Nothing here is aspirational — every
"works" row was verified against the migrations and the code that reads them.

## 1. What is implemented and working

| Capability | Where | Notes |
| --- | --- | --- |
| Warehouses | `warehouses` (0001), `app/admin/warehouses` | CRUD, active flag |
| Per-warehouse stock | `inventory_stock` (0001) | `quantity`, `reserved_quantity` **per `product_id` + `warehouse_id`** |
| Stock movements ledger | `stock_movements` (0001), `app/admin/inventory/movements`, `app/staff/inventory/ledger` | Append-only, staff+ only |
| Stock in (GRN) | `grns`, `grn_items` (0017), `app/admin/inventory/grn` | Draft → confirm creates/updates batches |
| Batch number + expiry | `inventory_batches` (0017) | Unique per product+warehouse+batch number, normalised uppercase |
| FEFO allocation | `order_stock_allocations` + functions (0017) | Earliest `expiry_date` first, nulls last |
| Order stock deduction | 0017 order-confirmation functions | Reserves on confirm, consumes on dispatch |
| Low stock / reorder | `products.min_stock` / `reorder_level` / `max_stock`, view `inventory_product_totals` | Drives `app/admin/inventory/low-stock` and alerts |
| Expiry reporting | view `inventory_expiry_report`, `app/admin/inventory/expiry` | |
| Transfers | `stock_transfers`, `stock_transfer_items` (0017) | Between warehouses |
| Retailer isolation | RLS `inventory_staff`, `inventory_batches_staff_read`, `grns_staff_read`, … | Retailers **cannot** read any inventory table |

## 2. The genuine gap: stock is PRODUCT-level, not VARIANT-level

`inventory_stock`, `inventory_batches`, `stock_movements`,
`order_stock_allocations` and `grn_items` all key on **`product_id`**. There is
no `pack_id` / `product_pack_id` column on any of them.

Consequences, stated honestly:

* A product's on-hand quantity is a **single pool of pieces** for the parent
  product. It cannot currently answer "how many 50g units are in stock" versus
  "how many 100g units".
* Order stock deduction therefore deducts against the parent product, not
  against the ordered variant.
* Because of this, the retailer size selector shows **availability only**
  (the pack's `is_active` flag) and never a stock number. Printing a
  per-variant stock figure today would be fabricated data — and, separately,
  inventory is staff-only under RLS, so it must not reach a retailer page at
  all.

### What a future variant-level stock feature would require

This was **not** implemented, because it changes stock semantics and would
need a data-migration decision that only the business can make:

1. Add a nullable `product_pack_id` to `inventory_stock`, `inventory_batches`,
   `stock_movements`, `grn_items` and `order_stock_allocations`.
2. Decide how existing product-level balances are apportioned across the
   variants of that product (there is no correct automatic answer — an admin
   has to count, or the balance stays on a "unassigned" bucket).
3. Rework the FEFO allocation functions and the
   `inventory_product_totals` / `inventory_expiry_report` views to group by
   pack.
4. Update every inventory screen and the low-stock thresholds
   (`products.min_stock` et al. are product-level too).

Until that decision is made, the current behaviour is correct and consistent:
**one stock pool per product, availability per variant.**

## 3. Other verified-but-limited behaviours

* **Case vs loose stock** — stock is counted in **pieces** only. Cases are a
  pricing/ordering unit (`product_packs.units_per_case`), not a stocking unit.
  There is no separate "cases on hand" figure and none is invented.
* **What 0026 changed here (and what it deliberately did not).** Order lines are
  now written per billing unit — `order_items` rows carry `quantity_unit`
  (`'cases'` / `'pieces'`) plus a `quantity_pieces` snapshot — and the retailer
  cart/checkout MOQs are compared in pieces. Stock movement was **not**
  rewired: the FEFO allocation and consumption functions (0017) still read
  `order_items.quantity`, so for a `'cases'` row they see 1 rather than 40. That
  under-consumption predates this change (the column used to hold pack counts,
  which is the same mismatch), and fixing it means deciding each product's stock
  unit and migrating `inventory_*` rollups plus the RPCs — a warehouse-model
  change, not a pricing one. `order_items.quantity_pieces` is the column a future
  fix should consume; no stock figure is estimated or invented in the meantime.
* **Low stock thresholds** are per product (`min_stock`, `reorder_level`,
  `max_stock`), not per warehouse and not per variant.
* **FEFO** applies to batch consumption within a product+warehouse. Products
  with no batch rows fall back to the aggregate `inventory_stock` balance.
