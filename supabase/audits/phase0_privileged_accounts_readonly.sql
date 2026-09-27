-- ============================================================================
-- supabase/audits/phase0_privileged_accounts_readonly.sql
-- PHASE 0 — privileged-account review (SEC-1 / SEC-2 / SEC-5 / SEC-8)
--
-- STRICTLY READ-ONLY. Every statement is a SELECT, and the whole file runs
-- inside a READ ONLY transaction that is rolled back, so PostgreSQL itself
-- rejects any write. It changes NO data and demotes NO one: every row is only
-- a lead for a human to confirm. Corrective action needs explicit owner
-- approval and is deliberately NOT included here.
--
-- HOW TO RUN: Supabase SQL Editor (runs as postgres, which can read
-- auth.users) or psql:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/audits/phase0_privileged_accounts_readonly.sql
-- The SQL Editor shows only the LAST result set. To see every report there,
-- run each numbered query on its own (select it and press Run).
--
-- Background, i.e. what the evidence columns mean:
--   * Before migration 0052, handle_new_user() copied
--     raw_user_meta_data->>'role' into profiles.role, and any public
--     signUp() call can set that metadata (SEC-1). Admin > Team also used
--     metadata for staff roles, so a metadata role on its own is NOT proof
--     of abuse. Signup-form fields (shop_name / area_id) next to a
--     privileged role ARE a strong signal.
--   * Before 0052, profiles_self_update let a user rewrite their own role
--     and is_active (SEC-2). Legitimate role changes go through the Control
--     Center, which writes super_admin_audit_logs action 'ROLE_CHANGED'.
--     A role that differs from the creation-time role with no ROLE_CHANGED
--     row is a strong signal.
--   * Before 0052, a retailer could self-insert an 'active' retailers row
--     with any credit_limit (SEC-5). Real approvals set approved_by.
-- ============================================================================

begin transaction isolation level repeatable read read only;

-- 1. Every Admin / Super Admin account -------------------------------------
select
  p.id,
  u.email,
  p.full_name,
  p.phone,
  p.role,
  p.is_active,
  p.created_at,
  p.updated_at,
  u.last_sign_in_at,
  u.raw_user_meta_data ->> 'role'                           as signup_metadata_role,
  (u.raw_user_meta_data ? 'shop_name'
     or u.raw_user_meta_data ? 'area_id')                   as has_signup_form_fields,
  exists (select 1 from super_admin_audit_logs a
           where a.target_id = p.id and a.action = 'ROLE_CHANGED') as has_role_change_audit
from profiles p
left join auth.users u on u.id = p.id
where p.role in ('admin', 'super_admin')
order by p.role desc, p.created_at;

-- 2. Suspicious role assignments (SEC-1 / SEC-2), all roles -----------------
with base as (
  select
    p.id, u.email, p.role::text as role, p.is_active, p.created_at, p.updated_at,
    u.raw_user_meta_data ->> 'role' as meta_role,
    (u.raw_user_meta_data ? 'shop_name' or u.raw_user_meta_data ? 'area_id') as signup_form,
    exists (select 1 from super_admin_audit_logs a
             where a.target_id = p.id and a.action = 'ROLE_CHANGED') as audited_role_change,
    (select string_agg(coalesce(a.before_data ->> 'role', '?') || '→' || coalesce(a.after_data ->> 'role', '?')
                       || ' by ' || a.actor_id::text || ' @ ' || a.created_at::text, '; ' order by a.created_at)
       from super_admin_audit_logs a
      where a.target_id = p.id and a.action = 'ROLE_CHANGED') as role_change_trail
  from profiles p
  left join auth.users u on u.id = p.id
)
select id, email, role, is_active, created_at, updated_at, meta_role, role_change_trail,
       concat_ws(' | ',
         case when role <> 'retailer' and signup_form
              then 'STRONG: non-retailer role on an account created with the public retailer-signup fields' end,
         case when role <> coalesce(meta_role, 'retailer') and not audited_role_change
              then 'STRONG: role differs from creation-time role (' || coalesce(meta_role, 'retailer')
                   || ') and there is no ROLE_CHANGED audit row (possible self-promotion via profile edit)' end,
         case when role in ('admin', 'super_admin') and meta_role in ('admin', 'super_admin')
              then 'REVIEW: privileged role was taken from signup metadata; confirm it was created by the owner' end,
         case when u_missing then 'REVIEW: profile has no auth.users row' end
       ) as evidence
from (select b.*, (b.email is null) as u_missing from base b) x
where (role <> 'retailer' and signup_form)
   or (role <> coalesce(meta_role, 'retailer') and not audited_role_change)
   or (role in ('admin', 'super_admin') and meta_role in ('admin', 'super_admin'))
   or u_missing
order by (role in ('admin', 'super_admin')) desc, created_at;

-- 3. Super Admin count sanity check -----------------------------------------
select count(*) filter (where role = 'super_admin')                  as super_admins,
       count(*) filter (where role = 'super_admin' and is_active)    as active_super_admins,
       count(*) filter (where role = 'admin')                        as admins,
       count(*) filter (where role in ('staff', 'salesman'))  as staff_and_salesmen
from profiles;

-- 4. Retailer rows that look self-approved (SEC-5) ---------------------------
select
  r.id, u.email, r.shop_name, r.status, r.credit_limit, r.approved_by, r.approved_at,
  r.area_id, (a.id is null) as area_missing,
  ca.credit_limit_paise, ca.created_by as credit_account_created_by,
  r.created_at, r.updated_at,
  concat_ws(' | ',
    case when r.status = 'active' and r.approved_by is null
         then 'STRONG: active without an approver' end,
    case when r.credit_limit > 0 and r.approved_by is null
         then 'STRONG: legacy credit_limit set without an approver' end,
    case when a.id is null then 'REVIEW: area_id does not reference a service area' end
  ) as evidence
from retailers r
left join auth.users u on u.id = r.id
left join areas a on a.id = r.area_id
left join retailer_credit_accounts ca on ca.retailer_id = r.id
where (r.status = 'active' and r.approved_by is null)
   or (r.credit_limit > 0 and r.approved_by is null)
   or a.id is null
order by r.created_at;

-- 5. Retailer profiles without a retailers row -------------------------------
--    From migration 0052 onwards the app sends these to /pending-approval
--    until an Admin creates the row.
select p.id, u.email, p.full_name, p.phone, p.is_active, p.created_at, p.updated_at
from profiles p
left join auth.users u on u.id = p.id
where p.role = 'retailer'
  and not exists (select 1 from retailers r where r.id = p.id)
order by p.created_at;

-- 6. Plaintext delivery OTPs already sitting in notification_logs (SEC-8) ----
--    Counts only; the OTP values themselves are not selected.
select channel,
       count(*)                                       as rows_mentioning_otp,
       min(created_at)                                as first_seen,
       max(created_at)                                as last_seen
from notification_logs
where coalesce(payload ->> 'body', '') ~* 'otp[^0-9]{0,20}[0-9]{4,8}'
group by channel
order by channel;

rollback;
