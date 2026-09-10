# Universal Product Name & Multi-Image Gallery

## Universal product name — single source of truth

`lib/retailer/product-name.ts` is the ONE place a product's display name is built. Every
retailer surface (product detail, product cards, breadcrumb, cart, checkout, order detail,
invoice, search results, AI replies) routes through it.

### Source fields (real Supabase data only)
| Display part | Database source |
| --- | --- |
| Brand | `brands.name` |
| Canonical product name | `products.name` |
| Variant / size | `product_packs.pack_name` (the selected variant) |

### Rules
- The real canonical `products.name` is used — the category name is NEVER substituted for it.
- Brand, product, variant and size are preserved verbatim (never truncated, uppercased or
  rewritten for display).
- No category is hardcoded — the same code path serves Face Wash, Powder, Soap, Shampoo,
  Hair Oil, Cream, Lotion, Toothpaste, Household and any future category.
- If the size is already part of `products.name`, it is not appended a second time.
- If the size lives only in `product_packs.pack_name`, it is appended exactly once.
- If real data is missing, a safe fallback is shown (`Product`, brand, or pack) — a name is
  never invented.

Example: Brand `Garnier Men` + Product `AcnoFight Anti-Pimple Face Wash` + Variant `50g`
→ `Garnier Men AcnoFight Anti-Pimple Face Wash 50g`.

### Why the old title was wrong (root cause)
The old title was assembled from a truncated / generic name (or the variant alone) and lost
the brand and canonical product name, producing things like `ACNI FACE WASH 50G`. The fix is
the shared helper above — the database values are never rewritten to fix display.

## Gallery architecture

- `product_images` — ordered gallery for the parent product (existing table).
- `product_packs.image_url` — legacy single per-variant image (migration 0024).
- `product_pack_images` — ordered gallery per variant: front, back, side, ingredients, usage,
  angles (migration 0028). `sort_order = 0` is the primary and is kept in sync with
  `product_packs.image_url` by a trigger, so older readers keep working.

All images live in the existing public `product-images` Supabase Storage bucket — no second
image system or bucket.

### Variant gallery priority (exactly, in order)
1. Selected variant's own gallery (`product_pack_images` rows for the selected pack).
2. Legacy selected-variant single image (`product_packs.image_url`).
3. Parent product gallery (`product_images`).
4. Safe placeholder (no fake/duplicated images).

Switching a variant swaps, together: gallery, product name, size, MRP, discount, piece price,
availability and cart variant identity. Another variant's images are never shown.

## Retailer gallery UI

`components/retailer/product-gallery.tsx` provides:
- full mobile-width, contain-fit image (no crop / stretch / blur, no tiny-image-in-card),
- swipe navigation, horizontally scrollable thumbnails, previous/next controls,
- an `1 / 5`-style counter, a full-screen lightbox with zoom, keyboard navigation
  (ArrowLeft / ArrowRight / Escape) and accessible alt text per image.

## Admin image management

- `ProductImageManager` (`components/admin/product-image-manager.tsx`) — multiple product
  images: upload, preview, set primary, reorder, delete (deleting also removes the stored file).
- `ProductPackImageManager` (`components/admin/product-pack-image-manager.tsx`) — the same
  capabilities per variant.
- Actions in `lib/admin/products-actions.ts` validate media references and file type/size,
  write to the existing `product-images` bucket, and preserve existing images on edit.
- No service-role keys are exposed; Storage and database RLS are unchanged.
