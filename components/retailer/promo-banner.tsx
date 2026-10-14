import Link from 'next/link';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { StoredImage } from '@/components/media/stored-image';
import { resolveBannerTarget } from '@/lib/retailer/banner-target';

/**
 * The storefront banner.
 *
 * Artwork standard: 1080 × 360 px — a 3:1 ratio. The image always renders
 * inside a fixed `aspect-ratio: 3 / 1` box with `object-fit: cover`, so:
 *
 *   - a correctly uploaded 1080×360 banner is shown exactly as designed,
 *   - an off-ratio upload is CROPPED, never stretched or squashed,
 *   - the reserved box means there is no layout jump while the image loads.
 *
 * Merchant-authored content only: a banner without a target shows no CTA.
 */
export function PromoBanner({
  title,
  subtitle,
  imageUrl,
  linkUrl,
  ctaLabel,
  priority = false,
}: {
  title: string;
  subtitle?: string | null;
  imageUrl: string;
  linkUrl?: string | null;
  ctaLabel?: string | null;
  priority?: boolean;
}) {
  const target = resolveBannerTarget(linkUrl);
  const cta = (
    <>
      {ctaLabel?.trim() || 'Explore'}
      {target?.external ? <ArrowUpRight className="h-4 w-4" aria-hidden="true" /> : <ArrowRight className="h-4 w-4" aria-hidden="true" />}
    </>
  );
  const ctaClass =
    'mt-3 inline-flex min-h-11 max-w-full items-center justify-center gap-2 self-start rounded-xl bg-action-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-action-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-500 focus-visible:ring-offset-2';

  return (
    <article className="flex h-full min-w-0 flex-col bg-peach-50">
      {/* 3:1 artwork box — object-cover crops, never distorts. */}
      <div className="relative w-full overflow-hidden bg-slate-100 aspect-[3/1]">
        <StoredImage
          src={imageUrl}
          alt={title}
          fill
          size="banner"
          priority={priority}
          sizes="(max-width: 640px) 100vw, (max-width: 1280px) 60vw, 780px"
          className="object-cover"
        />
      </div>
      <div className="min-w-0 border-t border-peach-200 p-4 sm:p-5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-peach-700">From your distributor</p>
        <h2 className="mt-1 break-words text-lg font-bold leading-tight tracking-tight text-slate-950 sm:text-xl">
          {title}
        </h2>
        {subtitle?.trim() ? (
          <p className="mt-1.5 break-words text-xs leading-5 text-slate-600 sm:text-sm">{subtitle}</p>
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
