-- ============================================================================
-- 0078 — forward-only privilege hardening found by the repository SQL audit.
--
-- REVIEW ONLY. This file is NOT applied to any Supabase project. Applying it
-- to project `fhrmsrumsraprvutrpeo` is an owner decision and needs the
-- read-only evidence in docs/SQL_AND_PAGE_AUDIT_2026-10-24.md §7 first.
--
-- Nothing here rewrites history, renumbers a migration, deletes a row, drops a
-- table/column or changes any business rule. Every statement is additive,
-- idempotent and safe to re-run, and each one is guarded so it is a no-op on a
-- database that has not reached the migration it depends on.
--
-- ---------------------------------------------------------------------------
-- What this fixes (each verified by executing the migration set on PostgreSQL
-- 16 and querying the catalog — see the audit document, §3)
-- ---------------------------------------------------------------------------
-- H1  public.fefo_plan_for_product(uuid, uuid, integer) is SECURITY DEFINER,
--     has NO caller check, and was EXECUTE-able by `anon` because Supabase's
--     default privileges grant EXECUTE on new public functions to the API
--     roles. An anonymous caller holding only the publishable key could call
--     /rest/v1/rpc/fefo_plan_for_product and read per-warehouse batch IDs and
--     available quantities for any product id. It is only ever called from
--     inside SECURITY DEFINER functions in 0017 (reserve_order_stock and
--     friends), which run as the function owner, so revoking the API grants
--     changes no application behaviour.
--
-- H2  public.current_offer_floor_paise(uuid) is SECURITY DEFINER, has no
--     caller check, and was granted to `authenticated` by 0063. Any signed-in
--     account (a retailer, a salesman, a seller) could read the confidential
--     seller price floor of any pack id. It is called only from inside
--     SECURITY DEFINER bodies (0063 enforcement trigger, 0065 checkout RPCs,
--     0069 seller-portal RPCs); no page, action, RLS policy or test calls it
--     directly, so the grants can be withdrawn without touching behaviour.
--
-- H3  public.handle_new_user() is a trigger function. Triggers fire without an
--     EXECUTE check, so the API-role grants 0002/0052 left on it serve no
--     purpose; they only make the function name reachable over PostgREST.
--     (Direct calls already fail, because `new` is unbound outside a trigger —
--     this is defence in depth, not a live exploit.)
--
-- H4  Storage policies `staff_write_banners` / `staff_update_banners` (0003)
--     use is_staff_or_above(), while 0074 narrowed the `banners` TABLE write
--     policy to is_admin_or_above() to match the application permission
--     `banners.manage` (admin + super_admin only, lib/permissions/
--     permissions.ts). A `staff` session could therefore overwrite banner
--     artwork in Storage while being unable to edit the row that references
--     it. This migration aligns the two, keeping the existing policy NAMES so
--     the replacement is a plain drop-if-exists/create on every database.
--
-- Deliberately NOT changed here:
--   * `banners` itself, its policies and its columns — 0074 owns them and is
--     still unapplied. This file never assumes 0074 is present.
--   * `is_phone_registered(text)` — intentionally granted to `anon` so the
--     public registration forms can pre-check a phone number. 0057 recorded
--     the open decision (per-IP rate limiting); it stays an owner call.
--   * `can_current_staff_read_profile(uuid)` — a boolean-only predicate that
--     is evaluated INSIDE the profiles RLS policy for staff sessions.
--     Revoking it would break policy evaluation for staff, and it leaks no
--     row data.
--   * `submit_supplier_application(...)` — the public application form's only
--     write path; rate limiting is enforced server-side by
--     consume_supplier_application_rate_limit (service-role only).
--   * anything belonging to migration 0055 (data retention). The 120-day
--     financial/order/coins deletion window is on hold pending legal and
--     accountant review; no retention or deletion job is added or altered.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- H1 — inventory plan helper: owner/service_role only
-- ---------------------------------------------------------------------------
-- Guarded on the procedure signature so this is a no-op on a database that
-- has not reached 0017 (for example a partially restored scratch project).
do $$
begin
  if to_regprocedure('public.fefo_plan_for_product(uuid, uuid, integer)') is not null then
    revoke all on function public.fefo_plan_for_product(uuid, uuid, integer)
      from public, anon, authenticated;
  end if;
