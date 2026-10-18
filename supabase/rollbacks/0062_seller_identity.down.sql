-- Rollback for 0062_seller_identity.sql — FAIL-SAFE, GUARDED.
--
-- ABORTS while any seller records or memberships exist: dropping these tables
-- would destroy merchant onboarding and tenant-membership history that admin
-- entered through the app. Before a data-bearing rollback an operator must:
--   1. export `sellers` + `seller_members` under a reviewed retention
--      procedure, then
--   2. delete those rows deliberately (each removal is audit-logged), then
--   3. re-run this script.
-- Later marketplace migrations (0063+) reference these tables — run their
-- rollbacks FIRST (reverse order).
--
-- DO NOT run this against a configured or remote project as part of any
-- automated flow. Like the migration it reverses, this file has NOT been
-- executed against any database.

do $$
begin
  if (select count(*) from sellers) > 0 then
    raise exception
      'ROLLBACK ABORTED: seller rows exist. Export them under a reviewed retention procedure, delete them deliberately, then re-run.';
  end if;
  if (select count(*) from seller_members) > 0 then
    raise exception
      'ROLLBACK ABORTED: seller membership rows exist. Delete them deliberately, then re-run.';
  end if;
end $$;

drop policy if exists "seller_members_admin_delete" on seller_members;
drop policy if exists "seller_members_admin_insert" on seller_members;
drop policy if exists "seller_members_select" on seller_members;
drop policy if exists "sellers_admin_delete" on sellers;
drop policy if exists "sellers_admin_update" on sellers;
drop policy if exists "sellers_admin_insert" on sellers;
drop policy if exists "sellers_select" on sellers;

drop trigger if exists trg_audit_seller_members on seller_members;
drop trigger if exists trg_audit_sellers on sellers;
drop trigger if exists trg_enforce_seller_status_transitions on sellers;

drop function if exists public.enforce_seller_status_transitions();
drop function if exists public.is_member_of_seller(uuid);

drop table if exists seller_members;
drop table if exists sellers;

-- The `seller` role value is intentionally LEFT in the user_role enum: enum
-- values cannot be removed without rebuilding the type, and a dormant value is
-- inert. Note this in any environment teardown plan.
