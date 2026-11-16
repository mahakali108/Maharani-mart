-- ============================================================================
-- Rollback of 0106: removes the bootstrap allowlist, the audit table, the
-- one-time function and the profile-insert guard.
--
-- It does NOT demote anybody. A Super Admin created by the bootstrap keeps the
-- role: revoking the procedure must never silently remove the only account that
-- can administer the site. Demote deliberately, with:
--
--   update public.profiles set role = 'retailer' where id = '<that user>';
--
-- The audit trail is evidence. This file therefore refuses to drop it once it
-- holds a row, unless the operator opts in with maharani.allow_data_loss (the
-- same guard the 0104 and 0105 rollbacks use).
-- ============================================================================

do $$
begin
  if to_regclass('public.super_admin_bootstrap_events') is not null
     and coalesce(current_setting('maharani.allow_data_loss', true), 'false') <> 'true'
     and exists (select 1 from public.super_admin_bootstrap_events) then
    raise exception 'Rollback refused: the bootstrap audit trail holds % row(s). Export it, then set maharani.allow_data_loss = ''true'' to drop it.',
      (select count(*) from public.super_admin_bootstrap_events);
  end if;
end
$$;

drop trigger if exists trg_guard_profile_role_insert on public.profiles;
drop function if exists public.guard_profile_role_insert();

drop function if exists public.bootstrap_super_admin(uuid);

drop table if exists public.super_admin_bootstrap_events;
drop table if exists public.super_admin_bootstrap_allowlist;
