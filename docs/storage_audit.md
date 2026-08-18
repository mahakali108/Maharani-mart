# Phase 1 — Supabase Storage audit (read-only)

Firebase is being introduced **only** for file/image storage. Supabase remains the system of record for Auth, PostgreSQL, RLS, roles, and all business logic.

## Buckets

| Bucket | Public | Size limit | MIME | Who may write | Used in UI today |
| --- | --- | --- | --- | --- | --- |
| `product-images` | yes | 5 MB | png/jpeg/webp | staff+ | Yes — product gallery |
| `banners` | yes | 5 MB | png/jpeg/webp | staff+ | Yes — admin banners |
| `avatars` | yes | 2 MB | png/jpeg/webp | owner path `avatars/{auth.uid()}/…` | **No upload UI** |
| `brand-logos` | yes | 2 MB | png/jpeg/webp/svg | staff+ | **No upload UI** (`brands.logo_url` unused) |
| `retailer-documents` | **no** | 10 MB | png/jpeg/webp/pdf | staff+ | Yes — admin KYC docs |

Policies live in `supabase/migrations/0003_storage_buckets.sql`, `0006_retailer_documents.sql`, and `0013_rls_and_storage_hardening.sql`. They are **not** being dropped.

## Database columns (reused — no new image tables)

| Table | Column | Stored today | Notes |
| --- | --- | --- | --- |
| `product_images` | `image_url` text not null | Full Supabase public URL | Gallery |
| `banners` | `image_url` text not null | Full Supabase public URL | Homepage promos |
| `brands` | `logo_url` text null | unused | Schema ready |
| `categories` | `image_url` text null | unused / optional | Displayed if set; no upload UI |
| `profiles` | `avatar_url` text null | unused | Salesman profile reads it, no upload |
| `retailer_documents` | `file_url` text not null | **Object path** (private) | Viewed via signed URL |

These text columns can store Firebase object paths without a schema migration.

## Upload / delete / URL code

- Client helper: `lib/storage/upload.ts` (`uploadFile`, `removeFile`, `buildPath`) — browser Supabase client, `upsert: true`.
- Private signed URL: `lib/storage/signed-url.ts` (server-only, `retailer-documents`).
- Product upload UI: `components/admin/product-image-manager.tsx` — path `{skuCode}/{timestamp}-{name}` (SKU is user-controlled).
- Banner upload UI: `components/admin/banner-form.tsx`, `banner-edit-form.tsx` — path `banners/{timestamp}-{name}`.
- KYC upload UI: `components/admin/retailer-documents-manager.tsx` — path `{retailerId}/{timestamp}-{name}`.
- Banner delete also removes the Storage object (`lib/admin/banners-actions.ts`). Product image / document deletes currently drop the **row only** (orphans the file).
- Display: `next/image` with `unoptimized`, `next.config.mjs` allows `*.supabase.co/storage/v1/object/public/**`.
- Validation is browser `accept=` plus bucket MIME/size only. No dimension checks. No server-side revalidation of the file bytes.

## Not in scope / not present

- No retailer profile/avatar upload screen exists.
- No live file inventory can be taken in this environment (no `.env.local`, no Supabase/Firebase credentials).
- Supabase Auth, Postgres, RLS, and business tables are **not** being migrated.
