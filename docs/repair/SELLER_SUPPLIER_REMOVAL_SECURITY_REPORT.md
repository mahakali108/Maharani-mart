# Seller & Supplier Removal — Security Report

**Branch:** `arena/b4ce4177-maharani-mart`
**Scope:** what capability the seller/supplier surface actually granted, and how each one is now
closed. Enforcement was required at the **server, database and API** layers, not by hiding
navigation.

---

## 1. Threat model for this change

The removal creates a specific new risk: **working RPCs with no UI**. Deleting a page does not delete
the function behind it. Anyone holding a valid session and a known function name could still call it
through PostgREST. Every finding below is framed as "what could a surviving session still do?".

A second risk is the inverse: **breaking a live control while removing a dead one**. Three of the
findings below (§3.1, §3.2, §3.3) were exactly that, caught by the test suite rather than by review.

---

## 2. Authentication and role chokepoints

### 2.1 Retired role refused at every entry point

`user_role` retains the value `seller` (PostgreSQL cannot drop an enum value in place). It is
therefore refused explicitly at four independent layers:

| # | Layer | File | Behaviour |
| --- | --- | --- | --- |
| 1 | Sign-in gate | `lib/auth/sign-in-gate.ts` | Returns `role_retired`; no session is minted |
| 2 | Session helper | `lib/auth/session.ts` | `requireUser()` refuses instead of returning the role |
| 3 | Middleware | `middleware.ts` | Signs out and redirects to `/login` |
| 4 | **Database** | `0110` block 7 | `is_active = false` for every seller-role profile |

Layer 4 matters most: every restrictive RLS policy from 0052 already consults `is_active_account()`,
so a token minted before this change fails immediately at the database, regardless of application
deploy state.

**Design note.** A retired role is deliberately distinguished from an *unknown* role. An unknown role
is a bug; a retired seller is a known historical state that must be **signed out**, not redirected to
a page that would 404-loop. `isRetiredRole()` vs `isSupportedRole()` makes the difference explicit in
the type system.

### 2.2 No seller account can be created

`0110` replaces `handle_new_user()`:

* the seller-invitation branch (nonce match, `seller_members` insert, `role := 'seller'`) is gone;
* a `staff_account_invites` row with role `seller` raises `seller_invite_required` **before** any
  insert, so the whole signup rolls back with no partial profile;
* an explicit non-retailer `account_type` is refused rather than silently becoming a retailer;
* the function is re-revoked from `public, anon, authenticated`, preserving the 0078 H3 rule.

`handle_new_user()` is a `SECURITY DEFINER` trigger with a fixed `search_path = public, pg_temp`.
Its `unique_violation` path still raises `phone_already_registered`, so the signup error contract is
unchanged.

### 2.3 Super Admin was not locked out

Verified: no policy or grant touched by `0110` removes any `super_admin` capability.

* `sellers_select`, `seller_offers_trading_select`, `seller_offer_tiers_select`,
  `seller_offer_price_history_read`, `offer_price_floors_admin_select`, `seller_ledger_read`,
  `seller_shipments_select` — all re-stated as `is_admin_or_above()`.
* `seller_offers_admin_update`, `suppliers_admin_update`, `seller_members_admin_insert/delete` — kept
  so historical records stay annotatable.
* `seller_invites_super_admin_read` — kept (`current_user_role() = 'super_admin'`).
* `lib/admin/sub-order-actions.ts` retained and re-gated on `orders.return.manage`, so historical
  sub-order settlement remains possible.

---

## 3. Findings

### 3.1 HIGH — seller portal RPCs were callable by any signed-in session

**Before:** `authenticated` held EXECUTE on `seller_set_offer_stock`,
`seller_replace_offer_tiers`, `seller_update_sub_order`, `seller_update_own_profile`,
`seller_order_headers`, `seller_offer_gate_status`. Their bodies check seller membership, so
exploitation was limited — but a seller session could still mutate its own offer stock and pricing
after the portal was "removed".

**Fix:** EXECUTE revoked from `public, anon, authenticated` for all six. Bodies untouched, so the
functions remain auditable.

**Verified by:** `tests/migration-0110-seller-supplier-retirement.test.ts` — asserts each function
**exists** (so the assertion is not vacuous) and that `has_function_privilege` is `false` for both API
roles.

### 3.2 HIGH — the supplier application funnel was open to anonymous callers

**Before:** `submit_supplier_application(text × 11)` was granted to `anon` **and** `authenticated`
(0059/0109). Any unauthenticated visitor could file a supplier application, creating rows in
`public.suppliers` and consuming rate-limit budget.

**Fix:** revoked from both API roles. The function, its tables and every submitted row are kept for
historical reference. `supplier_application_rate_limits` is revoked from `anon`/`authenticated`, and
the `supplier-documents` bucket object policies are dropped (bucket and objects preserved).

**Verified by:** `api-privilege-hardening`, `security-advisor-remediation-db`,
`phase3-business-control-db`, plus the 0110 suite.

**Regression risk accepted:** the anti-abuse rate limiter inside the function is now unreachable
because 0109 gated it on `current_setting('role') in ('anon','authenticated')`. The limiter is still
proven live by driving `consume_supplier_application_rate_limit` directly as the owner, and the test
asserts it still refuses the 6th call. The funnel being *closed* is strictly stronger than being
*rate-limited*.

