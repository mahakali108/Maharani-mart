# Seller Marketplace — historical design and forward fixes (0062–0071)

Status: **historical design record, updated for this branch**. Migrations 0062–0069 are unchanged; one connected Supabase project lists them as applied, but the production target has not been confirmed. Forward-only migrations **0070 and 0071 exist locally only**; no remote SQL or deployment was performed in this review. Before any rollout follow [UPGRADE_REVIEW.md](UPGRADE_REVIEW.md).

This record carries forward the Phase 1.2/1.3 review findings, the approved
design, what Stage 2 built, and every decision that remains open (those stay
**undecided** — dependent features are gated, not guessed).

---

## 1. What this is (and is not)

Maharani Traders offers a central catalogue. The **Seller Marketplace** lets
external sellers publish **offers over existing catalogue packs** — seller
price, seller MOQ, seller-owned stock, seller fulfilment. One customer order
can mix Maharani lines and seller lines and settles as **one payment** on one
parent order. Merchant/supplier-of-record and tax-invoice responsibility remain **unverified** and require professional review before live multi-seller transactions.

**Distinctions that must survive review:**

| Model | Table / migration | Status |
|---|---|---|
| Supplier Registration V1 (upstream vendor applications) | `suppliers`, 0059–0060 | merged (PR #110) |
| Supplier Suspend (Feature B) | 0059 transition | historical, separate supplier feature |
| **Seller Marketplace** | `sellers`, `seller_offers`, `sub_orders`, 0062–0070 | 0070 forward fix in this branch |

Sellers ≠ suppliers: no shared records, transitions, roles or UI. Sellers provide downstream marketplace offers; suppliers are upstream vendors. Tax and legal seller-of-record classifications are still pending review.

## 2. Core design decisions (approved)

1. **Identity & moderation (0062, 0063)** — `sellers` + `seller_members`
   (V1: one seller per profile) + `seller` enum role. Migration 0069 added
   a seller portal. Migration 0070 restricts business creation and membership
   to Super Admin, reserves one-use Auth invitations and restricts pending/
   suspended trading; ordinary Admin retains offer moderation. Sellers never
   see another seller's private terms. Status machine `pending → active | rejected`,
   `active ↔ suspended` with mandatory review stamps and reasons.
2. **Offers on the central catalogue (0063)** — no duplicate catalogue.
   Admin-configured `offer_price_floors` are **append-only commercial history**
   (never derived from `cost_price`, never shown to sellers). Offers are
   **deactivated, never deleted** (no delete policy; FKs ON DELETE RESTRICT);
   snapshots on order lines survive any later offer change.
3. **Cart/checkout compatibility (0064, 0065)** — `mutate_retailer_cart_line`
   and `create_order_atomic` stay **byte-identical**. New entry points
   `mutate_retailer_cart_line_ex` / `create_order_atomic_v2` (distinct names,
   no overloads). Offer-less callers keep Maharani semantics on v1. Cart line
   identity `line_key = 'm' | 's:<offer uuid>'` with CHECK
   `(source='maharani') ⇔ (offer IS NULL)` and UNIQUE
   `(retailer_id, pack_id, line_key)` (the legacy pack-only key is atomically
   replaced, replacement-first). Order line uniqueness is **partial and
   non-null-keyed**: legacy `(order_id, pack_id) WHERE sub_order_id IS NULL`,
   split `(sub_order_id, pack_id) WHERE sub_order_id IS NOT NULL`. No direct
   API inserts to `orders`/`order_items` (0056 grants unchanged).
4. **Atomic stock (0065)** — seller stock lives ONLY on
   `seller_offers.stock_quantity`; `UPDATE … WHERE stock_quantity >= n AND
   is_active AND moderation='approved' AND seller active` — the row lock is the
   oversell guard (advisory locks are NOT). Maharani lines keep the exact 0054
   pack deduction. Full quantity accounting on `order_items`:
   `stock_deducted/restored` (0054) + `shipped/accepted/missing_damaged/
   returned_received` (0064), with DB-enforced bound
   `restorable = deducted − shipped + returned_received − restored ≥ 0`
   (`RESTORABLE_EXCEEDED`). `restore_sub_order_stock` restores only that bound:
   unshipped on pre-fulfilment cancel, returns only after physical receipt,
   never twice, never in-transit. Seller-only checkout needs **no warehouse**
   (profile-conditional 0054 trigger); mixed orders fail atomically if the
   Maharani portion is unfulfillable. `request_key` + fingerprint idempotency
   mirrors v1 exactly (replay returns the original).
5. **Parent/child orders (0064, 0066)** — one customer-facing parent `orders`
   row + `sub_orders` (one pack-stock 'maharani' child + at most one child per
   seller). `order_deliveries.UNIQUE(order_id)` is untouched (0043);
   `order_deliveries.sub_order_id` is link-only. `seller_shipments`
   (UNIQUE(sub_order_id)) records seller fulfilment. Parent status moves ONLY
   along existing 0042 edges (`lib/orders/state-machine.ts`):
   - `cancelled` iff all children cancelled AND parent ≤ packed;
   - `delivered` iff all children resolved AND ≥ 1 delivered (a cancelled
     child is a value reversal, not a blocker — the existing shortfalls
     convention);
   - `returned` iff parent ≥ dispatched and no delivered goods.
   Stuck children (`failed`) close only through admin review with a valid
   child transition and a reason (`set_sub_order_status`). No new parent
   transitions were introduced. Child money snapshots are immutable.
6. **Money (0065, 0067)** — GST-inclusive unit prices with per-line paise-
   rounded extraction preserved (`unit × qty = line_total` asserted). Parent
   GST = Σ stored line extractions, never recomputed from gross. Coupon is the
   only discount (order-level; eligibility GST-exclusive, mirrors 0056).
   Coins are the payment layer. Coupon and coin shares split across children by
   **largest-remainder allocation** over stable `sort_index` order
   (`allocate_largest_remainder`), ineligible children get 0, shares sum
   EXACTLY (asserted at commit). Per-child wallet debits use keys
   `order:<parent>:<child>` with `reference_id = parent` so legacy order-level
   replays (0056:577) remain exact. Child refunds:
   `refund_sub_order_coins` reverses each child debit **exactly once** under
   `reversal:<debit id>` (0053 mechanics, capped by the request); legacy
   `refund_order_coins` and `restore_simple_order_stock` are byte-identical.
   `collection_allocations` + `seller_ledger` postings share deterministic
   `alloc:<id>` keys; seller AP is a separate plane from retailer wallet AR.
   **No fabricated invoices, credit notes or payouts.**
7. **Lock order (global, 0065)** — request-key → retailer `FOR UPDATE` → cart
   → coupon → `retailer-pricing:<product>` ASC → offer rows `FOR SHARE` (with
   their sellers) → stock conditional UPDATEs → wallet last. Offer/floor/
   seller-status UPDATEs serialise on the same offer rows (shared row locks),
   not on a second advisory layer (advisory + row pairs would ABBA against
   single-row admin updates).
8. **RLS/grants (0062–0070)** — per-table policies at creation, allowlist
   grants; sellers read own rows only; admin+ moderate; ledger append-only
   (`prevent_seller_ledger_mutation`); admin-only column guards mirror 0052;
   every SECURITY DEFINER function pins `search_path = public, pg_temp`.

## 3. Migration map (apply status depends on the identified target)

| File | Layer | Contents |
|---|---|---|
| `0062_seller_identity.sql` | expand | `sellers`, `seller_members`, `user_role` += `seller`, transition triggers, `is_member_of_seller` |
| `0063_seller_offers.sql` | expand | `seller_offers`, `offer_price_floors` (append-only), `seller_offer_price_history`, floor/moderation triggers |
| `0064_split_order_identity.sql` | expand (behaviour-neutral) | cart `line_key` + source shape + partial uniques; order_items identity + counters; `sub_orders`; `orders.fulfilment_profile` |
| `0065_checkout_split_rpcs.sql` | behaviour | `mutate_retailer_cart_line_ex`, `create_order_atomic_v2`, source-aware deduction trigger, restorable bound, profile-conditional warehouse trigger, `allocate_largest_remainder` |
| `0066_fulfilment_and_delivery.sql` | behaviour | `seller_shipments`, delivery link column, `set_sub_order_status`, `apply_parent_order_status`, `restore_sub_order_stock` |
| `0067_seller_settlement.sql` | behaviour | `collection_allocations`, `seller_ledger`, `seller_payouts` (table only), `allocate_payment_collection`, `refund_sub_order_coins` |
| `0068_seller_governance.sql` | behaviour | drain-mode suspension trigger, admin-only offer column guard, audit triggers |
| `0069_seller_portal_access.sql` | behaviour | seller portal RPCs, tiers, marketplace projections and saved-cart source shape |
| `0070_super_admin_seller_invitations.sql` | **local only** | Super-Admin-only reservations and Auth invite nonce, fail-closed public signup, inactive status and tenant isolation fixes |
| `0071_configured_delivery_pins.sql` | **local only** | Gaya new-area default, admin-verified PIN directory and self-checkout insert guard |
| `supabase/rollbacks/0062–0069_*.down.sql` | historical rollback files | Do not use to repair a 0070/0071 schema; restoring old functions would remove forward security fixes |

The prompt's split labels `0064a/0064b/0065/0066/0067/0068` map to the
repository's 4-digit convention as `0064/0065/0066/0067/0068` (plus `0062/
0063`). The planned `0064c` cleanup (dropping the legacy constraints) is
**deferred** until the split path has production history.

## 4. Application map (current branch)

- `types/marketplace.types.ts` — local types (generated `database.types.ts`
  absorbs them at the next pipeline refresh; call sites use the established
  `as never` cast pattern from `supplier-actions.ts`).
- `lib/auth/roles.ts` — seller routes are now `/seller/*`; inactive sellers
  see `/seller/status`, not trading screens. All seller pages/actions also
  check the session and membership.
- `lib/permissions/permissions.ts` — `sellers.view` / `sellers.review` /
  `sellers.manage` are **Super Admin only**; ordinary Admin can moderate
  offers using `sellers.offers.manage`. Seller portal actions use their own
  active-tenant server guards and matching database checks.
- `lib/admin/seller-validation.ts`, `lib/admin/seller-actions.ts`,
  `lib/admin/offer-actions.ts`, `lib/admin/sellers-query.ts` — admin
  management (create/review/suspend/reinstate/members; floors/moderation/
  activation/offer authoring). Every exported async guards its permission.
- `app/admin/sellers`, `app/admin/sellers/[id]`, `app/admin/offers` +
  `components/admin/seller-review-actions.tsx`, `offer-row-actions.tsx`,
  `offer-forms.tsx`, `create-seller-form.tsx` — admin UI (design-system safe
  palette only).
- `lib/orders/quote-order.ts` — `quoteSplitOrderForRetailer` (offer pricing
  through the same GST-inclusive engine; offer/seller revalidation;
  `fulfilmentProfile`); legacy path untouched.
- `lib/orders/create-order.ts` — routes split checkouts to
  `create_order_atomic_v2`; offer-less callers keep v1 byte-identical.
  Warehouse resolver skipped only for `all_seller` profiles.
- `lib/orders/request-fingerprint.ts` — offer identity in the canonical hash
  for split lines only (legacy fingerprints unchanged).
- `lib/retailer/cart-rpc.ts` — `mutateRetailerCartLineEx` wrapper.

## 5. Phase 1.3 findings carried forward (PASS WITH CONDITIONS)

All F-1…F-4 conditions are implemented as described above. Notable specifics:

- **F-1** — line identity `source_key`, CHECK shape, partial uniques with
  non-null key sets, sub-order-aware "already present" guard, deactivation-only
  offers with RESTRICT FKs and immutable snapshots. The cart replacement drops
  the legacy pack-only key **after** the new key is active, in one transaction.
- **F-2** — seller stock plane separate from warehouses/FEFO/GRN/valuation;
  counters + restorable bound; profile-conditional warehouse check replaces
  the unconditional 0054:339 rule (NULL profile keeps legacy behaviour).
- **F-3** — parent transitions restricted to the 0042 edge set inside
  `apply_parent_order_status` (each step is one legal edge and audit-logged by
  the existing history trigger). `UNIQUE(order_id)` on `order_deliveries`
  preserved. Seller shipment failure/re-attempt maps to child
  `failed → shipped | cancelled | returned` with admin-review closure.
- **F-4** — GST-inclusive paise extraction preserved; `calculateTaxedLine`
  remains the documented legacy/test-only exclusive-GST helper (labelled as
  such in source); coupon the only discount; coins payment-layer; exact
  allocation; `refund_sub_order_coins` child-scoped with per-debit
  `reversal:` keys; `collection_allocations`/`seller_ledger` on `alloc:` keys.

## 6. Open decisions (UNCHANGED — do not infer)

Owner decisions (features stay gated):

1. **Commission basis (gross vs net)** — `sub_orders.commission_basis` stays
   `'undecided'`; commission is snapshotted (nullable `commission_rate_bp`)
   but **no commission postings and no seller-payout actions** exist.
   `seller_payouts` is a table only.
2. **Seller SLA / fulfilment-clock policy** — none invented; stuck children
   close through admin review only.
3. **COD collection-agent model** — unchanged; collections stay with the
   existing verified `payment_collections` flow.

Qualified tax/legal review (NO conclusions drawn here): seller-of-record
invoicing, coupon-on-invoice presentation, GST credit notes for returns and
shortfalls. **No credit-note artifact exists in this repository** and none was
created.

Runtime verification still open (recorded, not claimed): target Postgres
version (PGlite tests run on PG16 WASM; `security_invoker` implies ≥ 15 on
the real project — unverified), and true multi-connection concurrency tests.

## 7. Rollout, verification and recovery (current branch)

- **Order:** after the owner confirms the project is already at 0069, rehearse 0070 then 0071 on a disposable staging clone. Take and rehearse a restorable backup; then obtain separate explicit production approval before applying migrations DB-first or deploying the new app. See [UPGRADE_REVIEW.md](UPGRADE_REVIEW.md) for the exact gates.
- **No transparent old-client checkout after 0071:** v1 and v2 atomic RPCs keep their signatures, legacy carts/order history survive, and manual salesman captures remain unchanged. But retailer self-checkout from clients lacking a structured saved address is intentionally rejected. Coordinate a checkout freeze or client rollout; do not claim the old app works unchanged against the new order guard.
- **No rollback-script repairs:** reapplying 0069 over 0070 would restore vulnerable function bodies. Recover using a reviewed forward migration or verified backup, preserving ledger and orders. The historical 0069 rollback/reapply check is confined to its own disposable 0069 PGlite database.
- **Verification limits:** PGlite test evidence does not verify Supabase Auth mail delivery, actual production schema drift, or real multi-connection locking. No remote migration, deploy or live seller activation was performed here. Commission, tax-credit-note and invoice decisions above remain gated.
