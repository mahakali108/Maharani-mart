# Seller & Supplier Removal — Implementation Report

**Repository:** `mahakali108/Maharani-mart`
**Branch:** `arena/b4ce4177-maharani-mart`
**Base commit:** `450e22fd4390a1396b460b40116fe911aed9a306` (main, containing PR #139 / migration 0109)
**Migration added:** `supabase/migrations/0110_retire_seller_supplier_marketplace.sql`
**Rollback added:** `supabase/rollbacks/0110_retire_seller_supplier_marketplace.down.sql`
**Status:** implementation complete in the repository. **Nothing was applied to production.**

---

## 1. What the platform is now

Maharani Traders is a **single-seller wholesale and retail store**. Two kinds of account have a
workspace:

| Actor | Can do |
| --- | --- |
| **Retailer** | Register, sign in (password + email OTP), browse and search the catalogue, view product details, cart, saved cart, checkout, orders, order history, tracking, tax invoices, wholesale slabs, membership discounts, own profile, support tickets. |
| **Super Admin** | Everything: products, catalogue, images and descriptions, prices, slabs, inventory, stock status, retailer accounts, orders/cancellations/delivery/refunds, membership plans, website content, banners, platform settings, reports. |

`admin`, `staff` and `salesman` remain as internal operational roles. They are **not** marketplace
roles and were deliberately left untouched.

Every product is bought, priced, stocked and sold by Maharani Traders. There is no third-party
seller of record, no marketplace, no supplier programme, and no commission or settlement model.

---

## 2. The load-bearing finding from the Phase 1 audit

`docs/audit/SELLER_SUPPLIER_REMOVAL_PHASE1_AUDIT.md` recorded the finding that decided the shape of
this work:

> **The seller surface underpinned the live ordering spine.** `orders`/`order_items`/`sub_orders`,
> `create_order_atomic` v1 **and** `create_order_atomic_v2`, the cart merge path, coupon
> line-building and the invoice issuer model all carried a first-class "seller offer" branch. Deleting
> the seller UI without changing those paths would have written rows referencing a seller that no
> longer exists.

The response was to make the **spine pack-only** rather than to delete the ordering code:

* `lib/orders/quote-order.ts`, `lib/orders/create-order.ts` — only the v1 RPC is used
  (`create_order_atomic`); the split/seller path is gone.
* `lib/retailer/cart-merge.ts`, `cart-service.ts`, `cart-rpc.ts`, `cart-actions.ts`,
  `saved-cart-actions.ts` — rewritten pack-only.
* `lib/coupons/cart-lines.ts` — coupon lines are built from packs only.

`create_order_atomic_v2` was already `service_role`-only since 0065, so leaving its body untouched is
safe: no API role can call it.

---

## 3. Routes removed

**Application routes deleted (58 paths in the first pass, plus follow-ups).** No page or layout file
remains for any of these — this is asserted by
`tests/seller-supplier-retirement-authorization.test.ts`, which checks the filesystem.

| Removed route | Was |
| --- | --- |
| `/seller/*` (entire workspace) | Seller dashboard, offers, orders, profile, settlements, ads |
| `/register-seller` | Public seller sign-up |
| `/register-supplier` | Public supplier application |
| `/admin/sellers` | Seller directory |
| `/admin/suppliers`, `/admin/suppliers/applications` | Supplier ledger and applications |
| `/admin/offers` | Seller offer moderation, offer price floors |
| `/admin/marketplace-launch` | Marketplace launch gate |
| `/admin/banners/campaigns` | Seller ad campaigns |

**Kept, with a new name and no seller concept:** `/admin/inventory/grn` and the former supplier
section are now **"Purchases & GRN"** (`components/command-center/purchase-ledger-section.tsx`).
There was never a `suppliers` master table — `/admin/suppliers` was a view derived from
`grns.supplier_reference`. Purchase history therefore survives intact, and
`grns.supplier_reference` is **preserved and still displayed** as the historical purchase ledger
reference.

**Retired URL handling.** `lib/auth/roles.ts` classifies all eight prefixes in
`RETIRED_ROUTE_PREFIXES`. `middleware.ts` consults `isRetiredPath()` **before** the auth and role
checks, so a stale bookmark gets a clean 404 rather than a redirect loop, a 500, or an implication
that the module still exists. A test pins that ordering.

---

## 4. Code deleted or rewritten

**Deleted (modules):**

* `components/admin/ad-campaigns-manager.tsx`, `lib/admin/ad-campaign-query.ts`,
  `lib/admin/ad-campaign-rules.ts` — seller advertising.
* `components/admin/offer-row-actions.tsx` — orphaned by the offer page removal.
* 11 seller/supplier test suites (marketplace actions, marketplace DB, offer gate, seller agreement
  gate, supplier actions, supplier applications ×2, supplier rate limit, suppliers directory,
  marketplace launch UI, catalog seller compliance migration).

**Rewritten:**

| File | Change |
| --- | --- |
| `lib/auth/roles.ts` | `UserRole` no longer contains `seller`; added `RETIRED_ROLES`, `isRetiredRole()`, `isSupportedRole()`, `isRetiredPath()`. |
| `middleware.ts` | Retired-role and retired-path refusal. |
| `lib/auth/session.ts` | `requireUser()` refuses a retired role. |
| `lib/auth/sign-in-gate.ts` | New `role_retired` outcome. |
| `lib/permissions/permissions.ts` | Whole `sellers.*` permission union removed. |
| `components/admin/wholesale-pricing-control.tsx` | Seller-specific pricing-permission card and its two actions removed; remaining copy is about centrally-owned packs. |
| `lib/admin/wholesale-pricing-query.ts` | `sellerPermissions` and `sellers` no longer read. |
| `lib/admin/wholesale-pricing-rules.ts` | `validateSellerOfferAgainstLimits`, `validateSellerSlabAgainstLimits`, `validateSellerPermissionInput` removed. |
| `lib/admin/dashboard/{types,data}.ts` | `SuperAdminBusinessOperations` reshaped to retailer / catalogue / order counters. |
| `components/admin/dashboard-view.tsx` | Seller/marketplace card → Retailers, Products, Inventory, Orders. |
| `lib/media/{types,access}.ts`, `lib/storage/signed-url.ts` | `supplier-document` media kind removed from all three places it is declared. |
| `lib/site-content/types.ts` | `sellers` audience kept as a **historical read** type; edits are narrowed to `everyone`/`buyers` via a new `EditableSitePageAudience`; the label reads "Sellers (retired)". |
| `app/legal/page.tsx` | Legal index lists only live audiences; a historical `sellers` page is deliberately not listed (never deleted). |
| `app/api/mobile/v1/pages/route.ts`, `.../[slug]/route.ts` | Never surface the retired `sellers` audience to a client. |
| `lib/returns/resolution.ts` | `SELLER_RETURN` message now says the programme ended, rather than "not available yet". |
| `lib/retailer/tax-invoice-readiness.ts` | Historical third-party line still blocks invoice issuance (correct), with truthful wording. |
| `components/layout/admin-shell.tsx` | 4 nav entries removed, `SupplierSection` → `PurchaseLedgerSection`. |
| `app/admin/products/[id]/page.tsx` | "Review seller offers →" dead link removed; moderation history kept. |
| `app/admin/pricing/wholesale/page.tsx` | "Offer price floors" dead link removed. |
| `app/retailer/{brands,categories,notifications}`, `app/retailer/membership` | Customer-facing copy no longer mentions a marketplace or third-party prices. |

**Preserved deliberately** (not "dead code", each has a historical reason):

* `lib/admin/sub-order-actions.ts` — Super Admin historical settlement. Was deleted once during this
  work and **restored**, re-gated on `orders.return.manage`. Deleting it would have removed the only
  way to settle a historical sub-order.
* The read-only, de-identified "Third-party fulfilment (historical)" block on
  `app/retailer/orders/[id]/page.tsx`. Seller name and GSTIN removed; the line-item provenance is
  kept.
* Internal identifiers no user sees (`SupplierIntel`, `intel.suppliers`,
  `COMMAND_CENTER_TABS.suppliers`, `retailer_order_sub_orders`) — renaming plumbing risks breakage for
  no user-visible benefit.

---

## 5. RPCs and database capability disabled

`0110` **revokes, and never drops.** Full detail is in `SELLER_SUPPLIER_REMOVAL_DATABASE_SAFETY.md`;
the summary:

| Group | Functions | After 0110 |
| --- | --- | --- |
| Seller portal | `seller_set_offer_stock`, `seller_replace_offer_tiers`, `seller_update_sub_order`, `seller_update_own_profile`, `seller_order_headers`, `seller_offer_gate_status` | EXECUTE revoked from every API role. Bodies untouched. |
| Seller invitations | `reserve_seller_invite`, `attach_existing_seller_invite`, `claim_seller_invite_attempt` | Revoked. No new seller account can be invited or minted. |
| Marketplace projection | `marketplace_offer_quotes`, `marketplace_offers_for_product`, `marketplace_offer_tiers`, `effective_seller_offer_unit_price_paise`, `third_party_offers_enabled`, `current_offer_floor_paise`, `record_marketplace_launch_approval` | Revoked. |
| Supplier funnel | `submit_supplier_application`, `consume_supplier_application_rate_limit` | Revoked from `anon` + `authenticated`. |
| Signup | `handle_new_user()` | Replaced: the invitation-consuming seller branch is gone; an explicit non-retailer signup is refused. |
| **Kept executable** | `retailer_order_sub_orders`, `close_sub_order_atomic`, `set_sub_order_status`, `is_member_of_seller`, `is_active_seller_member`, `seller_agreement_is_current` | Required by historical settlement, by live RLS policies, and by 0109's preflight. See §7. |

**RLS:** seller **write** policies removed; administrative **read/update** paths kept so a Super Admin
can still audit, annotate and close historical records. Specifically retained:
`seller_offers_admin_update`, `suppliers_admin_update`, `seller_members_admin_insert/delete`,
`sellers_select` (admin), `seller_ledger_read`, `seller_shipments_select`,
`offer_price_floors_admin_select`, `seller_invites_super_admin_read`.

**Storage:** the `supplier-documents` bucket object policies are dropped. The bucket and its objects
are kept.

---

## 6. Preserved records — explicitly not touched

No table, row, column or foreign key was deleted by this work.

`sellers`, `seller_members`, `seller_offers`, `seller_offer_tiers`, `seller_offer_price_history`,
`offer_price_floors`, `seller_ledger`, `seller_payouts`, `seller_shipments`,
`seller_account_invites`, `seller_compliance_reviews`, `seller_compliance_evidence`,
`seller_compliance_review_audit`, `seller_pricing_permissions`, `seller_ad_campaigns`,
`seller_ad_campaign_audit`, `suppliers`, `supplier_documents`,
`supplier_application_rate_limits`, `sub_orders`, `collection_allocations`, `payment_collections`,
`orders`, `order_items`, `return_requests`, `grns`, `grn_items`, `audit_logs`,
`super_admin_audit_logs`, `product_moderation_history`, `legal_document_current_versions`.

Three hard constraints force this, all verified in-repo and asserted by
`tests/migration-0110-seller-supplier-retirement.test.ts`:

1. `collection_allocations.sub_order_id` is `NOT NULL` with `ON DELETE RESTRICT` (0067). Dropping
   `sub_orders` would destroy payment-collection history.
2. Thirteen foreign keys point at `public.sellers` (5 cascade / 7 restrict / 1 set null).
3. 0109 (merged as PR #139) has a preflight that raises `MIGRATION ORDER VIOLATION` unless
   `public.sellers`, `public.seller_offers`, `public.seller_offer_tiers` and
   `public.is_active_seller_member(uuid)` exist.

`user_role` also still contains the value `seller`. PostgreSQL cannot drop an enum value in place,
and re-creating the type would rewrite every dependent column and all history. It is therefore
refused at runtime instead — in `middleware.ts`, `requireUser()`, `assertSignInAllowed()`, and in the
database by `0110`'s replacement `handle_new_user()`.

---

## 7. Two deliberate compromises, and why

**a) `is_member_of_seller` / `is_active_seller_member` stay executable.**
The first draft of `0110` revoked them. That broke migration application itself with
`permission denied for function is_member_of_seller`: live RLS policies from 0062, 0063, 0086 and 0109
still *call* these predicates, and a revoked function makes a policy raise instead of returning
`false`. Keeping them is correct and leaks nothing — every seller-role profile is deactivated by
`0110`, so both return `false` for every caller. Access was removed by the policy changes, not by
these predicates. The migration documents this reasoning in place.

**b) A former seller who also trades legitimately is deactivated, not converted.**
The brief forbids mechanically converting seller-only accounts into retailers, and the schema cannot
express two roles on one profile. `0110` therefore sets `is_active = false` for seller-role profiles
and emits a `NOTICE` with the exact count, so the owner can deliberately create or re-approve a
retailer account. Nothing is deleted — profiles, auth users, membership rows and their order history
all remain. The rollback re-activates them only behind an explicit opt-in setting
(`maharani.reactivate_seller_profiles = 'true'`).

