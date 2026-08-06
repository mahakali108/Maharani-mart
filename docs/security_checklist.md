# Security Checklist

## Secrets

- [ ] `SUPABASE_SERVICE_ROLE_KEY` is set only in Vercel's server environment variables — never prefixed `NEXT_PUBLIC_`, never referenced from a Client Component, never logged
- [ ] `WEBHOOK_SECRET` is a long, random value — not a guessable string
- [ ] `.env.local` is gitignored and has never been committed (check `git log --all --full-history -- .env.local` returns nothing)
- [ ] No API keys or secrets appear in client-side bundles — the only Supabase key shipped to the browser is `NEXT_PUBLIC_SUPABASE_ANON_KEY`, which is designed to be public and relies on RLS for protection

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

## Storage

- [ ] Every storage bucket has explicit RLS policies (`0003_storage_buckets.sql`) — no bucket is public-write
- [ ] File size limits and MIME type allow-lists are set per bucket (prevents arbitrary file upload abuse)
- [ ] Avatar uploads are scoped to a path prefixed with the uploader's own `auth.uid()`, preventing one user from overwriting another's file

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
