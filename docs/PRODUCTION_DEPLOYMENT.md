# Production Deployment Runbook — Migrations 0032–0036

Verified against the merge checklist. Apply **in order** — the chain is
additive and re-runnable, but order still matters because 0035's RPC is
referenced by the app after deploy and 0036 alters `orders` before the new
order-creation code writes the snapshot.

## 1. Apply the migrations (exact steps)

**Option A — Supabase Dashboard (SQL Editor), one file at a time, in order:**

```
supabase/migrations/0032_retailer_address_book.sql
supabase/migrations/0033_retailer_saved_carts.sql
supabase/migrations/0034_retailer_product_feedback.sql
supabase/migrations/0035_retailer_profile_rpc_prefs_requests.sql
supabase/migrations/0036_order_shipping_address.sql
```

Paste each file's full contents into **Dashboard → SQL Editor → New query →
Run**, then verify the "Success" line before running the next. Safe to re-run
any file (idempotent).

**Option B — Supabase CLI:**

```bash
supabase link --project-ref <your-project-ref>
supabase db push            # applies all unapplied files in filename order
```

## 2. Verify after applying (run in SQL Editor as a sanity check)

```sql
-- All seven new tables exist and have RLS enabled:
select tablename, rowsecurity from pg_tables
 where schemaname = 'public'
   and tablename in ('retailer_addresses','retailer_saved_carts',
      'retailer_saved_cart_items','retailer_product_issues',
      'retailer_stock_alerts','retailer_notification_prefs',
      'retailer_account_requests');
-- Expect rowsecurity = true on every row.

-- The orders snapshot column exists:
select column_name, data_type from information_schema.columns
 where table_schema='public' and table_name='orders'
   and column_name='shipping_address';          -- jsonb, nullable

-- The RPC exists with the right privileges:
select has_function_privilege('authenticated',
  'update_my_shop_profile(text,text)', 'execute');   -- t
select has_function_privilege('anon',
  'update_my_shop_profile(text,text)', 'execute');   -- f
```

## 3. Deploy the app

```bash
pnpm install && pnpm build      # already verified green
# then your normal Vercel/host deploy (main branch)
```

Deploy **after** the migrations so the new actions never reference missing
tables. Nothing else changes for existing users: old order screens ignore
`shipping_address`, checkout falls back to `retailers.address` when the
address book is empty.

## 4. Android APK — must be built on a machine with the Android toolchain

This sandbox has **no JDK, no Android SDK, no Gradle, and no outbound access
to dl.google.com / services.gradle.org** (verified), so no APK was produced
here. On a machine with Android Studio (or SDK + JDK 17):

```bash
# one-time: add the Android native project (not committed yet)
npx cap add android

pnpm build                      # next build → static export is NOT used;
                                # capacitor.config.ts points webDir at the
                                # existing build output via the repo's scripts
pnpm cap:sync                   # copies web assets + plugins, runs postsync script

# debug APK (no signing needed) — the file the checklist asks for:
pnpm android:build:debug
# → android/app/build/outputs/apk/debug/app-debug.apk

# release AAB/APK (needs your upload keystore — see docs/android.md):
pnpm android:build:release
# → android/app/build/outputs/bundle/release/app-release.aab
```

Do not claim APK success until `app-debug.apk` exists on disk from your run.

## 5. Rollback

Migrations are additive; rolling back the app deploy alone is safe (the new
tables/column simply go unused — nothing else references them). Dropping the
new objects is possible but unnecessary and intentionally not scripted here.
