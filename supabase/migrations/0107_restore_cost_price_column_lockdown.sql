-- Migration 0107: Restore column-level lockdown on products.cost_price
-- Migration 0103 granted table-level SELECT on public.products to authenticated
-- for inventory views, which inadvertently re-granted SELECT on cost_price.
-- In PostgreSQL, table-level SELECT overrides column-level REVOKE, so we must
-- revoke table-level SELECT and grant SELECT on all columns except cost_price.

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
    execute format('grant select (%s) on public.products to authenticated', cols);
  end if;
end
$$;
