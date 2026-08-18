# Firebase Cloud Storage (images/files only)

Firebase is used **only** for file and image storage.

Supabase remains the system of record for:

- Authentication
- PostgreSQL
- RLS, roles, and permissions
- Retailers, products, orders, cart, pricing, GST, MOQ, credit
- Notifications, favourites, salesman, staff, admin
- All business logic

Image *metadata* (which product/brand/banner a file belongs to) stays in the existing Postgres columns. New writes store a **Firebase object path**, not a temporary download URL.

## Folder structure

```
products/{productId}/{filename}
products/{productId}/gallery/{filename}
brands/{brandId}/{filename}
categories/{categoryId}/{filename}
banners/{bannerId}/{filename}
retailers/{retailerId}/profile/{filename}
retailers/{retailerId}/documents/{filename}   # private
```

Owner folders are always stable UUIDs. SKU codes and shop names are never used as path prefixes.

## Environment

Copy `.env.local.example` and fill in:

| Variable | Where it may appear | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_FIREBASE_*` | Browser + server | Public web-app config (safe to ship) |
| `FIREBASE_ADMIN_PROJECT_ID` | Server only | Admin SDK project |
| `FIREBASE_ADMIN_CLIENT_EMAIL` | Server only | Service account email |
| `FIREBASE_ADMIN_PRIVATE_KEY` | Server only | Service account private key |
| `FIREBASE_ADMIN_STORAGE_BUCKET` | Server only (optional) | Override bucket name |

Never put the Admin private key, a service-account JSON blob, or `SUPABASE_SERVICE_ROLE_KEY` in a `NEXT_PUBLIC_*` variable.

If Firebase Admin is not configured, new uploads fail with a clear server-side error. Existing Supabase public URLs continue to render.

## Firebase console setup

1. Create (or reuse) a Firebase project. Enable **Cloud Storage only** — do not enable Firebase Auth or Firestore for this app.
2. Create a web app and copy the public config into the `NEXT_PUBLIC_FIREBASE_*` vars.
3. Generate a service account key (Project settings → Service accounts). Store the email + private key in the Admin vars. Do not commit the JSON file.
4. Deploy `firebase/storage.rules`. Those rules allow public **read** of marketplace images and **deny all client writes**. Private KYC documents are not publicly readable; the Admin SDK issues signed URLs.
5. Deploy Storage rules before the first production upload.

## Application layer

| API | Role |
| --- | --- |
| `storage.upload()` / `delete()` / `replace()` / `getUrl()` | Server abstraction (`lib/storage/index.ts`) |
| `lib/storage/actions.ts` | Authorized Server Actions (existing permission matrix) |
| `lib/storage/urls.ts` `resolveMediaUrl()` | Renders both legacy http URLs and new object paths |
| `lib/storage/upload.ts` | **Legacy** Supabase helper, kept for rollback |

Admin uploads require the existing permissions (`products.edit`, `banners.manage`, `master_data.manage`, `retailers.approve`). A retailer profile upload, if used, is forced into `retailers/{auth.uid()}/profile/` — the caller cannot choose another user's folder.

## Migrating existing Supabase files

This environment cannot copy live files without credentials. After setting both Supabase and Firebase Admin env vars:

```bash
npx tsx scripts/migrate-supabase-storage-to-firebase.ts --dry-run
npx tsx scripts/migrate-supabase-storage-to-firebase.ts
```

The script:

1. Reads current image/path columns
2. Copies each referenced Supabase object into Firebase
3. Verifies the copy
4. Updates only that row's path
5. **Does not delete** the original Supabase file

Do not delete old Supabase objects until a production pass has been verified.

## Rollback

1. Stop using the Firebase upload actions (legacy `lib/storage/upload.ts` is still in the repo).
2. Rows that still hold `https://…supabase.co/storage/…` URLs keep rendering.
3. Rows updated to Firebase paths can be pointed back at the original Supabase URL if it was recorded during migration (`--dry-run` prints the mapping).
4. Do not drop Supabase storage buckets or policies as part of this change.
