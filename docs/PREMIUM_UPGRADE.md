# Maharani Traders — Premium Retailer Upgrade

Batches implemented on top of the existing B2B platform **without touching
authentication, retailer approval, admin, cart/checkout money paths, GST,
invoices, orders, wallet debits, credit ledger, RLS or permissions**.

## New additive migrations (run in order, all re-runnable)

| Migration | What it adds |
|---|---|
| `0032_retailer_address_book.sql` | `retailer_addresses` — saved delivery addresses (label, receiver, phone, PIN), default flag, owner-only RLS |
| `0033_retailer_saved_carts.sql` | `retailer_saved_carts` + `retailer_saved_cart_items` — named reusable order lists. **Only pack refs + quantities are stored; prices are never copied.** |
| `0034_retailer_product_feedback.sql` | `retailer_product_issues` (report a product problem; retailer can never set review status) + `retailer_stock_alerts` (pack-level "notify me") |
| `0035_retailer_profile_rpc_prefs_requests.sql` | `update_my_shop_profile()` SECURITY DEFINER RPC (updates **only** `shop_name`/`address` for `auth.uid()` — credit/status/area are unreachable), `retailer_notification_prefs`, `retailer_account_requests` (deletion / data-export requests, staff-reviewed) |
| `0036_order_shipping_address.sql` | `orders.shipping_address` jsonb — server-side snapshot of the address chosen at checkout |

## New retailer routes

- `/retailer/account/edit` — edit shop + owner/contact details, profile completion
- `/retailer/account/addresses` — address book (add / edit / default / delete)
- `/retailer/account/security` — change password (re-auth), sign out everywhere, account requests
- `/retailer/account/notification-preferences` — per-category in-app notification toggles
- `/retailer/cart/saved` — saved carts (restore-merge, per-item add, rename, delete)
- `/retailer/reports` — weekly/monthly purchase summaries, GST, savings, top products, 6-month trend
- `/retailer/reports/statement?type=orders|ledger` — CSV statement download (own data only, RLS-scoped)

## New components

`address-form`, `address-edit-toggle`, `checkout-address-context`,
`checkout-address-selector`, `cart-save-controls`, `saved-cart-list`,
`profile-edit-forms`, `security-forms`, `notification-prefs-form`,
`product-feedback` (issue report sheet + stock alert toggle),
`bulk-order-panel` (paste a full order list), `compare-grid` (compare up to 4
products), `availability` label helpers.

## Wiring into existing flows (no replacement)

- **Checkout** — address selection from the address book with the registered
  shop address as fallback + inline add-address. The chosen address id is
  resolved **server-side** and frozen onto the order.
- **Cart** — "Save cart" (named), "Save for later" per line (moves into the
  Saved-for-later list), restore merges with re-validation + re-pricing.
- **Product detail** — availability chip (sanctioned
  `get_retailer_product_availability` RPC), "Notify me when available",
  "Report a problem" bottom sheet.
- **Favourites** — out-of-stock favourites surface availability alerts with opt-in notify.
- **Order detail** — shows the frozen delivery address snapshot when present.
- **Home** — credit strip (outstanding / available / limit) + quick actions.
- **Account** — approval/credit status chips, profile-completion bar, new links.
- **Quick order** — bulk paste panel (name/brand/barcode matching, MOQ-aware).
- **Catalog** — compare tray + comparison sheet (real card data only).
- **Notifications** — promotional category respects `offer_updates` preference; transactional always delivered.

## Security unchanged and verified

- All writes still go through server actions that take identity from the session.
- New RLS is owner-only (`retailer_id = auth.uid()`), mirroring `cart_items`.
- No retailer-side credit-limit editing, no ledger manipulation, no cost-price exposure.
- Guard tests updated for the new architecture: `retailer-enterprise-upgrade`,
  new `premium-upgrade` (25 tests) and `mobile-safety` suites.

## Quality gates (executed)

- `pnpm typecheck` — pass
- `pnpm lint` — 0 errors (1 pre-existing `<img>` warning in admin)
- `pnpm test` — 650/650 pass (33 files)
- `pnpm build` — production build succeeds (88 routes)
