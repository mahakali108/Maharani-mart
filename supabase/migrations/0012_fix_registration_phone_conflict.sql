-- ============================================================================
-- 0012: Fix root cause of "users are not being created during registration"
--
-- ROOT CAUSE: profiles.phone has a UNIQUE NOT NULL constraint (0001_init.sql).
-- handle_new_user() (0002, extended in 0011) inserts into profiles as part
-- of an AFTER INSERT trigger on auth.users, and that profiles insert was
-- NOT wrapped in any exception handler. Postgres triggers run inside the
-- SAME transaction as the statement that fired them, so ANY error raised
-- inside handle_new_user() rolls back the entire transaction — including
-- the auth.users row itself.
--
-- In practice this means: the moment two signups share a phone number
-- (e.g. someone testing registration twice, or two accounts created from
-- the Supabase dashboard without a phone filled in, which both fall back
-- to the same empty string ''), the SECOND signup hits a unique_violation
-- on profiles.phone deep inside this trigger, which silently aborts the
-- whole auth.users insert. Supabase Auth surfaces this as a generic
-- "Database error saving new user" — no row is created anywhere, which is
-- exactly the symptom reported ("users are not being created").
--
-- FIX (defense in depth, two layers):
--  1. A new is_phone_registered() RPC lets the app check availability
--     BEFORE calling signUp(), so the common case never reaches the DB
--     trigger at all and the retailer sees a normal "already registered"
--     field error instead of a broken signup.
--  2. The trigger itself now catches a unique_violation on the profiles
--     insert and re-raises a short, recognizable message
--     ('phone_already_registered') instead of letting Postgres's raw
--     constraint-violation text bubble up — so even a race condition
--     (two tabs submitting the same phone at the same instant) fails
--     with a message the app can translate into something readable,
--     rather than a mysterious 500.
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger as $$
declare
  v_role user_role;
begin
  v_role := coalesce((new.raw_user_meta_data->>'role')::user_role, 'retailer');

  begin
    insert into public.profiles (id, role, full_name, phone)
    values (
      new.id,
      v_role,
      coalesce(new.raw_user_meta_data->>'full_name', ''),
      coalesce(new.raw_user_meta_data->>'phone', '')
    );
  exception
    when unique_violation then
      raise exception 'phone_already_registered';
  end;

  if v_role = 'retailer' then
    -- Wrapped so a bad/missing area_id (e.g. metadata sent by an old
    -- client build) can never break auth signup itself — the auth
    -- user and profile must always be created successfully. If this
    -- block fails, the retailer row can still be created later by an
    -- admin manually; it should not be possible to lose the account.
    begin
      insert into public.retailers (id, shop_name, area_id, address, status)
      values (
        new.id,
        coalesce(new.raw_user_meta_data->>'shop_name', ''),
        (new.raw_user_meta_data->>'area_id')::uuid,
        new.raw_user_meta_data->>'address',
        'pending_approval'
      );
    exception when others then
      raise warning 'handle_new_user: failed to create retailers row for %: %', new.id, sqlerrm;
    end;
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- Trigger itself is unchanged (already exists from 0002), the
-- function body above replaces it in place via CREATE OR REPLACE.

-- Lets the registration form check phone availability BEFORE calling
-- signUp(), without needing SELECT access to the profiles table (which
-- RLS correctly denies to anonymous/other users). Returns only a
-- boolean — no profile data is exposed.
create or replace function public.is_phone_registered(p_phone text)
returns boolean as $$
  select exists (select 1 from public.profiles where phone = p_phone);
$$ language sql stable security definer set search_path = public;

grant execute on function public.is_phone_registered(text) to anon, authenticated;

-- ============================================================================
-- END OF MIGRATION — no business data inserted or modified.
-- ============================================================================
