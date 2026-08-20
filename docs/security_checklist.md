# Security Checklist

## Secrets

- [ ] `SUPABASE_SERVICE_ROLE_KEY` is set only in Vercel's server environment variables — never prefixed `NEXT_PUBLIC_`, never referenced from a Client Component, never logged
- [ ] `WEBHOOK_SECRET` is a long, random value — not a guessable string
- [ ] `.env.local` is gitignored and has never been committed (check `git log --all --full-history -- .env.local` returns nothing)
- [ ] No API keys or secrets appear in client-side bundles — the only Supabase key shipped to the browser is `NEXT_PUBLIC_SUPABASE_ANON_KEY`, which is designed to be public and relies on RLS for protection
- [ ] `APPWRITE_API_KEY` is server-only — never prefixed `NEXT_PUBLIC_`, never logged, never stored in a database row. It is read solely by `lib/media/appwrite/server.ts`, which is marked `server-only` so any client import is a build error
- [ ] `TURSO_AUTH_TOKEN` is server-only — never prefixed `NEXT_PUBLIC_`. Read solely by `lib/turso/client.ts` (`server-only`)
- [ ] The Appwrite API key is scoped to `files.read` + `files.write` only — no `databases.*`, `users.*`, `sessions.*` or `functions.*` scopes
- [ ] `NEXT_PUBLIC_APPWRITE_ENDPOINT` / `NEXT_PUBLIC_APPWRITE_PROJECT_ID` are the *only* Appwrite values exposed to the browser; both already appear inside every public Appwrite file URL and are not secrets
- [ ] Verify no secret leaked into the client bundle after a build: `grep -r "APPWRITE_API_KEY\|TURSO_AUTH_TOKEN\|SERVICE_ROLE" .next/static/ && echo LEAK` returns no matches

## Database (Postgres / Supabase)

- [ ] Row Level Security is **enabled** on every table containing business or personal data (confirm via Supabase dashboard → Database → Tables → RLS column, or `select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace;`)
- [ ] No table is left with RLS enabled but zero policies (which would silently deny everyone, including admins — check for this explicitly)
- [ ] `service_role` key is only used server-side and only where RLS legitimately needs to be bypassed (e.g. admin-only account creation in Phase 2)
- [ ] Every write-triggering table (`products`, `price_lists`, `orders`) has an audit trigger attached (`0001_init.sql` §10)

## Authentication

- [ ] Password minimum length enforced both client-side (Zod schema in `lib/auth/actions.ts`) and in Supabase Auth settings
- [ ] Session cookies are httpOnly and handled entirely by `@supabase/ssr` — the app never reads/writes the raw JWT manually
- [ ] `middleware.ts` runs on every request matching protected routes and re-validates the session server-side — it does not trust client-side role state
- [ ] Deactivated (`is_active = false`) or suspended retailer accounts are force-signed-out on their next request, not just hidden in the UI

## Storage — Supabase Storage (legacy, still serving existing files)

- [ ] Every storage bucket has explicit RLS policies (`0003_storage_buckets.sql`) — no bucket is public-write
- [ ] File size limits and MIME type allow-lists are set per bucket (prevents arbitrary file upload abuse)
- [ ] Avatar uploads are scoped to a path prefixed with the uploader's own `auth.uid()`, preventing one user from overwriting another's file
- [ ] Buckets and policies are left **in place** after the Appwrite rollout — existing rows still hold Supabase URLs and must keep resolving. Nothing auto-deletes these objects

## Storage — Appwrite (new uploads)

See `docs/appwrite_setup.md` for the full configuration.

- [ ] Two buckets exist: a public media bucket (`APPWRITE_BUCKET_ID`) and a **separate** private documents bucket (`APPWRITE_PRIVATE_BUCKET_ID`). If they are the same id, retailer KYC paperwork is sitting in a publicly delivered bucket — fix before production (`hasDedicatedPrivateBucket()` reports this)
- [ ] Both buckets have **File Security disabled** and an **empty bucket-level permission list**, so access is decided per file by the server rather than by a bucket-wide grant
- [ ] Public files carry exactly `read("any")`; private files carry **no permissions at all** and are reachable only through the server API key
- [ ] Retailer documents are served only via `GET /api/media/private?ref=…`, which re-checks the Supabase session and `retailers.view` (or own-id) before streaming bytes — the raw Appwrite URL is never handed to the browser
- [ ] Per-bucket maximum file size and allowed extensions are configured in the Appwrite console *in addition* to the application-level checks (defense in depth)
- [ ] Antivirus and encryption are enabled on both buckets
- [ ] The browser never chooses a bucket, file id, folder or path — all are derived server-side in `lib/media/paths.ts` from a validated `MediaKind` + owner id
- [ ] The browser-supplied MIME type is never trusted: `lib/media/validate.ts` sniffs magic bytes, cross-checks the extension, and re-checks byte size server-side
- [ ] Ownership is enforced in `lib/media/access.ts`: a retailer can only ever upload against their own id, and tampering with `ownerId` is rejected before anything is written
- [ ] Every upload passes through `uploadMediaAction` (`lib/media/actions.ts`). Confirm no Appwrite SDK import exists outside `lib/media/`: `grep -rn "node-appwrite" app components lib --include=*.ts --include=*.tsx | grep -v "^lib/media/"` returns nothing
- [ ] Appwrite is used for **files only** — no Appwrite Database, no Appwrite Auth, no Appwrite Functions
- [ ] Rotate the Appwrite API key on the schedule set at creation

## Turso (optional cache)

See `docs/turso.md`.

- [ ] Turso holds **derived data only**. Confirm nothing authoritative reads from it: login, cart, checkout, order creation, credit, pricing, inventory, retailer approval and permission checks all query Supabase directly
- [ ] The app has been smoke-tested with `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` **unset** — search, catalog and checkout must behave identically
- [ ] Cached payloads contain no per-user data. The `search-suggestions` key is the normalised query string only, never a user id
- [ ] `requirePermission()` runs *before* the cache is consulted, so a cache hit can never bypass authorisation
- [ ] No business-shaped tables have been added to the Turso schema — only the generic `cache_entries` key/value table

## API routes

- [ ] `/api/webhooks` rejects any request missing or mismatching `x-webhook-secret`
- [ ] `/api/health` exposes no sensitive information (no stack traces, no internal error detail) in its response body

## Application-level

- [ ] `lib/permissions/permissions.ts` checks are present in every Server Action that mutates data, in addition to relying on RLS (defense in depth — see `docs/role_permission_matrix.md`)
- [ ] Error boundaries (`error.tsx`) never render a raw stack trace or database error message to the end user — only a safe fallback message and, in the root boundary, a `digest` reference for support lookups
- [ ] `console.error` in error boundaries is the only place errors are logged client-side; there is no plan to log full error objects (which could contain user data) to a third-party service without review

## Before every production deploy

- [ ] Run through `BUILD_CHECKLIST.md`
- [ ] Confirm the Supabase project's Auth Redirect URLs match the current production domain exactly (mismatches here are a common vector for OAuth/redirect issues)
- [ ] Confirm no test/sandbox Supabase project is accidentally referenced in production environment variables
