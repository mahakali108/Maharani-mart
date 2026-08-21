# Appwrite setup (media storage only)

Appwrite is used in this project for **one thing: storing image and document
files**. It is not the auth provider, and no business data is ever written to
Appwrite Database. Supabase remains the primary backend (Postgres, Auth, RLS)
and continues to own every table, including the columns that hold the file
references produced here.

If Appwrite is not configured, the app still runs: uploads are disabled with a
clear message, and every image already stored in Supabase Storage renders
exactly as before.

---

## 1. Create the project

1. Sign in at <https://cloud.appwrite.io> (or your self-hosted console).
2. Create a project — e.g. **Maharani Mart**.
3. Copy the **Project ID** and the **API Endpoint**
   (Appwrite Cloud: `https://cloud.appwrite.io/v1`; some regions use
   `https://<region>.cloud.appwrite.io/v1` — use whatever the console shows).

## 2. Create two buckets

Storage → Create bucket, twice.

### Bucket A — public media

| Setting | Value |
| --- | --- |
| Bucket ID | `maharani-media` (or your own; it goes in `APPWRITE_STORAGE_BUCKET_ID`) |
| Name | Maharani media |
| **File security** | **Disabled** — permissions are set per-file by the server |
| Permissions | Leave the bucket-level list **empty** |
| Maximum file size | `5 MB` |
| Allowed extensions | `jpg`, `jpeg`, `png`, `webp` |
| Compression | `gzip` (optional) |
| Encryption | On |
| Antivirus | On |

Holds product gallery images, banners, brand logos, category images and
retailer avatars. The server attaches `read("any")` to each individual file, so
these are CDN-deliverable without an API key. Writes are always API-key-only.

### Bucket B — private documents

| Setting | Value |
| --- | --- |
| Bucket ID | `maharani-documents` (goes in `APPWRITE_PRIVATE_BUCKET_ID`) |
| Name | Maharani documents |
| **File security** | **Disabled** |
| Permissions | Leave the bucket-level list **empty** |
| Maximum file size | `10 MB` |
| Allowed extensions | `jpg`, `jpeg`, `png`, `webp`, `pdf` |
| Encryption | On |
| Antivirus | On |

