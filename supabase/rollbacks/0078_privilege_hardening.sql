-- ============================================================================
-- Rollback 0078 — restore the pre-0078 privilege posture.
--
-- This is a SECURITY DOWNGRADE, not a data change. It exists so the migration
-- is reversible on a staging project; do not run it in production unless the
-- exposure it re-opens has been accepted by the owner in writing.
--
-- What it restores, verbatim:
--   * EXECUTE on fefo_plan_for_product(uuid, uuid, integer) → PUBLIC, anon,
--     authenticated (Supabase's default privileges, as before 0078);
--   * EXECUTE on current_offer_floor_paise(uuid) → authenticated (as 0063
--     granted);
--   * EXECUTE on handle_new_user() → PUBLIC, anon, authenticated (0002/0052);
--   * storage policies staff_write_banners / staff_update_banners back to
--     0003's is_staff_or_above().
--
-- No row, column, index, constraint or object is touched. Re-runnable.
-- ============================================================================

do $$
begin
  if to_regprocedure('public.fefo_plan_for_product(uuid, uuid, integer)') is not null then
    grant execute on function public.fefo_plan_for_product(uuid, uuid, integer)
      to public, anon, authenticated;
  end if;
end;
$$;

do $$
begin
  if to_regprocedure('public.current_offer_floor_paise(uuid)') is not null then
    grant execute on function public.current_offer_floor_paise(uuid) to authenticated;
  end if;
end;
$$;

do $$
begin
  if to_regprocedure('public.handle_new_user()') is not null then
    grant execute on function public.handle_new_user() to public, anon, authenticated;
  end if;
end;
$$;

drop policy if exists "staff_write_banners" on storage.objects;
create policy "staff_write_banners" on storage.objects
  for insert with check (bucket_id = 'banners' and is_staff_or_above());

drop policy if exists "staff_update_banners" on storage.objects;
create policy "staff_update_banners" on storage.objects
  for update using (bucket_id = 'banners' and is_staff_or_above());
