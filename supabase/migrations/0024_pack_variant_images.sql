-- ============================================================================
-- 0024: Per-variant (pack) product image
--
-- Business change:
--   A retailer can switch between the sizes/variants of a parent product
--   (e.g. Baby Powder 50g / 100g / 200g) directly on the product page. Each
--   variant may show its OWN product image when switching.
--
--   The variant model already exists: `product_packs` are the sellable
--   sizes/variants of a `products` row and carry their own case_price, MRP,
--   units_per_case, MOQ, quantity tiers and active flag. The only missing
--   piece is a per-variant image, so this migration adds exactly that.
--
-- Migration safety — NOTHING IS DROPPED, NO DATA IS REWRITTEN:
--   - `product_packs.image_url` is a single nullable text column. Packs
--     without a dedicated image keep working exactly as before — the
--     retailer UI falls back to the parent product's existing
--     `product_images` gallery (and the existing "image unavailable"
--     placeholder when neither exists).
--   - The column stores the same kind of Supabase Storage reference the
--     `product_images.image_url` column already stores (public
--     `product-images` bucket), so no new bucket, storage policy or
--     access path is introduced.
--   - RLS is untouched: the column lives on `product_packs`, which is
--     already protected by the existing 0004 policies
--     (`product_packs_read` shows only active packs to retailers;
--     staff+ can write). No policy is weakened or added.
--   - No index is required: the column is only ever read via the pack
--     rows already fetched by product/cart/checkout queries.
-- ============================================================================

alter table product_packs add column image_url text;

comment on column product_packs.image_url is
  'Optional per-variant product image (same reference format as product_images.image_url). NULL = fall back to the parent product''s gallery. Set from the admin product pack manager.';

-- ============================================================================
-- END OF MIGRATION — no data is rewritten, no column is dropped, no RLS change.
-- ============================================================================
