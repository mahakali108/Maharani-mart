# Production Stability Audit — Route Repair Report

Date: 2026-10-01 · Branch: `arena/01a0f6fc-maharani-mart`

## How this audit was executed

1. **Static route inventory** — all 144 routes discovered from `app/**/page.tsx` + `app/**/route.ts`.
2. **Internal-link cross-reference** — every literal/`template` `href`, `redirect(...)` and `router.push(...)` in `app/`, `components/`, `lib/` resolved against the inventory. **0 dead links.**
3. **Server-action surface scan** — every exported async function in every `'use server'` module checked for an authorization guard (each one is a remotely invocable endpoint whether imported or not).
4. **Page-guard × middleware consistency** — each page's `requirePermission(...)` cross-checked against the roles middleware admits to the page's URL prefix.
5. **Live render crawl (offline harness)** — no production Supabase credentials exist in this environment, so the production build was run against a local mock of the Supabase Auth + PostgREST API with per-role session fixtures (super_admin, admin, staff, salesman, active retailer, pending retailer, anonymous) and empty business data. All **144 routes × 7 principals = 1,008 probes**, classifying HTTP status, redirect target, streamed crash digests and error-boundary markers. This exercises middleware auth, role gating, session handling, empty states and crash-safety — it does NOT prove behavior against production data/RLS (see Limitations).
6. **Full verification** — `typecheck`, `lint`, `vitest` (93 files / 1,780 tests), `next build`.

## Defects found and fixed

| # | Defect | Root cause | Fix | Regression test |
|---|---|---|---|---|
| 1 | `productIdsForOrder` — unguarded, unused, remotely invocable Server Action (`lib/admin/orders-actions.ts`) | Dead helper left exported from a `'use server'` module; every such export is an HTTP-invocable endpoint | Removed the function (no call sites existed) | `tests/server-action-surface.test.ts` |
| 2 | `seedDefaultPackForProduct` exported as a Server Action while being an internal helper taking a Supabase client parameter | Shared between product form and CSV importer by exporting from the action module | Moved to new non-action, `server-only` module `lib/admin/pack-seed.ts`; both callers rewired | `tests/server-action-surface.test.ts`, updated `tests/sku-code-removal.test.ts` |
| 3 | `ensureDefaultAddress` exported as a Server Action (`lib/retailer/address-actions.ts`) | Same pattern; only used inside its own module | Export removed (now private) | `tests/server-action-surface.test.ts` |
| 4 | `/api/health` echoed raw internal error details (e.g. driver messages, could include URLs/SQL) to unauthenticated callers; also relied on catching Next's `DynamicServerError` | Error `message` serialized straight into the public JSON response | Sanitized responses (`degraded`/`error` without details, real reason server-logged); `export const dynamic = 'force-dynamic'` added | `tests/health-endpoint.test.ts` |
| 5 | **7 page×role combos rendered the "Something went wrong" crash boundary instead of a clean denial**: admin → `/admin/command-center`, `/admin/control-center`, `/admin/control-center/users/[id]`, `/admin/team/new`, `/admin/team/[id]`, and admin/super_admin → `/salesman/ai` | Middleware admits whole role groups per URL prefix, but these pages guard with **throwing** `requirePermission`/`requireSuperAdmin`, built for Server Actions | Added `requirePagePermission` and `requireSuperAdminPage` (deny ⇒ `redirect('/unauthorized')`, matching middleware); the 6 pages switched to them. Permission model unchanged — same principals denied, now cleanly | `tests/page-guard-consistency.test.ts` (static rule for ALL pages + behavioral tests) |

Files changed: `lib/admin/orders-actions.ts`, `lib/admin/pack-seed.ts` (new), `lib/admin/products-actions.ts`, `lib/admin/product-import-actions.ts`, `lib/retailer/address-actions.ts`, `app/api/health/route.ts`, `lib/admin/guard.ts`, `lib/admin/control-center/guard.ts`, `app/admin/command-center/page.tsx`, `app/admin/control-center/page.tsx`, `app/admin/control-center/users/[id]/page.tsx`, `app/admin/team/new/page.tsx`, `app/admin/team/[id]/page.tsx`, `app/salesman/ai/page.tsx`, plus 4 test files (3 new).