### 3.3 HIGH — marketplace read RPCs exposed seller pricing to retailers

**Before:** `marketplace_offer_quotes`, `marketplace_offers_for_product`, `marketplace_offer_tiers`,
`effective_seller_offer_unit_price_paise`, `third_party_offers_enabled`,
`current_offer_floor_paise`, `record_marketplace_launch_approval` were granted to `authenticated`
(0069/0072/0086/0098). With no offers left to quote, these were a data-exposure surface with no
legitimate caller.

**Fix:** revoked. All already failed closed at the application layer (`quote-order` uses v1 only,
`create_order_atomic_v2` is `service_role`-only since 0065), so this closes the direct-PostgREST path
only.

### 3.4 MEDIUM — seller RLS write policies allowed post-removal mutation

**Before:** sellers could `insert`/`update` their own `seller_offers`, `seller_offers` tiers, and
`seller_members` rows.

**Fix:** seller self-service policies dropped; administrative paths re-stated. `sellers` no longer has
an admin `INSERT` or `DELETE` policy — a seller business record can no longer be created or removed,
only read and annotated.

### 3.5 MEDIUM — 11 test suites could have masked the removal

**Before:** deleted modules left test files importing them, so `typecheck` failed on `@/…` imports.
Deleting a module without its tests would have left the suite asserting behaviour that no longer
exists.

**Fix:** the 11 seller/supplier suites were deleted in the same pass as their modules. No test was
weakened to pass: every surviving assertion that mentioned a retired capability was **re-pointed at
the new truth** and, where the truth became a refusal, the assertion now asserts the refusal (e.g.
`submit_supplier_application` → `permission denied for function`).

### 3.6 LOW — dead internal links to removed routes

**Found:** `/admin/offers` was still linked from `app/admin/products/[id]/page.tsx` ("Review seller
offers →") and `app/admin/pricing/wholesale/page.tsx` ("Offer price floors →").

**Fix:** both removed. A grep for `href="/admin/{offers,sellers,suppliers,marketplace-launch}"` and
`href="/seller` across `app`, `components` and `lib` now returns nothing.

### 3.7 INFO — customer-facing text claimed a capability that does not exist

**Found:** 12 sentences across 10 managed website pages described a marketplace. Two were materially
misleading, not merely stale:

* `terms` — "The application includes marketplace and seller features, including seller offers and
  fulfilment"
* `gst-pricing-invoice` — claimed an invoice may come "from the independent seller"

**Fix:** the exact superseded sentences are replaced with the single-seller truth in three places kept
in lockstep (`lib/legal/content.ts` seed sources, `scripts/generate-site-content-seed.mjs`, and `0110`
block 7b as a guarded in-place rewrite). `0110` raises if any page still says "marketplace and seller
features". The `marketplace-disclaimer` and `seller-agreement` pages are preserved but never published
— see the implementation report §8.

**Nothing was invented:** no GSTIN, legal name, address, phone, grievance officer, statutory contact
or registration number was added. `AJAY GENERAL` / `MAHARANI TRADERS` and the existing "has not been
independently verified" hedges are untouched.

### 3.8 INFO — historical third-party order lines still block invoice issuance

Historical orders may contain `order_items.source_type = 'seller'`. Issuing an invoice in Maharani
Traders' name for goods it did not sell would misstate the seller of record, so
`getTaxInvoiceReadiness()` keeps blocking it. Only the wording changed: it now says the programme has
ended and asks the customer to contact us, instead of implying a model is still being prepared.

---

## 4. Deliberate residual capabilities (and why each is safe)

| Capability | Why it is kept | New exposure |
| --- | --- | --- |
| `is_member_of_seller(uuid)`, `is_active_seller_member(uuid)` | Live RLS policies from 0062/0063/0086/0109 **call** them; a revoked function makes those policies raise. 0109's preflight also needs the latter. | None — every seller-role profile is inactive, so both return `false` for all callers. |
| `retailer_order_sub_orders`, `close_sub_order_atomic`, `set_sub_order_status` | Historical orders can still contain sub-orders; a Super Admin must be able to settle and close them. | Unchanged; all permission-checked server-side (`orders.return.manage`). |
| `seller_agreement_is_current(uuid)` | Already `service_role`-only since 0098. | None. |
| `sellers` / `seller_offers` etc. tables + admin read | Audit, reconciliation and dispute handling require them. | Admin-only RLS. No API role can write. |
| `grns.supplier_reference` | Historical purchase provenance. | Unchanged; shown as "Purchases & GRN". |

---

## 5. Enforcement summary

| Layer | Enforced? | Where |
| --- | --- | --- |
| Database grants | ✅ | `0110` blocks 2–5 |
| Database RLS | ✅ | `0110` block 6 |
| Database signup trigger | ✅ | `0110` block 1 |
| Server-side session helpers | ✅ | `requireUser`, `assertSignInAllowed` |
| Server-side permission checks | ✅ | `lib/permissions/permissions.ts` (`sellers.*` removed) |
| Middleware routing | ✅ | `middleware.ts` + `lib/auth/roles.ts` |
| UI / navigation | ✅ | shells, but **not relied upon** |
| API surface | ✅ | mobile routes; removed admin routes; revoked RPCs |

The last row is the point of the whole exercise: navigation is hidden **and** every layer beneath it
refuses, so hiding nav is not what is being depended on.
