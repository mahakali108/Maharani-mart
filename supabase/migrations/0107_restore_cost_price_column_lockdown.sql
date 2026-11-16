-- Migration 0107: Restore column-level lockdown on products.cost_price
--
-- 0103 granted table-level SELECT on products to authenticated. PostgreSQL
-- table-level SELECT overrides the column-level REVOKE from 0025, exposing
-- purchase cost. Restore column-level grants for both API roles, while
-- preserving the anonymous catalogue's fail-closed RLS behaviour.
--
-- The SECURITY INVOKER inventory_product_totals view also used to read
-- products.cost_price directly. Keep that value behind the existing
-- admin_product_cost() SECURITY DEFINER accessor, which checks is_admin_or_above
-- on every call. Staff retain the view but receive no product purchase cost.

do $$
declare
  cols text;
begin
  select string_agg(quote_ident(attname), ', ' order by attnum)
    into cols
    from pg_attribute
   where attrelid = 'public.products'::regclass
     and attnum > 0
     and not attisdropped
     and attname <> 'cost_price';

  execute 'revoke select on public.products from public, anon, authenticated';
  if cols is not null then
    execute format('grant select (%s) on public.products to anon, authenticated', cols);
  end if;
end
$$;

-- Preserve the staff-only invoker view without granting direct cost_price
-- access. admin_product_cost() returns a value only for admin/super_admin;
-- for staff below admin it returns NULL. Base-table RLS remains in force.
create or replace view public.inventory_product_totals
with (security_invoker = true) as
select
  p.id as product_id,
  p.name as product_name,
  p.sku_code,
  coalesce(s.quantity, 0) as quantity_on_hand,
  coalesce(s.reserved_quantity, 0) as reserved_quantity,
  coalesce(s.quantity, 0) - coalesce(s.reserved_quantity, 0) as available_quantity,
  coalesce(b.batch_quantity, 0) as batch_quantity,
  coalesce(b.batch_value, 0)
    + greatest(coalesce(s.quantity, 0) - coalesce(b.batch_quantity, 0), 0)
      * coalesce(public.admin_product_cost(p.id), 0)
    as estimated_value,
  p.min_stock,
  p.reorder_level,
  p.max_stock,
  case
    when coalesce(s.quantity, 0) - coalesce(s.reserved_quantity, 0) <= 0 then 'out_of_stock'
    when p.reorder_level > 0
      and coalesce(s.quantity, 0) - coalesce(s.reserved_quantity, 0) <= p.reorder_level then 'low_stock'
    else 'healthy'
  end as stock_status,
  s.warehouse_count
from public.products p
left join (
  select product_id, sum(quantity) as quantity, sum(reserved_quantity) as reserved_quantity,
         count(*) as warehouse_count
  from public.inventory_stock group by product_id
) s on s.product_id = p.id
left join (
  select product_id, sum(current_quantity) as batch_quantity,
         sum(current_quantity * coalesce(unit_cost, 0)) as batch_value
  from public.inventory_batches group by product_id
) b on b.product_id = p.id
where public.is_staff_or_above();