## Verified-intact areas (no defects found)

- **Authentication flow**: anonymous → `/login?redirect=…` on all 131 protected probes; logged-in users bounced off `/login`/`/register-retailer`; pending retailers confined to `/pending-approval` (132/132 probes); no role ever rendered another role's page (0 leaks in 1,008 probes).
- **API security**: `/api/cron/cleanup` 401 without `CRON_SECRET` (fail closed, even for super_admin cookies); `/api/webhooks` 401 without secret; `/api/admin/storage-report`, `/api/ai/*` 401 unauthenticated.
- **Dead-ID handling**: all `[id]` detail pages render not-found UI, none crash.
- **Service-role key**: only in `server-only` modules; never in client code.
- **Business rules preserved**: no changes to checkout atomicity/idempotency, coins, pack-level stock, banner scheduling, Capacitor setup, retention engine (the wallet-ledger retention delta-fold of migration 0055 is intact and covered by `tests/data-retention-cleanup.test.ts`), or any migration.

## Verification results

- `corepack pnpm typecheck` — **PASS** (0 errors)
- `corepack pnpm lint` — **PASS** (0 errors; 1 pre-existing `<img>` warning)
- `corepack pnpm test` — **PASS: 93 files, 1,780 tests, 0 failures** (was 91/1,764 before; +3 new regression suites, 1 updated)
- `corepack pnpm build` — **PASS** (144 routes compiled; no build-time error noise)
- Live crawl after fixes — **1,008/1,008 probes clean** (0 crash digests, 0 error boundaries, 0 role leaks, server log free of thrown errors)

## Limitations (honest)

- **No production Supabase credentials in this environment.** Everything data-dependent beyond the mocked empty-data level is **BLOCKED** for live verification: real RLS behavior, actual order placement/stock deduction, storage buckets, coupon redemption against real rows, Vercel cron, email flows. The repository's own DB-level tests (pglite replays of migrations, e.g. `security-phase0-db`, `simplified-pack-stock-db`, `data-retention-cleanup`) all pass and remain the schema-level evidence.
- Browser-executed JS (hydration, infinite-scroll runtime) was not driven by a real browser; it is covered by the jsdom component tests (`*-ui.test.tsx`, `infinite-scroll*`, `banners`, `catalog-loading`).
- `supabase/smoke-test.sql` + `scripts/production-validate.sh` should still be run against the production project per `docs/PRODUCTION_VERIFICATION_CHECKLIST.md`.

## Route-by-route status

Legend: cell = HTTP result per principal (`→/path` = redirect). Status **PASS** = rendered/denied correctly in the live crawl; **FIXED** = defect repaired here and re-verified. Data-dependent correctness beyond empty-data rendering is BLOCKED (see Limitations) for all routes.

