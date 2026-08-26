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

/** A compact, touch-friendly promotional carousel for marketplace discovery. */
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
      <section aria-label="Promotions" className="overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-r from-blue-700 via-blue-800 to-slate-950 p-5 text-white shadow-sm sm:p-7">
        <div className="flex min-h-[136px] items-end gap-3 sm:min-h-[180px]">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15 text-blue-100 ring-1 ring-white/20">
            <Megaphone className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-200">Maharani Traders</p>
            <h2 className="mt-1 text-lg font-bold tracking-tight sm:text-2xl">Promotions are on their way</h2>
            <p className="mt-1 text-xs text-blue-100 sm:text-sm">Live wholesale offers and seasonal updates will appear here.</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Promotions" className="group/carousel relative overflow-hidden rounded-2xl">
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
                className={`h-1.5 rounded-full transition-all ${index === activeIndex ? 'w-5 bg-white' : 'w-1.5 bg-white/60 hover:bg-white/90'}`}
              />
            ))}
          </div>
          <button
            type="button"
            aria-label="Previous promotion"
            onClick={() => setActiveIndex((current) => (current - 1 + banners.length) % banners.length)}
            className="absolute left-3 top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-slate-800 shadow-sm transition hover:bg-white sm:flex"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Next promotion"
            onClick={() => setActiveIndex((current) => (current + 1) % banners.length)}
            className="absolute right-3 top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-slate-800 shadow-sm transition hover:bg-white sm:flex"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </>
      ) : null}
    </section>
  );
}
