import Image from 'next/image';
import { ArrowRight } from 'lucide-react';

/**
 * One banner slide. The image is the real Supabase image. We overlay a soft
 * light/scrim so the title remains readable on the brightest product photo,
 * but we deliberately do not paint a heavy dark gradient on top — the
 * retailer-facing experience stays light, not "cinema".
 */
export function PromoBanner({
  title,
  imageUrl,
  linkUrl,
  carousel = false,
}: {
  title: string;
  imageUrl: string;
  linkUrl?: string | null;
  /** Makes the banner occupy one full slide inside PromoCarousel. */
  carousel?: boolean;
}) {
  const content = (
    <>
      <Image
        src={imageUrl}
        alt={title}
        fill
        className="object-cover transition duration-500 group-hover:scale-105"
        unoptimized
        sizes={carousel ? '100vw' : '(max-width: 640px) 92vw, 720px'}
      />
      {/* Soft scrim that is bright enough to keep the slide airy, dark enough to
         make the title readable on any product photograph. */}
      <div className="absolute inset-0 bg-gradient-to-r from-slate-950/55 via-slate-950/20 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-slate-950/30 via-transparent to-transparent" />
      <div className="absolute inset-y-0 left-0 flex max-w-[80%] flex-col justify-end p-4 text-white sm:max-w-[70%] sm:p-6">
        <span className="mb-2 w-fit rounded-full bg-white/90 px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-primary-700 shadow-sm">
          Featured
        </span>
        <h2 className="text-base font-bold leading-tight drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)] sm:text-2xl">
          {title}
        </h2>
        <span className="mt-2.5 inline-flex w-fit items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-[11px] font-bold text-slate-950 shadow-sm sm:text-xs">
          Explore offer <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      </div>
    </>
  );

  if (linkUrl) {
    return (
      <a
        href={linkUrl}
        target="_blank"
        rel="noreferrer"
        className={`group relative aspect-[16/9] shrink-0 snap-start overflow-hidden rounded-2xl bg-slate-100 shadow-sm ${carousel ? 'w-full min-w-full' : 'w-[92%] sm:w-full'}`}
      >
        {content}
      </a>
    );
  }

  return (
    <div
      className={`group relative aspect-[16/9] shrink-0 snap-start overflow-hidden rounded-2xl bg-slate-100 shadow-sm ${carousel ? 'w-full min-w-full' : 'w-[92%] sm:w-full'}`}
    >
      {content}
    </div>
  );
}