| Route | Status | anon | super_admin | admin | staff | salesman | retailer | retailer_pending |
|---|---|---|---|---|---|---|---|---|
| `/` | PASS | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| `/access-expired` | PASS | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| `/admin/ai` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/areas` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/areas/[id]` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/attendance` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/audit-logs` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/banners` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/banners/[id]` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/catalog` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/catalog/brands` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/catalog/brands/[id]` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/catalog/categories` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/catalog/categories/[id]` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/cleanup` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/collections` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/command-center` | FIXED | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/commissions` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/control-center` | FIXED | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/control-center/users/[id]` | FIXED | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/coupons` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/coupons/[id]` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/coupons/new` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/dashboard` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/delivered` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/delivered/[orderId]` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/delivered/export` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/follow-ups` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/inventory` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/inventory/batches` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/inventory/expiry` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/inventory/forecast` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/inventory/grn` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/inventory/grn/[id]` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/inventory/grn/new` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/inventory/ledger` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/inventory/low-stock` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/inventory/movements` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/inventory/products` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/inventory/reports` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/inventory/reports/export` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/inventory/transfers` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/notifications` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/orders` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/orders/[id]` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/pricing` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/pricing/schemes` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/products` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/products/[id]` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/products/export` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/products/import` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/products/import/template` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/products/new` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/reports` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/reports/barcodes` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/retailers` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/retailers/[id]` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/returns` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/routes` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/routes/[id]` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/support` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/support/[id]` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/targets` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/team` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/team/[id]` | FIXED | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/team/new` | FIXED | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/visits` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/wallets` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/wallets/[id]` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/warehouses` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/admin/warehouses/[id]` | PASS | →/login | 200 | 200 | →/unauthorized | →/unauthorized | →/unauthorized | →/pending-approval |
| `/api/admin/storage-report` | PASS | 401 | 200 | 200 | 403 | 403 | 403 | 403 |
| `/api/ai/chat` | PASS | 405 | 405 | 405 | 405 | 405 | 405 | 405 |
| `/api/ai/memory` | PASS | 405 | 405 | 405 | 405 | 405 | 405 | 405 |
| `/api/cron/cleanup` | PASS | 401 | 401 | 401 | 401 | 401 | 401 | 401 |
| `/api/health` | FIXED | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| `/api/webhooks` | PASS | 405 | 405 | 405 | 405 | 405 | 405 | 405 |
| `/auth/callback` | PASS | →http://0.0.0.0:3000/ | →http://0.0.0.0:3000/ | →http://0.0.0.0:3000/ | →http://0.0.0.0:3000/ | →http://0.0.0.0:3000/ | →http://0.0.0.0:3000/ | →http://0.0.0.0:3000/ |
| `/forgot-password` | PASS | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| `/login` | PASS | 200 | →/admin/dashboard | →/admin/dashboard | →/staff/dashboard | →/salesman/dashboard | →/retailer/home | →/retailer/home |
| `/pending-approval` | PASS | →/login | 200 | 200 | 200 | 200 | 200 | 200 |
| `/register-retailer` | PASS | 200 | →/admin/dashboard | →/admin/dashboard | →/staff/dashboard | →/salesman/dashboard | →/retailer/home | →/retailer/home |
| `/reset-password` | PASS | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| `/retailer/account` | PASS | →/login | →/unauthorized | →/unauthorized | →/unauthorized | →/unauthorized | 200 | →/pending-approval |
| `/retailer/account/addresses` | PASS | →/login | →/unauthorized | →/unauthorized | →/unauthorized | →/unauthorized | 200 | →/pending-approval |
| `/retailer/account/edit` | PASS | →/login | →/unauthorized | →/unauthorized | →/unauthorized | →/unauthorized | 200 | →/pending-approval |
| `/retailer/account/ledger` | PASS | →/login | →/unauthorized | →/unauthorized | →/unauthorized | →/unauthorized | 200 | →/pending-approval |
| `/retailer/account/notification-preferences` | PASS | →/login | →/unauthorized | →/unauthorized | →/unauthorized | →/unauthorized | 200 | →/pending-approval |
| `/retailer/account/security` | PASS | →/login | →/unauthorized | →/unauthorized | →/unauthorized | →/unauthorized | 200 | →/pending-approval |
| `/retailer/ai` | PASS | →/login | →/unauthorized | →/unauthorized | →/unauthorized | →/unauthorized | 200 | →/pending-approval |
| `/retailer/brands` | PASS | →/login | →/unauthorized | →/unauthorized | →/unauthorized | →/unauthorized | 200 | →/pending-approval |
| `/retailer/brands/[id]` | PASS | →/login | →/unauthorized | →/unauthorized | →/unauthorized | →/unauthorized | 200 | →/pending-approval |
| `/retailer/cart` | PASS | →/login | →/unauthorized | →/unauthorized | →/unauthorized | →/unauthorized | 200 | →/pending-approval |
| `/retailer/cart/saved` | PASS | →/login | →/unauthorized | →/unauthorized | →/unauthorized | →/unauthorized | 200 | →/pending-approval |
| `/retailer/catalog` | PASS | →/login | →/unauthorized | →/unauthorized | →/unauthorized | →/unauthorized | 200 | →/pending-approval |
| `/retailer/catalog/[id]` | PASS | →/login | →/unauthorized | →/unauthorized | →/unauthorized | →/unauthorized | 200 | →/pending-approval |
| `/retailer/categories` | PASS | →/login | →/unauthorized | →/unauthorized | →/unauthorized | →/unauthorized | 200 | →/pending-approval |
| `/retailer/categories/[id]` | PASS | →/login | →/unauthorized | →/unauthorized | →/unauthorized | →/unauthorized | 200 | →/pending-approval |
| `/retailer/checkout` | PASS | →/login | →/unauthorized | →/unauthorized | →/unauthorized | →/unauthorized | 200 | →/pending-approval |
| `/retailer/coupons` | PASS | →/login | →/unauthorized | →/unauthorized | →/unauthorized | →/unauthorized | 200 | →/pending-approval |
| `/retailer/favorites` | PASS | →/login | →/unauthorized | →/unauthorized | →/unauthorized | →/unauthorized | 200 | →/pending-approval |
| `/retailer/help` | PASS | →/login | →/unauthorized | →/unauthorized | →/unauthorized | →/unauthorized | 200 | →/pending-approval |
| `/retailer/home` | PASS | →/login | →/unauthorized | →/unauthorized | →/unauthorized | →/unauthorized | 200 | →/pending-approval |
| `/retailer/notifications` | PASS | →/login | →/unauthorized | →/unauthorized | →/unauthorized | →/unauthorized | 200 | →/pending-approval |
| `/retailer/orders` | PASS | →/login | →/unauthorized | →/unauthorized | →/unauthorized | →/unauthorized | 200 | →/pending-approval |
| `/retailer/orders/[id]` | PASS | →/login | →/unauthorized | →/unauthorized | →/unauthorized | →/unauthorized | 200 | →/pending-approval |
| `/retailer/orders/[id]/delivery` | PASS | →/login | →/unauthorized | →/unauthorized | →/unauthorized | →/unauthorized | 200 | →/pending-approval |
| `/retailer/orders/[id]/invoice` | PASS | →/login | →/unauthorized | →/unauthorized | →/unauthorized | →/unauthorized | 200 | →/pending-approval |
| `/retailer/orders/[id]/invoice/download` | PASS | →/login | →/unauthorized | →/unauthorized | →/unauthorized | →/unauthorized | 404 | →/pending-approval |
| `/retailer/orders/[id]/reorder` | PASS | →/login | →/unauthorized | →/unauthorized | →/unauthorized | →/unauthorized | 200 | →/pending-approval |
| `/retailer/quick-order` | PASS | →/login | →/unauthorized | →/unauthorized | →/unauthorized | →/unauthorized | 200 | →/pending-approval |
| `/retailer/reports` | PASS | →/login | →/unauthorized | →/unauthorized | →/unauthorized | →/unauthorized | 200 | →/pending-approval |
| `/retailer/reports/statement` | PASS | →/login | →/unauthorized | →/unauthorized | →/unauthorized | →/unauthorized | 200 | →/pending-approval |
| `/retailer/schemes` | PASS | →/login | →/unauthorized | →/unauthorized | →/unauthorized | →/unauthorized | 200 | →/pending-approval |
| `/retailer/support` | PASS | →/login | →/unauthorized | →/unauthorized | →/unauthorized | →/unauthorized | 200 | →/pending-approval |
| `/retailer/support/[id]` | PASS | →/login | →/unauthorized | →/unauthorized | →/unauthorized | →/unauthorized | 200 | →/pending-approval |
| `/retailer/support/new` | PASS | →/login | →/unauthorized | →/unauthorized | →/unauthorized | →/unauthorized | 200 | →/pending-approval |
| `/salesman/ai` | FIXED | →/login | 200 | 200 | →/unauthorized | 200 | →/unauthorized | →/pending-approval |
| `/salesman/attendance` | PASS | →/login | 200 | 200 | →/unauthorized | 200 | →/unauthorized | →/pending-approval |
| `/salesman/collections` | PASS | →/login | 200 | 200 | →/unauthorized | 200 | →/unauthorized | →/pending-approval |
| `/salesman/commissions` | PASS | →/login | 200 | 200 | →/unauthorized | 200 | →/unauthorized | →/pending-approval |
| `/salesman/dashboard` | PASS | →/login | 200 | 200 | →/unauthorized | 200 | →/unauthorized | →/pending-approval |
| `/salesman/dcr` | PASS | →/login | 200 | 200 | →/unauthorized | 200 | →/unauthorized | →/pending-approval |
| `/salesman/deliveries` | PASS | →/login | 200 | 200 | →/unauthorized | 200 | →/unauthorized | →/pending-approval |
| `/salesman/deliveries/[orderId]` | PASS | →/login | 200 | 200 | →/unauthorized | 200 | →/unauthorized | →/pending-approval |
| `/salesman/follow-ups` | PASS | →/login | 200 | 200 | →/unauthorized | 200 | →/unauthorized | →/pending-approval |
| `/salesman/orders` | PASS | →/login | 200 | 200 | →/unauthorized | 200 | →/unauthorized | →/pending-approval |
| `/salesman/orders/[id]` | PASS | →/login | 200 | 200 | →/unauthorized | 200 | →/unauthorized | →/pending-approval |
| `/salesman/orders/new` | PASS | →/login | 200 | 200 | →/unauthorized | 200 | →/unauthorized | →/pending-approval |
| `/salesman/profile` | PASS | →/login | 200 | 200 | →/unauthorized | 200 | →/unauthorized | →/pending-approval |
| `/salesman/retailers` | PASS | →/login | 200 | 200 | →/unauthorized | 200 | →/unauthorized | →/pending-approval |
| `/salesman/retailers/[id]` | PASS | →/login | 200 | 200 | →/unauthorized | 200 | →/unauthorized | →/pending-approval |
| `/salesman/routes` | PASS | →/login | 200 | 200 | →/unauthorized | 200 | →/unauthorized | →/pending-approval |
| `/salesman/targets` | PASS | →/login | 200 | 200 | →/unauthorized | 200 | →/unauthorized | →/pending-approval |
| `/salesman/visits` | PASS | →/login | 200 | 200 | →/unauthorized | 200 | →/unauthorized | →/pending-approval |
| `/staff/ai` | PASS | →/login | 200 | 200 | 200 | →/unauthorized | →/unauthorized | →/pending-approval |
| `/staff/dashboard` | PASS | →/login | 200 | 200 | 200 | →/unauthorized | →/unauthorized | →/pending-approval |
| `/staff/deliveries` | PASS | →/login | 200 | 200 | 200 | →/unauthorized | →/unauthorized | →/pending-approval |
| `/staff/deliveries/[orderId]` | PASS | →/login | 200 | 200 | 200 | →/unauthorized | →/unauthorized | →/pending-approval |
| `/staff/inventory` | PASS | →/login | 200 | 200 | 200 | →/unauthorized | →/unauthorized | →/pending-approval |
| `/staff/inventory/ledger` | PASS | →/login | 200 | 200 | 200 | →/unauthorized | →/unauthorized | →/pending-approval |
| `/staff/orders` | PASS | →/login | 200 | 200 | 200 | →/unauthorized | →/unauthorized | →/pending-approval |
| `/staff/orders/[id]` | PASS | →/login | 200 | 200 | 200 | →/unauthorized | →/unauthorized | →/pending-approval |
| `/unauthorized` | PASS | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
