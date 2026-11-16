-- ============================================================================
-- 0106: FIRST SUPER ADMIN BOOTSTRAP — guarded, auditable, one-time.
--
-- FOR REVIEW ONLY. NOT APPLIED TO ANY REMOTE PROJECT BY THIS CHANGE.
--
-- The problem this solves
--   The live project has zero rows in auth.users and zero rows in profiles, so
--   no account satisfies is_super_admin(). Everything that needs one — the
--   /admin/content editor, publish_site_page(), publish_legal_document_version(),
--   the team screen — is therefore unreachable, and the only way to create the
--   first one today is a hand-written UPDATE in the SQL editor with no record of
--   who did it or whether it was authorised.
--
-- What this migration adds
--   1. super_admin_bootstrap_allowlist — ONE row naming the person allowed to
--      become the first Super Admin. Written by the database owner in SQL, never
--      by the application.
--   2. super_admin_bootstrap_events — append-only evidence of the bootstrap.
--   3. bootstrap_super_admin(uuid) — SECURITY DEFINER, executable by NO API role
--      (anon, authenticated, service_role all revoked). Only the database owner
--      in the SQL editor can run it.
--   4. guard_profile_role_insert() — defence in depth: an API caller can never
--      insert a profile whose role is super_admin or admin, even if a future
--      policy change made profiles insertable.
--
-- Why the existing stack cannot do this already (verified in this repository)
--   * handle_new_user() (0072) ignores a client-supplied "role": role comes from
--     the server-side staff/seller invite tables, or defaults to retailer. A
--     public signup cannot claim super_admin.
--   * guard_profile_privileged_columns() (0052) refuses a role change from an
--     API caller unless the caller is already a Super Admin, so a retailer
--     cannot promote themselves.
--   Therefore the ONLY remaining path is a privileged SQL action — and that is
--   exactly the path this file makes explicit, one-time and auditable.
--
-- One-time by construction
--   * the allowlist is a single row (id = 1);
--   * the function refuses when ANY super_admin already exists;
--   * the function stamps consumed_at, and a second call raises;
--   * an event row records profile id, email, previous role, session_user, time.
--
-- Depends on: 0001 (profiles, user_role), 0052 (guard trigger pattern),
--             0072 (invite-only role assignment).
-- Rollback:   supabase/rollbacks/0106_first_super_admin_bootstrap.down.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The allowlist: one row, written by the owner, consumed exactly once.
-- ----------------------------------------------------------------------------
create table if not exists public.super_admin_bootstrap_allowlist (
  id smallint primary key default 1,
  email text not null,
  full_name text not null,
  phone text not null,
  note text,
  created_at timestamptz not null default now(),
  consumed_at timestamptz,
  consumed_profile_id uuid references auth.users(id) on delete set null,
  constraint super_admin_bootstrap_allowlist_single_row check (id = 1),
  constraint super_admin_bootstrap_allowlist_email_lower check (email = lower(btrim(email))),
  constraint super_admin_bootstrap_allowlist_email_shape check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint super_admin_bootstrap_allowlist_name_len check (char_length(btrim(full_name)) between 2 and 120),
  constraint super_admin_bootstrap_allowlist_phone_shape check (phone ~ '^[0-9]{10}$'),
  constraint super_admin_bootstrap_allowlist_consumed_pair check (
    (consumed_at is null) = (consumed_profile_id is null)
  )
);

comment on table public.super_admin_bootstrap_allowlist is
  'One row: the person permitted to become the first Super Admin. Written by the database owner in SQL; consumed once by bootstrap_super_admin().';

alter table public.super_admin_bootstrap_allowlist enable row level security;
-- service_role is included deliberately: this project grants API roles ALL on new
-- tables by default (Supabase's default privileges), so a revoke that omitted it
-- would leave the service key able to write the authorisation row. Caught by
-- tests/super-admin-bootstrap-db.test.ts, not by reading this file.
revoke all on table public.super_admin_bootstrap_allowlist from public, anon, authenticated, service_role;
-- Readable by service_role for operational checks; not writable by any API role.
grant select on table public.super_admin_bootstrap_allowlist to service_role;

-- ----------------------------------------------------------------------------
-- 2. Append-only evidence.
-- ----------------------------------------------------------------------------
create table if not exists public.super_admin_bootstrap_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references auth.users(id) on delete restrict,
  email text not null,
  previous_role public.user_role not null,
  session_role text not null,
  occurred_at timestamptz not null default clock_timestamp(),
  detail jsonb not null default '{}'::jsonb
);

comment on table public.super_admin_bootstrap_events is
  'Append-only record of first-Super-Admin bootstraps. Written only by bootstrap_super_admin(); no insert/update/delete grant exists for any API role.';

alter table public.super_admin_bootstrap_events enable row level security;
revoke all on table public.super_admin_bootstrap_events from public, anon, authenticated, service_role;
grant select on table public.super_admin_bootstrap_events to service_role;

