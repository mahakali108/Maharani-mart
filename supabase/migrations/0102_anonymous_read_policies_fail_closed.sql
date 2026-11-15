-- ============================================================================
-- 0102: anonymous reads of products / product_packs / sellers fail CLOSED
--       (an empty result) instead of raising a permission error.
--
-- FOR REVIEW ONLY. Not applied to any remote project by this change.
--
-- Defect (documented as "KNOWN UNRESOLVED ISSUE" in 0086, reproduced by
-- tests/api-privilege-hardening.test.ts):
--   * "products_read" and "product_packs_read" (0086) and "sellers_select"
--     (0062) were created without a TO clause, so they apply to PUBLIC, which
--     includes the `anon` role.
--   * Their expressions call public.product_is_sale_eligible(uuid) and
--     public.is_member_of_seller(uuid). EXECUTE on both is deliberately revoked
--     from PUBLIC and anon (0062, 0086, 0087).
--   * An anonymous SELECT on these tables - and on anything that reads them
--     (product_images, product_pack_images, inventory_area_totals) - therefore
--     failed with `42501: permission denied for function ...` as soon as a row
--     had to be checked, instead of simply returning nothing.
--
-- Fix: the same three policies, with exactly the same expressions, now apply
-- TO authenticated only. With no policy for `anon`, row-level security gives an
-- anonymous caller zero rows and no error.
--
-- What this does NOT change:
--   * No function grant changes: anon still cannot execute either helper.
--   * No row becomes visible to anyone who could not see it before. Anonymous
--     callers saw no catalogue or seller rows before (the query failed) and see
--     none now. Whether the catalogue should ever be browsable without signing
--     in is an owner decision and is not taken here.
--   * Signed-in users, staff, Admins and the service role are unaffected.
-- Rollback: supabase/rollbacks/0102_anonymous_read_policies_fail_closed.down.sql
-- ============================================================================

do $$
begin
  if to_regprocedure('public.product_is_sale_eligible(uuid)') is null
     or to_regprocedure('public.is_member_of_seller(uuid)') is null then
    raise exception '0102 requires migrations 0062 and 0086/0087 (eligibility helpers missing).';
  end if;
end;
$$;

drop policy if exists "products_read" on public.products;
create policy "products_read" on public.products
for select to authenticated using (
  public.is_staff_or_above() or public.product_is_sale_eligible(id)
);

drop policy if exists "product_packs_read" on public.product_packs;
create policy "product_packs_read" on public.product_packs
for select to authenticated using (
  public.is_staff_or_above()
  or (is_active and public.product_is_sale_eligible(product_id))
);

drop policy if exists "sellers_select" on public.sellers;
create policy "sellers_select" on public.sellers
for select to authenticated using (
  public.is_admin_or_above() or public.is_member_of_seller(id)
);
