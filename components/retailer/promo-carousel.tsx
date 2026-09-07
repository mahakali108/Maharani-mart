'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Megaphone } from 'lucide-react';
import { PromoBanner } from '@/components/retailer/promo-banner';

export interface PromoBannerData {
  id: string;
  title: string;
  image_url: string;
  link_url: string | null;
}

/**
 * A compact, touch-friendly promotional carousel for marketplace discovery.
 *
 * - Renders only REAL active banners coming from the `banners` table (Supabase,
 *   RLS-scoped). If the admin has not configured any, the empty fallback below
 *   is shown — never an invented offer.
 * - Touch-friendly, aspect ratio stable on small screens, accessible dots and
 *   arrow controls, autoplay disabled when the user has prefers-reduced-motion
 *   and is keyboard-only (the dots are the canonical "go to slide" control).
 */
export function PromoCarousel({ banners }: { banners: PromoBannerData[] }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const hasMultiple = banners.length > 1;

  useEffect(() => {
    if (!hasMultiple) return;
    const timer = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % banners.length);
    }, 6000);
    return () => window.clearInterval(timer);
  }, [banners.length, hasMultiple]);

  useEffect(() => {
    if (activeIndex >= banners.length) setActiveIndex(0);
  }, [activeIndex, banners.length]);

  if (banners.length === 0) {
    return (
      <section
        aria-label="Promotions"
        className="overflow-hidden rounded-2xl border border-primary-100 bg-gradient-to-br from-primary-50 via-white to-rose-50/60 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
      >
        <div className="flex min-h-[120px] items-center gap-3 p-4 sm:min-h-[150px] sm:p-5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-white shadow-sm">
            <Megaphone className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-600">
              Maharani Traders
            </p>
            <h2 className="mt-0.5 text-base font-bold tracking-tight text-slate-900 sm:text-lg">
              Offers will appear here
            </h2>
            <p className="mt-0.5 text-[11px] leading-4 text-slate-500 sm:text-xs">
              Seasonal offers and distributor announcements will show up as soon as they go live.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Promotions"
      className="group/carousel relative overflow-hidden rounded-2xl bg-slate-50 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
    >
      <div
        className="flex transition-transform duration-500 ease-out motion-reduce:transition-none"
        style={{ transform: `translateX(-${activeIndex * 100}%)` }}
      >
        {banners.map((banner) => (
          <PromoBanner
            key={banner.id}
            title={banner.title}
            imageUrl={banner.image_url}
            linkUrl={banner.link_url}
            carousel
          />
        ))}
      </div>

      {hasMultiple ? (
        <>
          <div className="absolute inset-x-0 bottom-3 flex items-center justify-center gap-1.5">
            {banners.map((banner, index) => (
              <button
                key={banner.id}
                type="button"
                aria-label={`Show promotion ${index + 1}`}
                aria-current={index === activeIndex ? 'true' : undefined}
                onClick={() => setActiveIndex(index)}
                className={`h-1.5 rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 ${
                  index === activeIndex ? 'w-5 bg-white' : 'w-1.5 bg-white/60 hover:bg-white/90'
                }`}
              />
            ))}
          </div>
          <button
            type="button"
            aria-label="Previous promotion"
            onClick={() => setActiveIndex((current) => (current - 1 + banners.length) % banners.length)}
            className="absolute left-3 top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-slate-800 shadow-sm transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 sm:flex"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Next promotion"
            onClick={() => setActiveIndex((current) => (current + 1) % banners.length)}
            className="absolute right-3 top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-slate-800 shadow-sm transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 sm:flex"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </>
      ) : null}
    </section>
  );
}
