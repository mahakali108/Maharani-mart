-- 0103: close the remaining SECURITY DEFINER / view privilege lint findings.
--
-- Apply after 0102. This migration is schema/privilege-only; it does not touch
-- business rows, order balances, stock, seller approvals, or customer data.
--
-- Intentional exceptions are documented below:
--   * RLS predicate functions stay callable by anon because many existing
--     PUBLIC policies evaluate them before returning zero rows.
--   * is_phone_registered(text) and submit_supplier_application(...) remain
--     public compatibility endpoints; their rate-limit/privacy review is
--     separate from this privilege repair.
--   * pg_net is non-relocatable in the live project and is not moved.
--   * five service_role-only tables intentionally have RLS and no policies.
--
-- PostgreSQL 15+ is required for security_invoker views.

do $$
begin
  if current_setting('server_version_num')::integer < 150000 then
    raise exception '0103 requires PostgreSQL 15+ for security_invoker views';
  end if;

  if to_regclass('public.ai_product_demand_daily') is null
     or to_regclass('public.inventory_product_totals') is null
     or to_regclass('public.inventory_expiry_report') is null
     or to_regclass('public.catalog_product_sales') is null then
    raise exception '0103 expected all four audited public views to exist';
  end if;
end;
$$;

-- SECURITY DEFINER views bypass the caller's RLS. Make them invoker views.
alter view public.ai_product_demand_daily set (security_invoker = true);
alter view public.inventory_product_totals set (security_invoker = true);
alter view public.inventory_expiry_report set (security_invoker = true);
alter view public.catalog_product_sales set (security_invoker = true);

-- These are staff-only operational/analytics views. Remove anonymous access.
-- Authenticated callers still pass through the base-table RLS policies.
revoke select on public.ai_product_demand_daily,
  public.inventory_product_totals,
  public.inventory_expiry_report,
  public.catalog_product_sales
from public, anon;
grant select on public.ai_product_demand_daily,
  public.inventory_product_totals,
  public.inventory_expiry_report,
  public.catalog_product_sales
to authenticated;

-- The two inventory views join products. Granting table SELECT does not bypass
-- RLS: products_read (0102) remains the row-level gate for authenticated users.
-- The view predicate independently restricts these aggregates to staff/admin.
grant select on public.products to authenticated;

-- Pin every function flagged by the live advisor. pg_catalog first prevents
-- user objects from shadowing built-ins; pg_temp last prevents temp shadowing.
alter function public.get_effective_price(uuid, uuid)
  set search_path = pg_catalog, public, pg_temp;
alter function public.sync_cart_item_product_id()
  set search_path = pg_catalog, public, pg_temp;
alter function public.generate_order_number()
  set search_path = pg_catalog, public, pg_temp;
alter function public.current_jwt_role()
  set search_path = pg_catalog, public, pg_temp;
alter function public.generate_grn_number()
  set search_path = pg_catalog, public, pg_temp;
alter function public.normalize_batch_number()
  set search_path = pg_catalog, public, pg_temp;
alter function public.prevent_ledger_mutation()
  set search_path = pg_catalog, public, pg_temp;
alter function public.apply_stock_movement()
  set search_path = pg_catalog, public, pg_temp;
alter function public.generate_transfer_number()
  set search_path = pg_catalog, public, pg_temp;
alter function public.update_retailer_credit_account_updated_at()
  set search_path = pg_catalog, public, pg_temp;
alter function public.enforce_order_status_transitions()
  set search_path = pg_catalog, public, pg_temp;
alter function public.enforce_delivery_status_transitions()
  set search_path = pg_catalog, public, pg_temp;
alter function public.update_support_ticket_updated_at()
  set search_path = pg_catalog, public, pg_temp;
alter function public.compliance_boolean(jsonb, text)
  set search_path = pg_catalog, public, pg_temp;

-- Trigger functions execute as part of their owning table/event trigger; the
-- invoking API role does not need EXECUTE on them. Revoke direct RPC access.
-- Trigger execution itself is not blocked by revoking function EXECUTE.
revoke all on function public.audit_credit_limit_change()
  from public, anon, authenticated;
revoke all on function public.drain_seller_offers_on_suspend()
  from public, anon, authenticated;
revoke all on function public.enforce_self_checkout_delivery_area()
  from public, anon, authenticated;
revoke all on function public.enforce_seller_offer_rules()
  from public, anon, authenticated;
revoke all on function public.enforce_seller_offer_tier_rules()
  from public, anon, authenticated;
revoke all on function public.guard_delivery_snapshot_update()
  from public, anon, authenticated;
revoke all on function public.guard_seller_offer_portal_write()
  from public, anon, authenticated;
revoke all on function public.log_audit()
  from public, anon, authenticated;
revoke all on function public.log_order_status_change()
  from public, anon, authenticated;
revoke all on function public.log_seller_offer_price_change()
  from public, anon, authenticated;
revoke all on function public.release_stock_on_order_cancel()
  from public, anon, authenticated;
revoke all on function public.sync_product_pack_primary_image()
  from public, anon, authenticated;

-- rls_auto_enable is an event-trigger function, not an application RPC.
do $$begin
  -- Some local test fixtures do not install the optional event trigger.
  -- Revoke direct API access when the function exists in the target database.
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end;
$$;

-- Post-migration invariants (also covered by tests):
--  * all four views have security_invoker=true;
--  * anon cannot SELECT the staff-only views;
--  * authenticated can SELECT the views, but underlying RLS still applies;
--  * all 14 flagged functions have a pinned search_path;
--  * the 12 row-trigger functions and rls_auto_enable are not API-callable;
--  * anon retains EXECUTE on predicates referenced by PUBLIC RLS policies.