end;
$$;


-- ---------------------------------------------------------------------------
-- H2 — seller price-floor helper: owner/service_role only
-- ---------------------------------------------------------------------------
-- The seller-portal RPCs in 0069 and the offer-enforcement trigger in 0063 are
-- SECURITY DEFINER and owned by the migration role, so their internal call
-- into this function keeps working with EXECUTE held by the owner alone.
do $$
begin
  if to_regprocedure('public.current_offer_floor_paise(uuid)') is not null then
    revoke all on function public.current_offer_floor_paise(uuid)
      from public, anon, authenticated;
  end if;
end;
$$;


-- ---------------------------------------------------------------------------
-- H3 — signup trigger function: no API-role EXECUTE
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.handle_new_user()') is not null then
    revoke all on function public.handle_new_user() from public, anon, authenticated;
  end if;
end;
$$;


-- ---------------------------------------------------------------------------
-- H4 — banner artwork writes follow `banners.manage` (admin + super_admin)
-- ---------------------------------------------------------------------------
-- `storage.objects` is a Supabase-managed table: the policies below are the
-- only rows touched, and no object is created, moved or deleted here.
-- Re-runnable: each policy is dropped by name first, exactly like 0013/0074.
-- Guarded as well: a scratch/partially restored database may not have 0002's
-- is_admin_or_above() yet, and an unguarded CREATE POLICY would abort the whole
-- migration after H1–H3 had already been applied.
do $h4$
begin
  if to_regprocedure('public.is_admin_or_above()') is null
     or to_regclass('storage.objects') is null then
    raise notice '0078 H4 skipped: storage.objects or public.is_admin_or_above() is missing.';
    return;
  end if;

  drop policy if exists "staff_write_banners" on storage.objects;
  create policy "staff_write_banners" on storage.objects
    for insert with check (bucket_id = 'banners' and is_admin_or_above());

  drop policy if exists "staff_update_banners" on storage.objects;
  create policy "staff_update_banners" on storage.objects
    for update using (bucket_id = 'banners' and is_admin_or_above())
    with check (bucket_id = 'banners' and is_admin_or_above());
end;
$h4$;

-- `staff_delete_banners` already used is_admin_or_above() in 0003 and is left
-- untouched, as is the public read policy on the `banners` bucket: a public
-- bucket is served by URL independently of storage.objects RLS, and changing
-- that is a separate, operator-approved decision.


-- ---------------------------------------------------------------------------
-- Verification (run after applying; expected output is noted per row)
-- ---------------------------------------------------------------------------
-- select proname,
--        has_function_privilege('anon', oid, 'EXECUTE')          as anon,
--        has_function_privilege('authenticated', oid, 'EXECUTE') as authenticated,
--        has_function_privilege('service_role', oid, 'EXECUTE')  as service_role
--   from pg_proc
--  where proname in ('fefo_plan_for_product','current_offer_floor_paise','handle_new_user');
--   → every anon/authenticated column is false; service_role is true for the
--     two RPC-style helpers and may be false for the trigger function (it does
--     not need it).
--
-- select policyname, cmd, qual, with_check
--   from pg_policies
--  where schemaname = 'storage' and tablename = 'objects'
--    and policyname in ('staff_write_banners','staff_update_banners');
--   → both mention is_admin_or_above() and no longer is_staff_or_above().
--
-- Rollback: supabase/rollbacks/0078_privilege_hardening.sql restores the
-- pre-0078 grants and the two 0003 storage policies verbatim.
