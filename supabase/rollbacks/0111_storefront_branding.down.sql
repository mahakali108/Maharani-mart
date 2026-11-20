-- Manual review only. Restoring an earlier publication is preferable to dropping history.
begin;
do $$ begin
  if exists(select 1 from public.storefront_brand_versions)
     and coalesce(current_setting('maharani.allow_data_loss', true),'false') <> 'true' then
    raise exception 'Refusing to remove branding history without explicit data loss approval';
  end if;
end $$;
drop function public.published_storefront_brand();
drop function public.record_storefront_brand(text,text,bigint,bigint);
drop table public.storefront_brand_versions;
commit;
