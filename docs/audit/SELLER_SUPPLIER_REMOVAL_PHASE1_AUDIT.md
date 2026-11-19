# Seller & Supplier Removal — Phase 1 Read-Only Audit

**Repository:** `mahakali108/Maharani-mart`
**Branch:** `arena/b4ce4177-maharani-mart`
**Base commit:** `450e22fd4390a1396b460b40116fe911aed9a306` (PR #139 merged)
**Audit date:** 2026-11-18
**Mode:** Read-only. No file, migration or database object was modified to produce this document.

> **Status update (owner-review corrections).** Phases 2–8 are implemented on the branch and open as
> PR #140. Two findings in this audit were re-opened and corrected during owner review, both recorded
> in place below: §6.2 (dual-role accounts were being deactivated along with seller-only ones) and
> §6.4 (the corrected legal copy introduced a new unverified seller-of-record claim). The remaining
> open item is §6.4: *which* business identity is the legal seller / invoice issuer / GST registrant is
> still an owner decision, and is therefore still not asserted anywhere.

---

## 0. Baseline measurements (before any change)

Every number below was measured on the base commit, before a single edit.

| Gate | Command | Result |
| --- | --- | --- |
| Install | `corepack pnpm install --frozen-lockfile` | clean, 127 packages |
| Typecheck | `corepack pnpm run typecheck` (`tsc --noEmit`) | **PASS** (exit 0) |
| Lint | `corepack pnpm run lint` (`eslint .`) | **PASS** (exit 0) |
| Unit/integration/DB tests | `corepack pnpm exec vitest run` | **PASS — 239 files, 3644 tests, exit 0** |

Reference density at baseline:

| Area | Files containing seller/supplier | Notes |
| --- | --- | --- |
| Live code (`app/ components/ lib/ types/ middleware.ts`) | **157** files, 1915 matching lines | 38 are dedicated seller/supplier modules |
| Migrations (`supabase/migrations`) | **35** of 106 files | 13 are seller/supplier-authored, 22 merely touch the objects |
| Rollbacks | 9 | 0059, 0060, 0062, 0063, 0067, 0068, 0069, 0098 |
| Tests | **62** files | 10 dedicated seller/supplier suites |
| Docs | **103** files | 5 dedicated seller/supplier documents |

---

## 1. Identity and non-negotiable constraints (confirmed present, unchanged)

- GitHub repo, Vercel project `maharanitraders`, site `https://maharanitraders.vercel.app` — untouched by this audit.
- Official Supabase project `Maharani-mart`, ref `fhrmsrumsraprvutrpeo`, region `ap-south-1`. **No connection was made to any Supabase project during this audit.** Everything below is derived from repository source and the PGlite (WASM Postgres 16) migration harness, which is local.
- Legacy project `gbxhmffsbsfhdrfuwurx` was not referenced, read or modified.

---

## 2. The single most important structural finding

**The Seller/Supplier surface is not a removable "module" bolted onto the side of the app. It is load-bearing for the live ordering spine.**

Concretely, in the base commit:

1. `app/retailer/**` (cart, saved cart, product detail, order detail, reorder, invoice) reads `seller_offer_id` and `source_type` on every line, and calls three retailer-facing RPCs — `marketplace_offer_quotes`, `marketplace_offers_for_product`, `marketplace_offer_tiers` (migration 0069).
2. `lib/orders/quote-order.ts` branches into `quoteSplitOrderForRetailer()` whenever any line carries a `sellerOfferId`, and otherwise still computes `fulfilmentProfile` from seller offers.
3. `lib/orders/create-order.ts` chooses between `create_order_atomic` and `create_order_atomic_v2` based on `isSplitOrder`, and passes `seller_offer_id` per line.
4. `sub_orders` (0064) is a seller-partitioned child of `orders`, and is read by **retailer** order detail (`retailer_order_sub_orders`) and **admin** order detail. `order_items.sub_order_id`, `source_type` and `seller_offer_id` are part of historical invoice/reorder data.
5. `seller_ledger`, `seller_payouts`, `collection_allocations` and `refund_sub_order_coins` (0067) are financial tables/functions. `collection_allocations` carries a `NOT NULL` FK to `sub_orders`.
6. `0109_phase3_business_control.sql` — part of the merged PR #139 — **requires** `public.sellers`, `public.seller_offers`, `public.seller_offer_tiers` and `public.is_active_seller_member(uuid)` to exist, and creates `product_moderation_history` with a `seller_offer_id`/`seller_id` FK pair plus `seller_pricing_permissions` and `seller_ad_campaigns`.

**Consequence for the removal:** "deleting the seller tables" is not a clean removal, it is an outage. The only safe path is a **forward-only capability revocation migration** that keeps every historical object, row and FK in place and removes *access*. Section 6 defines it.

---

## 3. Findings by audit category

Each finding is tagged with the required action:

- **REMOVE** — user-facing functionality, deleted from the codebase.
- **REVOKE** — database capability, disabled by a new forward-only migration; objects and rows preserved.
- **KEEP** — must remain, with the reason stated.

### 3.1 Login, registration, invitation, role assignment, authentication

| # | Location | Finding | Action |
| --- | --- | --- | --- |
| 1.1 | `supabase/migrations/0062_seller_identity.sql:38` | `alter type public.user_role add value if not exists 'seller'` — the role exists in the live enum. **Postgres cannot drop an enum value in place.** | **REVOKE** (acceptance refusal), not drop. |
| 1.2 | `lib/auth/roles.ts` | `UserRole` includes `'seller'`; `ROLE_HOME.seller = '/seller/dashboard'`; `ROLE_ROUTE_PREFIXES` has `/seller`; `ROLE_LABELS.seller`. | **REMOVE** from the type, and add an explicit refusal so an old session cannot proceed. |
| 1.3 | `lib/permissions/permissions.ts:147-148` | `seller: []` role map; `sellers.view/review/manage/offers.manage`, `suppliers.view/review/documents.manage` permission names. | **REMOVE** permission names and the map entry. |
| 1.4 | `middleware.ts:20, 117-138, 141` | `/seller` in `PROTECTED_PREFIXES`; a whole seller-membership/status gate; `/register-seller` treated as a "logged-in gets redirected" route. | **REMOVE**; replace with hard refusal for the retired role. |
| 1.5 | `app/login/page.tsx:31-33` | "Marketplace seller? Register" link to `/register-seller`. | **REMOVE**. |
| 1.6 | `app/register-retailer/page.tsx:37-38` | "Seller access by invitation" link. | **REMOVE**. |
| 1.7 | `app/register-seller/page.tsx`, `app/register-supplier/page.tsx` | Public seller invitation notice route; public supplier application route + form. | **REMOVE both routes**. |
| 1.8 | `lib/auth/sign-in-gate.ts` | Reads `profiles.role` and routes via `homeForRole`. A `seller` profile currently resolves to `/seller/dashboard`. | **KEEP + HARDEN** — must now refuse sign-in for the retired role. |
| 1.9 | `supabase/migrations/0070_*, 0072_super_admin_seller_invitations.sql` → `public.handle_new_user()` | The live trigger still contains the seller-invitation branch: nonce matching against `seller_account_invites`, `seller_members` insert, and the `seller_invite_required` refusal. | **REVOKE** — replace `handle_new_user()` to refuse any seller signup, keep the invitation tables as history. |
| 1.10 | `0072` → `public.reserve_seller_invite`, `attach_existing_seller_invite`, `claim_seller_invite_attempt` | Super-Admin-only invitation RPCs. | **REVOKE** execute + drop the RPC bodies' reachability. |
| 1.11 | `staff_account_invites` (0070) | Role check widened to `('staff','salesman','seller')`. | **REVOKE** — narrow the constraint back to staff/salesman so no new seller invite can be minted. |

### 3.2 Seller and Supplier dashboards, pages, navigation, forms

| # | Location | Finding | Action |
| --- | --- | --- | --- |
| 2.1 | `app/seller/**` (layout + 7 pages) | Full seller portal: dashboard, offers, orders/sub-orders, campaigns, profile, status. | **REMOVE**. |
| 2.2 | `components/seller/**` (5 components) | Campaigns panel, gate notice, offer manager, profile form, sub-order actions. | **REMOVE**. |
| 2.3 | `lib/seller/**` (guard, queries, actions, offer-gate) | Portal guard + tenant queries. | **REMOVE** (`offer-gate.ts` constants are also consumed by admin marketplace-launch — see 5.3). |
| 2.4 | `app/admin/sellers/**`, `app/admin/suppliers/**` (7 pages) | Admin seller directory/detail; supplier directory, supplier applications list + detail. | **REMOVE**. |
| 2.5 | `components/admin/create-seller-form.tsx`, `seller-invite-panel.tsx`, `seller-review-actions.tsx`, `supplier-application-form.tsx`, `supplier-documents-manager.tsx`, `supplier-review-actions.tsx` | Admin/seller/supplier management UI. | **REMOVE**. |
| 2.6 | `components/command-center/supplier-section.tsx` + `app/admin/command-center/page.tsx:84` | Supplier tab in the Command Center. | **REMOVE**. |
| 2.7 | `components/layout/admin-shell.tsx:51,56,57,58` | Nav: `Marketplace Launch`, `Suppliers`, `Sellers`, `Seller offers`. | **REMOVE** all four. |
| 2.8 | `app/admin/offers/page.tsx` | Seller offer moderation & price-floor console. | **REMOVE**. |
| 2.9 | `app/admin/marketplace-launch/page.tsx` + `lib/admin/marketplace/**` | Third-party marketplace launch switch (0098). | **REMOVE**. |
| 2.10 | `app/admin/banners/campaigns/page.tsx`, `app/admin/banners/page.tsx:57` | Paid seller ad campaigns entry point. | **REMOVE**. |
| 2.11 | `app/admin/compliance/page.tsx:296`, `app/admin/pricing/tiers/page.tsx:103`, `app/admin/pricing/wholesale/page.tsx:23`, `app/admin/products/[id]/page.tsx:256`, `app/admin/areas/page.tsx:59`, `app/admin/layout.tsx:16`, `app/admin/orders/[id]/page.tsx:110` | Seller/supplier references inside otherwise-valid admin pages (copy, links, a `can('sellers.offers.manage')` flag). | **REMOVE the references**, keep the pages. |
| 2.12 | `app/admin/content/page.tsx:217`, `app/admin/content/[id]/page.tsx:254` | `audience` option `sellers`. | **REMOVE** the option (see 5.6). |
| 2.13 | `app/legal/page.tsx:13,17` | Renders a "sellers" audience group. | **REMOVE**. |

### 3.3 Product ownership, seller listings, supplier catalogues, supplier applications

| # | Location | Finding | Action |
| --- | --- | --- | --- |
| 3.1 | `lib/admin/seller-actions.ts`, `seller-validation.ts`, `sellers-query.ts` | Admin seller CRUD/validation/listing. | **REMOVE**. |
| 3.2 | `lib/admin/supplier-actions.ts`, `supplier-application.ts`, `supplier-rate-limit.ts`, `suppliers-data.ts`, `suppliers-query.ts` | Supplier application submission, review, rate limiting, GRN-derived directory. | **REMOVE**. |
| 3.3 | `lib/seller/actions.ts`, `queries.ts` | Seller self-service writes and portal reads. | **REMOVE**. |
| 3.4 | `types/marketplace.types.ts` | Local seller/offer/sub-order types. | **REMOVE**. |
| 3.5 | `lib/retailer/marketplace-offers.ts`, `components/retailer/marketplace-offer-list.tsx` | Retailer-facing marketplace offer projection + PDP offer chooser. | **REMOVE**. |
| 3.6 | `types/database.types.ts:485` | Comment "merchant-published banner" — refers to Super Admin banner authors, not a seller. | **KEEP** (reword only). |
| 3.7 | `lib/admin/inventory/grn*`, `types/inventory.types.ts:31,44`, `app/admin/inventory/grn/**` | `supplier_reference` free-text field on GRN. This is **not** a supplier account or module — it is the vendor name printed on a goods-received note, part of warehouse stock intake. | **KEEP** — removing it would erase purchase provenance. |
| 3.8 | `supabase/migrations/0059_supplier_applications.sql` → `suppliers`, `supplier_documents`, `submit_supplier_application()`, `supplier-documents` storage bucket | Public application funnel + private document bucket. | **REVOKE** — keep tables/rows; drop public execute; close bucket policies. |

### 3.4 Seller pricing, quantity slabs, commissions, marketplace checkout

| # | Location | Finding | Action |
| --- | --- | --- | --- |
| 4.1 | `lib/orders/quote-order.ts` | `quoteSplitOrderForRetailer()`; `sellerOfferId` on every line type; `fulfilmentProfile`. | **REMOVE** seller branch; the Maharani-only path already exists and is byte-compatible. |
| 4.2 | `lib/orders/create-order.ts` | `sellerOfferId` on `RequestedOrderLine`; `isSplitOrder`; `create_order_atomic_v2` selection; `seller_offer_id` in `.rpc` args. | **REMOVE** — always use `create_order_atomic`. |
| 4.3 | `lib/retailer/order-actions.ts`, `saved-cart-actions.ts` | `seller_offer_id`/`sellerOfferId` plumbing, `'maharani' \| 'seller'` `SourceType`, offer re-pricing. | **REMOVE** seller branches. |
| 4.4 | `app/retailer/cart/page.tsx`, `cart/saved/page.tsx`, `catalog/[id]/page.tsx`, `orders/[id]/page.tsx`, `orders/[id]/reorder/page.tsx` | `seller_offer_id`, `source_type`, `sellerName`, `sellerGstin`, `fulfilmentType`, `retailer_order_sub_orders` reads. | **REMOVE**; keep the Maharani rendering. |
| 4.5 | `lib/admin/marketplace/actions.ts`, `queries.ts`, `validation.ts` | Marketplace launch approval RPCs (`record_marketplace_launch_approval`). | **REMOVE**. |
| 4.6 | `lib/seller/offer-gate.ts` | `checkSellerOfferGate`, `SELLER_AGREEMENT_KEY`, gate messages. | **REMOVE** (`lib/admin/marketplace*` consumers die with it). |
| 4.7 | `supabase/migrations/0063, 0068, 0069, 0098` | `seller_offers`, `seller_offer_tiers`, `offer_price_floors`, `seller_offer_price_history`; `enforce_seller_offer_rules`, `seller_set_offer_stock`, `seller_replace_offer_tiers`, `effective_seller_offer_unit_price_paise`, `guard_seller_offer_portal_write`, `remoderate_seller_offer_terms`, `drain_seller_offers_on_suspend`, `seller_offer_gate_status`. | **REVOKE** — drop the portal/trading RPCs, replace the enforcement trigger with a "no seller offers" guard. |
| 4.8 | `supabase/migrations/0069` → `marketplace_offer_quotes`, `marketplace_offers_for_product`, `marketplace_offer_tiers`, `retailer_order_sub_orders`, `seller_order_headers`, `seller_update_sub_order`, `seller_update_own_profile` | Retailer-facing offer RPCs + seller portal RPCs. | **REVOKE** — revoke execute from `authenticated`, drop functions. |
| 4.9 | `supabase/migrations/0065, 0082, 0085` → `create_order_atomic_v2`, `place_order_*` split paths | The v2 checkout RPC writes `sub_orders` with a seller partition. | **KEEP** the function (historical callers/tests) but **REVOKE** `authenticated` execute; the app always uses v1. |

### 3.5 Seller approval, verification, moderation, KYC, compliance

| # | Location | Finding | Action |
| --- | --- | --- | --- |
| 5.1 | `supabase/migrations/0062` → `sellers`, `seller_members`, `enforce_seller_status_transitions`, `is_member_of_seller`, 4+3 policies | Seller identity + membership. | **REVOKE** — drop `is_member_of_seller` execute, drop seller write policies, keep rows. |
| 5.2 | `supabase/migrations/0086` → `seller_compliance_reviews`, `product_compliance_evidence.seller_id` | Seller compliance review, plus **centrally-held** product evidence. | **REVOKE** the seller review surface; **KEEP** `product_compliance_evidence` (Super Admin uses it). |
| 5.3 | `supabase/migrations/0098` → `legal_document_current_versions`, `marketplace_launch_approvals`, `seller_offer_gate_status()` | Marketplace legality gate. `legal_document_current_versions` is also used by `record_legal_acceptance` for **retailer** terms. | **KEEP `legal_document_current_versions` + `record_legal_acceptance`** (retailer terms depend on them). **REVOKE** `marketplace_launch_approvals` writes + `seller_offer_gate_status`. |
| 5.4 | `supabase/migrations/0091` → `refund_sub_order_coins` / child cancellation/refund | Historical seller refund path. | **KEEP** — needed to unwind historical seller orders honestly. |
| 5.5 | `supabase/migrations/0109` (PR #139) → `product_moderation_history`, `seller_pricing_permissions`, `seller_ad_campaigns`, `seller_ad_campaign_audit` | Requires seller tables in its preflight; FKs to `sellers`/`seller_offers`. | **KEEP 0109 exactly as merged.** Its preflight is why the seller *tables* must survive. |
| 5.6 | `lib/legal/content.ts:70-137`, `docs/legal-review/*` | Seller Agreement and Seller Compliance Declaration legal text, published as site pages. | **REVOKE publication** (unpublish the pages) but **KEEP** the document rows/version history for audit; do not rewrite published legal history. |

### 3.6 APIs, RPCs, server actions, DB functions, background jobs

| # | Location | Finding | Action |
| --- | --- | --- | --- |
| 6.1 | `app/api/mobile/v1/pages/route.ts:48`, `pages/[slug]/route.ts:74` | Accepts/returns `audience: 'sellers'`. | **REMOVE** the value from the accepted enum. |
| 6.2 | `app/api/mobile/v1/orders/[id]/invoice/route.ts:97-99` | `source_type === 'seller'` → `hasMarketplaceSellerLine` → invoice refusal. | **KEEP** the refusal path (it protects *historical* seller orders), but source it from a Maharani-only model. |
| 6.3 | `lib/retailer/tax-invoice-readiness.ts` | Fail-closed invoice readiness for marketplace seller lines. | **KEEP** — historical seller orders must still be refused an invoice rather than issued a wrong one. |
| 6.4 | `app/api/**` | No dedicated seller/supplier API route exists. | Confirmed — nothing to delete. |
| 6.5 | `supabase/migrations/0079_api_execute_hardening.sql:168` | Grants that call `is_member_of_seller(so.seller_id)`. | **REVOKE** with the helper in 5.1. |
| 6.6 | `lib/storage/signed-url.ts:19` | `'supplier-documents'` bucket in the allow-list. | **REMOVE** from the allow-list. |
| 6.7 | `.env.local.example` → `SUPPLIER_RATE_LIMIT_SECRET` | Supplier-application rate-limit key. | **REMOVE** the variable and its docs. |

### 3.7 Database objects, FKs, triggers, RLS, grants, storage policies

Full object inventory (all created by already-applied migrations — **nothing here is dropped**):

**Tables (18):** `sellers`, `seller_members`, `seller_offers`, `seller_offer_tiers`, `seller_offer_price_history`, `offer_price_floors`, `seller_ledger`, `seller_payouts`, `seller_shipments`, `seller_account_invites`, `seller_compliance_reviews`, `seller_pricing_permissions`, `seller_ad_campaigns`, `seller_ad_campaign_audit`, `suppliers`, `supplier_documents`, `supplier_application_rate_limits`, `sub_orders`.

**Enums/types (2):** `user_role` includes `'seller'`; `seller_account_invites` role checks.

**Functions (≈30):** seller/supplier identity, offer, settlement, portal, invitation, gate and moderation functions, enumerated in §3.4/§3.6.

**FK columns pointing at `sellers` (13 total = 5 `cascade` + 7 `restrict` + 1 `set null`)** — including `sub_orders.seller_id` (restrict), `seller_shipments.seller_id` (restrict), `seller_ledger.seller_id`, `product_compliance_evidence.seller_id` (cascade), `product_moderation_history.seller_id` (set null).

**`sub_orders` dependants:** `order_items.sub_order_id`, `collection_allocations.sub_order_id` (**NOT NULL, restrict**), `seller_ledger.sub_order_id` (restrict), `seller_shipments.sub_order_id` (cascade).

**Storage:** `supplier-documents` private bucket + 2 object policies (0059).

**Non-negotiable:** because `collection_allocations.sub_order_id` is `NOT NULL`/`restrict` and 0109's preflight demands `public.sellers`, **dropping any seller table is impossible without destroying payment-collection history and breaking the merged 0109.** All database action is therefore revocation, not deletion.

### 3.8 Notifications, emails, reports, analytics, admin controls

| # | Location | Finding | Action |
| --- | --- | --- | --- |
| 8.1 | `app/admin/reports/**`, `lib/admin/dashboard/**` | Any seller/supplier metric. | **REMOVE** seller/supplier rows; keep retailer/order reporting. |
| 8.2 | `app/admin/command-center/**` | Supplier intel tab. | **REMOVE** the tab (see 2.6). |
| 8.3 | `content/site-pages.seed.json:318,324,497-529,864-926` | Seller-audience page + marketplace wording inside otherwise-valid legal pages. | **REVOKE** the seller-audience page; **correct** the marketplace claims (see note below). |

**Legal-content note (honesty requirement):** several **published** pages currently describe a marketplace ("this website sells goods from our own stock and can also show offers from independent sellers"). Once third-party selling is removed, those statements become false. A forward migration should unpublish/mark-for-review the pages whose text promises a marketplace, rather than silently leaving a false public promise online. This is flagged as an **owner decision** in §7.

### 3.9 Tests, fixtures, mocks, seed data, docs, env

| # | Location | Finding | Action |
| --- | --- | --- | --- |
| 9.1 | `tests/seller-*.test.ts` (4), `tests/supplier-*.test.ts` (5), `tests/suppliers-directory.test.ts` | Dedicated suites. | **REMOVE**; replace with removal-proof suites (Phase 7). |
| 9.2 | `tests/helpers/supabase-fixture.ts`, `pg-harness.ts` | Shared fixtures referencing sellers. | **KEEP harness**, drop seller-specific fixtures that no longer compile. |
| 9.3 | `tests/*` — ~53 further suites | Incidental seller strings inside retailer/admin/security tests. | **UPDATE** assertions, do not delete the suites. |
| 9.4 | `docs/SELLER_MARKETPLACE.md`, `docs/SUPER_ADMIN_SUPPLIER_INVENTORY.md`, `docs/SUPPLIER_REGISTRATION_PROPOSAL.md`, `docs/legal-review/MARKETPLACE_SELLER_AGREEMENT.md`, `docs/legal-review/SELLER_COMPLIANCE_DECLARATION.md` | Documents describing the removed module. | **MARK SUPERSEDED** (do not delete — they are review history). |
| 9.5 | `supabase/publication/**` | Publishes `seller-agreement` legal page. | **KEEP the SQL as history**, flag for a forward publication change. |

### 3.10 PWA and Android

| # | Location | Finding | Action |
| --- | --- | --- | --- |
| 10.1 | PWA manifest/service worker (`components/pwa`, `public/`) | No seller/supplier route is precached. | **No change required** — verify after routes are removed. |
| 10.2 | `android/app/src/test/**/RetailerRenderedLayoutTest.kt:37,39,85,121,134,147` | "Test supplier" is a **brand name string in a retailer UI test fixture**, not a supplier module. | **KEEP** (or rename to avoid confusion). |
| 10.3 | `android/app` source | No seller/supplier screens, no seller role, no supplier API calls. | **No change required**; run `android:test`/`android:lint` only (no APK/AAB). |

---

## 4. What must NOT be touched

1. **Any already-applied migration file, byte for byte** — 0001–0109 including every seller migration. Adding a new forward migration is the only permitted schema action.
2. **PR #139** (`450e22f`) and `0109_phase3_business_control.sql` — including its seller-table preflight and its `sellers`/`seller_offers` FKs.
3. **Historical financial data** — `orders`, `order_items`, `payments`, `payment_collections`, `collection_allocations`, `seller_ledger`, `seller_payouts`, `refunds`, invoices, `audit_logs`.
4. **`sub_orders`, `seller_ledger`, `collection_allocations`, `product_compliance_evidence`, `product_moderation_history`, `legal_document_current_versions`, `record_legal_acceptance`** — needed for history, audit and (for the last two) live retailer terms acceptance.
5. **Retailer and Super Admin features** that merely mention a seller — cart, checkout, orders, invoices, reorder, catalogue, pricing, inventory, GRN `supplier_reference`, staff/salesman modules.
6. **The Super Admin account itself** — `super_admin` bootstrap (0106) and `is_super_admin()` must keep working.
7. **No production contact** — no `db push`, no DDL/DML against `fhrmsrumsraprvutrpeo`, no Auth/SMTP/env changes, no deploy.

---

## 5. Proposed approach (for approval)

**Phase 2 (code):** delete the 38 dedicated seller/supplier modules and their routes; strip seller/supplier plumbing out of the shared retailer/admin code paths listed in §3.4 and §3.6; keep every historical-data read that protects an existing order/invoice.

**Phase 3 (authorization):** remove `seller` from `UserRole` and every permission map; make sign-in and middleware **refuse** a profile whose role is `seller` (session revoked, logged out, `/login?error=role_retired`) instead of redirecting it somewhere; keep `retailer` and `super_admin` (canonical admin roles: `super_admin`, plus existing `admin`/`staff`/`salesman` unchanged) fully working.

**Phase 5 (database):** one new forward-only migration that **revokes capability, keeps data**:
- replaces `handle_new_user()` to refuse all seller signups;
- revokes `execute` on every seller/supplier RPC from `anon`/`authenticated`;
- narrows `staff_account_invites` back to staff/salesman;
- replaces seller-offer enforcement/portal triggers with deny guards;
- drops seller/supplier **write** policies while retaining read access confined to `super_admin` for audit;
- closes the `supplier-documents` storage bucket policies and drops `submit_supplier_application` execute;
- records every step with explicit guards, safe ordering and a documented rollback.

**Phase 7 (proof):** new tests that assert the removals **and** that retailer/super-admin flows and historical order/payment/refund reads still work.

---

## 6. Open decisions that need the owner, not the agent

1. **Legal pages that promise a marketplace.** 5–8 published pages currently tell the public that independent sellers may sell here. Removing the module makes those statements untrue. Options: (a) unpublish those pages, (b) mark them "under review" and leave them live, (c) rewrite them. Rewriting published legal text is an owner/legal decision, not a code decision.
2. **`seller` rows in `profiles` for real people.** Revoking the role locks out those accounts entirely (by design, per the brief). Confirm no former seller is also a legitimate retailer under the same login.

   **Resolved during owner review — the answer is yes, and the first implementation got it wrong.** §2 of this audit records that `public.retailers` is a separate table keyed on the same profile id, so a `role='seller'` profile *can* own an approved `retailers` row. The initial block 7 ignored that and deactivated the whole population in one statement, destroying the retailer half of those accounts. It now splits the population on evidence already in the database: seller-only → deactivated and never converted; dual-role with `retailers.status='active'` → re-roled to `retailer` and kept active (their effective permissions are unchanged, because `is_active_account()` already required that status); dual-role not approved → deactivated, role untouched. Block 8 now raises if any profile with an active `retailers` row is not an active `retailer`. See `docs/repair/SELLER_SUPPLIER_REMOVAL_DATABASE_SAFETY.md` §4.1.
3. **`supplier_reference` on GRN.** I intend to keep it (purchase provenance, not a supplier module). Say if you want it removed too.

   **Resolved: kept.** A test pins it (`keeps grns.supplier_reference — purchase provenance is historical data`), and the admin surface shows it as "Purchases & GRN".

4. **Which business identity is the legal seller / invoice issuer / GST registrant.** Not answered by the owner, so **not asserted** anywhere. The corrected copy states only that the identity appears on the invoice and on the Contact and Legal Information page. `tests/business-identity-claims.test.ts` fails the build if any affirmative claim returns. This remains the one open legal decision.

---

## 7. Verdict

**Phase 1: COMPLETE.** The dependency map above is exhaustive for the live tree, the migration set, the tests and the docs.

I have **not** started Phase 2 deletion yet. Two reasons, both structural:

- The **13 `sellers` FKs + `collection_allocations.sub_order_id` + 0109's preflight** mean the database half of this task is a capability revocation, not a schema deletion. If you expected `drop table sellers`, that is not achievable without destroying payment history and breaking the merged PR #139, and I will not do it.
- The **published-legal-page contradiction** (§6.1) is a decision about what the company tells the public, and it changes what the code must do.

Tell me to proceed with the approach in §5 (and answer §6.1–6.3 if you have a preference), and I will execute Phases 2–8 on this branch without touching production.
