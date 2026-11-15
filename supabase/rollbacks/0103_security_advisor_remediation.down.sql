-- Rollback of 0103. Restores the previous view options, view/table
-- grants, function search_path settings and API EXECUTE grants. No data touched.

alter view public.ai_product_demand_daily reset (security_invoker);
alter view public.inventory_product_totals reset (security_invoker);
alter view public.inventory_expiry_report reset (security_invoker);
alter view public.catalog_product_sales reset (security_invoker);

grant select on public.ai_product_demand_daily,
  public.inventory_product_totals,
  public.inventory_expiry_report,
  public.catalog_product_sales
to anon, authenticated;
revoke select on public.products from authenticated;

alter function public.get_effective_price(uuid, uuid) reset search_path;
alter function public.sync_cart_item_product_id() reset search_path;
alter function public.generate_order_number() reset search_path;
alter function public.current_jwt_role() reset search_path;
alter function public.generate_grn_number() reset search_path;
alter function public.normalize_batch_number() reset search_path;
alter function public.prevent_ledger_mutation() reset search_path;
alter function public.apply_stock_movement() reset search_path;
alter function public.generate_transfer_number() reset search_path;
alter function public.update_retailer_credit_account_updated_at() reset search_path;
alter function public.enforce_order_status_transitions() reset search_path;
alter function public.enforce_delivery_status_transitions() reset search_path;
alter function public.update_support_ticket_updated_at() reset search_path;
alter function public.compliance_boolean(jsonb, text) reset search_path;

grant execute on function public.audit_credit_limit_change() to public, anon, authenticated;
grant execute on function public.drain_seller_offers_on_suspend() to public, anon, authenticated;
grant execute on function public.enforce_self_checkout_delivery_area() to public, anon, authenticated;
grant execute on function public.enforce_seller_offer_rules() to public, anon, authenticated;
grant execute on function public.enforce_seller_offer_tier_rules() to public, anon, authenticated;
grant execute on function public.guard_delivery_snapshot_update() to public, anon, authenticated;
grant execute on function public.guard_seller_offer_portal_write() to public, anon, authenticated;
grant execute on function public.log_audit() to public, anon, authenticated;
grant execute on function public.log_order_status_change() to public, anon, authenticated;
grant execute on function public.log_seller_offer_price_change() to public, anon, authenticated;
grant execute on function public.release_stock_on_order_cancel() to public, anon, authenticated;
grant execute on function public.sync_product_pack_primary_image() to public, anon, authenticated;
do $$begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'grant execute on function public.rls_auto_enable() to public, anon, authenticated';
  end if;
end;
$$;
