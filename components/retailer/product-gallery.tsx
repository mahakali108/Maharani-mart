'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { ChevronLeft, ChevronRight, ImageOff, ZoomIn, ZoomOut, X, Maximize2 } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

/**
 * Universal product gallery — works for EVERY category (Face Wash, Powder,
 * Soap, Shampoo, Hair Oil, Cream, Lotion, Toothpaste, Household, etc.).
 *
 * - Full-size mobile image area: contain-fit, clean light background, no
 *   crop/stretch/blur. Portrait, square and landscape images all render
 *   completely visible. The image occupies most of the visual section
 *   (minimal padding, no tiny-image-in-large-card).
 * - Multiple real images only: main + thumbnails, swipe, prev/next,
 *   lightbox with zoom, counter 1/5, keyboard nav, accessible alt text.
 * - Variant-aware: the parent page feeds variantGalleryImages() so switching
 *   size swaps the whole gallery (variant gallery first, parent as fallback).
 */
export function ProductGallery({
  name,
  images,
  badges,
  favoriteSlot,
  shareSlot,
}: {
  name: string;
  images: { id: string; image_url: string }[];
  badges?: React.ReactNode;
  favoriteSlot?: React.ReactNode;
  shareSlot?: React.ReactNode;
}) {
  const [active, setActive] = useState(0);
  const [lightboxZoom, setLightboxZoom] = useState(1);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number | null>(null);

  // Reset active when variant changes (image list identity changes) — ensures
  // switching 50g -> 100g never shows index 3 of the previous gallery.
  const imageIds = images.map((i) => i.id).join('|');
  useEffect(() => {
    setActive(0);
    setLightboxZoom(1);
  }, [imageIds]);

  const current = images[active] ?? images[0] ?? null;
  const multi = images.length > 1;

  const openLightbox = useCallback(() => {
    setLightboxZoom(1);
    dialogRef.current?.showModal();
  }, []);

  const closeLightbox = useCallback(() => {
    dialogRef.current?.close();
    setLightboxZoom(1);
  }, []);

  const step = useCallback(
    (delta: number) => {
      if (!multi) return;
      setActive((prev) => (prev + delta + images.length) % images.length);
      setLightboxZoom(1);
    },
    [multi, images.length]
  );

  // Keyboard navigation on desktop: ArrowLeft / ArrowRight / Escape
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isOpen = dialogRef.current?.open ?? false;
      if (e.key === 'Escape' && isOpen) {
        // Native dialog handles Escape, but ensure zoom resets
        setLightboxZoom(1);
        return;
      }
      // Only handle arrows when gallery or lightbox is focused/visible
      const target = e.target as HTMLElement | null;
      const insideGallery = mainRef.current?.contains(target) || isOpen;
      if (!insideGallery) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        step(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        step(1);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [step]);

  // Touch swipe for main image
  function onTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  }
  function onTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current === null) return;
    const endX = e.changedTouches[0]?.clientX ?? 0;
    const delta = endX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(delta) < 48) return;
    if (delta < 0) step(1);
    else step(-1);
  }

  // Accessible alt per image: product name + index when multi
  const altFor = (index: number) =>
    images.length > 1 ? `${name} — view ${index + 1} of ${images.length}` : name;

  return (
    <div className="space-y-3">
      {/* Main image card — full-size, light background, premium rounded */}
      <section
        ref={mainRef}
        aria-label="Product gallery"
        className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
      >
        {/* Image area: large on mobile, spacious on desktop, no aspect-square trap.
            Uses a flexible min-height so portrait/landscape/square all fill naturally
            with contain-fit, while the image itself remains uncropped and undistorted. */}
        <div
          className={cn(
            'relative flex w-full items-center justify-center overflow-hidden bg-white',
            'min-h-[360px] sm:min-h-[440px] lg:min-h-[520px]',
            'px-2 py-3 sm:px-4 sm:py-5 lg:px-6 lg:py-6'
          )}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          {current ? (
            <>
              <button
                type="button"
                onClick={openLightbox}
                aria-label={`Open image viewer for ${name} — image ${active + 1} of ${images.length}`}
                className="absolute inset-0 flex h-full w-full items-center justify-center p-3 sm:p-4 lg:p-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-300"
              >
                <Image
                  src={current.image_url}
                  alt={altFor(active)}
                  fill
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 45vw"
                  className="object-contain"
                  unoptimized
                  priority
                />
              </button>

              {/* Counter — only when real images exist and >1, not a fake badge */}
              {multi ? (
                <span
                  className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-slate-900/80 px-2.5 py-1 text-[11px] font-bold tabular-nums text-white shadow-sm backdrop-blur"
                  aria-live="polite"
                >
                  {active + 1} / {images.length}
                </span>
              ) : null}

              {/* Zoom hint */}
              <span
                className="pointer-events-none absolute bottom-3 right-3 flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-slate-500 shadow-sm backdrop-blur sm:bottom-4 sm:right-4"
                aria-hidden="true"
              >
                <ZoomIn className="h-4 w-4" />
              </span>

              {/* Prev / Next on main — thumb-friendly, visible when multi */}
              {multi ? (
                <>
                  <button
                    type="button"
                    onClick={() => step(-1)}
                    aria-label="Previous image"
                    className="absolute left-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white/90 text-slate-700 shadow-sm backdrop-blur transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 sm:left-3 sm:h-10 sm:w-10"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => step(1)}
                    aria-label="Next image"
                    className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white/90 text-slate-700 shadow-sm backdrop-blur transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 sm:right-3 sm:h-10 sm:w-10"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </>
              ) : null}
            </>
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 py-16 text-slate-300">
              <ImageOff className="h-14 w-14" aria-hidden="true" />
              <span className="text-[11px] font-bold uppercase tracking-wider">Product image unavailable</span>
            </div>
          )}

          {/* Badges — discount / NEW / OFFER, top-left */}
          {badges ? (
            <div className="pointer-events-none absolute left-3 top-3 flex flex-col items-start gap-1.5 sm:left-4 sm:top-4">
              {badges}
            </div>
          ) : null}

          {/* Favorite + Share — top-right, stacked */}
          {shareSlot || favoriteSlot ? (
            <div className="absolute right-3 top-3 flex flex-col items-center gap-1.5 sm:right-4 sm:top-4">
              {shareSlot}
              {favoriteSlot}
            </div>
          ) : null}
        </div>
      </section>

      {/* Thumbnails — horizontally scrollable, swipeable, keyboard reachable */}
      {images.length > 1 ? (
        <div
          className="scrollbar-none flex gap-2 overflow-x-auto scroll-smooth pb-1 snap-x snap-mandatory -mx-1 px-1"
          role="listbox"
          aria-label={`${name} thumbnails`}
        >
          {images.map((image, index) => (
            <button
              key={image.id}
              type="button"
              role="option"
              aria-selected={index === active}
              aria-label={`View ${altFor(index)}`}
              onClick={() => setActive(index)}
              className={cn(
                'relative h-[72px] w-[72px] shrink-0 snap-start overflow-hidden rounded-xl border bg-white transition sm:h-16 sm:w-16 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300',
                index === active
                  ? 'border-primary-600 ring-2 ring-primary-100'
                  : 'border-slate-200 hover:border-primary-300'
              )}
            >
              <Image
                src={image.image_url}
                alt={altFor(index)}
                fill
                className="object-contain p-1.5"
                unoptimized
              />
              {index === active ? (
                <span className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-primary-600" />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      {/* Lightbox — native <dialog>: Esc, focus trap, swipe, zoom, keyboard */}
      <dialog
        ref={dialogRef}
        aria-label={`${name} — image ${active + 1} of ${images.length}`}
        className="m-auto h-[100dvh] w-screen max-w-none rounded-none border-0 bg-slate-950/95 p-0 shadow-none backdrop:bg-slate-950/70 backdrop-blur-sm open:flex open:items-center open:justify-center"
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('button')) return;
          // Tap backdrop closes, but not when zoomed (allow pan)
          if (lightboxZoom > 1) return;
          closeLightbox();
        }}
        onClose={() => setLightboxZoom(1)}
      >
        <div
          className="relative flex h-full w-full items-center justify-center"
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          {current ? (
            <div
              className="relative h-full w-full"
              style={{ touchAction: lightboxZoom > 1 ? 'pan-x pan-y' : 'pan-y' }}
            >
              <Image
                src={current.image_url}
                alt={altFor(active)}
                fill
                sizes="100vw"
                className={cn(
                  'object-contain p-4 pb-16 pt-14 sm:p-8 sm:pb-20 sm:pt-16 transition-transform duration-200',
                  lightboxZoom > 1 && 'cursor-grab active:cursor-grabbing'
                )}
                style={{ transform: `scale(${lightboxZoom})` }}
                unoptimized
                priority
              />
            </div>
          ) : null}

          {/* Top bar: counter + zoom controls + close */}
          <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 px-3 py-3 sm:px-5">
            <span className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold tabular-nums text-white backdrop-blur">
              {active + 1} / {images.length}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setLightboxZoom((z) => Math.max(1, Math.round((z - 0.5) * 10) / 10))}
                disabled={lightboxZoom <= 1}
                aria-label="Zoom out"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-30 sm:h-10 sm:w-10"
              >
                <ZoomOut className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => setLightboxZoom((z) => Math.min(3, Math.round((z + 0.5) * 10) / 10))}
                disabled={lightboxZoom >= 3}
                aria-label="Zoom in"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-30 sm:h-10 sm:w-10"
              >
                <Maximize2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={closeLightbox}
                aria-label="Close image viewer"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:h-10 sm:w-10"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Prev / next in lightbox */}
          {multi ? (
            <>
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label="Previous image"
                className="absolute left-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:left-4"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
              <button
                type="button"
                onClick={() => step(1)}
                aria-label="Next image"
                className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:right-4"
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            </>
          ) : null}

          {/* Thumbnail strip in lightbox — quick jump */}
          {multi ? (
            <div className="scrollbar-none absolute bottom-0 inset-x-0 flex justify-center gap-1.5 overflow-x-auto bg-gradient-to-t from-black/40 to-transparent px-3 py-3 sm:gap-2 sm:px-4 sm:py-4">
              {images.map((image, index) => (
                <button
                  key={`lb-${image.id}`}
                  type="button"
                  onClick={() => setActive(index)}
                  aria-label={`View image ${index + 1}`}
                  aria-pressed={index === active}
                  className={cn(
                    'relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border bg-white/95 transition sm:h-14 sm:w-14',
                    index === active ? 'border-white ring-2 ring-white' : 'border-white/30 opacity-70 hover:opacity-100'
                  )}
                >
                  <Image src={image.image_url} alt={altFor(index)} fill className="object-contain p-1" unoptimized />
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </dialog>

      {/* Swipe hint for screen readers */}
      {multi ? (
        <p className="sr-only" aria-live="polite">
          Image {active + 1} of {images.length} displayed. Swipe or use arrow keys to navigate.
        </p>
      ) : null}
    </div>
  );
}
