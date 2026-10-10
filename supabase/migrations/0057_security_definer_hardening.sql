-- ============================================================================
-- 0057 — SECURITY DEFINER hardening for the five functions flagged in review
-- ============================================================================
-- Verified against the migration history (not assumed):
--
--   function                         defined in   before this migration
--   ------------------------------   ----------   ---------------------------------
--   is_user_access_valid(uuid)       0020         SECURITY DEFINER, NO search_path,
--   get_active_access(uuid)          0020         EXECUTE open to PUBLIC (so anon
--   is_feature_enabled_for_user(...) 0020         could call it over PostgREST and
--                                                 read ANY user's access period by
--                                                 passing an arbitrary user id).
--   log_audit()                      0001         SECURITY DEFINER, NO search_path.
--   log_order_status_change()        0008         Trigger functions (not callable as
--                                                 RPC), SECURITY DEFINER, NO search_path.
--
-- Nothing in the application (app/, lib/, components/, middleware.ts, scripts/)
-- and no RLS policy or other migration calls the three access functions, so
-- restricting them to the service role removes an enumeration path without
-- affecting any caller.
--
-- Changes (no data is read, written, or deleted):
--   1. Pin search_path = public, pg_temp on all five functions. This stops a
--      caller who can create objects in another schema from hijacking the
--      unqualified names used inside a SECURITY DEFINER body.
--   2. Revoke EXECUTE on the three access-check functions from PUBLIC, anon and
--      authenticated (Supabase's default privileges grant the API roles
--      EXECUTE explicitly, so PUBLIC alone is not enough). Grant to
--      service_role only.
--   3. The two trigger functions keep their EXECUTE grants: triggers fire
--      without an EXECUTE check, and PostgREST cannot call a trigger function
--      as an RPC anyway.
--
-- Re-runnable: ALTER ... SET and REVOKE/GRANT are idempotent.
-- Not changed here: is_phone_registered(text), granted to anon. See the
-- launch-readiness document for the rate-limiting decision it needs.
-- ============================================================================

-- 1. Pinned search_path -------------------------------------------------------
alter function public.is_user_access_valid(uuid)
  set search_path = public, pg_temp;
alter function public.get_active_access(uuid)
  set search_path = public, pg_temp;
alter function public.is_feature_enabled_for_user(uuid, text)
  set search_path = public, pg_temp;
alter function public.log_audit()
  set search_path = public, pg_temp;
alter function public.log_order_status_change()
  set search_path = public, pg_temp;

-- 2. Access-check functions: service role only --------------------------------
revoke all on function public.is_user_access_valid(uuid)
  from public, anon, authenticated;
revoke all on function public.get_active_access(uuid)
  from public, anon, authenticated;
revoke all on function public.is_feature_enabled_for_user(uuid, text)
  from public, anon, authenticated;

grant execute on function public.is_user_access_valid(uuid) to service_role;
grant execute on function public.get_active_access(uuid) to service_role;
grant execute on function public.is_feature_enabled_for_user(uuid, text) to service_role;

-- ============================================================================
-- END OF MIGRATION — schema privileges only; no business data touched.
-- ============================================================================
