-- Review locally; no remote execution. Branding never updates issuer or order data.
begin;
create table public.storefront_brand_versions (
  id bigint generated always as identity primary key,
  stage text not null check (stage in ('draft','published')),
  operation text not null check (operation in ('draft','publish','restore')),
  display_name text not null check (length(trim(display_name)) between 1 and 64),
  tagline text not null check (length(trim(tagline)) between 1 and 140),
  source_id bigint references public.storefront_brand_versions(id),
  actor uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.storefront_brand_versions enable row level security;
revoke all on public.storefront_brand_versions from public, anon, authenticated;
grant select on public.storefront_brand_versions to authenticated;
create policy brand_history_admin on public.storefront_brand_versions for select to authenticated using (public.current_user_role() = 'super_admin');

-- Both publish and rollback copy the exact immutable revision previewed by the editor.
create function public.record_storefront_brand(p_name text, p_tagline text, p_source bigint, p_expected bigint default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or public.current_user_role() is distinct from 'super_admin' then raise exception 'Super Admin required' using errcode='42501'; end if;
  if p_source is null then
    insert into public.storefront_brand_versions(stage,operation,display_name,tagline) values ('draft','draft',trim(p_name),trim(p_tagline));
  else
    -- Serialize publications. A timed-out caller may retry the same form, but it
    -- cannot append another publication or overwrite someone else's newer one.
    perform pg_advisory_xact_lock(111, 1);
    if (select id from public.storefront_brand_versions where stage='published' order by id desc limit 1) is distinct from p_expected then
      raise exception 'Publication changed; refresh history';
    end if;
    insert into public.storefront_brand_versions(stage,operation,display_name,tagline,source_id)
    select 'published',case when stage='draft' then 'publish' else 'restore' end,display_name,tagline,id from public.storefront_brand_versions where id=p_source;
    if not found then raise exception 'Unknown revision'; end if;
  end if;
end $$;
create function public.published_storefront_brand() returns table(display_name text, tagline text)
language sql stable security definer set search_path = '' as $$
  select v.display_name,v.tagline from public.storefront_brand_versions v where auth.uid() is not null and stage='published' order by id desc limit 1;
$$;
revoke all on function public.record_storefront_brand(text,text,bigint,bigint), public.published_storefront_brand() from public,anon,authenticated;
grant execute on function public.record_storefront_brand(text,text,bigint,bigint), public.published_storefront_brand() to authenticated;
commit;
