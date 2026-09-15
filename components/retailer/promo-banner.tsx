import Link from 'next/link';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { StoredImage } from '@/components/media/stored-image';
import { resolveBannerTarget } from '@/lib/retailer/banner-target';

/** Merchant-authored content only. A banner without a target has no fake CTA. */
export function PromoBanner({
  title, subtitle, imageUrl, linkUrl, ctaLabel, priority = false,
}: {
  title: string;
  subtitle?: string | null;
  imageUrl: string;
  linkUrl?: string | null;
  ctaLabel?: string | null;
  priority?: boolean;
}) {
  const target = resolveBannerTarget(linkUrl);
  const cta = <>{ctaLabel?.trim() || 'Explore'}{target?.external ? <ArrowUpRight className="h-4 w-4" aria-hidden="true" /> : <ArrowRight className="h-4 w-4" aria-hidden="true" />}</>;
  const ctaClass = 'mt-4 inline-flex min-h-11 max-w-full items-center justify-center gap-2 self-start rounded-xl bg-action-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-action-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-500 focus-visible:ring-offset-2';

  return (
    <div className="grid h-full min-w-0 bg-action-50/60 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <div className="order-2 flex min-w-0 flex-col justify-center p-5 sm:order-1 sm:p-7 lg:p-9">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-action-700">Maharani Traders</p>
        <h2 className="mt-2 break-words text-xl font-bold leading-tight tracking-tight text-slate-950 sm:text-2xl lg:text-3xl">{title}</h2>
        {subtitle?.trim() ? <p className="mt-2 break-words text-xs leading-6 text-slate-600 sm:text-sm">{subtitle}</p> : null}
        {target ? target.external ? (
          <a href={target.href} target="_blank" rel="noopener noreferrer" className={ctaClass}>
            {cta}<span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : <Link href={target.href} className={ctaClass}>{cta}</Link> : null}
      </div>
      <div className="relative order-1 aspect-[2.4/1] min-w-0 bg-slate-100 sm:order-2 sm:aspect-auto sm:min-h-64 lg:min-h-72">
        <StoredImage src={imageUrl} alt={title} fill size="banner" priority={priority}
          sizes="(max-width: 640px) 100vw, (max-width: 1280px) 55vw, 670px" className="object-cover" />
      </div>
    </div>
  );
}
