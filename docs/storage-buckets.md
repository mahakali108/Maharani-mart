# Supabase Storage — Bucket Inventory

Storage is **Supabase Storage only**. There is no Appwrite, Firebase,
Cloudinary or Turso storage. Turso is used solely as an optional search
cache (`lib/turso/*`), never for files.

Buckets are created by the migrations:

- `supabase/migrations/0003_storage_buckets.sql`
- `supabase/migrations/0006_retailer_documents.sql`
- `supabase/migrations/0013_rls_and_storage_hardening.sql`
- `supabase/migrations/0016_storage_paths_category_bucket.sql` (adds `category-images`, aligns object paths)
- `supabase/migrations/0021_ensure_category_images_bucket.sql` (idempotent ensure-safe re-check of `category-images`: bucket row + the same minimum policies; converges a project where 0016 was skipped or partially applied, and never creates a second bucket)

Every upload flows through `lib/media` → `lib/media/supabase.ts` →
Supabase Storage, and the browser never chooses a bucket or object path.
Migrations are NOT applied automatically by deploys — see
`docs/deployment_guide.md` §1 and §6.

## Inventory

| Bucket | Purpose | Public | Max size | Allowed MIME | Object path | DB column | Delete workflow | RLS | UI |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `product-images` | Product photos & gallery | Public | 5 MB | png/jpeg/webp | `products/{productId}/gallery/{uuid}.{ext}` | `product_images.image_url` (full public URL) | `removeProductImageAction` → `deleteMedia()` | Public read; insert/update staff+; delete staff+ | `components/admin/product-image-manager.tsx` (upload); product cards, gallery, cart, checkout, orders, quick-order (display) |
| `banners` | Promo banners | Public | 5 MB | png/jpeg/webp | `banners/{bannerId}/{uuid}.{ext}` (`_draft` before the row exists) | `banners.image_url` (full public URL) | `deleteBannerAction` → `deleteMedia()` | Public read; insert/update staff+; delete admin+ | `components/admin/banner-form.tsx`, `banner-edit-form.tsx`; `components/retailer/promo-banner.tsx` |
| `banner-drafts` | **Unpublished** banner artwork (0077, repo-only — see below) | **Private** | 5 MB | png/jpeg/webp | `banners/{bannerId}/{uuid}.{ext}` (`_draft` before the row exists) | `banners.draft_image_path` / `draft_image_mobile_path` (object path, never a URL) | none automatic — permanent; publish copies to `banners` | Admin-only (select/insert/update/delete), matching `banners.manage` | no UI in this PR — admin preview reads via a 15-minute signed URL |
| `brand-logos` | Brand logos | Public | 2 MB | png/jpeg/webp/svg | `brands/{brandId}/{uuid}.{ext}` | `brands.logo_url` (full public URL) | `updateBrandAction` / `deleteBrandAction` → `deleteMedia()` | Public read; insert/update staff+; delete admin+ | `components/admin/brand-edit-form.tsx` |
| `category-images` | Category images | Public | 2 MB | png/jpeg/webp | `categories/{categoryId}/{uuid}.{ext}` | `categories.image_url` (full public URL) | `updateCategoryAction` / `deleteCategoryAction` → `deleteMedia()` | Public read; insert/update staff+; delete admin+ | `components/admin/category-edit-form.tsx`; category browse pages (display) |
| `avatars` | User profile photos | Public | 2 MB | png/jpeg/webp | `avatars/{userId}/{uuid}.{ext}` | `profiles.avatar_url` | *(no writer UI yet — read-only)* | Public read; insert/update self (own folder only) | `app/salesman/profile/page.tsx` (read-only) |
| `retailer-documents` | Retailer KYC / registration docs | **Private** | 10 MB | png/jpeg/webp/pdf | `retailers/{retailerId}/documents/{uuid}.{ext}` | `retailer_documents.file_url` (stores the **object path**, not a URL) | `deleteRetailerDocumentAction` → `deleteMedia()` | Read: staff+ or owning retailer; write: staff+ | `components/admin/retailer-documents-manager.tsx`; `app/admin/retailers/[id]/page.tsx` (via signed URL) |

### `banner-drafts` (migration 0077 — NOT applied)

Added so that artwork for an unpublished banner is not readable by
`/storage/v1/object/public/banners/...` guessers. The whole point is that
draft artwork has **no public URL at all**: it is reachable only through a
short-lived signed URL minted server-side for an admin.

Rules:

* `0077` is **review-only**. No bucket exists, no policy was changed and no
  object was moved. The public `banners` bucket is untouched.
* Draft paths are validated twice — `DRAFT_BANNER_PATH_RE` in
  `lib/media/refs.ts` and a CHECK constraint in `0077` — and both reject
  absolute URLs, so private art can never be stored as a public link.
* Publishing **copies** the object into the public bucket under the same path
  and leaves the draft in place (`lib/admin/banner-artwork.ts`).
* Never auto-deleted, including on rollback. See
  `docs/BANNER_DRAFT_ARTWORK_IMPLEMENTATION.md` for the growth trade-off and
  the manual cleanup proposal.

## Reference format stored in the columns

- **Public buckets** store the full public URL:
  `https://<project-ref>.supabase.co/storage/v1/object/public/<bucket>/<path>`.
  These render directly in any `<img>` / `next/image`.
- **`retailer-documents`** stores the bare object path
  (`retailers/<id>/documents/<uuid>.<ext>`), resolved at read time to a
  short-lived signed URL via `lib/storage/signed-url.ts` →
  `resolveDocumentUrl()`.

No `appwrite://…`, `firebase://…` or other external reference is ever written.

## Troubleshooting — `Upload failed: Bucket not found`

`lib/media/supabase.ts` surfaces raw Storage API errors as
`Upload failed: <message>`. Supabase answers an upload to an unknown bucket
with exactly `Bucket not found`, which means the bucket row is missing from
**the project the app's env vars point at** (a skipped storage migration or a
mismatched project), never from a wrong name in code: the bucket id here is
the single canonical one in `MEDIA_KIND_CONFIG` (`lib/media/types.ts`), which
matches the migrations above byte-for-byte.

- Verify: `select id from storage.buckets where id = 'category-images';`
- Fix: apply `supabase/migrations/0021_ensure_category_images_bucket.sql`
  (`supabase db push` or the SQL editor). It is idempotent and duplicate-safe.
- Prove it works for real: `node scripts/verify-storage-bucket.mjs`
  (server-side env vars; does a throwaway upload → public read → delete).
- Do not create a differently-named replacement bucket; one canonical name
  per media kind. See `docs/deployment_guide.md` §6.
