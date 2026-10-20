'use client';

import { useState } from 'react';
import { getImageProps } from 'next/image';
import Link from 'next/link';
import { ArrowRight, ArrowUpRight, ImageOff } from 'lucide-react';
import { resolveMediaUrl } from '@/lib/media/refs';
import { resolveBannerTarget } from '@/lib/retailer/banner-target';

/** Legacy external URLs are served as-is; Supabase public URLs stay optimised. */
function isOptimizableImage(src: string): boolean {
  if (src.startsWith('/') && !src.startsWith('//')) return true;
  try {
    const url = new URL(src);
    return (
      url.protocol === 'https:' &&
      url.hostname.endsWith('.supabase.co') &&
      url.pathname.startsWith('/storage/v1/object/public/')
    );
  } catch {
    return false;
  }
}

/**
 * The storefront banner — a marketing surface, so it uses the berry palette
 * (`marketing-*` tokens) rather than the operational violet system.
 *
 * Artwork standards:
 *   - desktop 1080 × 360 px (3:1), always cropped with object-fit: cover;
 *   - mobile  1200 × 900 px (4:3), optional. When no mobile rendition exists
 *     the desktop image is used at 3:1, exactly as before.
 *
 * `<picture>` picks ONE rendition at the viewport level, so a phone never
 * downloads the desktop artwork as well.
 */
export function PromoBanner({
  title,
  subtitle,
  imageUrl,
  imageUrlMobile,
  linkUrl,
  ctaLabel,
  priority = false,
}: {
  title: string;
  subtitle?: string | null;
  imageUrl: string;
  imageUrlMobile?: string | null;
  linkUrl?: string | null;
  ctaLabel?: string | null;
  priority?: boolean;
}) {
  const [errored, setErrored] = useState(false);
  const desktop = resolveMediaUrl(imageUrl);
  const mobile = resolveMediaUrl(imageUrlMobile);
  const hasMobileOverride = !!mobile && mobile !== desktop;

  const target = resolveBannerTarget(linkUrl);
  const cta = (
    <>
      {ctaLabel?.trim() || 'Explore'}
      {target?.external ? <ArrowUpRight className="h-4 w-4" aria-hidden="true" /> : <ArrowRight className="h-4 w-4" aria-hidden="true" />}
    </>
  );
  const ctaClass =
    'mt-3 inline-flex min-h-11 max-w-full items-center justify-center gap-2 self-start rounded-xl bg-marketing-action px-4 py-2 text-xs font-semibold text-marketing-on-action transition hover:bg-marketing-action-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marketing-action focus-visible:ring-offset-2';

  let desktopProps: React.ImgHTMLAttributes<HTMLImageElement> | null = null;
  let mobileSrcSet: string | undefined;
  let mobileSizes: string | undefined;
  if (desktop && !errored) {
    const common = {
      alt: title,
      sizes: '(max-width: 767px) 100vw, (max-width: 1280px) 60vw, 780px',
    };
    const base = { ...common, unoptimized: !isOptimizableImage(desktop) };
    desktopProps = getImageProps({ ...base, src: desktop, width: 1080, height: 360 }).props;
    if (hasMobileOverride) {
      const mobileProps = getImageProps({
        ...common,
        src: mobile,
        width: 1200,
        height: 900,
        unoptimized: !isOptimizableImage(mobile),
      }).props;
      mobileSrcSet = mobileProps.srcSet;
      mobileSizes = mobileProps.sizes;
    }
  }

  return (
    <article className="flex h-full min-w-0 flex-col bg-marketing-surface">
      <div
        className={`relative w-full overflow-hidden bg-marketing-berry-100 ${
          hasMobileOverride ? 'aspect-[4/3] sm:aspect-[3/1]' : 'aspect-[3/1]'
        }`}
      >
        {desktopProps ? (
          <picture>
            {mobileSrcSet ? <source media="(max-width: 767px)" srcSet={mobileSrcSet} sizes={mobileSizes} /> : null}
            {/* eslint-disable-next-line @next/next/no-img-element -- art direction needs a real <picture>; URLs are pre-optimised by lib/media */}
            <img
              {...desktopProps}
              alt={title}
              loading={priority ? 'eager' : 'lazy'}
              className="absolute inset-0 h-full w-full object-cover"
              onError={() => setErrored(true)}
            />
          </picture>
        ) : (
          <div className="flex h-full w-full items-center justify-center gap-2 text-marketing-text-secondary" role="img" aria-label={title}>
            <ImageOff className="h-5 w-5" aria-hidden="true" />
            <span className="text-xs">Artwork unavailable</span>
          </div>
        )}
      </div>
      <div className="min-w-0 border-t border-marketing-border p-4 sm:p-5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-marketing-action">From your distributor</p>
        <h2 className="mt-1 break-words text-lg font-bold leading-tight tracking-tight text-marketing-heading sm:text-xl">
          {title}
        </h2>
        {subtitle?.trim() ? (
          <p className="mt-1.5 break-words text-xs leading-5 text-marketing-text-secondary sm:text-sm">{subtitle}</p>
        ) : null}
        {target ? (
          target.external ? (
            <a href={target.href} target="_blank" rel="noopener noreferrer" className={ctaClass}>
              {cta}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : (
            <Link href={target.href} className={ctaClass}>
              {cta}
            </Link>
          )
        ) : null}
      </div>
    </article>
  );
}
