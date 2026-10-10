# Service area: Saran District, Bihar

## What changed

| Layer | Source of truth | Change |
|---|---|---|
| UI copy (login, sidebar, admin areas, home, register) | `lib/config/service-area.ts` (`SERVICE_AREA_LABEL`) | Shows **Saran District, Bihar** |
| Admin "Add area" default district | `components/admin/area-form.tsx` → `SERVICE_DISTRICT` | Default `Saran` (was `Khagaria`) |
| Database default for new areas | `supabase/migrations/0058_saran_default_district.sql` | `areas.district` default = `'Saran'` |
| Package / docs | `package.json`, `README.md`, `ARCHITECTURE.md` | Saran named as the active district |

## What did NOT change (deliberately)

- **Existing `areas` rows** keep their recorded `district`. Migration 0058 is `ALTER COLUMN … SET DEFAULT` only and contains no `UPDATE`.
- **Retailer area assignments** (`retailers.area_id`), addresses, orders, invoices and warehouses are untouched.
- **No Saran areas, pincodes, delivery coverage or coordinates were invented.** The repository contains no verified list of Saran delivery areas.
- Test fixtures and historical data that mention Khagaria are left as they are.
- The Android signing certificate DN (`docs/ANDROID_RELEASE_SIGNING.md`) and the Android app are out of scope of this PWA change. Changing a signing certificate's DN is not something to do casually.

## Owner steps (required before launch)

1. Apply migration `0058` through the normal Supabase migration path (after review).
2. Run this read-only query to see which areas still carry `Khagaria`:
   ```sql
   select id, name, district, is_active, created_at
   from public.areas
   order by name;
   ```
   Decide per area whether it is genuinely in Khagaria (keep) or should be moved to Saran. **Only an authorised admin should change these rows**, and that change should be recorded.
3. Add the verified Saran delivery areas in **Admin Panel → Areas**. Until at least one active area exists, the registration area dropdown is empty and retailers cannot choose an area.
4. Check the retailer areas for accounts that were approved against Khagaria areas.

## Rollback

`supabase/rollbacks/0058_saran_default_district.down.sql` restores the previous column default. It changes no rows and is not run by the migration runner.

## Verification

`tests/saran-district.test.ts` checks the constant, the migration (no data rewrite, default = Saran), the admin form default, the absence of Khagaria as an active default in app/components/lib source, and — on PGlite with every migration applied — that a new area defaults to Saran while the existing area rows are unchanged.
