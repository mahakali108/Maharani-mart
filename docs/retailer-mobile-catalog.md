# Mobile retailer catalog — audit and change record

Date: 2026-09-18. Branch `arena/01a0b519-maharani-mart`, based on `main` @
`f388d97` (merge of PR #64).

Six mobile UI defects were reported from screenshots: a missing homepage
banner, "Page 1 of 2" pagination, no brand step in category browsing, an
over-tall product card, "Image unavailable" placeholders, and category cards
that waste space. This file records what was actually wrong, what changed, and
what could NOT be verified here.

## 1. What was already there (inspected before changing anything)

| Area | Already present | Gap addressed |
| --- | --- | --- |
| Banners | `banners` table (0001) + optional copy (0047), admin CRUD + reorder, `loadRetailerHome` read, `PromoCarousel` / `PromoBanner` rendered between the welcome block and "Shop by category" | The read stacked three PostgREST `.or()` filters whose combined behaviour depends on the client version; an unrenderable `image_url` produced a broken-image box; the mobile slide was taller than it needed to be and had no swipe. |
| Catalog paging | DB `.range()` pagination + a bounded in-memory working set for price-derived filters (`lib/retailer/catalog-params.ts`) | The UI rendered "Page 1 of 2" with Previous/Next — not continuous browsing. No cursor/keyset support existed. |
| Category → brand | `products.category_id` + `products.brand_id`, active flags, category directory, catalog brand filter | `/retailer/categories` linked a category straight to the catalog (no brand step) and the catalog showed **every** active brand regardless of category. |
| Product images | `StoredImage` (single resolver), `product_images`, `product_packs.image_url`, variant galleries (`product_pack_images`, migration 0028) used by the detail page | The shared card SELECT did **not** read `product_pack_images`, so cards depended entirely on the denormalised `product_packs.image_url`. |
| Mobile layout | Responsive grids, safe-area bottom nav, zoom lock, `mobile-safety.test.ts` source guards | Product card stacked two full-width controls and separate MRP/saving lines; the home category grid needed four rows; the catalog page rendered two category rows. |

Nothing here duplicates a table, adds a migration, seeds data, or touches GST,
pricing, MOQ, stock, cart, checkout, orders, inventory, permissions or RLS.

## 2. Changes

### Banners (`lib/retailer/home-data.ts`, `promo-carousel.tsx`, `promo-banner.tsx`)
- The read is now one predicate (`is_active`, which is also the RLS read rule
  for non-staff) ordered by `sort_order`; schedule and area targeting are
  applied by the existing `isBannerVisible()` helper, which the page already
  used — the duplicated, version-dependent `.or()` chain is gone.
- New pure `homeBanners()` also drops a banner whose `image_url` cannot be
  resolved (`resolveMediaUrl`, the same pure helper `StoredImage` uses) or
  whose title is blank, so a broken-image box can never be drawn.
- With no qualifying banner the carousel renders nothing at all (unchanged
  contract, now covered by a test): no frame, no placeholder, no height.
- Mobile: 16:9 image + tighter copy block; the horizontal swipe was added
  (`touch-pan-y`, 40 px threshold) alongside the existing dots/arrows.
  Autoplay, reduced-motion handling, pause on focus/hidden tab are unchanged.

### Continuous catalog loading (`lib/retailer/catalog-feed.ts`, `app/api/retailer/catalog/route.ts`, `components/retailer/catalog-feed.tsx`, catalog page)
- **One** server loader (`loadCatalogFeed`) now produces the first batch for
  the page and every later batch for `GET /api/retailer/catalog`, so appended
  rows can never disagree with what was server-rendered. Same filters, same
  sort, same pricing/availability/MOQ engine, same RLS-scoped client.
- Cursor = a server-clamped `offset`; batch size is fixed server-side
  (`CATALOG_PAGE_SIZE`, a client cannot raise it) and a session is hard-capped
  at `CATALOG_FEED_MAX_ROWS` (480). At the cap the UI says so instead of
  pretending the catalog ended. This is bounded pagination, not keyset —
  `products` has no client-safe ordering key for every supported sort — so
  every ordering now ends in `id` to make batches deterministic, and the client
  de-duplicates by product id.
- Stops asking when `nextOffset` is `null`; one request in flight at a time;
  a failed batch shows a retry rather than a truncated list; IntersectionObserver
  (600 px prefetch) plus a post-load visibility re-check so a short list or a
  restored scroll position keeps loading.
- The breadcrumb/filter/sort state is untouched, so search + filters + sort all
  behave exactly as before; `?page=` deep links still resolve to their batch.
- Back/forward: the feed remembers how far it had loaded for the same filters
  in `sessionStorage` (best-effort, size-capped), so returning from a product
  page does not shrink the list.
- No page numbers, no Previous/Next, no pagination footer.

### Category → brand (`lib/retailer/catalog-taxonomy.ts`, `app/retailer/categories/page.tsx`, `category-directory.tsx`, `category-card.tsx`, `brand-card.tsx`, catalog page)
- `/retailer/categories?category=<id>` renders the brands that **really have
  active products** in that category (bounded scan of `products.brand_id` in
  the category scope = the category plus its active immediate children, the
  same scope the catalog filter uses), most-used first, each linking to
  `/retailer/catalog?category=<id>&brand=<id>`.
- "View all products in X" is always offered; sub-categories are chips; the
  back link and breadcrumb return to level 1 (a real URL, so the phone's back
  gesture works). Empty states for a category with no brands and for a search
  with no match.
- The catalog page's brand filter is now scoped to the selected category (the
  selected brand is always kept so an active filter is never hidden), and it
  shows the same brand chips when a category is selected.
