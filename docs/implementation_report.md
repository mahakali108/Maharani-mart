# Implementation Report — Supabase + Appwrite + Turso

**Branch:** `arena/01a01fd3-maharani-mart`
**Commit:** `7a1bdd1` — `feat(storage): add Appwrite media and Turso cache architecture`
**PR:** [#8](https://github.com/mahakali108/Maharani-mart/pull/8) → `main` — **OPEN, NOT MERGED**
**Diff:** 41 files, +2929 / −208

---

## 0. Two things to read first

1. **Nothing needs to be migrated to deploy this.** References are stored in the *existing* columns. A value that isn't an `appwrite://` reference is treated as legacy and rendered exactly as before. Deploying with no Appwrite credentials at all leaves the app working — uploads simply report "storage is not configured".
2. **The branch name differs from the one suggested.** The request asked for `arena/<session>-supabase-appwrite-turso`. This session is bound to `arena/01a01fd3-maharani-mart` and work on any other branch would not be tracked, so the commit went there. It is still a fresh feature branch off `main` @ `f30879f`, and the PR is open and unmerged as required.

---

## 1. Audit findings

Full baseline in **`docs/storage_audit.md`**.

### Supabase Storage inventory (pre-change)

| Bucket | Purpose | Public | Limit | MIME | DB column | Uploaded from | Rendered at |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `product-images` | Product gallery | yes | 5 MiB | png/jpeg/webp | `product_images.image_url` | `components/admin/product-image-manager.tsx` | admin product page, retailer card/gallery/home/catalog/cart/checkout/quick-order/orders, salesman new order |
| `banners` | Home banners | yes | 5 MiB | png/jpeg/webp | `banners.image_url` | `banner-form.tsx`, `banner-edit-form.tsx` | `app/admin/banners/*`, `components/retailer/promo-banner.tsx` |
| `avatars` | Profile photos | yes | 2 MiB | png/jpeg/webp | `profiles.avatar_url` | **no uploader existed** | `app/salesman/profile/page.tsx` |
| `brand-logos` | Brand logos | yes | 2 MiB | png/jpeg/webp/svg | `brands.logo_url` | **no uploader existed** | **never rendered** |
| `retailer-documents` | KYC paperwork | **no** | 10 MiB | png/jpeg/webp/pdf | `retailer_documents.file_url` (stores a *path*, not a URL) | `retailer-documents-manager.tsx` | `app/admin/retailers/[id]/page.tsx` via `getSignedUrl` |

`categories.image_url` exists in the schema with no uploader and no reader.

### Problems found

- **Unstable paths.** `buildPath()` produced `<prefix>/<Date.now()>-<filename>` — collision-prone and not addressable by entity.
- **Client-side uploads.** `lib/storage/upload.ts` ran in the browser using the anon key. Bucket and path were chosen client-side; the only guard was bucket RLS.
- **No content validation.** Only the browser-declared MIME type was ever checked. A renamed executable would pass.
- **Orphaned files.** `removeProductImageAction` and `deleteRetailerDocumentAction` deleted the DB row only. `deleteBannerAction` did attempt file cleanup, by string-slicing on `'/banners/'`.
- **Dead columns.** `brands.logo_url` and `categories.image_url` had no write path at all.

### Deliberately left alone

`lib/orders/create-order.ts`, pricing/GST/credit/MOQ/cart validation, retailer approval, order status transitions, the PR #5 retailer marketplace, `middleware.ts`, all RLS policies, all 15 migrations.

---

## 2. Files created

**Media facade** (the only place the storage SDK appears)

| File | Role |
| --- | --- |
| `lib/media/index.ts` | Public facade — `uploadMedia()`, `deleteMedia()`, re-exports |
| `lib/media/types.ts` | `MediaKind` + per-kind config (limits, MIME, folder, private flag) |
| `lib/media/refs.ts` | `appwrite://` parsing + URL building. Isomorphic, secret-free |
| `lib/media/paths.ts` | Server-owned UUID file ids, filename sanitising, path building |
| `lib/media/validate.ts` | Magic-byte sniffing, extension cross-check, size + dimension limits |
| `lib/media/access.ts` | Role/permission + ownership authorisation |
| `lib/media/optimize.ts` | Client-side downscale helper + render width table |
| `lib/media/actions.ts` | `uploadMediaAction` Server Action — the single browser entry point |
| `lib/media/document-url.ts` | Resolves `retailer_documents.file_url` across both generations |
| `lib/media/appwrite/server.ts` | Admin client. `server-only`, reads `APPWRITE_API_KEY` |
| `lib/media/appwrite/upload.ts` | The only file that writes to Appwrite |
| `lib/media/appwrite/delete.ts` | Best-effort, non-throwing delete |
| `lib/media/appwrite/url.ts` | Authorised server-side byte read for private files |

**Turso cache**

| File | Role |
| --- | --- |
| `lib/turso/client.ts` | Optional client; returns `null` when unconfigured. Idempotent schema setup |
| `lib/turso/cache.ts` | Generic read-through cache; every Turso error is a cache miss |
| `lib/turso/catalog.ts` | Search-suggestions helper — the entire current scope |
| `lib/turso/types.ts` | Namespaces + TTL |

**UI + route + tooling**

| File | Role |
| --- | --- |
| `components/media/stored-image.tsx` | **The single image resolver.** Renders Appwrite refs and legacy Supabase URLs identically |
| `components/media/media-upload-field.tsx` | Reusable picker; posts to the Server Action. No storage SDK in the browser |
| `app/api/media/private/route.ts` | Authorised streaming endpoint for private documents |
| `scripts/migrate-supabase-storage-to-appwrite.ts` | Optional copy/verify/repoint tool, `--dry-run` by default |

**Docs:** `docs/storage_audit.md`, `docs/appwrite_setup.md`, `docs/turso.md`, `docs/implementation_report.md`

## 3. Files modified

| File | Change |
| --- | --- |
| `components/admin/product-image-manager.tsx` | Client upload → `MediaUploadField`; `next/image` → `StoredImage`; `skuCode` prop dropped |
| `components/admin/banner-form.tsx` | Same conversion; hidden `imageUrl` field now carries a media ref |
| `components/admin/banner-edit-form.tsx` | Same, seeded with the existing value (may be a legacy URL) |
| `components/admin/brand-edit-form.tsx` | **New** logo upload + preview + remove |
| `components/admin/category-edit-form.tsx` | **New** image upload + preview + remove |
| `components/admin/retailer-documents-manager.tsx` | Client upload → `MediaUploadField` (private kind) |
| `lib/admin/products-actions.ts` | `removeProductImageAction` now deletes the file too |
| `lib/admin/banners-actions.ts` | zod accepts refs *and* legacy URLs; delete uses `deleteMedia()` instead of `'/banners/'` slicing |
| `lib/admin/master-data-actions.ts` | Brand/category schemas gained optional media refs; replaced/deleted files cleaned up |
| `lib/retailer/search-actions.ts` | Query extracted into `loadSearchSuggestions()`, wrapped in the optional cache |
| `app/admin/products/[id]/page.tsx` | Drops the removed `skuCode` prop |
| `app/admin/retailers/[id]/page.tsx` | `getSignedUrl` → `resolveDocumentUrl` (handles both generations) |
| `app/admin/catalog/brands/[id]/page.tsx` | Selects and passes `logo_url` |
| `app/admin/catalog/categories/[id]/page.tsx` | Selects and passes `image_url` |
| `.env.local.example` | Appwrite + Turso placeholders, grouped and annotated |
| `docs/security_checklist.md` | New Appwrite and Turso sections; storage section split legacy/new |
| `package.json` | `+ node-appwrite@^17.2.0`, `+ @libsql/client@^0.17.4` |

**Files deleted:** none. `lib/storage/upload.ts` now has zero consumers but was kept — deleting it is a separate, reversible cleanup. `lib/storage/signed-url.ts` is still used for legacy documents.

---

## 4. Migrations

**None.** No schema change was necessary — every reference reuses an existing column:

`product_images.image_url` · `banners.image_url` · `brands.logo_url` · `categories.image_url` · `profiles.avatar_url` · `retailer_documents.file_url`

No RLS policy was added, altered or weakened. The Supabase Storage buckets and their policies are left fully in place, because existing rows still point at them.

---

## 5. Appwrite setup required

Full walkthrough in `docs/appwrite_setup.md`.

1. **Public bucket** `APPWRITE_BUCKET_ID` — File Security *disabled*, bucket permissions *empty*, 5 MB, `jpg/jpeg/png/webp`, encryption + antivirus on.
2. **Private bucket** `APPWRITE_PRIVATE_BUCKET_ID` — same, plus 10 MB and `pdf`.
3. **API key** scoped to `files.read` + `files.write` only.

Per-file permissions are set by the server: public files get `read("any")`; private files get **no permissions at all**, so only the API key can read them.

If the private bucket is unset, the code falls back to the public bucket rather than crashing — `hasDedicatedPrivateBucket()` reports this, and the migration script refuses to move documents in that state.

### Path scheme

```
products/{productId}/gallery/{uuid}.{ext}
banners/{bannerId}/{uuid}.{ext}
brands/{brandId}/{uuid}.{ext}
categories/{categoryId}/{uuid}.{ext}
retailers/{retailerId}/profile/{uuid}.{ext}
retailers/{retailerId}/documents/{uuid}.{ext}
```

Appwrite storage is flat, so this is recorded metadata rather than real directories — but it matches the Supabase layout, keeps the migration verifiable, and matches the scheme proposed in PR #7.

---

## 6. Turso usage

**Cached:** search suggestions only (`search-suggestions`, 300 s TTL). Catalog-wide, identical for every retailer, contains no prices, favourites or credit data.

**Not cached, and must never be:** auth, sessions, roles, cart, checkout, order creation, pricing/GST/MOQ, credit, inventory, retailer approval.

**Degradation:** `getTursoClient()` returns `null` when unconfigured; every cache call catches its own errors and returns a miss. `cached()` does *not* swallow loader errors — a Supabase failure still surfaces. Failures log once per process, not per request.

**Authorisation is never cached:** `requirePermission('products.view')` runs before the cache on every call.

**Schema:** one generic `cache_entries` key/value table, created with `IF NOT EXISTS` on first use.

---

## 7. Supabase changes

| Area | Change |
| --- | --- |
| Tables / schema | none |
| RLS policies | none |
| Auth | none |
| Storage buckets | none — left in place and still serving |
| Server actions | permission checks unchanged; file cleanup added to three delete paths |

Supabase remains the sole source of truth. Appwrite never makes an access decision; it only receives requests the Supabase-authenticated server has already approved.

---

## 8. Firebase / Cloudinary status

**Firebase: not present, not added.** No dependency, no config, no service account, no Blaze billing. **PR #7** (`arena/01a01536-maharani-mart`, "Firebase Cloud Storage") is still open but was never merged to `main`, so nothing needed removing. It is **superseded** by this work — see `docs/storage_audit.md` §6. Its path scheme was reused deliberately. Recommend closing PR #7 once #8 is reviewed.

**Cloudinary: not present, not added.** No `CLOUDINARY_*` variables, no upload logic, no dependency.

---

## 9. Environment variables

New, all optional — the app runs without them:

| Variable | Exposure | Purpose |
| --- | --- | --- |
| `APPWRITE_ENDPOINT` | server | API endpoint |
| `APPWRITE_PROJECT_ID` | server | Project id |
| `APPWRITE_API_KEY` | **server-only, secret** | `files.read` + `files.write` |
| `APPWRITE_BUCKET_ID` | server | Public media bucket |
| `APPWRITE_PRIVATE_BUCKET_ID` | server | Private documents bucket |
| `NEXT_PUBLIC_APPWRITE_ENDPOINT` | browser | URL building — not a secret |
| `NEXT_PUBLIC_APPWRITE_PROJECT_ID` | browser | URL building — not a secret |
| `TURSO_DATABASE_URL` | server | libSQL URL |
| `TURSO_AUTH_TOKEN` | **server-only, secret** | libSQL token |

The two `NEXT_PUBLIC_` Appwrite values already appear inside every public Appwrite file URL, so they carry no secrecy. `.env.local.example` contains placeholders only.

---

## 10. Security checks performed

| Check | Result |
| --- | --- |
| Secrets in client bundle (`grep` over `.next/static` for `APPWRITE_API_KEY`, `TURSO_AUTH_TOKEN`, `SERVICE_ROLE`) | **no matches** |
| Storage SDK imported outside `lib/media/` / `lib/turso/` | **none** |
| `server-only` guard on secret-reading modules | present in `appwrite/server.ts`, `turso/client.ts`, `media/access.ts`, `media/index.ts` |
| Browser MIME trusted? | no — magic-byte sniff + extension cross-check + server-side size/dimension re-check |
| Browser chooses bucket/path/file id? | no — all server-derived from a validated `MediaKind` |
| Cross-retailer upload possible? | no — `access.ts` rejects any `ownerId` that isn't the caller's own for self-service kinds |
| Private files publicly reachable? | no — uploaded with zero permissions; only `/api/media/private` streams them, after a session + role check |
| RLS weakened? | no policy touched |
| Secrets committed? | no — placeholders only; `.env*.local` still gitignored |

---

## 11. Validation results

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | **pass** — no errors |
| `npm run lint` | **pass** — "No ESLint warnings or errors" |
| `npm run build` | **pass** — all routes compiled, `/api/media/private` registered |
| `git diff --check` | **clean** |

**Build caveat, as predicted:** `next/font/google` cannot reach `fonts.googleapis.com` from this sandbox. Per the agreed workaround, `app/layout.tsx` was temporarily switched to a local font stub, the build was run, and the file was restored. Verified byte-for-byte: SHA-256 `f848a7e5…5e26c7f` before and after, and `git diff app/layout.tsx` is empty. **`app/layout.tsx` is not part of this commit.**

`package-lock.json` was regenerated but **not committed** — it has never been tracked in this repository, and this change follows that convention.

---

## 12. Migration status

**Not run.** Nothing has been copied and no column has been repointed — correctly so, since this deployment has no Appwrite credentials and existing files keep working untouched.

`scripts/migrate-supabase-storage-to-appwrite.ts` is ready when you are:

```bash
npx tsx scripts/migrate-supabase-storage-to-appwrite.ts --dry-run
npx tsx scripts/migrate-supabase-storage-to-appwrite.ts --apply --only=banners
```

Safety properties baked in: dry run by default; each copy verified by byte length *before* the DB row is updated; already-migrated rows skipped (idempotent, re-runnable); documents refused when no dedicated private bucket exists; `--delete` / `--purge` explicitly rejected. **Supabase Storage files are never deleted.**

---

## 13. Rollback

| Scenario | Action |
| --- | --- |
| Disable Appwrite uploads | Unset the Appwrite env vars. Uploads report "not configured"; every existing image still renders |
| Disable Turso | Unset both Turso vars. `cachedSearchSuggestions()` becomes a pass-through |
| Revert one migrated row | Write the original Supabase URL back into the column — the object was never deleted |
| Revert the whole feature | Deploy the previous commit. No schema changed, no policy changed, no file was moved or deleted |

The rollback story is this simple *because* legacy values never stopped resolving.

---

## 14. Implemented vs. prepared

### Implemented and verified here

- Complete read-only audit with full Supabase Storage inventory
- `lib/media/` facade: types, refs, paths, validation, access control, optimisation, actions
- Appwrite adapter: server client, upload, delete, authorised read
- `StoredImage` dual-generation resolver + `MediaUploadField`
- All four uploaders converted; brand/category upload UI added where none existed
- `/api/media/private` authorised streaming route
- File cleanup wired into product-image, banner, brand and category deletes
- `lib/turso/` cache wired into search suggestions with graceful degradation
- Migration script, env example, three docs, security checklist extension
- Typecheck, lint and production build all passing; client bundle scanned for secrets

### Prepared but requires live credentials

- **Appwrite buckets and API key have not been created.** Console steps are in `docs/appwrite_setup.md`.
- **No upload has been performed against a live Appwrite project.** The code path is unit-consistent and type-checked but has not made a network call. I am not claiming a tested round-trip.
- **Turso connectivity has not been exercised.** The unconfigured path (`getTursoClient() → null`) is the one that ran during the build; the connected path has not been executed against a real database.
- **The migration script has never been run**, not even as a dry run, since it requires both a service-role key and Appwrite credentials.

### Recommended next steps

1. Create the two Appwrite buckets and the scoped API key.
2. Set the env vars in a preview deployment and upload one product image end to end.
3. Verify a retailer document downloads for staff and 403s for an unrelated retailer.
4. Run the migration dry run, then apply per table starting with `banners`.
5. Optionally provision Turso and confirm suggestions still work when you then remove the vars.
6. Close PR #7 (Firebase) as superseded.
