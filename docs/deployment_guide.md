# Deployment Guide — Vercel + Supabase

## 1. Provision Supabase

1. Create a project at [supabase.com](https://supabase.com) (choose a region close to GAYA — `ap-south-1`/Mumbai is closest).
2. In **SQL Editor**, run **every file in `supabase/migrations/` in numeric order** (copy-paste each file's contents and run). Do not stop after the first few — later migrations add tables, RLS and storage buckets the deployed code expects. The storage-critical ones: `0003` (product-images/banners/avatars/brand-logos), `0006` (retailer-documents), `0013` (policy hardening), `0016` (**category-images** bucket), `0021` (idempotent ensure-safe re-check of `category-images`).
3. Verify the Storage buckets actually exist in that project: `node scripts/verify-storage-bucket.mjs` (run with the project's env vars; checks `category-images` and does a real upload/read/delete round-trip).
4. **Authentication → URL Configuration**: set Site URL and add Redirect URLs for both your production domain and `http://localhost:3000`.
5. **Authentication → Providers → Email**: decide whether to require email confirmation (see `README.md` §1.3 for the tradeoff).
6. Note down from **Project Settings → API**:
   - Project URL
   - `anon` public key
   - `service_role` key (keep secret)

## 2. Push to GitHub

See `docs/github_upload_guide.md` if you haven't already.

## 3. Import into Vercel

1. [vercel.com/new](https://vercel.com/new) → import the GitHub repo.
2. Framework preset: **Next.js** (auto-detected via `vercel.json`).
3. Add environment variables (Project Settings → Environment Variables), for **Production**, **Preview**, and **Development**:

   | Key | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | from Supabase step 5 |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | from Supabase step 5 |
   | `SUPABASE_SERVICE_ROLE_KEY` | from Supabase step 5 — server-only |
   | `NEXT_PUBLIC_SITE_URL` | your Vercel production URL |
   | `WEBHOOK_SECRET` | a long random string you generate |

4. Deploy.

## 4. Post-deploy

1. Update Supabase Auth Redirect URLs to include the real production URL (if not already).
2. Bootstrap your first Super Admin — see `README.md` §1.4.
3. Run through `BUILD_CHECKLIST.md` in full before telling anyone the platform is "live."

## 5. Ongoing deploys

- Every push to `main` auto-deploys to production.
- Every pull request gets its own Preview deployment — point Preview's Supabase env vars at a **separate** Supabase project if you want to test against non-production data safely (recommended once real retailer data exists).
- New Supabase migrations are **not** run automatically — apply them manually (or via `supabase db push` in CI) before or immediately after the corresponding code deploys, in the same order they're numbered.

## 6. Troubleshooting — `Upload failed: Bucket not found`

The app uploads images through Supabase Storage only (`lib/media`). This error
means the bucket the app targets **does not exist in the Supabase project the
environment variables point at** — it is a project-migration problem, not a
code problem. In order:

1. **Confirm the environment points at the right project.** `NEXT_PUBLIC_SUPABASE_URL`
   (and the anon/service keys) must all come from the *same* project. Preview
   deployments that were pointed at a fresh or older project hit this first.
2. **Check the bucket.** In the SQL editor of that project:
   `select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'category-images';`
   The canonical names are `product-images`, `banners`, `avatars`, `brand-logos`,
   `category-images`, `retailer-documents` (`docs/storage-buckets.md`).
3. **If the row is missing, apply the storage migrations** — `supabase db push`, or
   run `supabase/migrations/0021_ensure_category_images_bucket.sql`. It is idempotent,
   creates *no* duplicate bucket, and converges a project where `0016` was skipped.
   A `category-images` bucket manually created in the dashboard with identical
   settings is equivalent, but the migration is the supported path.
4. **If a *differently named* legacy bucket holds category images**, decide
   deliberately: either migrate the objects into `category-images` and re-point
   `categories.image_url`, or change `MEDIA_KIND_CONFIG['category-image'].bucket`
   to the existing name. Never keep two category buckets.
5. **Re-verify with a real upload:** `node scripts/verify-storage-bucket.mjs`
   (server-side env vars only; checks existence, settings and performs a
   throwaway upload → public-read → delete round-trip).

Retailer display needs **public read** on `category-images`; writes stay
RLS-restricted (`insert`/`update` = staff+, `delete` = admin+). No service-role
key is ever used by the upload path — if you are tempted to "fix" uploads by
relaxing RLS or exposing more keys, don't: fix the missing bucket instead.
