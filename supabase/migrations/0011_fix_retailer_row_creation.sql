-- ============================================================================
-- 0011: Fix retailer row never being created when email confirmation is on
--
-- ROOT CAUSE: registerRetailerAction previously created the `retailers`
-- row from the client, AFTER checking that supabase.auth.signUp()
-- returned an active session. When Supabase Auth has "Confirm email"
-- enabled, signUp() returns session = null until the user clicks the
-- confirmation link — so that code path never ran, and the retailer
-- row was silently never created, even though `profiles` was (since
-- that's created by a DB trigger that fires unconditionally on
-- auth.users insert, regardless of confirmation status).
--
-- FIX: extend the same trigger that already creates `profiles` to
-- also create `retailers` when the signup metadata says role =
-- 'retailer'. This removes the dependency on session state entirely
-- — the retailer row is created atomically with the auth user and
-- profile, whether or not email confirmation is enabled.
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger as $$
declare
  v_role user_role;
begin
  v_role := coalesce((new.raw_user_meta_data->>'role')::user_role, 'retailer');

  insert into public.profiles (id, role, full_name, phone)
  values (
    new.id,
    v_role,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'phone', '')
  );

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

-- ============================================================================
-- END OF MIGRATION — no business data inserted.
-- ============================================================================
