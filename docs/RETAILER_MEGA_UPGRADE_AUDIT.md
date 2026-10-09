# Retailer upgrade audit — 2026-10-08

Baseline: `4aff485a8cb59fd4a12218f3d6a9d62ae97a6069`, native Kotlin / Compose, Next.js 14 / Supabase. Audit is based on reachable screens, route handlers, DTOs, services, migrations and tests, NOT previous parity totals. No production credentials, attached screenshot, Android SDK or emulator are available in this sandbox. “Existing” below means code-path evidence, not live production sign-off.

| Area | Current | Missing | Broken | Partial | Target |
|---|---|---|---|---|---|
| Auth/session | Keystore-backed token storage, bootstrap, refresh/replay, role gates | Verified recovery App Link | No new defect established | Recovery completion remains HTTPS; device lifecycle untested here | Preserve secure restore and account-scoped wipe |
| Home | Real banners, taxonomy, priced grid, newest rail, personal history, Coins | Offer discovery rail/ticker | Banner callback omitted; dashboard permits overlapping reads | Above-fold tools/numbers displace shopping | Compact discovery first, server-content promotions |
| Search | Shared service matches product, brand, category, product/pack barcode and pack name | Popular-query source, SKU publication | Failed search subqueries silently become zero matches | Recent device searches; docs call it product-only | Report API failures honestly; accurately label supported search |
| Categories | Native directory + catalog filtering, server counts/images | Native parent/child identity in DTO | None established | Parent links exist in DB/web but not native DTO | Keep real directory reachable |
| Brands | Native directory + filtered products; admin CRUD | Native description in DTO | None established | No separate brand-detail identity surface | First-class bottom-nav destination |
| Catalog | Paged adaptive two-column cards, favorite, qty sheet, server filters/sorts | Price/MOQ/offer query filters not mobile contract | None established | Density/device rendering unverified | Compact readable cards; no unsupported filters |
| PDP/quantity | Gallery, pack, inclusive prices, MRP, MOQ, GST, stock state, tiers | Reviews/recommendations not published | None established | Availability is status-only, NOT exact count | Preserve server validation |
| Comparison | Live detail reads, horizontally scrollable table | Fourth selection | Table uses fact-row index instead of product-column index | Touch targets 44dp | Four-product cap; correct cells; 48dp actions |
| Favorites | Shared store, current catalog prices, orderability, sort/filter | Restock-alert backend absent | None established | No alert subscription | Preserve single source of favorite state |
| Cart | Server re-read, qty/remove/select/bulk, notices, totals, save-for-later | No new unsupported client totals | None established | Device interaction not exercised | Preserve intent and authoritative totals |
| Saved carts | Name, merge/update from live cart, rename, delete, restore, item restore/remove | Non-destructive duplication API absent | None established | Save merges maximum quantities; not replacement | Do not clobber live cart to simulate copy |
| Quick order | Real match API, barcode/product/pack, partial line handling | Internal SKU is not retailer search field | None established | Retry/uncertain-result logic needs device check | Preserve stop-and-review on uncertain writes |
| Checkout | Quote, address selection, Coins/coupon, request-key recovery | New address form mid-checkout | None established | Address book reachable separately | Preserve idempotent server placement |
| Buy Again | Own-order aggregation + current detail reads + selected reorder | Full-history aggregation beyond bounded pages | None established | Home historical identity only, live price on tap | Never use historical rate as current |
| Orders | History/filter, detail, cancel/return, reorder | None established | None established | Device workflow verification outstanding | Preserve real statuses/actions |
| Delivery/invoice | Real delivery endpoint/timeline and stored invoice data | GPS, invented stages forbidden | None established | External open/share needs device | No fabricated tracking/invoice |
| Offers/coupons | `/schemes`, `/coupons`, native screens, checkout coupon API | Home offer rail | None established | Scheme DTO publishes identity/date, not product deal prices | Expose real campaigns without inventing discounts |
| Coins | Balance and paged ledger, redemption in quote | No loyalty earning API | None established | Server wire uses legacy credit fields | Coins terminology; never call funding “earned” |
| Notifications | Own feed, unread store, mark-read, preferences | Category/type not published per feed row | None established | Deep links limited by payload | Preserve read/unread and privacy |
| Account/support | Profile, addresses, security, reports, help, real ticket history/replies | None established | None established | Native account/header UX needs device check | Keep working tools reachable |
| Admin control | `/admin/catalog/categories`, `/brands`; guarded master-data actions; banners/schemes/coupons/visibility | No new CRUD gap established | None established | Live admin→DB→API→device unavailable | Test existing authorization and data contracts |
| RLS/ownership | Caller-token mobile client, owner predicates, commerce role checks, migrations | Live User A/B credentials | None established | Fixture tests are not live RLS proof | Never loosen RLS/auth |
| Performance/images | Lazy lists/grids, Coil shared loader, remote images, cursors | Measurements on device | Home dashboard request dedup comment not enforced | Optional newest rail hides read failures | Bounded reads, clear optional-rail errors |
| APK/CI | R8 + resource shrink, debug tooling only, size script, unsigned release CI | Local JDK/SDK | No new failure established | Historical APK numbers not fresh measurements | Run actual CI, report exact artifacts only |

## PR constraint
Open related retailer PRs include #66, #45 and #42, all from other session branches. None is from `arena/ff1279ad-maharani-mart`. This session cannot push those branches. Do not create a second retailer-upgrade PR; attach this branch's commit/evidence to the applicable open PR and explicitly report the head-branch update as blocked.

## Verification policy
New code is **implemented pending verification**, not production IMPLEMENTED, until compilation/tests and real-data/device evidence exist. No seeds, fake catalog content, migrations, RLS changes, credentials, bundled product images, or WebView are part of this upgrade. Responsive token tests cannot certify 360/393/412dp rendered UI.