---

## 8. Website and legal content

The Phase 1 audit found 12 sentences across 10 managed pages that described the marketplace as a live
or possible feature. Leaving them would have told customers something untrue.

Both halves were changed in lockstep so they cannot drift:

* `scripts/generate-site-content-seed.mjs` — a `RETIRED_MARKETPLACE_COPY` / `_SENTENCES` replacement
  table keyed on the **exact** superseded sentence, applied as a final pass to every page.
* `content/site-pages.seed.json` — regenerated. A byte-for-byte diff confirmed the hand-edit and the
  generator agree, and the existing "generator drift" test now enforces it.
* `supabase/migrations/0105_seed_site_content.sql` — regenerated (0104/0105 have never been applied to
  production, verified in `docs/PR134_FINAL_REVIEW_2026-11-15.md`, so this is safe).
* `0110` also carries the same replacement table as a **guarded** in-place rewrite for any database
  where the content is already seeded. It only replaces an exact sentence, never touches
  `status` / `published_at` / `published_snapshot` / `version` / `effective_date`, and then raises if
  any surviving page still says "marketplace and seller features".

**Legal page decisions:**

* **`/legal/marketplace-disclaimer` is kept, unpublished.** It is the accurate record of a programme
  that existed. It is removed from the stage-2 publication list so it is never presented as a current
  statement; the owner can archive, republish or delete it as a business decision. This boundary
  change is called out explicitly under blockers.
