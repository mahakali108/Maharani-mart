# Maharani Traders — B2B wholesale PWA

A Next.js 14 + TypeScript + Supabase + Vercel wholesale web app for retailers,
marketplace sellers and admins. Gaya, Bihar is the **initial district default**,
not district-wide delivery coverage. New orders are allowed only to individually
configured, active district/state/PIN combinations; no real PINs are seeded.
Seller accounts are created by **Super Admin invitation only** and remain
pending until separately verified and approved. The existing native files, if
present in the repository, are not changed or built for this PWA upgrade.

**This branch is review-only until the owner approves a target project, a
restorable backup/recovery plan, and the exact production SQL/app deployment.**
Forward migrations 0070 and 0071 have not been applied remotely. Public legal
pages are visibly labelled drafts pending verified business details and Indian
legal/tax review. See [upgrade/release gate](docs/UPGRADE_REVIEW.md),
[delivery configuration](docs/SERVICE_AREA_GAYA.md),
[seller marketplace](docs/SELLER_MARKETPLACE.md) and
[legal review](docs/LEGAL_REVIEW.md).

## Stack

- **Next.js 14** App Router (browser-installable PWA), Tailwind CSS, TypeScript and Zod
- **Supabase** Auth, PostgreSQL/RLS and Storage; trusted server-only Auth Admin for seller invitations
- **Vercel** deployment target; no APK, native app or separate mobile app is built in this upgrade

## 1. Setup and migration safety

1. In a local or disposable/staging Supabase project, configure environment
   variables from `.env.local.example`: public Supabase URL/anon key, **server-only**
   service-role key and `NEXT_PUBLIC_SITE_URL` (canonical HTTPS origin in
   staging/production). Configure matching Auth Site URL, callback redirect
   allow-list and invitation email delivery. Never expose a service-role key
   in a client bundle or a support message.
2. Establish the actual migration history **for the identified project** before
   applying anything. Apply missing reviewed migrations in order with the normal
   migration runner, then 0070 (seller invitations) and 0071 (delivery PINs)
   **on a staging clone first**. Confirm backward compatibility and a tested
   backup/restore plan; do not run rollback scripts, destructive SQL, the legacy
   `scripts/production-validate.sh` (it writes fixtures), `supabase db push`,
   or SQL Editor steps against production without explicit owner approval.
   Historic guidance for migrations 0032–0036 in
   [`docs/PRODUCTION_DEPLOYMENT.md`](docs/PRODUCTION_DEPLOYMENT.md) does not
   cover this security/checkout rollout.
3. Use an existing authorised Super Admin to create/review sellers at
   `/admin/sellers`. There is **no public seller registration**. Any initial
   Super Admin bootstrap needs a separately reviewed and audited operator
   process; do not self-promote a public account on a live project.
4. In `/admin/areas`, add verified PIN rows **inactive** first; activate only
   operator-confirmed district/state/PIN combinations with terms that support
   online ordering. A nonzero configured delivery fee blocks new online
   self-checkout until fee accounting is implemented. Existing inventory areas
   and retailer addresses are not relabelled automatically.

---

## 2. Local development

```bash
npm install
cp .env.local.example .env.local   # fill in your Supabase project values
npm run dev
```

Visit `http://localhost:3000` for the sign-in page. Retailers can self-register at `/register-retailer`, then await admin approval before ordering. The inventory-area dropdown requires an active area; registration never proves delivery coverage. Seller accounts are Super-Admin-invited; checkout needs an owned saved address and an active configured PIN (see `docs/SERVICE_AREA_GAYA.md`).

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

## 5b. Android app (`Maharani Traders`) — native Kotlin/Compose

The Android deliverable is a **fully native Kotlin/Jetpack Compose application**
(package `com.maharanitraders.app`) that talks to this Next.js backend over
`/api/mobile/v1` and reuses the existing Supabase Auth/Postgres/RLS/Storage. No
business logic is duplicated in the app — the server stays authoritative for
pricing, GST, stock, orders, coins, roles and RLS, and the app never receives a
database key.

The previous **Capacitor remote-URL WebView wrapper is retired**:
`capacitor.config.ts`, `www/`, `scripts/android-postsync.mjs`,
`scripts/android-resource-validation.mjs`, the `cap:*` scripts and the four
`@capacitor/*` dependencies were removed, and the active Android CI workflow
now builds the native project instead of running `npx cap add android`.

The native project is **`android/`** (committed; Gradle wrapper + version
catalog + `app`/`core:*` modules). See:

- [`docs/ANDROID_IMPLEMENTATION_PLAN.md`](docs/ANDROID_IMPLEMENTATION_PLAN.md) —
  **start here.** Audit, verified state, security risks, file-by-file plan.
- [`docs/NATIVE_ANDROID_MIGRATION_AUDIT.md`](docs/NATIVE_ANDROID_MIGRATION_AUDIT.md) —
  feature-by-feature page classification.
- [`docs/NATIVE_ANDROID_API_CONTRACT.md`](docs/NATIVE_ANDROID_API_CONTRACT.md) —
  the `/api/mobile/v1` contract (implemented and planned endpoints).
- [`docs/NATIVE_ANDROID_MIGRATION_PLAN.md`](docs/NATIVE_ANDROID_MIGRATION_PLAN.md) —
  phases A–H, toolchain evidence, CI, acceptance commands, honest limitations.

Current state: the native foundation (`Phase B`) exists as source, and the mobile
API exposes `/api/mobile/v1/health` and `/api/mobile/v1/session`. **Sign-in and
the feature screens are Phase C onward** — the app renders explicit
"planned phase" states instead of fake data, and the web application remains the
source of truth meanwhile. See the plan's §9 for the honest
verified / not-verified status of every acceptance criterion.

```bash
# Web (unchanged)
pnpm install && pnpm typecheck && pnpm test

# Native Android (requires JDK 17 + Android SDK 36)
cd android && ./gradlew testDebugUnitTest lintDebug assembleDebug
```

- Build: `.github/workflows/android-apk.yml` is the **active native pipeline** —
  Gradle wrapper validation, JDK 17, Android SDK 36, unit tests, lint and
  `assembleDebug`, then a package-id check and the debug APK uploaded as a
  GitHub Actions artifact. No signing secret is needed for a debug APK.

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
- **File/image storage**: Supabase Storage only. Buckets are created in `supabase/migrations/0003_storage_buckets.sql` (public: `product-images`, `banners`, `avatars`, `brand-logos`), `0006_retailer_documents.sql` (private `retailer-documents`), and `0016_storage_paths_category_bucket.sql` (public `category-images`). All uploads/deletes go through the server-side `lib/media` facade (`lib/media/supabase.ts`) with RLS + app-level permission checks; see `docs/storage-buckets.md`.
- **Notification architecture**: `lib/notifications/notify.ts` writes real rows to `notifications` (in-app) and `notification_logs` (WhatsApp/SMS queue) — the pipeline is live, the outbound provider call is Phase 2.
- **Activity/audit tracking**: already covered by `audit_logs` + triggers on `products`, `price_lists`, `orders` in `0001_init.sql` — every change is attributed to `auth.uid()` automatically, no separate activity table needed.
- **Deployment config**: `vercel.json` (Mumbai region `bom1`, security headers).

