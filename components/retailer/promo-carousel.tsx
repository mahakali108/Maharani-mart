'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { PromoBanner } from '@/components/retailer/promo-banner';
import { cn } from '@/lib/utils/cn';

export interface PromoBannerData {
  id: string;
  title: string;
  image_url: string;
  link_url: string | null;
  subtitle?: string | null;
  cta_label?: string | null;
}

/** Same grid cell for every slide reserves the tallest slide's height.
 * Inactive slides are invisible and untabbable. Auto-rotation can be paused,
 * stops on focus, and respects reduced motion and document visibility. */
export function PromoCarousel({ banners }: { banners: PromoBannerData[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(true);
  const [hidden, setHidden] = useState(false);
  const activeIndex = index < banners.length ? index : 0;
  const hasMultiple = banners.length > 1;
  const rotating = hasMultiple && !paused && !hovered && !reducedMotion && !hidden;
  // Horizontal swipe on touch devices. `touch-pan-y` on the track keeps
  // vertical page scrolling native while we only consume the sideways drag.
  const swipeStartX = useRef<number | null>(null);
  const SWIPE_THRESHOLD_PX = 40;

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onMotion = () => setReducedMotion(media.matches);
    const onVisibility = () => setHidden(document.hidden);
    onMotion();
    onVisibility();
    media.addEventListener('change', onMotion);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      media.removeEventListener('change', onMotion);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  useEffect(() => {
    if (!rotating) return;
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % banners.length), 6000);
    return () => window.clearInterval(timer);
  }, [rotating, banners.length]);

  // No active/visible banner => the section is not rendered at all: no empty
  // frame, no placeholder image, no reserved height.
  if (banners.length === 0) return null;
  const controlClass = 'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-600 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-500';
  function show(next: number) { setPaused(true); setIndex((next + banners.length) % banners.length); }

  return (
    <section aria-label="Maharani Traders promotions" aria-roledescription="carousel"
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onFocusCapture={(event) => { if (!(event.target as HTMLElement).closest('[data-rotation-control]')) setPaused(true); }}
      className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div
        className="grid touch-pan-y"
        aria-live={rotating ? 'off' : 'polite'}
        onTouchStart={(event) => { swipeStartX.current = event.touches[0]?.clientX ?? null; }}
        onTouchEnd={(event) => {
          const start = swipeStartX.current;
          swipeStartX.current = null;
          const end = event.changedTouches[0]?.clientX;
          if (start === null || typeof end !== 'number') return;
          const delta = end - start;
          // A deliberate sideways drag only: a tap or a vertical scroll (which
          // can end with a small horizontal drift) must not change the slide.
          if (Math.abs(delta) < SWIPE_THRESHOLD_PX) return;
          show(delta < 0 ? activeIndex + 1 : activeIndex - 1);
        }}
      >
        {banners.map((banner, slideIndex) => (
          <div key={banner.id} role="group" aria-roledescription="slide" aria-label={`${slideIndex + 1} of ${banners.length}`}
            aria-hidden={slideIndex !== activeIndex}
            className={cn('col-start-1 row-start-1 min-w-0', slideIndex !== activeIndex && 'invisible pointer-events-none')}>
            <PromoBanner title={banner.title} subtitle={banner.subtitle} imageUrl={banner.image_url}
              linkUrl={banner.link_url} ctaLabel={banner.cta_label} priority={slideIndex === 0} />
          </div>
        ))}
      </div>
      {hasMultiple ? (
        <div className="flex min-w-0 items-center justify-between gap-1 border-t border-slate-100 px-2 py-1 sm:px-4">
          <button type="button" aria-label="Previous promotion" onClick={() => show(activeIndex - 1)} className={controlClass}><ChevronLeft className="h-5 w-5" aria-hidden="true" /></button>
          <div className="flex min-w-0 flex-wrap items-center justify-center">
            {banners.map((banner, slideIndex) => <button key={banner.id} type="button"
              aria-label={`Show promotion ${slideIndex + 1}`} aria-current={slideIndex === activeIndex ? 'true' : undefined}
              onClick={() => show(slideIndex)} className="flex h-11 w-6 items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-500 sm:w-8">
              <span className={cn('h-1.5 rounded-full', slideIndex === activeIndex ? 'w-4 bg-action-600' : 'w-1.5 bg-slate-300')} />
            </button>)}
          </div>
          <div className="flex shrink-0">
            {!reducedMotion ? <button type="button" data-rotation-control aria-label={paused ? 'Play promotions' : 'Pause promotions'}
              onClick={() => setPaused((value) => !value)} className={controlClass}>
              {paused ? <Play className="h-4 w-4" aria-hidden="true" /> : <Pause className="h-4 w-4" aria-hidden="true" />}
            </button> : null}
            <button type="button" aria-label="Next promotion" onClick={() => show(activeIndex + 1)} className={controlClass}><ChevronRight className="h-5 w-5" aria-hidden="true" /></button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