-- ----------------------------------------------------------------------------
-- 3. The one-time bootstrap.
--
-- SECURITY DEFINER: it must be able to write profiles.role past
-- guard_profile_privileged_columns(), which only exempts non-API roles.
--
-- `session_user` — not `current_user` — identifies the caller: inside a
-- SECURITY DEFINER function current_user is the function owner, so it would
-- always look privileged. In Supabase the SQL editor connects as `postgres`;
-- PostgREST connects as `authenticator` and then assumes anon/authenticated, so
-- a request through the API can never satisfy this check even if a future
-- migration accidentally granted EXECUTE.
-- ----------------------------------------------------------------------------
create or replace function public.bootstrap_super_admin(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_allow public.super_admin_bootstrap_allowlist;
  v_user record;
  v_profile public.profiles;
  v_super_admins integer;
begin
  -- (a) SQL console only.
  if session_user not in ('postgres', 'supabase_admin') then
    raise exception 'Only the database owner can bootstrap the first Super Admin.'
      using errcode = '42501';
  end if;

  -- (b) Exactly once, ever: no Super Admin may exist yet.
  select count(*) into v_super_admins from public.profiles where role = 'super_admin';
  if v_super_admins > 0 then
    raise exception 'A Super Admin already exists (%). Use the team screen, not the bootstrap.', v_super_admins
      using errcode = '23505';
  end if;

  -- (c) The authorising row must exist and must not have been used.
  select * into v_allow from public.super_admin_bootstrap_allowlist where id = 1 for update;
  if not found then
    raise exception 'No bootstrap allowlist row. Insert the owner into public.super_admin_bootstrap_allowlist first.'
      using errcode = 'P0002';
  end if;
  if v_allow.consumed_at is not null then
    raise exception 'The bootstrap allowlist row was already used at %.', v_allow.consumed_at
      using errcode = '23505';
  end if;

  -- (d) The account must exist, be email-confirmed, and be the allowlisted person.
  select id, email, email_confirmed_at into v_user from auth.users where id = p_profile_id;
  if not found then
    raise exception 'No auth user with id %.', p_profile_id using errcode = 'P0002';
  end if;
  if v_user.email_confirmed_at is null then
    raise exception 'Confirm the e-mail address before bootstrapping: an unverified address is not an owner identity.'
      using errcode = '23514';
  end if;
  if lower(btrim(coalesce(v_user.email, ''))) is distinct from v_allow.email then
    raise exception 'The allowlisted address (%) does not match this account (%).', v_allow.email, v_user.email
      using errcode = '23514';
  end if;

  -- (e) The profile exists (the 0002/0072 trigger created it on signup).
  select * into v_profile from public.profiles where id = p_profile_id for update;
  if not found then
    raise exception 'No profile row for %. Create the login first; the auth trigger creates the profile.', p_profile_id
      using errcode = 'P0002';
  end if;

  -- (f) Promote, repairing only a blank display name. The phone and the role are
  --     never taken from the allowlist into the profile: the profile is the
  --     account's own data.
  update public.profiles
     set role = 'super_admin',
         is_active = true,
         full_name = case when btrim(coalesce(v_profile.full_name, '')) = ''
                          then v_allow.full_name else v_profile.full_name end
   where id = p_profile_id;

  -- (g) Consume the authorisation and record what happened.
  update public.super_admin_bootstrap_allowlist
     set consumed_at = now(),
         consumed_profile_id = p_profile_id
   where id = 1;

  insert into public.super_admin_bootstrap_events
    (profile_id, email, previous_role, session_role, detail)
  values
    (p_profile_id, v_allow.email, v_profile.role, session_user,
     jsonb_build_object(
       'method', 'bootstrap_super_admin',
       'allowlist_created_at', v_allow.created_at,
       'note', v_allow.note,
       'previous_is_active', v_profile.is_active
     ));
end;
$$;

-- No API role may execute it. The database owner keeps implicit owner rights,
-- which is the only intended caller.
revoke all on function public.bootstrap_super_admin(uuid) from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. Defence in depth: an API caller cannot insert a privileged profile.
--
-- Today the only inserter is handle_new_user() (SECURITY DEFINER, owner =
-- postgres), and 0052 already blocks role CHANGES by API callers. This closes
-- the INSERT side so a future policy change cannot reopen it.
-- ----------------------------------------------------------------------------
create or replace function public.guard_profile_role_insert()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('authenticated', 'anon', 'service_role')
     and new.role in ('super_admin', 'admin') then
    raise exception 'Privileged profiles are created by the database owner, not by an API caller.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Trigger functions fire without an EXECUTE check, so the API-role grants a
-- CREATE FUNCTION leaves behind only make the name reachable over PostgREST.
-- 0078 removed exactly this for handle_new_user(); same treatment here.
revoke all on function public.guard_profile_role_insert() from public, anon, authenticated, service_role;

drop trigger if exists trg_guard_profile_role_insert on public.profiles;
create trigger trg_guard_profile_role_insert
  before insert on public.profiles
  for each row execute function public.guard_profile_role_insert();

-- ============================================================================
-- END 0106
-- ============================================================================
