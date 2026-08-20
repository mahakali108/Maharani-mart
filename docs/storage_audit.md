# Storage / Media Audit — pre-Appwrite baseline

Read-only audit performed before any code was changed, on branch
`arena/01a01fd3-maharani-mart` (branched from `main` @ `f30879f`).

## 1. Repository / branch / PR state

| Item | Value |
| --- | --- |
| Remote | `https://github.com/mahakali108/Maharani-mart.git` |
| Default branch | `main` (`f30879f` = merge of PR #6) |
| Working branch | `arena/01a01fd3-maharani-mart` |
| PR #1–#4 | merged (salesman RLS, retailer ordering, retailer redesign) |
| PR #5 | **merged** — "Upgrade Maharani Mart retailer marketplace experience". Must not be duplicated or rewritten. |
| PR #6 | merged — mobile-number + password login for retailers |
| PR #7 | **OPEN** — "Add Firebase Cloud Storage for images". Superseded by this work (see §6). Not merged, not deleted. |

## 2. Stack

- Next.js 14.2.15 App Router, React 18, TypeScript strict (`noUncheckedIndexedAccess`)
- Supabase (`@supabase/ssr` + `@supabase/supabase-js`) — Postgres, Auth, RLS, Storage
- Zod validation, Tailwind, Capacitor Android wrapper
- No Firebase, no Cloudinary, no Turso, no Appwrite in `main` at audit time

## 3. Authentication / authorisation (unchanged by this work)

| Layer | File |
| --- | --- |
| Browser client | `lib/supabase/client.ts` |
| Server client + service-role client | `lib/supabase/server.ts` |
| Session refresh | `lib/supabase/middleware.ts` |
| Role routing, pending/suspended gates | `middleware.ts` |
| `requireUser()` | `lib/auth/session.ts` |
| `requirePermission()` | `lib/admin/guard.ts` |
| Permission matrix | `lib/permissions/permissions.ts` |
| Salesman assignment guard | `lib/salesman/guard.ts` |

Roles: `super_admin | admin | staff | salesman | retailer`.

## 4. Supabase Storage inventory (as of `main`)

Buckets are created in `supabase/migrations/0003_storage_buckets.sql` and
`supabase/migrations/0006_retailer_documents.sql`.

| Bucket | Public | Size limit | MIME allow-list | Purpose | DB column | Upload site | Display site |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `product-images` | yes | 5 MB | png/jpeg/webp | product photos & gallery | `product_images.image_url` (full public URL) | `components/admin/product-image-manager.tsx` | product card / gallery / cart / checkout / orders / quick-order / salesman order builder |
| `banners` | yes | 5 MB | png/jpeg/webp | promo banners | `banners.image_url` (full public URL) | `components/admin/banner-form.tsx`, `banner-edit-form.tsx` | `components/retailer/promo-banner.tsx`, `app/admin/banners/*` |
| `brand-logos` | yes | 2 MB | png/jpeg/webp/svg | brand logos | `brands.logo_url` — **column exists, no UI writes it** | none | none |
| `avatars` | yes | 2 MB | png/jpeg/webp | user avatars | `profiles.avatar_url` — **column exists, no UI writes it** | none | read-only on `app/salesman/profile/page.tsx` |
| `retailer-documents` | **no** (private) | 10 MB | png/jpeg/webp/pdf | KYC / registration docs | `retailer_documents.file_url` (stores the **object path**, not a URL) | `components/admin/retailer-documents-manager.tsx` | `app/admin/retailers/[id]/page.tsx` via `getSignedUrl()` |

`categories.image_url` exists and is **read** by `app/retailer/categories/page.tsx`,
`app/retailer/home/page.tsx` and `app/retailer/catalog/page.tsx`, but no bucket
and no UI ever wrote it.

### Every storage call site found

```
lib/storage/upload.ts          storage.from(bucket).upload()/.getPublicUrl()/.remove()   (client-side)
lib/storage/signed-url.ts      storage.from('retailer-documents').createSignedUrl()      (server-side)
lib/admin/banners-actions.ts   storage.from('banners').remove([...])                     (on banner delete)
```

Upload path builder: `buildPath(prefix, file)` → `` `${prefix}/${Date.now()}-${safeName}` ``.

### Findings

1. **All uploads run in the browser** with the user's anon session; the only
   enforcement is bucket RLS. There is no server-side MIME sniffing, no
   dimension check, and the browser picks the object path.
2. `product-images` paths are prefixed with the **SKU code**, not the product
   UUID, so renaming a SKU orphans its folder.
3. `banners.image_url` deletion parses the public URL by string-searching
   `/banners/` — brittle but working; preserved.
4. `brand-logos` and `avatars` buckets exist but are dead — no writer.
5. `categories.image_url` is displayed but never populated.

## 5. Business logic that must not be touched

`lib/orders/create-order.ts`, `lib/retailer/effective-price.ts`,
`lib/retailer/checkout-actions.ts`, `lib/retailer/cart-actions.ts`,
`lib/retailer/catalog.ts`, `lib/retailer/personalization.ts`,
`lib/salesman/*`, `lib/staff/*`, `lib/admin/orders-actions.ts`,
`lib/admin/pricing-actions.ts`, `lib/admin/inventory-actions.ts` — read-only
during this work.

## 6. Firebase status

PR #7 (`arena/01a01536-maharani-mart`) adds a Firebase Admin storage layer.
It was audited, is **not merged**, and is **superseded** by the Appwrite media
layer delivered here:

- it requires a Firebase service account + Blaze billing, which the project
  explicitly does not want;
- its file layout (`products/{id}/…`), `StoredImage` compatibility idea and
  dry-run copy script are conceptually re-implemented here against Appwrite.

Nothing from that branch is merged into this branch; `main` contains no
Firebase code, so there is nothing to delete.

## 7. Cloudinary status

No Cloudinary code, dependency or environment variable exists anywhere in the
repository. None added.

## 8. Turso assessment

Read-heavy, non-authoritative candidates found:

| Candidate | Verdict |
| --- | --- |
| `searchSuggestionsAction()` (`lib/retailer/search-actions.ts`) — 3 ILIKE queries per keystroke-debounced call, identical results for every retailer | **Good fit** — cached |
| Catalog cards / pricing (`priceCatalogProducts`) | **Rejected** — retailer-specific pricing, price lists, offers. Authoritative. |
| Recently viewed (`components/retailer/recently-viewed.tsx`) | Already localStorage + server-action re-pricing. Left alone. |
| Orders / credit / cart / inventory | **Rejected** — authoritative, RLS-protected. |

Result: Turso is wired as a **read-through cache for search suggestions only**,
fully optional, and degrades to Supabase when unavailable or unconfigured.
