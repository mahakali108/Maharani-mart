# Production Build Verification Checklist

Run through this before every deploy to `main`.

## Before pushing

- [ ] `npm install` completes clean (no peer-dependency errors)
- [ ] `npm run typecheck` — zero TypeScript errors
- [ ] `npm run lint` — zero ESLint errors
- [ ] `npm run build` — completes successfully locally
- [ ] No `console.log` left in server actions or route handlers (`console.error` in error boundaries is fine)
- [ ] `.env.local` is NOT committed (confirm `git status` is clean of it)

## Supabase

- [ ] All three migrations (`0001_init.sql`, `0002_auth_trigger.sql`, `0003_storage_buckets.sql`) applied, in order, to the target project
- [ ] `select * from areas;` — confirm it's empty (no seed data) unless you've deliberately added real areas
- [ ] Auth → Settings → Site URL and Redirect URLs point at the correct environment
- [ ] At least one `super_admin` profile exists (see README §1.4) or you will be locked out of `/admin`

## Vercel environment variables

- [ ] `NEXT_PUBLIC_SUPABASE_URL`
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- [ ] `SUPABASE_SERVICE_ROLE_KEY` (server-only — verify it is NOT prefixed `NEXT_PUBLIC_`)
- [ ] `NEXT_PUBLIC_SITE_URL` matches the actual deployed domain

## Post-deploy smoke test

- [ ] `/` redirects unauthenticated visitors to `/login`
- [ ] `/register-retailer` loads; Area dropdown shows real areas (or the "not configured yet" message if none exist)
- [ ] Logging in as the bootstrapped `super_admin` lands on `/admin/dashboard` with all stat cards showing `0`, not errors
- [ ] Visiting `/staff/dashboard` while logged in as `retailer` redirects to `/unauthorized`
- [ ] Visiting `/admin/dashboard` while logged out redirects to `/login`
- [ ] A retailer with `status = 'pending_approval'` is forced to `/pending-approval` on any protected route
- [ ] Manually breaking a page (e.g. temporarily throwing in a Server Component) confirms `error.tsx` renders instead of a blank screen — then revert the test change

## Explicitly confirm — zero fabricated data

- [ ] No table in Supabase contains rows inserted by a migration (all three migration files contain schema/policy DDL only — no `insert into` statements outside of `storage.buckets`, which are configuration, not business data)
- [ ] No component renders a hardcoded product, order, retailer, or report number
- [ ] Every empty list in the UI shows a designed empty state, not a crash or infinite spinner
