-- Optional merchant-authored copy for the retailer home carousel.
-- Existing banners, images, links, scheduling and RLS are unchanged.
-- No seed content or business data; safe to re-run.
alter table public.banners
  add column if not exists subtitle text,
  add column if not exists cta_label text;

comment on column public.banners.subtitle is 'Optional supporting copy displayed beneath the banner title.';
comment on column public.banners.cta_label is 'Optional CTA label. Rendered only when link_url is a safe navigation target.';
