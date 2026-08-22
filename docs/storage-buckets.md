# Supabase Storage — Bucket Inventory

Storage is **Supabase Storage only**. There is no Appwrite, Firebase,
Cloudinary or Turso storage. Turso is used solely as an optional search
cache (`lib/turso/*`), never for files.

Buckets are created by the migrations:

- `supabase/migrations/0003_storage_buckets.sql`
- `supabase/migrations/0006_retailer_documents.sql`
- `supabase/migrations/0013_rls_and_storage_hardening.sql`
- `supabase/migrations/0016_storage_paths_category_bucket.sql` (adds `category-images`, aligns object paths)

Every upload flows through `lib/media` → `lib/media/supabase.ts` →
Supabase Storage, and the browser never chooses a bucket or object path.

## Inventory

| Bucket | Purpose | Public | Max size | Allowed MIME | Object path | DB column | Delete workflow | RLS | UI |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `product-images` | Product photos & gallery | Public | 5 MB | png/jpeg/webp | `products/{productId}/gallery/{uuid}.{ext}` | `product_images.image_url` (full public URL) | `removeProductImageAction` → `deleteMedia()` | Public read; insert/update staff+; delete staff+ | `components/admin/product-image-manager.tsx` (upload); product cards, gallery, cart, checkout, orders, quick-order (display) |
| `banners` | Promo banners | Public | 5 MB | png/jpeg/webp | `banners/{bannerId}/{uuid}.{ext}` (`_draft` before the row exists) | `banners.image_url` (full public URL) | `deleteBannerAction` → `deleteMedia()` | Public read; insert/update staff+; delete admin+ | `components/admin/banner-form.tsx`, `banner-edit-form.tsx`; `components/retailer/promo-banner.tsx` |
| `brand-logos` | Brand logos | Public | 2 MB | png/jpeg/webp/svg | `brands/{brandId}/{uuid}.{ext}` | `brands.logo_url` (full public URL) | `updateBrandAction` / `deleteBrandAction` → `deleteMedia()` | Public read; insert/update staff+; delete admin+ | `components/admin/brand-edit-form.tsx` |
| `category-images` | Category images | Public | 2 MB | png/jpeg/webp | `categories/{categoryId}/{uuid}.{ext}` | `categories.image_url` (full public URL) | `updateCategoryAction` / `deleteCategoryAction` → `deleteMedia()` | Public read; insert/update staff+; delete admin+ | `components/admin/category-edit-form.tsx`; category browse pages (display) |
| `avatars` | User profile photos | Public | 2 MB | png/jpeg/webp | `avatars/{userId}/{uuid}.{ext}` | `profiles.avatar_url` | *(no writer UI yet — read-only)* | Public read; insert/update self (own folder only) | `app/salesman/profile/page.tsx` (read-only) |
| `retailer-documents` | Retailer KYC / registration docs | **Private** | 10 MB | png/jpeg/webp/pdf | `retailers/{retailerId}/documents/{uuid}.{ext}` | `retailer_documents.file_url` (stores the **object path**, not a URL) | `deleteRetailerDocumentAction` → `deleteMedia()` | Read: staff+ or owning retailer; write: staff+ | `components/admin/retailer-documents-manager.tsx`; `app/admin/retailers/[id]/page.tsx` (via signed URL) |

## Reference format stored in the columns

- **Public buckets** store the full public URL:
  `https://<project-ref>.supabase.co/storage/v1/object/public/<bucket>/<path>`.
  These render directly in any `<img>` / `next/image`.
- **`retailer-documents`** stores the bare object path
  (`retailers/<id>/documents/<uuid>.<ext>`), resolved at read time to a
  short-lived signed URL via `lib/storage/signed-url.ts` →
  `resolveDocumentUrl()`.

No `appwrite://…`, `firebase://…` or other external reference is ever written.
