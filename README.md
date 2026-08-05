# Maa Kali B2B Ultra Platform — Phase 1

FMCG B2B distribution platform for the Khagaria district retail network.
**Phase 1 scope:** project foundation — Supabase schema, authentication,
role-based routing, and layout shells for all five roles. No demo data,
no placeholder products. The app is fully functional but intentionally
empty until real data is entered through the (upcoming) admin panel.

Full system design lives in [`ARCHITECTURE.md`](./ARCHITECTURE.md).

---

## Stack

- **Next.js 14** (App Router, Server Actions, Server Components)
- **Tailwind CSS** — Premium Red / White / Black theme
- **Supabase** — Postgres, Auth, Row Level Security
- **TypeScript**, **Zod** validation
- **Vercel** deployment target

---

## 1. Supabase project setup

1. Create a new project at [supabase.com](https://supabase.com).
2. In the SQL Editor, run the migrations **in order**:
   - `supabase/migrations/0001_init.sql` — full schema, enums, RLS policies (no seed data)
   - `supabase/migrations/0002_auth_trigger.sql` — auto-creates `profiles` rows on signup, adds retailer self-registration policy
   - `supabase/migrations/0003_storage_buckets.sql` — creates the `product-images`, `banners`, `avatars`, `brand-logos` storage buckets with RLS

   Or, if you use the Supabase CLI locally:
   ```bash
   supabase link --project-ref <your-project-ref>
   supabase db push
   ```

3. **Auth settings** (Authentication → Settings):
   - For Phase 1 to work end-to-end without an email step, turn **off** "Confirm email" during development. For production, keep it on and the register flow will show a "check your email" message — the retailer completes their shop profile after their first login (see `lib/auth/actions.ts` for the exact fallback behavior).
   - Set **Site URL** and **Redirect URLs** to your deployed URL (and `http://localhost:3000` for local dev), matching `NEXT_PUBLIC_SITE_URL`.

4. **Create the first Super Admin** (there is no public sign-up for staff roles by design — only retailers self-register):
   - Sign up any account manually via Supabase Auth (dashboard → Authentication → Users → Add user), or hit `/register-retailer` once and then promote it.
   - In the SQL Editor, run:
     ```sql
     update profiles set role = 'super_admin' where id = '<user-uuid>';
     ```
   - Log in at `/login` — you'll land on `/admin/dashboard`.
   - Staff/Salesman account creation via the Admin Panel UI is a Phase 2 deliverable (uses the service-role client already scaffolded in `lib/supabase/server.ts`).

---

## 2. Local development

```bash
npm install
cp .env.local.example .env.local   # fill in your Supabase project values
npm run dev
```

Visit `http://localhost:3000`. You'll be redirected to `/login`. Retailers can self-register at `/register-retailer` — note the Area dropdown will be empty until an admin adds Areas (Phase 2 admin panel; can also be inserted directly via SQL Editor for now: `insert into areas (name) values ('Khagaria Town');`).

---

## 3. Folder structure

```
app/
├── login/                    # Login page (all roles)
├── register-retailer/        # Public retailer self-registration
├── pending-approval/         # Shown to retailers awaiting admin approval
├── unauthorized/             # Shown when a role hits a route it can't access
├── auth/callback/            # Supabase email-confirmation redirect handler
├── admin/                    # Super Admin + Admin (route-guarded)
│   ├── layout.tsx
│   └── dashboard/
├── staff/                    # Staff (route-guarded)
├── salesman/                 # Salesman (route-guarded, mobile-first)
├── retailer/                 # Retailer (route-guarded, mobile-first)
└── page.tsx                  # Root — redirects based on session + role

components/
├── ui/                       # Button, Input, Select, Card, etc.
├── layout/                   # Sidebar, Topbar, MobileBottomNav, role Shells
└── auth/                     # LoginForm, RegisterRetailerForm

lib/
├── supabase/                 # Browser client, server client, middleware helper
├── auth/                     # Server actions (login/logout/register), roles map, session helper
└── utils/                    # cn() class-merge helper

types/
└── database.types.ts         # Hand-written Supabase types (Phase 1 tables)

supabase/
└── migrations/                # SQL migrations, no seed data

middleware.ts                  # Role-based route protection (runs on every request)
```

---

## 4. Role-based routing — how it works

- `middleware.ts` refreshes the Supabase session on every request, looks up the caller's `role` from `profiles`, and:
  - Blocks unauthenticated access to any `/admin`, `/staff`, `/salesman`, `/retailer` route → redirects to `/login`.
  - Blocks a role from entering another role's area (e.g. a retailer hitting `/admin/dashboard`) → redirects to `/unauthorized`.
  - Forces retailers with `status = 'pending_approval'` into `/pending-approval` until an admin approves them.
  - Signs out and blocks `is_active = false` or `status = 'suspended'` accounts.
- Each role folder also has a server `layout.tsx` that calls `requireUser()` as defense-in-depth, independent of middleware.
- `lib/auth/roles.ts` is the single source of truth mapping roles → home routes and allowed path prefixes — update this file, not scattered conditionals, when routing rules change.

---

## 5. Deployment (Vercel)

1. Push this repo to GitHub.
2. Import into Vercel, set the environment variables from `.env.local.example` in the Vercel project settings.
3. Set `NEXT_PUBLIC_SITE_URL` to your production URL, and add it to Supabase Auth's Redirect URLs.
4. Deploy. Vercel will run `next build` — TypeScript errors and ESLint errors will fail the build by design (keeps the codebase production-honest).

---

## 6. What's intentionally NOT in Phase 1

Per spec, this phase ships **zero business data**. The following are stubbed as empty states and are Phase 2+ work per `ARCHITECTURE.md`:

- Product/Category/Brand CRUD (Admin Panel)
- Pricing engine UI
- Inventory management UI
- Order placement/checkout flow
- Reports and the fully-wired AI Dashboard (the dashboard cards exist and query real tables now — they simply have nothing to show until Phase 2 data entry begins)
- Live WhatsApp/SMS delivery (the queueing architecture — `notifications` + `notification_logs` tables, `lib/notifications/notify.ts` — is real and wired; the actual provider call is a Phase 2 Edge Function)
- Staff/Salesman account creation UI (currently: SQL/dashboard-driven, as documented above)

Nothing in the codebase fabricates data to fill these gaps — every list and stat card queries a real (currently empty) table.

---

## 7. Architecture additions in this build

- **Error boundaries**: `app/error.tsx`, `app/global-error.tsx`, `app/not-found.tsx`, plus a scoped `error.tsx` in every role segment (`admin`/`staff`/`salesman`/`retailer`) so a failure in one area doesn't blank the whole app.
- **Loading states**: `app/loading.tsx` + per-role `loading.tsx` using a shared `<DashboardSkeleton />`.
- **File/image storage**: `supabase/migrations/0003_storage_buckets.sql` creates four public buckets (`product-images`, `banners`, `avatars`, `brand-logos`) with RLS — staff+ manage catalog imagery, anyone manages their own avatar. `lib/storage/upload.ts` is the client-side upload/remove helper Phase 2 screens will call.
- **Notification architecture**: `lib/notifications/notify.ts` writes real rows to `notifications` (in-app) and `notification_logs` (WhatsApp/SMS queue) — the pipeline is live, the outbound provider call is Phase 2.
- **Activity/audit tracking**: already covered by `audit_logs` + triggers on `products`, `price_lists`, `orders` in `0001_init.sql` — every change is attributed to `auth.uid()` automatically, no separate activity table needed.
- **Deployment config**: `vercel.json` (Mumbai region `bom1`, security headers).

