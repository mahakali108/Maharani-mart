-- ============================================================================
-- 0002: Auth trigger + self-registration policy for retailers
-- ============================================================================

-- Automatically creates a `profiles` row whenever a new Supabase Auth
-- user is created, using metadata passed at signUp() time
-- (role, full_name, phone). This keeps profiles in sync with auth.users
-- without the app needing a privileged service-role call for it.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, role, full_name, phone)
  values (
    new.id,
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'retailer'),
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'phone', '')
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Allows a newly-registered retailer to insert their OWN retailer row
-- immediately after signUp (status always starts as pending_approval;
-- an admin must approve before the account can be used).
create policy "retailers_self_insert" on retailers
  for insert
  with check (id = auth.uid());

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
