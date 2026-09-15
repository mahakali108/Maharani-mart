# Retailer homepage upgrade — audit and rollout

Date: 2026-09-15. Audited against `9674445d400d2fc7d75a1b7e13ee1da8d20e5a00` and merged [PR #60](https://github.com/mahakali108/Maharani-mart/pull/60). This change is for review against `main`; it does not merge or deploy itself.

## Audit: retain the working pieces, repair the gaps

| Area | Already present / retained | Missing or weak behavior addressed |
| --- | --- | --- |
| Retailer shell / PR #60 | Sticky shell, search toggle, notification and cart counts, account, PDP back/history fallback | 320px wordmark/controls, keyboard skip target, focus and width protection. Mobile tabs now Home / Categories / Cart / Orders / Account; Brands remains on desktop and home. |
| Identity | Authenticated profile and retailer area relationship | Visible welcome, real shop/area/address when supplied, request-local shared profile lookup. No invented retailer or delivery-area fallback. |
| Discovery/navigation | Quick order, purchase reports, catalog, offers, category/brand links, favourites, new arrivals | Prominent working search and shopping shortcuts, featured grid, wrapping section actions, useful empty/error/loading states. Existing utilities remain accessible. |
| Banners | Active database banners, area and schedule, image/title/link, admin management | Merchant-authored optional subtitle/CTA, safe same-tab internal targets, date parsing, truly hidden empty carousel, inactive slides untabbable, keyboard controls and reduced-motion/pause behavior. |
| Taxonomy | Active categories/brands and catalog filters | Home counts include active immediate subcategories, matching the catalog filter. Unknown counts are not zero; empty brands are hidden. |
| Product cards | Real catalog packs, images, favourites and existing Add action | Chosen pack, MOQ, MRP, image and price now agree. Price comes from the canonical selling engine at MOQ, not an internal case-derived reference when selling slabs exist. Responsive grid, true availability/unknown status, responsive image recovery and exact-pack details. |
| Wholesale deals | Existing selling tiers and offers | Reachable best-slab cards, honest quantity ranges (including bounded/non-monotonic rates), GST-inclusive rates, real MRP/extra savings, and bulk-pricing PDP links. |
| History | Own-order buy-again/frequency and reorder review/action | One shared history read, exact previous packs and piece/case snapshots, last quantities, current terms, direct reorder, unavailable product/pack states and existing review route. Only actual own history is described as frequently ordered. |
| Cart / credit | Persistent database cart, server layout count, wallet/ledger | Home item count, pieces, canonical current subtotal, real MRP savings, empty/unavailable/review states. Wallet and ledger are retained; missing credit configuration is not fabricated. |
| Service information | Existing help centre, company configuration, invoices, MOQ enforcement | Compact service cards show dispatch/delivery/GSTIN/phone only if configured. No replenishment prediction is represented as a delivery promise. |
| Mutations | Permission checks, cart action, current quantity/pricing validation, stock lifecycle | Shared reorder validation, owner-scoped updates, read/write failures surfaced, combined quantity cap and layout revalidation. Pending state stays active for the entire async action (React 18 transitions alone did not do this). |

No product, price, stock, discount, retailer identity, banner or delivery promise was seeded/hardcoded into the application. Test fixture values are confined to tests. No copied marketplace branding/assets were added. PDP, gallery, checkout, FEFO reservation and existing application routes are not replaced.

## Data and money boundaries

- `getRetailerShoppingContext` uses React's request-local cache, not a cross-user cache. Existing session, role, approval and suspension guards remain. Cart/history reads and cart writes retain explicit retailer ownership filters in addition to database RLS.
- `loadRetailerHome` batches banner, taxonomy, discovery, own history, own cart and favourite reads. Discovery is bounded at 80 products; history at 40 own orders; direct reorder at 8 packs. Missing product records are fetched once. Pricing/availability results are shared across featured, deals, history and cart sections rather than fetched per card.
- Product/price/availability reads are chunked. Availability uses the existing sanctioned retailer RPC, not privileged warehouse reads. An unavailable RPC means **stock not confirmed**, never invented stock.
- All quantity previews use `calculateRetailerPiecePrice`. Selling tiers take precedence; retailer/area overrides remain the canonical no-tier fallback. Client props contain selling terms, not case-cost totals or raw inventory quantities. A failed price/profile read cannot quietly substitute a cheaper rate.
- Cart totals use integer-paise line pricing and inclusive GST. Missing/inactive/unpriceable items make the subtotal unavailable; absent MRP makes savings unavailable, not an invented saving. A cart exceeding the 250-line home detail bound is identified as incomplete rather than presenting partial totals as complete.
- Home Add calls the existing `addToCartAction`; direct reorder calls the existing `addReorderLinesToCartAction`. Neither accepts a price from the browser. Server identity, permissions, activity, whole-piece bounds, MOQ and current selling-price validation remain authoritative. Failed price reads and failed writes are returned as errors.
- **Stock reservation is unchanged:** adding/reordering into a cart does not reserve stock. The existing admin-confirmation/approval FEFO path performs stock reservation and stock/expiry checks. UI availability is not a reservation guarantee.
- Cart merge remains sequential and nontransactional. A multi-line failure can follow partial application; this work does not claim atomic cart updates or live concurrency/RLS verification.

## Rollout

1. Apply migrations through `0047` using the project's normal migration process. `supabase/migrations/0047_banner_content.sql` adds nullable `banners.subtitle` and `banners.cta_label` with `IF NOT EXISTS`; it does not seed content, alter banner scheduling, change RLS, or drop data.
2. Apply `0047` **before using the updated banner create/edit form**. Public home reads intentionally tolerate old banner rows without those optional fields. The production validation script now probes both columns before applying this migration.
3. Configure only confirmed merchant information in the deployment environment; unset values stay hidden:

   | Environment variable | Use |
   | --- | --- |
   | `COMPANY_DISPATCH_NOTE` | Real dispatch/warehouse note, if available |
   | `COMPANY_DELIVERY_ESTIMATE` | Real delivery estimate, not inventory replenishment lead time |
   | `COMPANY_GSTIN` | Existing company/invoice GSTIN; enables the GST-invoice service link |
   | `COMPANY_PHONE` | Existing support number, shown with the existing help route |
   | `NEXT_PUBLIC_SITE_URL` | Existing site origin; normalizes own-site absolute banner links to relative navigation |

   Examples are intentionally blank in `.env.local.example`. The existing `/retailer/help` route remains available even without a configured telephone number.
4. Use existing admin controls to manage active products, variants, tiers, images, taxonomy and banner content. No demo records are required by this implementation.
5. After deployment, run an authenticated smoke test with an approved retailer and real configured data: scheduled/area banner, category/brand filter, search/PDP, Add and refreshed cart badge, canonical cart totals, exact-pack reorder, Orders/Account, and out-of-stock/MOQ changes. Also confirm a non-retailer and suspended/pending account are rejected and that one retailer cannot access another retailer's cart/order.

**Not performed here:** migration application, production validation script execution against a database, live authenticated E2E or live RLS checks. The sandbox did not have Supabase application/database credentials. No application fixture route, auth bypass or service-role workaround was added.

## Verification

Final local run on 2026-09-15 (after the implementation and regression fixes):

| Check | Actual result |
| --- | --- |
| `pnpm test` | **PASS — 53 files, 1,015 tests**. Baseline was 49 files / 928 tests; 87 homepage data/action/auth/UI tests were added. |
| `pnpm typecheck` | **PASS** |
| `pnpm lint` | **PASS**, with the existing `@next/next/no-img-element` warning at `components/admin/product-image-manager.tsx:110` |
| `pnpm build` | **PASS**; `/retailer/home` remains dynamic, 4.77 kB route bundle / 124 kB first-load JS |
| `git diff --check` | **PASS** |
| `bash -n scripts/production-validate.sh` | **PASS** (syntax only, not database execution) |

Additional Playwright Chromium 133 component checks with the **final production build's CSS**:

- Full fixtures at **320, 375, 768 and 1440px**: document/body width equals viewport width, no browser runtime errors, and **zero axe WCAG A/AA violations** (`wcag2a`, `wcag2aa`, `wcag21aa`). Visible header controls remained within the viewport.
- Empty and error fixtures at **320px**: expected empty/unavailable copy, hidden absent banner/brand sections, retry availability, no page overflow, and zero axe violations for the same tags.
- **16 browser check groups passed**: skip-to-main focus; mobile search focus; header/hero search submissions; logo/notifications/cart/account routes; catalog/offers/support shortcuts; reorder anchor; category/brand filters; carousel controls/CTA; Add and simulated refreshed server cart props; reorder quantity/subtotal; exact-pack PDP navigation; all five bottom tabs and active state; empty/error states.
- Browser verification found and fixed a missing programmatic focus target on the skip link and low-contrast fallback/nav text. Component tests found and fixed prematurely released async pending state in React 18.

These are local command and isolated component-browser results, not a claim that live authenticated checkout or deployment has been verified.

### Test boundaries

The new suites exercise data/pricing, query contracts, actual server-action functions with mocked authentication/Supabase/cache, retailer layout guards with mocked sessions, and React component interactions with mocked Next routing/actions. The Supabase fixture records/scopes query operations; it is **not** a Postgres/RLS emulator. Cart badge component tests simulate refreshed server props; separate action tests assert real layout revalidation calls.

Browser checks use the actual components and generated application CSS with an isolated, explicitly labelled fixture harness **outside application routes**. They exercise browser layout, focus, links and component callbacks, not the production login/database/network integration. Playwright Chromium and axe tooling were installed outside the repository; no browser binaries, screenshots or app preview bypasses are included in the change.

## Changed-file manifest

51 files changed:

```text
.env.local.example
README.md
app/admin/banners/[id]/page.tsx
app/retailer/home/loading.tsx
app/retailer/home/page.tsx
app/retailer/layout.tsx
components/admin/banner-edit-form.tsx
components/admin/banner-form.tsx
components/layout/mobile-bottom-nav.tsx
components/layout/retailer-shell.tsx
components/media/stored-image.tsx
components/retailer/brand-card.tsx
components/retailer/category-card.tsx
components/retailer/home-cart-summary.tsx
components/retailer/home-content.tsx
components/retailer/home-quick-actions.tsx
components/retailer/home-refresh-button.tsx
components/retailer/home-reorder-card.tsx
components/retailer/product-card.tsx
components/retailer/promo-banner.tsx
components/retailer/promo-carousel.tsx
components/retailer/qty-stepper.tsx
components/retailer/search-field.tsx
components/retailer/section-heading.tsx
components/retailer/wholesale-deal-card.tsx
docs/retailer-homepage-audit.md
lib/admin/banners-actions.ts
lib/retailer/banner-target.ts
lib/retailer/cart-merge.ts
lib/retailer/cart-service.ts
lib/retailer/catalog.ts
lib/retailer/effective-price.ts
lib/retailer/home-data.ts
lib/retailer/home-services.ts
lib/retailer/order-actions.ts
lib/retailer/pricing-data.ts
lib/retailer/shopping-context.ts
package.json
pnpm-lock.yaml
scripts/production-validate.sh
supabase/migrations/0047_banner_content.sql
tests/fixtures/retailer-home.ts
tests/helpers/supabase-fixture.ts
tests/product-detail-ui.test.ts
tests/retailer-enterprise-upgrade.test.ts
tests/retailer-home-actions.test.ts
tests/retailer-home-auth.test.ts
tests/retailer-home-data.test.ts
tests/retailer-home-ui.test.tsx
types/database.types.ts
vitest.config.ts
```
