'use client';

import { PromoBanner } from '@/components/retailer/promo-banner';

export function BannerPreview({
  title,
  subtitle,
  ctaLabel,
  imageUrl,
  imageUrlMobile,
  linkUrl,
  status = 'draft',
}: {
  title: string;
  subtitle: string;
  ctaLabel: string;
  imageUrl: string;
  imageUrlMobile?: string;
  linkUrl: string;
  status?: 'draft' | 'published';
}) {
  return (
    <section className="space-y-3" aria-label="Storefront banner preview">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink-800">Storefront preview</h2>
        <span
          className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
            status === 'published' ? 'bg-mint-50 text-mint-700' : 'bg-ink-100 text-ink-600'
          }`}
        >
          {status === 'published' ? 'Published' : 'Draft — hidden from retailers'}
        </span>
      </div>

      {imageUrl || imageUrlMobile ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-1.5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-ink-400">Desktop · 3:1</p>
            <div className="overflow-hidden rounded-xl border border-ink-200 bg-white shadow-sm">
              <PromoBanner
                title={title.trim() || 'Banner title'}
                subtitle={subtitle}
                ctaLabel={ctaLabel}
                imageUrl={imageUrl || imageUrlMobile || ''}
                linkUrl={linkUrl}
              />
            </div>
          </div>
          <div className="min-w-0 space-y-1.5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-ink-400">
              Mobile · 4:3 {imageUrlMobile ? '' : '(using desktop art)'}
            </p>
            <div className="mx-auto w-full max-w-[280px] overflow-hidden rounded-xl border border-ink-200 bg-white shadow-sm">
              <PromoBanner
                title={title.trim() || 'Banner title'}
                subtitle={subtitle}
                ctaLabel={ctaLabel}
                imageUrl={imageUrl || imageUrlMobile || ''}
                imageUrlMobile={imageUrlMobile}
                linkUrl={linkUrl}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="flex aspect-[3/1] max-w-3xl items-center justify-center rounded-xl border border-dashed border-ink-300 bg-ink-50 px-4 text-center text-sm text-ink-400">
          Upload banner artwork to preview the storefront layout.
        </div>
      )}
    </section>
  );
}
