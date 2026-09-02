-- ============================================================================
-- 0025: Column-level lockdown of purchase cost (`cost_price`)
--
-- SECURITY FINDING (retailer enterprise audit)
-- --------------------------------------------
-- Row Level Security restricts ROWS, not COLUMNS. `products_read` and
-- `product_packs_read` (0001 / 0004) correctly expose active catalog rows to a
-- retailer, but Supabase grants the `authenticated` role SELECT on every
-- column of every table in `public`. That means a signed-in retailer could
-- bypass the application entirely and ask PostgREST for purchase cost:
--
--     GET /rest/v1/products?select=id,name,cost_price&is_active=eq.true
--     GET /rest/v1/product_packs?select=id,pack_name,cost_price
--
-- The Next.js UI never selects `cost_price` on a retailer surface, so this was
-- invisible in the app — but the database allowed it. `ARCHITECTURE.md` §4.6
-- and the admin product form both state cost is "admin-only visibility", and
-- the business rules require that purchase cost is never exposed to a
-- retailer. This migration makes the database enforce that statement.
--
-- FIX
-- ---
-- 1. Three `SECURITY DEFINER` accessors, gated on `is_admin_or_above()`, so the
--    admin product screens keep reading cost through an authorized path.
-- 2. `REVOKE SELECT (cost_price)` from `anon` and `authenticated` on both
--    tables. A retailer (or salesman, or staff) PostgREST call that names the
--    column now fails with 42501 instead of returning a margin.
--
-- SAFETY / BACKWARD COMPATIBILITY
-- -------------------------------
-- - NO column is dropped, NO row is rewritten, NO table is created.
-- - Only the SELECT privilege on ONE column of TWO tables changes. INSERT and
--   UPDATE privileges are untouched, so every admin write path that sets
--   `cost_price` (product create/update, pack create/update/duplicate) keeps
--   working exactly as before.
-- - `is_admin_or_above()` is the correct gate: `/admin/**` is restricted to
--   super_admin + admin by `lib/auth/roles.ts`, and the only three call sites
--   that read cost live under `/admin/products/[id]` and in
--   `duplicatePackAction` (invoked from that same admin screen). Staff never
--   had a route to them, so no role loses an existing capability.
-- - Views and functions are NOT affected: `inventory_product_totals` (0017)
--   reads `p.cost_price`, but a non-`security_invoker` view runs with its
--   OWNER's privileges (postgres, the table owner), so column grants on
--   `anon`/`authenticated` cannot break it. The `log_audit()` trigger is
--   likewise `SECURITY DEFINER` and reads NEW/OLD directly.
-- - `service_role` bypasses both RLS and these grants, so Supabase Studio,
--   migrations and any service-role job are unaffected.
-- - Re-runnable: the functions use `CREATE OR REPLACE`, and REVOKE/GRANT of a
--   column privilege is idempotent in Postgres, so applying this twice is safe.
--   No existing policy, table, column or row is altered in any way.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Admin-only cost accessors
-- ----------------------------------------------------------------------------

/** Purchase cost of one product. NULL for anyone below admin. */
create or replace function admin_product_cost(p_product_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when is_admin_or_above()
      then (select p.cost_price from products p where p.id = p_product_id)
    else null
  end;
$$;

/** Purchase cost of one pack. NULL for anyone below admin. */
create or replace function admin_pack_cost(p_pack_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when is_admin_or_above()
      then (select pp.cost_price from product_packs pp where pp.id = p_pack_id)
    else null
  end;
$$;

/** Purchase cost of every pack of one product, keyed by pack id. */
create or replace function admin_pack_costs(p_product_id uuid)
returns table (pack_id uuid, cost_price numeric)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select pp.id, pp.cost_price
  from product_packs pp
  where pp.product_id = p_product_id
    and is_admin_or_above();
$$;

comment on function admin_product_cost(uuid) is
  'Admin/super_admin-only read of products.cost_price. Exists because 0025 revokes direct column SELECT from anon/authenticated so a retailer session can never read purchase cost via PostgREST.';
comment on function admin_pack_cost(uuid) is
  'Admin/super_admin-only read of product_packs.cost_price for one pack.';
comment on function admin_pack_costs(uuid) is
  'Admin/super_admin-only read of product_packs.cost_price for every pack of a product.';

revoke all on function admin_product_cost(uuid) from public;
revoke all on function admin_pack_cost(uuid) from public;
revoke all on function admin_pack_costs(uuid) from public;
grant execute on function admin_product_cost(uuid) to authenticated;
grant execute on function admin_pack_cost(uuid) to authenticated;
grant execute on function admin_pack_costs(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. Revoke direct column reads
--
--    After this, `select=...,cost_price,...` from a retailer/salesman/staff
--    session is rejected by Postgres. Reads must go through the accessors
--    above, which re-check the caller's role.
-- ----------------------------------------------------------------------------
revoke select (cost_price) on public.products from anon, authenticated;
revoke select (cost_price) on public.product_packs from anon, authenticated;

comment on column products.cost_price is
  'Purchase cost. ADMIN-ONLY: direct SELECT is revoked from anon/authenticated (0025) — read it via admin_product_cost(). Never exposed to retailers, salesmen or staff.';
comment on column product_packs.cost_price is
  'Purchase cost. ADMIN-ONLY: direct SELECT is revoked from anon/authenticated (0025) — read it via admin_pack_cost()/admin_pack_costs(). Never exposed to retailers, salesmen or staff.';

-- ============================================================================
-- END OF MIGRATION — no business data inserted, modified or deleted.
-- ============================================================================