Holds retailer KYC paperwork. Files here are uploaded with **no permissions at
all**, so nothing but the server API key can read them. They reach the browser
only through `GET /api/media/private?ref=…`, which re-checks the Supabase
session and role first (`retailers.view`, or the retailer's own id) and then
streams the bytes.

> If `APPWRITE_PRIVATE_BUCKET_ID` is left unset, the code falls back to the
> public bucket so nothing crashes — but the files would then sit in a bucket
> intended for public delivery. `hasDedicatedPrivateBucket()` reports this, and
> the migration script refuses to migrate documents in that state. **Set the
> dedicated bucket before production.**

## 3. Create the API key

Overview → Integrations → API keys → Create API key.

| Setting | Value |
| --- | --- |
| Name | `maharani-server` |
| Scopes | `files.read`, `files.write` **only** |
| Expiration | Set a rotation date |

Do **not** grant `databases.*`, `users.*`, `sessions.*` or `functions.*` — the
application never calls those APIs, and a narrow key limits the blast radius.

The key is read only by `lib/media/appwrite/server.ts`, which starts with
`import 'server-only'`. That makes it a **build-time error** for any Client
Component to pull the key into the browser bundle.

## 4. Environment variables

```bash
APPWRITE_ENDPOINT=https://cloud.appwrite.io/v1
APPWRITE_PROJECT_ID=<project id>
APPWRITE_API_KEY=<server api key>          # server-only, never NEXT_PUBLIC_
# Canonical bucket variable. The legacy alias APPWRITE_BUCKET_ID is still
# accepted as a fallback — set exactly ONE of the two.
APPWRITE_STORAGE_BUCKET_ID=maharani-media
APPWRITE_PRIVATE_BUCKET_ID=maharani-documents

# Optional browser mirrors, used only to build public file URLs.
# Not secrets: both already appear in every public Appwrite file URL.
NEXT_PUBLIC_APPWRITE_ENDPOINT=https://cloud.appwrite.io/v1
NEXT_PUBLIC_APPWRITE_PROJECT_ID=<project id>
```

See `.env.local.example`. Never commit real values.

---

## 5. How the upload flow works

```
browser file picker  (components/media/media-upload-field.tsx)
   │  best-effort client-side downscale (convenience only)
   ▼
uploadMediaAction    (lib/media/actions.ts — 'use server')
   ▼
uploadMedia()        (lib/media/index.ts)
   ├─ requireUser()            → Supabase session, else redirect
   ├─ authorizeMediaWrite()    → role/permission + ownership (lib/media/access.ts)
   ├─ validateUpload()         → magic-byte sniff, extension cross-check,
   │                             size + dimension limits (lib/media/validate.ts)
   └─ uploadToAppwrite()       → server-generated bucket + UUID file id
   ▼
caller saves `result.ref` into the existing Supabase column
```

The browser sends only a `MediaKind` and an owner id. **The server derives the
bucket, the file id, the logical path and the permissions.** The browser's
claimed MIME type is never trusted — the type is sniffed from the file's magic
bytes and cross-checked against the extension.

### Permission matrix

| Media kind | Column written | Permission required | Self-service |
| --- | --- | --- | --- |
| `product-gallery` | `product_images.image_url` | `products.edit` | — |
| `brand-logo` | `brands.logo_url` | `master_data.manage` | — |
| `category-image` | `categories.image_url` | `master_data.manage` | — |
| `banner` | `banners.image_url` | `banners.manage` | — |
| `retailer-avatar` | `profiles.avatar_url` | `retailers.approve` | own id |
| `retailer-document` | `retailer_documents.file_url` | `retailers.approve` | own id |

A retailer can only ever target their own id; tampering with `ownerId` in the
request is rejected in `lib/media/access.ts`. Supabase RLS is still the final
authority on the row write that follows.

### Size and type limits

| Kind | Max size | Types | Downscaled to |
| --- | --- | --- | --- |
| Product image | 5 MB | JPEG/PNG/WebP | 1600 px longest edge |
| Banner | 5 MB | JPEG/PNG/WebP | 2000 px |
| Brand logo | 2 MB | JPEG/PNG/WebP | 800 px |
| Category image | 2 MB | JPEG/PNG/WebP | 800 px |
| Retailer avatar | 2 MB | JPEG/PNG/WebP | 512 px |
| Retailer document | 10 MB | JPEG/PNG/WebP/PDF | never (KYC must stay legible) |

## 6. Reference format and backward compatibility

Appwrite-backed files are stored in the existing Supabase columns as:

```
appwrite://<bucketId>/<fileId>
```

Anything else — a Supabase Storage public URL, a bare object path, an external
URL — is treated as **legacy** and rendered unchanged. `StoredImage`
(`components/media/stored-image.tsx`) is the single resolver for both
generations, so **no data migration is required** to deploy this.

Public delivery URL:
`<endpoint>/storage/buckets/<bucket>/files/<id>/view?project=<projectId>`,
or `/preview?...&output=webp&width=…` when a render size is requested.

## 7. Migrating existing files (optional)

`scripts/migrate-supabase-storage-to-appwrite.ts` copies existing objects into
Appwrite and repoints the columns. It **never deletes anything from Supabase
Storage**, defaults to a dry run, and verifies each copy before updating a row.

```bash
npx tsx scripts/migrate-supabase-storage-to-appwrite.ts --dry-run
npx tsx scripts/migrate-supabase-storage-to-appwrite.ts --apply --only=banners
```

Rollback: because old objects are untouched, reverting a row means writing the
original Supabase URL back into the column. Reverting the whole feature means
deploying the previous commit — legacy URLs never stopped working.