* **`/legal/seller-agreement` is kept, unpublished, and removed from stage 2.** Since no seller
  account can be created or invited, nothing can trigger its acceptance requirement. Its wording,
  its page and its `legal_document_current_versions` row are all preserved.
* `supabase/publication/stage2_publish_reviewed_additions.sql` and
  `verify_continuity.sql` and `README.md` were updated so the staged-publication plan is 9 + 9 pages
  plus one deliberately-held page, not 9 + 10.
* No GSTIN, legal name, address, phone, grievance officer, statutory contact or registration number
  was invented. `AJAY GENERAL` (proprietorship) / `MAHARANI TRADERS` (brand) are unchanged. Uncertain
  text ("has not been independently verified", "should be verified") is marked for professional
  review, not silently strengthened or deleted.

---

## 9. Test and verification results

See `SELLER_SUPPLIER_REMOVAL_TEST_REPORT.md` for the full breakdown.

Baseline before any change: **239 files / 3644 tests**, typecheck ✅, lint ✅.
After the post-retirement edits, **final:** **230 files / 3433 tests, all passing, EXIT=0**;
typecheck ✅, lint ✅ (0 errors, 0 warnings), `next build` ✅.

The file/test count fell because 11 seller/supplier suites were deleted with the modules they
covered. Two new suites were added:
`tests/migration-0110-seller-supplier-retirement.test.ts` (10 tests) and
`tests/seller-supplier-retirement-authorization.test.ts` (10 tests).

---

## 10. What was NOT done

* No production SQL, no `supabase db push`, no migration applied to `fhrmsrumsraprvutrpeo`.
* No production Auth / SMTP / env / Storage policy change.
* No manual production deploy; no Cloudflare or hosting change.
* No APK/AAB build.
* The PR is **not merged**.
* No production data deleted; the legacy project `gbxhmffsbsfhdrfuwurx` was never accessed.
