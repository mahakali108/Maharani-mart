-- ============================================================================
-- Rollback of 0102: restores the three read policies exactly as 0086 / 0062
-- created them (no TO clause, i.e. PUBLIC). No data is touched.
--
-- After this rollback an anonymous SELECT on products, product_packs or sellers
-- raises `permission denied for function ...` again (the pre-0102 behaviour).
-- ============================================================================

drop policy if exists "products_read" on public.products;
create policy "products_read" on public.products for select using (
  public.is_staff_or_above() or public.product_is_sale_eligible(id)
);

drop policy if exists "product_packs_read" on public.product_packs;
create policy "product_packs_read" on public.product_packs for select using (
  public.is_staff_or_above()
  or (is_active and public.product_is_sale_eligible(product_id))
);

drop policy if exists "sellers_select" on public.sellers;
create policy "sellers_select" on public.sellers for select using (
  public.is_admin_or_above() or public.is_member_of_seller(id)
);
