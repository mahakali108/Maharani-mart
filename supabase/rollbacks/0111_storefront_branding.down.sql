-- Manual review only. Restoring an earlier publication is preferable to dropping history.
begin;
do $$ begin
  if to_regclass('public.storefront_brand_versions') is null then return; end if;
  -- Prevent a first revision arriving between the history check and the DROP.
  lock table public.storefront_brand_versions in access exclusive mode;
  if exists(select 1 from public.storefront_brand_versions)
     and coalesce(current_setting('maharani.allow_data_loss', true),'false') <> 'true' then
    raise exception 'Refusing to remove branding history without explicit data loss approval';
  end if;
end $$;
drop function if exists public.published_storefront_brand();
drop function if exists public.record_storefront_brand(text,text,bigint,bigint);
drop table if exists public.storefront_brand_versions;
commit;
