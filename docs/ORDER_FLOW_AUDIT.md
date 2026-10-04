# Order Flow Audit — Phase 1 (read-only)

Audited on 2026-09-27 against `main` @ `d3843c2` (the merge of PR #69, infinite scroll).
This phase changed no code, schema, or configuration. Every finding below comes from
reading the repository itself: migrations `0001`–`0051`, `types/database.types.ts`,
`lib/`, `app/`, and `components/`.

Baseline quality gates on this commit: `pnpm typecheck` ✅ · `pnpm lint` ✅ (1 existing
`<img>` warning) · `pnpm test` ✅ 76 files / 1502 tests · `pnpm build` ✅ 114 pages.

---

## 1. The lifecycle as implemented

```
Retailer cart (cart_items, pieces)            lib/retailer/cart-actions.ts, cart-service.ts
  → /retailer/checkout                         app/retailer/checkout/page.tsx
  → placeOrderAction(notes, addressId)         lib/retailer/checkout-actions.ts
  → createOrderForRetailer()                   lib/orders/create-order.ts   (shared with salesman)
      ├ quoteOrderForRetailer()                lib/orders/quote-order.ts    (authoritative re-price)
      ├ INSERT orders           (status pending, warehouse_id NULL)
      ├ INSERT order_items      (one row per pack, quantity_unit='pieces')
      ├ RPC redeem_coupon       (0051, row-locked)
      └ RPC check_and_debit_retailer_wallet   (0031, idempotency key order:{id})
  → cart_items + retailer_active_coupons deleted, "Order placed" notification, redirect
Admin  /admin/orders/[id]                      lib/admin/orders-actions.ts
  → assignWarehouseAction   (pending only)
  → approveOrderAction      → RPC reserve_order_stock (FEFO, 0017) → status confirmed
Staff  /staff/orders                           lib/staff/pick-pack-actions.ts
  → markProcessingAction    confirmed → processing
  → markPackedAction        processing → packed
  → dispatchOrderAction     → RPC consume_order_stock → dispatched + order_deliveries + OTP
Staff/Salesman /…/deliveries                   lib/delivery/delivery-actions.ts (0043)
  → OTP-verified delivery → delivered | failed → re-dispatch | returned (return_order_stock)
Cancel: admin (any pre-dispatch) / retailer (own pending) → trigger releases stock,
        app reverses the wallet debit and releases the coupon
```

### Verified schema (not assumed)

| Concern | Table / object | Source |
| --- | --- | --- |
| Order header | `orders` (order_number, retailer_id, warehouse_id, status, collected_by, subtotal, discount_total, gst_total, grand_total, notes, cancelled_reason, dispatched_by/at, delivered_at, shipping_address, coupon_*) | 0001, 0009, 0036, 0051 |
| Lines | `order_items` (product_id, pack_id, quantity, quantity_unit, quantity_pieces, units_per_case, unit_price, gst_percent, line_total) | 0001, 0007, 0026 |
| Status enum | `order_status`: pending, confirmed, processing, packed, dispatched, delivered, cancelled, returned | 0001 |
| Transitions | `enforce_order_status_transitions` trigger mirrors `lib/orders/state-machine.ts` | 0042 |
| History | `order_status_history` + `log_order_status_change` triggers | 0008 |
| Order number | `generate_order_number()` | 0007 |
| Stock | `inventory_stock`, `inventory_batches`, `order_stock_allocations`, `stock_movements`; RPCs `reserve_/release_/consume_/return_order_stock`; cancel trigger `trg_release_stock_on_order_cancel` | 0001, 0017 |
| Credit | `retailer_credit_accounts`, `retailer_wallet_ledger`; `check_and_debit_retailer_wallet`, `get_retailer_outstanding_paise`; `payment_terms_days` | 0029–0031, 0049 |
| Payments | `payment_collections` (salesman collections → admin review) | 0044 |
| Delivery | `order_deliveries`, `order_delivery_items`, OTP hash, proof buckets | 0043, 0045 |
| Coupons | `coupons`, `coupon_redemptions`, `retailer_active_coupons`; `redeem_coupon`, `release_coupon` | 0051 |
| Returns | `return_requests` + `return_order_stock` | 0009, 0017 |

### Pricing, MOQ, GST (P0 behaviour)

* **Server-authoritative.** Checkout passes only `notes` + `addressId`. Lines come from the
  retailer's own `cart_items` (RLS-scoped), and the coupon comes from their own
  `retailer_active_coupons` row. `quoteOrderForRetailer` re-reads packs, product/pack
  `is_active`, MOQ (pieces), retailer/area price overrides, tier slabs, GST % and credit.
  It then prices every line through `calculateRetailerPiecePrice`, the same engine the UI
  uses. ✅
* **GST-inclusive model.** `line_total` already contains GST, and `gst_total` is the extracted
  component. `grand_total = subtotal + gst − coupon`. ✅
* **Retailer must be `active`**, and the pack/product must be active. ✅

---

## 2. Findings, ranked

### 🔴 Critical: security and integrity

**C1. Order totals are client-writable through direct PostgREST inserts.**
`orders_insert` (0037) allows `retailer_id = auth.uid() and collected_by is null` for
retailers, and `collected_by = auth.uid()` plus an assigned retailer for salesmen.
`order_items_authorized_insert` allows inserting lines into one's own pending order.
Nothing in the database recomputes or validates `subtotal / gst_total / grand_total /
unit_price / line_total`.

A retailer who uses the public anon key and their own JWT can therefore insert an order
with any prices directly, skip the wallet RPC, and end up with a real `pending` order that
admin sees and can approve. The server-side quote only protects the *Server Action* path.
It does not protect the table.

**C2. `check_and_debit_retailer_wallet` trusts `p_amount_paise`.**
The RPC checks wallet access, but it never verifies that the amount equals the order's
`grand_total`, or that `p_order_id` belongs to `p_retailer_id`. Combined with C1, a
retailer can debit ₹0.01 against a large order.

**C3. Order creation is not atomic.**
It makes four separate round-trips: order insert → items insert → coupon redeem → wallet
debit. Failures are handled by compensating updates to `status='cancelled'`, and those
updates can fail too. The `catch` branch in `create-order.ts` is worse: when the wallet
RPC throws a network or transport error that isn't about credit, it only logs
*"non-blocking"* and the order goes through **without a debit**. That is a
credit-bypass path.

**C4. There is no checkout idempotency.**
The Place Order button uses `useTransition` / `isPending`, but the server has no request
key. Two quick taps, or a retry that lands before `cart_items` is deleted, both read the
same cart and create **two orders with two debits**. Wallet idempotency is keyed on the
new `order.id`, so it doesn't help. The salesman `createSalesmanOrderAction` has the
same gap.

**C5. Retailer self-cancel never reverses the wallet debit.**
`lib/retailer/order-actions.ts#cancelOrderAction` calls `reverseOrderWalletDebit` with the
**retailer's** session. `retailer_wallet_ledger` insert is admin-only
(`wallet_ledger_admin_insert`, 0029). The insert is denied, the function *returns*
`{error}` instead of throwing, and nobody checks the result. So every retailer-cancelled
order keeps its `ORDER_DEBIT`, which inflates outstanding and consumes credit. The admin
cancel path works only because admins pass RLS.

### 🟠 High: business correctness

**H1. Zero or unconfigured credit limit means the order is rejected, but only after it has been written.**
The TypeScript credit maths (`calculateCreditPosition`) treats limit 0 as "not configured,
no limit", so checkout shows no warning. The DB RPC computes `available = 0 − outstanding`
and raises `Insufficient credit` unless `allow_overdue`. The result: the order and its
items are inserted, then cancelled, and the retailer sees a raw
`Insufficient credit: available 0 paise…` message. Every attempt leaves a junk cancelled
order behind. **This needs a business decision** (see §4).

**H2. Salesman updates and staff updates can modify money columns.**
`orders_salesman_update` (0009) has no `WITH CHECK` and no column restriction.
`orders_update_staff` is similar. Either role can change `grand_total`, `retailer_id` and
so on through the API. Status moves are constrained by the 0042 trigger, but money
columns are not.

**H3. Inventory unit mismatch on legacy rows (already documented in `docs/warehouse-gaps.md`).**
The reserve and consume RPCs read `order_items.quantity`. New orders write
`quantity_unit='pieces'`, so they are correct. Historical `'packs'` / `'cases'` rows
under-reserve. Stock is product-level, not pack-level, by design.

**H4. Wallet reversal and coupon release on cancel happen outside the cancel transaction.**
Both run as follow-up calls after the status flip. Stock release is safe because it is
trigger-driven. The wallet and coupon steps are not.

### 🟡 Medium: gaps against the P1–P7 feature list

| Area | State |
| --- | --- |
| Retailer My Orders / detail / timeline / reorder / delivery / invoice | ✅ Implemented, with search, status and date filters plus infinite scroll |
| Admin orders list (search `q`, `status`), detail, assign warehouse, approve, cancel, status | ✅ Implemented |
| Staff queue (confirmed/processing/packed), pick → pack → dispatch, deliveries | ✅ Implemented |
| Salesman order capture, orders, deliveries, collections, retailers | ✅ Implemented. Salesman orders carry **no `shipping_address` snapshot** |
| GST invoice (HSN, CGST/SGST/IGST split by GSTIN state, company details from env, HTML download) | ⚠️ Retailer-only. **No dedicated invoice number or date**: it uses `order_number` / `placed_at`, which is not a consecutive per-financial-year GST series. No admin, staff or salesman invoice view |
| Notifications | ✅ placed, assigned, approved, dispatched (with OTP), delivered, delivery failed, returned. ❌ No *packed* event, no admin "new order" alert, no payment-received or credit-warning event |
| Warehouse assignment | Manual per order by admin. No default or area-based warehouse |

---

## 3. Recommended Phase 2: "Place Order hardening"

Scope it tightly. The goal is to close C1–C5 and H1 without re-implementing pricing:

1. **Keep pricing in TypeScript.** `quoteOrderForRetailer` stays the single pricing
   engine. Porting it to SQL would duplicate complex tier and override logic.
2. **Add one new migration with an atomic `place_order` RPC** that performs, in a single
   transaction:
   * an idempotency check on a client-generated `request_id` (unique column on `orders`)
   * the order insert and the items insert, with a DB-side check that
     `Σ line_total = subtotal + gst_total` and `grand_total = … − discount`
   * `redeem_coupon`
   * the wallet debit using the order's own `grand_total`, never a separate amount
3. **Execute that RPC only from the Server Action through the existing
   `createServiceRoleClient()`.** Revoke it from `authenticated`. The action keeps doing
   identity, role and assignment checks via `requirePermission`, and pricing via the
   RLS-scoped client.
4. **Close the direct-insert holes.** Tighten `orders_insert` /
   `order_items_authorized_insert` so retailers and salesmen can no longer insert directly
   (admin/staff policies unchanged). Add a `WITH CHECK` to `orders_salesman_update` so it
   cannot touch money or identity columns. Harden `check_and_debit_retailer_wallet` to
   verify order ownership and amount.
5. **Fix C5.** Perform the wallet reversal inside a security-definer
   `cancel_order` path, or through the service-role client after the RLS-scoped cancel has
   succeeded, and surface failures.
6. **UI:** generate the `request_id` once per checkout mount so a retry reuses it; show a
   friendly credit message; add a pre-check that disables Place Order when credit would be
   rejected.
7. **Tests:** idempotency, a tampered-total rejection (SQL-shape tests in the existing
   `tests/*-sql` style), a retailer-cancel reversal, and the zero-limit behaviour.

Phases 3–10 (management polish, invoice numbering, notifications, …) should follow only
after Phase 2 is merged.

## 4. Decisions needed from the business before Phase 2

1. **Zero or unset credit limit:** should such a retailer be *blocked* from ordering
   (current DB behaviour), or allowed to place orders that are pay-on-delivery / uncapped
   (current UI assumption)?
2. **Service-role usage for order placement:** is it acceptable for the atomic
   `place_order` RPC to be callable only via the server's service-role client? This is the
   pattern `createServiceRoleClient()` was reserved for.
3. **Existing data:** a read-only query should be run in Supabase to list orders whose
   `grand_total` does not match `Σ order_items.line_total − discount_total`, and orders
   with no `ORDER_DEBIT`. That tells us whether C1–C3 were ever exercised in production.

---

## 5. Repository follow-up — native Phase E (2026-10-04)

This audit is an intentionally dated snapshot of the earlier schema; the findings and
recommendations above were not rewritten after the fact. Migration
`0056_mobile_checkout_atomic.sql` now implements the order-creation hardening for the
current repository paths:

- Revoke direct authenticated inserts on `orders`, `order_items`, and cart inserts/updates;
  native cart writes use an owner-derived MOQ-checked compare-and-set RPC.
- Create orders only through the service-role-only `create_order_atomic` function. It
  reconciles quoted lines/totals, current price/GST/MOQ/coupon/Coins/eligibility and
  stock, then commits order/items, coupon redemption, wallet debit, request completion,
  and (for retailer self-checkout) exact cart clearing in one PostgreSQL transaction.
- Bind request UUIDs to owner/actor and a SHA-256 intent fingerprint. Android persists
  one key before submission and recovers the actual committed order after an uncertain
  response; historical rows without a wallet-balance snapshot remain `null`.
- Keep existing Coins arithmetic and ledger RPCs as the storage/business source; no
  payment method is introduced. The Android slice does not implement cancellation,
  returns, reorder, invoices, delivery tracking, or saved carts.

The migration and server/API contract have local PGlite-backed regression coverage. That
single-connection harness cannot prove two independent PostgreSQL sessions contend on the
advisory lock; production concurrency remains a deployment/CI integration check. This
addendum describes repository code, not a claim that migration 0056 has been applied to
a live Supabase database.
