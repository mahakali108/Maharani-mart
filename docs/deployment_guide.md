# Deployment Guide — Vercel + Supabase

## 1. Provision Supabase

1. Create a project at [supabase.com](https://supabase.com) (choose a region close to GAYA — `ap-south-1`/Mumbai is closest).
2. In **SQL Editor**, run these in order (copy-paste each file's contents and run):
   - `supabase/migrations/0001_init.sql`
   - `supabase/migrations/0002_auth_trigger.sql`
   - `supabase/migrations/0003_storage_buckets.sql`
3. **Authentication → URL Configuration**: set Site URL and add Redirect URLs for both your production domain and `http://localhost:3000`.
4. **Authentication → Providers → Email**: decide whether to require email confirmation (see `README.md` §1.3 for the tradeoff).
5. Note down from **Project Settings → API**:
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