- Home category tiles drill down to the brands instead of skipping them.

### Product images (`lib/retailer/catalog.ts`)
- `PRODUCT_CARD_SELECT` now includes `product_pack_images`, and `toPricedCard`
  resolves through the new pure `catalogCardImage()` in the **same order the
  detail page uses**: variant gallery → `product_packs.image_url` → parent
  `product_images` → `null`. A wrong variant's image is never borrowed and
  blank values are never treated as images. Every card surface (home, rails,
  catalog, quick-order, co-purchased, frequent) benefits at once.
- The placeholder is now a compact icon + one 9 px line inside the normal image
  box — never a tall panel, never a broken `<img>`.

### Mobile density (`product-card.tsx`, `home-content.tsx`, catalog page)
- Stock chip moved onto the image edge; MRP and saving share one line;
  quantity stepper and Add to Cart share one row. (~90–110 px shorter per card.)
- Home categories are a single horizontal snap rail on phones (grid from `sm`
  up). The catalog page's duplicate category chip row is hidden on phones until
  a category is selected.
- No value below 9 px, no fixed width above 300 px, `min-h-11` on primary
  actions, bottom navigation untouched.

## 3. Verification performed

| Check | Result |
| --- | --- |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS (1 pre-existing warning, `components/admin/product-image-manager.tsx:110`) |
| `pnpm test` | PASS — **64 files / 1296 tests** (baseline 62 / 1251; 45 added) |
| `pnpm build` | PASS |
| `git diff --check` | PASS |

New suites: `tests/retailer-mobile-catalog.test.ts` (image resolution order,
feed cursor/bounds/URL/legacy page mapping, banner filtering including
unrenderable images and unsafe links, taxonomy scoping, source-level guards,
mobile width/touch/text guards) and `tests/retailer-mobile-catalog-ui.test.tsx`
(jsdom: first batch + end message, append on scroll, stop at the end, no
duplicate row, retry after a failure, session resume, cap message, carousel
empty/single-slide/swipe-vs-tap, category → brand links, brand search, empty
brand state).

**Static verification only.** This sandbox has no browser (Playwright is
blocked — see the header of `tests/mobile-safety.test.ts`) and no Supabase
credentials; the production host is behind Vercel deployment protection
(returns a Vercel SSO login), so no live database row, no live RLS check and no
360/390/430 px rendering was exercised. The layout changes are verified by
source invariants and component tests, not by a device or a browser.

## 4. Known limitations / follow-ups

1. **Whether the deployed homepage shows a banner is still a data question.**
   The carousel renders when at least one banner is active, in schedule and in
   scope for the retailer's area. If every `banners` row is inactive, expired,
   area-scoped elsewhere, or stores a path/legacy ref instead of a public URL,
   the section correctly stays hidden. Create/edit a banner in
   `/admin/banners` (image must be uploaded through the media flow so the
   column holds a Supabase public URL) and it appears immediately.
2. **Products with no image row at all** still show the compact placeholder —
   that is data, not code, and no placeholder image is invented.
3. Rows whose `image_url` is a bare object path or an `appwrite://` ref cannot
   be rendered (the bucket cannot be guessed safely); they must be re-uploaded
   or rewritten to a public URL in the admin UI.
4. The feed cap (480 rows per browse session) is intentional: continuous
   scrolling must not pull an entire catalog into a phone. Retailers with more
   than 480 matching products are told to narrow the search or pick a category.
5. Brand counts come from a bounded scan (1 000 products per category scope);
   if a category is larger than that, the UI says the counts are partial.
