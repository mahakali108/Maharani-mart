'use client';

import { PromoBanner } from '@/components/retailer/promo-banner';

export function BannerPreview({
  title,
  subtitle,
  ctaLabel,
  imageUrl,
  linkUrl,
}: {
  title: string;
  subtitle: string;
  ctaLabel: string;
  imageUrl: string;
  linkUrl: string;
}) {
  return (
    <section className="space-y-2" aria-label="Storefront banner preview">
      <h2 className="text-sm font-semibold text-ink-800">Storefront preview</h2>
      {imageUrl ? (
        <div className="max-w-3xl overflow-hidden rounded-xl border border-ink-200 bg-white shadow-sm">
          <PromoBanner
            title={title.trim() || 'Banner title'}
            subtitle={subtitle}
            ctaLabel={ctaLabel}
            imageUrl={imageUrl}
            linkUrl={linkUrl}
          />
        </div>
      ) : (
        <div className="flex aspect-[3/1] max-w-3xl items-center justify-center rounded-xl border border-dashed border-ink-300 bg-ink-50 px-4 text-center text-sm text-ink-400">
          Upload banner artwork to preview the storefront layout.
        </div>
      )}
    </section>
  );
}
